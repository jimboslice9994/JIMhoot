import { parseAndImportCsv } from './csv.js';

function validateModes(modes = {}) {
  return Boolean(
    (modes.flashcards?.length || 0)
    || (modes.quiz?.length || 0)
    || (modes.fillBlank?.length || 0)
  );
}

function normalizeDeck(deck) {
  return {
    id: deck.id,
    title: deck.title || deck.deck_name || 'Imported Deck',
    source: deck.source || 'imported',
    tags: Array.isArray(deck.tags) ? deck.tags : [],
    modes: {
      flashcards: Array.isArray(deck?.modes?.flashcards) ? deck.modes.flashcards : [],
      quiz: Array.isArray(deck?.modes?.quiz) ? deck.modes.quiz : [],
      fillBlank: Array.isArray(deck?.modes?.fillBlank) ? deck.modes.fillBlank : [],
    },
  };
}

export function parseImportText(text, type) {
  if (type === 'json') {
    const parsed = JSON.parse(text);
    const decks = Array.isArray(parsed.decks) ? parsed.decks : Array.isArray(parsed) ? parsed : [parsed];
    const normalized = decks.map(normalizeDeck).filter((deck) => deck.id && validateModes(deck.modes));
    return {
      ok: normalized.length > 0,
      decks: normalized,
      totalRows: normalized.length,
      importedRows: normalized.length,
      skippedRows: decks.length - normalized.length,
      rowResults: normalized.map((_, idx) => ({ row: idx + 1, status: 'imported' })),
      sourceType: 'json',
    };
  }

  const report = parseAndImportCsv(text);
  return { ...report, sourceType: 'csv' };
}
