const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContentScript } = require('./load-content-script');

function capture() {
  const harness = loadContentScript();
  harness.meet.openPort();
  return harness;
}
function observe(h, entries) {
  h.meet.processCaptionUpdate(new Map(entries));
  h.clock.advance(800);
}

test('revisions and rolling continuation retain a speaker turn identity', () => {
  const h = capture();
  observe(h, [['Ana', 'Tenemos que revisar la base.']]);
  observe(h, [['Ana', 'Tenemos que revisar la base de producción.']]);
  observe(h, [['Ana', 'la base de producción mañana.']]);
  const messages = h.port.captions();
  assert.equal(messages.length, 3);
  assert.equal(typeof messages[0].utteranceId, 'string');
  assert.ok(messages[0].utteranceId.length > 0);
  assert.ok(messages.every(m => m.utteranceId === messages[0].utteranceId));
});

test('speaker, unrelated speech, disappearance and expiry create new identities', () => {
  const h = capture();
  observe(h, [['Ana', 'Hola.'], ['Luis', 'Hola.']]);
  observe(h, [['Ana', 'Adiós.'], ['Luis', 'Hola.']]);
  observe(h, []);
  observe(h, [['Ana', 'Adiós.']]);
  h.clock.advance(13000);
  observe(h, [['Ana', 'Adiós a todos.']]);
  const ids = h.port.captions().map(m => m.utteranceId);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0));
  assert.equal(new Set(ids).size, ids.length);
});

test('separate content-script executions cannot reuse utterance identities', () => {
  const first = capture(), second = capture();
  observe(first, [['Ana', 'Sí.']]);
  observe(second, [['Ana', 'Sí.']]);
  const a = first.port.captions()[0].utteranceId;
  const b = second.port.captions()[0].utteranceId;
  assert.ok(a && b);
  assert.notEqual(a, b);
});

test('a fresh capture in the same page never reuses the previous identity', () => {
  const h = capture();
  observe(h, [['Ana', 'Sí.']]);
  const first = h.port.captions()[0].utteranceId;
  h.meet.detectStrategy = () => ({ container: {}, strategy: {
    name: 'fixture', findContainer: () => ({}), extractSpeakers: () => new Map(),
  } });
  h.meet.scheduleMeetingInfoScrape = () => {};
  const listener = h.meet.chrome.runtime.onMessage.listeners[0];
  listener({ type: 'START_CAPTURE' }, {}, () => {});
  observe(h, [['Ana', 'Sí.']]);
  assert.notEqual(h.port.captions().at(-1).utteranceId, first);
});
