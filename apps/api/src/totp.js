import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function base32Encode(buffer) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(input).toUpperCase().replace(/=+$/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const index = alphabet.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20));
}

export function totp(secret, step = Math.floor(Date.now() / 30000)) {
  const key = base32Decode(secret);
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step & 0xffffffff, 4);
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1_000_000;
  return String(code).padStart(6, '0');
}

export function verifyTotp(secret, code) {
  const expected = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(expected)) return false;
  const window = [0, -1, 1].map((delta) => totp(secret, Math.floor(Date.now() / 30000) + delta));
  return window.some((item) => {
    const left = Buffer.from(item);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}

export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => randomBytes(5).toString('hex'));
}
