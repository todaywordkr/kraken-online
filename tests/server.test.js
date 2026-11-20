import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

const server = createServer({darkDelayMs:200,shuffleDelayMs:200,roleDelayMs:200,reviewDelayMs:240,claimDelayMs:300,revealDelayMs:75});
await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const request = async (action, data={}) => {
  const r=await fetch(`${base}/api/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  return { status:r.status,...await r.json() };
};
async function streamFor(session) {
  const controller = new AbortController();
  const url=`${base}/api/events?code=${session.code}&token=${session.token}`;
  const response=await fetch(url,{signal:controller.signal});
  assert.equal(response.status,200);
  const reader=response.body.getReader();
  const first=await reader.read();
  assert.match(new TextDecoder().decode(first.value),/"code"/);
  return controller;
}

test('실시간 온라인 플레이: 생성·입장·준비·시작·선택·채팅·권한', async () => {
  const sessions=[];const connections=[];
  try {
    const a=await request('create',{name:'방장'});
    assert.equal(a.status,200);
    assert.equal(a.code.length,6);
    sessions.push(a);
    for(let i=1;i<4;i++) {
      const b=await request('join',{name:`손님${i}`,code:a.code});
      assert.equal(b.status,200);
      sessions.push(b);
    }
    const early=await request('start',sessions[0]);
    assert.equal(early.status,409);
    for(const s of sessions) connections.push(await streamFor(s));
    for(const s of sessions.slice(1)) assert.equal((await request('ready',s)).status,200);
    assert.equal((await request('start',sessions[0])).status,200);
    let state=(await request('resume',sessions[0])).state;
    assert.equal(state.game.phase,'intro-dark');
    assert.ok(state.game.darkEndsAt > Date.now());
    assert.equal((await request('pick',{...sessions[0],targetId:state.game.players[1].id,cardId:state.game.players[1].cards[0]})).status,409);
    await new Promise(r=>setTimeout(r,210));
    state=(await request('resume',sessions[0])).state;
    assert.equal(state.game.phase,'role-reveal');
    assert.ok(state.game.roleEndsAt > Date.now());
    assert.equal((await request('pick',{...sessions[0],targetId:state.game.players[1].id,cardId:state.game.players[1].cards[0]})).status,409);
    await new Promise(r=>setTimeout(r,210));
    state=(await request('resume',sessions[0])).state;
    assert.equal(state.game.phase,'shuffling');
    assert.ok(state.game.shuffleEndsAt > Date.now());
    await new Promise(r=>setTimeout(r,210));
    state=(await request('resume',sessions[0])).state;
    assert.equal(state.game.phase,'reviewing');
    assert.ok(state.game.reviewEndsAt>Date.now());
    assert.equal((await request('declare',{...sessions[0],number:0})).status,409);
    assert.equal((await request('pick',{...sessions[0],targetId:state.game.players[1].id,cardId:state.game.players[1].cards[0]})).status,409);
    await new Promise(r=>setTimeout(r,255));
    state=(await request('resume',sessions[0])).state;
    assert.equal(state.game.phase,'declaring');
    assert.equal((await request('declare',{...sessions[0],number:5})).status,409);
    assert.equal((await request('declare',{...sessions[0],number:0})).status,200);
    assert.equal((await request('declare',{...sessions[0],number:2})).status,409);
    await new Promise(r=>setTimeout(r,340));
    state=(await request('resume',sessions[0])).state;
    assert.equal(state.game.phase,'playing');
    const declared=state.game.players.find(p=>p.id===sessions[0].state.myId);
    assert.equal(declared.treasureClaim,0);
    for (const s of sessions.slice(1)) {
      const next=(await request('resume',s)).state.game;
      const p=next.players.find(p=>p.id===s.state.myId);
      assert.equal(p.treasureClaim,next.mySecret.counts.treasure,'5초 미응답 자동 선언은 진실이어야 합니다.');
    }
    assert.equal(state.game.playerCount,4);
    assert.equal(state.game.round,1);
    assert.ok(state.game.players.every(p=>!('role' in p)));
    assert.equal(state.game.mySecret.counts.empty+state.game.mySecret.counts.treasure+state.game.mySecret.counts.kraken,5);
    const acting=state.game.currentId;
    const actor=sessions.find(s=>s.state.myId===acting);
    const target=state.game.players.find(p=>p.id!==acting);
    const forbidden=await request('pick',{...sessions.find(s=>s!==actor),targetId:target.id,cardId:target.cards[0]});
    assert.equal(forbidden.status,409);
    const own=state.game.players.find(p=>p.id===acting);
    assert.equal((await request('pick',{...actor,targetId:acting,cardId:own.cards[0]})).status,409);
    assert.equal((await request('mark',{...actor,targetId:target.id,cardId:target.cards[0]})).status,200);
    assert.deepEqual((await request('resume',sessions[1])).state.game.pending,{actorId:acting,targetId:target.id,cardId:target.cards[0]});
    assert.equal((await request('pick',{...actor,targetId:target.id,cardId:target.cards[0]})).status,200);
    const after=(await request('resume',actor)).state.game;
    assert.equal(after.revealed.length,1);
    assert.equal(after.currentId,target.id);
    assert.equal((await request('chat',{...actor,text:'이 카드에 보물 있어요!'})).status,200);
    assert.equal((await request('resume',sessions[1])).state.messages.at(-1).text,'이 카드에 보물 있어요!');
    assert.equal((await request('join',{code:a.code,name:'늦은 참가자'})).status,409);
    assert.equal((await request('resume',{code:a.code,token:'wrong'})).status,401);
  } finally {
    for(const controller of connections) controller.abort();
  }
});

test.after(async()=>{ server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); });
