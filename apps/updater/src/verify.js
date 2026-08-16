import { createPublicKey, verify } from 'node:crypto';

function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export function verifyManifest(manifest, publicKeyBase64) {
  const { signing, ...unsigned } = manifest;
  if (!signing || signing.algorithm !== 'Ed25519' || !signing.signature) return false;
  const key = createPublicKey({ key: Buffer.from(publicKeyBase64, 'base64'), format: 'der', type: 'spki' });
  return verify(null, Buffer.from(canonicalJson(unsigned)), key, Buffer.from(signing.signature, 'base64'));
}
