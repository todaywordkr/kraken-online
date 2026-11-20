/** Dependency-free HTTP + Server-Sent Events multiplayer backend. Node.js >= 20. */
import http from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newGame, publicGame, selectCard, markCard, clearMark } from './public/game-core.js';

const filesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const rooms = new Map();
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/game-core.js': ['game-core.js', 'text/javascript; charset=utf-8'],
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
    players: room.players.map(({ id, name, ready, streams }) => ({ id, name, ready, connected: streams.size > 0 })),
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
  const person = room?.players.find(p => p.token === input.token);
  if (!room || !person) throw err(401, '세션이 만료되었거나 잘못된 방입니다.');
  return { room, person };
}
function addPlayer(room, name) {
  if (room.game) throw err(409, '이미 게임이 시작됐습니다. 기존 참가자만 재접속할 수 있습니다.');
  if (room.players.length >= 8) throw err(409, '방이 가득 찼습니다.');
  const clean = cleanName(name);
  if (!clean) throw err(400, '닉네임을 입력해주세요.');
  const p = { id: uid(), name: clean, token: token(), ready: false, streams: new Set(), lastChat: 0 };
  room.players.push(p);
  notify(room);
  return p;
}
function removePlayer(room, person) {
  for (const stream of person.streams) stream.end();
  person.streams.clear();
  room.players = room.players.filter(p => p !== person);
  if (room.hostId === person.id) room.hostId = room.players[0]?.id ?? null;
  if (room.players.length === 0) rooms.delete(room.code);
  else notify(room);
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
async function api(action, data) {
  if (action === 'create') {
    const name = cleanName(data.name);
    if (!name) throw err(400, '닉네임을 입력해주세요.');
    const room = { code: newCode(), players: [], hostId: null, game: null, messages: [], lastUsed: Date.now() };
    rooms.set(room.code, room);
    const person = addPlayer(room, name);
    person.ready = true;
    room.hostId = person.id;
    return { code: room.code, token: person.token, state: view(room, person) };
  }
  if (action === 'join') {
    const room = rooms.get(cleanCode(data.code));
    if (!room) throw err(404, '방을 찾을 수 없습니다. 초대 코드를 확인해주세요.');
    const person = data.token ? room.players.find(p => p.token === data.token) : null;
    const joined = person ?? addPlayer(room, data.name);
    return { code: room.code, token: joined.token, state: view(room, joined) };
  }
  if (action === 'resume') {
    const { room, person } = membership(data);
    return { code: room.code, token: person.token, state: view(room, person) };
  }
  const { room, person } = membership(data);
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
    if (room.players.some(p => !p.ready || p.streams.size === 0)) throw err(409, '전원이 접속해 준비 완료해야 합니다.');
    room.game = newGame(room.players.map(({id, name}) => ({id, name})));
    notify(room);
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
    notify(room);
    return {};
  }
  if (action === 'chat') {
    const value = String(data.text ?? '').trim().slice(0, 180);
    if (!value) throw err(400, '메시지를 입력해주세요.');
    if (Date.now() - person.lastChat < 450) throw err(429, '조금 천천히 메시지를 보내주세요.');
    person.lastChat = Date.now();
    room.messages.push({ id: uid(), playerId: person.id, name: person.name, text: value });
    room.messages = room.messages.slice(-70);
    notify(room);
    return {};
  }
  if (action === 'restart') {
    if (room.hostId !== person.id) throw err(403, '방장만 새 게임을 준비할 수 있습니다.');
    if (room.game?.phase !== 'finished') throw err(409, '게임이 끝난 후에만 다시 시작할 수 있습니다.');
    room.game = null;
    room.messages = [];
    for (const p of room.players) p.ready = (p.id === room.hostId);
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

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size });
      if (req.method === 'GET' && url.pathname === '/api/events') return openEvents(req, res, url);
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const data = await receiveBody(req);
        const value = await api(url.pathname.slice(5), data);
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
    if (room.players.every(p => p.streams.size === 0) && now - room.lastUsed > 30 * 60_000) rooms.delete(id);
  }
}, 60_000).unref();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, '0.0.0.0', () => console.log(`크라켄 온라인 게임 실행: http://localhost:${port}`));
}
