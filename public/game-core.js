/** Shared, deterministic rule transitions. Never send this full game object to an online client. */
export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 8;
export const MAX_ROUNDS = 4;
export const ROLE_COUNTS = {
  4: { crew: 3, skeleton: 2 },
  5: { crew: 4, skeleton: 2 },
  6: { crew: 4, skeleton: 2 },
  7: { crew: 5, skeleton: 3 },
  8: { crew: 6, skeleton: 3 },
};
export const CARD_LABELS = { empty: '빈 상자', treasure: '보물 상자', kraken: '크라켄' };

function randomInt(max) {
  if (globalThis.crypto?.getRandomValues) {
    const a = new Uint32Array(1);
    const bound = 0x100000000 - (0x100000000 % max);
    do { globalThis.crypto.getRandomValues(a); } while (a[0] >= bound);
    return a[0] % max;
  }
  return Math.floor(Math.random() * max);
}
function shuffle(values) {
  const a = [...values];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function totals(hand) {
  return {
    empty: hand.filter((c) => c.type === 'empty').length,
    treasure: hand.filter((c) => c.type === 'treasure').length,
    kraken: hand.filter((c) => c.type === 'kraken').length,
  };
}
function deal(game, types) {
  const shuffled = shuffle(types);
  const perPlayer = shuffled.length / game.players.length;
  if (!Number.isInteger(perPlayer)) throw new Error('카드를 균등하게 나눌 수 없습니다.');
  game.players.forEach((p, idx) => {
    const slice = shuffled.slice(idx * perPlayer, (idx + 1) * perPlayer);
    p.hand = shuffle(slice.map((type) => ({ id: `c${game.nextCardId++}`, type })));
  });
}
export function newGame(roster) {
  if (!Array.isArray(roster) || roster.length < MIN_PLAYERS || roster.length > MAX_PLAYERS) {
    throw new Error('플레이어는 4~8명이 필요합니다.');
  }
  if (new Set(roster.map((p) => p.id)).size !== roster.length) throw new Error('중복된 플레이어 ID가 있습니다.');
  const count = roster.length;
  // Role deck can contain one unused card; remove the unused card without showing it.
  const settings = ROLE_COUNTS[count];
  const roles = shuffle([
    ...Array(settings.crew).fill('crew'),
    ...Array(settings.skeleton).fill('skeleton'),
  ]).slice(0, count);
  const game = {
    phase: 'intro-dark', round: 1, actionInRound: 0, nextCardId: 1,
    players: roster.map((p, i) => ({ id: p.id, name: p.name, bot: Boolean(p.bot), difficulty: p.bot ? p.difficulty : null, role: roles[i], hand: [], claim: null })),
    currentId: roster[randomInt(count)].id,
    revealed: [], lastReveal: null, pending: null, winner: null, endReason: null, log: [], shuffleEndsAt: null, shuffleFromRound: 0, darkEndsAt: null, roleEndsAt: null, reviewEndsAt: null, claimEndsAt: null, roundEndAt: null, pendingTransition: null,
  };
  deal(game, [
    ...Array(4 * count - 1).fill('empty'),
    ...Array(count).fill('treasure'),
    'kraken',
  ]);
  game.log.push({ kind: 'start', message: `항해 시작! ${count}명의 플레이어가 4라운드에 도전합니다.` });
  return game;
}

function validatedChoice(game, actorId, targetId, cardId) {
  if (game.phase !== 'playing') throw new Error('현재 진행 중인 게임이 아닙니다.');
  if (game.currentId !== actorId) throw new Error('현재 행동할 차례가 아닙니다.');
  if (actorId === targetId) throw new Error('자기 카드는 선택할 수 없습니다.');
  const owner = game.players.find(p => p.id === targetId);
  if (!owner) throw new Error('해당 플레이어가 없습니다.');
  const idx = owner.hand.findIndex(c => c.id === cardId);
  if (idx < 0) throw new Error('이미 공개했거나 존재하지 않는 카드입니다.');
  return { owner, idx };
}
/** A public action marker. Anyone can see which card is being discussed. */
export function markCard(game, actorId, targetId, cardId) {
  validatedChoice(game, actorId, targetId, cardId);
  game.pending = { actorId, targetId, cardId };
  return game.pending;
}
export function clearMark(game, actorId) {
  if (game.phase !== 'playing' || game.currentId !== actorId) throw new Error('현재 행동할 차례가 아닙니다.');
  game.pending = null;
}

export function selectCard(game, actorId, targetId, cardId) {
  const { owner, idx } = validatedChoice(game, actorId, targetId, cardId);
  if (game.pending && (game.pending.actorId !== actorId || game.pending.targetId !== targetId || game.pending.cardId !== cardId)) throw new Error('현재 표시된 카드만 공개할 수 있습니다.');
  game.pending = null;
  const [card] = owner.hand.splice(idx, 1);
  const actor = game.players.find((p) => p.id === actorId);
  const reveal = {
    id: card.id, type: card.type, ownerId: owner.id,
    ownerName: owner.name, actorName: actor.name, round: game.round,
  };
  game.revealed.push(reveal);
  game.lastReveal = reveal;
  game.actionInRound++;
  game.currentId = owner.id;
  game.log.push({ kind: card.type, message: `${actor.name}님이 ${owner.name}님의 카드를 열었습니다: ${CARD_LABELS[card.type]}` });

  if (card.type === 'kraken') {
    game.winner = 'skeleton';
    game.endReason = '크라켄이 깨어났습니다!';
  } else if (game.revealed.filter((r) => r.type === 'treasure').length === game.players.length) {
    game.winner = 'crew';
    game.endReason = '모든 보물을 찾았습니다!';
  } else if (game.actionInRound === game.players.length && game.round === MAX_ROUNDS) {
    game.winner = 'skeleton';
    game.endReason = '4라운드가 끝날 때까지 보물을 모두 찾지 못했습니다.';
  }
  if (game.winner || game.actionInRound === game.players.length) {
    // Keep the last revealed card fully visible before switching screens.
    game.phase = 'round-end';
    game.pendingTransition = game.winner ? 'finish' : 'shuffle';
    game.log.push({ kind:'round', message:`${game.round}라운드 마지막 공개 카드를 확인하는 중입니다.` });
  }
  return reveal;
}

/** Server-controlled pause after the final reveal; no immediate screen change. */
export function finishRoundReveal(game) {
  if (game.phase !== 'round-end') throw new Error('마지막 카드를 확인하는 중이 아닙니다.');
  game.roundEndAt = null;
  if (game.pendingTransition === 'finish') {
    game.phase = 'finished';
    game.log.push({kind:'round',message:`${game.round}라운드 종료 · 게임이 끝났습니다.`});
  } else {
    game.phase = 'shuffling';
    game.shuffleFromRound = game.round;
    game.players.forEach(p => {p.claim = null;}); // Stale last-round votes must not appear as this round's votes.
    game.log.push({kind:'round',message:`${game.round}라운드 종료 → ${game.round+1}라운드 준비 · 남은 카드를 섞습니다.`});
  }
  game.pendingTransition = null;
}

/** The first game starts with a 2-second blackout, then a private role reveal. */
export function finishDarkIntro(game) {
  if (game.phase !== 'intro-dark' || game.round !== 1) throw new Error('처음 암막 단계가 아닙니다.');
  game.phase = 'role-reveal';
  game.darkEndsAt = null;
  game.roleEndsAt = null;
  game.log.push({kind:'role',message:'1라운드 · 각 플레이어가 자신의 비밀 역할을 3초 동안 확인합니다.'});
}

/** Called by the server after the initial or between-round shuffle finishes. */
export function finishShuffle(game) {
  if (game.phase !== 'shuffling') throw new Error('카드를 다시 섞을 차례가 아닙니다.');
  if (game.shuffleFromRound) {
    if (game.round >= MAX_ROUNDS) throw new Error('마지막 라운드 이후에는 섞을 수 없습니다.');
    // Revealed cards NEVER return to the deck.
    const remaining = game.players.flatMap((p) => p.hand.map((c) => c.type));
    game.round++;
    game.actionInRound = 0;
    deal(game, remaining);
    game.log.push({kind:'round',message:`${game.round-1}라운드 종료 → ${game.round}라운드 시작! 카드 재배분을 완료했습니다.`});
  } else {
    game.log.push({kind:'round',message:'1라운드 시작 · 카드 섞기 완료!'});
  }
  // Both the first round and all later rounds proceed to a private 5-second card check.
  // Role reveal happens before the *first* shuffle and is never repeated.
  game.phase = 'reviewing';
  game.shuffleEndsAt = null;
  game.roleEndsAt = null;
  game.reviewEndsAt = null;
  game.claimEndsAt = null;
  game.players.forEach(p=>{p.claim = null;});
  game.log.push({kind:'review',message:`${game.round}라운드 카드 확인 · 각자 자신의 카드 구성을 5초 동안 확인합니다.`});
}

/** The 3-second role reveal is only shown on the initial round. */
export function finishRoleReveal(game) {
  if (game.phase !== 'role-reveal' || game.round !== 1) throw new Error('역할 공개 단계가 아닙니다.');
  game.phase = 'shuffling';
  game.roleEndsAt = null;
  game.shuffleEndsAt = null;
  game.log.push({kind:'round',message:'1라운드 시작 · 비밀 역할 확인 완료 → 카드를 3초 동안 섞습니다.'});
}

/** All players inspect their own five/four/three/two card faces for five seconds. */
export function finishReview(game) {
  if (game.phase !== 'reviewing') throw new Error('카드 확인 단계가 아닙니다.');
  game.phase = 'declaring';
  game.reviewEndsAt = null;
  game.claimEndsAt = null; // Server starts the next five-second window.
  game.log.push({kind:'declare',message:`${game.round}라운드 카드 확인 완료 → 5초 동안 보물 개수를 선언하세요.`});
}

/** Public maximum: never exceed the size of this player's hand or remaining global treasures. */
export function maxTreasureClaim(game, playerId) {
  const player = game.players.find(p=>p.id===playerId);
  if (!player) throw new Error('선언할 플레이어를 찾을 수 없습니다.');
  return Math.min(player.hand.length, game.players.length - game.revealed.filter(c=>c.type==='treasure').length);
}

/** Declaring can be a bluff; the true amount stays server-side. */
export function declareTreasure(game, playerId, number) {
  if (game.phase !== 'declaring') throw new Error('지금은 보물 개수 선언 시간이 아닙니다.');
  const player = game.players.find(p=>p.id === playerId);
  if (!player) throw new Error('선언할 플레이어를 찾을 수 없습니다.');
  if (player.claim !== null) throw new Error('이미 보물 개수를 선언했습니다.');
  const max = maxTreasureClaim(game, playerId);
  if (!Number.isInteger(number) || number < 0 || number > max) throw new Error(`보물 개수는 0~${max} 사이에서 골라주세요.`);
  player.claim = number;
  return number;
}

/** At the five-second deadline, missing declarations become truthful automatically. */
export function finishDeclarations(game) {
  if (game.phase !== 'declaring') throw new Error('보물 개수 선언 단계가 아닙니다.');
  for (const player of game.players) {
    if (player.claim === null) player.claim = totals(player.hand).treasure;
  }
  game.phase = 'playing';
  game.claimEndsAt = null;
  game.log.push({kind:'declare',message:`${game.round}라운드 선언 완료 · 카드 선택 시작!`});
}

/** The only safe object to emit to a given online player. */
export function publicGame(game, viewerId = null) {
  if (!game) return null;
  const viewer = game.players.find((p) => p.id === viewerId);
  const finished = game.phase === 'finished';
  return {
    phase: game.phase,
    round: game.round,
    darkEndsAt: game.phase === 'intro-dark' ? game.darkEndsAt : null,
    shuffleEndsAt: game.phase === 'shuffling' ? game.shuffleEndsAt : null,
    roleEndsAt: game.phase === 'role-reveal' ? game.roleEndsAt : null,
    shuffleFromRound: game.shuffleFromRound,
    reviewEndsAt: game.phase === 'reviewing' ? game.reviewEndsAt : null,
    claimEndsAt: game.phase === 'declaring' ? game.claimEndsAt : null,
    roundEndAt: game.phase === 'round-end' ? game.roundEndAt : null,
    actionInRound: game.actionInRound,
    currentId: game.currentId,
    playerCount: game.players.length,
    treasuresFound: game.revealed.filter((r) => r.type === 'treasure').length,
    remainingTreasure: game.players.length - game.revealed.filter((r) => r.type === 'treasure').length,
    // Public declarations, not the sum of real hidden hands.
    declaredTreasure: game.players.reduce((sum,p) => sum + (Number.isInteger(p.claim) ? p.claim : 0),0),
    declaredPlayers: game.players.filter(p => Number.isInteger(p.claim)).length,
    winner: game.winner,
    endReason: game.endReason,
    lastReveal: game.lastReveal,
    pending: game.pending ? {...game.pending} : null,
    revealed: game.revealed.map((r) => ({ ...r })),
    log: game.log.slice(-64).map((entry) => ({ ...entry })),
    players: game.players.map((p) => ({
      id: p.id,
      name: p.name,
      bot: p.bot,
      difficulty: p.difficulty,
      cards: p.hand.map((c) => c.id),
      treasureClaim: p.claim,
      claimMax: game.phase === 'declaring' ? maxTreasureClaim(game,p.id) : null,
      ...(finished ? { role: p.role } : {}),
    })),
    mySecret: viewer ? { role: viewer.role, counts: totals(viewer.hand) } : null,
  };
}

/** Only for single-device, private pass-the-phone screen. */
export function privateInfo(game, playerId) {
  const p = game.players.find((person) => person.id === playerId);
  if (!p) throw new Error('없는 플레이어입니다.');
  return { id: p.id, name: p.name, role: p.role, counts: totals(p.hand) };
}
