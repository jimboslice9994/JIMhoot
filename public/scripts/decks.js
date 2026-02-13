import { getImportedDecks } from './storage.js';
import { log } from './debug.js';
import { uid } from './utils.js';

function normalizeLegacyDeck(deck) {
  if (deck?.modes) {
    return {
      id: deck.id || uid('deck'),
      title: deck.title || 'Untitled Deck',
      source: deck.source || 'imported',
      tags: Array.isArray(deck.tags) ? deck.tags : [],
      modes: {
        flashcards: Array.isArray(deck.modes.flashcards) ? deck.modes.flashcards : [],
        quiz: Array.isArray(deck.modes.quiz) ? deck.modes.quiz : [],
        fillBlank: Array.isArray(deck.modes.fillBlank) ? deck.modes.fillBlank : [],
      },
    };
  }

  if (deck?.type === 'flashcards') {
    return {
      id: deck.id || uid('deck'),
      title: deck.title || 'Untitled Deck',
      source: deck.source || 'bundled',
      tags: Array.isArray(deck.tags) ? deck.tags : [],
      modes: {
        flashcards: (deck.items || []).map((item) => ({
          id: item.id || uid('fc'),
          front: String(item.front || '').trim(),
          back: String(item.back || '').trim(),
          explanation: String(item.explanation || ''),
          tags: Array.isArray(item.tags) ? item.tags : [],
          difficulty: item.difficulty || '',
        })).filter((item) => item.front && item.back),
        quiz: [],
        fillBlank: [],
      },
    };
  }

  if (deck?.type === 'mcq') {
    return {
      id: deck.id || uid('deck'),
      title: deck.title || 'Untitled Deck',
      source: deck.source || 'bundled',
      tags: Array.isArray(deck.tags) ? deck.tags : [],
      modes: {
        flashcards: [],
        quiz: (deck.items || []).map((item) => ({
          id: item.id || uid('quiz'),
          question: String(item.question || '').trim(),
          choices: item.choices,
          correctChoice: String(item.correct || '').toUpperCase(),
          explanation: String(item.explanation || ''),
          tags: Array.isArray(item.tags) ? item.tags : [],
          difficulty: item.difficulty || '',
          timeLimitSec: Number(item.timeLimitSec) > 0 ? Number(item.timeLimitSec) : 10,
        })).filter((item) => item.question && item.choices?.A && item.choices?.B && item.choices?.C && item.choices?.D && ['A', 'B', 'C', 'D'].includes(item.correctChoice)),
        fillBlank: [],
      },
    };
  }

  return {
    id: uid('deck'),
    title: 'Untitled Deck',
    source: 'bundled',
    tags: [],
    modes: { flashcards: [], quiz: [], fillBlank: [] },
  };
}

export async function loadDecks() {
  try {
    const res = await fetch('/data/decks.json', { cache: 'no-store' });
    log('deck.fetch', { ok: res.ok, status: res.status });
    const data = res.ok ? await res.json() : { decks: [] };
    const imported = getImportedDecks();
    return [...(data.decks || []), ...imported].map(normalizeLegacyDeck);
  } catch (err) {
    log('deck.fetch.error', { message: err.message });
    return getImportedDecks().map(normalizeLegacyDeck);
  }
}

export function getDeckById(decks, deckId) {
  return decks.find((deck) => deck.id === deckId) || null;
}

function modeButton(deck, mode, label) {
  const count = deck.modes[mode].length;
  if (!count) return '';
  return `<button class="mode-launch" data-deck-id="${deck.id}" data-mode="${mode}">${deck.title} — ${label} (${count})</button>`;
}

export function renderDeckLibrary(decks) {
  if (!decks.length) return '<p class="muted">No decks loaded. You can still import CSV.</p>';

  return decks.map((deck) => `
    <article class="deck-tile">
      <h3>${deck.title}</h3>
      <p class="muted">source: ${deck.source}</p>
      <div class="mode-buttons">
        ${modeButton(deck, 'flashcards', 'Flashcards')}
        ${modeButton(deck, 'quiz', 'Quiz')}
        ${modeButton(deck, 'fillBlank', 'Fill in the Blank')}
      </div>
    </article>
  `).join('');
}
