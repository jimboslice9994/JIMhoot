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

export function parseAndImportCsv(csvText, deckType) {
  log('csv.parse.start', { deckType, len: csvText.length });
  const rows = parseCsvRFC4180(csvText);
  if (rows.length < 2) return { ok: false, message: 'CSV must include header and at least one row', rowResults: [] };

  const header = rows[0].map((h) => String(h).trim().toLowerCase());
  const rowResults = [];
  const items = [];
  let deckId = '';
  let deckTitle = '';

  for (let i = 1; i < rows.length; i += 1) {
    const line = rows[i];
    const rowNum = i + 1;
    const obj = {};
    header.forEach((h, idx) => { obj[h] = String(line[idx] ?? '').trim(); });

    if (!deckId) deckId = obj.deck_id;
    if (!deckTitle) deckTitle = obj.deck_title;

    if (!obj.deck_id || !obj.deck_title) {
      rowResults.push({ row: rowNum, status: 'skipped', reason: 'Missing deck_id or deck_title' });
      continue;
    }
    if (obj.deck_id !== deckId || obj.deck_title !== deckTitle) {
      rowResults.push({ row: rowNum, status: 'skipped', reason: 'Mixed deck_id/deck_title in file' });
      continue;
    }

    if (deckType === 'flashcards') {
      if (!obj.front || !obj.back) {
        rowResults.push({ row: rowNum, status: 'skipped', reason: 'Missing front or back' });
        continue;
      }
      items.push({ id: uid('fc'), front: obj.front, back: obj.back, tags: tagsSplit(obj.tags) });
      rowResults.push({ row: rowNum, status: 'imported' });
      continue;
    }

    const correct = String(obj.correct || '').toUpperCase();
    const time = Math.max(5, Math.min(120, Number(obj.time_limit_sec) || 20));
    if (!obj.question || !obj.a || !obj.b || !obj.c || !obj.d || !['A', 'B', 'C', 'D'].includes(correct)) {
      rowResults.push({ row: rowNum, status: 'skipped', reason: 'Invalid MCQ row (question/options/correct)' });
      continue;
    }
    items.push({
      id: uid('mcq'),
      question: obj.question,
      choices: { A: obj.a, B: obj.b, C: obj.c, D: obj.d },
      correct,
      explanation: obj.explanation || '',
      tags: tagsSplit(obj.tags),
      imageUrl: obj.image_url || '',
      timeLimitSec: time,
    });
    rowResults.push({ row: rowNum, status: 'imported' });
  }

  const importedRows = rowResults.filter((r) => r.status === 'imported').length;
  const report = {
    ok: importedRows > 0,
    deckType,
    deckId: deckId || uid('deck'),
    deckTitle: deckTitle || 'Imported deck',
    totalRows: rows.length - 1,
    importedRows,
    skippedRows: rowResults.length - importedRows,
    rowResults,
    deck: {
      id: deckId || uid('deck'),
      title: deckTitle || 'Imported deck',
      type: deckType,
      source: 'imported',
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: [],
      items,
    },
  };

  log('csv.parse.done', { importedRows, skipped: report.skippedRows });
  return report;
}
