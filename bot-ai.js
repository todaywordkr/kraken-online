import { analyzePublicEvidence, evaluateBotTargets, highestSuspicion } from './bot-reasoning.js';
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
  const yesTreasure = /(보물|황금|다이아).{0,12}(있|[1-8]개|하나|둘|많|나왔)|(?:있어|있다).{0,7}보물/.test(t);
  const kraken = /크라켄.{0,7}(있|나왔|보유)|위험|조심/.test(t);
  const countMatch = t.match(/보물[^0-9]{0,6}([0-8])개?/);
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

/** Cards are selected only from public declarations, public reveals and this bot's own counts. */
export function chooseBotMove(view, messages = [], difficulty = 'normal', random = Math.random) {
  const thinker = view?.players?.find(p => p.id === view.currentId);
  const { scores } = evaluateBotTargets(view,messages,difficulty);
  if (!scores.length) throw new Error('선택할 다른 플레이어 카드가 없습니다.');
  const noise = difficulty === 'easy' ? 1.75 : difficulty === 'normal' ? 0.35 : 0.055;
  const ranked = scores.map(p=>({...p, noisyScore:p.score+(random()-0.5)*noise}));
  ranked.sort((a,b)=>b.noisyScore-a.noisyScore);
  const target=ranked[0];
  const picked=choose(target.cards,random);
  // A short rationale is safe to show because it contains no other private hand data.
  const reason = target.provenFalse
    ? `${target.targetName}님은 이번 라운드 ${target.claim}개라고 했지만 공개 기록과 맞지 않아요.`
    : Number.isInteger(target.claim)
      ? `${target.targetName}님이 보물 ${target.claim}개를 선언했어요. 공개 기록과 이전 발언을 함께 고려합니다.`
      : `${target.targetName}님에게 공개되지 않은 카드가 남아 있어요.`;
  return { targetId:target.targetId, cardId:picked, targetName:target.targetName, reason };
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
  const { treasure, kraken, empty } = view.mySecret.counts;
  const handSize = treasure + kraken + empty;
  // A declaration may never exceed what a player *could* hold at this moment.
  // Some older tests construct a minimal view without remainingTreasure.
  const limit = handSize; // A bluff may exceed the actual global treasure supply.
  const claim = (value) => Math.max(0, Math.min(limit, value));
  const skeleton = view.mySecret.role === 'skeleton';
  const danger = kraken > 0;
  const bluffRate = difficulty === 'easy' ? 0.22 : difficulty === 'normal' ? 0.68 : 1;
  let treasureClaim = claim(treasure);
  let krakenClaim = danger;

  if (skeleton && danger) {
    // The most valuable Skeleton bluff: conceal the Kraken and lure explorers
    // with an *apparently promising* hand. Even with zero real treasure,
    // announce at least one, provided a legal positive claim exists.
    if (random() < bluffRate && limit >= 1) {
      const lure = random() < 0.55 ? 2 : 1;
      treasureClaim = claim(Math.max(treasure + (treasure < limit ? 1 : 0), lure));
    }
    if (random() < (difficulty === 'hard' ? 1 : difficulty === 'normal' ? 0.85 : 0.35)) krakenClaim = false;
  } else if (skeleton && treasure > 0) {
    // Keep the useful treasure hidden so explorers waste picks elsewhere:
    // e.g. 2 real -> 1 claimed; sometimes 2 -> 0.
    if (random() < bluffRate) {
      treasureClaim = claim(treasure === 1 || random() >= 0.72 ? 0 : treasure - 1);
    }
    krakenClaim = false;
  } else if (skeleton) {
    // With only empty cards, overclaim to waste an explorer's card reveal.
    if (random() < bluffRate && limit > 0) {
      treasureClaim = claim(random() < 0.7 ? 1 : 2);
    }
    krakenClaim = false;
  } else if (danger) {
    // Crew holding the Kraken should deter others from opening this hand;
    // hide even real treasure (2 real -> claim 0) on hard difficulty.
    if (treasure > 0 && random() < (difficulty === 'hard' ? 1 : difficulty === 'normal' ? 0.72 : 0.25)) {
      treasureClaim = 0;
    }
    krakenClaim = random() < (difficulty === 'hard' ? 1 : difficulty === 'normal' ? 0.85 : 0.55);
  } else if (treasure > 0 && difficulty !== 'easy' && random() < (difficulty === 'hard' ? 0.08 : 0.15)) {
    // Small, uncommon friendly bluff; never hide treasure routinely.
    treasureClaim = claim(treasure - 1);
  }
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
    if (difficulty === 'hard' && context.reason && random() < 0.82) return context.reason;
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
    if (/거짓|의심|믿|스켈레톤|누가|누구|추리/i.test(source)) {
      if (view.players?.length) {
        const analysis=analyzePublicEvidence(view,messages);
        const proven = analysis.people.filter(p=>p.falseRounds.length);
        const mostRecent=proven.sort((a,b)=>b.falseRounds.at(-1).round-a.falseRounds.at(-1).round)[0];
        if (mostRecent) return prefix+`${mostRecent.name}님의 보물 선언은 공개 기록과 모순돼요. 하지만 거짓말만으로 스켈레톤이라고 단정할 수는 없어요.`;
        const suspect=highestSuspicion(view);
        if (suspect && suspect.suspiciousChoices>0) return prefix+`${suspect.name}님은 보물 0개를 선언한 쪽도 선택했어요. 의심할 단서지만, 진영을 확정할 근거는 아니에요.`;
      }
      return prefix+'아직 확실히 거짓이라고 판명된 선언은 적어요. 공개된 카드와 선언 숫자를 비교해 봐요.';
    }
    if (question.treasure) return prefix + botClaim(view,difficulty,random,stance);
    if (question.kraken) return prefix + krakenAnswer(view,difficulty,random,stance);
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
