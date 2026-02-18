const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, STATES } = require('../lib/multiplayerState');

test('valid transitions are allowed', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.QUESTION_ACTIVE), true);
  assert.equal(canTransition(STATES.QUESTION_ACTIVE, STATES.COLLECT), true);
  assert.equal(canTransition(STATES.COLLECT, STATES.REVEAL), true);
  assert.equal(canTransition(STATES.REVEAL, STATES.LEADERBOARD), true);
});

test('invalid transitions are rejected', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.REVEAL), false);
  assert.equal(canTransition(STATES.GAME_END, STATES.REVEAL), false);
});
