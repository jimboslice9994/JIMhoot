const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const HEARTBEAT_MS = 15000;
const HOST_REJOIN_GRACE_MS = 60000;

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

function log(type, payload = {}) {
  console.log(JSON.stringify({ ts: Date.now(), type, ...payload }));
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

function broadcast(room, event, payload) {
  room.players.forEach((p) => safeSend(p.ws, event, payload));
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
    createdAt: Date.now(),
  };
  rooms.set(roomCode, room);
  return room;
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

function normalizeDeck(input) {
  if (!input || input.type !== 'mcq' || !Array.isArray(input.items) || !input.items.length) return null;
  const items = input.items.map((q) => ({
    id: q.id || makeId('q'),
    question: String(q.question || '').trim(),
    choices: q.choices,
    correct: String(q.correct || '').toUpperCase(),
    explanation: String(q.explanation || ''),
    timeLimitSec: Number(q.timeLimitSec) > 0 ? Number(q.timeLimitSec) : 20,
  })).filter((q) => q.question && q.choices?.A && q.choices?.B && q.choices?.C && q.choices?.D && ['A', 'B', 'C', 'D'].includes(q.correct));
  if (!items.length) return null;
  return { id: String(input.id || makeId('deck')), title: String(input.title || 'Untitled deck'), type: 'mcq', items };
}

function startQuestion(room) {
  room.questionIndex += 1;
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
    timeLimitMs: Math.max(5000, Math.min(120000, q.timeLimitSec * 1000)),
    submissions: new Map(),
    timeout: null,
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
    timeLimitMs: room.currentQuestion.timeLimitMs,
  };
  broadcast(room, 'question', payload);

  room.currentQuestion.timeout = setTimeout(() => {
    revealQuestion(room);
  }, room.currentQuestion.timeLimitMs + 100);
}

function scoreAnswer(isCorrect, elapsedMs, timeLimitMs) {
  if (!isCorrect) return 0;
  const basePoints = 500;
  const clamped = Math.min(Math.max(elapsedMs, 0), timeLimitMs);
  const speedRatio = 1 - (clamped / timeLimitMs);
  const speedBonus = Math.round(500 * speedRatio);
  return basePoints + speedBonus;
}

function revealQuestion(room) {
  if (!room.currentQuestion || room.state !== 'QUESTION_ACTIVE') return;
  room.state = 'REVEAL';
  clearTimeout(room.currentQuestion.timeout);

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

  broadcast(room, 'reveal', {
    roomCode: room.code,
    questionInstanceId: room.currentQuestion.questionInstanceId,
    correct: room.currentQuestion.correct,
    explanation: room.currentQuestion.explanation,
    results,
  });

  const rankings = [...room.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, idx) => ({ rank: idx + 1, playerId: p.playerId, nickname: p.nickname, score: p.score }));
  room.state = 'LEADERBOARD';
  broadcast(room, 'leaderboard_update', { roomCode: room.code, rankings, isFinal: room.questionIndex === room.deck.items.length - 1 });
}

function attachPlayerToSocket(player, ws, roomCode) {
  player.ws = ws;
  player.roomCode = roomCode;
  ws.isAlive = true;
  connBySocket.set(ws, { roomCode, playerId: player.playerId });
}

function handleJoin(ws, payload) {
  const role = payload.role === 'host' ? 'host' : 'player';
  const playerId = String(payload.playerId || makeId('player'));
  const nickname = sanitizeNickname(payload.nickname || (role === 'host' ? 'Host' : 'Player'));
  if (!nickname) return emitError(ws, 'VALIDATION_ERROR', 'Nickname required');

  if (role === 'host') {
    const deck = normalizeDeck(payload.deck);
    if (!deck) return emitError(ws, 'VALIDATION_ERROR', 'Host must provide valid MCQ deck');
    const hostPlayer = { playerId, nickname, role: 'host', score: 0, ws, connectedAt: Date.now() };
    const room = createRoom(hostPlayer, deck);
    attachPlayerToSocket(hostPlayer, ws, room.code);
    log('room_created', { roomCode: room.code, host: hostPlayer.playerId });
    broadcast(room, 'lobby_state', lobbyPayload(room));
    return;
  }

  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  if (!canHandleState(room.state, 'join_room')) return emitError(ws, 'INVALID_STATE', 'Cannot join right now');

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

function handleRejoin(ws, payload) {
  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  const playerId = String(payload.playerId || '');
  const player = room.players.get(playerId);
  if (!player) return emitError(ws, 'ROOM_NOT_FOUND', 'Player not found in room');

  if (payload.nickname) player.nickname = sanitizeNickname(payload.nickname) || player.nickname;
  attachPlayerToSocket(player, ws, room.code);

  if (room.state === 'PAUSED_HOST_DISCONNECTED' && player.playerId === room.hostPlayerId) {
    clearTimeout(room.hostGraceTimer);
    room.hostGraceTimer = null;
    room.state = room.currentQuestion ? 'QUESTION_ACTIVE' : 'LOBBY';
  }

  safeSend(ws, 'lobby_state', lobbyPayload(room));

  if (room.state === 'QUESTION_ACTIVE' && room.currentQuestion) {
    safeSend(ws, 'question', {
      roomCode: room.code,
      index: room.questionIndex,
      total: room.deck.items.length,
      questionInstanceId: room.currentQuestion.questionInstanceId,
      questionId: room.currentQuestion.questionId,
      prompt: room.currentQuestion.prompt,
      choices: room.currentQuestion.choices,
      serverStartTs: room.currentQuestion.serverStartTs,
      timeLimitMs: room.currentQuestion.timeLimitMs,
    });
  }
}

function handleStartGame(ws, payload) {
  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  if (!canHandleState(room.state, 'start_game')) return emitError(ws, 'INVALID_STATE', 'Cannot start game in this state');
  if (payload.playerId !== room.hostPlayerId) return emitError(ws, 'NOT_HOST', 'Only host can start game');

  room.players.forEach((p) => { p.score = 0; });
  room.questionIndex = -1;
  startQuestion(room);
}

function handleSubmitAnswer(ws, payload) {
  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
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
  safeSend(ws, 'answer_ack', { roomCode: room.code, questionInstanceId: payload.questionInstanceId, status: 'accepted', receivedTs: now });
}

function handleNextQuestion(ws, payload) {
  const room = roomFromCodeOrError(ws, payload.roomCode);
  if (!room) return;
  if (!canHandleState(room.state, 'next_question')) return emitError(ws, 'INVALID_STATE', 'Cannot advance now');
  if (payload.playerId !== room.hostPlayerId) return emitError(ws, 'NOT_HOST', 'Only host can advance');
  startQuestion(room);
}

function onClientMessage(ws, raw) {
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
    default: return emitError(ws, 'VALIDATION_ERROR', 'Unknown event');
  }
}

function handleDisconnect(ws) {
  const conn = connBySocket.get(ws);
  connBySocket.delete(ws);
  if (!conn) return;
  const room = rooms.get(conn.roomCode);
  if (!room) return;

  const player = room.players.get(conn.playerId);
  if (!player) return;
  player.ws = null;

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
    res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
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
  ws.on('pong', () => { ws.isAlive = true; });
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

wss.on('close', () => clearInterval(heartbeat));

server.listen(PORT, '0.0.0.0', () => {
  log('server_listen', { port: PORT });
});
