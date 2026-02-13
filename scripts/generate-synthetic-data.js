const fs = require('node:fs');
const path = require('node:path');

function pick(arr, idx) {
  return arr[idx % arr.length];
}

function generateSyntheticData(opts = {}) {
  const decks = Number(opts.decks || 8);
  const itemsPerDeck = Number(opts.itemsPerDeck || 200);
  const attempts = Number(opts.attempts || 5000);
  const users = Number(opts.users || 300);

  const deckList = [];
  for (let d = 0; d < decks; d += 1) {
    const deckId = `synthetic_deck_${d + 1}`;
    const items = [];
    for (let i = 0; i < itemsPerDeck; i += 1) {
      items.push({
        id: `${deckId}_item_${i + 1}`,
        prompt: `Question ${i + 1} in ${deckId}`,
        answer: `Answer ${i + 1}`,
      });
    }
    deckList.push({ id: deckId, title: `Synthetic Deck ${d + 1}`, items });
  }

  const attemptRows = [];
  for (let a = 0; a < attempts; a += 1) {
    const deck = pick(deckList, a);
    const item = pick(deck.items, a * 7 + 13);
    attemptRows.push({
      userId: `user_${(a % users) + 1}`,
      deckId: deck.id,
      itemId: item.id,
      quality: a % 5,
      ts: Date.now() - (a * 60000),
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: { decks, itemsPerDeck, attempts, users },
    decks: deckList,
    attempts: attemptRows,
  };
}

function writeSyntheticFile(data, outPath) {
  const output = outPath || path.join('.data', `synthetic-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(data), 'utf8');
  return output;
}

if (require.main === module) {
  const data = generateSyntheticData({
    decks: process.env.SYN_DECKS || 8,
    itemsPerDeck: process.env.SYN_ITEMS_PER_DECK || 200,
    attempts: process.env.SYN_ATTEMPTS || 5000,
    users: process.env.SYN_USERS || 300,
  });
  const out = writeSyntheticFile(data, process.env.SYN_OUT_PATH);
  console.log(JSON.stringify({ out, summary: data.summary }, null, 2));
}

module.exports = {
  generateSyntheticData,
  writeSyntheticFile,
};
