const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cleanup = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../utils/transcript-cleanup.js')).toString('base64')}`);
const row = (text, timestamp = 1, utteranceId = 'one', speaker = 'Ana') => ({ text, timestamp, utteranceId, speaker });

test('progressive revisions keep original longest wording and initial timestamp', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const input = [row('Esto funciona.', 1), row('Esto funciona correctamente.', 2), row('Esto funciona correctamente mañana.', 3)];
  assert.deepEqual(cleanTranscriptForExport(input), [{ ...input[2], timestamp: 1 }]);
});

test('equivalent case, whitespace, NFC and final punctuation use latest original text', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const input = [row('Cafe\u0301 funciona.'), row('CAFÉ   funciona!', 2)];
  assert.deepEqual(cleanTranscriptForExport(input), [{ ...input[1], timestamp: 1 }]);
});

test('temporary commas, colons, semicolons and quotes do not split proven revisions', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  for (const text of ['Hola,', 'Hola:', 'Hola;', '“Hola.”']) {
    const input = [row(text, 1), row('Hola cómo estás.', 2)];
    assert.deepEqual(cleanTranscriptForExport(input), [{ ...input[1], timestamp: 1 }]);
  }
});

test('speakerless fallback merges only rows with a common explicit identity', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const first = row('Hola.', 1, 'one', '');
  const second = row('Hola cómo estás.', 2, 'one', '');
  assert.deepEqual(cleanTranscriptForExport([first, second]), [{ ...second, timestamp: 1 }]);
  const other = row('Hola cómo estás hoy.', 3, 'two', '');
  assert.deepEqual(cleanTranscriptForExport([second, other]), [second, other]);
});

test('shorter revision retains complete text without mutating frozen source', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const input = Object.freeze([Object.freeze(row('Hola cómo estás.', 1)), Object.freeze(row('Hola.', 2))]);
  const output = cleanTranscriptForExport(input);
  assert.deepEqual(output, [input[0]]);
  assert.notEqual(output, input);
  assert.notEqual(output[0], input[0]);
});

test('legacy, different IDs, speakers and interleaved speakers remain separate', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const variants = [
    [row('Hola.', 1, undefined), row('Hola cómo estás.', 2, undefined)],
    [row('Sí.'), row('Sí.', 2, 'two')],
    [row('Hola.'), row('Hola cómo estás.', 2, 'one', 'Luis')],
    [row('Hola.'), row('Sí.', 2, 'two', 'Luis'), row('Hola cómo estás.', 3)],
  ];
  delete variants[0][0].utteranceId;
  delete variants[0][1].utteranceId;
  for (const input of variants) assert.deepEqual(cleanTranscriptForExport(input), input);
});

test('no overlap, containment, fuzzy matches, number or accent folding', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const pairs = [
    ['Revisamos la base de datos.', 'la base de datos mañana.'],
    ['Esto funciona correctamente.', 'funciona'],
    ['Hola.', 'Holanda.'], ['Sí.', 'Si.'],
    ['Valor -5.', 'Valor 5.'], ['Valor .5.', 'Valor 5.'],
    ['Valor ,5.', 'Valor 5.'],
    ['Valor 1.5.', 'Valor 15.'], ['Valor 1,5.', 'Valor 15.'],
  ];
  for (const texts of pairs) {
    const input = texts.map((text, i) => row(text, i + 1));
    assert.deepEqual(cleanTranscriptForExport(input), input);
  }
});

test('malformed rows and decreasing or invalid timestamps block merging', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const variants = [
    [row('Hola.', 2), row('Hola cómo estás.', 1)],
    [row('Hola.'), row('Hola cómo estás.', NaN)],
    [row('Hola.'), row('Hola cómo estás.', '2')],
    [row('Hola.', 1, ''), row('Hola cómo estás.', 2, '')],
    [row('Hola.', 1, 'one', ' '), row('Hola cómo estás.', 2, 'one', ' ')],
    [row('Hola.'), null, row('Hola cómo estás.', 3)],
    [row('Hola.'), [], row('Hola cómo estás.', 3)],
    [row('Hola.'), undefined, row('Hola cómo estás.', 3)],
    [row('Hola.'), { ...row('Hola cómo estás.', 2), text: 123 }],
    [row('Hola.'), row('!!!', 2)],
  ];
  for (const input of variants) assert.deepEqual(cleanTranscriptForExport(input), input);
});

test('conflicting adjacent revision prevents crossing that original row', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const input = [row('Hola.'), row('Adiós.', 2), row('Hola cómo estás.', 3)];
  assert.deepEqual(cleanTranscriptForExport(input), input);
});

test('timestamps compare against last original revision rather than retained first', async () => {
  const { cleanTranscriptForExport } = await cleanup;
  const input = [row('Hola.', 1), row('Hola cómo estás.', 3), row('Hola cómo estás hoy.', 2)];
  assert.deepEqual(cleanTranscriptForExport(input), [{ ...input[1], timestamp: 1 }, input[2]]);
});
