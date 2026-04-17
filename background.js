/**
 * background.js — Service Worker
 *
 * Manages capture state in chrome.storage.session (survives service worker
 * sleep/wake cycles within a browser session). Receives caption lines from
 * content.js and handles download requests from popup.js.
 */

import { formatTxt, formatMd, buildFilename } from './utils/formatter.js';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------
async function getState() {
  const result = await chrome.storage.session.get('captureState');
  return result.captureState || defaultState();
}

async function setState(patch) {
  const current = await getState();
  await chrome.storage.session.set({ captureState: { ...current, ...patch } });
}

function defaultState() {
  return {
    isCapturing: false,
    meetingTitle: '',
    lines: [],
    startTime: null,
    tabId: null,
  };
}

// ---------------------------------------------------------------------------
// Port connections
// content-script port: keeps the SW alive during capture, receives CAPTION_LINE
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
      const state = await getState();
      if (!state.isCapturing) return;

      let lines = [...state.lines];
      if (msg.replaceLastLine && lines.length > 0) {
        // Find the last line from this speaker and update it in place
        const lastIdx = [...lines].map(l => l.speaker).lastIndexOf(msg.speaker);
        if (lastIdx !== -1) {
          lines[lastIdx] = { speaker: msg.speaker, text: msg.text, timestamp: lines[lastIdx].timestamp };
        } else {
          lines.push({ speaker: msg.speaker, text: msg.text, timestamp: msg.timestamp });
        }
      } else {
        lines.push({ speaker: msg.speaker, text: msg.text, timestamp: msg.timestamp });
      }

      await setState({ lines });
      broadcastToPopup({ type: 'LINE_ADDED', lineCount: lines.length });
    });
    port.onDisconnect.addListener(async () => {
      // Content script disconnected — mark capture as stopped if still active
      const state = await getState();
      if (state.isCapturing) {
        await setState({ isCapturing: false });
        broadcastToPopup({ type: 'CAPTURE_STOPPED', reason: 'content_disconnected' });
      }
    });
  }
});

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
    sendResponse({ error: err.message });
  });
  return true; // keep channel open
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'START_CAPTURE': {
      const tab = await getActiveTab();
      if (!tab) return { error: 'No active Meet tab found.' };

      const title = await getMeetingTitle(tab.id);

      await setState({
        isCapturing: true,
        meetingTitle: title,
        lines: [],
        startTime: Date.now(),
        tabId: tab.id,
      });

      // Forward to content script
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'START_CAPTURE' });
        return response;
      } catch {
        await setState({ isCapturing: false });
        return { error: 'Could not reach the Meet tab. Please refresh the tab and try again.' };
      }
    }

    case 'STOP_CAPTURE': {
      const state = await getState();
      if (!state.isCapturing) return { status: 'not_capturing' };

      await setState({ isCapturing: false });

      if (state.tabId) {
        try {
          await chrome.tabs.sendMessage(state.tabId, { type: 'STOP_CAPTURE' });
        } catch {
          // Tab may have been closed
        }
      }
      return { status: 'ok', lineCount: state.lines.length };
    }

    case 'CAPTION_LINE': {
      const state = await getState();
      if (!state.isCapturing) return { status: 'ignored' };

      const line = {
        speaker: msg.speaker,
        text: msg.text,
        timestamp: msg.timestamp,
      };

      const lines = [...state.lines, line];
      await setState({ lines });
      broadcastToPopup({ type: 'LINE_ADDED', lineCount: lines.length });
      return { status: 'ok' };
    }

    case 'DOWNLOAD_TRANSCRIPT': {
      const state = await getState();
      if (state.lines.length === 0) return { error: 'No lines captured yet.' };

      const format = msg.format || 'txt';
      const content =
        format === 'md'
          ? formatMd(state.lines, state.meetingTitle, state.startTime)
          : formatTxt(state.lines, state.meetingTitle, state.startTime);

      const filename = buildFilename(state.startTime, format);

      // Encode as a data URL and trigger download
      const dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(content)}`;
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
      const state = await getState();
      return {
        isCapturing: state.isCapturing,
        lineCount: state.lines.length,
        startTime: state.startTime,
        meetingTitle: state.meetingTitle,
      };
    }

    case 'CLEAR_TRANSCRIPT': {
      const state = await getState();
      await setState({ lines: [], startTime: null, meetingTitle: '', isCapturing: false });

      // Notify content script that transcript was cleared (disables unload guard)
      if (state.tabId) {
        try {
          await chrome.tabs.sendMessage(state.tabId, { type: 'TRANSCRIPT_CLEARED' });
        } catch { /* tab may have been closed */ }
      }

      return { status: 'ok' };
    }

    case 'CC_STATUS': {
      // Forward CC detection status from content script to popup
      broadcastToPopup({ type: 'CC_STATUS', status: msg.status });
      if (msg.status === 'found') {
        // CC found — transition to capturing state
        const state = await getState();
        if (state.isCapturing) {
          broadcastToPopup({ type: 'CC_FOUND', lineCount: state.lines.length });
        }
      }
      return { status: 'ok' };
    }

    default:
      return { error: `Unknown message type: ${msg.type}` };
  }
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
    // Meet tab titles look like "My Meeting - Google Meet"
    return tab.title.replace(/\s*[-–]\s*Google Meet\s*$/i, '').trim() || 'Google Meet';
  } catch {
    return 'Google Meet';
  }
}

// ---------------------------------------------------------------------------
// Auto-stop when the user leaves the Meet tab
// ---------------------------------------------------------------------------
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.isCapturing && state.tabId === tabId) {
    await setState({ isCapturing: false });
    broadcastToPopup({ type: 'CAPTURE_STOPPED', reason: 'tab_closed' });
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  const state = await getState();
  if (!state.isCapturing || state.tabId !== tabId) return;
  if (changeInfo.url && !changeInfo.url.startsWith('https://meet.google.com/')) {
    await setState({ isCapturing: false });
    broadcastToPopup({ type: 'CAPTURE_STOPPED', reason: 'tab_navigated' });
  }
});
