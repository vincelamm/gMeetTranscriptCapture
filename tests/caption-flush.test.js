const test = require('node:test');
const assert = require('node:assert/strict');
const { loadContentScript } = require('./load-content-script');

test('STOP returns pending captions exactly once before debounce, including without a port', () => {
  for (const connected of [true, false]) {
    const h = loadContentScript();
    if (connected) h.meet.openPort();
    h.meet.processCaptionUpdate(new Map([['Ana', 'Última frase.']]));
    let response;
    h.meet.chrome.runtime.onMessage.listeners[0]({ type: 'STOP_CAPTURE' }, {}, value => { response = value; });
    assert.equal(response.status, 'ok');
    assert.equal(response.captions?.length, 1);
    assert.equal(response.captions[0].text, 'Última frase.');
    assert.ok(response.captions[0].utteranceId);
    h.clock.advance(800);
    assert.equal(h.port.captions().length, 0);
  }
});

test('live flush returns the latest window and capture continues with the same identity', () => {
  const h = loadContentScript();
  h.meet.openPort();
  h.meet.processCaptionUpdate(new Map([['Ana', 'Esto funciona.']]));
  let response;
  h.meet.chrome.runtime.onMessage.listeners[0]({ type: 'FLUSH_CAPTIONS' }, {}, value => { response = value; });
  assert.equal(response?.captions?.length, 1);
  assert.equal(h.port.captions().length, 0);
  h.meet.processCaptionUpdate(new Map([['Ana', 'Esto funciona correctamente.']]));
  h.clock.advance(800);
  assert.equal(h.port.captions()[0].text, 'Esto funciona correctamente.');
  assert.equal(h.port.captions()[0].utteranceId, response.captions[0].utteranceId);
  assert.equal(h.port.captions()[0].replaceLastLine, true);
});
