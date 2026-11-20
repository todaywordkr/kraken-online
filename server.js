/** Dependency-free HTTP + Server-Sent Events multiplayer backend. Node.js >= 20. */
import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame, publicGame, selectCard, markCard, clearMark, finishShuffle } from './public/game-core.js';
import { BOT_DIFFICULTIES, chooseBotMove, botSpeak, shouldReply } from './bot-ai.js';

const filesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/game-core.js': ['game-core.js', 'text/javascript; charset=utf-8'],
  '/display-utils.js': ['display-utils.js', 'text/javascript; charset=utf-8'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
};
const code = () => Array.from({length: 6}, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
const uid = () => randomBytes(12).toString('hex');
const token = () => randomBytes(32).toString('hex');
const cleanName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 18);
const cleanCode = (value) => String(value ?? '').trim().toUpperCase().replace(/\s/g, '');
const err = (status, message) => Object.assign(new Error(message), { status });

function newCode() {
  for (let i = 0; i < 100; i++) { const result = code(); if (!rooms.has(result)) return result; }
  throw err(503, '방을 생성할 수 없습니다.');
}
function view(room, viewer) {
  return {
    code: room.code, myId: viewer.id, hostId: room.hostId,
    players: room.players.map(({ id, name, ready, streams, bot, difficulty }) => ({ id, name, ready, bot: Boolean(bot), difficulty: bot ? difficulty : null, connected: bot || streams.size > 0 })),
    game: publicGame(room.game, viewer.id),
    messages: room.messages.slice(-70),
  };
}
function send(stream, data) { try { stream.write(`data: ${JSON.stringify(data)}\n\n`); } catch { /* closed stream */ } }
function notify(room) {
  room.lastUsed = Date.now();
  for (const player of room.players) {
    const state = view(room, player);
    for (const stream of player.streams) send(stream, state);
  }
}
function membership(input) {
  const room = rooms.get(cleanCode(input.code));
  const person = room && typeof input.token === 'string' ? room.players.find(p => !p.bot && p.token === input.token) : null;
  if (!room || !person) throw err(401, '세션이 만료되었거나 잘못된 방입니다.');
  return { room, person };
}
function addPlayer(room, name) {
  if (room.game) throw err(409, '이미 게임이 시작됐습니다. 기존 참가자만 재접속할 수 있습니다.');
  if (room.players.length >= 8) throw err(409, '방이 가득 찼습니다.');
  const clean = cleanName(name);
  if (!clean) throw err(400, '닉네임을 입력해주세요.');
  const p = { id: uid(), name: clean, token: token(), bot: false, difficulty: null, ready: false, streams: new Set(), lastChat: 0 };
  room.players.push(p);
  notify(room);
  return p;
}
function removePlayer(room, person) {
  for (const stream of person.streams) stream.end();
  person.streams.clear();
  room.players = room.players.filter(p => p !== person);
  if (room.hostId === person.id) room.hostId = room.players.find(p => !p.bot)?.id ?? null;
  if (room.hostId === null) { clearRoomTimers(room); rooms.delete(room.code); }
  else notify(room);
}
const BOT_NAMES = ['루나', '코랄', '네모', '파도', '닻별', '해초', '진주', '푸른눈', '소금', '아쿠아'];
const VALID_DIFFICULTIES = new Set(Object.keys(BOT_DIFFICULTIES));
function clearRoomTimers(room) {
  clearTimeout(room.botTimer); clearTimeout(room.replyTimer); clearTimeout(room.shuffleTimer);
  room.botTimer = null; room.replyTimer = null; room.shuffleTimer = null;
}
function addBot(room, difficulty) {
  if (room.players.length >= 8) throw err(409, '방 정원이 8명입니다.');
  if (!VALID_DIFFICULTIES.has(difficulty)) throw err(400, 'AI 난이도는 쉬움, 보통, 어려움 중 하나여야 합니다.');
  const available = BOT_NAMES.find(name => !room.players.some(p => p.name === `AI ${name}`));
  const name = available ? `AI ${available}` : `AI ${room.players.length + 1}`;
  room.players.push({ id: uid(), name, bot: true, difficulty, token: null, ready: true, streams: new Set(), lastChat: 0 });
}
function botMessage(room, bot, textValue) {
  if (!textValue || !room.game) return;
  room.messages.push({ id: uid(), playerId: bot.id, name: bot.name, text: String(textValue).slice(0, 180), bot: true, round: room.game.round });
  room.messages = room.messages.slice(-70);
  notify(room);
}
function gameViewForBot(room, bot) { return publicGame(room.game, bot.id); }
function sendBotIntro(room, contextType) {
  const list = room.players.filter(p=>p.bot);
  if (!list.length || !room.game || room.game.phase !== 'playing') return;
  // Avoid flooding a room of 7 bots with claims all at once.
  const speakers = list.slice(0, Math.min(2, list.length));
  for (const bot of speakers) {
    botMessage(room, bot, botSpeak(gameViewForBot(room,bot), room.messages, bot.difficulty, { type: contextType }));
  }
}
function scheduleShuffle(room) {
  if (room.game?.phase !== 'shuffling' || room.shuffleTimer) return;
  const delay = Math.max(25, room.shuffleDelayMs ?? 2700);
  const game = room.game;
  game.shuffleEndsAt = Date.now() + delay;
  notify(room);
  room.shuffleTimer = setTimeout(() => {
    room.shuffleTimer = null;
    if (room.game !== game || game.phase !== 'shuffling') return;
    try {
      finishShuffle(game);
      notify(room);
      sendBotIntro(room, 'round');
      scheduleBotTurn(room);
    } catch (error) { console.error('라운드 재분배 실패', error); }
  }, delay);
}
function scheduleBotTurn(room) {
  clearTimeout(room.botTimer); room.botTimer = null;
  if (!room.game || room.game.phase !== 'playing') return;
  const bot = room.players.find(p => p.id === room.game.currentId && p.bot);
  if (!bot) return;
  const currentId = bot.id;
  const delay = Math.max(20, room.botDelayMs ?? (bot.difficulty === 'easy' ? 1250 : bot.difficulty === 'hard' ? 2500 : 1900));
  room.botTimer = setTimeout(() => {
    if (!room.game || room.game.phase !== 'playing' || room.game.currentId !== currentId) return;
    try {
      const decision = chooseBotMove(gameViewForBot(room,bot),room.messages,bot.difficulty);
      markCard(room.game,bot.id,decision.targetId,decision.cardId);
      if (Math.random() < 0.85) botMessage(room,bot,botSpeak(gameViewForBot(room,bot),room.messages,bot.difficulty,{type:'turn',targetName:decision.targetName}));
      notify(room);
      room.botTimer = setTimeout(() => {
        if (!room.game || room.game.phase !== 'playing' || room.game.currentId !== currentId) return;
        try {
          selectCard(room.game,bot.id,decision.targetId,decision.cardId);
          if (room.game.phase === 'shuffling') scheduleShuffle(room);
          else { notify(room); scheduleBotTurn(room); }
        } catch (e) { console.error('AI 카드 공개 실패', e); scheduleBotTurn(room); }
      }, Math.max(30, Math.min(1100, Math.floor(delay * 0.55))));
    } catch (e) { console.error('AI 선택 실패', e); }
  }, delay);
}
function scheduleBotReply(room, humanMessage) {
  if (room.replyTimer || room.game?.phase !== 'playing') return;
  const bots = room.players.filter(p=>p.bot);
  if (!bots.length) return;
  const tagged = bots.find(b=>humanMessage.text.includes(b.name));
  const bot = tagged || bots[Math.floor(Math.random() * bots.length)];
  if (!tagged && !shouldReply(humanMessage.text,bot.difficulty)) return;
  room.replyTimer = setTimeout(() => {
    room.replyTimer = null;
    if (room.game?.phase !== 'playing' || !room.players.includes(bot)) return;
    const reply = botSpeak(gameViewForBot(room,bot),room.messages,bot.difficulty,{type:'reply',text:humanMessage.text});
    botMessage(room,bot,reply);
  }, Math.max(50,Math.min(1850,room.botDelayMs ?? 1100)));
}
async function receiveBody(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8_192) throw err(413, '요청 내용이 너무 깁니다.');
  }
  try { return JSON.parse(text || '{}'); }
  catch { throw err(400, '올바른 JSON이 아닙니다.'); }
}
function json(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(obj));
}
async function api(action, data, options = {}) {
  if (action === 'create') {
    const name = cleanName(data.name);
    if (!name) throw err(400, '닉네임을 입력해주세요.');
    const room = { code: newCode(), players: [], hostId: null, game: null, messages: [], lastUsed: Date.now(), botTimer: null, replyTimer: null, shuffleTimer: null, botDelayMs: options.botDelayMs, shuffleDelayMs: options.shuffleDelayMs };
    rooms.set(room.code, room);
    const person = addPlayer(room, name);
    person.ready = true;
    room.hostId = person.id;
    return { code: room.code, token: person.token, state: view(room, person) };
  }
  if (action === 'join') {
    const room = rooms.get(cleanCode(data.code));
    if (!room) throw err(404, '방을 찾을 수 없습니다. 초대 코드를 확인해주세요.');
    const person = typeof data.token === 'string' ? room.players.find(p => !p.bot && p.token === data.token) : null;
    const joined = person ?? addPlayer(room, data.name);
    return { code: room.code, token: joined.token, state: view(room, joined) };
  }
  if (action === 'resume') {
    const { room, person } = membership(data);
    return { code: room.code, token: person.token, state: view(room, person) };
  }
  const { room, person } = membership(data);
  if (action === 'add-bot' || action === 'remove-bot' || action === 'bot-difficulty') {
    if (room.hostId !== person.id) throw err(403, 'AI 설정은 방장만 변경할 수 있습니다.');
    if (room.game) throw err(409, '게임이 시작된 후에는 AI 구성을 변경할 수 없습니다.');
    if (action === 'add-bot') addBot(room, data.difficulty || 'normal');
    else {
      const bot = room.players.find(p => p.id === data.botId && p.bot);
      if (!bot) throw err(404, '해당 AI 플레이어를 찾을 수 없습니다.');
      if (action === 'remove-bot') room.players = room.players.filter(p=>p !== bot);
      else {
        if (!VALID_DIFFICULTIES.has(data.difficulty)) throw err(400, '지원하지 않는 AI 난이도입니다.');
        bot.difficulty = data.difficulty;
      }
    }
    notify(room);
    return {};
  }
  if (action === 'ready') {
    if (room.game) throw err(409, '이미 게임이 시작됐습니다.');
    person.ready = !person.ready;
    notify(room);
    return {};
  }
  if (action === 'start') {
    if (room.hostId !== person.id) throw err(403, '방장만 게임을 시작할 수 있습니다.');
    if (room.game) throw err(409, '이미 게임이 시작됐습니다.');
    if (room.players.length < 4 || room.players.length > 8) throw err(409, '4~8명이 모여야 합니다.');
    if (room.players.some(p => !p.ready || (!p.bot && p.streams.size === 0))) throw err(409, '전원이 접속해 준비 완료해야 합니다.');
    room.messages = [];
    room.game = newGame(room.players.map(({id, name, bot, difficulty}) => ({id, name, bot, difficulty})));
    notify(room);
    sendBotIntro(room, 'intro');
    scheduleBotTurn(room);
    return {};
  }
  if (action === 'mark' || action === 'unmark') {
    if (!room.game) throw err(409, '진행 중인 게임이 아닙니다.');
    try {
      if (action === 'mark') markCard(room.game, person.id, data.targetId, data.cardId);
      else clearMark(room.game, person.id);
    } catch(e) { throw err(409, e.message); }
    notify(room);
    return {};
  }
  if (action === 'pick') {
    if (!room.game) throw err(409, '진행 중인 게임이 아닙니다.');
    if (typeof data.targetId !== 'string' || typeof data.cardId !== 'string') throw err(400, '잘못된 카드 선택입니다.');
    try { selectCard(room.game, person.id, data.targetId, data.cardId); }
    catch (e) { throw err(409, e.message); }
    if (room.game.phase === 'shuffling') scheduleShuffle(room);
    else { notify(room); scheduleBotTurn(room); }
    return {};
  }
  if (action === 'chat') {
    const value = String(data.text ?? '').trim().slice(0, 180);
    if (!value) throw err(400, '메시지를 입력해주세요.');
    if (Date.now() - person.lastChat < 450) throw err(429, '조금 천천히 메시지를 보내주세요.');
    person.lastChat = Date.now();
    const humanMessage = { id: uid(), playerId: person.id, name: person.name, text: value, bot: false, round: room.game?.round ?? 0 };
    room.messages.push(humanMessage);
    room.messages = room.messages.slice(-70);
    notify(room);
    scheduleBotReply(room, humanMessage);
    return {};
  }
  if (action === 'restart') {
    if (room.hostId !== person.id) throw err(403, '방장만 새 게임을 준비할 수 있습니다.');
    if (room.game?.phase !== 'finished') throw err(409, '게임이 끝난 후에만 다시 시작할 수 있습니다.');
    clearRoomTimers(room);
    room.game = null;
    room.messages = [];
    for (const p of room.players) p.ready = p.bot || (p.id === room.hostId);
    notify(room);
    return {};
  }
  if (action === 'leave') {
    if (room.game) throw err(409, '게임 중에는 나갈 수 없습니다. 페이지를 닫았다가 재접속할 수 있습니다.');
    removePlayer(room, person);
    return {};
  }
  throw err(404, '지원하지 않는 요청입니다.');
}

function openEvents(req, res, url) {
  const { room, person } = membership({ code: url.searchParams.get('code'), token: url.searchParams.get('token') });
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'connection': 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  person.streams.add(res);
  const keepalive = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { /* closed */ } }, 20_000);
  const clean = () => {
    clearInterval(keepalive);
    person.streams.delete(res);
    if (rooms.has(room.code)) notify(room);
  };
  req.once('close', clean);
  notify(room);
}

export function createServer(options = {}) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size });
      if (req.method === 'GET' && url.pathname === '/api/events') return openEvents(req, res, url);
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const data = await receiveBody(req);
        const value = await api(url.pathname.slice(5), data, options);
        return json(res, 200, { ok: true, ...value });
      }
      const entry = req.method === 'GET' ? staticFiles[url.pathname] : null;
      if (entry) {
        const [fileName, mime] = entry;
        const content = await readFile(path.join(filesDir, fileName));
        res.writeHead(200, { 'content-type': mime, 'x-content-type-options': 'nosniff' });
        return res.end(content);
      }
      return json(res, 404, { ok: false, error: '페이지를 찾을 수 없습니다.' });
    } catch (e) {
      if (!res.headersSent) json(res, e.status || 500, { ok: false, error: e.status ? e.message : '서버 오류가 발생했습니다.' });
      else res.end();
      if (!e.status) console.error(e);
    }
  });
}
// Unused rooms expire to prevent indefinite memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (room.players.filter(p=>!p.bot).every(p => p.streams.size === 0) && now - room.lastUsed > 30 * 60_000) { clearRoomTimers(room); rooms.delete(id); }
  }
}, 60_000).unref();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '0.0.0.0', () => console.log(`크라켄 온라인 게임 실행: http://localhost:${port}`));
}
