const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeForComparison, compareCaptionWindows } = require('../utils/caption-core.js');

test('comparison normalizes case, whitespace, NFC and edge punctuation only', () => {
  assert.equal(normalizeForComparison('  ¡CAFÉ!  funciona. '), 'café funciona');
  assert.equal(normalizeForComparison('cafe\u0301 funciona'), 'café funciona');
  assert.equal(normalizeForComparison('-12 1.2 .5 ,5 sí l\'amour'), '-12 1.2 .5 ,5 sí l\'amour');
});

test('word extension preserves the exact new Meet text', () => {
  const text = '¡Esto FUNCIONA correctamente!';
  assert.deepEqual(compareCaptionWindows('Esto funciona.', text), { text, sameUtterance: true });
});

test('equivalent wording keeps Meet punctuation and capitalization revisions', () => {
  assert.deepEqual(compareCaptionWindows('Hola cómo estás', '¡Hola, cómo estás!'), {
    text: '¡Hola, cómo estás!', sameUtterance: true,
  });
});

test('rolling overlap uses original Unicode spans and latest visible spelling', () => {
  const text = 'cafe\u0301 y la PRODUCCIÓN mañana.';
  assert.deepEqual(compareCaptionWindows('Tenemos que revisar el café y la producción.', text), {
    text: 'Tenemos que revisar el cafe\u0301 y la PRODUCCIÓN mañana.', sameUtterance: true,
  });
});

test('a wholly contained suffix is preserved as potentially new speech', () => {
  const text = 'LA BASE de producción mañana.';
  assert.deepEqual(compareCaptionWindows('Tenemos que revisar la base de producción mañana.', text), {
    text, sameUtterance: false,
  });
});

test('short or contained speech is preserved instead of suppressed', () => {
  for (const text of ['Hola', 'bien', 'revisar mañana']) {
    assert.deepEqual(compareCaptionWindows('Hola tenemos que revisar mañana todo bien', text), {
      text, sameUtterance: false,
    });
  }
});

test('word boundaries, accents, negative signs and decimals remain significant', () => {
  for (const [prev, text] of [['Hola', 'Holanda'], ['Sí', 'Si'], ['-12', '12'],
    ['1.2', '12'], ['.5', '5'], [',5', '5']]) {
    assert.deepEqual(compareCaptionWindows(prev, text), { text, sameUtterance: false });
  }
});

test('a long prefix-shaped caption is kept as possible new speech', () => {
  const text = 'Tenemos que revisar la base de producción.';
  assert.deepEqual(compareCaptionWindows(text, 'Tenemos que revisar la base'),
    { text: 'Tenemos que revisar la base', sameUtterance: false });
});

test('punctuation-only input cannot erase an existing utterance', () => {
  assert.deepEqual(compareCaptionWindows('Contenido importante.', '…'), {
    text: '…', sameUtterance: false,
  });
});
