export function normalizeAddress(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US');
}

export function parseAddresses(...inputs) {
  const out = [];
  const seen = new Set();
  const push = (item) => {
    const normalized = normalizeAddress(item);
    if (!normalized || normalized.length > 256) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  };
  for (const input of inputs) {
    if (input == null || input === '') continue;
    if (Array.isArray(input)) {
      for (const item of input) push(item);
      continue;
    }
    for (const item of String(input).split(/[\n,;]+/)) push(item);
  }
  return out;
}

export function serverAddresses(server) {
  if (!server) return [];
  return parseAddresses(server.publicAddresses, server.publicAddress);
}

export function applyAddresses(server, addresses, { replace = false } = {}) {
  const next = replace ? parseAddresses(addresses) : parseAddresses(serverAddresses(server), addresses);
  server.publicAddresses = next;
  server.publicAddress = next[0] || null;
  return next;
}

export function findServerById(snapshot, serverId) {
  const id = String(serverId || '').trim();
  return id ? snapshot.servers?.[id] || null : null;
}

export function findServersByAddress(snapshot, address) {
  const wanted = normalizeAddress(address);
  if (!wanted) return [];
  return Object.values(snapshot.servers || {}).filter((server) => serverAddresses(server).includes(wanted));
}

export function pickServerByAddress(snapshot, address) {
  const matches = findServersByAddress(snapshot, address);
  if (!matches.length) return null;
  return matches.sort((left, right) => Date.parse(right.lastSeenAt || 0) - Date.parse(left.lastSeenAt || 0))[0];
}

export function resolveRegisteredServer(snapshot, { serverId, address } = {}) {
  if (serverId) {
    const server = findServerById(snapshot, serverId);
    if (server) return server;
  }
  if (address) return pickServerByAddress(snapshot, address);
  return null;
}

export function publicAddressView(server) {
  const addresses = serverAddresses(server);
  return {
    publicAddresses: addresses,
    publicAddress: addresses[0] || null
  };
}
