import { appendFile, mkdir, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

const MAX_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 60 * 60_000;

export function clampLogRetentionDays(value) {
  const days = Number(value);
  if (!Number.isFinite(days)) return MAX_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(1, Math.trunc(days)));
}

export function dayStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function keepFromStamp(date = new Date(), retentionDays = MAX_RETENTION_DAYS) {
  const days = clampLogRetentionDays(retentionDays);
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return dayStamp(start);
}

export function redactPath(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '/'), 'http://localhost');
    for (const key of [...parsed.searchParams.keys()]) {
      if (/token|password|secret|code|authorization|invite/i.test(key)) {
        parsed.searchParams.set(key, '[redacted]');
      }
    }
    return parsed.pathname + parsed.search;
  } catch {
    return String(rawUrl || '/').split('?')[0] || '/';
  }
}

export function logLine(fields = {}) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }));
}

export function createLogger({ logDir, retentionDays = MAX_RETENTION_DAYS, writeConsole = true } = {}) {
  const days = clampLogRetentionDays(retentionDays);
  const directory = path.resolve(logDir || path.join(process.cwd(), 'data', 'logs'));
  let lastPrune = 0;
  let queue = Promise.resolve();

  function enqueue(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  async function pruneNow(now = new Date()) {
    lastPrune = Date.now();
    await mkdir(directory, { recursive: true });
    const keepFrom = keepFromStamp(now, days);
    const names = await readdir(directory).catch(() => []);
    await Promise.all(names.map(async (name) => {
      const match = name.match(/^(\d{4}-\d{2}-\d{2})\.log$/);
      if (!match || match[1] >= keepFrom) return;
      await unlink(path.join(directory, name)).catch(() => {});
    }));
  }

  function prune(now = new Date(), { force = false } = {}) {
    if (!force && Date.now() - lastPrune < PRUNE_INTERVAL_MS) return Promise.resolve();
    return enqueue(() => pruneNow(now));
  }

  function write(fields = {}) {
    const record = { time: new Date().toISOString(), ...fields };
    const line = JSON.stringify(record);
    if (writeConsole) {
      if (record.level === 'error') console.error(line);
      else console.log(line);
    }
    return enqueue(async () => {
      await mkdir(directory, { recursive: true });
      await appendFile(path.join(directory, `${dayStamp()}.log`), `${line}\n`, 'utf8');
      if (Date.now() - lastPrune >= PRUNE_INTERVAL_MS) await pruneNow();
    });
  }

  return {
    logDir: directory,
    retentionDays: days,
    write,
    info(message, extra = {}) {
      return write({ level: 'info', message, ...extra });
    },
    error(message, extra = {}) {
      return write({ level: 'error', message, ...extra });
    },
    prune(now) {
      return prune(now, { force: true });
    },
    flush() {
      return enqueue(async () => {});
    }
  };
}
