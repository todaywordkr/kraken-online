/**
 * Explainable, PUBLIC-EVIDENCE-ONLY reasoning for strategic Kraken bots.
 * Caller passes publicGame(viewerId) — never the full game or anyone else's hand.
 * A claim is proven false only when public reveals make it mathematically impossible.
 */
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const own = (view, id) => view.players.find(p => p.id === id);

export function analyzePublicEvidence(view, messages = []) {
  if (!view?.players?.length) return { people: [], declaration: null };
  const cardsPerRound = round => view.playerCount - round + 1;
  const history = Array.isArray(view.claimHistory) ? view.claimHistory : [];
  // Some old unit tests construct lightweight views containing only current claims.
  const votes = history.length ? history : view.players.filter(p => Number.isInteger(p.treasureClaim)).map(p => ({
    round:view.round, playerId:p.id, number:p.treasureClaim,
  }));
  const people = view.players.map(player => {
    const declarations = votes.filter(v => v.playerId === player.id);
    const rounds = declarations.map(v => {
      const cards = (view.revealed || []).filter(r => r.ownerId === player.id && r.round === v.round);
      const treasures = cards.filter(r => r.type === 'treasure').length;
      const nonTreasure = cards.length - treasures;
      const initial = cardsPerRound(v.round);
      const maxPossible = Math.max(treasures, initial - nonTreasure);
      const provenFalse = v.number < treasures || v.number > maxPossible;
      const proof = v.number < treasures ? 'underclaim' : v.number > maxPossible ? 'overclaim' : null;
      const provenTrue = cards.length === initial && v.number === treasures;
      return { round:v.round, claim:v.number, initial, opened:cards.length, treasures,
        nonTreasure, minPossible:treasures, maxPossible, provenFalse, proof, provenTrue };
    });
    const falseRounds = rounds.filter(r => r.provenFalse);
    const trueRounds = rounds.filter(r => r.provenTrue);
    // No positive evidence from merely "not yet disproven" statements.
    const credibility = clamp(0.77 - falseRounds.length * 0.31 + trueRounds.length * 0.11, 0.07, 0.94);
    const current = rounds.find(r => r.round === view.round) || null;
    // Public acts are suggestive, not proof of role.
    const actions = (view.revealed || []).filter(r => r.actorId === player.id);
    let suspiciousChoices = 0, helpfulChoices = 0;
    for (const r of actions) {
      const targetVote = votes.find(v => v.round === r.round && v.playerId === r.ownerId);
      if (targetVote && targetVote.number === 0) suspiciousChoices++;
      if (r.type === 'treasure' && (targetVote?.number ?? 0) > 0) helpfulChoices++;
    }
    const skeletonSuspicion = clamp(0.30 + falseRounds.length*0.14 + suspiciousChoices*0.06 - helpfulChoices*0.045,0.05,0.85);
    return { id:player.id, name:player.name, credibility, skeletonSuspicion,
      falseRounds, trueRounds, rounds, current, suspiciousChoices, helpfulChoices };
  });
  const current = votes.filter(v => v.round === view.round);
  const total = current.reduce((n,v)=>n+v.number,0);
  const foundPrior = (view.revealed || []).filter(r => r.type === 'treasure' && r.round < view.round).length;
  const available = view.playerCount - foundPrior;
  const declaration = { total, available, difference:total-available, complete:current.length === view.playerCount };
  return { people, declaration };
}

export function evaluateBotTargets(view, messages = [], difficulty = 'normal') {
  if (!view || view.phase !== 'playing') throw new Error('카드 선택 단계에서만 추리할 수 있습니다.');
  const thinker = own(view, view.currentId);
  if (!thinker?.bot || !view.mySecret) throw new Error('AI 개인 정보가 필요합니다.');
  const record = analyzePublicEvidence(view, messages);
  const others = view.players.filter(p => p.id !== thinker.id);
  const otherCards = others.reduce((s,p)=>s+p.cards.length,0);
  const ownTreasure = view.mySecret.counts.treasure;
  const ownKraken = view.mySecret.counts.kraken;
  // Because the bot knows its own counts, population priors should exclude its own hand.
  const baselineTreasure = clamp((view.remainingTreasure - ownTreasure)/Math.max(1,otherCards),0,1);
  const baselineKraken = clamp((1-ownKraken)/Math.max(1,otherCards),0,1);
  const overall = record.declaration;
  const mismatch = overall.complete ? Math.abs(overall.difference)/Math.max(1,overall.available) : 0;
  const discount = clamp(1 - mismatch * 0.7, 0.45, 1);
  const statements = (messages || []).filter(m => m.round === view.round);
  const scores = others.filter(p=>p.cards?.length).map(target => {
    const evidence = record.people.find(p=>p.id===target.id);
    const current = evidence?.current;
    const announced = Number.isInteger(target.treasureClaim) ? target.treasureClaim : current?.claim;
    let expectedTreasure = baselineTreasure;
    if (announced !== undefined && announced !== null && current?.provenFalse !== true) {
      const found = current?.treasures || 0;
      const claimedRate = clamp((announced - found)/target.cards.length,0,1);
      const suspicionDiscount = 1 - Math.max(0,(evidence?.skeletonSuspicion ?? 0.3)-0.3)*0.45;
      const weight = (difficulty === 'hard' ? 0.90 : difficulty === 'normal' ? 0.62 : 0.18)
        * (evidence?.credibility ?? 0.77) * discount * suspicionDiscount;
      expectedTreasure = clamp(expectedTreasure*(1-weight) + claimedRate*weight,0,1);
    } else if (current?.provenFalse) {
      if (current.proof === 'underclaim') expectedTreasure = clamp(baselineTreasure*1.55+0.05,0,1);
      else expectedTreasure = clamp(baselineTreasure*0.62,0,1);
    }
    // Someone openly warning of a Kraken is a plausible hazard, not a certainty.
    const saidKraken = statements.some(m => m.playerId === target.id &&
      /크라켄.{0,12}(있(어|습니|다|을)|보유|조심|위험)/.test(String(m.text)) &&
      !/없|아니|없다/.test(String(m.text)));
    const suspiciousZero = announced === 0 && (evidence?.credibility ?? 1) < 0.68;
    let expectedKraken = baselineKraken;
    if (!ownKraken) {
      if (saidKraken) expectedKraken = clamp(baselineKraken * 3.2 + 0.08,0,0.8);
      else if (announced === 0) expectedKraken = clamp(baselineKraken * (suspiciousZero ? 1.9 : 1.45),0,0.65);
      else expectedKraken = clamp(baselineKraken * (0.85 + Math.max(0,(evidence?.skeletonSuspicion ?? 0.3)-0.3)*1.8),0,1);
    }
    const ownRole = view.mySecret.role;
    const pickValue = ownRole === 'crew'
      ? expectedTreasure*3.3 - expectedKraken*4.2
      : expectedKraken*6.5 - expectedTreasure*1.35;
    return { targetId:target.id, targetName:target.name, expectedTreasure, expectedKraken,
      credibility:evidence?.credibility ?? 0.77, skeletonSuspicion:evidence?.skeletonSuspicion ?? 0.3,
      provenFalse:Boolean(current?.provenFalse), claim:announced ?? null, score:pickValue,
      cards:target.cards };
  });
  return { scores, record, baselineTreasure, baselineKraken };
}

export function evidenceReaction(view, reveal, difficulty = 'hard') {
  if (!view || !reveal || difficulty === 'easy') return null;
  const report = analyzePublicEvidence(view);
  const person = report.people.find(p => p.id === reveal.ownerId);
  if (!person?.current?.provenFalse) return null;
  const c = person.current;
  if (c.proof === 'underclaim') return `${person.name}님은 보물 ${c.claim}개라고 했지만, 이번 라운드에 벌써 ${c.treasures}개가 나왔어요. 거짓 선언은 확인됐지만 스켈레톤이라고 단정할 수 없어요.`;
  return `${person.name}님은 보물 ${c.claim}개라고 했지만, 빈 상자가 너무 많이 나와서 남은 카드에 그만큼 보물이 있을 수 없어요. 선언이 틀렸지만 진영은 아직 몰라요.`;
}

export function highestSuspicion(view) {
  const list = analyzePublicEvidence(view).people.filter(p=>p.id !== view.currentId);
  return list.sort((a,b) => b.skeletonSuspicion-a.skeletonSuspicion)[0] || null;
}
