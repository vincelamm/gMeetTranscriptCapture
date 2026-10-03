const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadBackground({ tab = null, unreachable = false, apiError = false } = {}) {
  let listener;
  let stored = {};
  const noop = () => {};
  const context = vm.createContext({
    console: { error: noop },
    setTimeout: () => 1, clearTimeout: noop,
    chrome: {
      storage: { session: {
        get: async () => stored,
        set: async (value) => { stored = structuredClone(value); },
      } },
      runtime: {
        onConnect: { addListener: noop },
        onMessage: { addListener: (fn) => { listener = fn; } },
      },
      action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
      tabs: {
        query: async () => tab ? [tab] : [],
        get: async () => ({ title: 'Prueba - Google Meet' }),
        sendMessage: async () => {
          if (unreachable) throw new Error('Receiving end does not exist');
          return { status: 'ok' };
        },
        onRemoved: { addListener: noop }, onUpdated: { addListener: noop },
      },
    },
  });
  // Module imports are omitted; these error paths do not format or clean output.
  const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8')
    .replace(/^import .* from .*;\r?\n/gm, '');
  vm.runInContext(source, context, { filename: 'background.js' });
  if (apiError) {
    // Exercise the response catch path through a rejected Chrome API call.
    context.chrome.tabs.query = async () => { throw new Error('Internal API failure'); };
  }
  return (msg) => new Promise(resolve => listener(msg, {}, resolve));
}

test('start without a Meet tab returns a Spanish error', async () => {
  const response = await loadBackground()({ type: 'START_CAPTURE' });
  assert.equal(response.error, 'No se encontró una pestaña activa de Google Meet.');
});

test('unreachable Meet returns a stable code and a Spanish reload instruction', async () => {
  const response = await loadBackground({
    tab: { id: 1, url: 'https://meet.google.com/' }, unreachable: true,
  })({ type: 'START_CAPTURE' });
  assert.equal(response.errorCode, 'MEET_TAB_UNREACHABLE');
  assert.equal(response.error, 'No se pudo conectar con la pestaña de Meet. Recárgala e inténtalo de nuevo.');
});

test('empty transcript errors are Spanish for both export paths', async () => {
  const send = loadBackground();
  for (const type of ['GET_TRANSCRIPT_CONTENT', 'DOWNLOAD_TRANSCRIPT']) {
    assert.equal((await send({ type })).error, 'Todavía no hay intervenciones capturadas.');
  }
});

test('unexpected API errors return a Spanish message without exposing internals', async () => {
  const response = await loadBackground({ apiError: true })({ type: 'START_CAPTURE' });
  assert.equal(response.error, 'No se pudo completar la operación. Inténtalo de nuevo.');
});
