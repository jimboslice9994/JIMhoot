import { safeJsonParse, uid } from './utils.js';

const KEYS = {
  playerId: 'study.playerId',
  importedDecks: 'study.importedDecks',
  stats: 'study.stats',
  analyticsOptIn: 'study.analyticsOptIn',
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
  saveImportedDecks([deck]);
}

export function saveImportedDecks(newDecks) {
  const current = getImportedDecks();
  const byId = new Map(current.map((deck) => [deck.id, deck]));
  newDecks.forEach((deck) => {
    if (deck?.id) byId.set(deck.id, deck);
  });
  localStorage.setItem(KEYS.importedDecks, JSON.stringify([...byId.values()]));
}

export function getStats() {
  return safeJsonParse(localStorage.getItem(KEYS.stats) || '{}', {});
}

export function saveStats(stats) {
  localStorage.setItem(KEYS.stats, JSON.stringify(stats));
}

export function updateDeckStats(deckId, updater) {
  const stats = getStats();
  const current = stats[deckId] || {
    attempts: 0,
    correct: 0,
    streak: 0,
    bestStreak: 0,
    lastPlayedAt: null,
    itemProgress: {},
  };

  const next = updater({ ...current, itemProgress: { ...(current.itemProgress || {}) } }) || current;
  next.lastPlayedAt = Date.now();
  stats[deckId] = next;
  saveStats(stats);
  return next;
}

export function setAnalyticsOptIn(enabled) {
  localStorage.setItem(KEYS.analyticsOptIn, enabled ? '1' : '0');
}

export function getAnalyticsOptIn() {
  return localStorage.getItem(KEYS.analyticsOptIn) === '1';
}
