import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newGame, publicGame, selectCard, finishDarkIntro, finishRoleReveal,
  finishShuffle, finishReview, finishDeclarations, finishRoundReveal,
  declareTreasure, maxTreasureClaim,
} from '../public/game-core.js';
import { createBotStance, botSpeak } from '../bot-ai.js';

const roster = n => Array.from({length:n},(_,i)=>({id:`v17-${i}`,name:`선원 ${i}`,bot:true,difficulty:'hard'}));
const proceed = g => { finishDarkIntro(g); finishRoleReveal(g); finishShuffle(g); finishReview(g); finishDeclarations(g); };
const cardTypes = g => g.players.flatMap(p=>p.hand.map(c=>c.type));

// Rule requested in v1.7: N players hold N cards at start, with one per-person
// card removed each round. Only 4 rounds, unchanged from earlier house rules.
test('인원수별 N×N 덱 구성: 8명은 정확히 64장 = 크라켄 1 + 보물 8 + 빈 상자 55',()=>{
  for (let n=4;n<=8;n++) {
    const g=newGame(roster(n));
    assert.equal(cardTypes(g).length,n*n);
    assert.equal(cardTypes(g).filter(t=>t==='empty').length,n*n-n-1);
    assert.equal(cardTypes(g).filter(t=>t==='treasure').length,n);
    assert.equal(cardTypes(g).filter(t=>t==='kraken').length,1);
    assert.ok(g.players.every(p=>p.hand.length===n));
  }
});

test('8인 선언은 0~8개, 9개를 거절하며 다른 사람 손패는 공개되지 않음',()=>{
  const g=newGame(roster(8));
  finishDarkIntro(g); finishRoleReveal(g); finishShuffle(g); finishReview(g);
  const viewer=g.players[0].id;
  assert.equal(maxTreasureClaim(g,viewer),8);
  assert.equal(publicGame(g,viewer).players[0].claimMax,8);
  assert.throws(()=>declareTreasure(g,viewer,9),/0~8/);
  assert.equal(declareTreasure(g,viewer,8),8);
  const state=publicGame(g,g.players[1].id);
  assert.equal(state.players[0].treasureClaim,8);
  assert.equal(state.players[0].cards.length,8);
  assert.ok(state.players.every(p=>!('hand' in p)&&!('role' in p)));
});

test('8인 4라운드: 8 → 7 → 6 → 5장, 공개한 카드는 돌아오지 않는다',()=>{
  const g=newGame(roster(8));
  proceed(g);
  for (let round=1;round<=4;round++) {
    assert.equal(g.round,round);
    assert.ok(g.players.every(p=>p.hand.length===9-round));
    for (let i=0;i<8;i++) {
      const owner=g.players.find(p=>p.id!==g.currentId && p.hand.some(c=>c.type==='empty'));
      assert.ok(owner, '다른 플레이어가 공개 가능한 빈 상자를 가지고 있어야 합니다.');
      selectCard(g,g.currentId,owner.id,owner.hand.find(c=>c.type==='empty').id);
    }
    assert.equal(g.phase,'round-end');
    assert.equal(g.revealed.length,round*8);
    if(round<4) {
      finishRoundReveal(g);
      assert.equal(g.phase,'shuffling');
      finishShuffle(g);
      assert.equal(cardTypes(g).length,(8-round)*8);
      finishReview(g); finishDeclarations(g);
    }
  }
  assert.equal(g.winner,'skeleton');
  finishRoundReveal(g);
  assert.equal(g.phase,'finished');
  assert.equal(cardTypes(g).filter(t=>t==='treasure').length,8);
  assert.equal(cardTypes(g).filter(t=>t==='kraken').length,1);
});

const aiView=(role,treasure,kraken,empty,remainingTreasure=8) => ({
  round:1, remainingTreasure,
  mySecret: {role,counts:{treasure,kraken,empty}},
});

test('어려움 스켈레톤: 크라켄 보유 시 보물 있다고 유인하고 크라켄은 부인한다',()=>{
  const state=createBotStance(aiView('skeleton',0,1,7),'hard',()=>0.1);
  assert.ok(state.treasureClaim>0 && state.treasureClaim<=8);
  assert.equal(state.krakenClaim,false);
  const view=aiView('skeleton',0,1,7);
  assert.match(botSpeak(view,[],'hard',{type:'reply',text:'크라켄 있어?',stance:state},()=>0),/없/);
  assert.match(botSpeak(view,[],'hard',{type:'reply',text:'보물 몇 개?',stance:state},()=>0),new RegExp(`${state.treasureClaim}개`));
});

test('어려움 스켈레톤: 보물 2개를 1개 또는 0개로 축소 선언',()=>{
  const view=aiView('skeleton',2,0,6);
  assert.equal(createBotStance(view,'hard',()=>0.1).treasureClaim,1);
  // For a deterministic high random number: direct 0-claim branch.
  assert.equal(createBotStance(view,'hard',()=>0.9).treasureClaim,0);
});

test('어려움 탐험대: 보물 + 크라켄 동시 보유 시 보물 0개로 숨긴다',()=>{
  const view=aiView('crew',2,1,5);
  const stance=createBotStance(view,'hard',()=>0.7);
  assert.equal(stance.treasureClaim,0);
  assert.equal(stance.krakenClaim,true);
});

test('어려움 AI는 8인 카드 8장 한도를 넘지 않으면서 남은 보물 수 이상으로 거짓말할 수 있다',()=>{
  const lure=createBotStance(aiView('skeleton',5,1,2,8),'hard',()=>0.1);
  assert.ok(lure.treasureClaim>=5 && lure.treasureClaim<=8);
  const capped=createBotStance(aiView('skeleton',0,1,7,1),'hard',()=>0.1);
  assert.equal(capped.treasureClaim,2); // The claim may exceed the actual global treasure supply.
});
