import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateHello, handshakePolicy, releaseDiff, PROTOCOL_VERSION } from '../src/protocol.js';

test('handshake accepts a matching hello and rejects spoofed hashes', () => {
  const snapshot = {
    settings: { distributionPaused: false },
    releases: {
      rel_1: {
        id: 'rel_1',
        packVersion: 2,
        revokedAt: null,
        manifest: {
          packVersion: 2,
          gameVersion: '3.10.14',
          signing: { keyId: 'abc' },
          mods: [{ sha256: 'aa' }, { sha256: 'bb' }]
        }
      }
    },
    packs: { prod: { id: 'prod', latestReleaseId: 'rel_1', gameVersion: '3.10.14' } }
  };
  const policy = handshakePolicy(snapshot, snapshot.packs.prod, { keyId: 'abc' }, { publicBaseUrl: 'http://mods.example' });
  const hello = {
    protocolVersion: PROTOCOL_VERSION,
    packId: 'prod',
    packVersion: 2,
    gameVersion: '3.10.14',
    keyId: 'abc',
    artifactFingerprint: 'aa,bb'
  };
  assert.equal(evaluateHello(hello, policy).ok, true);
  assert.equal(evaluateHello({ ...hello, gameVersion: 'V 3.1.0' }, policy).ok, true);
  assert.equal(evaluateHello({ ...hello, gameVersion: '3.1.0 (b14)' }, policy).ok, true);
  assert.equal(evaluateHello({ ...hello, gameVersion: '2.6' }, policy).reason, 'GAME_VERSION');
  assert.equal(evaluateHello({ ...hello, artifactFingerprint: 'cc' }, policy).reason, 'PACK_MISMATCH');
  assert.equal(evaluateHello({ ...hello, packVersion: 1 }, policy).reason, 'PACK_MISMATCH');
  snapshot.settings.distributionPaused = true;
  assert.equal(evaluateHello(hello, handshakePolicy(snapshot, snapshot.packs.prod, { keyId: 'abc' })).reason, 'DISTRIBUTION_PAUSED');
});

test('handshake fingerprint ignores server-only and client-only mods', () => {
  const snapshot = {
    settings: { distributionPaused: false },
    releases: {
      rel_1: {
        id: 'rel_1',
        packVersion: 1,
        revokedAt: null,
        manifest: {
          packVersion: 1,
          gameVersion: '3.10.14',
          signing: { keyId: 'abc' },
          mods: [
            { sha256: 'aa', installSide: 'both' },
            { sha256: 'bb', installSide: 'server' },
            { sha256: 'cc', installSide: 'client' }
          ]
        }
      }
    },
    packs: { prod: { id: 'prod', latestReleaseId: 'rel_1', gameVersion: '3.10.14' } }
  };
  const policy = handshakePolicy(snapshot, snapshot.packs.prod, { keyId: 'abc' });
  assert.equal(policy.artifactFingerprint, 'aa');
});

test('release diff lists added removed and changed mods', () => {
  const diff = releaseDiff(
    { mods: [{ id: 'a', version: '1', sha256: '1' }, { id: 'b', version: '1', sha256: '2' }] },
    { mods: [{ id: 'a', version: '2', sha256: '9' }, { id: 'c', version: '1', sha256: '3' }] }
  );
  assert.deepEqual(diff.added, ['c@1']);
  assert.deepEqual(diff.removed, ['b@1']);
  assert.deepEqual(diff.changed, ['a@1->2']);
});
