const test = require('node:test');
const assert = require('node:assert/strict');

global.document = {
  getElementById() {
    return null;
  },
};

async function importCsvModule() {
  return import('../public/scripts/csv.js');
}

test('parseAndImportCsv accepts UTF-8 BOM header and imports quiz rows', async () => {
  const { parseAndImportCsv } = await importCsvModule();
  const csv = [
    '\ufeffdeck_name,question,choice_a,choice_b,choice_c,choice_d,correct_choice,answer_explanation',
    'Biology Basics,What powers the cell?,Mitochondria,Nucleus,Ribosome,Golgi,A,ATP production',
  ].join('\n');

  const report = parseAndImportCsv(csv);
  assert.equal(report.ok, true);
  assert.equal(report.decks.length, 1);
  assert.equal(report.decks[0].modes.quiz.length, 1);
  assert.equal(report.decks[0].modes.quiz[0].correctChoice, 'A');
  assert.equal(report.importedRows, 1);
  assert.equal(report.skippedRows, 0);
});


test('parseAndImportCsv best-effort maps messy quiz headers', async () => {
  const { parseAndImportCsv } = await importCsvModule();
  const csv = [
    ' Deck Name ,Question Text,Option A,Option B,Option C,Option D,Answer Choice,Explanation',
    'Chemistry,Atomic number of Oxygen?,6,7,8,9,C,Element facts',
  ].join('\n');

  const report = parseAndImportCsv(csv);
  assert.equal(report.ok, true);
  assert.equal(report.decks.length, 1);
  assert.equal(report.decks[0].title, 'Chemistry');
  assert.equal(report.decks[0].modes.quiz.length, 1);
  assert.equal(report.decks[0].modes.quiz[0].correctChoice, 'C');
});
