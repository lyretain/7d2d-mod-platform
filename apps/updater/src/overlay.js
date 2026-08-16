export function remapOverlayEntry(entryName, slotPath, installRoots = []) {
  const parts = String(entryName || '').replaceAll('\\', '/').split('/').filter(Boolean);
  if (!parts.length) return null;
  const slot = String(slotPath || '').toLocaleLowerCase('en-US');
  const roots = new Set((installRoots || []).map((item) => String(item).toLocaleLowerCase('en-US')));
  if (parts.length > 1 && roots.has(parts[0].toLocaleLowerCase('en-US'))) parts.shift();
  if (parts.length && parts[0].toLocaleLowerCase('en-US') === slot) parts.shift();
  return parts.join('/') || null;
}

export function overlayKey(overlays = []) {
  return (overlays || []).map((item) => `${item.id}:${item.sha256 || ''}`).sort().join('|');
}

export function manifestArtifacts(mod) {
  const items = [];
  if (mod?.sha256) items.push({ id: mod.id, sha256: mod.sha256, size: mod.size, url: mod.url });
  for (const overlay of mod?.overlays || []) {
    if (overlay?.sha256) items.push({ id: `${mod.id}:${overlay.id}`, sha256: overlay.sha256, size: overlay.size, url: overlay.url });
  }
  return items;
}
