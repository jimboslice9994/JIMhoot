const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, STATES } = require('../lib/multiplayerState');

test('valid transitions are allowed', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.QUESTION), true);
  assert.equal(canTransition(STATES.QUESTION, STATES.LOCK), true);
  assert.equal(canTransition(STATES.LOCK, STATES.REVEAL), true);
  assert.equal(canTransition(STATES.REVEAL, STATES.LEADERBOARD), true);
});

test('invalid transitions are rejected', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.REVEAL), false);
  assert.equal(canTransition(STATES.END, STATES.REVEAL), false);
});
