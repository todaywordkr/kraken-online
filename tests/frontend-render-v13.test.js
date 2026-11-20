import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, publicGame, selectCard, finishShuffle, finishDarkIntro, finishRoleReveal,finishReview,finishDeclarations,finishRoundReveal,declareTreasure } from '../public/game-core.js';

// Lightweight DOM harness: validate browser-facing templates without installing dependencies.
test('채팅 질문 버튼·라운드 배지·페이드 로더가 실제 앱 템플릿에서 렌더링된다', async () => {
  const roster = Array.from({length:4},(_,i)=>({id:`p${i}`,name:i?`AI 테스터${i}`:'사람',bot:i>0,difficulty:'normal'}));
  const game=newGame(roster);finishDarkIntro(game);finishRoleReveal(game);finishShuffle(game);finishReview(game);finishDeclarations(game);
  const session={code:'TEST12',token:'test-token',name:'사람'};
  const room=()=>({
    code:session.code, myId:roster[0].id,hostId:roster[0].id,
    players:roster.map((p)=>({id:p.id,name:p.name,bot:p.bot,difficulty:p.difficulty,ready:true,connected:true})),
    game:publicGame(game,roster[0].id),
    messages:[
      {id:'sys',kind:'system',round:1,text:'1라운드 시작',name:'항해 안내'},
      {id:'bot-a',bot:true,round:1,playerId:'p1',name:roster[1].name,text:'보물 2개입니다.'},
    ],
  });
  const root={innerHTML:''};
  const listeners={};
  globalThis.location={search:'',href:'http://local.test/',origin:'http://local.test',pathname:'/'};
  globalThis.history={replaceState(){}};
  const storage=new Map([['kraken-online-session',JSON.stringify(session)]]);
  globalThis.localStorage={getItem(){return null},setItem(){},removeItem(){}};
  globalThis.sessionStorage={getItem(k){return storage.get(k)},setItem(k,v){storage.set(k,v)},removeItem(k){storage.delete(k)}};
  globalThis.document={
    activeElement:null,
    querySelector(selector){return selector==='#app'?root:null},
    addEventListener(type,handler){listeners[type]=handler},
  };
  let stream;
  globalThis.EventSource=class {constructor(){stream=this}close(){}};
  globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,code:session.code,token:session.token,state:room()})});
  await import('../public/app.js');
  await new Promise(resolve=>setTimeout(resolve,20));
  // UI changes are viewer-private; initial blackout and reveal must cover the game.
  game.phase='intro-dark';game.shuffleFromRound=0;
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/intro-dark-overlay/);
  assert.match(root.innerHTML,/잠시 후 당신의 역할을 공개합니다/);
  game.phase='role-reveal';game.roleEndsAt=Date.now()+3000;
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/intro-role-overlay/);
  assert.match(root.innerHTML,/data-role-countdown/);
  assert.match(root.innerHTML,new RegExp(game.players[0].role === 'crew' ? '탐험대' : '스켈레톤'));
  assert.doesNotMatch(root.innerHTML,/내 카드 확인 시간/);
  game.phase='playing';game.roleEndsAt=null;
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/AI에게 직접 질문/);
  assert.match(root.innerHTML,/data-topic="treasure"/);
  assert.match(root.innerHTML,/data-topic="kraken"/);
  assert.match(root.innerHTML,/1라운드/);
  assert.match(root.innerHTML,/1R 발언/);
  assert.match(root.innerHTML,/이전 라운드 발언은 현재 손패와 다를 수 있습니다/);
  assert.match(root.innerHTML,/class="chat-count"/);
  const firstCards=game.players.length;
  for(let i=0;i<firstCards;i++) {
    const target=game.players.find(p=>p.id!==game.currentId && p.hand.some(c=>c.type==='empty'));
    selectCard(game,game.currentId,target.id,target.hand.find(c=>c.type==='empty').id);
  }
  assert.equal(game.phase,'round-end');
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/마지막 카드 공개/);
  finishRoundReveal(game);
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/shuffle-spinner/);
  assert.match(root.innerHTML,/카드 섞는 중/);
  assert.doesNotMatch(root.innerHTML,/shuffle-deck/);
  finishShuffle(game);
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/내 카드 확인/);
  assert.match(root.innerHTML,/data-review-countdown/);
  assert.match(root.innerHTML,/review-card/);
  assert.doesNotMatch(root.innerHTML,/data-action=\"declare-treasure\"/);
  finishReview(game);
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/data-action=\"declare-treasure\"/);
  assert.match(root.innerHTML,/보물 선언/);
  assert.match(root.innerHTML,/data-claim-countdown/);
  declareTreasure(game,roster[0].id,0);
  stream.onmessage({data:JSON.stringify(room())});
  assert.match(root.innerHTML,/◆ 0개/);
});
