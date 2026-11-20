import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, publicGame, selectCard, markCard, clearMark, ROLE_COUNTS } from '../public/game-core.js';

const roster = n => Array.from({length:n}, (_,i)=>({id:`player-${i}`,name:`항해사 ${i+1}`}));
const count = (game, kind) => game.players.flatMap(p=>p.hand).filter(c=>c.type===kind).length + game.revealed.filter(c=>c.type===kind).length;

test('4~8명별 카드 수, 비밀 역할 수, 손패 배분', () => {
  for (let n=4;n<=8;n++) {
    const g = newGame(roster(n));
    assert.equal(g.phase,'playing');
    assert.equal(g.round,1);
    assert.equal(count(g,'empty'),4*n-1);
    assert.equal(count(g,'treasure'),n);
    assert.equal(count(g,'kraken'),1);
    assert.ok(g.players.every(p=>p.hand.length===5));
    const crew=g.players.filter(p=>p.role==='crew').length;
    const sk=g.players.filter(p=>p.role==='skeleton').length;
    assert.equal(crew+sk,n);
    assert.ok(crew>=ROLE_COUNTS[n].crew-1 && crew<=ROLE_COUNTS[n].crew);
    assert.ok(sk>=ROLE_COUNTS[n].skeleton-1 && sk<=ROLE_COUNTS[n].skeleton);
  }
});

test('각 사용자는 자신의 역할과 카드 종류별 개수만 받는다', () => {
  const g=newGame(roster(4));
  const v=publicGame(g,'player-1');
  assert.equal(v.mySecret.role,g.players[1].role);
  assert.equal(Object.values(v.mySecret.counts).reduce((a,b)=>a+b),5);
  assert.equal(v.players.length,4);
  assert.ok(v.players.every(p=>!('role' in p)));
  assert.ok(v.players.every(p=>p.cards.every(c=>typeof c==='string')));
  assert.ok(!('hand' in v.players[1]));
  const other=publicGame(g,'player-2');
  assert.equal(other.mySecret.role,g.players[2].role);
  assert.notEqual(v.mySecret,other.mySecret);
});

test('타인 카드만 열 수 있고 카드 소유자가 다음 행동자가 된다', () => {
  const g=newGame(roster(5));
  const actor=g.currentId;
  const own=g.players.find(p=>p.id===actor);
  assert.throws(()=>selectCard(g,actor,actor,own.hand[0].id),/자기 카드/);
  const target=g.players.find(p=>p.id!==actor && p.hand.some(c=>c.type==='empty'));
  const selected=target.hand.find(c=>c.type==='empty');
  assert.throws(()=>selectCard(g,'fake',target.id,selected.id),/차례/);
  const revealed=selectCard(g,actor,target.id,selected.id);
  assert.equal(revealed.type,'empty');
  assert.equal(g.currentId,target.id);
  assert.equal(g.revealed.length,1);
  assert.equal(target.hand.length,4);
  assert.throws(()=>selectCard(g,target.id,actor,selected.id),/존재하지 않는/);
});

test('한 라운드에 인원수만큼 공개 시 다시 섞어 인당 4장을 배분한다', () => {
  const g=newGame(roster(4));
  for(let i=0;i<4;i++) {
    const target=g.players.find(p=>p.id!==g.currentId && p.hand.some(c=>c.type==='empty'));
    assert.ok(target);
    selectCard(g,g.currentId,target.id,target.hand.find(c=>c.type==='empty').id);
  }
  assert.equal(g.round,2);
  assert.equal(g.actionInRound,0);
  assert.equal(g.revealed.length,4);
  assert.equal(g.phase,'playing');
  assert.ok(g.players.every(p=>p.hand.length===4));
  assert.equal(count(g,'kraken'),1);
});

test('크라켄이 공개되면 즉시 스켈레톤이 승리하고 정체가 공개된다', () => {
  const g=newGame(roster(4));
  const krakenOwner=g.players.find(p=>p.hand.some(c=>c.type==='kraken'));
  if(g.currentId===krakenOwner.id) g.currentId=g.players.find(p=>p.id!==krakenOwner.id).id;
  selectCard(g,g.currentId,krakenOwner.id,krakenOwner.hand.find(c=>c.type==='kraken').id);
  assert.equal(g.phase,'finished');
  assert.equal(g.winner,'skeleton');
  assert.ok(publicGame(g,g.currentId).players.every(p=>p.role));
});

test('선택 마커는 공개되고, 차례인 사람만 변경·취소할 수 있다', () => {
  const g=newGame(roster(4));
  const actor=g.currentId;
  const target=g.players.find(p=>p.id!==actor);
  markCard(g,actor,target.id,target.hand[0].id);
  assert.deepEqual(publicGame(g,actor).pending,{ actorId:actor,targetId:target.id,cardId:target.hand[0].id });
  assert.throws(()=>clearMark(g,target.id),/차례/);
  assert.throws(()=>selectCard(g,actor,target.id,target.hand[1].id),/표시된 카드만/);
  clearMark(g,actor);
  assert.equal(publicGame(g,actor).pending,null);
});

test('네 번째 라운드가 끝나면 스켈레톤이 승리한다', () => {
  const g=newGame(roster(4));
  g.round=4;g.actionInRound=3;
  const target=g.players.find(p=>p.id!==g.currentId && p.hand.some(c=>c.type==='empty'));
  selectCard(g,g.currentId,target.id,target.hand.find(c=>c.type==='empty').id);
  assert.equal(g.winner,'skeleton');
  assert.equal(g.phase,'finished');
});
