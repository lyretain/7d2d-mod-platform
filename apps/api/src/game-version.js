export function parseGameVersion(value) {
  const text = String(value || '').replace(/^v\s*/i, '').trim();
  const match = text.match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] || 0),
    patch: Number(match[3] || 0)
  };
}

export function compareGameVersion(left, right) {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}

export function isGenericGameVersion(value, range) {
  const spec = String(value || '').trim();
  return range === 'major' || /\+$/u.test(spec) || /\.x$/iu.test(spec);
}

export function normalizeGameVersionSpec(value) {
  return String(value || '').trim().replace(/\+$/u, '').replace(/\.x$/iu, '');
}

export function gameVersionMatches(declared, packGameVersion, range = 'exact') {
  const wanted = String(packGameVersion || '').trim();
  const list = Array.isArray(declared) ? declared.map((item) => String(item || '').trim()).filter(Boolean) : [];
  if (!list.length) return true;
  if (list.includes(wanted)) return true;
  const pack = parseGameVersion(wanted);
  if (!pack) return false;
  return list.some((item) => {
    const generic = isGenericGameVersion(item, range);
    const parsed = parseGameVersion(normalizeGameVersionSpec(item));
    if (!parsed) return item === wanted;
    if (!generic) return item === wanted;
    return pack.major === parsed.major && compareGameVersion(pack, parsed) >= 0;
  });
}
