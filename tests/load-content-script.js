/**
 * Loads the real content.js into a sandbox so tests exercise the shipped file
 * rather than a copy of its logic.
 *
 * content.js is a Chrome content script, not a module: it has no exports and
 * registers a chrome.runtime listener at load time. Running it in a vm context
 * with stubbed browser globals puts its top-level `function` declarations onto
 * that context, which is what the tests then call. Module-level `const`/`let`
 * (speakerBuffers, bgPort, suppressUntil, …) stay private — tests drive them
 * through the exported functions, which is the honest way round anyway.
 *
 * The sandbox also hands tests a controllable clock and a recording port, so
 * the debounce/dedup state machine can be driven deterministically instead of
 * waiting 800 ms per step.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The same files, in the same order, as manifest.json content_scripts.js —
// classic content scripts share one global scope, and the sandbox reproduces
// that by evaluating them into one vm context.
const CONTENT_SCRIPTS = [
  path.join(__dirname, '..', 'utils', 'caption-core.js'),
  path.join(__dirname, '..', 'content.js'),
];

/**
 * Controllable time: `now` drives Date.now(), and scheduled callbacks only run
 * when a test advances the clock. Without this the 800 ms debounce and the
 * 12 s utterance expiry would make the dedup tests slow and flaky.
 */
function createClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  let seq = 0;
  const timers = new Map(); // id -> { at, fn }

  return {
    get now() { return now; },

    setTimeout(fn, delay = 0) {
      const id = ++seq;
      timers.set(id, { at: now + delay, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    // Intervals are only used by the health check, which these tests do not
    // drive; registering them as no-ops keeps content.js from throwing.
    setInterval() { return ++seq; },
    clearInterval(id) { timers.delete(id); },

    /** Advance time, running every callback whose deadline has passed. */
    advance(ms) {
      const target = now + ms;
      let guard = 0;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        if (++guard > 10_000) throw new Error('clock.advance: timer loop did not settle');
        const [id, timer] = due[0];
        timers.delete(id);
        now = timer.at;
        timer.fn();
      }
      now = target;
    },

    get pending() { return timers.size; },
  };
}

/** A chrome.runtime port that records everything content.js sends. */
function createRecordingPort() {
  const messages = [];
  return {
    messages,
    captions: () => messages.filter((m) => m.type === 'CAPTION_LINE'),
    onMessage: { addListener() {} },
    onDisconnect: { addListener() {} },
    postMessage(msg) { messages.push(msg); },
    disconnect() {},
  };
}

function browserStubs(clock, port) {
  const noop = () => {};
  const emptyList = [];

  const documentStub = {
    querySelector: () => null,
    querySelectorAll: () => emptyList,
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    body: null,
    activeElement: null,
  };

  // Real Date, but Date.now() follows the test clock.
  const DateStub = new Proxy(Date, {
    get: (target, prop) =>
      prop === 'now' ? () => clock.now : Reflect.get(target, prop),
  });

  return {
    console,
    JSON, Math, Map, Set, RegExp, Promise, Object, Array, String, Number, Error,
    Date: DateStub,
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
    setInterval: (fn, ms) => clock.setInterval(fn, ms),
    clearInterval: (id) => clock.clearInterval(id),
    document: documentStub,
    window: { addEventListener: noop, removeEventListener: noop },
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    MutationObserver: class { observe() {} disconnect() {} },
    KeyboardEvent: class { constructor(type, init) { Object.assign(this, { type }, init); } },
    chrome: {
      runtime: {
        onMessage: { addListener: noop },
        sendMessage: () => Promise.resolve({}),
        connect: () => port,
      },
    },
  };
}

/**
 * @returns {{ meet: object, clock: object, port: object }}
 *   meet  — the vm context carrying content.js's top-level functions
 *   clock — advance(ms) to fire debounce timers; `now` drives Date.now()
 *   port  — captions() returns the CAPTION_LINE messages sent so far
 */
function loadContentScript() {
  const clock = createClock();
  const port = createRecordingPort();
  const meet = vm.createContext(browserStubs(clock, port));
  // `module` stays undefined here, so caption-core.js skips its CommonJS
  // export block exactly as it does in the browser.
  for (const file of CONTENT_SCRIPTS) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), meet, { filename: path.basename(file) });
  }
  return { meet, clock, port };
}

module.exports = { loadContentScript };
