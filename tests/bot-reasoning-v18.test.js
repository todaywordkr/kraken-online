import test from 'node:test';
import assert from 'node:assert/strict';
import {newGame, publicGame, finishDarkIntro,finishRoleReveal,finishShuffle,finishReview,finishDeclarations,selectCard,finishRoundReveal,declareTreasure,maxTreasureClaim} from '../public/game-core.js';
import {analyzePublicEvidence,evaluateBotTargets,evidenceReaction} from '../bot-reasoning.js';
import {botSpeak,chooseBotMove,createBotStance} from '../bot-ai.js';
import {discussPublicReveal} from '../server.js';

function sample(role='crew',counts={treasure:0,kraken:0,empty:4}){
  const names=['나','0개 선원','2개 선원','평범한 선원'];
  return {
    round:1,phase:'playing',playerCount:4,currentId:'me',remainingTreasure:4,treasuresFound:0,
    mySecret:{role,counts},
    players:names.map((name,i)=>({id:i===0?'me':`p${i}`,name,bot:true,
      treasureClaim:[0,0,2,1][i],cards:Array.from({length:4},(_,j)=>`${i}-${j}`)})),
    revealed:[],
    claimHistory:[{round:1,playerId:'me',number:0},...Array.from({length:3},(_,i)=>({round:1,playerId:`p${i+1}`,number:[0,2,1][i]}))],
  };
}
const deterministic=()=>0.5;

test('선언 0/2 비교: 탐험대는 2개 선언을 우선 고려',()=>{
  const view=sample('crew');
  const ranked=evaluateBotTargets(view,[],'hard').scores;
  assert.ok(ranked.find(p=>p.targetId==='p2').expectedTreasure>ranked.find(p=>p.targetId==='p1').expectedTreasure);
  assert.equal(chooseBotMove(view,[],'hard',deterministic).targetId,'p2');
});

test('선언 0/2 비교: 스켈레톤은 낮은 보물/크라켄 가능성을 고려',()=>{
  const view=sample('skeleton');
  const byId=Object.fromEntries(evaluateBotTargets(view,[],'hard').scores.map(x=>[x.targetId,x]));
  assert.ok(byId.p1.expectedKraken>byId.p2.expectedKraken);
  assert.equal(chooseBotMove(view,[],'hard',deterministic).targetId,'p1');
});

test('스켈레톤/탐험대 모두 다른 사람의 비밀 카드 위치를 알 수 없다',()=>{
  const view=sample();
  const result=chooseBotMove(view,[],'hard',deterministic);
  assert.ok(view.players.find(p=>p.id===result.targetId).cards.includes(result.cardId));
  assert.ok(!view.players.some(p=>'hand' in p || 'role' in p));
  assert.ok(!JSON.stringify(evaluateBotTargets(view)).includes('secretHand'));
});

test('보물 0개 선언 후 보물 발견은 거짓말 확정, 역할 확정 아님',()=>{
  const view=sample();
  const reveal={id:'x',round:1,ownerId:'p1',actorId:'p2',type:'treasure'};
  view.revealed.push(reveal);
  view.players[1].cards.pop();
  const who=analyzePublicEvidence(view).people.find(p=>p.id==='p1');
  assert.equal(who.current.provenFalse,true);
  assert.equal(who.current.proof,'underclaim');
  assert.ok(who.credibility<0.77);
  const reaction=evidenceReaction(view,reveal);
  assert.match(reaction,/거짓|선언/);
  assert.match(reaction,/단정할 수 없/);
});

test('보물 4개 선언했는데 빈 상자 1개 공개되면 물리적으로 불가능',()=>{
  const view=sample();
  view.players[1].treasureClaim=4;
  view.claimHistory.find(c=>c.playerId==='p1').number=4;
  const reveal={round:1,ownerId:'p1',actorId:'p2',type:'empty'};
  view.revealed.push(reveal);
  view.players[1].cards.pop();
  const person=analyzePublicEvidence(view).people.find(p=>p.id==='p1');
  assert.equal(person.current.provenFalse,true);
  assert.equal(person.current.proof,'overclaim');
  assert.match(evidenceReaction(view,reveal),/빈 상자/);
});

test('2개 선언 후 빈 상자 1개 공개는 거짓말의 증거가 아니다',()=>{
  const view=sample();
  const reveal={round:1,ownerId:'p2',actorId:'p1',type:'empty'};
  view.revealed.push(reveal);
  view.players[2].cards.pop();
  assert.equal(analyzePublicEvidence(view).people.find(p=>p.id==='p2').current.provenFalse,false);
  assert.equal(evidenceReaction(view,reveal),null);
});

test('이전 라운드의 거짓말 신뢰도는 카드 재배분 후에도 기억된다',()=>{
  const view=sample();
  view.round=2;
  view.players[1].treasureClaim=null;
  view.players[2].treasureClaim=null;
  view.players[3].treasureClaim=null;
  view.revealed.push({round:1,ownerId:'p1',actorId:'p2',type:'treasure'});
  const people=analyzePublicEvidence(view).people;
  assert.ok(people.find(p=>p.id==='p1').credibility < people.find(p=>p.id==='p2').credibility);
  assert.equal(people.find(p=>p.id==='p1').falseRounds[0].round,1);
});

test('행동 기록: 0개 선언한 손패를 반복 선택하면 스켈레톤 의심 가중, 확정 아님',()=>{
  const view=sample();
  view.revealed.push({round:1,ownerId:'p1',actorId:'p3',type:'empty'});
  view.revealed.push({round:1,ownerId:'p1',actorId:'p3',type:'empty'});
  const [p3,p2]=['p3','p2'].map(id=>analyzePublicEvidence(view).people.find(p=>p.id===id));
  assert.ok(p3.skeletonSuspicion>p2.skeletonSuspicion);
  assert.ok(p3.skeletonSuspicion<1);
});

test('AI가 거짓말쟁이를 공개 정보로 지적하고 진영은 단정하지 않는다',()=>{
  const view=sample();
  view.revealed.push({round:1,ownerId:'p1',actorId:'p2',type:'treasure'});
  const msg=botSpeak(view,[],'hard',{type:'reply',text:'누가 거짓말했어?',stance:{treasureClaim:0,krakenClaim:false}},deterministic);
  assert.match(msg,/0개 선원/);
  assert.match(msg,/단정할 수/);
});

test('AI는 보물 합계 초과만으로 특정 사람이 거짓말한 것으로 확정하지 않는다',()=>{
  const view=sample();
  view.players[2].treasureClaim=4;
  view.claimHistory.find(x=>x.playerId==='p2').number=4;
  const analysis=analyzePublicEvidence(view);
  assert.ok(analysis.declaration.difference>0);
  assert.equal(analysis.people.filter(p=>p.current?.provenFalse).length,0);
});

test('공개된 역할과 손패 없는 선언 기록이 실제 게임 플레이 중 보존된다',()=>{
  const g=newGame(Array.from({length:8},(_,i)=>({id:`s${i}`,name:`선원${i}`,bot:true,difficulty:'hard'})));
  finishDarkIntro(g);finishRoleReveal(g);finishShuffle(g);finishReview(g);
  for(const p of g.players) declareTreasure(g,p.id,0);
  finishDeclarations(g);
  assert.equal(g.claimHistory.length,8);
  const stranger=publicGame(g,'s1');
  assert.equal(stranger.claimHistory.length,8);
  assert.ok(stranger.players.every(p=>!('hand' in p)&&!('role' in p)));
  assert.ok(stranger.claimHistory.every(c=>Object.keys(c).sort().join(',')==='number,playerId,round'));
  // Confirm a past-round lie objectively, then move to round 2.
  let opened=false;
  for(let i=0;i<8;i++) {
    const owner=g.players.find(p=>p.id!==g.currentId && p.hand.some(c=>c.type==='empty'));
    selectCard(g,g.currentId,owner.id,owner.hand.find(c=>c.type==='empty').id);
  }
  finishRoundReveal(g);finishShuffle(g);
  assert.equal(publicGame(g,'s2').claimHistory.length,8);
  assert.ok(g.players.every(p=>p.hand.length===7));
  finishReview(g);
  assert.equal(maxTreasureClaim(g,'s2'),7);
});

test('보물이 1개만 남았어도 손패가 7장이면 0~7 모두 선언 가능',()=>{
  const g=newGame(Array.from({length:8},(_,i)=>({id:`z${i}`,name:`참가${i}`})));
  finishDarkIntro(g);finishRoleReveal(g);finishShuffle(g);finishReview(g);
  // Only one treasure remains globally; player can still exaggerate.
  g.revealed=Array.from({length:7},(_,i)=>({round:0,type:'treasure',ownerId:'other'}));
  assert.equal(maxTreasureClaim(g,'z0'),8);
  assert.equal(declareTreasure(g,'z0',8),8);
  const stance=createBotStance({round:1,remainingTreasure:1,mySecret:{role:'skeleton',counts:{empty:7,treasure:0,kraken:1}}},'hard',()=>0.1);
  assert.equal(stance.treasureClaim,2);
});

test('AI끼리 거짓 선언을 지적하고 지적받은 AI가 대답한다 (서버 통합)',()=>{
  const roster=Array.from({length:5},(_,i)=>({id:`ai${i}`,name:`AI 동료${i}`,bot:true,difficulty:'hard'}));
  const game=newGame(roster);
  finishDarkIntro(game);finishRoleReveal(game);finishShuffle(game);finishReview(game);
  for(const p of game.players) declareTreasure(game,p.id,0);
  finishDeclarations(game);
  const owner=game.players.find(p=>p.hand.some(c=>c.type==='treasure'));
  const actor=game.players.find(p=>p.id!==owner.id);
  game.currentId=actor.id;
  const r=selectCard(game,actor.id,owner.id,owner.hand.find(c=>c.type==='treasure').id);
  const room={code:'FAKEROOM',hostId:'ai0',game,messages:[],players:roster.map(p=>({...p,streams:new Set(),ready:true})),aiEvidenceAlerts:new Set()};
  discussPublicReveal(room,r);
  assert.equal(room.messages.length,2);
  assert.notEqual(room.messages[0].playerId,owner.id);
  assert.equal(room.messages[1].playerId,owner.id);
  assert.match(room.messages[0].text,/거짓|보물/);
  assert.match(room.messages[1].text,/전략/);
  const oldMessages=room.messages.length;
  discussPublicReveal(room,r);
  assert.equal(room.messages.length,oldMessages,'같은 라운드 동일 대상 중복 추궁 방지');
});
