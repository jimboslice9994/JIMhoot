const test = require('node:test');
const assert = require('node:assert/strict');
const { canTransition, STATES } = require('../lib/multiplayerState');

test('room state machine supports full happy-path cycle', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.QUESTION_ACTIVE), true);
  assert.equal(canTransition(STATES.QUESTION_ACTIVE, STATES.COLLECT), true);
  assert.equal(canTransition(STATES.COLLECT, STATES.REVEAL), true);
  assert.equal(canTransition(STATES.REVEAL, STATES.LEADERBOARD), true);
  assert.equal(canTransition(STATES.LEADERBOARD, STATES.QUESTION_ACTIVE), true);
  assert.equal(canTransition(STATES.LEADERBOARD, STATES.GAME_END), true);
});

test('room state machine rejects skip transitions', () => {
  assert.equal(canTransition(STATES.LOBBY, STATES.LEADERBOARD), false);
  assert.equal(canTransition(STATES.QUESTION_ACTIVE, STATES.GAME_END), false);
  assert.equal(canTransition(STATES.COLLECT, STATES.QUESTION_ACTIVE), false);
});
