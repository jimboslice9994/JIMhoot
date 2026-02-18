const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', '.data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }, null, 2), 'utf8');
  }
}

function readUsers() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    return Array.isArray(parsed.users) ? parsed.users : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  ensureStore();
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users }, null, 2), 'utf8');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 120000;
  const keylen = 32;
  const digest = 'sha256';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
  return `${iterations}$${digest}$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [iterStr, digest, salt, expected] = String(stored || '').split('$');
    const iterations = Number(iterStr);
    if (!iterations || !digest || !salt || !expected) return false;
    const computed = crypto.pbkdf2Sync(password, salt, iterations, expected.length / 2, digest).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

function findUserByEmail(email) {
  const target = normalizeEmail(email);
  return readUsers().find((u) => u.email === target) || null;
}

function createUser(email, password) {
  const normalized = normalizeEmail(email);
  if (!normalized || password.length < 8) {
    throw new Error('VALIDATION');
  }
  const users = readUsers();
  if (users.some((u) => u.email === normalized)) {
    throw new Error('DUPLICATE');
  }

  const user = {
    id: `user_${crypto.randomUUID()}`,
    email: normalized,
    passwordHash: hashPassword(password),
    createdAt: Date.now(),
  };
  users.push(user);
  writeUsers(users);
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

function authenticate(email, password) {
  const user = findUserByEmail(email);
  if (!user) return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

module.exports = {
  normalizeEmail,
  createUser,
  authenticate,
  findUserByEmail,
  __internal: {
    hashPassword,
    verifyPassword,
  },
};
