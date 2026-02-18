const test = require('node:test');
const assert = require('node:assert/strict');

async function importLearning() {
  return import('../public/scripts/learning.js');
}

test('sm2Schedule increases interval for correct answers', async () => {
  const { sm2Schedule } = await importLearning();
  const first = sm2Schedule({}, 4, 0);
  const second = sm2Schedule(first, 4, 0);
  assert.equal(first.intervalDays, 1);
  assert.equal(second.intervalDays, 3);
  assert.ok(second.easeFactor >= 1.3);
});

test('sm2Schedule resets repetition for poor quality', async () => {
  const { sm2Schedule } = await importLearning();
  const prev = { repetition: 4, intervalDays: 15, easeFactor: 2.3 };
  const next = sm2Schedule(prev, 1, 0);
  assert.equal(next.repetition, 0);
  assert.equal(next.intervalDays, 1);
});

test('evaluateFillBlank supports exact, close and incorrect', async () => {
  const { evaluateFillBlank } = await importLearning();
  assert.deepEqual(evaluateFillBlank('Biology', 'biology'), { score: 1, status: 'exact' });
  const close = evaluateFillBlank('biologu', 'biology');
  assert.equal(close.status, 'close');
  const bad = evaluateFillBlank('chemistry', 'biology');
  assert.equal(bad.status, 'incorrect');
});
