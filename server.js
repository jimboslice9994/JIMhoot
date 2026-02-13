const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const HEARTBEAT_MS = 15000;
const HOST_REJOIN_GRACE_MS = 60000;
const ROOM_IDLE_MS = 30 * 60 * 1000;
const MAX_PLAYERS_PER_ROOM = 20;
const MAX_MESSAGE_BYTES = 32 * 1024;

const PHASE_MS = {
  QUESTION_ACTIVE: 10000,
  COLLECT: 1000,
  REVEAL: 3000,
  LEADERBOARD: 3000,
};

const RATE_LIMIT = {
  join_room: { limit: 6, windowMs: 10000 },
  submit_answer: { limit: 20, windowMs: 10000 },
};

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

function log(type, payload = {}) {
  console.log(JSON.stringify({ ts: Date.now(), type, ...payload }));
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

function createRoom(hostPlayer, deck) {
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

function clearRoomTimers(room) {
  clearTimeout(room.phaseTimer);
  room.phaseTimer = null;
  if (room.currentQuestion?.timeout) {
    clearTimeout(room.currentQuestion.timeout);
    room.currentQuestion.timeout = null;
  }
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
  room.state = 'QUESTION_ACTIVE';
  room.currentQuestion = {
    questionInstanceId: makeId('qinst'),
    questionId: q.id,
    prompt: q.question,
    choices: q.choices,
    correct: q.correct,
    explanation: q.explanation,
    serverStartTs: Date.now(),
    timeLimitMs: Math.max(5000, Math.min(120000, q.timeLimitSec * 1000 || PHASE_MS.QUESTION_ACTIVE)),
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
  room.state = 'COLLECT';
  touchRoom(room);
  broadcast(room, 'phase_update', { roomCode: room.code, state: room.state, durationMs: PHASE_MS.COLLECT, serverNow: Date.now() });
  room.phaseTimer = setTimeout(() => moveToReveal(room), PHASE_MS.COLLECT);
}

function moveToReveal(room) {
  if (!room.currentQuestion || !['COLLECT', 'QUESTION_ACTIVE'].includes(room.state)) return;
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
  });

  room.phaseTimer = setTimeout(() => moveToLeaderboard(room), PHASE_MS.REVEAL);
}

function moveToLeaderboard(room) {
  if (!room.currentQuestion || room.state !== 'REVEAL') return;
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
  log('leaderboard_metrics', { roomCode: room.code, payloadBytes: leaderboardBytes });

  room.phaseTimer = setTimeout(() => startQuestion(room), PHASE_MS.LEADERBOARD);
}

function attachPlayerToSocket(player, ws, roomCode) {
  player.ws = ws;
  player.roomCode = roomCode;
  ws.isAlive = true;
  connBySocket.set(ws, { roomCode, playerId: player.playerId });
}

function allowRate(ws, eventName) {
  const policy = RATE_LIMIT[eventName];
  if (!policy) return true;

  const meta = socketMeta.get(ws) || { rates: {}, connectedAt: Date.now() };
  socketMeta.set(ws, meta);
  const now = Date.now();
  const bucket = meta.rates[eventName] || [];
  const filtered = bucket.filter((ts) => now - ts < policy.windowMs);
  if (filtered.length >= policy.limit) return false;
  filtered.push(now);
  meta.rates[eventName] = filtered;
  return true;
}

function handleJoin(ws, payload) {
  if (!allowRate(ws, 'join_room')) {
    return emitError(ws, 'RATE_LIMITED', 'Too many join attempts; please wait.');
  }

  const role = payload.role === 'host' ? 'host' : 'player';
  const playerId = String(payload.playerId || makeId('player'));
  const nickname = sanitizeNickname(payload.nickname || (role === 'host' ? 'Host' : 'Player'));
  if (!nickname) return emitError(ws, 'VALIDATION_ERROR', 'Nickname required');

  if (role === 'host') {
    const deck = normalizeDeckFromId(payload.deckId);
    if (!deck) return emitError(ws, 'VALIDATION_ERROR', 'Host must provide valid deckId');
    const hostPlayer = { playerId, nickname, role: 'host', score: 0, ws, connectedAt: Date.now() };
    const room = createRoom(hostPlayer, deck);
    attachPlayerToSocket(hostPlayer, ws, room.code);
    log('room_created', { roomCode: room.code, host: hostPlayer.playerId, deckId: deck.id });
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
    player = { playerId, nickname, role: 'player', score: 0, ws, connectedAt: Date.now() };
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
  if (payload.playerId !== room.hostPlayerId) return emitError(ws, 'NOT_HOST', 'Only host can advance');

  if (room.state === 'COLLECT') return moveToReveal(room);
  if (room.state === 'REVEAL') return moveToLeaderboard(room);
  return startQuestion(room);
}

function onClientMessage(ws, raw) {
  if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) {
    emitError(ws, 'MESSAGE_TOO_LARGE', 'Message too large');
    ws.close();
    return;
  }

  let msg;
  try {
    msg = JSON.parse(raw.toString());
  } catch {
    return emitError(ws, 'VALIDATION_ERROR', 'Invalid JSON');
  }
  const event = msg?.event;
  const payload = msg?.payload || {};
  if (!event) return emitError(ws, 'VALIDATION_ERROR', 'Missing event');
  log('ws_event', { event });

  switch (event) {
    case 'join_room': return handleJoin(ws, payload);
    case 'rejoin_room': return handleRejoin(ws, payload);
    case 'start_game': return handleStartGame(ws, payload);
    case 'submit_answer': return handleSubmitAnswer(ws, payload);
    case 'next_question': return handleNextQuestion(ws, payload);
    case 'ping': return safeSend(ws, 'pong', { sentTs: payload?.sentTs || null, serverTs: Date.now() });
    default: return emitError(ws, 'VALIDATION_ERROR', 'Unknown event');
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
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, rooms: rooms.size, deckCatalog: deckCatalog.size }));
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
        'x-content-type-options': 'nosniff',
      });
      res.end(buf);
    });
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
  log('server_listen', { port: PORT, deckCatalog: deckCatalog.size });
});
