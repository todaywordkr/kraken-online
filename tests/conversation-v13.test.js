import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';
import { classifyCardQuestion, createBotStance, botSpeak } from '../bot-ai.js';
import { newGame, publicGame, selectCard, finishShuffle,finishDeclarations,finishRoundReveal } from '../public/game-core.js';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const roster = Array.from({length:4},(_,i)=>({ id:`p${i}`,name:`선원${i}` }));

test('카드 질문 구분, 주장 일관성, 크라켄의 전략적 답변', () => {
  assert.deepEqual(classifyCardQuestion('보물 몇 개야?'), { treasure:true,kraken:false,cardQuestion:true });
  assert.deepEqual(classifyCardQuestion('크라켄 있어?'), { treasure:false,kraken:true,cardQuestion:true });
  assert.equal(classifyCardQuestion('안녕').cardQuestion,false);
  const view = {
    round:2,
    mySecret:{role:'skeleton',counts:{empty:3,treasure:0,kraken:1}},revealed:[],
  };
  const stance = createBotStance(view, 'hard', ()=>0);
  assert.equal(stance.treasureClaim,1); // A hard skeleton may entice crew with a false treasure count.
  assert.equal(stance.krakenClaim,false); // It may deny its Kraken to invite an attack.
  const a = botSpeak(view,[], 'hard', {type:'reply',text:'보물 몇 개야?',stance},()=>0);
  const b = botSpeak(view,[], 'hard', {type:'reply',text:'크라켄 있어?',stance},()=>0);
  assert.match(a,/보물 1개/);
  assert.match(b,/크라켄.*없/);
  assert.match(botSpeak(view,[], 'hard', {type:'reply',text:'보물 몇 개야?',stance},()=>0),/1개/);
});

test('탐험 기록에 이전 라운드 종료와 다음 라운드 시작이 합쳐서 남는다',()=>{
  const g = newGame(roster);finishShuffle(g);finishDeclarations(g);
  for (let i=0;i<4;i++) {
    const target = g.players.find(p=>p.id!==g.currentId && p.hand.some(c=>c.type==='empty'));
    selectCard(g,g.currentId,target.id,target.hand.find(c=>c.type==='empty').id);
  }
  assert.equal(g.phase,'round-end');
  finishRoundReveal(g);finishShuffle(g);
  assert.ok(g.log.some(x=>x.message.includes('1라운드 종료 → 2라운드 시작')));
});

const server=createServer({botDelayMs:100_000,replyDelayMs:400,shuffleDelayMs:40,claimDelayMs:75,revealDelayMs:70});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const api=async (action,data={})=>{
  const response=await fetch(origin+'/api/'+action, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  return {status:response.status,...await response.json()};
};
const waitFor = async(predicate, timeout=3000) => {
  const end=Date.now()+timeout;
  while(Date.now()<end) {const val=await predicate();if(val) return val;await pause(35);}
  throw Error('기대하는 서버 상태를 기다리다가 제한 시간을 초과했습니다.');
};
test('아직 말하지 않은 AI에게 질문해도 답하고, 짧은 간격의 두 질문도 잃지 않는다',async()=>{
  const owner=await api('create',{name:'사람'});
  assert.equal(owner.status,200);
  const connection=new AbortController();
  const stream=await fetch(`${origin}/api/events?code=${owner.code}&token=${owner.token}`,{signal:connection.signal});
  assert.equal(stream.status,200);
  try {
    for(let i=0;i<3;i++) assert.equal((await api('add-bot',{...owner,difficulty:'hard'})).status,200);
    assert.equal((await api('start',owner)).status,200);
    await pause(170);
    const starting=(await api('resume',owner)).state;
    const bots=starting.players.filter(p=>p.bot);
    assert.equal(bots.length,3);
    assert.ok(starting.messages.some(m=>m.kind==='system' && m.round===1));
    const silent=bots.find(p=>!starting.messages.some(m=>m.playerId===p.id));
    assert.ok(silent,'One of three bots has not introduced itself yet');
    assert.equal((await api('chat',{...owner,text:`${silent.name} 보물 몇 개야?`})).status,200);
    await pause(455); // Human chat rate limit is 450 ms.
    assert.equal((await api('chat',{...owner,text:`${silent.name} 크라켄 있어?`})).status,200);
    const answers = await waitFor(async()=>{
      const state=(await api('resume',owner)).state;
      const replies=state.messages.filter(m=>m.playerId===silent.id);
      return replies.length>=2 ? replies : null;
    });
    assert.match(answers[0].text,/보물.*\d+개/);
    assert.match(answers[1].text,/크라켄/);
    assert.ok(answers.every(answer=>answer.round===1));
    const visitor=(await api('resume',owner)).state;
    assert.ok(visitor.game.players.every(p=>!('role' in p)),'AI roles should remain private');
    assert.ok(visitor.game.players.every(p=>!('hand' in p)),'card order should remain private');
  } finally { connection.abort(); }
});
test.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
