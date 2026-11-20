/**
 * Offline, rule-based strategic bots. No paid model/API key is required.
 * ALL decisions use a player's redacted publicGame() view: no hidden card order,
 * other players' roles, or other players' private hands enter these functions.
 */
export const BOT_DIFFICULTIES = Object.freeze({ easy: '쉬움', normal: '보통', hard: '어려움' });
const choose = (items, random = Math.random) => items[Math.min(items.length - 1, Math.floor(random() * items.length))];
const cap = (value, low, high) => Math.max(low, Math.min(high, value));

function decodeClaim(text) {
  const t = String(text || '').replace(/\s+/g, '');
  const noTreasure = /보물(없|0개|제로|영개)|보물은0|보물0|보물이없/.test(t);
  const yesTreasure = /(보물|황금|다이아).{0,12}(있|[1-5]개|하나|둘|많|나왔)|(?:있어|있다).{0,7}보물/.test(t);
  const kraken = /크라켄.{0,7}(있|나왔|보유)|위험|조심/.test(t);
  const countMatch = t.match(/보물[^0-9]{0,6}([0-5])개?/);
  return { treasure: countMatch ? Number(countMatch[1]) : noTreasure ? 0 : yesTreasure ? 1 : null, kraken };
}
function latestClaims(messages, round) {
  const claims = new Map();
  for (const m of messages) {
    if (m.round !== round) continue;
    const claim = decodeClaim(m.text);
    if (claim.treasure !== null || claim.kraken) claims.set(m.playerId, claim);
  }
  return claims;
}
function handAtRoundStart(playerCount, round) { return 6 - round; }

/** A legal move selected from public information and this bot's own secrets only. */
export function chooseBotMove(view, messages = [], difficulty = 'normal', random = Math.random) {
  if (!view || view.phase !== 'playing') throw new Error('봇 행동 시 게임이 진행 중이어야 합니다.');
  const current = view.players.find(p => p.id === view.currentId);
  if (!current || !current.bot) throw new Error('현재 행동자가 봇이 아닙니다.');
  const options = view.players.filter(p => p.id !== current.id && p.cards.length);
  if (!options.length) throw new Error('선택할 다른 플레이어 카드가 없습니다.');
  const claim = latestClaims(messages, view.round);
  const availableTreasures = view.playerCount - view.treasuresFound;
  const remainingCards = view.players.reduce((total,p) => total + p.cards.length,0);
  const estimatedTreasureDensity = availableTreasures / Math.max(1,remainingCards);
  const selfish = view.mySecret?.role === 'skeleton';
  const ranked = options.map(target => {
    const said = claim.get(target.id);
    // Public past reveals provide evidence: repeated claimed treasures followed by empty cards decreases credibility.
    const cardsRevealed = view.revealed.filter(r => r.ownerId === target.id && r.round === view.round);
    const foundTreasures = cardsRevealed.filter(r => r.type === 'treasure').length;
    let estimate = estimatedTreasureDensity;
    if (said?.treasure !== null && said?.treasure !== undefined) {
      const claimedRemaining = Math.max(0, said.treasure - foundTreasures);
      const claimProbability = cap(claimedRemaining / Math.max(1,target.cards.length),0,0.85);
      const trust = difficulty === 'hard' ? 0.62 : difficulty === 'normal' ? 0.4 : 0.06;
      estimate = estimate * (1-trust) + claimProbability * trust;
    }
    // A claimed kraken is a warning to crew, an attractive target for a skeleton.
    let hazard = said?.kraken ? 0.40 : 1 / Math.max(remainingCards, 1);
    const neverVisited = view.revealed.some(r=>r.ownerId === target.id) ? -0.025 : 0.015;
    let score = selfish ? (hazard * 2.4 - estimate * 0.3) : (estimate * 2.4 - hazard * 1.5);
    if (difficulty === 'hard') {
      // Claims aren't proof; give more weight to objective outcomes from this round.
      const emptyReveals = cardsRevealed.filter(r => r.type === 'empty').length;
      score += selfish ? emptyReveals * 0.008 : -emptyReveals * 0.016;
      score += neverVisited;
    }
    score += (random() - 0.5) * (difficulty === 'easy' ? 3.0 : difficulty === 'normal' ? 0.72 : 0.22);
    return { target, score };
  });
  ranked.sort((a,b)=>b.score-a.score);
  const target = ranked[0].target;
  return { targetId: target.id, cardId: choose(target.cards, random), targetName: target.name };
}

function botClaim(view, difficulty, random) {
  const { empty, treasure, kraken } = view.mySecret.counts;
  const isSkeleton = view.mySecret.role === 'skeleton';
  let announced = treasure;
  // Skeletons deliberately bluff more convincingly on high difficulty.
  const lieChance = difficulty === 'easy' ? 0.22 : difficulty === 'normal' ? 0.62 : 0.94;
  if (isSkeleton && random() < lieChance) {
    announced = treasure === 0 ? 1 : treasure >= 2 ? 0 : 2;
  } else if (!isSkeleton && difficulty === 'hard' && random() < 0.13) {
    announced = treasure === 0 ? 1 : Math.max(0,treasure-1);
  }
  const variants = [
    `지금 내 카드에는 보물 ${announced}개가 있어요. 믿을지는 자유!`,
    `제 손패는 보물이 ${announced}개라고 말할게요. 어디 있는지는 저도 몰라요.`,
    announced ? `이번 라운드 제 손에 보물 ${announced}개라고 봅니다. 골라보실래요?` : '이번 라운드 제 손에 보물 0개입니다. 다른 사람부터 찾아봐요.',
  ];
  if (kraken && isSkeleton && random() < 0.33) variants.push('제 카드는 좀 수상해요. 그렇지만 다른 사람 말을 더 따져보죠.');
  return choose(variants, random);
}

/** Contextual, bounded dialogue with information known to this specific bot. */
export function botSpeak(view, messages, difficulty = 'normal', context = {type:'intro'}, random = Math.random) {
  if (!view?.mySecret) return null;
  const t = context?.type || 'intro';
  const source = String(context?.text || '').slice(0,180);
  if (t === 'intro' || t === 'round') return botClaim(view,difficulty,random);
  if (t === 'turn') {
    return choose([
      `${context.targetName || '그쪽'}님의 카드를 검토해볼게요. 이번 선택은 확신보다 확률입니다.`,
      `${context.targetName || '다른 플레이어'}님을 지목합니다. 다른 의견 있나요?`,
      `${context.targetName || '저쪽'} 카드가 궁금하군요. 틀렸다면 다음 차례에 만회해 주세요.`,
    ], random);
  }
  if (t === 'reply') {
    if (/보물|treasure/i.test(source)) return choose([
      botClaim(view,difficulty,random),
      `보물이라고 말하는 사람은 많죠. 방금 공개된 ${view.revealed.length}장 결과도 같이 보세요.`,
    ],random);
    if (/크라켄|위험|kraken/i.test(source)) return choose([
      '크라켄은 한 장뿐이에요. 근거 없이 안전하다고 단정하면 안 되죠.',
      '크라켄 위험 신호는 기억해둘게요. 어느 손패에 있는지는 저도 몰라요.',
    ],random);
    if (/거짓|의심|믿|스켈레톤|누가|누구|추리/i.test(source)) return choose([
      '말보다 공개된 카드 기록을 봐야 해요. 주장과 결과가 다른 사람이 있나요?',
      '역할은 숨겨져 있죠. 확답은 못 하지만 손패 주장부터 비교해 보겠습니다.',
    ],random);
    if (/안녕|ㅎㅇ|hello|hi/i.test(source)) return '반가워요! 항해 준비 완료. 카드 얘기를 해볼까요?';
    if (source.includes('?') || source.includes('？')) return '지금은 확정할 근거가 부족해요. 카드 공개 결과를 같이 보죠.';
    return choose(['그럴 수도 있겠네요. 공개 기록으로 검증해 봐요.','그 말을 기억해둘게요. 지금은 보물부터 찾는 게 중요해요.'],random);
  }
  return null;
}

export function shouldReply(text, difficulty='normal', random=Math.random) {
  const meaningful = /[?？]|보물|크라켄|거짓|의심|스켈레톤|누가|누구|안녕|ㅎㅇ|믿|treasure|kraken/i.test(text);
  return random() < (meaningful ? difficulty === 'easy' ? .45 : .92 : .16);
}
