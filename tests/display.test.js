import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, formatBotChat, groupedReveals } from '../public/display-utils.js';

test('AI card quantities are bold, messages stay safe HTML', () => {
  assert.equal(formatBotChat('보물 2개, 공개된 3장'), '<strong class="chat-count">보물 2개</strong>, <strong class="chat-count">공개된 3장</strong>');
  assert.match(formatBotChat('보물이 1개라고 말할게요.'), /<strong class="chat-count">보물이 1개<\/strong>/);
  assert.match(formatBotChat('<img src=x onerror=alert(1)> 보물 0개'), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.ok(!formatBotChat('<b>3개</b>').includes('<b>'));
  assert.equal(escapeHtml('a&b'), 'a&amp;b');
});

test('Player count controls cards per history row, rounds control row count', () => {
  for (const playerCount of [4,5,6,8]) {
    const cards = [
      ...Array.from({length:playerCount},(_,index)=>({round:1,id:`r1-${index}`})),
      {round:2,id:'r2-0'},
    ];
    const rows = groupedReveals(cards, 2, playerCount);
    assert.equal(rows.length,2);
    assert.equal(rows[0].slots.length, playerCount);
    assert.equal(rows[0].slots.filter(Boolean).length,playerCount);
    assert.equal(rows[1].slots.length, playerCount);
    assert.equal(rows[1].slots.filter(Boolean).length,1);
    assert.equal(rows[1].slots[1],null);
    assert.equal(rows[0].cards[0].id,'r1-0');
  }
});
