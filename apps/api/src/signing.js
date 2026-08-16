import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from './util.js';

export class SigningService {
  constructor({ dataDir, privateKeyBase64 }) {
    this.dataDir = dataDir;
    this.privateKeyBase64 = privateKeyBase64;
  }

  async init() {
    if (this.privateKeyBase64) {
      this.privateKey = createPrivateKey({
        key: Buffer.from(this.privateKeyBase64, 'base64'),
        format: 'der',
        type: 'pkcs8'
      });
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
    }
    this.publicKey = createPublicKey(this.privateKey);
    this.keyId = this.publicKey.export({ format: 'der', type: 'spki' }).subarray(-8).toString('hex');
  }

  publicJwk() {
    return { keyId: this.keyId, algorithm: 'Ed25519', publicKey: this.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
  }

  signObject(value) {
    const signature = sign(null, Buffer.from(canonicalJson(value)), this.privateKey).toString('base64');
    return { ...value, signing: { keyId: this.keyId, algorithm: 'Ed25519', signature } };
  }

  verifyObject(signed) {
    const { signing, ...value } = signed;
    return Boolean(signing?.signature) && verify(null, Buffer.from(canonicalJson(value)), this.publicKey, Buffer.from(signing.signature, 'base64'));
  }
}
