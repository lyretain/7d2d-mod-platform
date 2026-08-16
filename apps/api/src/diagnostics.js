import { sha256 } from './util.js';

const REDACTIONS = [
  [/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]'],
  [/(password|token|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]'],
  [/[A-Z]:\\Users\\[^\\\s]+/gi, '[USER_HOME]'],
  [/\/home\/[^\/\s]+/g, '[USER_HOME]'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]'],
  [/\b(?:steam|eos)[_-]?id\s*[:=]\s*[A-Za-z0-9_-]+/gi, 'player_id=[REDACTED]']
];

export function redact(value) {
  let result = String(value ?? '');
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement);
  return result.slice(0, 128 * 1024);
}

export function normalizeStack(value) {
  return redact(value)
    .replace(/0x[0-9a-f]+/gi, '0xADDR')
    .replace(/:\d+(?=\)?$)/gm, ':LINE')
    .replace(/\b\d{4}-\d{2}-\d{2}T\S+/g, '[TIME]')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('\n');
}

export function prepareDiagnostic(input) {
  const normalizedStack = normalizeStack(input.stackTrace);
  const fingerprintSource = [input.gameVersion, input.exceptionType, normalizedStack, input.packId, input.packVersion].join('|');
  return {
    ...input,
    message: redact(input.message).slice(0, 4096),
    stackTrace: redact(input.stackTrace),
    logExcerpt: redact(input.logExcerpt),
    fingerprint: sha256(fingerprintSource)
  };
}
