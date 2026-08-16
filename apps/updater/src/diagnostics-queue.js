import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function queueDir(controlDir) {
  return path.join(controlDir, 'diagnostics-queue');
}

export async function enqueueDiagnostic(controlDir, event) {
  const dir = queueDir(controlDir);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  const temporary = `${file}.tmp`;
  await writeFile(temporary, JSON.stringify(event));
  await rename(temporary, file);
  return file;
}

export async function flushDiagnostics(baseUrl, controlDir, { limit = 20 } = {}) {
  const dir = queueDir(controlDir);
  let names = [];
  try { names = (await readdir(dir)).filter((name) => name.endsWith('.json')).sort(); } catch { return { flushed: 0 }; }
  let flushed = 0;
  for (const name of names.slice(0, limit)) {
    const file = path.join(dir, name);
    const event = JSON.parse(await readFile(file, 'utf8'));
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/diagnostics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) break;
    await rm(file, { force: true });
    flushed += 1;
  }
  return { flushed, remaining: names.length - flushed };
}

export async function reportDiagnostic(baseUrl, controlDir, event) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/diagnostics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(15_000)
    });
    if (response.ok) {
      await flushDiagnostics(baseUrl, controlDir).catch(() => {});
      return { queued: false };
    }
    throw new Error(`diagnostic API returned ${response.status}`);
  } catch {
    await enqueueDiagnostic(controlDir, event);
    return { queued: true };
  }
}
