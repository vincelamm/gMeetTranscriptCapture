/**
 * Characterization tests for the caption deduplication state machine.
 *
 * Existing characterization cases and regressions exercise the real shipped
 * pipeline. The previous KNOWN GAP punctuation and short-phrase assertions now
 * specify the corrected behavior, with conservative no-data-loss boundaries.
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

// Regression tests for the previously documented KNOWN GAP cases.
test('REGRESSION: trailing punctuation no longer splits one sentence', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Anna: 'Wir fangen an.' },
    { Anna: 'Wir fangen an mit dem Thema.' },
  ])), ['Wir fangen an mit dem Thema.']);
});

test('REGRESSION: a short utterance contained in the previous line is retained', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Anna: 'Das lief heute richtig gut' }, { Anna: 'gut' },
  ])), ['Das lief heute richtig gut', 'gut']);
});

/** Frames use elapsed milliseconds, including the real debounce between them. */
function transcriptAt(frames) {
  const { meet, clock, port } = loadContentScript();
  meet.openPort();
  let elapsed = 0;
  for (const { at, captions } of frames) {
    clock.advance(at - elapsed);
    elapsed = at;
    meet.processCaptionUpdate(new Map(Object.entries(captions)));
  }
  clock.advance(DEBOUNCE_MS);
  meet.processCaptionUpdate(new Map());
  const lines = [];
  for (const msg of port.captions()) {
    const index = lines.map((line) => line.speaker).lastIndexOf(msg.speaker);
    if (msg.replaceLastLine && index !== -1) {
      lines[index] = { ...lines[index], text: msg.text };
    } else {
      lines.push({ speaker: msg.speaker, text: msg.text, timestamp: msg.timestamp });
    }
  }
  return lines;
}

test('Spanish punctuation and progressive extensions retain one complete line', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Esto funciona.' }, { Manuel: 'Esto funciona correctamente.' },
  ])), ['Esto funciona correctamente.']);
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Esto es una prueba' },
    { Manuel: 'Esto es una prueba para ver si funciona' },
    { Manuel: 'Esto es una prueba para ver si funciona correctamente.' },
  ])), ['Esto es una prueba para ver si funciona correctamente.']);
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Tenemos que revisar la base' },
    { Manuel: 'Tenemos que revisar la base de producción' },
    { Manuel: 'Tenemos que revisar la base de producción mañana.' },
  ])), ['Tenemos que revisar la base de producción mañana.']);
});

test('Meet case and canonical Unicode revisions preserve the latest original', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'estoy hablando yo.' },
    { Manuel: 'estoy hablando Yo estoy hablando.' },
  ])), ['estoy hablando Yo estoy hablando.']);
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Revisamos el café.' },
    { Manuel: 'REVISAMOS el cafe\u0301 de producción.' },
  ])), ['REVISAMOS el cafe\u0301 de producción.']);
});

test('normalization does not erase accents or numbers from different utterances', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Sí' }, { Manuel: 'Si' }, { Manuel: 'Tenemos 12' }, { Manuel: 'Tenemos 13' },
  ])), ['Sí', 'Si', 'Tenemos 12', 'Tenemos 13']);
});

test('rolling captions match normalized overlap and preserve new original text', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Tenemos que revisar el café y la producción.' },
    { Manuel: 'el cafe\u0301 y la PRODUCCIÓN mañana a las 10.' },
  ])), ['Tenemos que revisar el cafe\u0301 y la PRODUCCIÓN mañana a las 10.']);
});

test('a suffix-only phrase is retained when continuation is ambiguous', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Tenemos que revisar la base de producción mañana.' },
    { Manuel: 'LA BASE de producción mañana.' },
  ])), ['Tenemos que revisar la base de producción mañana.', 'LA BASE de producción mañana.']);
});

test('simultaneous speakers keep their own growing utterances', () => {
  assert.deepStrictEqual(transcriptOf([
    { Ana: 'Esto funciona.', Luis: 'Hola.' },
    { Ana: 'Esto funciona correctamente.', Luis: 'Hola cómo estás.' },
  ]), [
    { speaker: 'Ana', text: 'Esto funciona correctamente.' },
    { speaker: 'Luis', text: 'Hola cómo estás.' },
  ]);
});

test('short continuation may grow but partial-word prefixes remain separate', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Hola.' }, { Manuel: 'Hola cómo estás.' },
  ])), ['Hola cómo estás.']);
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'hola' }, { Manuel: 'holanda' },
  ])), ['hola', 'holanda']);
});

test('an exact short repetition after disappearing from DOM is retained', () => {
  assert.deepStrictEqual(texts(transcriptAt([
    { at: 0, captions: { Manuel: 'Sí.' } },
    { at: 1000, captions: {} },
    { at: 1800, captions: { Manuel: 'Sí.' } },
  ])), ['Sí.', 'Sí.']);
});

test('speaker disappearance separates even a long prefix-shaped utterance', () => {
  assert.deepStrictEqual(texts(transcriptAt([
    { at: 0, captions: { Manuel: 'Tenemos que revisar la base.' } },
    { at: 1000, captions: {} },
    { at: 1800, captions: { Manuel: 'Tenemos que revisar la base de producción.' } },
  ])), ['Tenemos que revisar la base.', 'Tenemos que revisar la base de producción.']);
});

test('a committed prefix-shaped utterance is retained even without a DOM disappearance', () => {
  assert.deepStrictEqual(texts(transcriptAt([
    { at: 0, captions: { Manuel: 'Tenemos que revisar la base de producción.' } },
    { at: 1000, captions: { Manuel: 'Tenemos que revisar la base' } },
  ])), ['Tenemos que revisar la base de producción.', 'Tenemos que revisar la base']);
});

test('an unrelated contained fragment is conservatively kept', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'Hoy hablamos del presupuesto y de los costes de producción.' },
    { Manuel: 'del presupuesto y de los costes' },
  ])), ['Hoy hablamos del presupuesto y de los costes de producción.', 'del presupuesto y de los costes']);
});

test('the real 13/14/15/20 second revisions produce one coherent utterance', () => {
  const finalText = 'Esto es una prueba para ver si realmente funciona a ver, estoy hablando Yo estoy hablando a ver quiero ver cómo se muestra la transmisión y todo eso.';
  const lines = transcriptAt([
    { at: 13000, captions: { Manuel: 'Esto es una prueba para ver si realmente funciona.' } },
    { at: 14000, captions: { Manuel: 'Esto es una prueba para ver si realmente funciona a ver, estoy hablando yo.' } },
    { at: 15000, captions: { Manuel: 'Esto es una prueba para ver si realmente funciona a ver, estoy hablando Yo estoy.' } },
    { at: 20000, captions: { Manuel: finalText } },
  ]);
  assert.deepStrictEqual(texts(lines), [finalText]);
  assert.strictEqual(lines[0].timestamp, 1_700_000_000_000 + 13800);
});

test('continuous updates longer than expiry keep the active utterance', () => {
  const frames = [{ at: 0, captions: { Manuel: 'Tenemos que revisar' } }];
  for (let i = 0; i < 28; i++) {
    frames.push({ at: 1000 + i * 500, captions: { Manuel: 'Tenemos que revisar ' + Array(i + 1).fill('todo').join(' ') } });
  }
  const lines = transcriptAt(frames);
  assert.deepStrictEqual(texts(lines), [frames.at(-1).captions.Manuel]);
});

test('a real long pause before a growing debounce starts a new utterance', () => {
  const frames = [{ at: 0, captions: { Manuel: 'Tenemos que revisar' } }];
  for (let i = 0; i < 28; i++) {
    frames.push({ at: 15000 + i * 500, captions: { Manuel: 'Tenemos que revisar ' + Array(i + 1).fill('todo').join(' ') } });
  }
  assert.deepStrictEqual(texts(transcriptAt(frames)), ['Tenemos que revisar', frames.at(-1).captions.Manuel]);
});


test('unrelated pending captions before debounce preserve both phrases', () => {
  assert.deepStrictEqual(texts(transcriptAt([
    { at: 0, captions: { Manuel: 'La primera frase.' } },
    { at: 300, captions: { Manuel: 'Una idea diferente.' } },
  ])), ['La primera frase.', 'Una idea diferente.']);
});

test('rolling captions before first debounce preserve the beginning', () => {
  assert.deepStrictEqual(texts(transcriptAt([
    { at: 0, captions: { Manuel: 'Tenemos que revisar la base de producción' } },
    { at: 300, captions: { Manuel: 'la base de producción mañana.' } },
  ])), ['Tenemos que revisar la base de producción mañana.']);
});

test('comparison preserves decimal and negative numerical meaning', () => {
  assert.deepStrictEqual(texts(transcriptOf([
    { Manuel: 'El resultado es -12.' }, { Manuel: 'El resultado es 12.' },
    { Manuel: 'La versión es 1.2.' }, { Manuel: 'La versión es 12.' },
  ])), ['El resultado es -12.', 'El resultado es 12.', 'La versión es 1.2.', 'La versión es 12.']);
});

test('the actual observer processes an empty region as a speaker boundary', () => {
  const { meet, clock, port } = loadContentScript();
  meet.openPort();
  let onMutation;
  meet.MutationObserver = class {
    constructor(callback) { onMutation = callback; }
    observe() {}
    disconnect() {}
  };
  const container = { isConnected: true };
  let frame = new Map([['Manuel', 'Sí.']]);
  const strategy = { name: 'fixture', findContainer: () => container, extractSpeakers: () => frame };
  meet.startObserver(strategy, container);
  onMutation();
  clock.advance(DEBOUNCE_MS);
  frame = new Map();
  onMutation();
  frame = new Map([['Manuel', 'Sí.']]);
  onMutation();
  clock.advance(DEBOUNCE_MS);
  assert.deepStrictEqual(port.captions().map(msg => [msg.text, msg.replaceLastLine]), [
    ['Sí.', false], ['Sí.', false],
  ]);
});
