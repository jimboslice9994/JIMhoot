import { safeJsonParse, uid } from './utils.js';

const KEYS = {
  playerId: 'study.playerId',
  importedDecks: 'study.importedDecks',
  stats: 'study.stats',
};

export function getPlayerId() {
  const existing = localStorage.getItem(KEYS.playerId);
  if (existing) return existing;
  const id = uid('player');
  localStorage.setItem(KEYS.playerId, id);
  return id;
}

export function getImportedDecks() {
  return safeJsonParse(localStorage.getItem(KEYS.importedDecks) || '[]', []);
}

export function saveImportedDeck(deck) {
  const decks = getImportedDecks();
  const idx = decks.findIndex((d) => d.id === deck.id);
  if (idx >= 0) decks[idx] = deck; else decks.push(deck);
  localStorage.setItem(KEYS.importedDecks, JSON.stringify(decks));
}

export function getStats() { return safeJsonParse(localStorage.getItem(KEYS.stats) || '{}', {}); }
export function saveStats(stats) { localStorage.setItem(KEYS.stats, JSON.stringify(stats)); }
