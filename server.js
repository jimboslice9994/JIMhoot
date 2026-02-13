const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { getServerFeatureFlags } = require('./lib/featureFlags');
const { canTransition } = require('./lib/multiplayerState');
const { WS_EVENTS, STATES: CONTRACT_STATES } = require('./lib/contracts');
const { createUser, authenticate } = require('./lib/authStore');
const { createMetricsTracker } = require('./lib/metrics');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const HEARTBEAT_MS = 15000;
const HOST_REJOIN_GRACE_MS = 60000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const MAX_PLAYERS_PER_ROOM = 20;
const MAX_MESSAGE_BYTES = 32 * 1024;
const FEATURE_FLAGS = getServerFeatureFlags();

const PHASE_MS = {
  QUESTION_ACTIVE: 10000,
  COLLECT: 1000,
  REVEAL: 3000,
  LEADERBOARD: 3000,
};

const RATE_LIMIT = {
  join_room: { limit: 6, windowMs: 10000 },
  submit_answer: { limit: 20, windowMs: 10000 },
  ws_message: { limit: 80, windowMs: 10000 },
  api_global: { limit: 120, windowMs: 60000 },
  auth_register: { limit: 5, windowMs: 60000 },
  auth_login: { limit: 10, windowMs: 60000 },
};

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CSRF_TTL_MS = 24 * 60 * 60 * 1000;
const TRUSTED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const rooms = new Map();
const connBySocket = new Map();
const socketMeta = new Map();
const deckCatalog = loadDeckCatalog();
const sessions = new Map();
const csrfTokens = new Map();
const metrics = createMetricsTracker();
let isShuttingDown = false;

function log(type, payload = {}, ctx = {}) {
  console.log(JSON.stringify({ ts: Date.now(), type, eventType: type, ...ctx, ...payload }));
}

function loadDeckCatalog() {
  try {
    const file = path.join(PUBLIC_DIR, 'data', 'decks.json');
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const map = new Map();

    for (const deck of data.decks || []) {
      const quizItems = [];
      if (deck?.modes?.quiz?.length) {
        for (const item of deck.modes.quiz) {
          const correct = String(item.correctChoice || item.correct || '').toUpperCase();
          if (!item.question || !item.choices?.A || !item.choices?.B || !item.choices?.C || !item.choices?.D || !['A', 'B', 'C', 'D'].includes(correct)) continue;
          quizItems.push({
            id: item.id || makeId('q'),
            question: String(item.question).trim(),
            choices: item.choices,
            correct,
            explanation: String(item.explanation || ''),
            timeLimitSec: Math.max(5, Math.min(120, Number(item.timeLimitSec) || 10)),
          });
        }
      } else if (deck.type === 'mcq' && Array.isArray(deck.items)) {
        for (const item of deck.items) {
          const correct = String(item.correct || '').toUpperCase();
          if (!item.question || !item.choices?.A || !item.choices?.B || !item.choices?.C || !item.choices?.D || !['A', 'B', 'C', 'D'].includes(correct)) continue;
          quizItems.push({
            id: item.id || makeId('q'),
            question: String(item.question).trim(),
            choices: item.choices,
            correct,
            explanation: String(item.explanation || ''),
            timeLimitSec: Math.max(5, Math.min(120, Number(item.timeLimitSec) || 10)),
          });
        }
      }

      if (quizItems.length) {
        map.set(deck.id, {
          id: deck.id,
          title: deck.title || 'Untitled deck',
          type: 'mcq',
          items: quizItems,
        });
      }
    }

    log('deck_catalog_loaded', { count: map.size });
    return map;
  } catch (err) {
    log('deck_catalog_error', { message: err.message });
    return new Map();
  }
}

function sanitizeRoomCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);
}

function sanitizeNickname(raw) {
  const safe = String(raw || '').replace(/[^\w\- ]/g, '').trim();
  return safe.slice(0, 20);
}

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}


function makeRequestId() {
  return `req_${crypto.randomUUID()}`;
}

function makeReconnectKey() {
  return crypto.randomBytes(18).toString('hex');
}

function safeSend(ws, event, payload) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ event, payload, ts: Date.now() }));
}

function sendRaw(ws, rawMessage) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  ws.send(rawMessage);
}

function broadcast(room, event, payload) {
  const msg = JSON.stringify({ event, payload, ts: Date.now() });
  room.players.forEach((p) => {
    if (!p.ws || p.ws.readyState !== p.ws.OPEN) return;
    sendRaw(p.ws, msg);
  });
  return Buffer.byteLength(msg);
}

function parseCookies(cookieHeader) {
  const out = {};
  String(cookieHeader || '').split(';').forEach((part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k) return;
    out[k] = decodeURIComponent(rest.join('='));
  });
  return out;
}

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_MESSAGE_BYTES) reject(new Error('TOO_LARGE'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function createSession(user) {
  const sid = crypto.randomUUID();
  sessions.set(sid, { user, createdAt: Date.now(), lastSeenAt: Date.now() });
  return sid;
}

function clearSession(sid) {
  if (!sid) return;
  sessions.delete(sid);
  csrfTokens.delete(sid);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.trim()) {
    return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function setSecurityHeaders(req, res) {
  const nonce = crypto.randomBytes(16).toString('base64');
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return nonce;
}

function cookieAttrs(req, maxAgeSec) {
  const secure = req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').toLowerCase() === 'https';
  const attrs = ['HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (secure) attrs.push('Secure');
  if (Number.isFinite(maxAgeSec)) attrs.push(`Max-Age=${maxAgeSec}`);
  return attrs.join('; ');
}

function issueCsrfToken(sid) {
  const token = crypto.randomBytes(24).toString('hex');
  csrfTokens.set(sid, { token, createdAt: Date.now() });
  return token;
}

function getSessionFromReq(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sid = cookies.sid;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(sid);
    csrfTokens.delete(sid);
    return null;
  }
  session.lastSeenAt = Date.now();
  return { sid, ...session };
}

function rotateSession(req, oldSid, user) {
  if (oldSid) {
    sessions.delete(oldSid);
    csrfTokens.delete(oldSid);
  }
  const sid = createSession(user);
  const csrfToken = issueCsrfToken(sid);
  return {
    sid,
    csrfToken,
    sessionCookie: `sid=${sid}; ${cookieAttrs(req, Math.floor(SESSION_TTL_MS / 1000))}`,
    csrfCookie: `csrf=${csrfToken}; ${cookieAttrs(req, Math.floor(CSRF_TTL_MS / 1000)).replace('HttpOnly; ', '')}`,
  };
}

function isAllowedOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  if (TRUSTED_ORIGINS.length === 0) return true;
  return TRUSTED_ORIGINS.includes(origin);
}

function enforceCsrf(req) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (origin && !isAllowedOrigin(req)) return false;
  const session = getSessionFromReq(req);
  if (!session) return false;
  const expected = csrfTokens.get(session.sid)?.token;
  const provided = String(req.headers['x-csrf-token'] || '');
  if (!expected || !provided || expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

function trimBucketInPlace(bucket, now, windowMs) {
  let drop = 0;
  while (drop < bucket.length && now - bucket[drop] >= windowMs) drop += 1;
  if (drop > 0) bucket.splice(0, drop);
}

function allowHttpRate(req, key) {
  const ip = clientIp(req);
  const bucketKey = `http:${ip}`;
  const meta = socketMeta.get(bucketKey) || { rates: {} };
  const rule = RATE_LIMIT[key];
  const now = Date.now();
  const bucket = meta.rates[key] || [];
  trimBucketInPlace(bucket, now, rule.windowMs);
  if (bucket.length >= rule.limit) return false;
  bucket.push(now);
  meta.rates[key] = bucket;
  socketMeta.set(bucketKey, meta);
  return true;
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function validateAuthPayload(body) {
  const email = String(body?.email || '').trim();
  const password = String(body?.password || '');
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) return { ok: false, reason: 'Invalid email' };
  if (password.length < 8 || password.length > 128) return { ok: false, reason: 'Password must be 8-128 chars' };
  return { ok: true, email, password };
}

function validateWsPayload(event, payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, reason: 'Payload required' };
  if (['join_room', 'rejoin_room', 'start_game', 'submit_answer', 'next_question'].includes(event)) {
    if (typeof payload.playerId !== 'string' || !payload.playerId.trim()) return { ok: false, reason: 'Invalid playerId' };
  }
  if (event === 'rejoin_room') {
    if (typeof payload.reconnectKey !== 'string' || payload.reconnectKey.length < 10) return { ok: false, reason: 'Invalid reconnect token' };
  }
  if (event === 'join_room') {
    if (!['host', 'player'].includes(payload.role)) return { ok: false, reason: 'Invalid role' };
    if (payload.role === 'player' && !sanitizeRoomCode(payload.roomCode)) return { ok: false, reason: 'Invalid room code' };
  }
  if (event === 'submit_answer' && !['A', 'B', 'C', 'D'].includes(String(payload.choice || '').toUpperCase())) {
    return { ok: false, reason: 'Invalid answer choice' };
  }
  return { ok: true };
}

function createHttpError(code, message) {
  const err = new Error(message);
  err.statusCode = code;
  return err;
}

function maybeRequireCsrf(req, required) {
  if (!required) return true;
  return enforceCsrf(req);
}

function createRoom(hostPlayer, deck, settings = {}) {
  let roomCode = makeCode();
  while (rooms.has(roomCode)) roomCode = makeCode();

  const room = {
    code: roomCode,
    state: 'LOBBY',
    hostPlayerId: hostPlayer.playerId,
    players: new Map([[hostPlayer.playerId, hostPlayer]]),
    deck,
    questionIndex: -1,
    currentQuestion: null,
    hostGraceTimer: null,
    phaseTimer: null,
    createdAt: Date.now(),
    lastActivityTs: Date.now(),
    reconnectCount: 0,
    settings: {
      gameMode: settings.gameMode || 'classic',
      timerSec: Math.max(5, Math.min(120, Number(settings.timerSec) || 10)),
    },
  };
  rooms.set(roomCode, room);
  return room;
}

function touchRoom(room) {
  room.lastActivityTs = Date.now();
}

function playerPublic(player) {
  return {
    playerId: player.playerId,
    nickname: player.nickname,
    connected: Boolean(player.ws && player.ws.readyState === player.ws.OPEN),
    score: player.score,
    role: player.role,
  };
}

function lobbyPayload(room) {
  const host = room.players.get(room.hostPlayerId);
  return {
    roomCode: room.code,
    state: room.state,
    host: host ? { playerId: host.playerId, nickname: host.nickname } : null,
    players: [...room.players.values()].map(playerPublic),
    deck: room.deck ? { id: room.deck.id, title: room.deck.title, count: room.deck.items.length } : null,
    settings: room.settings,
  };
}

function emitError(ws, code, message, details = {}) {
  safeSend(ws, 'error', { code, message, details });
}

function canHandleState(state, event) {
  const map = {
    LOBBY: new Set(['join_room', 'rejoin_room', 'start_game']),
    QUESTION_ACTIVE: new Set(['submit_answer', 'rejoin_room']),
    COLLECT: new Set(['rejoin_room', 'next_question']),
    REVEAL: new Set(['rejoin_room', 'next_question']),
    LEADERBOARD: new Set(['rejoin_room', 'next_question']),
    PAUSED_HOST_DISCONNECTED: new Set(['rejoin_room', 'join_room']),
    GAME_END: new Set(['rejoin_room', 'start_game']),
  };
  return map[state]?.has(event);
}

function canProgressRoomState(room, nextState) {
  const from = room.state === 'QUESTION_ACTIVE' ? 'QUESTION'
    : room.state === 'COLLECT' ? 'LOCK'
      : room.state;
  const to = nextState === 'QUESTION_ACTIVE' ? 'QUESTION'
    : nextState === 'COLLECT' ? 'LOCK'
      : nextState;
  return canTransition(from, to);
}

function roomFromCodeOrError(ws, roomCodeRaw) {
  const roomCode = sanitizeRoomCode(roomCodeRaw);
  const room = rooms.get(roomCode);
  if (!room) {
    emitError(ws, 'ROOM_NOT_FOUND', 'Room not found');
    return null;
  }
  return room;
}

function normalizeDeckFromId(deckId) {
  const id = String(deckId || '').trim();
  if (!id) return null;
  return deckCatalog.get(id) || null;
}


function normalizeImportedQuizDeck(rawDeck, fallbackDeckId = '') {
  if (!rawDeck || typeof rawDeck !== 'object') return null;
  const deckId = String(rawDeck.id || fallbackDeckId || '').trim();
  const title = String(rawDeck.title || '').trim() || 'Imported Quiz Deck';
  const sourceQuiz = Array.isArray(rawDeck?.modes?.quiz) ? rawDeck.modes.quiz : [];
  if (!deckId || !sourceQuiz.length) return null;

  const items = [];
  for (const item of sourceQuiz) {
    const question = String(item?.question || '').trim();
    const choices = item?.choices || {};
    const correct = String(item?.correctChoice || item?.correct || '').toUpperCase().trim();
    if (!question || !choices.A || !choices.B || !choices.C || !choices.D) continue;
    if (!['A', 'B', 'C', 'D'].includes(correct)) continue;

    items.push({
      id: String(item.id || makeId('q')).slice(0, 80),
      question: question.slice(0, 500),
      choices: {
        A: String(choices.A).slice(0, 240),
        B: String(choices.B).slice(0, 240),
        C: String(choices.C).slice(0, 240),
        D: String(choices.D).slice(0, 240),
      },
      correct,
      explanation: String(item?.explanation || '').slice(0, 500),
      timeLimitSec: Math.max(5, Math.min(120, Number(item?.timeLimitSec) || 10)),
    });

    if (items.length >= 120) break;
  }

  if (!items.length) return null;
  return {
    id: deckId.slice(0, 80),
    title: title.slice(0, 120),
    type: 'mcq',
    items,
  };
}

function clearRoomTimers(room) {
  clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
}

function startQuestion(room) {
  clearRoomTimers(room);
  room.questionIndex += 1;
  touchRoom(room);

  if (room.questionIndex >= room.deck.items.length) {
    room.state = 'GAME_END';
    const finalRankings = [...room.players.values()]
      .filter((p) => p.role === 'player' || p.role === 'host')
      .sort((a, b) => b.score - a.score)
      .map((p, idx) => ({ rank: idx + 1, playerId: p.playerId, nickname: p.nickname, score: p.score }));
    broadcast(room, 'game_end', { roomCode: room.code, finalRankings, endedTs: Date.now() });
    return;
  }

  const q = room.deck.items[room.questionIndex];
  if (!canProgressRoomState(room, 'QUESTION_ACTIVE') && room.state !== 'LOBBY' && room.state !== 'LEADERBOARD') return;
  room.state = 'QUESTION_ACTIVE';
  room.currentQuestion = {
    questionInstanceId: makeId('qinst'),
    questionId: q.id,
    prompt: q.question,
    choices: q.choices,
    correct: q.correct,
    explanation: q.explanation,
    serverStartTs: Date.now(),
    timeLimitMs: Math.max(5000, Math.min(120000, ((room.settings?.timerSec || q.timeLimitSec || 10) * 1000))),
    submissions: new Map(),
    firstAnswerTs: null,
    lastAnswerTs: null,
  };

  const payload = {
    roomCode: room.code,
    index: room.questionIndex,
    total: room.deck.items.length,
    questionInstanceId: room.currentQuestion.questionInstanceId,
    questionId: room.currentQuestion.questionId,
    prompt: room.currentQuestion.prompt,
    choices: room.currentQuestion.choices,
    serverStartTs: room.currentQuestion.serverStartTs,
    serverNow: Date.now(),
    timeLimitMs: room.currentQuestion.timeLimitMs,
  };
  broadcast(room, 'question', payload);

  room.phaseTimer = setTimeout(() => {
    moveToCollect(room);
  }, room.currentQuestion.timeLimitMs);
}

function scoreAnswer(isCorrect, elapsedMs, timeLimitMs) {
  if (!isCorrect) return 0;
  const basePoints = 500;
  const clamped = Math.min(Math.max(elapsedMs, 0), timeLimitMs);
  const speedRatio = 1 - (clamped / timeLimitMs);
  const speedBonus = Math.round(500 * speedRatio);
  return basePoints + speedBonus;
}

function moveToCollect(room) {
  if (!room.currentQuestion || room.state !== 'QUESTION_ACTIVE') return;
  if (!canProgressRoomState(room, 'COLLECT')) return;
  room.state = 'COLLECT';
  touchRoom(room);
  broadcast(room, 'phase_update', { roomCode: room.code, state: room.state, durationMs: PHASE_MS.COLLECT, serverNow: Date.now() });
  room.phaseTimer = setTimeout(() => moveToReveal(room), PHASE_MS.COLLECT);
}

function moveToReveal(room) {
  if (!room.currentQuestion || !['COLLECT', 'QUESTION_ACTIVE'].includes(room.state)) return;
  if (!canProgressRoomState(room, 'REVEAL')) return;
  room.state = 'REVEAL';
  touchRoom(room);

  const results = [];
  room.players.forEach((player) => {
    const sub = room.currentQuestion.submissions.get(player.playerId);
    if (!sub) return;
    const isCorrect = sub.choice === room.currentQuestion.correct;
    const pointsAwarded = scoreAnswer(isCorrect, sub.receivedTs - room.currentQuestion.serverStartTs, room.currentQuestion.timeLimitMs);
    player.score += pointsAwarded;
    results.push({
      playerId: player.playerId,
      choice: sub.choice,
      correct: isCorrect,
      pointsAwarded,
      totalScore: player.score,
    });
  });

  const revealPayload = {
    roomCode: room.code,
    questionInstanceId: room.currentQuestion.questionInstanceId,
    correct: room.currentQuestion.correct,
    explanation: room.currentQuestion.explanation,
    firstAnswerTs: room.currentQuestion.firstAnswerTs,
    lastAnswerTs: room.currentQuestion.lastAnswerTs,
    acceptedAnswers: room.currentQuestion.submissions.size,
    results,
  };
  const revealBytes = broadcast(room, 'reveal', revealPayload);

  log('reveal_metrics', {
    roomCode: room.code,
    payloadBytes: revealBytes,
    submissions: room.currentQuestion.submissions.size,
    firstAnswerTs: room.currentQuestion.firstAnswerTs,
    lastAnswerTs: room.currentQuestion.lastAnswerTs,
  }, { roomId: room.code });

  room.phaseTimer = setTimeout(() => moveToLeaderboard(room), PHASE_MS.REVEAL);
}

function moveToLeaderboard(room) {
  if (!room.currentQuestion || room.state !== 'REVEAL') return;
  if (!canProgressRoomState(room, 'LEADERBOARD')) return;
  room.state = 'LEADERBOARD';
  touchRoom(room);

  const rankings = [...room.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({ rank: idx + 1, playerId: p.playerId, nickname: p.nickname, score: p.score }));

  const payload = {
    roomCode: room.code,
    rankings,
    isFinal: room.questionIndex === room.deck.items.length - 1,
    durationMs: PHASE_MS.LEADERBOARD,
  };
  const leaderboardBytes = broadcast(room, 'leaderboard_update', payload);
  log('leaderboard_metrics', { roomCode: room.code, payloadBytes: leaderboardBytes }, { roomId: room.code });

  room.phaseTimer = setTimeout(() => startQuestion(room), PHASE_MS.LEADERBOARD);
}

function attachPlayerToSocket(player, ws, roomCode) {
  player.ws = ws;
  player.roomCode = roomCode;
  ws.isAlive = true;
  connBySocket.set(ws, { roomCode, playerId: player.playerId });
  safeSend(ws, 'session_info', {
    roomCode,
    playerId: player.playerId,
    reconnectKey: player.reconnectKey,
  });
}

function socketOwnsPlayer(ws, roomCodeRaw, playerIdRaw) {
  const conn = connBySocket.get(ws);
  if (!conn) return false;
  const roomCode = sanitizeRoomCode(roomCodeRaw);
  const playerId = String(playerIdRaw || '').trim();
  return Boolean(roomCode && playerId && conn.roomCode === roomCode && conn.playerId === playerId);
}

function allowRate(ws, eventName) {
  const policy = RATE_LIMIT[eventName];
  if (!policy) return true;

  const meta = socketMeta.get(ws) || { rates: {}, connectedAt: Date.now() };
  socketMeta.set(ws, meta);
  const now = Date.now();
  const bucket = meta.rates[eventName] || [];
  trimBucketInPlace(bucket, now, policy.windowMs);
  if (bucket.length >= policy.limit) return false;
  bucket.push(now);
  meta.rates[eventName] = bucket;
  return true;
}

function handleJoin(ws, payload) {
  if (!FEATURE_FLAGS.multiplayer) return emitError(ws, 'FEATURE_DISABLED', 'Multiplayer is disabled by feature flag');
  if (!allowRate(ws, 'join_room')) {
    return emitError(ws, 'RATE_LIMITED', 'Too many join attempts; please wait.');
  }

  const role = payload.role === 'host' ? 'host' : 'player';
  const playerId = String(payload.playerId || makeId('player'));
  const nickname = sanitizeNickname(payload.nickname || (role === 'host' ? 'Host' : 'Player'));
  if (!nickname) return emitError(ws, 'VALIDATION_ERROR', 'Nickname required');

  if (role === 'host') {
    let deck = normalizeDeckFromId(payload.deckId);
    if (!deck) {
      deck = normalizeImportedQuizDeck(payload.importedDeck, payload.deckId);
    }
    if (!deck) return emitError(ws, 'VALIDATION_ERROR', 'Host must provide valid quiz deck');

    const hostPlayer = { playerId, nickname, role: 'host', score: 0, ws, connectedAt: Date.now(), reconnectKey: makeReconnectKey() };
    const room = createRoom(hostPlayer, deck, { gameMode: payload.gameMode, timerSec: payload.timerSec });
    attachPlayerToSocket(hostPlayer, ws, room.code);
    log('room_created', { roomCode: room.code, host: hostPlayer.playerId, deckId: deck.id, gameMode: room.settings.gameMode, timerSec: room.settings.timerSec }, { roomId: room.code });
    broadcast(room, 'lobby_state', lobbyPayload(room));
    return;
  }

  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  touchRoom(room);

  if (!canHandleState(room.state, 'join_room')) return emitError(ws, 'INVALID_STATE', 'Cannot join right now');
  if (room.players.size >= MAX_PLAYERS_PER_ROOM) return emitError(ws, 'ROOM_FULL', 'Room is full');

  const duplicateNick = [...room.players.values()].find((p) => p.nickname.toLowerCase() === nickname.toLowerCase() && p.playerId !== playerId);
  if (duplicateNick) return emitError(ws, 'NICKNAME_TAKEN', 'Nickname already taken');

  let player = room.players.get(playerId);
  if (!player) {
    player = { playerId, nickname, role: 'player', score: 0, ws, connectedAt: Date.now(), reconnectKey: makeReconnectKey() };
    room.players.set(playerId, player);
  }
  player.nickname = nickname;
  attachPlayerToSocket(player, ws, room.code);
  broadcast(room, 'lobby_state', lobbyPayload(room));
}

function sendQuestionSnapshot(ws, room, playerId) {
  if (room.state !== 'QUESTION_ACTIVE' || !room.currentQuestion) return;
  const sub = room.currentQuestion.submissions.get(playerId);
  safeSend(ws, 'question', {
    roomCode: room.code,
    index: room.questionIndex,
    total: room.deck.items.length,
    questionInstanceId: room.currentQuestion.questionInstanceId,
    questionId: room.currentQuestion.questionId,
    prompt: room.currentQuestion.prompt,
    choices: room.currentQuestion.choices,
    serverStartTs: room.currentQuestion.serverStartTs,
    serverNow: Date.now(),
    timeLimitMs: room.currentQuestion.timeLimitMs,
    alreadySubmitted: Boolean(sub),
    submittedChoice: sub?.choice || null,
  });
}

function handleRejoin(ws, payload) {
  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  touchRoom(room);

  const playerId = String(payload.playerId || '');
  const player = room.players.get(playerId);
  if (!player) return emitError(ws, 'ROOM_NOT_FOUND', 'Player not found in room');

  const reconnectKey = String(payload.reconnectKey || '');
  if (!reconnectKey || reconnectKey !== player.reconnectKey) {
    return emitError(ws, 'UNAUTHORIZED', 'Invalid reconnect token');
  }

  if (payload.nickname) player.nickname = sanitizeNickname(payload.nickname) || player.nickname;
  attachPlayerToSocket(player, ws, room.code);
  room.reconnectCount += 1;

  if (room.state === 'PAUSED_HOST_DISCONNECTED' && player.playerId === room.hostPlayerId) {
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = null;
    room.state = room.currentQuestion ? 'QUESTION_ACTIVE' : 'LOBBY';
  }

  safeSend(ws, 'lobby_state', lobbyPayload(room));
  sendQuestionSnapshot(ws, room, playerId);
}

function handleStartGame(ws, payload) {
  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  touchRoom(room);

  if (!canHandleState(room.state, 'start_game')) return emitError(ws, 'INVALID_STATE', 'Cannot start game in this state');
  if (!socketOwnsPlayer(ws, payload.roomCode, payload.playerId)) return emitError(ws, 'UNAUTHORIZED', 'Socket is not bound to that player');
  if (payload.playerId !== room.hostPlayerId) return emitError(ws, 'NOT_HOST', 'Only host can start game');

  room.players.forEach((p) => { p.score = 0; });
  room.questionIndex = -1;
  startQuestion(room);
}

function handleSubmitAnswer(ws, payload) {
  if (!allowRate(ws, 'submit_answer')) {
    return safeSend(ws, 'answer_ack', {
      roomCode: sanitizeRoomCode(payload.roomCode),
      questionInstanceId: payload.questionInstanceId,
      status: 'rate_limited',
      receivedTs: Date.now(),
    });
  }

  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  touchRoom(room);

  if (!canHandleState(room.state, 'submit_answer')) return emitError(ws, 'INVALID_STATE', 'Not accepting answers');
  if (!room.currentQuestion) return emitError(ws, 'INVALID_STATE', 'No active question');

  const { playerId } = payload;
  if (!socketOwnsPlayer(ws, payload.roomCode, playerId)) {
    safeSend(ws, 'answer_ack', { roomCode: room.code, questionInstanceId: payload.questionInstanceId, status: 'unauthorized', receivedTs: Date.now() });
    return;
  }
  const player = room.players.get(playerId);
  if (!player) return emitError(ws, 'VALIDATION_ERROR', 'Unknown player');

  if (payload.questionInstanceId !== room.currentQuestion.questionInstanceId) {
    safeSend(ws, 'answer_ack', { roomCode: room.code, questionInstanceId: payload.questionInstanceId, status: 'invalid', receivedTs: Date.now() });
    return;
  }

  const now = Date.now();
  const deadline = room.currentQuestion.serverStartTs + room.currentQuestion.timeLimitMs;
  const choice = String(payload.choice || '').toUpperCase();
  if (!['A', 'B', 'C', 'D'].includes(choice)) {
    safeSend(ws, 'answer_ack', { roomCode: room.code, questionInstanceId: payload.questionInstanceId, status: 'invalid', receivedTs: now });
    return;
  }

  if (room.currentQuestion.submissions.has(playerId)) {
    safeSend(ws, 'answer_ack', { roomCode: room.code, questionInstanceId: payload.questionInstanceId, status: 'duplicate', receivedTs: now });
    return;
  }

  if (now > deadline) {
    safeSend(ws, 'answer_ack', { roomCode: room.code, questionInstanceId: payload.questionInstanceId, status: 'too_late', receivedTs: now });
    return;
  }

  room.currentQuestion.submissions.set(playerId, { choice, receivedTs: now });
  room.currentQuestion.firstAnswerTs = room.currentQuestion.firstAnswerTs || now;
  room.currentQuestion.lastAnswerTs = now;
  safeSend(ws, 'answer_ack', { roomCode: room.code, questionInstanceId: payload.questionInstanceId, status: 'accepted', receivedTs: now });
}

function handleNextQuestion(ws, payload) {
  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  touchRoom(room);

  if (!canHandleState(room.state, 'next_question')) return emitError(ws, 'INVALID_STATE', 'Cannot advance now');
  if (!socketOwnsPlayer(ws, payload.roomCode, payload.playerId)) return emitError(ws, 'UNAUTHORIZED', 'Socket is not bound to that player');
  if (payload.playerId !== room.hostPlayerId) return emitError(ws, 'NOT_HOST', 'Only host can advance');

  if (room.state === 'COLLECT') return moveToReveal(room);
  if (room.state === 'REVEAL') return moveToLeaderboard(room);
  return startQuestion(room);
}

function onClientMessage(ws, raw) {
  const started = process.hrtime.bigint();
  try {
    if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
      emitError(ws, 'MESSAGE_TOO_LARGE', 'Message too large');
      ws.close();
      return;
    }

    if (!allowRate(ws, 'ws_message')) {
      emitError(ws, 'RATE_LIMITED', 'Too many realtime messages');
      return;
    }

    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return emitError(ws, 'VALIDATION_ERROR', 'Invalid JSON');
    }
    const event = String(msg?.event || '');
    const payload = msg?.payload || {};
    if (!event) return emitError(ws, 'VALIDATION_ERROR', 'Missing event');
    const val = validateWsPayload(event, payload);
    if (!val.ok) return emitError(ws, 'VALIDATION_ERROR', val.reason);
    metrics.observeWsMessage(event);
    log('ws_event', { event }, { roomId: sanitizeRoomCode(payload.roomCode || '') || undefined });

    switch (event) {
      case 'join_room': return handleJoin(ws, payload);
      case 'rejoin_room': return handleRejoin(ws, payload);
      case 'start_game': return handleStartGame(ws, payload);
      case 'submit_answer': return handleSubmitAnswer(ws, payload);
      case 'next_question': return handleNextQuestion(ws, payload);
      case 'ping': return safeSend(ws, 'pong', { sentTs: payload?.sentTs || null, serverTs: Date.now() });
      default: return emitError(ws, 'VALIDATION_ERROR', 'Unknown event');
    }
  } finally {
    const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
    metrics.observeWsHandle(durationMs);
  }
}

function handleDisconnect(ws) {
  const conn = connBySocket.get(ws);
  connBySocket.delete(ws);
  socketMeta.delete(ws);
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!room) return;

  const player = room.players.get(conn.playerId);
  if (!player) return;
  player.ws = null;
  touchRoom(room);

  if (player.playerId === room.hostPlayerId && room.state !== 'LOBBY' && room.state !== 'GAME_END') {
    room.state = 'PAUSED_HOST_DISCONNECTED';
    broadcast(room, 'lobby_state', lobbyPayload(room));
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = setTimeout(() => {
      if (room.state === 'PAUSED_HOST_DISCONNECTED') {
        broadcast(room, 'error', { code: 'ROOM_CLOSED', message: 'Host did not return in time', details: {} });
        rooms.delete(room.code);
      }
    }, HOST_REJOIN_GRACE_MS);
  } else {
    broadcast(room, 'lobby_state', lobbyPayload(room));
  }
}

const server = http.createServer((req, res) => {
  req.requestId = makeRequestId();
  const startedAt = Date.now();
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(reqUrl.pathname);
  setSecurityHeaders(req, res);

  res.on('finish', () => {
    log('http_request', {
      method: req.method,
      path: pathname,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    }, { requestId: req.requestId });
  });

  (async () => {
    if (pathname === '/readyz' && (req.method === 'GET' || req.method === 'HEAD')) {
      const payload = {
        ok: !isShuttingDown,
        shuttingDown: isShuttingDown,
        uptimeSec: Math.floor(process.uptime()),
      };
      if (req.method === 'HEAD') {
        res.writeHead(payload.ok ? 200 : 503, { 'content-type': 'application/json' });
        res.end();
        return;
      }
      return sendJson(res, payload.ok ? 200 : 503, payload);
    }

    if (pathname === '/healthz' && (req.method === 'GET' || req.method === 'HEAD')) {
      const payload = {
        ok: true,
        rooms: rooms.size,
        wsClients: wss.clients.size,
        deckCatalog: deckCatalog.size,
        uptimeSec: Math.floor(process.uptime()),
        shuttingDown: isShuttingDown,
      };
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end();
        return;
      }
      return sendJson(res, 200, payload);
    }

    if (!allowHttpRate(req, 'api_global')) {
      return sendJson(res, 429, { error: 'Too many requests. Try again later.' });
    }

    if (pathname === '/metrics') {
      return sendJson(res, 200, metrics.snapshot({
        rooms: {
          active: rooms.size,
          players: [...rooms.values()].reduce((sum, room) => sum + room.players.size, 0),
        },
        sessions: {
          active: sessions.size,
          csrfTokens: csrfTokens.size,
        },
      }));
    }

    if (pathname === '/api/auth/csrf' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJson(res, 401, { error: 'Not authenticated' });
      const token = csrfTokens.get(session.sid)?.token || issueCsrfToken(session.sid);
      return sendJson(res, 200, { csrfToken: token });
    }

    if (pathname === '/api/auth/register' && req.method === 'POST') {
      if (!FEATURE_FLAGS.auth) return sendJson(res, 503, { error: 'Auth feature is disabled' });
      if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'Origin not allowed' });
      if (!allowHttpRate(req, 'auth_register')) return sendJson(res, 429, { error: 'Too many register attempts. Try later.' });

      const body = await jsonBody(req);
      const validated = validateAuthPayload(body);
      if (!validated.ok) throw createHttpError(400, validated.reason);
      const user = createUser(validated.email, validated.password);
      const existing = getSessionFromReq(req);
      const rotated = rotateSession(req, existing?.sid, user);
      res.writeHead(201, {
        'content-type': 'application/json',
        'set-cookie': [rotated.sessionCookie, rotated.csrfCookie],
      });
      res.end(JSON.stringify({ user, csrfToken: rotated.csrfToken }));
      return;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (!FEATURE_FLAGS.auth) return sendJson(res, 503, { error: 'Auth feature is disabled' });
      if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'Origin not allowed' });
      if (!allowHttpRate(req, 'auth_login')) return sendJson(res, 429, { error: 'Too many login attempts. Try later.' });

      const body = await jsonBody(req);
      const validated = validateAuthPayload(body);
      if (!validated.ok) throw createHttpError(400, validated.reason);
      const user = authenticate(validated.email, validated.password);
      if (!user) return sendJson(res, 401, { error: 'Invalid credentials.' });

      const existing = getSessionFromReq(req);
      const rotated = rotateSession(req, existing?.sid, user);
      res.writeHead(200, {
        'content-type': 'application/json',
        'set-cookie': [rotated.sessionCookie, rotated.csrfCookie],
      });
      res.end(JSON.stringify({ user, csrfToken: rotated.csrfToken }));
      return;
    }

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      const session = getSessionFromReq(req);
      if (!session) return sendJson(res, 401, { error: 'Not authenticated' });
      const token = csrfTokens.get(session.sid)?.token || issueCsrfToken(session.sid);
      return sendJson(res, 200, { user: session.user, csrfToken: token });
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      if (!maybeRequireCsrf(req, true)) return sendJson(res, 403, { error: 'CSRF validation failed' });
      const session = getSessionFromReq(req);
      if (session) clearSession(session.sid);
      const deleteAttrs = cookieAttrs(req, 0);
      res.writeHead(204, {
        'set-cookie': [
          `sid=; ${deleteAttrs}`,
          `csrf=; ${deleteAttrs.replace('HttpOnly; ', '')}`,
        ],
      });
      res.end();
      return;
    }

    if (pathname === '/api/feature-flags') {
      return sendJson(res, 200, FEATURE_FLAGS);
    }

    if (pathname === '/api/contracts/ws') {
      return sendJson(res, 200, {
        events: WS_EVENTS,
        stateMachine: CONTRACT_STATES,
      });
    }

    if (pathname === '/api/decks') {
      return sendJson(res, 200, { decks: [...deckCatalog.values()].map((d) => ({ id: d.id, title: d.title, count: d.items.length })) });
    }

    if (pathname === '/api/analytics' && req.method === 'POST') {
      if (!isAllowedOrigin(req)) return sendJson(res, 403, { error: 'Origin not allowed' });
      const payload = await jsonBody(req);
      if (FEATURE_FLAGS.analytics) {
        log('analytics_event', { event: String(payload?.event || '').slice(0, 64), meta: payload?.meta ? 'present' : 'none' });
      }
      res.writeHead(204);
      res.end();
      return;
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.stat(filePath, (err, stats) => {
      if (err || !stats.isFile()) {
        if (pathname.startsWith('/data/') || pathname.startsWith('/scripts/') || pathname.startsWith('/styles/')) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        filePath = path.join(PUBLIC_DIR, 'index.html');
      }

      fs.readFile(filePath, (readErr, buf) => {
        if (readErr) {
          res.writeHead(500);
          res.end('Server error');
          return;
        }
        const ext = path.extname(filePath).toLowerCase();
        res.writeHead(200, {
          'content-type': MIME[ext] || 'application/octet-stream',
          'cache-control': 'no-store',
        });
        res.end(buf);
      });
    });
  })().catch((err) => {
    if (err?.message === 'TOO_LARGE') return sendJson(res, 413, { error: 'Request too large' });
    if (err?.message === 'INVALID_JSON') return sendJson(res, 400, { error: 'Invalid JSON body' });
    if (err?.message === 'DUPLICATE') return sendJson(res, 409, { error: 'Email already registered.' });
    if (err?.message === 'VALIDATION') return sendJson(res, 400, { error: 'Invalid registration payload' });
    if (err?.statusCode) return sendJson(res, err.statusCode, { error: err.message });
    log('http_error', { path: pathname, method: req.method, error: err?.message || 'unknown' }, { requestId: req.requestId });
    return sendJson(res, 500, { error: 'Internal server error' });
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  socketMeta.set(ws, { rates: {}, connectedAt: Date.now() });

  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (raw) => onClientMessage(ws, raw));
  ws.on('close', () => handleDisconnect(ws));
  ws.on('error', (err) => log('ws_error', { err: err.message }));
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      ws.terminate();
      return;
    }
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_MS);

const idleReaper = setInterval(() => {
  const now = Date.now();
  for (const [roomCode, room] of rooms.entries()) {
    if (now - room.lastActivityTs < ROOM_IDLE_MS) continue;
    log('room_reaped_idle', { roomCode, idleMs: now - room.lastActivityTs });
    clearRoomTimers(room);
    rooms.delete(roomCode);
  }
}, 60000);

wss.on('close', () => {
  clearInterval(heartbeat);
  clearInterval(idleReaper);
});

server.listen(PORT, '0.0.0.0', () => {
  log('server_listen', { port: PORT, deckCatalog: deckCatalog.size, featureFlags: FEATURE_FLAGS });
});


function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  log('shutdown_start', { signal, rooms: rooms.size, wsClients: wss.clients.size });

  const timeout = setTimeout(() => {
    log('shutdown_forced', { signal });
    process.exit(1);
  }, 8000);
  timeout.unref();

  try {
    wss.clients.forEach((ws) => {
      try { ws.close(1001, 'Server shutting down'); } catch {}
    });
  } catch {}

  server.close(() => {
    clearInterval(heartbeat);
    clearInterval(idleReaper);
    log('shutdown_complete', { signal });
    clearTimeout(timeout);
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
