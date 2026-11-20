import { formatBotChat, groupedReveals } from './display-utils.js';
const root = document.querySelector('#app');
const params = new URLSearchParams(location.search);
const initialCode = (params.get('room') || '').trim().toUpperCase();
const safe = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const icons = { empty:'◇', treasure:'◆', kraken:'✺' };
const roleText = role => role === 'crew' ? '탐험대' : '스켈레톤';
const botLevels = { easy:'쉬움', normal:'보통', hard:'어려움' };
const avatars = ['✧','✦','❖','◈','✳','✼','✺','✣'];
const saved = (() => { try { return JSON.parse(sessionStorage.getItem('kraken-online-session') || 'null'); } catch { return null; } })();
const state = {
  room: null, session: saved, nickname: localStorage.getItem('kraken-online-name') || saved?.name || '',
  joinCode: initialCode, tab: initialCode ? 'join' : 'create', connection: '연결 준비',
  selected: null, showSecret: false, showRules: false, chatDraft: '', notice: '', busy: false, botDifficulty: 'normal', justDealt: false, botAskTarget: '', declareBusy: false,
};
let events = null;
let noticeTimer = null;
const game = () => state.room?.game;
const me = () => state.room?.myId;
const host = () => state.room?.hostId === me();
const myTurn = () => game()?.phase === 'playing' && game().currentId === me();

function notice(message) {
  state.notice = message;
  clearTimeout(noticeTimer);
  render();
  noticeTimer = setTimeout(() => { state.notice = ''; render(); }, 4200);
}
function updateUrl(code='') {
  const url = new URL(location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  history.replaceState(null, '', url);
}
async function call(action, payload = {}, authenticated = true) {
  const data = authenticated ? { code: state.session?.code, token: state.session?.token, ...payload } : payload;
  const response = await fetch(`/api/${action}`, {
    method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify(data),
  });
  const value = await response.json();
  if (!response.ok || !value.ok) throw new Error(value.error || '요청에 실패했습니다.');
  return value;
}
function connectEvents() {
  events?.close();
  if (!state.session) return;
  const {code, token} = state.session;
  events = new EventSource(`/api/events?code=${encodeURIComponent(code)}&token=${encodeURIComponent(token)}`);
  state.connection = '연결 중';
  events.onopen = () => { state.connection = '실시간 연결됨'; render(); };
  events.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data);
      const was = state.room?.game;
      state.room = data;
      if (was?.phase === 'shuffling' && data.game?.phase === 'reviewing') {
        state.justDealt = true;
        setTimeout(() => { state.justDealt = false; render(); }, 950);
      }
      if (was && data.game && (was.round !== data.game.round || was.revealed.length !== data.game.revealed.length)) {
        state.selected = null;
      }
      render();
    } catch (e) { console.error('실시간 메시지 처리 실패',e); }
  };
  events.onerror = () => { state.connection = '재연결 중'; render(); };
}
function acceptSession(value) {
  state.session = { code: value.code, token: value.token, name: state.nickname };
  sessionStorage.setItem('kraken-online-session', JSON.stringify(state.session));
  localStorage.setItem('kraken-online-name', state.nickname);
  state.room = value.state;
  state.selected = null;
  state.showSecret = false;
  updateUrl(value.code);
  connectEvents();
  render();
}
function leaveSession() {
  events?.close(); events = null;
  state.session = null;
  state.room = null;
  state.connection = '연결 준비';
  state.selected = null; state.showSecret = false; state.chatDraft = '';
  sessionStorage.removeItem('kraken-online-session');
  updateUrl(''); render();
}
function shareUrl() { return `${location.origin}${location.pathname}?room=${encodeURIComponent(state.room.code)}`; }
async function copy(value) {
  try { await navigator.clipboard.writeText(value); notice('복사했습니다. 친구에게 공유해 주세요.'); }
  catch { window.prompt('주소를 직접 복사해 주세요.', value); }
}
function brand() {
  return `<header class="topbar container">
    <div class="brand" aria-label="심해의 항해"><span class="brand-symbol">✺</span><span><b>심해의 항해</b><small>THE KRAKEN'S SECRET</small></span></div>
    <div class="header-right"><span class="header-caption">SOCIAL DEDUCTION <i>·</i> 4—8 PLAYERS</span>
      ${state.room ? `<span class="server-chip"><i></i>${safe(state.room.code)}</span>` : `<span class="server-chip"><i></i>ONLINE EDITION</span>`}
      <button type="button" class="header-help" data-action="rules">? <span>게임 규칙</span></button>
    </div>
  </header>`;
}
function landing() {
  return `${brand()}<main class="container landing">
    <section class="hero">
      <div class="hero-copy"><span class="eyebrow"><span class="gold-dot"></span> THE SECRET BELOW THE SURFACE</span>
        <h1>믿을 사람은<br/><em>아무도 없다.</em></h1>
        <p>보물은 깊은 곳에 잠들어 있고, 크라켄은 누군가의 카드 속에서 깨어나길 기다립니다. 친구 또는 AI 봇과 펼치는 실시간 심리전.</p>
        <div class="stats"><div><strong>1+AI</strong><span>SOLO OK</span></div><i></i><div><strong>04</strong><span>ROUNDS</span></div><i></i><div><strong>~20</strong><span>MINUTES</span></div></div>
      </div>
      <div class="hero-art" aria-hidden="true"><div class="art-ring ring-a"></div><div class="art-ring ring-b"></div><div class="art-ring ring-c"></div><div class="art-grid"></div><span class="compass-n">N</span><span class="compass-w">W</span><span class="compass-e">E</span><span class="compass-s">S</span>
        <span class="art-beast">✺</span><div class="art-bottom">THE DEEP <span>IS WATCHING</span></div><span class="art-number">08° 14′ N<br/>42° 09′ W</span></div>
    </section>
    <div class="landing-panels">
      <section class="panel entry-panel"><div class="section-kicker">01 <span>/</span> BEGIN YOUR VOYAGE</div><h2>함께 출항하세요.</h2><p class="muted">혼자서 AI들과, 또는 친구들과 AI를 섞어서 플레이하세요.</p>
        <div class="tabs"><button class="${state.tab === 'create' ? 'active' : ''}" data-action="tab-create">새 방 만들기</button><button class="${state.tab === 'join' ? 'active' : ''}" data-action="tab-join">초대 코드로 입장</button></div>
        <label class="field-label" for="nickname">항해사 이름</label><input id="nickname" maxlength="18" data-field="nickname" value="${safe(state.nickname)}" placeholder="닉네임을 입력하세요" autocomplete="nickname" />
        ${state.tab === 'join' ? `<label class="field-label" for="joincode">6자리 초대 코드</label><input id="joincode" maxlength="6" data-field="joinCode" value="${safe(state.joinCode)}" placeholder="예: AB7K2Q" autocapitalize="characters" spellcheck="false" />` : ''}
        <button class="primary-btn wide" data-action="${state.tab === 'create' ? 'create' : 'join'}" ${state.busy ? 'disabled' : ''}><span>${state.tab === 'create' ? '새로운 방 만들기' : '게임방 입장하기'}</span><b>↗</b></button>
        <div class="connection-note"><span class="ping ${state.connection === '실시간 연결됨' ? 'online' : ''}"></span>서버에 접속하면 초대 링크를 공유할 수 있습니다.</div>
      </section>
      <section class="panel how-panel"><div class="section-kicker">02 <span>/</span> THE RULES</div><h2>어느 편에 설 것인가?</h2><p class="muted">모두 같은 카드를 보지만, 진실은 서로 다릅니다.</p>
        <div class="rule-snippets"><div class="rule-snippet"><span class="rule-icon crew">✦</span><div><b>탐험대</b><small>모든 보물을 공개하면 승리</small></div><span class="rule-more">01</span></div><div class="rule-snippet"><span class="rule-icon enemy">☠</span><div><b>스켈레톤</b><small>크라켄 공개 또는 4라운드 종료 시 승리</small></div><span class="rule-more">02</span></div><div class="rule-snippet"><span class="rule-icon quiet">◈</span><div><b>거짓말도 전략</b><small>카드의 개수만 알 수 있고 위치는 모릅니다</small></div><span class="rule-more">03</span></div></div>
        <button class="text-link" data-action="rules">자세한 플레이 방법 알아보기 <span>↗</span></button>
      </section>
    </div><footer class="site-footer">FIND THE TREASURE · DON'T WAKE THE KRAKEN <span>독립 제작 팬 프로젝트 · 원작 공식 서비스 아님</span></footer>
  </main>`;
}
function playerBadge(p, idx) {
  return `<span class="avatar av${idx%5} ${p.bot ? 'bot-avatar' : ''}">${p.bot ? '🤖' : avatars[idx%avatars.length]}</span>`;
}
function chatPanel() {
  const messages = state.room?.messages || [];
  const bots = state.room?.players?.filter(p => p.bot) || [];
  const unspeaking = bots.find(p => !messages.some(m => m.playerId === p.id && m.round === game()?.round));
  const selectedBot = bots.find(p => p.id === state.botAskTarget) || unspeaking || bots[0];
  let previousRound = -1;
  const chatItems = messages.map(message => {
    const round = Number(message.round) || 0;
    const boundary = round !== previousRound ? `<div class="chat-round-divider" role="separator"><span>${round ? `${round}라운드` : '대기실'}</span><small>${round ? '이 아래 대화는 당시 라운드의 손패 기준' : '게임 시작 전 대화'}</small></div>` : '';
    previousRound = round;
    if (message.kind === 'system') return boundary + `<div class="chat-system" role="note">✦ ${safe(message.text)}</div>`;
    return boundary + `<div class="message ${message.playerId === me() ? 'mine' : ''}"><small>${safe(message.name)} ${message.bot ? '<span class="ai-tag">AI</span>' : ''} ${round ? `<span class="chat-round-tag">${round}R 발언</span>` : ''}</small><div>${message.bot ? formatBotChat(message.text) : safe(message.text)}</div></div>`;
  }).join('');
  const questions = game()?.phase === 'playing' && bots.length ? `<div class="chat-quick"><div class="quick-title">🤖 AI에게 직접 질문 <small>선택한 AI가 답변해요</small></div><div class="quick-controls"><select data-field="botAskTarget" aria-label="질문할 AI 선택">${bots.map(bot => `<option value="${safe(bot.id)}" ${bot.id === selectedBot?.id ? 'selected' : ''}>${safe(bot.name)}${!messages.some(m=>m.playerId===bot.id && m.round === game()?.round) ? ' · 아직 발언 전' : ''}</option>`).join('')}</select><button type="button" data-action="ask-bot" data-topic="treasure">보물 몇 개?</button><button type="button" data-action="ask-bot" data-topic="kraken">크라켄 있어?</button></div></div>` : '';
  return `<section class="panel chat-panel"><div class="panel-heading"><div><span class="top-glyph">☷</span><strong>선상 대화</strong></div><span class="live-pill">● LIVE</span></div>
    <div class="chat-notice">라운드가 바뀌면 카드가 재분배돼요. <b>이전 라운드 발언은 현재 손패와 다를 수 있습니다.</b></div>
    <div class="chat-messages" id="chat-messages">${messages.length ? chatItems : `<p class="chat-empty">누가 진실을 말하고 있을까요?<br/>AI에게 직접 질문해 보세요.</p>`}</div>
    ${questions}<form id="chat-form" class="chat-input"><input data-field="chatDraft" maxlength="180" value="${safe(state.chatDraft)}" placeholder="예: AI 루나, 보물 몇 개야?" aria-label="채팅 메시지" /><button type="submit" aria-label="메시지 전송">➤</button></form>
  </section>`;
}
function lobby() {
  const r = state.room;
  const allReady = r.players.every(p => p.ready && p.connected);
  const canStart = host() && r.players.length >= 4 && allReady;
  const self = r.players.find(p => p.id === me());
  return `${brand()}<main class="container state-page"><div class="page-heading"><div><span class="eyebrow">THE CREW IS ASSEMBLING</span><h1>출항 준비실</h1><p>친구를 초대하거나 AI를 추가하세요. 혼자여도 AI 3명을 추가하면 시작할 수 있어요.</p></div><span class="state-pill">◉ 승선 대기 중</span></div>
    <div class="lobby-layout"><div class="panel lobby-primary"><div class="invite-box"><span>YOUR INVITE CODE</span><div class="invite-code">${safe(r.code)} <button data-action="copy-code" title="초대 코드 복사">▣</button></div><div class="invite-caption">친구들에게 이 코드를 공유하세요. <button data-action="copy-link">초대 링크 복사 ↗</button></div></div>
      <div class="panel-heading crew-head"><strong>승선한 플레이어</strong><span>${r.players.length} / 8</span></div>
      <div class="lobby-players">${Array.from({length: Math.max(4, r.players.length)}, (_, i) => {
        const p = r.players[i];
        return p ? `<div class="lobby-person">${playerBadge(p,i)}<div><b>${safe(p.name)} ${p.id === me() ? '<span class="you">YOU</span>' : ''}</b><small>${p.bot ? `🤖 전략 AI · ${botLevels[p.difficulty] || '보통'}` : p.id === r.hostId ? '♛ 방장' : '탐험대원'}</small></div>${p.bot && host() ? `<button class="bot-remove" data-action="remove-bot" data-bot-id="${safe(p.id)}" title="AI 제거">× 제거</button>` : `<span class="member-status ${p.ready && p.connected ? 'is-ready' : ''}">${!p.connected ? '○ 연결 끊김' : p.ready ? '● 준비 완료' : '○ 준비 중'}</span>`}</div>` : `<div class="lobby-person vacant"><span class="avatar">+</span><div><b>빈 자리</b><small>새로운 항해사를 기다리는 중</small></div></div>`;
      }).join('')}</div>
    </div><div class="lobby-side"><section class="panel prep-panel"><div class="prep-compass">✳</div><div class="section-kicker">BEFORE WE SET SAIL</div><h3>출항 전 확인</h3><p>친구는 각자 기기로 접속하고, AI는 서버가 대신 플레이합니다.</p>
      <div class="prep-facts"><div><span>✓</span> 인간 + AI 합계 4~8명</div><div><span>✓</span> 모든 플레이어 준비 완료</div><div><span>✓</span> 비밀 역할 자동 배정</div></div>
      ${host() ? `<div class="bot-setup"><h4>🤖 AI 동료 추가</h4><p>친구가 없어도 AI 3명을 추가하면 바로 플레이할 수 있어요.</p><div class="bot-controls"><label for="bot-level" class="sr-only">추가할 AI 난이도</label><select id="bot-level" data-field="botDifficulty"><option value="easy" ${state.botDifficulty === 'easy' ? 'selected' : ''}>쉬움</option><option value="normal" ${state.botDifficulty === 'normal' ? 'selected' : ''}>보통</option><option value="hard" ${state.botDifficulty === 'hard' ? 'selected' : ''}>어려움</option></select><button class="secondary-btn" data-action="add-bot" ${r.players.length >= 8 ? 'disabled' : ''}>+ AI 추가</button></div><small>AI의 난이도는 게임 시작 전 제거 후 다시 추가해 변경할 수 있습니다.</small></div>` : ''}
      <button class="secondary-btn wide" data-action="ready" ${self?.connected === false ? 'disabled' : ''}>${self?.ready ? '✓ 내 준비 완료 · 취소하기' : '내 준비 완료하기'}</button>
      ${host() ? `<button class="primary-btn wide" data-action="start" ${!canStart ? 'disabled' : ''}>${r.players.length < 4 ? `최소 ${4-r.players.length}명 더 필요` : !allReady ? '모든 플레이어의 준비를 기다리는 중' : '모험 시작하기'} <b>↗</b></button>` : '<div class="wait-text">방장이 출항을 시작하면 자동으로 이동합니다.</div>'}
      <button class="exit-link" data-action="leave">방 나가기</button>
    </section>${chatPanel()}</div></div>
  </main>`;
}
function secretPanel(g) {
  const secret = g.mySecret;
  if (!secret) return '';
  return `<section class="panel private-panel"><div class="panel-heading"><div><span class="top-glyph">◇</span><strong>나만의 비밀</strong></div><span class="private-pill">PRIVATE</span></div>
    ${!state.showSecret ? `<div class="locked"><span class="lock-art">✧</span><strong>당신의 정체는?</strong><p>다른 사람에게 화면이 보이지 않을 때 확인하세요.</p><button class="outline-btn wide" data-action="toggle-secret">비밀 정보 확인 →</button></div>` : `<div class="role-box ${secret.role === 'crew' ? 'crew-side' : 'enemy-side'}"><span class="role-mark">${secret.role === 'crew' ? '✦' : '☠'}</span><div><small>YOUR ALLEGIANCE</small><b>${roleText(secret.role)}</b><em>${secret.role === 'crew' ? '모든 보물을 찾아라' : '혼란을 만들고 시간을 벌어라'}</em></div></div>
    <div class="hand-title">내 카드 구성 <small>· 배치는 알 수 없음</small></div><div class="hand-counts"><div><span>◇</span><strong>${secret.counts.empty}</strong><small>빈 상자</small></div><div><span>◆</span><strong>${secret.counts.treasure}</strong><small>보물 상자</small></div><div><span>✺</span><strong>${secret.counts.kraken}</strong><small>크라켄</small></div></div><button class="hide-btn" data-action="toggle-secret">↙ 비밀 정보 가리기</button>`}
  </section>`;
}
function playerHand(p, index, g) {
  const active = g.phase === 'playing' && g.currentId === p.id;
  const mine = me() === p.id;
  const canPick = myTurn() && !mine;
  return `<section class="player-hand ${active ? 'acting' : ''} ${mine ? 'self' : ''}"><div class="player-heading">${playerBadge(p,index)}<div><strong>${safe(p.name)} ${p.bot ? '<span class="ai-tag">AI</span>' : ''} ${mine ? '<span class="you">ME</span>' : ''} ${Number.isInteger(p.treasureClaim) ? `<span class="claim-chip" title="${g.round}라운드 보물 선언">◆ ${p.treasureClaim}개</span>` : ''}</strong><small>${active ? (p.bot ? '🤖 전략 분석 중' : '✦ 현재 선택자') : mine ? '내 카드' : '비밀 카드를 보유 중'}</small></div>${active ? '<span class="turn-tag">TURN</span>' : ''}</div>
    <div class="cards">${p.cards.length ? p.cards.map((cardId,j) => {
      const selected = (g.pending?.targetId === p.id && g.pending?.cardId === cardId) || (state.selected?.targetId === p.id && state.selected?.cardId === cardId);
      return `<button type="button" class="back-card ${canPick ? 'clickable' : ''} ${selected ? 'selected' : ''}" data-action="pick" data-target="${safe(p.id)}" data-card="${safe(cardId)}" ${canPick ? '' : 'disabled'} aria-label="${safe(p.name)}의 ${j+1}번 카드"><span>✺</span><small>${String(j+1).padStart(2,'0')}</small></button>`;
    }).join('') : '<span class="no-cards">남은 카드 없음</span>'}</div></section>`;
}
function revealHistory(g) {
  return `<div class="round-history" aria-label="라운드별 공개 카드 기록">${groupedReveals(g.revealed, g.round, g.playerCount).map(row => `
    <section class="reveal-round" aria-label="${row.round}라운드 공개 카드">
      <div class="reveal-round-head"><strong>${row.round}라운드</strong><span>${row.cards.length} / ${g.playerCount}장 공개</span></div>
      <div class="reveal-grid" style="--round-cols:${g.playerCount}" role="list">
        ${row.slots.map((r, i) => r ? `<div role="listitem" class="reveal-card ${r.type}" title="${safe(r.ownerName)} · ${r.round}라운드 ${i+1}번째 공개"><span>${icons[r.type]}</span><small>${safe(r.ownerName)}</small></div>` : `<div role="listitem" class="reveal-card reveal-slot" aria-label="미공개 카드 자리 ${i+1}"><span>?</span><small>${String(i+1).padStart(2, '0')}</small></div>`).join('')}
      </div>
    </section>`).join('')}</div>`;
}
function shuffleOverlay(g) {
  return `<div class="shuffle-overlay" role="status" aria-live="polite" aria-label="카드를 섞는 중">
    <div class="shuffle-minimal">
      <span class="shuffle-round">${g.shuffleFromRound ? `${g.shuffleFromRound}라운드 종료 <b>→</b> ${g.round+1}라운드 시작` : '1라운드 시작'}</span>
      <span class="shuffle-spinner" aria-hidden="true"></span>
      <h2>카드 섞는 중</h2>
      <p>공개된 카드를 제외하고 남은 카드를 재분배합니다.</p>
    </div>
  </div>`;
}
/** A private *composition* preview, never the real positions of the server-held cards. */
function reviewCards(counts, playerId, round) {
  const kinds = Object.entries(counts || {}).flatMap(([type,count])=>Array.from({length:count},()=>type));
  let seed = [...String(playerId||'')].reduce((value,c)=>((value*33)^c.charCodeAt(0))>>>0, round*71+911);
  for(let i=kinds.length-1;i>0;i--) {
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    const j=seed%(i+1);
    [kinds[i],kinds[j]]=[kinds[j],kinds[i]];
  }
  return kinds;
}
function reviewPanel(g) {
  const secret=g.mySecret;
  if (!secret) return '';
  const hand=reviewCards(secret.counts,me(),g.round);
  const seconds=Math.max(0,Math.ceil(((g.reviewEndsAt||Date.now())-Date.now())/1000));
  return `<div class="review-overlay" role="dialog" aria-modal="true" aria-label="내 카드 확인 시간">
    <section class="review-modal">
      <div class="claim-kicker">ROUND ${String(g.round).padStart(2,'0')} · PRIVATE CARD REVIEW</div>
      <h2>${g.round}라운드 <em>내 카드 확인</em></h2>
      <p>다른 사람에게 보이지 않는 <strong>나만의 카드 구성</strong>이에요.<br/>5초 동안 종류별 개수를 기억하세요.</p>
      <div class="review-clock"><strong data-review-countdown>${seconds}</strong><small>초 남음</small></div>
      <div class="review-cards" role="list" aria-label="자신에게 배분된 카드 종류">
        ${hand.map((kind,i)=>`<div class="review-card ${kind}" role="listitem"><span>${icons[kind]}</span><strong>${{empty:'빈 상자',treasure:'보물',kraken:'크라켄'}[kind]}</strong></div>`).join('')}
      </div>
      <div class="review-summary">빈 상자 <b>${secret.counts.empty}</b> · 보물 <b>${secret.counts.treasure}</b> · 크라켄 <b>${secret.counts.kraken}</b></div>
      <p class="review-warning">이 카드 배열은 종류 확인용이에요. 확인 후 카드는 다시 뒤집어 섞이므로, <b>실제 위치는 알 수 없습니다.</b></p>
      <div class="review-next">5초 후 보물 개수 선언이 자동으로 시작됩니다.</div>
    </section>
  </div>`;
}
function declarationAudit(g) {
  if (!['playing','round-end'].includes(g.phase) || !g.players.every(p=>Number.isInteger(p.treasureClaim))) return '';
  const declared=g.players.reduce((sum,p)=>sum+p.treasureClaim,0);
  const remainingAtStart=g.playerCount-g.revealed.filter(r=>r.type==='treasure' && r.round<g.round).length;
  const delta=declared-remainingAtStart;
  return `<div class="claim-audit ${delta ? 'mismatch' : 'matched'}" role="note"><span>◆ 이번 라운드 보물 선언 합 <strong>${declared}개</strong> · 실제 남아 있던 보물 <strong>${remainingAtStart}개</strong></span><small>${delta ? `⚠ ${Math.abs(delta)}개 ${delta>0?'초과':'부족'} — 누군가 거짓말을 하고 있어요. 누구인지는 알 수 없어요.` : '합계가 같아도 서로의 거짓말이 상쇄될 수 있어요.'}</small></div>`;
}
function declarationPanel(g) {
  const mine = g.players.find(p=>p.id === me());
  const selected = mine?.treasureClaim;
  const max = mine?.claimMax ?? 0;
  const seconds = Math.max(0,Math.ceil(((g.claimEndsAt || Date.now())-Date.now())/1000));
  return `<div class="claim-overlay" role="dialog" aria-modal="true" aria-label="보물 개수 선언">
    <section class="claim-modal">
      <div class="claim-kicker">ROUND ${String(g.round).padStart(2,'0')} · DECLARATION</div>
      <h2>${g.round}라운드 <em>보물 선언</em></h2>
      <p class="claim-explainer">내 카드에 보물이 몇 개 있다고 말할까요?<br/>실제 개수와 다르게 선언해도 돼요.</p>
      <div class="claim-clock"><span data-claim-countdown>${seconds}</span><small>초 남음</small></div>
      <div class="claim-buttons" role="group" aria-label="선언할 보물 개수">
        ${Array.from({length:max+1},(_,number)=>`<button type="button" data-action="declare-treasure" data-number="${number}" class="claim-option ${selected===number ? 'chosen' : ''}" ${selected !== null || state.declareBusy ? 'disabled' : ''}>${number}<small>개</small></button>`).join('')}
      </div>
      <p class="claim-note">${selected !== null ? `✓ <strong>보물 ${selected}개</strong>로 선언했어요. 다른 플레이어를 기다리는 중...` : '5초 안에 선택하지 않으면 실제 보물 개수가 자동으로 선택됩니다.'}</p>
      <div class="claim-roster">${g.players.map(p=>`<div class="claim-roster-person"><span>${safe(p.name)}</span><strong class="${p.treasureClaim===null ? 'undecided' : ''}">${p.treasureClaim===null ? '선언 대기' : `◆ ${p.treasureClaim}개`}</strong></div>`).join('')}</div>
    </section>
  </div>`;
}
function revealSpotlight(g) {
  const card=g.lastReveal;
  if(!card) return '';
  const title={empty:'빈 상자',treasure:'보물 상자',kraken:'크라켄'}[card.type];
  return `<div class="reveal-spotlight ${g.phase==='round-end' ? 'final-reveal' : ''}" role="status">
    <span class="reveal-symbol ${card.type}">${icons[card.type]}</span><div><small>${g.phase==='round-end' ? '마지막 카드 공개 · 결과 확인 중' : '방금 공개된 카드'}</small><strong>${safe(card.ownerName)}님의 ${title}</strong>${g.phase==='round-end' ? '<p>이 카드를 충분히 확인한 뒤 다음 화면으로 이동합니다.</p>' : ''}</div>
  </div>`;
}
function gamePage() {
  const g = game();
  if (g.phase === 'finished') return finishPage();
  const actor = g.players.find(p => p.id === g.currentId);
  const turnCount = g.revealed.filter(p => p.round === g.round).length;
  const pending = g.pending || state.selected;
  const selectedOwner = g.players.find(p => p.id === pending?.targetId);
  return `${brand()}<main class="container state-page game-page ${state.justDealt ? 'dealt-in' : ''}"><div class="game-head"><div><span class="eyebrow">THE VOYAGE HAS BEGUN</span><h1>심해의 탐험</h1><p>보물을 찾아내되, 크라켄은 절대 깨우지 마세요.</p></div>
    <div class="round-track">${Array.from({length:4}, (_, i) => `<div class="round-step ${i + 1 === g.round ? 'current' : i + 1 < g.round ? 'done' : ''}"><b>${String(i+1).padStart(2,'0')}</b><small>ROUND</small></div>`).join('')}</div></div>
    <div class="score-strip"><div class="score-treasure"><small>발견한 보물</small><div class="mini-gems">${Array.from({length:g.playerCount}, (_,i)=>`<span class="${i < g.treasuresFound ? 'found' : ''}">${i < g.treasuresFound ? '◆' : '◇'}</span>`).join('')}</div><b>${g.treasuresFound}<em> / ${g.playerCount}</em></b></div><div class="score-stat"><small>이번 라운드</small><strong>${turnCount}<em> / ${g.playerCount}장</em></strong></div><div class="score-actor"><small>${g.phase === 'playing' ? '행동할 플레이어' : '현재 진행'}</small><strong>${g.phase === 'playing' ? `✳ ${safe(actor?.name)}` : g.phase === 'round-end' ? '◆ 공개 결과 확인' : g.phase === 'reviewing' ? '◇ 나의 카드 확인' : g.phase === 'declaring' ? '◆ 보물 개수 선언' : '↻ 카드 섞는 중'}</strong><span>${g.phase === 'shuffling' ? '남은 카드 재분배 중' : g.phase === 'reviewing' ? '비밀 카드 구성 확인 · 5초' : g.phase === 'declaring' ? '보물 개수 선언 중 · 5초' : g.phase === 'round-end' ? '마지막 공개 카드 확인 중' : myTurn() ? '다른 사람의 카드 한 장을 선택하세요' : actor?.bot ? 'AI가 카드를 분석 중입니다' : '선택을 기다리는 중입니다'}</span></div></div>
    <div class="game-layout"><aside class="left-sidebar">${secretPanel(g)}<section class="panel history-panel"><div class="panel-heading"><div><span class="top-glyph">≋</span><strong>탐험 기록</strong></div></div><div class="history-rows">${g.log.slice().reverse().map((entry,i) => `<div class="history-item ${entry.kind === 'round' ? 'round-event' : ''}"><span>${entry.kind === 'treasure' ? '◆' : entry.kind === 'kraken' ? '✺' : entry.kind === 'round' ? '↻' : '◇'}</span><p>${safe(entry.message)}</p></div>`).join('')}</div></section></aside>
    <section class="table-area">${declarationAudit(g)}<div class="table-heading"><div><span class="eyebrow">THE CARD TABLE</span><h2>탐험 카드</h2></div><span>뒷면을 눌러 선택</span></div>
      <div class="hands-grid">${g.players.map((p,i)=>playerHand(p,i,g)).join('')}</div>
      <div class="action-bar ${myTurn() ? 'your-turn' : ''}"><div><strong>${g.phase === 'shuffling' ? '✦ 카드를 섞고 있습니다' : g.phase === 'reviewing' ? '✦ 자신의 카드를 5초 동안 확인하세요' : g.phase === 'declaring' ? '✦ 보물 개수 선언 중입니다' : g.phase === 'round-end' ? '✦ 마지막 공개 카드를 확인하세요' : myTurn() ? '✦ 당신의 차례입니다' : g.pending ? `${safe(actor?.name)}님이 카드를 지목했습니다` : `${safe(actor?.name)}님의 선택을 기다리는 중`}</strong><small>자신의 카드는 선택할 수 없습니다. 거짓말과 토론은 자유!</small></div>${myTurn() && pending ? `<div class="confirm"><span>${safe(selectedOwner?.name)}님의 카드 선택</span><button class="outline-btn" data-action="cancel-pick">취소</button><button class="primary-btn" data-action="confirm-pick">카드 공개하기 ↗</button></div>` : ''}</div>
      <section class="panel reveal-panel"><div class="panel-heading"><div><span class="top-glyph">◆</span><strong>공개된 카드</strong></div><span>${g.revealed.length}장 발견</span></div>
        ${revealSpotlight(g)}${revealHistory(g)}
      </section>
    </section><aside class="right-sidebar">${chatPanel()}<div class="sidebar-hint"><span>✧</span> 기억하세요. 자신의 손패에 보물이 있다는 말조차 거짓말일 수 있습니다.</div></aside></div>
    <footer class="site-footer">NO ONE KNOWS WHERE THE KRAKEN SLEEPS <span>${state.connection}</span></footer>
    ${g.phase === 'shuffling' ? shuffleOverlay(g) : ''}
    ${g.phase === 'reviewing' ? reviewPanel(g) : ''}
    ${g.phase === 'declaring' ? declarationPanel(g) : ''}
  </main>`;
}
function finishPage() {
  const g = game();
  const crewWin = g.winner === 'crew';
  return `${brand()}<main class="container finished"><div class="eyebrow">THE VOYAGE HAS ENDED</div><div class="result-symbol ${crewWin ? 'result-crew' : 'result-enemy'}">${crewWin ? '◆' : '✺'}</div>
    <h1>${crewWin ? '보물을 모두 찾았습니다!' : '크라켄의 그림자가 드리웠다'}</h1><h2>${crewWin ? '탐험대 승리' : '스켈레톤 승리'}</h2><p>${safe(g.endReason)}</p>
    <div class="result-stats"><div><small>찾은 보물</small><strong>${g.treasuresFound} / ${g.playerCount}</strong></div><div><small>진행한 라운드</small><strong>${g.round} / 4</strong></div><div><small>공개 카드</small><strong>${g.revealed.length}장</strong></div></div>
    <section class="panel result-roster"><div class="panel-heading"><strong>모든 플레이어의 정체</strong><span>REVEALED</span></div><div class="result-grid">${g.players.map((p,i)=>`<div class="result-person">${playerBadge(p,i)}<div><strong>${safe(p.name)} ${p.bot ? '<span class="ai-tag">AI</span>' : ''}</strong><small class="${p.role === 'crew' ? 'crew-label' : 'enemy-label'}">${p.role === 'crew' ? '✦' : '☠'} ${roleText(p.role)}</small></div></div>`).join('')}</div></section>
    <section class="panel reveal-panel result-history"><div class="panel-heading"><strong>라운드별 공개 카드 기록</strong><span>${g.revealed.length}장</span></div>${revealHistory(g)}</section>
    ${host() ? '<button class="primary-btn result-btn" data-action="restart">같은 방에서 다시 플레이 ↗</button>' : '<div class="result-wait">방장이 재시작하면 같은 방에서 다시 플레이할 수 있습니다.</div>'}
    <button class="exit-link" data-action="exit-result">첫 화면으로 돌아가기</button>
  </main>`;
}
function rulesModal() {
  if (!state.showRules) return '';
  return `<div class="modal-backdrop" role="presentation"><div class="rules-modal panel" role="dialog" aria-modal="true" aria-label="게임 규칙"><button class="modal-close" data-action="rules" aria-label="닫기">×</button>
      <div class="section-kicker">THE CAPTAIN'S LOG</div><h2>심해의 항해 규칙</h2><div class="rules-scroll">
      <h3>01. 비밀 역할 및 AI</h3><p>4~8명에게 탐험대와 스켈레톤 역할이 무작위로 배정됩니다. 역할 카드는 실제 인원보다 한 장 많을 수 있으며, 누구도 자기 팀의 정확한 인원수를 모를 수 있습니다.</p>
      <p>AI도 플레이어 한 명으로 계산되며, 방장은 출항 전에 쉬움/보통/어려움 난이도의 AI를 추가하거나 제거할 수 있습니다. AI는 카드의 위치를 미리 알지 못하고 자신의 카드 개수와 공개 기록, 채팅 내용을 이용해 결정합니다.</p><h3>02. 처음 받은 카드</h3><p>각자 5장의 탐험 카드를 받습니다. 카드의 종류별 개수는 알지만, 섞어 뒤집어 놓으므로 어떤 위치에 무엇이 있는지는 모릅니다. 전체 보물 수는 플레이어 수와 같고, 크라켄은 1장입니다.</p>
      <h3>03. 카드 확인 5초 + 보물 선언 5초 (웹게임 추가 규칙)</h3><p>매 라운드 남은 카드 전체를 재분배한 뒤 자신의 카드 종류를 5초 동안 확인합니다. 이어서 5초 동안 0개부터 이번 라운드에 가능한 최대 수까지 보물 개수를 선언합니다. 거짓말도 가능하며, 아무것도 누르지 않은 사람은 실제 보물 수로 자동 선언됩니다. 모든 선언은 이름 옆에 표시됩니다.</p><h3>04. 행동과 토론</h3><p>차례인 플레이어는 <b>다른 플레이어</b>의 카드를 하나 선택합니다. 모두와 토론하고 결정을 바꾼 뒤 최종 공개할 수 있습니다. 공개한 카드의 주인이 다음 행동자가 됩니다.</p>
      <h3>05. 총 네 라운드</h3><p>매 라운드 플레이어 수만큼 카드를 공개합니다. 공개한 카드는 제외하고 다른 플레이어의 카드까지 모두 모아 다시 섞어 나눕니다. 직전 라운드에 손패가 0장이었던 사람도 다시 카드를 받습니다. 라운드별 손패는 5장 → 4장 → 3장 → 2장입니다.</p>
      <h3>06. 승리 조건</h3><p>탐험대는 보물을 전부 찾으면 즉시 승리합니다. 스켈레톤은 크라켄이 공개되거나 4라운드를 버티면 승리합니다.</p>
      <div class="rules-footnote">5초 카드 확인 및 5초 보물 선언은 요청에 따라 추가한 웹게임 하우스룰입니다. 비공식 팬 제작 버전으로 기본 규칙만 지원합니다. 디럭스 확장/특수 카드와 3인 변형 규칙은 제외됩니다.</div></div><button class="primary-btn wide" data-action="rules">규칙 확인했어요 ↗</button>
  </div></div>`;
}
function render() {
  const focus = document.activeElement?.dataset?.field;
  const selection = focus ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const chatEl = document.querySelector('#chat-messages');
  const chatAtBottom = !chatEl || chatEl.scrollTop + chatEl.clientHeight >= chatEl.scrollHeight - 65;
  root.innerHTML = (state.room ? (game() ? gamePage() : lobby()) : landing()) + rulesModal() + (state.notice ? `<div class="toast" role="status">${safe(state.notice)}</div>` : '');
  if (focus) {
    const field = document.querySelector(`[data-field="${focus}"]`);
    if (field) { field.focus(); try { field.setSelectionRange(...selection); } catch { /* unsupported type */ } }
  }
  const newChat = document.querySelector('#chat-messages');
  if (newChat && chatAtBottom) newChat.scrollTop = newChat.scrollHeight;
}
async function action(name, el) {
  switch(name) {
    case 'tab-create': state.tab = 'create'; render(); break;
    case 'tab-join': state.tab = 'join'; render(); break;
    case 'rules': state.showRules = !state.showRules; render(); break;
    case 'create':
    case 'join': {
      if (!state.nickname.trim()) throw new Error('닉네임을 입력하세요.');
      if (name === 'join' && !/^[A-HJ-NP-Z2-9]{6}$/.test(state.joinCode)) throw new Error('6자리 초대 코드를 입력하세요.');
      if (state.busy) return;
      state.busy = true; render();
      try { const value = await call(name, name === 'create' ? { name: state.nickname } : {name: state.nickname, code: state.joinCode}, false); acceptSession(value); }
      finally { state.busy = false; }
      break;
    }
    case 'declare-treasure': {
      if (game()?.phase !== 'declaring') throw new Error('보물 선언 시간이 아닙니다.');
      state.declareBusy=true; render();
      try { await call('declare',{number:Number(el.dataset.number)}); }
      finally {state.declareBusy=false;render();}
      break;
    }
    case 'ask-bot': {
      if (game()?.phase !== 'playing') throw new Error('게임 진행 중에만 질문할 수 있어요.');
      const bots = state.room.players.filter(p=>p.bot);
      const chosen = bots.find(p=>p.id===state.botAskTarget)
        || bots.find(p=>!state.room.messages.some(m=>m.playerId===p.id && m.round===game().round)) || bots[0];
      if (!chosen) throw new Error('게임방에 AI가 없습니다.');
      const question = el.dataset.topic === 'kraken' ? '크라켄 있어?' : '보물 몇 개야?';
      await call('chat', {text:`${chosen.name}, ${question}`});
      break;
    }
    case 'copy-code': await copy(state.room.code); break;
    case 'copy-link': await copy(shareUrl()); break;
    case 'ready': await call('ready'); break;
    case 'add-bot': await call('add-bot', {difficulty: state.botDifficulty}); break;
    case 'remove-bot': await call('remove-bot', {botId: el.dataset.botId}); break;
    case 'start': await call('start'); break;
    case 'leave': await call('leave'); leaveSession(); break;
    case 'toggle-secret': state.showSecret = !state.showSecret; render(); break;
    case 'pick': if (myTurn() && el.dataset.target !== me()) { state.selected = {targetId:el.dataset.target, cardId:el.dataset.card}; render(); await call('mark', state.selected); } break;
    case 'cancel-pick': await call('unmark'); state.selected = null; render(); break;
    case 'confirm-pick': {
      if (!myTurn() || !(game()?.pending || state.selected)) return;
      const picked = game()?.pending || state.selected;
      state.selected = null; render();
      await call('pick', picked);
      break;
    }
    case 'restart': await call('restart'); state.showSecret = false; break;
    case 'exit-result': leaveSession(); break;
  }
}
document.addEventListener('click', async ev => {
  const element = ev.target.closest('[data-action]');
  if (!element || element.disabled) return;
  try { await action(element.dataset.action, element); }
  catch (e) { notice(e.message); }
});
document.addEventListener('input', ev => {
  const f = ev.target.dataset.field;
  if (f === 'nickname') state.nickname = ev.target.value;
  else if (f === 'joinCode') {
    state.joinCode = ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);
    ev.target.value = state.joinCode;
  } else if (f === 'chatDraft') state.chatDraft = ev.target.value;
  else if (f === 'botDifficulty') state.botDifficulty = ev.target.value;
  else if (f === 'botAskTarget') state.botAskTarget = ev.target.value;
});
document.addEventListener('change', ev => {
  if (ev.target.dataset.field === 'botDifficulty') state.botDifficulty = ev.target.value;
  if (ev.target.dataset.field === 'botAskTarget') state.botAskTarget = ev.target.value;
});
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'chat-form') return;
  ev.preventDefault();
  const message = state.chatDraft.trim();
  if (!message) return;
  try { await call('chat', {text:message}); state.chatDraft = ''; render(); }
  catch (e) { notice(e.message); }
});
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    if (state.showRules) state.showRules = false;
    else if (state.selected) state.selected = null;
    else return;
    render();
  }
});
(async function boot() {
  if (state.session) {
    try { const value = await call('resume'); acceptSession(value); }
    catch { state.session = null; sessionStorage.removeItem('kraken-online-session'); }
  }
  render();
})();

// Update only the countdown digits. Re-rendering the full DOM each tick would
// interrupt the player's choice and keyboard focus.
const clockInterval=setInterval(() => {
  const timer = document.querySelector('[data-claim-countdown]');
  const deadline = game()?.claimEndsAt;
  if (timer && deadline) timer.textContent = Math.max(0,Math.ceil((deadline-Date.now())/1000));
  const review = document.querySelector('[data-review-countdown]');
  const reviewDeadline = game()?.reviewEndsAt;
  if (review && reviewDeadline) review.textContent = Math.max(0,Math.ceil((reviewDeadline-Date.now())/1000));
},100);

clockInterval.unref?.(); // Allows dependency-free Node template tests to exit.
