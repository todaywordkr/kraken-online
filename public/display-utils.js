/** Display-only helpers; never interpret chat text as HTML. */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** Highlight the quantity in a bot's card claim while escaping the original text. */
export function formatBotChat(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/((?:보물(?:이|은|을)?|빈\s*상자(?:가|는)?|크라켄(?:이|은)?|카드(?:가|는)?|공개된|남은|총)\s*)?(\d+\s*(?:개|장))/g,
    (match) => `<strong class="chat-count">${match}</strong>`);
}

/** Exactly one history row per round; exactly playerCount slots per row. */
export function groupedReveals(revealed, currentRound, playerCount) {
  return Array.from({length: currentRound}, (_, index) => {
    const round = index + 1;
    const cards = revealed.filter(card => card.round === round);
    return {round, cards, slots: Array.from({length: playerCount}, (_, pos) => cards[pos] || null)};
  });
}
