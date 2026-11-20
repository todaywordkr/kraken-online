import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from '../server.js';
import {chooseBotMove, botSpeak, shouldReply} from '../bot-ai.js';
import {newGame, publicGame, finishShuffle, finishReview, finishDeclarations} from '../public/game-core.js';

const roster = () => Array.from({length:4},(_,i)=>({id:`p${i}`,name:`AI${i}`,bot:true,difficulty:'hard'}));

test('AI picks only publicly selectable cards; decision uses redacted player view', () => {
  const g = newGame(roster());
  finishShuffle(g);finishReview(g);finishDeclarations(g);
  const id = g.currentId;
  const view = publicGame(g,id);
  assert.equal(view.players.every(p=>p.bot), true);
  assert.equal(view.players.every(p=>!('hand' in p)), true);
  assert.equal(view.players.every(p=>!('role' in p)), true);
  assert.equal(view.mySecret.role,g.players.find(p=>p.id===id).role);
  const move = chooseBotMove(view, [], 'hard', ()=>0.24);
  assert.notEqual(move.targetId,id);
  assert.ok(view.players.find(p=>p.id===move.targetId).cards.includes(move.cardId));
  const phrase = botSpeak(view,[], 'hard', {type:'intro'},()=>0.2);
  assert.match(phrase,/보물/);
  assert.equal(shouldReply('크라켄 있어?', 'hard',()=>0.3),true);
});

const server=createServer({botDelayMs:65, shuffleDelayMs:40,reviewDelayMs:45,claimDelayMs:90,revealDelayMs:75});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const api = async(action,data={}) => {
  const response=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  return {status:response.status,...await response.json()};
};
const pause = ms=>new Promise(r=>setTimeout(r,ms));
async function attach(session) {
  const controller=new AbortController();
  const response=await fetch(`${base}/api/events?code=${session.code}&token=${session.token}`,{signal:controller.signal});
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  const first=await reader.read();
  assert.match(new TextDecoder().decode(first.value),/"code"/);
  return controller;
}

test('1 human + 3 AI: real server starts, turns are automatic, chat replies, victory eventually happens', async () => {
  const s=await api('create',{name:'혼자하는사람'});
  const connection=await attach(s);
  try {
    assert.equal((await api('add-bot',{...s,difficulty:'easy'})).status,200);
    assert.equal((await api('add-bot',{...s,difficulty:'normal'})).status,200);
    assert.equal((await api('add-bot',{...s,difficulty:'hard'})).status,200);
    const lobby=(await api('resume',s)).state;
    assert.equal(lobby.players.length,4);
    assert.equal(lobby.players.filter(p=>p.bot).length,3);
    assert.ok(lobby.players.filter(p=>p.bot).every(p=>p.ready && p.connected));
    assert.deepEqual(lobby.players.filter(p=>p.bot).map(p=>p.difficulty),['easy','normal','hard']);
    assert.equal((await api('start',s)).status,200);
    assert.equal((await api('add-bot',{...s,difficulty:'hard'})).status,409);
    await pause(240);
    assert.equal((await api('chat',{...s,text:`${lobby.players.find(p=>p.bot).name} 크라켄 어디있어?`})).status,200);
    await pause(220);
    let snapshot=(await api('resume',s)).state;
    assert.ok(snapshot.messages.some(m=>m.bot));
    assert.ok(snapshot.messages.some(m=>m.bot && m.text.includes('크라켄')));
    assert.ok(snapshot.game.players.filter(p=>p.bot).every(p=>snapshot.game.phase === 'finished' ? Boolean(p.role) : !('role' in p))); // victory legitimately reveals roles
    let steps=0;
    const until=Date.now()+7500;
    while(Date.now()<until && snapshot.game.phase!=='finished') {
      const g=snapshot.game;
      if (g.phase === 'playing' && g.currentId===snapshot.myId && !g.pending) {
        const cardOwner=g.players.find(p=>p.id!==g.currentId && p.cards.length);
        const result=await api('pick',{...s,targetId:cardOwner.id,cardId:cardOwner.cards[0]});
        assert.equal(result.status,200,JSON.stringify(result));
        steps++;
      }
      await pause(85);
      snapshot=(await api('resume',s)).state;
    }
    assert.equal(snapshot.game.phase,'finished','solo game should finish from bots plus human turns');
    assert.ok(snapshot.game.revealed.length>=1);
    assert.ok(snapshot.game.players.every(p=>p.role==='crew' || p.role==='skeleton'));
    assert.equal((await api('restart',s)).status,200);
    const retryLobby=(await api('resume',s)).state;
    assert.ok(retryLobby.players.filter(p=>p.bot).every(p=>p.ready));
  } finally { connection.abort(); }
});

test('2 humans + 2 AI, host permissions, difficulty changes, and removal', async()=>{
  const host=await api('create',{name:'방장'});
  const friend=await api('join',{name:'친구',code:host.code});
  const c1=await attach(host); const c2=await attach(friend);
  try {
    assert.equal((await api('add-bot',{...friend,difficulty:'hard'})).status,403);
    assert.equal((await api('add-bot',{...host,difficulty:'unknown'})).status,400);
    assert.equal((await api('add-bot',{...host,difficulty:'normal'})).status,200);
    let lobby=(await api('resume',host)).state;
    const bot=lobby.players.find(p=>p.bot);
    assert.ok(bot);
    assert.equal((await api('bot-difficulty',{...host,botId:bot.id,difficulty:'hard'})).status,200);
    assert.equal((await api('remove-bot',{...friend,botId:bot.id})).status,403);
    assert.equal((await api('remove-bot',{...host,botId:bot.id})).status,200);
    assert.equal((await api('add-bot',{...host,difficulty:'hard'})).status,200);
    assert.equal((await api('add-bot',{...host,difficulty:'normal'})).status,200);
    assert.equal((await api('ready',friend)).status,200);
    assert.equal((await api('start',host)).status,200);
    await pause(240);
    lobby=(await api('resume',host)).state;
    assert.equal(lobby.game.playerCount,4);
    assert.equal(lobby.game.players.filter(p=>p.bot).length,2);
    assert.ok(lobby.game.players.every(p=>!p.role));
    const botActor=lobby.game.players.find(p=>p.bot);
    assert.equal((await api('pick',{...host,targetId:botActor.id,cardId:botActor.cards[0]})).status===200,lobby.game.currentId===lobby.myId);
  } finally { c1.abort(); c2.abort(); }
});

test.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
