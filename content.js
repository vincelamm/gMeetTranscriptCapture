/**
 * content.js — Google Meet Caption Observer
 *
 * DEBUGGING: Open DevTools on the Meet tab, filter console by "[MeetTranscript]".
 * After enabling CC in Meet and clicking Start Capture, the logs will show
 * which strategy matched and what DOM structure was found.
 *
 * If captions stop working after a Meet update: enable CC, inspect the
 * caption element in DevTools Elements panel, and update STRATEGIES below.
 */

const LOG = (...args) => console.log('[MeetTranscript]', ...args);

// ---------------------------------------------------------------------------
// Selector strategies — tried in order until one works
// ---------------------------------------------------------------------------
const STRATEGIES = [
  // Strategy A: jsname attributes (primary — more stable than class names)
  {
    name: 'jsname-A',
    findContainer: () => document.querySelector('[jsname="tgaKEf"]'),
    extractSpeakers: (container) => extractByJsname(container, '[jsname="YSxPC"]', '[jsname="r4nke"]', '[jsname="bVV8Bd"]'),
  },
  // Strategy B: alternative jsname set seen in some Meet versions
  {
    name: 'jsname-B',
    findContainer: () => document.querySelector('[jsname="DS9Ooe"]'),
    extractSpeakers: (container) => extractByJsname(container, '[jsname="YSxPC"]', '[jsname="r4nke"]', '[jsname="bVV8Bd"]'),
  },
  // Strategy C: aria-live region — positional extraction (first child = name, rest = text)
  {
    name: 'aria-live-positional',
    findContainer: () => findAriaLiveContainer(),
    extractSpeakers: (container) => extractByPosition(container),
  },
  // Strategy D: role="region" with captions label
  {
    name: 'role-region',
    findContainer: () => document.querySelector(
      '[role="region"][aria-label*="caption" i], ' +
      '[role="region"][aria-label*="subtitle" i]'
    ),
    extractSpeakers: (container) => extractByPosition(container),
  },
  // Strategy E: text-only fallback — no speaker attribution, just deduplicated text
  {
    name: 'text-only',
    findContainer: () => findAriaLiveContainer(),
    extractSpeakers: (container) => extractTextOnly(container),
  },
];

// ---------------------------------------------------------------------------
// Extraction methods
// ---------------------------------------------------------------------------

/** Primary: use known jsname attributes to find speaker blocks. */
function extractByJsname(container, blockSel, nameSel, textSel) {
  const result = new Map();
  for (const block of container.querySelectorAll(blockSel)) {
    const nameEl = block.querySelector(nameSel);
    const textEl = block.querySelector(textSel);
    if (!nameEl || !textEl) continue;
    const speaker = nameEl.textContent.trim();
    const text = textEl.textContent.trim();
    if (speaker && text) result.set(speaker, text);
  }
  return result;
}

/**
 * Positional fallback: each direct child of the container = one utterance block.
 * Within each block, the FIRST text-bearing child = speaker name,
 * subsequent children = caption text.
 *
 * This matches Meet's layout where the speaker label always appears before
 * the caption text within its block.
 */
function extractByPosition(container) {
  const result = new Map();

  for (const block of container.children) {
    if (block.nodeType !== Node.ELEMENT_NODE) continue;

    const textKids = [...block.children].filter(
      el => el.textContent.trim().length > 0
    );

    if (textKids.length < 2) continue;

    const speaker = textKids[0].textContent.trim();
    const text = textKids.slice(1).map(el => el.textContent.trim()).join(' ').trim();

    // Speaker name heuristic: short, no mid-sentence punctuation, shorter than text
    if (
      speaker.length > 0 &&
      speaker.length <= 60 &&
      text.length > 0 &&
      speaker.length < text.length &&
      !isSentenceFragment(speaker)
    ) {
      result.set(speaker, text);
    }
  }

  LOG('extractByPosition found:', result.size, 'speakers');
  if (result.size === 0) {
    logContainerStructure(container);
  }
  return result;
}

/**
 * Text-only fallback: no speaker attribution.
 * Captures all text in the container as a single rolling string.
 * A new "utterance" is detected when the text resets rather than grows.
 */
function extractTextOnly(container) {
  const text = container.textContent.trim();
  if (!text) return new Map();
  return new Map([['(speaker)', text]]);
}

/** Returns true if a string looks like a sentence fragment rather than a name. */
function isSentenceFragment(str) {
  // Contains common sentence-internal punctuation or lowercase connector words
  if (/[,;]/.test(str)) return true;
  // More than 4 words is probably not a name
  if (str.split(/\s+/).length > 4) return true;
  // Starts with lowercase (names are usually capitalized)
  if (/^[a-zäöüß]/.test(str)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Caption container discovery helpers
// ---------------------------------------------------------------------------
function findAriaLiveContainer() {
  // Pick the aria-live="polite" element with the most text (most likely to be CC)
  const candidates = [...document.querySelectorAll('[aria-live="polite"]')]
    .filter(el => el.textContent.trim().length > 0);
  if (!candidates.length) return null;
  return candidates.sort((a, b) => b.textContent.length - a.textContent.length)[0];
}

// ---------------------------------------------------------------------------
// Strategy detection
// ---------------------------------------------------------------------------
function detectStrategy() {
  for (const strategy of STRATEGIES) {
    const container = strategy.findContainer();
    if (!container) continue;

    LOG(`Strategy "${strategy.name}" found container`);
    logContainerStructure(container);

    // Verify extraction works (or at least the container is non-empty)
    const speakers = strategy.extractSpeakers(container);
    if (speakers.size > 0) {
      LOG(`Strategy "${strategy.name}" extracted ${speakers.size} speaker(s):`, [...speakers.keys()]);
    }
    // Return even if empty — we found a container; we'll observe it
    return { strategy, container };
  }

  LOG('No strategy matched. Is CC (captions) enabled in Meet?');
  logDiagnostics();
  return null;
}

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------
function logContainerStructure(container) {
  LOG('Container tag/jsname:', container.tagName, container.getAttribute('jsname'));
  LOG('Container children count:', container.children.length);
  LOG('Container text (first 200 chars):', container.textContent.trim().slice(0, 200));
  for (let i = 0; i < Math.min(container.children.length, 4); i++) {
    const child = container.children[i];
    LOG(`  child[${i}] tag=${child.tagName} jsname=${child.getAttribute('jsname')} children=${child.children.length} text="${child.textContent.trim().slice(0, 80)}"`);
    for (let j = 0; j < Math.min(child.children.length, 3); j++) {
      const gc = child.children[j];
      LOG(`    grandchild[${j}] tag=${gc.tagName} jsname=${gc.getAttribute('jsname')} text="${gc.textContent.trim().slice(0, 60)}"`);
    }
  }
}

function logDiagnostics() {
  LOG('--- DOM DIAGNOSTICS ---');
  LOG('aria-live elements:', [...document.querySelectorAll('[aria-live]')].map(el => ({
    tag: el.tagName, ariaLive: el.getAttribute('aria-live'),
    jsname: el.getAttribute('jsname'), text: el.textContent.trim().slice(0, 80),
  })));
  const unique = [...new Set([...document.querySelectorAll('[jsname]')].map(el => el.getAttribute('jsname')))];
  LOG('All jsname values in DOM:', unique);
}

// ---------------------------------------------------------------------------
// Port to background (keeps the MV3 service worker alive during capture)
// ---------------------------------------------------------------------------
let bgPort = null;

function openPort() {
  if (bgPort) return;
  bgPort = chrome.runtime.connect({ name: 'content-script' });
  bgPort.onDisconnect.addListener(() => {
    bgPort = null;
    if (isCapturing) {
      // SW was terminated — reconnect to wake it and resume delivery
      setTimeout(openPort, 200);
    }
  });
  LOG('Port to background opened');
}

function closePort() {
  if (bgPort) { bgPort.disconnect(); bgPort = null; }
  LOG('Port to background closed');
}

function sendCaption(speaker, text, timestamp, replaceLastLine = false) {
  if (bgPort) {
    bgPort.postMessage({ type: 'CAPTION_LINE', speaker, text, timestamp, replaceLastLine });
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let isCapturing = false;
let observer = null;
let scanInterval = null;
let activeStrategy = null;

/// Map<speakerKey, { pendingText: string, timer: TimeoutID }>
const speakerBuffers = new Map();
// Track last committed text per speaker (for deduplication)
const lastCommitted = new Map();
// First UTTERANCE_OVERLAP_CHARS of the current line per speaker —
// used to detect same-utterance revisions vs genuinely new speech
const utteranceStarts = new Map();
// Timestamp of each speaker's last commit (to expire stale utterance context)
const utteranceTimes = new Map();
// Char offset into the full DOM text where the current line started.
// Meet accumulates all speech in one growing element; this lets us strip
// already-committed text when a new line boundary is detected.
const lineStartLen = new Map();

const DEBOUNCE_MS = 800;
// How many leading characters must match to consider it the same utterance
const UTTERANCE_OVERLAP_CHARS = 25;
// After this much silence, always start a new line even if text looks similar
const UTTERANCE_EXPIRY_MS = 12000;

// ---------------------------------------------------------------------------
// Debounce / deduplication
// ---------------------------------------------------------------------------
function processCaptionUpdate(currentSpeakers) {
  for (const [speaker, text] of currentSpeakers) {
    const buf = speakerBuffers.get(speaker);

    // Ignore if text hasn't changed
    if (buf && buf.pendingText === text) continue;

    // If new text STARTS WITH the pending text, it's just growing — update buffer,
    // reset debounce, don't commit yet.
    if (buf) clearTimeout(buf.timer);

    const timer = setTimeout(() => commitLine(speaker), DEBOUNCE_MS);
    speakerBuffers.set(speaker, { pendingText: text, timer });
  }

  // Commit speakers who have left the DOM
  for (const [speaker, buf] of speakerBuffers) {
    if (!currentSpeakers.has(speaker)) {
      clearTimeout(buf.timer);
      commitLine(speaker);
    }
  }
}

function commitLine(speaker) {
  const buf = speakerBuffers.get(speaker);
  if (!buf) return;

  const text = buf.pendingText;
  speakerBuffers.delete(speaker);

  // Skip if identical to last committed
  if (lastCommitted.get(speaker) === text) return;

  const now = Date.now();
  const prevStart = utteranceStarts.get(speaker) || '';
  const lastCommitTime = utteranceTimes.get(speaker) || 0;
  const expired = (now - lastCommitTime) > UTTERANCE_EXPIRY_MS;

  // Same utterance = leading characters overlap AND last commit was recent.
  // Google Meet revises earlier words as speech continues, so the beginning
  // of the sentence stays the same even when the end changes — we use that
  // as the signal instead of checking startsWith.
  const overlapLen = Math.min(UTTERANCE_OVERLAP_CHARS, prevStart.length, text.length);
  const leadingMatch = overlapLen > 5 && prevStart.slice(0, overlapLen) === text.slice(0, overlapLen);
  const isSameUtterance = leadingMatch && !expired;

  if (!isSameUtterance) {
    // New utterance — record start and advance line offset past already-committed text
    utteranceStarts.set(speaker, text.slice(0, UTTERANCE_OVERLAP_CHARS));
    const prevFull = lastCommitted.get(speaker) || '';
    lineStartLen.set(speaker, prevFull.length);
  }

  lastCommitted.set(speaker, text);
  utteranceTimes.set(speaker, now);

  // Strip text already committed in previous lines (handles Meet accumulating
  // the entire session in one growing DOM element)
  const startLen = lineStartLen.get(speaker) || 0;
  const textToSend = (startLen > 0 && text.length > startLen)
    ? text.slice(startLen).trim()
    : text.trim();

  if (!textToSend) return;

  LOG(`COMMIT [${speaker}] (${isSameUtterance ? 'replace' : 'new'}): ${textToSend.slice(0, 80)}`);
  sendCaption(speaker === '(speaker)' ? '' : speaker, textToSend, now, isSameUtterance);
}

// ---------------------------------------------------------------------------
// MutationObserver
// ---------------------------------------------------------------------------
function startObserver(strategy, container) {
  if (observer) observer.disconnect();

  observer = new MutationObserver(() => {
    // Re-acquire the container in case Meet re-rendered it
    const liveContainer = strategy.findContainer() || container;
    const current = strategy.extractSpeakers(liveContainer);
    if (current.size > 0) processCaptionUpdate(current);
  });

  observer.observe(container, { childList: true, subtree: true, characterData: true });
  LOG('Observer attached to container');
}

function stopObserver() {
  if (observer) { observer.disconnect(); observer = null; }
  // Flush remaining buffers
  for (const [speaker, buf] of speakerBuffers) {
    clearTimeout(buf.timer);
    commitLine(speaker);
  }
}

// ---------------------------------------------------------------------------
// Polling (waits for CC widget to appear in DOM)
// ---------------------------------------------------------------------------
function startScan() {
  stopScan();
  LOG('Polling for caption container every 2s…');
  scanInterval = setInterval(() => {
    const match = detectStrategy();
    if (match) {
      stopScan();
      activeStrategy = match.strategy;
      startObserver(match.strategy, match.container);
    }
  }, 2000);
}

function stopScan() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    isCapturing = true;
    speakerBuffers.clear();
    lastCommitted.clear();
    utteranceStarts.clear();
    utteranceTimes.clear();
    lineStartLen.clear();
    activeStrategy = null;
    openPort();

    LOG('Start capture requested');
    const match = detectStrategy();

    if (match) {
      activeStrategy = match.strategy;
      startObserver(match.strategy, match.container);
      sendResponse({ status: 'ok' });
    } else {
      startScan();
      sendResponse({ status: 'waiting_for_captions' });
    }
  }

  if (msg.type === 'STOP_CAPTURE') {
    isCapturing = false;
    stopObserver();
    stopScan();
    closePort();
    LOG('Capture stopped');
    sendResponse({ status: 'ok' });
  }

  if (msg.type === 'PING') {
    sendResponse({ status: 'ready' });
  }

  return true;
});
