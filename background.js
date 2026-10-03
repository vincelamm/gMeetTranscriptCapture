/**
 * background.js — Service Worker
 *
 * Manages capture state in chrome.storage.session (survives service worker
 * sleep/wake cycles within a browser session). Receives caption lines from
 * content.js and handles download requests from popup.js.
 *
 * State handling (see TICKET-001 / TICKET-007):
 *   - The authoritative copy of the state lives in an in-memory `cache` object
 *     while the service worker is alive. All mutations happen synchronously on
 *     that object, which removes the read-modify-write race that a
 *     getState()/setState() round-trip over `await` would otherwise have.
 *   - The cache is lazily (re)loaded from chrome.storage.session whenever the
 *     service worker (re)starts.
 *   - Writes to storage are batched: high-frequency caption appends only
 *     schedule a debounced flush, while correctness-critical operations
 *     (start/stop/download/clear/…) flush immediately.
 */

import { formatTxt, formatMd, formatAIPrompt, buildFilename } from './utils/formatter.js';
import { cleanTranscriptForExport } from './utils/transcript-cleanup.js';

// ---------------------------------------------------------------------------
// State: in-memory cache + batched persistence
// ---------------------------------------------------------------------------
function defaultState() {
  return {
    isCapturing: false,
    // 'idle' | 'waiting_for_captions' | 'capturing'
    // Kept in the persisted state, not just in the popup: the popup closes on
    // the first click into the Meet page, and on reopen it must be able to tell
    // "waiting for captions" from "actually recording". isCapturing alone is
    // true in both cases.
    capturePhase: 'idle',
    ccWarning: false,   // captions not detected — popup shows manual instructions
    ccAction: null,     // 'clicked' | 'already_on' | 'not_found' — drives the waiting text
    meetingTitle: '',
    meetingInfo: null,
    lines: [],
    startTime: null,
    tabId: null,
  };
}

let cache = null;          // authoritative state while the SW is alive
let loadingPromise = null; // de-dupes concurrent initial loads
let flushTimer = null;
const FLUSH_DEBOUNCE_MS = 2000;

/**
 * Return the live state object, lazily loading it from storage the first time
 * (or after a service-worker restart). Concurrent callers share one load, so
 * they all receive the same object — after which synchronous mutations on it
 * are atomic with respect to one another.
 */
async function ensureState() {
  if (cache) return cache;
  if (!loadingPromise) {
    loadingPromise = chrome.storage.session.get('captureState').then((result) => {
      cache = result.captureState || defaultState();
      loadingPromise = null;
      return cache;
    });
  }
  return loadingPromise;
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, FLUSH_DEBOUNCE_MS);
}

/** Persist the current cache to storage immediately (cancels any pending flush). */
async function flushNow() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (!cache) return;
  await chrome.storage.session.set({ captureState: cache });
}

/**
 * Merge a patch into the live state. High-frequency callers pass immediate:false
 * (default) to batch the write; correctness-critical callers pass immediate:true.
 */
async function patchState(patch, { immediate = false } = {}) {
  const state = await ensureState();
  Object.assign(state, patch);
  if (immediate) await flushNow();
  else scheduleFlush();
  return state;
}

// ---------------------------------------------------------------------------
// Port connections
// content-script port: receives CAPTION_LINE; messages reset the MV3 idle timer,
// but merely holding the port open does not prevent service-worker suspension.
// popup port: pushes live line count updates to the popup
// ---------------------------------------------------------------------------
const popupPorts = new Set();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'popup') {
    popupPorts.add(port);
    port.onDisconnect.addListener(() => popupPorts.delete(port));
    return;
  }

  if (port.name === 'content-script') {
    port.onMessage.addListener(async (msg) => {
      if (msg.type !== 'CAPTION_LINE') return;
      const state = await ensureState();
      if (!state.isCapturing) return;

      // Mutate the in-memory state synchronously — no await between read and
      // write, so concurrent CAPTION_LINE messages cannot clobber each other.
      appendCaptionLine(state, msg);
      scheduleFlush();
      broadcastToPopup({ type: 'LINE_ADDED', lineCount: state.lines.length });

      // First line proves captions really arrive — leave the waiting phase even
      // if the CC_STATUS 'found' message was lost (e.g. SW restart in between).
      if (state.capturePhase !== 'capturing') {
        await patchState({ capturePhase: 'capturing', ccWarning: false }, { immediate: true });
      }
      scheduleBadgeUpdate();
    });
    port.onDisconnect.addListener(async () => {
      // Content script disconnected — mark capture as stopped if still active
      const state = await ensureState();
      if (state.isCapturing) {
        await patchState({ isCapturing: false, capturePhase: 'idle', ccWarning: false }, { immediate: true });
        await updateBadge();
        broadcastToPopup({ type: 'CAPTURE_STOPPED', reason: 'content_disconnected' });
      }
    });
  }
});

/**
 * Append a caption line to the state, or update the speaker's most recent line
 * in place when the content script flagged this as a same-utterance revision.
 * Mutates `state.lines` directly (the cache is the single source of truth).
 */
function appendCaptionLine(state, msg) {
  const identity = typeof msg.utteranceId === 'string' && msg.utteranceId.trim()
    ? { utteranceId: msg.utteranceId } : {};
  if (msg.replaceLastLine && state.lines.length > 0) {
    const lastIdx = state.lines.map((l) => l.speaker).lastIndexOf(msg.speaker);
    const previousIdentity = state.lines[lastIdx]?.utteranceId;
    if (lastIdx !== -1 && (!identity.utteranceId ||
        (previousIdentity && identity.utteranceId === previousIdentity))) {
      state.lines[lastIdx] = {
        ...identity,
        speaker: msg.speaker,
        text: msg.text,
        timestamp: state.lines[lastIdx].timestamp,
      };
      return;
    }
  }
  state.lines.push({ speaker: msg.speaker, text: msg.text, timestamp: msg.timestamp, ...identity });
}

/** Append only a reply belonging to the same capture array. A new start or
 * discard can run while tabs.sendMessage is pending; never restore old text. */
function appendFlushedCaptions(state, response, captureLines) {
  if (state.lines !== captureLines || !Array.isArray(response?.captions)) return;
  let received = false;
  for (const caption of response.captions) {
    if (caption?.type !== 'CAPTION_LINE' || typeof caption.speaker !== 'string' ||
        typeof caption.text !== 'string' || !caption.text.trim() ||
        !Number.isFinite(caption.timestamp)) continue;
    appendCaptionLine(state, caption);
    received = true;
  }
  if (received) {
    if (state.isCapturing) {
      state.capturePhase = 'capturing';
      state.ccWarning = false;
    }
    broadcastToPopup({ type: 'LINE_ADDED', lineCount: state.lines.length });
    scheduleBadgeUpdate();
  }
}

function broadcastToPopup(msg) {
  for (const port of popupPorts) {
    try {
      port.postMessage(msg);
    } catch {
      popupPorts.delete(port);
    }
  }
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch((err) => {
    console.error('[MeetTranscript] background error:', err);
    sendResponse({ error: 'No se pudo completar la operación. Inténtalo de nuevo.' });
  });
  return true; // keep channel open
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'START_CAPTURE': {
      const tab = await getActiveTab();
      if (!tab) return { error: 'No se encontró una pestaña activa de Google Meet.' };

      const title = await getMeetingTitle(tab.id);

      await patchState({
        isCapturing: true,
        capturePhase: 'waiting_for_captions',
        ccWarning: false,
        meetingTitle: title,
        meetingInfo: null,
        lines: [],
        startTime: Date.now(),
        tabId: tab.id,
      }, { immediate: true });

      // Forward to content script
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_CAPTURE' });
        await patchState({
          capturePhase: response?.status === 'ok' ? 'capturing' : 'waiting_for_captions',
          ccAction: response?.ccAction || null,
        }, { immediate: true });
        await updateBadge();
        return response;
      } catch {
        await patchState({ isCapturing: false, capturePhase: 'idle' }, { immediate: true });
        await updateBadge();
        return {
          errorCode: 'MEET_TAB_UNREACHABLE',
          error: 'No se pudo conectar con la pestaña de Meet. Recárgala e inténtalo de nuevo.',
        };
      }
    }

    case 'STOP_CAPTURE': {
      const state = await ensureState();
      if (!state.isCapturing) return { status: 'not_capturing' };

      const captureLines = state.lines;
      await patchState({ isCapturing: false, capturePhase: 'idle', ccWarning: false }, { immediate: true });

      if (state.tabId) {
        try {
          const response = await chrome.tabs.sendMessage(state.tabId, { type: 'STOP_CAPTURE' });
          appendFlushedCaptions(state, response, captureLines);
        } catch {
          // Tab may have been closed
        }
      }
      await flushNow();
      await updateBadge();
      return { status: 'ok', lineCount: state.lines.length };
    }

    case 'MEETING_INFO': {
      const state = await ensureState();
      await patchState(
        { meetingInfo: { ...(state.meetingInfo || {}), ...msg.info } },
        { immediate: true }
      );
      return { status: 'ok' };
    }

    case 'GET_TRANSCRIPT_CONTENT': {
      const state = await ensureState();
      if (state.lines.length === 0) return { error: 'Todavía no hay intervenciones capturadas.' };
      const content = formatAIPrompt(state.lines, state.meetingTitle, state.startTime, state.meetingInfo);
      return { status: 'ok', content };
    }

    case 'DOWNLOAD_TRANSCRIPT': {
      const state = await ensureState();
      if (state.isCapturing && state.tabId) {
        const captureLines = state.lines;
        try {
          const response = await chrome.tabs.sendMessage(state.tabId, { type: 'FLUSH_CAPTIONS' });
          appendFlushedCaptions(state, response, captureLines);
        } catch {
          // Closed/unreachable tab: the already stored transcript is exportable.
        }
      }
      if (state.lines.length === 0) return { error: 'Todavía no hay intervenciones capturadas.' };

      // Persist the latest state before handing a copy to the download.
      await flushNow();

      const format = msg.format || 'txt';
      // Cleanup is an export-only snapshot. Preserve the raw end time: merging
      // revisions retains the first timestamp and must not shorten duration.
      const snapshot = state.lines.map(line => ({ ...line }));
      const endTime = snapshot[snapshot.length - 1]?.timestamp ?? state.startTime;
      const exportLines = cleanTranscriptForExport(snapshot);
      const content =
        format === 'md'
          ? formatMd(exportLines, state.meetingTitle, state.startTime, state.meetingInfo, endTime)
          : formatTxt(exportLines, state.meetingTitle, state.startTime, state.meetingInfo, endTime);

      const filename = buildFilename(state.startTime, format);

      // Encode as a data URL and trigger download.
      // Use text/markdown for .md files so Chrome preserves the extension.
      const mimeType = format === 'md' ? 'text/markdown' : 'text/plain';
      const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
      await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });

      // Notify content script that transcript was downloaded (disables unload guard)
      if (state.tabId) {
        try {
          await chrome.tabs.sendMessage(state.tabId, { type: 'TRANSCRIPT_DOWNLOADED' });
        } catch { /* tab may have been closed */ }
      }

      return { status: 'ok', filename };
    }

    case 'GET_STATE': {
      const state = await ensureState();
      return {
        isCapturing: state.isCapturing,
        capturePhase: state.capturePhase || 'idle',
        ccWarning: !!state.ccWarning,
        ccAction: state.ccAction || null,
        lineCount: state.lines.length,
        startTime: state.startTime,
        meetingTitle: state.meetingTitle,
      };
    }

    case 'CLEAR_TRANSCRIPT': {
      const state = await ensureState();
      await patchState(
        { lines: [], startTime: null, meetingTitle: '', isCapturing: false, capturePhase: 'idle', ccWarning: false },
        { immediate: true }
      );
      await updateBadge();

      // Notify content script that transcript was cleared (disables unload guard)
      if (state.tabId) {
        try {
          await chrome.tabs.sendMessage(state.tabId, { type: 'TRANSCRIPT_CLEARED' });
        } catch { /* tab may have been closed */ }
      }

      return { status: 'ok' };
    }

    case 'CC_STATUS': {
      const state = await ensureState();
      if (!state.isCapturing) return { status: 'not_capturing' };

      // Persist the phase before broadcasting: a closed popup misses the
      // broadcast entirely and has to recover the phase from GET_STATE.
      if (msg.status === 'found') {
        await patchState({ capturePhase: 'capturing', ccWarning: false }, { immediate: true });
      } else if (msg.status === 'not_found') {
        await patchState({ ccWarning: true }, { immediate: true });
      } else if (msg.status === 'lost') {
        // Caption container disappeared mid-capture — back to waiting.
        await patchState({ capturePhase: 'waiting_for_captions' }, { immediate: true });
      }
      await updateBadge();

      broadcastToPopup({ type: 'CC_STATUS', status: msg.status });
      if (msg.status === 'found') {
        broadcastToPopup({ type: 'CC_FOUND', lineCount: state.lines.length });
      }
      return { status: 'ok' };
    }

    default:
      return { error: 'Tipo de mensaje desconocido.' };
  }
}

// ---------------------------------------------------------------------------
// Toolbar badge
//
// The popup closes as soon as the user clicks back into the Meet page, so it
// cannot be the only place the capture state is visible. The badge answers
// "is it running, and is it actually getting anything?" without opening it.
// ---------------------------------------------------------------------------
let badgeTimer = null;

/** Coalesce badge writes on the caption hot path (captions arrive in bursts). */
function scheduleBadgeUpdate() {
  if (badgeTimer) return;
  badgeTimer = setTimeout(() => { badgeTimer = null; updateBadge(); }, 1000);
}

// The badge does not survive a service-worker restart, but the session state
// does — restore it whenever this module is evaluated.
updateBadge();

async function updateBadge() {
  const state = await ensureState();
  let text = '';
  let color = '#1a73e8';

  if (state.capturePhase === 'capturing') {
    text = state.lines.length > 999 ? '999+' : String(state.lines.length);
    // Recording but nothing captured yet — amber instead of blue.
    color = state.lines.length === 0 ? '#f9ab00' : '#1a73e8';
  } else if (state.capturePhase === 'waiting_for_captions') {
    text = '…';
    color = state.ccWarning ? '#d93025' : '#f9ab00';
  }

  try {
    await chrome.action.setBadgeText({ text });
    if (text) await chrome.action.setBadgeBackgroundColor({ color });
  } catch { /* action API unavailable during SW teardown */ }
}

// ---------------------------------------------------------------------------
// Tab helpers
// ---------------------------------------------------------------------------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.startsWith('https://meet.google.com/')) return tab;
  return null;
}

async function getMeetingTitle(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    // Tab title formats: "My Meeting - Google Meet" or "Meet - My Meeting"
    return tab.title
      .replace(/\s*[-–]\s*Google Meet\s*$/i, '')
      .replace(/^(?:Google\s+)?Meet\s*[-–]\s*/i, '')
      .trim() || 'Google Meet';
  } catch {
    return 'Google Meet';
  }
}

// ---------------------------------------------------------------------------
// Auto-stop when the user leaves the Meet tab
// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await ensureState();
  if (state.isCapturing && state.tabId === tabId) {
    await patchState({ isCapturing: false, capturePhase: 'idle', ccWarning: false }, { immediate: true });
    await updateBadge();
    broadcastToPopup({ type: 'CAPTURE_STOPPED', reason: 'tab_closed' });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const state = await ensureState();
  if (!state.isCapturing || state.tabId !== tabId) return;
  if (changeInfo.url && !changeInfo.url.startsWith('https://meet.google.com/')) {
    await patchState({ isCapturing: false, capturePhase: 'idle', ccWarning: false }, { immediate: true });
    await updateBadge();
    broadcastToPopup({ type: 'CAPTURE_STOPPED', reason: 'tab_navigated' });
  }
});
