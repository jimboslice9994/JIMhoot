const test = require('node:test');
const assert = require('node:assert/strict');

async function importJoinModule() {
  return import('../public/scripts/multiplayerPlayer.js');
}

test('roomCodeFromHash parses join room query safely', async () => {
  const { roomCodeFromHash } = await importJoinModule();
  assert.equal(roomCodeFromHash('#/join?room=abcde'), 'ABCDE');
  assert.equal(roomCodeFromHash('#/join?room=A1B2C3D4'), 'ABCD');
  assert.equal(roomCodeFromHash('#/join'), '');
});
