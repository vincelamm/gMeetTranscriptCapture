/**
 * Characterization tests for the caption deduplication state machine.
 *
 * These lock in what the code does TODAY — including behaviour that is
 * arguably wrong. That is the point: this pipeline has silently lost data
 * twice, so nothing should be refactored or "improved" without a net that
 * shows exactly what changed.
 *
 * Where current behaviour is known to be undesirable it is marked KNOWN GAP,
 * with the ticket to fix it. Those assertions are expected to be *updated*
 * when the behaviour is deliberately changed — never deleted.
 *
 * Google Meet streams captions word by word and shows a rolling window: as
 * someone keeps talking the start scrolls out of view, so window text neither
 * grows monotonically nor stays prefix-stable.
 */

const test = require('node:test');
const assert = require('node:assert');
const { loadContentScript } = require('./load-content-script.js');

const DEBOUNCE_MS = 800;
const UTTERANCE_EXPIRY_MS = 12000;

/**
 * Drives the real pipeline: feed caption windows the way the MutationObserver
 * would, let the debounce fire, and read what was sent to the background.
 */
function transcriptOf(windows, { gapMs = 0 } = {}) {
  const { meet, clock, port } = loadContentScript();
  meet.openPort(); // so sendCaption() has a port to write to

  for (const frame of windows) {
    meet.processCaptionUpdate(new Map(Object.entries(frame)));
    clock.advance(DEBOUNCE_MS + gapMs);
  }
  // Speakers still buffered at the end are flushed when their block disappears
  meet.processCaptionUpdate(new Map());
  clock.advance(DEBOUNCE_MS);

  // Replay the messages the way background.js applies them, so the assertions
  // read as the resulting transcript rather than as a message log.
  const lines = [];
  for (const msg of port.captions()) {
    if (msg.replaceLastLine) {
      const idx = lines.map((l) => l.speaker).lastIndexOf(msg.speaker);
      if (idx !== -1) { lines[idx] = { speaker: msg.speaker, text: msg.text }; continue; }
    }
    lines.push({ speaker: msg.speaker, text: msg.text });
  }
  return lines;
}

const texts = (lines) => lines.map((l) => l.text);

// ---------------------------------------------------------------------------
// The core case: one utterance streamed word by word must stay one line
// ---------------------------------------------------------------------------
test('a sentence streamed word by word becomes a single line', () => {
  const lines = transcriptOf([
    { Anna: 'Guten' },
    { Anna: 'Guten Morgen' },
    { Anna: 'Guten Morgen zusammen' },
    { Anna: 'Guten Morgen zusammen wir starten' },
  ]);

  assert.deepStrictEqual(texts(lines), ['Guten Morgen zusammen wir starten']);
});

test('two speakers keep separate lines', () => {
  const lines = transcriptOf([
    { Anna: 'Ich fange an' },
    { Anna: 'Ich fange an mit dem Thema', Bert: 'Gerne' },
    { Bert: 'Gerne von mir aus' },
  ]);

  assert.deepStrictEqual(lines, [
    { speaker: 'Anna', text: 'Ich fange an mit dem Thema' },
    { speaker: 'Bert', text: 'Gerne von mir aus' },
  ]);
});

test('the rolling window is stitched back into one utterance', () => {
  // The start scrolls out of view; the new window overlaps the committed tail.
  const lines = transcriptOf([
    { Anna: 'wir sollten ueber das Budget reden' },
    { Anna: 'sollten ueber das Budget reden und dann weiter' },
  ]);

  assert.deepStrictEqual(texts(lines), ['wir sollten ueber das Budget reden und dann weiter']);
});

test('an unrelated utterance starts a new line', () => {
  const lines = transcriptOf([
    { Anna: 'Das war der erste Punkt' },
    { Anna: 'Voellig andere Aussage jetzt' },
  ]);

  assert.deepStrictEqual(texts(lines), ['Das war der erste Punkt', 'Voellig andere Aussage jetzt']);
});

test('silence longer than the utterance expiry forces a new line', () => {
  const lines = transcriptOf(
    [{ Anna: 'Erster Teil' }, { Anna: 'Erster Teil und Fortsetzung' }],
    { gapMs: UTTERANCE_EXPIRY_MS + 1000 },
  );

  assert.deepStrictEqual(texts(lines), ['Erster Teil', 'Erster Teil und Fortsetzung']);
});

test('an unchanged window does not produce a second line', () => {
  const lines = transcriptOf([
    { Anna: 'Immer der gleiche Text' },
    { Anna: 'Immer der gleiche Text' },
    { Anna: 'Immer der gleiche Text' },
  ]);

  assert.deepStrictEqual(texts(lines), ['Immer der gleiche Text']);
});

test('the speakerless text-only strategy sends an empty speaker', () => {
  const { meet, clock, port } = loadContentScript();
  meet.openPort();
  meet.processCaptionUpdate(new Map([['(speaker)', 'Text ohne Sprecherzuordnung']]));
  clock.advance(DEBOUNCE_MS);

  assert.deepStrictEqual(port.captions().map((m) => m.speaker), ['']);
});

// ---------------------------------------------------------------------------
// KNOWN GAPS — current behaviour, deliberately pinned so a change is visible.
// Both were fixed in v1.4.16/v1.4.17 and reverted in v1.4.18 when capture
// stopped working; the root cause of that outage is still unexplained.
// ---------------------------------------------------------------------------
test('KNOWN GAP: trailing punctuation splits one sentence into several lines', () => {
  // Meet appends a period once it considers a phrase finished and removes it
  // again when the sentence continues. Comparisons run on raw text, so the
  // period breaks startsWith(), includes() and the overlap calculation alike.
  const lines = transcriptOf([
    { Anna: 'Wir fangen an.' },
    { Anna: 'Wir fangen an mit dem Thema.' },
  ]);

  assert.deepStrictEqual(
    texts(lines),
    ['Wir fangen an.', 'Wir fangen an mit dem Thema.'],
    'If this now yields ONE line the punctuation fix is back — update this test ' +
    'rather than deleting it.',
  );
});

test('KNOWN GAP: a short utterance contained in the previous line is dropped', () => {
  // "gut" already appears inside the previous line, so the containment branch
  // discards it even though it is a genuine new utterance.
  const lines = transcriptOf([
    { Anna: 'Das lief heute richtig gut' },
    { Anna: 'gut' },
  ]);

  assert.deepStrictEqual(
    texts(lines),
    ['Das lief heute richtig gut'],
    'If "gut" now appears as its own line the containment guard is back — ' +
    'update this test rather than deleting it.',
  );
});
