import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, publicGame, finishDarkIntro, finishRoleReveal, finishShuffle, finishReview, declareTreasure } from '../public/game-core.js';

test('8인 보물 선언 화면에는 0~8개 버튼 9개가 실제 렌더링된다', async () => {
  const roster=Array.from({length:8},(_,i)=>({id:`p${i}`,name:`선원${i}`,bot:i>0,difficulty:'normal'}));
  const game=newGame(roster);
  finishDarkIntro(game);finishRoleReveal(game);finishShuffle(game);finishReview(game);
  const session={code:'V17TST',token:'fake',name:'선원0'};
  const room=()=>({code:session.code,myId:'p0',hostId:'p0',
    players:roster.map(p=>({...p,ready:true,connected:true})),
    game:publicGame(game,'p0'),messages:[],
  });
  const root={innerHTML:''};
  globalThis.location={search:'',href:'http://local.test/',origin:'http://local.test',pathname:'/'};
  globalThis.history={replaceState(){}};
  const storage=new Map([['kraken-online-session',JSON.stringify(session)]]);
  globalThis.localStorage={getItem(){return null},setItem(){},removeItem(){}};
  globalThis.sessionStorage={getItem(k){return storage.get(k)},setItem(k,v){storage.set(k,v)},removeItem(k){storage.delete(k)}};
  globalThis.document={activeElement:null,querySelector(selector){return selector==='#app'?root:null},addEventListener(){}};
  globalThis.EventSource=class{close(){}};
  globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,code:session.code,token:session.token,state:room()})});
  await import('../public/app.js');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.match(root.innerHTML,/many-players/);
  assert.equal((root.innerHTML.match(/data-action="declare-treasure"/g)||[]).length,9);
  assert.match(root.innerHTML,/data-number="0"/);
  assert.match(root.innerHTML,/data-number="8"/);
  assert.doesNotMatch(root.innerHTML,/data-number="9"/);
  assert.equal((root.innerHTML.match(/data-action="pick"/g)||[]).length,64);
  declareTreasure(game,'p0',8);
  // The selected claim remains public while other secret cards stay private.
  assert.equal(publicGame(game,'p1').players[0].treasureClaim,8);
  assert.ok(publicGame(game,'p1').players.every(p=>!('hand' in p)));
});
