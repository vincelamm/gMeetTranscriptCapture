const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadContentScript } = require('./load-content-script');

const loadModule = name => import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../utils', name)).toString('base64')}`);

async function loadBackground(lines = [], startTime = 0) {
  const formatter = await loadModule('formatter.js');
  const context = vm.createContext({
    ...formatter, console, setTimeout: () => 1, clearTimeout() {},
    chrome: {
      runtime: { onConnect: { addListener() {} }, onMessage: { addListener() {} } },
      tabs: { onRemoved: { addListener() {} }, onUpdated: { addListener() {} } },
      storage: { session: {
        get: async () => ({ captureState: { lines, startTime, meetingTitle: 'Prueba' } }),
        set: async () => {},
      } },
      downloads: { download: async ({ url }) => { context.output = decodeURIComponent(url.split(',')[1]); } },
    },
  });
  // The real module exports are injected; only static import syntax is removed
  // because the browser service worker is exercised in a classic Node VM.
  const source = fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8')
    .replace(/^import .* from .*;\r?\n/gm, '');
  vm.runInContext(source, context, { filename: 'background.js' });
  return context;
}

test('background preserves turn identity across revisions and storage', async () => {
  const bg = await loadBackground();
  const state = { lines: [] };
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Hola.', timestamp: 1000, utteranceId: 'turn-1' });
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Hola a todos.', timestamp: 2000,
    utteranceId: 'turn-1', replaceLastLine: true });
  assert.equal(state.lines.length, 1);
  assert.equal(state.lines[0].utteranceId, 'turn-1');
  assert.equal(state.lines[0].timestamp, 1000);
  assert.equal(state.lines[0].text, 'Hola a todos.');
});

test('real caption pipeline exports the 13/14/15/20 second case once in both formats', async () => {
  const { cleanTranscriptForExport } = await loadModule('transcript-cleanup.js');
  const h = loadContentScript();
  h.meet.openPort();
  const start = h.clock.now;
  const finalText = 'Esto es una prueba para ver si realmente funciona a ver, estoy hablando Yo estoy hablando a ver quiero ver cómo se muestra la transmisión y todo eso.';
  const frames = [
    [13000, 'Esto es una prueba para ver si realmente funciona.'],
    [14000, 'Esto es una prueba para ver si realmente funciona a ver, estoy hablando yo.'],
    [15000, 'Esto es una prueba para ver si realmente funciona a ver, estoy hablando Yo estoy.'],
    [20000, finalText],
  ];
  for (const [at, text] of frames) {
    h.clock.advance(start + at - h.clock.now);
    h.meet.processCaptionUpdate(new Map([['Manuel', text]]));
  }
  h.clock.advance(800);
  const bg = await loadBackground([], start);
  bg.cleanTranscriptForExport = cleanTranscriptForExport;
  const state = await bg.ensureState();
  for (const message of h.port.captions()) bg.appendCaptionLine(state, message);
  assert.equal(state.lines.length, 1);
  assert.equal(state.lines[0].text, finalText);
  assert.equal(state.lines[0].timestamp, start + 13800);
  const raw = structuredClone(state.lines);
  for (const format of ['txt', 'md']) {
    await bg.handleMessage({ type: 'DOWNLOAD_TRANSCRIPT', format });
    assert.equal((bg.output.match(/Esto es una prueba/g) || []).length, 1);
    assert.ok(bg.output.includes(finalText));
    assert.ok(bg.output.includes('[00:00:13] Manuel'));
    assert.deepEqual(structuredClone(state.lines), raw);
  }
});

test('capture through export preserves rapid distinct speech, speaker turns and repeated short replies', async () => {
  const { cleanTranscriptForExport } = await loadModule('transcript-cleanup.js');
  const h = loadContentScript();
  h.meet.openPort();
  const start = h.clock.now;
  h.meet.processCaptionUpdate(new Map([['Ana', 'Primera frase.']]));
  h.clock.advance(300);
  h.meet.processCaptionUpdate(new Map([['Ana', 'Otra idea.'], ['Luis', 'Sí.']]));
  h.clock.advance(800);
  h.meet.processCaptionUpdate(new Map());
  h.meet.processCaptionUpdate(new Map([['Luis', 'Sí.']]));
  h.clock.advance(800);
  const bg = await loadBackground([], start);
  bg.cleanTranscriptForExport = cleanTranscriptForExport;
  const state = await bg.ensureState();
  for (const message of h.port.captions()) bg.appendCaptionLine(state, message);
  assert.deepEqual(Array.from(state.lines, line => [line.speaker, line.text]), [
    ['Ana', 'Primera frase.'], ['Ana', 'Otra idea.'], ['Luis', 'Sí.'], ['Luis', 'Sí.'],
  ]);
  assert.equal(new Set(state.lines.map(line => line.utteranceId)).size, 4);
  for (const format of ['txt', 'md']) {
    await bg.handleMessage({ type: 'DOWNLOAD_TRANSCRIPT', format });
    assert.ok(bg.output.includes('Primera frase.') && bg.output.includes('Otra idea.'));
    assert.equal((bg.output.match(/Sí\./g) || []).length, 2);
  }
});

test('a different turn identity cannot overwrite a previous intervention', async () => {
  const bg = await loadBackground();
  const state = { lines: [] };
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Sí.', timestamp: 1000, utteranceId: 'a' });
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Sí.', timestamp: 2000,
    utteranceId: 'b', replaceLastLine: true });
  assert.equal(state.lines.length, 2);
});

test('identity-bearing revisions cannot overwrite legacy lines without provenance', async () => {
  const bg = await loadBackground();
  const state = { lines: [] };
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Idea guardada antes.', timestamp: 1000 });
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Idea nueva.', timestamp: 2000,
    utteranceId: 'fresh-turn', replaceLastLine: true });
  assert.deepEqual(state.lines.map(line => line.text), ['Idea guardada antes.', 'Idea nueva.']);
});

test('legacy revisions cannot inherit provenance that their message does not supply', async () => {
  const bg = await loadBackground();
  const state = { lines: [] };
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Hola.', timestamp: 1000, utteranceId: 'a' });
  bg.appendCaptionLine(state, { speaker: 'Ana', text: 'Hola a todos.', timestamp: 2000, replaceLastLine: true });
  assert.equal(state.lines.length, 1);
  assert.equal(state.lines[0].utteranceId, undefined);
});

test('TXT and Markdown export a cleaned snapshot while retaining raw state and duration', async () => {
  const { cleanTranscriptForExport } = await loadModule('transcript-cleanup.js');
  for (const format of ['txt', 'md']) {
    const lines = [
      { speaker: 'Ana', text: 'Tenemos que revisar la base.', timestamp: 1000, utteranceId: 'a' },
      { speaker: 'Ana', text: 'Tenemos que revisar la base de producción.', timestamp: 2000, utteranceId: 'a' },
      { speaker: 'Ana', text: 'Tenemos que revisar la base de producción mañana.', timestamp: 3000, utteranceId: 'a' },
    ];
    const original = structuredClone(lines);
    const bg = await loadBackground(lines);
    bg.cleanTranscriptForExport = cleanTranscriptForExport;
    await bg.handleMessage({ type: 'DOWNLOAD_TRANSCRIPT', format });
    assert.equal((bg.output.match(/Tenemos que revisar/g) || []).length, 1);
    assert.ok(bg.output.includes('Tenemos que revisar la base de producción mañana.'));
    assert.ok(bg.output.includes('00:00:01'));
    assert.ok(bg.output.includes('Duración') && bg.output.includes('00:00:03'));
    assert.ok(!bg.output.includes('utteranceId'));
    assert.deepEqual(lines, original);
    assert.equal((await bg.ensureState()).lines.length, 3);
  }
});

test('STOP stores captions returned by the content script even after the receiving port closes', async () => {
  const bg = await loadBackground();
  const state = await bg.ensureState();
  Object.assign(state, { isCapturing: true, tabId: 1, capturePhase: 'capturing' });
  bg.chrome.action = { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} };
  bg.chrome.tabs.sendMessage = async (_id, message) => {
    assert.equal(message.type, 'STOP_CAPTURE');
    return { status: 'ok', captions: [{ type: 'CAPTION_LINE', speaker: 'Ana', text: 'Última frase.',
      timestamp: 1000, utteranceId: 'last' }] };
  };
  const response = await bg.handleMessage({ type: 'STOP_CAPTURE' });
  assert.equal(response.lineCount, 1);
  assert.equal(state.lines[0].text, 'Última frase.');
  assert.equal(state.isCapturing, false);
});

test('live download flushes before checking for an empty transcript', async () => {
  const bg = await loadBackground();
  bg.cleanTranscriptForExport = (await loadModule('transcript-cleanup.js')).cleanTranscriptForExport;
  const state = await bg.ensureState();
  Object.assign(state, { isCapturing: true, tabId: 1, capturePhase: 'waiting_for_captions', ccWarning: true });
  bg.chrome.tabs.sendMessage = async (_id, message) => message.type === 'FLUSH_CAPTIONS'
    ? { captions: [{ type: 'CAPTION_LINE', speaker: 'Ana', text: 'Texto pendiente.',
      timestamp: 1000, utteranceId: 'pending' }] } : {};
  const response = await bg.handleMessage({ type: 'DOWNLOAD_TRANSCRIPT' });
  assert.equal(response.status, 'ok');
  assert.ok(bg.output.includes('Texto pendiente.'));
  assert.equal(state.isCapturing, true);
  assert.equal(state.capturePhase, 'capturing');
  assert.equal(state.ccWarning, false);
});

test('a delayed flush reply cannot restore discarded or previous-session text', async () => {
  const bg = await loadBackground();
  bg.cleanTranscriptForExport = (await loadModule('transcript-cleanup.js')).cleanTranscriptForExport;
  const state = await bg.ensureState();
  Object.assign(state, { isCapturing: true, tabId: 1 });
  let reply;
  bg.chrome.tabs.sendMessage = () => new Promise(resolve => { reply = resolve; });
  const download = bg.handleMessage({ type: 'DOWNLOAD_TRANSCRIPT' });
  await Promise.resolve();
  // CLEAR_TRANSCRIPT / START_CAPTURE replace the lines array while the tab
  // response is in flight. Old capture text must never reappear.
  state.lines = [];
  reply({ captions: [{ type: 'CAPTION_LINE', speaker: 'Ana', text: 'Sesión anterior.',
    timestamp: 1000, utteranceId: 'old' }] });
  const response = await download;
  assert.ok(response.error);
  assert.equal(state.lines.length, 0);
  assert.equal(bg.output, undefined);
});

test('flush replies reject malformed captions without altering stored text', async () => {
  const bg = await loadBackground();
  const state = { lines: [] };
  bg.appendFlushedCaptions(state, { captions: [null,
    { type: 'CAPTION_LINE', speaker: 'Ana', text: '', timestamp: 1 },
    { type: 'CAPTION_LINE', speaker: 'Ana', text: 'Texto.', timestamp: NaN },
    { type: 'OTHER', speaker: 'Ana', text: 'Texto.', timestamp: 1 },
  ] }, state.lines);
  assert.equal(state.lines.length, 0);
});
