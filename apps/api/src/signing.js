import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson, now } from './util.js';

function keyIdOf(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' }).subarray(-8).toString('hex');
}

function publicKeyBase64(publicKey) {
  return publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
}

export class SigningService {
  constructor({ dataDir, privateKeyBase64, signingServiceUrl, signingServiceToken, production = false, ttlDays = 90 }) {
    this.dataDir = dataDir;
    this.privateKeyBase64 = privateKeyBase64;
    this.signingServiceUrl = signingServiceUrl;
    this.signingServiceToken = signingServiceToken;
    this.production = production;
    this.ttlDays = ttlDays;
    this.keyring = [];
  }

  async init() {
    this.keyringFile = path.join(this.dataDir, 'state', 'keyring.json');
    if (this.signingServiceUrl) {
      const remote = await fetch(`${this.signingServiceUrl.replace(/\/$/, '')}/public-key`, {
        headers: this.signingServiceToken ? { authorization: `Bearer ${this.signingServiceToken}` } : {},
        signal: AbortSignal.timeout(10_000)
      });
      if (!remote.ok) throw new Error('Remote signing service is unavailable');
      const body = await remote.json();
      this.keyId = body.keyId;
      this.publicKey = createPublicKey({ key: Buffer.from(body.publicKey, 'base64'), format: 'der', type: 'spki' });
      this.privateKey = null;
    } else if (this.privateKeyBase64) {
      this.privateKey = createPrivateKey({ key: Buffer.from(this.privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' });
      this.publicKey = createPublicKey(this.privateKey);
      this.keyId = keyIdOf(this.publicKey);
    } else if (this.production) {
      throw new Error('Production signing requires SIGNING_PRIVATE_KEY or SIGNING_SERVICE_URL');
    } else {
      const keyFile = path.join(this.dataDir, 'state', 'dev-signing-key.pk8');
      await mkdir(path.dirname(keyFile), { recursive: true });
      try {
        this.privateKey = createPrivateKey({ key: await readFile(keyFile), format: 'der', type: 'pkcs8' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        const pair = generateKeyPairSync('ed25519');
        this.privateKey = pair.privateKey;
        await writeFile(keyFile, this.privateKey.export({ format: 'der', type: 'pkcs8' }), { mode: 0o600 });
      }
      this.publicKey = createPublicKey(this.privateKey);
      this.keyId = keyIdOf(this.publicKey);
    }
    try {
      this.keyring = JSON.parse(await readFile(this.keyringFile, 'utf8'));
    } catch {
      this.keyring = [];
    }
    this.remember(this.publicJwk());
  }

  remember(entry) {
    if (!this.keyring.some((item) => item.keyId === entry.keyId)) {
      this.keyring.push({ ...entry, addedAt: now(), revokedAt: null });
    }
  }

  publicJwk() {
    return { keyId: this.keyId, algorithm: 'Ed25519', publicKey: publicKeyBase64(this.publicKey), keys: this.activeKeys() };
  }

  activeKeys() {
    return this.keyring.filter((item) => !item.revokedAt).map(({ keyId, algorithm, publicKey }) => ({ keyId, algorithm, publicKey }));
  }

  async persistKeyring() {
    await mkdir(path.dirname(this.keyringFile), { recursive: true });
    await writeFile(this.keyringFile, JSON.stringify(this.keyring, null, 2));
  }

  async signObject(value) {
    const unsigned = { ...value, expiresAt: value.expiresAt || new Date(Date.now() + this.ttlDays * 86400_000).toISOString() };
    if (this.signingServiceUrl) {
      const response = await fetch(`${this.signingServiceUrl.replace(/\/$/, '')}/sign`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(this.signingServiceToken ? { authorization: `Bearer ${this.signingServiceToken}` } : {}) },
        body: JSON.stringify({ payload: unsigned }),
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new Error('Remote signing failed');
      const signed = await response.json();
      return { ...unsigned, signing: { keyId: signed.keyId || this.keyId, algorithm: 'Ed25519', signature: signed.signature } };
    }
    const signature = sign(null, Buffer.from(canonicalJson(unsigned)), this.privateKey).toString('base64');
    return { ...unsigned, signing: { keyId: this.keyId, algorithm: 'Ed25519', signature } };
  }

  verifyObject(signed, keys = this.activeKeys()) {
    const { signing, ...value } = signed;
    if (!signing?.signature || signing.algorithm !== 'Ed25519') return false;
    if (value.expiresAt && Date.parse(value.expiresAt) <= Date.now()) return false;
    if (signing.keyId && keys.every((key) => key.keyId !== signing.keyId)) return false;
    return keys.some((item) => {
      try {
        const key = createPublicKey({ key: Buffer.from(item.publicKey, 'base64'), format: 'der', type: 'spki' });
        return verify(null, Buffer.from(canonicalJson(value)), key, Buffer.from(signing.signature, 'base64'));
      } catch {
        return false;
      }
    });
  }

  async rotateLocal() {
    if (this.signingServiceUrl || this.production && !this.privateKey) throw new Error('Rotate the remote signing service instead');
    const previous = this.publicJwk();
    const pair = generateKeyPairSync('ed25519');
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    this.keyId = keyIdOf(this.publicKey);
    this.remember(previous);
    this.remember(this.publicJwk());
    await this.persistKeyring();
    return this.publicJwk();
  }

  async revokeKey(keyId) {
    const item = this.keyring.find((key) => key.keyId === keyId);
    if (!item) return false;
    item.revokedAt = now();
    await this.persistKeyring();
    return true;
  }

  async ready() {
    if (this.signingServiceUrl) {
      try {
        const response = await fetch(`${this.signingServiceUrl.replace(/\/$/, '')}/public-key`, { signal: AbortSignal.timeout(5_000) });
        return { ok: response.ok, driver: 'remote' };
      } catch (error) {
        return { ok: false, driver: 'remote', error: error.message };
      }
    }
    return { ok: Boolean(this.publicKey), driver: this.privateKey ? 'local' : 'unknown' };
  }
}
