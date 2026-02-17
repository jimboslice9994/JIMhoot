import { log } from './debug.js';
import { uid } from './utils.js';

function parseCsvRFC4180(input) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    if (ch === '\r') continue;
    field += ch;
  }

  row.push(field);
  rows.push(row);
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function tagsSplit(value) {
  return String(value || '').split('|').map((v) => v.trim()).filter(Boolean);
}

function rowToObject(header, row) {
  const obj = {};
  header.forEach((key, idx) => {
    obj[key] = String(row[idx] ?? '').trim();
  });
  return obj;
}

function validateHeaders(headerSet) {
  const required = ['deck_name'];
  const missing = required.filter((h) => !headerSet.has(h));
  return missing;
}

function validChoice(value) {
  return ['A', 'B', 'C', 'D'].includes(String(value || '').toUpperCase());
}

export function parseAndImportCsv(csvText) {
  log('csv.parse.start', { len: csvText.length });
  const rows = parseCsvRFC4180(csvText);

  if (rows.length < 2) {
    return { ok: false, message: 'CSV must include header and at least one row', rowResults: [] };
  }

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const missingHeaders = validateHeaders(new Set(header));
  if (missingHeaders.length) {
    return { ok: false, message: `Missing required headers: ${missingHeaders.join(', ')}`, rowResults: [] };
  }

  const rowResults = [];
  const decksByName = new Map();

  function getDeck(deckName) {
    const normalized = String(deckName || '').trim();
    if (!decksByName.has(normalized)) {
      decksByName.set(normalized, {
        id: uid('deck'),
        title: normalized,
        source: 'imported',
        tags: [],
        modes: { flashcards: [], quiz: [], fillBlank: [] },
      });
    }
    return decksByName.get(normalized);
  }

  for (let i = 1; i < rows.length; i += 1) {
    const rowNum = i + 1;
    const obj = rowToObject(header, rows[i]);

    if (!obj.deck_name) {
      rowResults.push({ row: rowNum, status: 'skipped', reason: 'Missing deck_name' });
      continue;
    }

    const deck = getDeck(obj.deck_name);
    const tags = tagsSplit(obj.tags);
    let produced = 0;

    const hasQuizFields = obj.question && obj.choice_a && obj.choice_b && obj.choice_c && obj.choice_d && validChoice(obj.correct_choice);
    if (hasQuizFields) {
      deck.modes.quiz.push({
        id: uid('quiz'),
        question: obj.question,
        choices: { A: obj.choice_a, B: obj.choice_b, C: obj.choice_c, D: obj.choice_d },
        correctChoice: obj.correct_choice.toUpperCase(),
        explanation: obj.answer_explanation || '',
        tags,
        difficulty: obj.difficulty || '',
        timeLimitSec: 10,
      });
      produced += 1;
    }

    const hasFlashFields = obj.flashcard_front && obj.flashcard_back;
    if (hasFlashFields) {
      deck.modes.flashcards.push({
        id: uid('fc'),
        front: obj.flashcard_front,
        back: obj.flashcard_back,
        explanation: obj.answer_explanation || '',
        tags,
        difficulty: obj.difficulty || '',
      });
      produced += 1;
    }

    const hasFillFields = obj.fill_blank_sentence && obj.fill_blank_answer;
    if (hasFillFields) {
      deck.modes.fillBlank.push({
        id: uid('fb'),
        sentence: obj.fill_blank_sentence,
        answer: obj.fill_blank_answer,
        explanation: obj.answer_explanation || '',
        tags,
        difficulty: obj.difficulty || '',
      });
      produced += 1;
    }

    if (!produced) {
      rowResults.push({ row: rowNum, status: 'skipped', reason: 'Row does not contain valid quiz/flashcard/fill_blank fields' });
    } else {
      rowResults.push({ row: rowNum, status: 'imported', generatedModes: produced });
    }
  }

  const decks = [...decksByName.values()].filter((deck) => (
    deck.modes.flashcards.length || deck.modes.quiz.length || deck.modes.fillBlank.length
  ));

  const importedRows = rowResults.filter((r) => r.status === 'imported').length;
  const report = {
    ok: decks.length > 0,
    decks,
    totalRows: rows.length - 1,
    importedRows,
    skippedRows: rowResults.length - importedRows,
    rowResults,
  };

  log('csv.parse.done', { decks: decks.length, importedRows, skippedRows: report.skippedRows });
  return report;
}
