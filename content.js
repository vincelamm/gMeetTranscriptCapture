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
  // Pick the aria-live="polite" element most likely to be the CC widget.
  // Caption containers always have child elements (speaker blocks),
  // unlike status announcements ("Your camera is on") which are flat text.
  const candidates = [...document.querySelectorAll('[aria-live="polite"]')]
    .filter(el => {
      const text = el.textContent.trim();
      if (text.length === 0) return false;
      // Must have child elements — flat text nodes are status announcements
      if (el.children.length === 0) return false;
      // Exclude short status announcements (camera/mic on/off etc.)
      // Caption containers typically grow beyond a short sentence quickly
      if (text.length < 80 && el.children.length < 2) return false;
      return true;
    });
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

    const speakers = strategy.extractSpeakers(container);
    if (speakers.size > 0) {
      LOG(`Strategy "${strategy.name}" extracted ${speakers.size} speaker(s):`, [...speakers.keys()]);
      return { strategy, container };
    }

    // For jsname strategies (A/B), the container itself is a strong signal —
    // accept it even if empty (captions may appear momentarily).
    // For fallback strategies, require actual speaker data to avoid false positives.
    if (strategy.name.startsWith('jsname')) {
      LOG(`Strategy "${strategy.name}" — container found but empty, accepting (jsname match)`);
      return { strategy, container };
    }

    LOG(`Strategy "${strategy.name}" — container found but no speakers extracted, skipping`);
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
// Auto-enable CC (Closed Captions)
// ---------------------------------------------------------------------------

/**
 * Attempts to find and click the CC button in Google Meet.
 * Returns true if the button was found and clicked.
 */
function tryEnableCC() {
  const ccButton = findCCButton();
  if (ccButton) {
    // Check if CC is already ON — Meet toggles aria-pressed or adds an "on" visual state
    const isAlreadyOn = ccButton.getAttribute('aria-pressed') === 'true';
    if (isAlreadyOn) {
      LOG('CC button found — captions already enabled');
      return 'already_on';
    }
    ccButton.click();
    LOG('CC button found and clicked — captions enabled');
    return 'clicked';
  }

  LOG('CC button not found in DOM — user must enable manually');
  logCCDiagnostics();
  return 'not_found';
}

/**
 * Finds the CC/captions toggle button in Google Meet.
 *
 * Meet uses custom components (not always native <button>), so we search
 * both <button> and [role="button"] elements. We also check aria-label,
 * data-tooltip, and jsname attributes across multiple languages.
 */
function findCCButton() {
  // Keywords that appear in CC button labels across locales
  const CC_KEYWORDS = [
    'caption', 'captions', 'closed caption',
    'subtitle', 'subtitles',
    'untertitel',           // DE
    'sous-titre',           // FR
    'sottotitoli',          // IT
    'subtítulos',           // ES
    'legendas',             // PT
    'ondertiteling',        // NL
    'napisy',               // PL
    'субтитр',              // RU
    '字幕',                  // JA / ZH
    '자막',                  // KO
  ];

  const keywordPattern = new RegExp(CC_KEYWORDS.join('|'), 'i');

  // Selectors covering native buttons AND Meet's custom role="button" elements
  const clickableSelector = 'button, [role="button"]';

  // Pass 1: check aria-label and data-tooltip for known keywords
  for (const el of document.querySelectorAll(clickableSelector)) {
    const ariaLabel = el.getAttribute('aria-label') || '';
    const tooltip = el.getAttribute('data-tooltip') || '';
    if (keywordPattern.test(ariaLabel) || keywordPattern.test(tooltip)) {
      LOG('findCCButton: matched via keyword in aria-label/tooltip:', ariaLabel || tooltip);
      return el;
    }
  }

  // Pass 2: language-independent — Meet includes the keyboard shortcut "(c)"
  // in the CC button label across virtually all locales
  for (const el of document.querySelectorAll(clickableSelector)) {
    const ariaLabel = el.getAttribute('aria-label') || '';
    const tooltip = el.getAttribute('data-tooltip') || '';
    const combined = ariaLabel + ' ' + tooltip;
    if (/\(c\)/.test(combined)) {
      LOG('findCCButton: matched via shortcut hint "(c)":', combined.trim());
      return el;
    }
  }

  // Pass 3: check jsname — Meet's CC button has been seen with these values
  const CC_JSNAMES = ['r8qRAd', 'Dg9Wp'];
  for (const jsname of CC_JSNAMES) {
    const el = document.querySelector(`[jsname="${jsname}"]`);
    if (el) {
      LOG('findCCButton: matched via jsname:', jsname);
      return el.closest(clickableSelector) || el;
    }
  }

  // Pass 4: toolbar scan with keywords
  const toolbars = document.querySelectorAll('[role="toolbar"], [jsname="EaZ7Cc"]');
  for (const toolbar of toolbars) {
    for (const el of toolbar.querySelectorAll(clickableSelector)) {
      const text = (el.getAttribute('aria-label') || '') + ' ' +
                   (el.getAttribute('data-tooltip') || '') + ' ' +
                   el.textContent;
      if (keywordPattern.test(text) || /\(c\)/.test(text)) {
        LOG('findCCButton: matched via toolbar scan:', text.trim().slice(0, 60));
        return el;
      }
    }
  }

  return null;
}

function logCCDiagnostics() {
  const clickables = document.querySelectorAll('button, [role="button"]');
  const labels = [...clickables]
    .map(el => ({
      tag: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      tooltip: el.getAttribute('data-tooltip'),
      jsname: el.getAttribute('jsname'),
    }))
    .filter(x => x.ariaLabel || x.tooltip);
  LOG('CC diagnostics — clickable elements with labels:', JSON.stringify(labels, null, 2));
}

// ---------------------------------------------------------------------------
// Polling (waits for CC widget to appear in DOM)
// ---------------------------------------------------------------------------
let ccAttempts = 0;
let ccAutoEnableTried = false;

function startScan() {
  stopScan();
  ccAttempts = 0;
  ccAutoEnableTried = false;
  LOG('Polling for caption container every 2s…');
  scanInterval = setInterval(() => {
    const match = detectStrategy();
    if (match) {
      stopScan();
      activeStrategy = match.strategy;
      startObserver(match.strategy, match.container);
      chrome.runtime.sendMessage({ type: 'CC_STATUS', status: 'found' }).catch(() => {});
    } else {
      ccAttempts++;
      // Retry auto-enable after 2 polls (~4s) — the toolbar may not have
      // been in the DOM when we first tried (e.g. user just joined)
      if (ccAttempts === 2 && !ccAutoEnableTried) {
        ccAutoEnableTried = true;
        const result = tryEnableCC();
        LOG('Retry auto-enable CC result:', result);
      }
      // After 3 polls (~6s), warn the user
      if (ccAttempts === 3) {
        chrome.runtime.sendMessage({ type: 'CC_STATUS', status: 'not_found' }).catch(() => {});
      }
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
      // Captions not found — try to auto-enable CC
      const ccResult = tryEnableCC();
      LOG('Auto-enable CC result:', ccResult);
      startScan();
      sendResponse({ status: 'waiting_for_captions', ccAction: ccResult });
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
