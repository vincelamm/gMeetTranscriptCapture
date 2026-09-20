/**
 * popup.js — Popup UI controller
 *
 * Reads initial state from background on open, then subscribes to a long-lived
 * Port for live updates (line count). Dispatches START/STOP/DOWNLOAD messages
 * to the background service worker.
 */

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const views = {
  noMeet:    document.getElementById('view-no-meet'),
  reload:    document.getElementById('view-reload'),
  idle:      document.getElementById('view-idle'),
  capturing: document.getElementById('view-capturing'),
  waiting:   document.getElementById('view-waiting'),
};

const btnStart        = document.getElementById('btn-start');
const btnStop         = document.getElementById('btn-stop');
const btnCancelWait   = document.getElementById('btn-cancel-wait');
const btnDownloadTxt      = document.getElementById('btn-download-txt');
const btnDownloadMd       = document.getElementById('btn-download-md');
const btnDownloadLiveTxt  = document.getElementById('btn-download-live-txt');
const btnDownloadLiveMd   = document.getElementById('btn-download-live-md');
const btnCopyPrompt       = document.getElementById('btn-copy-prompt');
const btnCopyPromptLive   = document.getElementById('btn-copy-prompt-live');
const btnClear            = document.getElementById('btn-clear');

const capturingCount  = document.getElementById('capturing-line-count');
const idleCount       = document.getElementById('idle-line-count');
const elapsedEl       = document.getElementById('elapsed');
const prevTranscript  = document.getElementById('prev-transcript');
const waitingMessage  = document.getElementById('waiting-message');
const ccWarning       = document.getElementById('cc-warning');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let elapsedTimer = null;
let captureStartTime = null;
let port = null;

// ---------------------------------------------------------------------------
// View management
// ---------------------------------------------------------------------------
function showView(name) {
  for (const [key, el] of Object.entries(views)) {
    el.classList.toggle('hidden', key !== name);
  }
}

/** German line-count label with correct singular/plural. */
function lineCountText(count) {
  const n = count || 0;
  return n === 1 ? '1 Zeile erfasst' : `${n} Zeilen erfasst`;
}

function renderIdle(state) {
  showView('idle');
  if (state.lineCount > 0) {
    prevTranscript.classList.remove('hidden');
    idleCount.textContent = lineCountText(state.lineCount);
  } else {
    prevTranscript.classList.add('hidden');
  }
}

function renderCapturing(state) {
  showView('capturing');
  updateLineCount(state.lineCount);
  captureStartTime = state.startTime;
  startElapsedTimer();
}

// ---------------------------------------------------------------------------
// Elapsed timer
// ---------------------------------------------------------------------------
function startElapsedTimer() {
  stopElapsedTimer();
  updateElapsed();
  elapsedTimer = setInterval(updateElapsed, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function updateElapsed() {
  if (!captureStartTime) return;
  const ms = Date.now() - captureStartTime;
  elapsedEl.textContent = formatDuration(ms);
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

function updateLineCount(count) {
  capturingCount.textContent = lineCountText(count);
}

// ---------------------------------------------------------------------------
// Background communication
// ---------------------------------------------------------------------------
async function sendMessage(msg) {
  // The service worker may be mid-restart; never let a rejected/undefined
  // response crash the popup — callers get a safe empty object instead.
  try {
    return (await chrome.runtime.sendMessage(msg)) ?? {};
  } catch {
    return {};
  }
}

function connectPort() {
  port = chrome.runtime.connect({ name: 'popup' });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'LINE_ADDED') {
      updateLineCount(msg.lineCount);
    }
    if (msg.type === 'CAPTURE_STOPPED') {
      stopElapsedTimer();
      // Refresh state from background
      initialize();
    }
    if (msg.type === 'CC_STATUS' && msg.status === 'not_found') {
      // Captions still not detected after several attempts — show manual instructions
      if (waitingMessage) waitingMessage.textContent = 'Untertitel noch nicht erkannt.';
      if (ccWarning) ccWarning.classList.remove('hidden');
    }
    if (msg.type === 'CC_FOUND') {
      // Captions detected — switch to capturing view
      initialize();
    }
  });
  port.onDisconnect.addListener(() => { port = null; });
}

// ---------------------------------------------------------------------------
// Check if active tab is a Meet tab
// ---------------------------------------------------------------------------
async function isOnMeetTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      resolve(tab && tab.url && tab.url.startsWith('https://meet.google.com/'));
    });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
async function initialize() {
  const onMeet = await isOnMeetTab();
  if (!onMeet) {
    showView('noMeet');
    stopElapsedTimer();
    return;
  }

  const state = await sendMessage({ type: 'GET_STATE' });

  // Fall back to a clean idle view if the background couldn't answer
  // (error response or service worker restarting).
  if (state && !state.error && state.isCapturing) {
    renderCapturing(state);
  } else {
    renderIdle(state && !state.error ? state : { lineCount: 0 });
  }
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------
btnStart.addEventListener('click', async () => {
  const response = await sendMessage({ type: 'START_CAPTURE' });
  if (response?.status === 'waiting_for_captions') {
    showView('waiting');
    // Reset waiting state
    if (ccWarning) ccWarning.classList.add('hidden');
    if (waitingMessage) {
      if (response.ccAction === 'clicked') {
        waitingMessage.textContent = 'Untertitel aktiviert! Warte auf Text…';
      } else if (response.ccAction === 'already_on') {
        waitingMessage.textContent = 'Untertitel scheinen aktiv zu sein. Warte auf Text…';
      } else {
        waitingMessage.textContent = 'Warte auf Untertitel…';
      }
    }
  } else if (response?.status === 'ok') {
    const state = await sendMessage({ type: 'GET_STATE' });
    renderCapturing(state);
  } else if (response?.error?.includes('Could not reach')) {
    showView('reload');
  } else {
    alert(response?.error || 'Aufnahme konnte nicht gestartet werden.');
  }
});

btnStop.addEventListener('click', async () => {
  stopElapsedTimer();
  await sendMessage({ type: 'STOP_CAPTURE' });
  const state = await sendMessage({ type: 'GET_STATE' });
  renderIdle(state);
});

btnCancelWait.addEventListener('click', async () => {
  await sendMessage({ type: 'STOP_CAPTURE' });
  const state = await sendMessage({ type: 'GET_STATE' });
  renderIdle(state);
});

btnDownloadTxt.addEventListener('click',     () => sendMessage({ type: 'DOWNLOAD_TRANSCRIPT', format: 'txt' }));
btnDownloadMd.addEventListener('click',      () => sendMessage({ type: 'DOWNLOAD_TRANSCRIPT', format: 'md' }));
btnDownloadLiveTxt.addEventListener('click', () => sendMessage({ type: 'DOWNLOAD_TRANSCRIPT', format: 'txt' }));
btnDownloadLiveMd.addEventListener('click',  () => sendMessage({ type: 'DOWNLOAD_TRANSCRIPT', format: 'md' }));

async function copyAIPrompt(btn) {
  const response = await sendMessage({ type: 'GET_TRANSCRIPT_CONTENT' });
  if (response?.error) { alert(response.error); return; }
  try {
    await navigator.clipboard.writeText(response.content);
    btn.textContent = 'Kopiert!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'KI-Prompt kopieren';
      btn.classList.remove('copied');
    }, 2000);
  } catch {
    alert('Konnte nicht in die Zwischenablage kopieren.');
  }
}

btnCopyPrompt.addEventListener('click',     () => copyAIPrompt(btnCopyPrompt));
btnCopyPromptLive.addEventListener('click', () => copyAIPrompt(btnCopyPromptLive));

document.getElementById('btn-reload-tab').addEventListener('click', () => {
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (tab) chrome.tabs.reload(tab.id);
    window.close();
  });
});

btnClear.addEventListener('click', async () => {
  await sendMessage({ type: 'CLEAR_TRANSCRIPT' });
  const state = await sendMessage({ type: 'GET_STATE' });
  renderIdle(state);
});

// ---------------------------------------------------------------------------
// Update check
// ---------------------------------------------------------------------------
const REPO = 'vincelamm/gMeetTranscriptCapture';
// Accepts "1.2.3" or "v1.2.3" — anything else is treated as untrusted/invalid.
const VERSION_TAG_RE = /^v?\d+\.\d+\.\d+$/;

function isNewerVersion(latest, current) {
  const parse = v => v.split('.').map(Number);
  const [lMaj, lMin, lPat] = parse(latest);
  const [cMaj, cMin, cPat] = parse(current);
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

async function checkForUpdate() {
  const CACHE_KEY = 'updateCheck';
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

  const { updateCheck } = await chrome.storage.local.get(CACHE_KEY);
  const now = Date.now();

  let latestTag;
  if (updateCheck && (now - updateCheck.ts) < CACHE_TTL_MS) {
    latestTag = updateCheck.tag;
  } else {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO}/releases/latest`,
        { headers: { Accept: 'application/vnd.github+json' } }
      );
      if (!res.ok) return;
      const data = await res.json();
      latestTag = data.tag_name;
      await chrome.storage.local.set({ [CACHE_KEY]: { ts: now, tag: latestTag } });
    } catch {
      return; // silently ignore network errors
    }
  }

  // Reject anything that isn't a clean semver tag before comparing or rendering
  // (defends against unexpected/hostile tag_name values).
  if (!latestTag || !VERSION_TAG_RE.test(latestTag)) return;
  const current = chrome.runtime.getManifest().version;
  const latest = latestTag.replace(/^v/, '');

  if (isNewerVersion(latest, current)) {
    // Build the link with the DOM API — never inject remote text via innerHTML.
    const link = document.createElement('a');
    link.href = `https://github.com/${REPO}/releases/latest`;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `${latestTag} verfügbar`;
    document.getElementById('footer-update').replaceChildren(link);
  }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
connectPort();
initialize();
document.getElementById('footer-version').textContent =
  `v${chrome.runtime.getManifest().version}`;
checkForUpdate();
