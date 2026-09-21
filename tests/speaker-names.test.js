/**
 * Regression tests for the failure mode that matters most in this extension:
 * a participant's words disappearing from the transcript with no trace.
 *
 * Real incident (2026-09-21): a guest whose Meet display name was "test" was
 * never recorded. isSentenceFragment() rejected every speaker label starting
 * with a lowercase letter, so extractByPosition() dropped that participant's
 * blocks entirely. Nothing in the transcript, the popup or the log indicated
 * that anything had been discarded.
 *
 * Run with:  node --test tests/
 */

const test = require('node:test');
const assert = require('node:assert');
const { loadContentScript } = require('./load-content-script.js');

const meet = loadContentScript();

// ---------------------------------------------------------------------------
// Fake DOM — only what extractByPosition actually touches.
// ---------------------------------------------------------------------------
const el = (text, children = []) => ({
  nodeType: 1,
  children,
  get textContent() {
    return children.length ? children.map((c) => c.textContent).join('') : text;
  },
});

/** One Meet caption block: speaker label followed by the caption text. */
const captionBlock = (speaker, text) => el('', [el(speaker), el(text)]);
const container = (...blocks) => ({ children: blocks });

// ---------------------------------------------------------------------------
// Display names that must never be treated as running text
// ---------------------------------------------------------------------------
const REAL_DISPLAY_NAMES = [
  'Vincent Lammers',   // ordinary capitalised name
  'test',              // the 2026-09-21 incident
  'sa',                // two letters, lowercase
  'max',               // lowercase first name
  'björn',             // lowercase, non-ASCII
  'van Dijk',          // Dutch particle, lowercase start
  'de la Cruz',        // three words, lowercase start
  'Dr. Anna Schmidt',
  'x',                 // single character
  'anna.mueller',      // handle-style name
  '田中太郎',            // no case distinction at all
];

// Strings in the speaker slot that really are caption text
const RUNNING_TEXT = [
  'und dann sagte er',
  'das ist ja interessant',
  'wir sollten nochmal darüber reden, oder',
  'ich glaube das passt so nicht ganz gut zusammen',
];

test('isSentenceFragment accepts real Meet display names', () => {
  for (const name of REAL_DISPLAY_NAMES) {
    assert.strictEqual(
      meet.isSentenceFragment(name), false,
      `Display name "${name}" was classified as running text — that participant's ` +
      `contributions would be silently dropped from the transcript.`
    );
  }
});

test('isSentenceFragment still rejects running text in the speaker slot', () => {
  for (const fragment of RUNNING_TEXT) {
    assert.strictEqual(
      meet.isSentenceFragment(fragment), true,
      `"${fragment}" should not be accepted as a speaker name.`
    );
  }
});

// ---------------------------------------------------------------------------
// End-to-end through the extraction path — the helper being right is not
// enough; what matters is that the utterance survives extraction.
// ---------------------------------------------------------------------------
test('extractByPosition captures every participant regardless of name casing', () => {
  for (const name of REAL_DISPLAY_NAMES) {
    const spoken = 'Das ist ein vollstaendiger Satz mit genug Laenge.';
    const result = meet.extractByPosition(container(captionBlock(name, spoken)));

    assert.strictEqual(
      result.size, 1,
      `Utterance by "${name}" was dropped during extraction — this is the silent ` +
      `data-loss bug from 2026-09-21.`
    );
    assert.strictEqual(result.get(name), spoken);
  }
});

test('extractByPosition keeps all speakers when several are talking', () => {
  const result = meet.extractByPosition(container(
    captionBlock('Vincent Lammers', 'Ich fange mal an mit dem ersten Punkt.'),
    captionBlock('test', 'Ich habe dazu auch noch eine Anmerkung.'),
    captionBlock('sa', 'Von mir aus koennen wir weitermachen.'),
  ));

  assert.deepStrictEqual(
    [...result.keys()].sort(),
    ['Vincent Lammers', 'sa', 'test'],
    'A participant vanished when several people were speaking.'
  );
});
