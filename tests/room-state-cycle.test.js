const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, STATES } = require('../lib/multiplayerState');

test('room state machine supports full happy-path cycle', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.QUESTION), true);
  assert.equal(canTransition(STATES.QUESTION, STATES.LOCK), true);
  assert.equal(canTransition(STATES.LOCK, STATES.REVEAL), true);
  assert.equal(canTransition(STATES.REVEAL, STATES.LEADERBOARD), true);
  assert.equal(canTransition(STATES.LEADERBOARD, STATES.QUESTION), true);
  assert.equal(canTransition(STATES.LEADERBOARD, STATES.END), true);
});

test('room state machine rejects skip transitions', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.LEADERBOARD), false);
  assert.equal(canTransition(STATES.QUESTION, STATES.END), false);
  assert.equal(canTransition(STATES.LOCK, STATES.QUESTION), false);
});
