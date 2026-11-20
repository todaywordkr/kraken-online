import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, publicGame, finishShuffle, finishDarkIntro, finishRoleReveal, finishReview, finishDeclarations, declareTreasure, selectCard, finishRoundReveal } from '../public/game-core.js';

const people=Array.from({length:5},(_,i)=>({id:`member-${i}`,name:`테스터${i+1}`}));

test('처음에만 암막 → 역할 공개 → 개인 카드 확인 → 보물 선언 → 게임 진행',()=>{
  const game=newGame(people);
  assert.equal(game.phase,'intro-dark');
  const target=game.players.find(p=>p.id!==game.currentId);
  assert.throws(()=>selectCard(game,game.currentId,target.id,target.hand[0].id),/진행 중/);
  assert.equal(publicGame(game,people[0].id).phase,'intro-dark');
  finishDarkIntro(game);
  assert.equal(game.phase,'role-reveal');
  assert.throws(()=>finishReview(game),/카드 확인 단계/);
  assert.throws(()=>finishDeclarations(game),/선언 단계/);
  assert.throws(()=>selectCard(game,game.currentId,target.id,target.hand[0].id),/진행 중/);
  assert.throws(()=>finishShuffle(game),/차례/);
  for(const viewer of game.players){
    const view=publicGame(game,viewer.id);
    assert.equal(view.mySecret.role,viewer.role);
    assert.ok(view.players.every(p=>!('role' in p)&&!('hand' in p)));
  }
  finishRoleReveal(game);
  assert.equal(game.phase,'shuffling');
  finishShuffle(game);
  assert.equal(game.phase,'reviewing');
  assert.throws(()=>finishRoleReveal(game),/역할 공개 단계/);
  finishReview(game);
  assert.equal(game.phase,'declaring');
  finishDeclarations(game);
  assert.equal(game.phase,'playing');
});

test('2라운드 이후에는 역할 공개 없이 바로 카드 확인으로 이어진다',()=>{
  const game=newGame(people);
  finishDarkIntro(game);finishRoleReveal(game);finishShuffle(game);finishReview(game);finishDeclarations(game);
  // Use the fixed 5-player round-deck rule to check the second-round transition.
  for(let index=0;index<5;index++){
    const target=game.players.find(p=>p.id!==game.currentId && p.hand.some(c=>c.type==='empty'));
    const card=target.hand.find(c=>c.type==='empty');
    selectCard(game,game.currentId,target.id,card.id);
  }
  assert.equal(game.phase,'round-end');
  // The public round-end transition preserves revealed results before dealing.
  finishRoundReveal(game);
  assert.equal(game.phase,'shuffling');
  finishShuffle(game);
  assert.equal(game.round,2);
  assert.equal(game.phase,'reviewing');
  assert.equal(game.roleEndsAt,null);
});

test('남은 보물 확정 수치와 선언 합계는 서로 독립적으로 계산되고 라운드마다 갱신된다',()=>{
  const game=newGame(people);
  let view=publicGame(game,people[0].id);
  assert.equal(view.remainingTreasure,5);
  assert.equal(view.declaredTreasure,0);
  assert.equal(view.declaredPlayers,0);
  finishDarkIntro(game);finishRoleReveal(game);finishShuffle(game);finishReview(game);
  const claims=[3,2,1,1,1];
  for(let i=0;i<claims.length;i++) {
    declareTreasure(game,people[i].id,claims[i]);
  }
  view=publicGame(game,people[0].id);
  assert.equal(view.declaredTreasure,8); // Intentional bluffing; total treasure is 5
  assert.equal(view.remainingTreasure,5);
  assert.equal(view.declaredPlayers,5);
  finishDeclarations(game);
  const owner=game.players.find(p=>p.id!==game.currentId && p.hand.some(c=>c.type==='treasure'));
  selectCard(game,game.currentId,owner.id,owner.hand.find(c=>c.type==='treasure').id);
  view=publicGame(game,people[0].id);
  assert.equal(view.remainingTreasure,4); // Only genuinely revealed treasure counts.
  assert.equal(view.declaredTreasure,8); // Votes cannot retroactively change.
  // Finish round with empty cards and demonstrate previous votes are cleared.
  while(game.phase==='playing'){
    const next=game.players.find(p=>p.id!==game.currentId && p.hand.some(c=>c.type==='empty'));
    selectCard(game,game.currentId,next.id,next.hand.find(c=>c.type==='empty').id);
  }
  finishRoundReveal(game);
  view=publicGame(game,people[0].id);
  assert.equal(view.phase,'shuffling');
  assert.equal(view.declaredTreasure,0);
  assert.equal(view.declaredPlayers,0);
  assert.equal(view.remainingTreasure,4);
});
