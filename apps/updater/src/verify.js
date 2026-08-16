import { createPublicKey, verify } from 'node:crypto';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function verifyManifest(manifest, publicKeyBase64, options = {}) {
  const { signing, ...unsigned } = manifest;
  if (!signing || signing.algorithm !== 'Ed25519' || !signing.signature) return false;
  if (unsigned.expiresAt && Date.parse(unsigned.expiresAt) <= Date.now()) return false;
  const keys = options.keys?.length
    ? options.keys
    : publicKeyBase64
      ? [{ keyId: signing.keyId, publicKey: publicKeyBase64 }]
      : [];
  if (options.revokedKeyIds?.includes(signing.keyId)) return false;
  if (signing.keyId && keys.every((key) => key.keyId && key.keyId !== signing.keyId)) return false;
  return keys.some((item) => {
    try {
      const key = createPublicKey({ key: Buffer.from(item.publicKey, 'base64'), format: 'der', type: 'spki' });
      return verify(null, Buffer.from(canonicalJson(unsigned)), key, Buffer.from(signing.signature, 'base64'));
    } catch {
      return false;
    }
  });
}
