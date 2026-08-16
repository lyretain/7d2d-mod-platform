import assert from 'node:assert/strict';
import test from 'node:test';
import { gameVersionMatches, handshakeVersionsCompatible, parseGameVersion } from '../src/game-version.js';

test('parses 7DTD game versions with optional V prefix', () => {
  assert.deepEqual(parseGameVersion('V 3.10.14'), { major: 3, minor: 10, patch: 14 });
  assert.deepEqual(parseGameVersion('3.0.1-b4'), { major: 3, minor: 0, patch: 1 });
});

test('major-range mods cover the same major line from the declared floor', () => {
  assert.equal(gameVersionMatches(['3.0'], '3.0', 'major'), true);
  assert.equal(gameVersionMatches(['3.0'], '3.10.14', 'major'), true);
  assert.equal(gameVersionMatches(['3.0'], 'V 3.10.14', 'major'), true);
  assert.equal(gameVersionMatches(['3.0'], '2.6', 'major'), false);
  assert.equal(gameVersionMatches(['3.0'], '4.0', 'major'), false);
  assert.equal(gameVersionMatches(['3.10'], '3.9.0', 'major'), false);
  assert.equal(gameVersionMatches(['3.10'], '3.10.14', 'major'), true);
});

test('handshake treats the live 3.1.0 string as the same game as the mislabeled 3.10.14 pack', () => {
  assert.equal(handshakeVersionsCompatible('V 3.1.0', '3.10.14'), true);
  assert.equal(handshakeVersionsCompatible('3.1.0 (b14)', '3.10.14'), true);
  assert.equal(handshakeVersionsCompatible('V 3.1.0', '3.1.0'), true);
  assert.equal(handshakeVersionsCompatible('2.6', '3.10.14'), false);
});

test('exact game versions still require a full match', () => {
  assert.equal(gameVersionMatches(['3.10.14'], '3.10.14', 'exact'), true);
  assert.equal(gameVersionMatches(['3.10.14'], '3.10.15', 'exact'), false);
  assert.equal(gameVersionMatches(['3.0+'], '3.10.14', 'exact'), true);
  assert.equal(gameVersionMatches([], '3.10.14', 'exact'), true);
});
