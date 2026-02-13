const test = require('node:test');
const assert = require('node:assert/strict');
const { WS_EVENTS, STATES } = require('../lib/contracts');

test('ws contract includes required events', () => {
  const required = ['join_room', 'question', 'submit_answer', 'answer_ack', 'reveal', 'leaderboard_update', 'game_end', 'error'];
  required.forEach((evt) => assert.ok(WS_EVENTS.includes(evt)));
});

test('state contract includes key lifecycle states', () => {
  ['LOBBY', 'QUESTION_ACTIVE', 'COLLECT', 'REVEAL', 'LEADERBOARD', 'GAME_END'].forEach((st) => assert.ok(STATES.includes(st)));
});
