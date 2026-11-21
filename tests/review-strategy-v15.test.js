import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, publicGame, selectCard, finishShuffle, finishDarkIntro, finishRoleReveal, finishReview,
  finishDeclarations, finishRoundReveal, declareTreasure,
} from '../public/game-core.js';
import { analyzeDeclarations, createBotStance, botSpeak, chooseBotMove } from '../bot-ai.js';
const roster=n=>Array.from({length:n},(_,i)=>({id:`u${i}`,name:`플레이어${i}`,bot:true,difficulty:'hard'}));

test('5명은 보물 5개, 재분배 시 개인이 0장이었어도 4장을 새로 받음',()=>{
  const g=newGame(roster(5));
  assert.equal(g.players.flatMap(p=>p.hand).filter(c=>c.type==='treasure').length,5);
  const before=g.players.flatMap(p=>p.hand.map(c=>c.type));
  // First round ended: simulate five public empty-card reveals with the correct deck size.
  const empty=g.players.flatMap(p=>p.hand).filter(c=>c.type==='empty').slice(0,5);
  for(const card of empty){
    const owner=g.players.find(p=>p.hand.includes(card));
    owner.hand.splice(owner.hand.indexOf(card),1);
    g.revealed.push({type:'empty',round:1,ownerId:owner.id});
  }
  // A person has lost all cards (can happen in later rounds): ensure redistributing
  // all remaining cards is independent of old ownership.
  const emptied=g.players[0];
  const toMove=emptied.hand.splice(0);
  g.players[1].hand.push(...toMove);
  assert.equal(emptied.hand.length,0);
  const remainingTypes=g.players.flatMap(p=>p.hand.map(c=>c.type));
  assert.equal(remainingTypes.length,20);
  g.phase='shuffling';g.shuffleFromRound=1;g.round=1;
  finishShuffle(g);
  assert.equal(g.phase,'reviewing');
  assert.equal(g.round,2);
  assert.ok(g.players.every(p=>p.hand.length===4));
  assert.equal(g.players.find(p=>p.id===emptied.id).hand.length,4);
  assert.deepEqual(g.players.flatMap(p=>p.hand.map(c=>c.type)).sort(),remainingTypes.sort());
  assert.equal(g.revealed.length,5); // No revealed card returns to any hand.
});

test('5초 비공개 카드 확인 중 다른 사람 비밀은 숨겨지고 카드 선택과 선언은 막힘',()=>{
  const g=newGame(roster(5));
  finishDarkIntro(g);
  assert.equal(g.phase,'role-reveal');
  finishRoleReveal(g);
  finishShuffle(g);
  assert.equal(g.phase,'reviewing');
  assert.throws(()=>finishDeclarations(g),/선언 단계/);
  assert.throws(()=>declareTreasure(g,g.players[0].id,0),/선언 시간/);
  assert.throws(()=>selectCard(g,g.currentId,g.players[1].id,g.players[1].hand[0].id),/진행 중/);
  for(const p of g.players){
    const state=publicGame(g,p.id);
    assert.equal(state.mySecret.counts.empty+state.mySecret.counts.treasure+state.mySecret.counts.kraken,5);
    assert.ok(state.players.every(x=>!('hand' in x)&&!('role' in x)));
    assert.equal(state.players.find(x=>x.id===p.id).cards.length,5);
  }
  finishReview(g);
  assert.equal(g.phase,'declaring');
  declareTreasure(g,g.players[0].id,0);
  finishDeclarations(g);
  assert.equal(g.phase,'playing');
});

test('5인 선언 합 8 또는 3은 실제 5와 달라 의심 가능하지만 특정 거짓말쟁이는 모름',()=>{
  const g=newGame(roster(5));finishDarkIntro(g);finishRoleReveal(g);finishShuffle(g);finishReview(g);
  const claimed=[3,2,1,1,1];
  for(let i=0;i<5;i++) declareTreasure(g,g.players[i].id,claimed[i]);
  finishDeclarations(g);
  const view=publicGame(g,g.currentId);
  assert.deepEqual(analyzeDeclarations(view),{announced:8,availableAtStart:5,complete:true,difference:3});
  const reply=botSpeak(view,[],'hard',{type:'reply',text:'보물 합계가 이상하지?'},()=>0.2);
  assert.match(reply,/8개/);assert.match(reply,/5개/);assert.match(reply,/누군가/);
  const move=chooseBotMove(view,[],'hard',()=>0.3);
  assert.ok(view.players.some(p=>p.id===move.targetId));
  g.players.forEach((p,i)=>p.claim=[0,1,0,1,1][i]);
  assert.deepEqual(analyzeDeclarations(publicGame(g,g.currentId)),{announced:3,availableAtStart:5,complete:true,difference:-2});
});

test('크라켄과 보물을 함께 받은 탐험대도 의도적으로 0개라 속일 수 있음',()=>{
  const view={round:1,mySecret:{role:'crew',counts:{empty:2,treasure:2,kraken:1}}};
  const stance=createBotStance(view,'hard',()=>0.1);
  assert.equal(stance.treasureClaim,0);
  assert.equal(stance.krakenClaim,true);
  assert.match(botSpeak(view,[],'hard',{type:'reply',text:'보물 몇 개?',stance},()=>0.25),/0개/);
  const enemy={round:1,mySecret:{role:'skeleton',counts:{empty:3,treasure:2,kraken:0}}};
  assert.equal(createBotStance(enemy,'hard',()=>0.1).treasureClaim,1);
});
