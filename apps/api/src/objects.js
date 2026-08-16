import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { artifactPublicUrl } from './cloudflare.js';

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest();
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function s3Sign({ method, url, headers, bodyHash, accessKey, secretKey, region, service = 's3' }) {
  const parsed = new URL(url);
  const now = headers['x-amz-date'];
  const date = now.slice(0, 8);
  const signedHeaders = Object.keys(headers).map((key) => key.toLowerCase()).sort();
  const canonicalHeaders = signedHeaders.map((key) => `${key}:${headers[Object.keys(headers).find((item) => item.toLowerCase() === key)]}\n`).join('');
  const canonical = [method, parsed.pathname, [...parsed.searchParams.entries()].map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`).sort().join('&'), canonicalHeaders, signedHeaders.join(';'), bodyHash].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', now, scope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, date), region), service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
}

export function objectKey(sha, prefix = 'objects/') {
  return `${prefix.replace(/\/?$/, '/')}${sha}`;
}

export function createObjectStore({ dataDir, s3 = {}, cdnBaseUrl, publicBaseUrl, cdnStyle = 'origin' }) {
  const localDir = path.join(dataDir, 'objects');
  const enabled = Boolean(s3.endpoint && s3.bucket && s3.accessKey && s3.secretKey);

  function publicUrl(sha) {
    return artifactPublicUrl(sha, { cdnBaseUrl, cdnStyle, s3 }, publicBaseUrl);
  }

  async function removeS3(sha) {
    if (!enabled) return;
    const key = objectKey(sha, s3.prefix);
    const endpoint = s3.endpoint.replace(/\/$/, '');
    const url = `${endpoint}/${s3.bucket}/${key}`;
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const bodyHash = createHash('sha256').update('').digest('hex');
    const headers = { host: new URL(endpoint).host, 'x-amz-date': now, 'x-amz-content-sha256': bodyHash };
    headers.authorization = s3Sign({ method: 'DELETE', url, headers, bodyHash, accessKey: s3.accessKey, secretKey: s3.secretKey, region: s3.region || 'auto' });
    await fetch(url, { method: 'DELETE', headers }).catch(() => {});
  }

  async function putLocal(sha, sourcePath) {
    await mkdir(localDir, { recursive: true });
    const target = path.join(localDir, sha);
    try {
      await pipeline(createReadStream(sourcePath), createWriteStream(target, { flags: 'wx' }));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    return stat(target);
  }

  async function putS3(sha, sourcePath, size) {
    const key = objectKey(sha, s3.prefix);
    const endpoint = s3.endpoint.replace(/\/$/, '');
    const url = `${endpoint}/${s3.bucket}/${key}`;
    const body = await import('node:fs/promises').then((fs) => fs.readFile(sourcePath));
    const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    const bodyHash = createHash('sha256').update(body).digest('hex');
    const headers = {
      host: new URL(endpoint).host,
      'x-amz-date': now,
      'x-amz-content-sha256': bodyHash,
      'content-type': 'application/zip',
      'content-length': String(size || body.length)
    };
    headers.authorization = s3Sign({ method: 'PUT', url, headers, bodyHash, accessKey: s3.accessKey, secretKey: s3.secretKey, region: s3.region || 'us-east-1' });
    const response = await fetch(url, { method: 'PUT', headers, body });
    if (!response.ok) throw new Error(`S3 PUT failed (${response.status})`);
    return { size: body.length };
  }

  return {
    enabled,
    localDir,
    publicUrl,
    async put(sha, sourcePath, size) {
      const local = await putLocal(sha, sourcePath);
      if (enabled) await putS3(sha, sourcePath, size || local.size);
      return { sha256: sha, size: local.size, key: objectKey(sha, s3.prefix), stored: enabled ? 's3+local' : 'local' };
    },
    async stat(sha) {
      return stat(path.join(localDir, sha));
    },
    open(sha) {
      return createReadStream(path.join(localDir, sha));
    },
    async listLocal() {
      try { return await readdir(localDir); } catch { return []; }
    },
    async remove(sha) {
      await unlink(path.join(localDir, sha)).catch(() => {});
      await removeS3(sha);
    },
    async ready() {
      if (!enabled) return { ok: true, driver: 'local' };
      try {
        const endpoint = s3.endpoint.replace(/\/$/, '');
        const url = `${endpoint}/${s3.bucket}?location`;
        const now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
        const bodyHash = createHash('sha256').update('').digest('hex');
        const headers = { host: new URL(endpoint).host, 'x-amz-date': now, 'x-amz-content-sha256': bodyHash };
        headers.authorization = s3Sign({ method: 'GET', url, headers, bodyHash, accessKey: s3.accessKey, secretKey: s3.secretKey, region: s3.region || 'us-east-1' });
        const response = await fetch(url, { headers });
        return { ok: response.ok || response.status === 301, driver: 's3', status: response.status };
      } catch (error) {
        return { ok: false, driver: 's3', error: error.message };
      }
    }
  };
}

export function referencedHashes(snapshot) {
  const hashes = new Set();
  for (const mod of Object.values(snapshot.mods || {})) {
    for (const version of Object.values(mod.versions || {})) if (version.artifactSha) hashes.add(version.artifactSha);
  }
  for (const review of Object.values(snapshot.reviews || {})) if (review.sha256) hashes.add(review.sha256);
  for (const channel of Object.values(snapshot.launcher?.channels || {})) if (channel.sha256 && !channel.revokedAt) hashes.add(channel.sha256);
  return hashes;
}
