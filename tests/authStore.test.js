const test = require('node:test');
const assert = require('node:assert/strict');
const { createUser, authenticate, normalizeEmail, __internal } = require('../lib/authStore');

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  A@Example.COM '), 'a@example.com');
});

test('hash verify roundtrip', () => {
  const hashed = __internal.hashPassword('password123');
  assert.equal(__internal.verifyPassword('password123', hashed), true);
  assert.equal(__internal.verifyPassword('badpassword', hashed), false);
});

test('create and authenticate user', () => {
  const email = `user_${Date.now()}@example.com`;
  const user = createUser(email, 'password123');
  assert.ok(user.id.startsWith('user_'));
  const auth = authenticate(email, 'password123');
  assert.equal(auth.email, email.toLowerCase());
});
