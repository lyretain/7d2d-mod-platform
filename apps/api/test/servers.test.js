import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAddresses, parseAddresses, resolveRegisteredServer } from '../src/servers.js';

test('parses mixed address lists and ignores blanks', () => {
  assert.deepEqual(parseAddresses('192.168.3.42:26900\nPlay.Example.com:26900', ['192.168.3.42:26900', '']), [
    '192.168.3.42:26900',
    'play.example.com:26900'
  ]);
});

test('resolve prefers serverId and otherwise the most recently seen address match', () => {
  const snapshot = {
    servers: {
      srv_old: { id: 'srv_old', publicAddress: '192.168.1.8:26900', lastSeenAt: '2026-01-01T00:00:00.000Z' },
      srv_new: { id: 'srv_new', publicAddresses: ['192.168.1.8:26900', '1.2.3.4:26900'], lastSeenAt: '2026-08-16T00:00:00.000Z' }
    }
  };
  assert.equal(resolveRegisteredServer(snapshot, { serverId: 'srv_old', address: '1.2.3.4:26900' }).id, 'srv_old');
  assert.equal(resolveRegisteredServer(snapshot, { address: '192.168.1.8:26900' }).id, 'srv_new');
  assert.equal(resolveRegisteredServer(snapshot, { address: '1.2.3.4:26900' }).id, 'srv_new');
});

test('applyAddresses can union observed IPs without dropping the WAN entry', () => {
  const server = { publicAddress: 'play.example.com:26900' };
  applyAddresses(server, ['192.168.3.42:26900'], { replace: false });
  assert.deepEqual(server.publicAddresses, ['play.example.com:26900', '192.168.3.42:26900']);
  applyAddresses(server, ['10.0.0.8:26900'], { replace: true });
  assert.deepEqual(server.publicAddresses, ['10.0.0.8:26900']);
});
