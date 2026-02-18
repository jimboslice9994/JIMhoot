const test = require('node:test');
const assert = require('node:assert/strict');
const { createMetricsTracker } = require('../lib/metrics');

test('metrics tracker records ws events and durations', () => {
  const m = createMetricsTracker();
  m.observeWsMessage('join_room');
  m.observeWsMessage('join_room');
  m.observeWsMessage('submit_answer');
  m.observeWsHandle(1.25);
  m.observeWsHandle(2.5);

  const snap = m.snapshot({ rooms: { active: 1 } });
  assert.equal(snap.websocket.messageCountByEvent.join_room, 2);
  assert.equal(snap.websocket.messageCountByEvent.submit_answer, 1);
  assert.equal(snap.rooms.active, 1);
  assert.equal(typeof snap.eventLoop.lagP95Ms, 'number');
  assert.equal(typeof snap.process.rssBytes, 'number');
  assert.ok(snap.websocket.sampleSize >= 2);
});
