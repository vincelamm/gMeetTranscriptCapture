/**
 * Loads the real content.js into a sandbox so tests exercise the shipped file
 * rather than a copy of its logic.
 *
 * content.js is a Chrome content script, not a module: it has no exports and
 * registers a chrome.runtime listener at load time. Running it in a vm context
 * with stubbed browser globals puts its top-level `function` declarations onto
 * that context, which is what the tests then call.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const CONTENT_SCRIPT = path.join(__dirname, '..', 'content.js');

/** Minimal stubs — just enough for the file to evaluate without a browser. */
function browserStubs() {
  const noop = () => {};
  const emptyList = [];

  const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => emptyList,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    get body() { return null; },
    get activeElement() { return null; },
  };

  return {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON,
    Map,
    Set,
    RegExp,
    Promise,
    document: documentStub,
    window: { addEventListener: noop, removeEventListener: noop },
    // Element.ELEMENT_NODE — extractByPosition filters on it.
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    KeyboardEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
    chrome: {
      runtime: {
        onMessage: { addListener: noop },
        sendMessage: () => Promise.resolve({}),
        connect: () => ({
          onMessage: { addListener: noop },
          onDisconnect: { addListener: noop },
          postMessage: noop,
          disconnect: noop,
        }),
      },
    },
  };
}

function loadContentScript() {
  const source = fs.readFileSync(CONTENT_SCRIPT, 'utf8');
  const context = vm.createContext(browserStubs());
  vm.runInContext(source, context, { filename: 'content.js' });
  return context;
}

module.exports = { loadContentScript };
