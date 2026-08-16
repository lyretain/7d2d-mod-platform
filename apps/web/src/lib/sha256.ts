const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

function rr(value: number, bits: number) {
  return (value >>> bits) | (value << (32 - bits));
}

export class Sha256 {
  private h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private w = new Uint32Array(64);
  private block = new Uint8Array(64);
  private blockLen = 0;
  private bytes = 0;

  update(input: Uint8Array) {
    for (let index = 0; index < input.length; index += 1) {
      this.block[this.blockLen] = input[index];
      this.blockLen += 1;
      this.bytes += 1;
      if (this.blockLen === 64) {
        this.compress();
        this.blockLen = 0;
      }
    }
    return this;
  }

  hex() {
    const bitLen = this.bytes * 8;
    this.block[this.blockLen] = 0x80;
    this.blockLen += 1;
    if (this.blockLen > 56) {
      while (this.blockLen < 64) {
        this.block[this.blockLen] = 0;
        this.blockLen += 1;
      }
      this.compress();
      this.blockLen = 0;
    }
    while (this.blockLen < 56) {
      this.block[this.blockLen] = 0;
      this.blockLen += 1;
    }
    const high = Math.floor(bitLen / 0x100000000);
    const low = bitLen >>> 0;
    this.block[56] = (high >>> 24) & 255;
    this.block[57] = (high >>> 16) & 255;
    this.block[58] = (high >>> 8) & 255;
    this.block[59] = high & 255;
    this.block[60] = (low >>> 24) & 255;
    this.block[61] = (low >>> 16) & 255;
    this.block[62] = (low >>> 8) & 255;
    this.block[63] = low & 255;
    this.compress();
    return [...this.h].map((value) => value.toString(16).padStart(8, '0')).join('');
  }

  private compress() {
    const { w, h, block } = this;
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      w[index] = ((block[offset] << 24) | (block[offset + 1] << 16) | (block[offset + 2] << 8) | block[offset + 3]) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rr(w[index - 15], 7) ^ rr(w[index - 15], 18) ^ (w[index - 15] >>> 3);
      const s1 = rr(w[index - 2], 17) ^ rr(w[index - 2], 19) ^ (w[index - 2] >>> 10);
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0;
    }
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let index = 0; index < 64; index += 1) {
      const s1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + K[index] + w[index]) >>> 0;
      const s0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
}

export async function sha256File(file: Blob, onProgress?: (loaded: number, total: number) => void) {
  const hasher = new Sha256();
  const chunkSize = 4 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    const end = Math.min(offset + chunkSize, file.size);
    hasher.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
    offset = end;
    onProgress?.(offset, file.size);
  }
  if (!file.size) onProgress?.(0, 0);
  return hasher.hex();
}
