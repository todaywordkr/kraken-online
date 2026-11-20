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
/** Total of public statements versus the *known* treasure supply at round start.
 * No individual liar or secret identity can be derived from this discrepancy alone.
 */
export function analyzeDeclarations(view) {
  const statements = view.players.map(p=>p.treasureClaim).filter(Number.isInteger);
  const announced = statements.reduce((sum,value)=>sum+value,0);
  const alreadyFound = view.revealed.filter(card=>card.type==='treasure' && card.round < view.round).length;
  const availableAtStart = view.playerCount - alreadyFound;
  return {
    announced, availableAtStart, complete: statements.length === view.playerCount,
    difference: announced - availableAtStart,
  };
}

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
  const declaration = analyzeDeclarations(view);
  // When people claim 8 treasures but only 5 exist, no single claimant is proven to be a liar.
  // Discount ALL statements; publicly revealed cards still have stronger evidentiary weight.
  const mismatchRatio = declaration.complete ? Math.abs(declaration.difference) / Math.max(1,declaration.availableAtStart) : 0;
  const discrepancyTrust = Math.max(0.28, 1 - mismatchRatio * 1.25);
  const ranked = options.map(target => {
    const said = claim.get(target.id);
    // Public past reveals provide evidence: repeated claimed treasures followed by empty cards decreases credibility.
    const cardsRevealed = view.revealed.filter(r => r.ownerId === target.id && r.round === view.round);
    const foundTreasures = cardsRevealed.filter(r => r.type === 'treasure').length;
    let estimate = estimatedTreasureDensity;
    // The timed declaration next to the nickname is the primary public claim.
    // Chat remains useful, but no AI should need to rely on only two intro speakers.
    const announced = Number.isInteger(target.treasureClaim) ? target.treasureClaim : said?.treasure;
    if (announced !== null && announced !== undefined) {
      const claimedRemaining = Math.max(0, announced - foundTreasures);
      const claimProbability = cap(claimedRemaining / Math.max(1,target.cards.length),0,0.85);
      const trust = (difficulty === 'hard' ? 0.62 : difficulty === 'normal' ? 0.4 : 0.06) * discrepancyTrust;
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

/** Recognize direct card questions without requiring a cloud AI API. */
export function classifyCardQuestion(value) {
  const source = String(value || '').replace(/\s+/g, '');
  const treasure = /보물|treasure|보석/i.test(source);
  const kraken = /크라켄|kraken/i.test(source);
  return { treasure, kraken, cardQuestion: treasure || kraken };
}

/** One stable statement per bot and per round; only its own redacted hand is read. */
export function createBotStance(view, difficulty = 'normal', random = Math.random) {
  if (!view?.mySecret) throw new Error('AI 개인 정보가 필요합니다.');
  const { treasure, kraken } = view.mySecret.counts;
  const skeleton = view.mySecret.role === 'skeleton';
  const lieChance = difficulty === 'easy' ? 0.18 : difficulty === 'normal' ? 0.58 : 0.88;
  let treasureClaim = treasure;
  if (!skeleton && kraken && treasure > 0 && random() < (difficulty === 'hard' ? 0.82 : 0.48)) {
    // Explorers sometimes hide their treasures to discourage picking their dangerous Kraken hand.
    treasureClaim = 0;
  } else if (skeleton && random() < lieChance) {
    // Skeletons may both overclaim to attract picks and underclaim to hide valuable cards.
    if (treasure === 0) treasureClaim = random() < 0.65 ? 2 : 1;
    else treasureClaim = random() < 0.50 ? 0 : Math.min(view.mySecret.counts.empty + treasure + kraken, treasure + 2);
  } else if (!skeleton && difficulty === 'hard' && random() < 0.18) {
    treasureClaim = treasure ? treasure - 1 : 1;
  }
  // Skeletons holding the Kraken usually deny it to invite a card pick.
  const krakenClaim = kraken > 0
    ? !(skeleton && random() < lieChance)
    : Boolean(skeleton && random() < lieChance * 0.13);
  return { round: view.round, treasureClaim, krakenClaim };
}

function botClaim(view, difficulty, random, stance) {
  const stated = stance || createBotStance(view, difficulty, random);
  const announced = stated.treasureClaim;
  return choose([
    `이번 ${view.round}라운드 제 카드에는 보물 ${announced}개가 있어요.`,
    `제 손패는 보물이 ${announced}개라고 말할게요. 위치까지 아는 건 아니에요.`,
    `지금 제 보물은 ${announced}개입니다. 믿을지는 선택해 주세요.`,
  ], random);
}

function krakenAnswer(view, difficulty, random, stance) {
  const claim = (stance || createBotStance(view,difficulty,random)).krakenClaim;
  if (claim) return choose([
    '크라켄 있냐고요? 제 카드에 있다고 말할게요. 절 지목할 땐 신중하세요.',
    '네, 이번 라운드 제 카드에 크라켄이 있다고 주장합니다. 다른 카드부터 보시죠.',
  ],random);
  return choose([
    '크라켄이요? 이번 라운드 제 카드에는 없다고 말하겠습니다. 그렇지만 믿을지는 자유예요.',
    '제 카드에는 크라켄 없어요. 단, 어떤 카드가 안전한지는 저도 몰라요.',
  ],random);
}

/** Targeted answers for treasure count and Kraken presence; AI may bluff strategically. */
export function botSpeak(view, messages, difficulty = 'normal', context = {type:'intro'}, random = Math.random) {
  if (!view?.mySecret) return null;
  const t = context?.type || 'intro';
  const source = String(context?.text || '').slice(0,180);
  const stance = context?.stance || createBotStance(view,difficulty,random);
  if (t === 'intro' || t === 'round') return botClaim(view,difficulty,random,stance);
  if (t === 'turn') {
    const declaration = analyzeDeclarations(view);
    if (difficulty === 'hard' && declaration.complete && declaration.difference !== 0 && random() < 0.6) {
      const direction = declaration.difference > 0 ? '많아요' : '적어요';
      return `이번 라운드 남은 보물은 ${declaration.availableAtStart}개인데 선언 합은 ${declaration.announced}개예요. ${Math.abs(declaration.difference)}개 ${direction}. 누군가 속이고 있겠지만 누군지는 아직 몰라요.`;
    }
    return choose([
      `${context.targetName || '그쪽'}님의 카드를 검토해볼게요. 이번 선택은 확신보다 확률입니다.`,
      `${context.targetName || '다른 플레이어'}님을 지목합니다. 다른 의견 있나요?`,
      `${context.targetName || '저쪽'} 카드가 궁금하군요. 틀렸다면 다음 차례에 만회해 주세요.`,
    ], random);
  }
  if (t === 'reply') {
    const question = classifyCardQuestion(source);
    const prefix = context.askedBy ? `${String(context.askedBy).slice(0,18)}님, ` : '';
    if (question.treasure && question.kraken) return prefix + botClaim(view,difficulty,random,stance) + ' ' + krakenAnswer(view,difficulty,random,stance);
    if (question.treasure && /합계|총합|전체|전부|다들|모두|합치|합산|말이.*(맞|안|틀)|개수.*(이상|초과|적)/.test(source)) {
      const d = analyzeDeclarations(view);
      if (!d.complete) return prefix+'아직 모두 선언하지 않았으니 합계를 비교할 수 없어요.';
      if (d.difference === 0) return prefix+`선언 합계는 ${d.announced}개, 실제 남은 보물도 ${d.availableAtStart}개예요. 그래도 서로 거짓말을 상쇄했을 수 있어요.`;
      return prefix+`선언 합계 ${d.announced}개, 실제 남은 보물 ${d.availableAtStart}개입니다. ${Math.abs(d.difference)}개 ${d.difference>0?'초과':'부족'}하니 누군가 사실과 다르게 말하고 있어요. 누구인지는 아직 단정 못 해요.`;
    }
    if (question.treasure) return prefix + botClaim(view,difficulty,random,stance);
    if (question.kraken) return prefix + krakenAnswer(view,difficulty,random,stance);
    if (/거짓|의심|믿|스켈레톤|누가|누구|추리/i.test(source)) return choose([
      prefix+'말보다 이번 라운드 공개된 카드를 봐야 해요. 주장과 결과가 다른 사람이 있나요?',
      prefix+'역할은 비밀이지만 발언 기록은 남아요. 이번 라운드 주장부터 비교해 봐요.',
    ],random);
    if (/안녕|ㅎㅇ|hello|hi/i.test(source)) return prefix+'반가워요! 이번 라운드 카드 얘기를 해볼까요?';
    if (/[?？]/.test(source)) return prefix+'지금은 확정할 근거가 부족해요. 이번 라운드 공개 카드부터 확인하죠.';
    return choose([prefix+'그럴 수도 있겠네요. 공개 기록으로 검증해 봐요.',prefix+'그 말을 기억해둘게요.'],random);
  }
  return null;
}

export function shouldReply(text, difficulty='normal', random=Math.random) {
  const question = classifyCardQuestion(text);
  if (question.cardQuestion) return true;
  const meaningful = /[?？]|거짓|의심|스켈레톤|누가|누구|안녕|ㅎㅇ|믿/i.test(text);
  return random() < (meaningful ? difficulty === 'easy' ? .45 : .92 : .16);
}
