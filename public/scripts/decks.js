import { getImportedDecks } from './storage.js';
import { log } from './debug.js';

export async function loadDecks() {
  try {
    const res = await fetch('/data/decks.json', { cache: 'no-store' });
    log('deck.fetch', { ok: res.ok, status: res.status });
    const data = res.ok ? await res.json() : { decks: [] };
    const imported = getImportedDecks();
    return [...(data.decks || []), ...imported];
  } catch (err) {
    log('deck.fetch.error', { message: err.message });
    return getImportedDecks();
  }
}

export function renderDeckLibrary(decks) {
  if (!decks.length) return '<p class="muted">No decks loaded. You can still import CSV.</p>';
  const items = decks.map((d) => `<li><strong>${d.title}</strong> (${d.type}) - ${d.items.length} items</li>`).join('');
  return `<ul>${items}</ul>`;
}
