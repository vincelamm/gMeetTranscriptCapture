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

// Set to true to get the full DOM/caption diagnostics in the console.
// Leave false in released builds: LOG covers the MutationObserver hot path and
// prints caption contents, which is meeting material.
const DEBUG = false;

/** Once-per-meeting lifecycle events — always on. */
const INFO = (...args) => console.log('[MeetTranscript]', ...args);
/** Verbose diagnostics — silenced unless DEBUG. */
const LOG = (...args) => { if (DEBUG) console.log('[MeetTranscript]', ...args); };

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
  // Strategy E: text-only fallback — no speaker attribution, just deduplicated
  // text. Gated behind looksLikeCaptionRegion(): without that gate it happily
  // latches onto Meet's status-announcement region, which is also aria-live.
  {
    name: 'text-only',
    findContainer: () => {
      const el = findAriaLiveContainer();
      return el && looksLikeCaptionRegion(el) ? el : null;
    },
    extractSpeakers: (container) => extractTextOnly(container),
  },
  // Strategy F: single-aria-live — when the CC widget is the only live region
  // in the DOM. Used to accept its container unconditionally "even when empty";
  // that is exactly how Meet's announcement region ("People panel is open",
  // "… joined") ended up being recorded as the entire transcript, so it now has
  // to look like a caption region too.
  {
    name: 'single-aria-live',
    findContainer: () => {
      const all = [...document.querySelectorAll('[aria-live]')];
      const el = all.length === 1 ? all[0] : null;
      return el && looksLikeCaptionRegion(el) ? el : null;
    },
    extractSpeakers: (container) => {
      const byPos = extractByPosition(container);
      return byPos.size > 0 ? byPos : extractTextOnly(container);
    },
  },
];

/**
 * Does this aria-live element plausibly hold captions rather than Meet's UI
 * status announcements?
 *
 * Both use aria-live, so the fallback strategies cannot tell them apart by the
 * attribute alone. Real transcripts captured nothing but announcements until
 * this gate existed. Two accepted signals:
 *
 *   1. it (or an ancestor) is explicitly labelled as the captions region
 *   2. it has caption *structure* — a child block holding at least two
 *      text-bearing children (speaker label + caption text). Announcements are
 *      a single flat string.
 */
function looksLikeCaptionRegion(el) {
  if (!el) return false;

  const labelled = el.closest(
    '[aria-label*="caption" i], [aria-label*="untertitel" i], [aria-label*="subtitle" i], ' +
    '[aria-label*="sous-titre" i], [aria-label*="sottotitoli" i], [aria-label*="subtítulo" i], ' +
    '[jsname="tgaKEf"], [jsname="DS9Ooe"]'
  );
  if (labelled) return true;

  for (const block of el.children) {
    const textKids = [...block.children].filter(k => k.textContent.trim().length > 0);
    if (textKids.length >= 2) return true;
  }

  LOG('looksLikeCaptionRegion: rejected', el.tagName, JSON.stringify(el.textContent.trim().slice(0, 60)));
  return false;
}

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
  // Reject CC language/settings panels: more than 3 BETA-tagged items = language list
  if ((text.match(/\bBETA\b/g) || []).length > 3) return new Map();
  if (isMeetAnnouncement(text)) {
    LOG('extractTextOnly: rejected Meet UI announcement:', text.slice(0, 80));
    return new Map();
  }
  return new Map([['(speaker)', text]]);
}

/**
 * Meet's own screen-reader announcements, which live in aria-live regions just
 * like the captions do. Without this filter they end up in the transcript as
 * speakerless lines — and worse, a matched announcement region makes
 * detectStrategy() report success, so the CC auto-enable never runs at all.
 *
 * Observed in the wild: opening the meeting details panel (which this extension
 * does itself when scraping) announces "Meeting details panel is open", which
 * was then recorded as the first and only caption line.
 */
const MEET_ANNOUNCEMENT_RE = new RegExp([
  'panel is (open|closed)',
  'panel (ist )?(geöffnet|geschlossen)',
  '\\b(your|dein|ihr)\\b.{0,20}\\b(camera|microphone|kamera|mikrofon)\\b',
  '\\b(camera|microphone|kamera|mikrofon)\\b.{0,20}\\b(is |ist )?(on|off|an|aus|ein)\\b',
  '\\b(joined|left|beigetreten|verlassen)\\b.{0,30}\\b(meeting|call|besprechung|anruf)\\b',
  // "<Name> (outside <Org>) joined" / "Max Mustermann hat den Anruf verlassen"
  '\\b(joined|left)\\s*$',
  '\\b(hat|ist)\\b.{0,40}\\b(beigetreten|verlassen)\\b',
  // "Someone wants to join this call. Use \"People\" to admit or deny."
  'wants to join|möchte (dem Anruf )?beitreten|admit or deny|zulassen oder ablehnen',
  '\\b(is|are|wird|werden)\\s+(now\\s+)?(presenting|pinned|muted|unmuted|stummgeschaltet|angeheftet)',
  '\\b(recording|aufzeichnung)\\b.{0,20}\\b(started|stopped|gestartet|beendet)\\b',
  'raised (their )?hand|hat die hand gehoben',
  'you are the only (one|person) here|du bist allein',
].join('|'), 'i');

/**
 * True if the text is one of Meet's UI status announcements rather than speech.
 * Only applied to short strings: real captions grow well past this, and a long
 * utterance that happens to contain such a phrase must not be dropped.
 */
function isMeetAnnouncement(text) {
  return text.length < 120 && MEET_ANNOUNCEMENT_RE.test(text);
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
/**
 * Meet's Settings dialog contains live regions and language lists of its own.
 * A caption container is never inside a dialog, so anything in one is rejected —
 * otherwise an open settings dialog gets mistaken for the CC widget and capture
 * reports success while recording nothing ("Capturing… 0 lines").
 */
function isInDialog(el) {
  return !!el?.closest('[role="dialog"], [role="alertdialog"]');
}

function findAriaLiveContainer() {
  // Find the aria-live element most likely to be the CC widget.
  // Caption containers have child elements (speaker blocks) even when empty;
  // status announcements ("Your camera is on") are flat text nodes with no children.
  // We accept empty containers — between utterances Meet clears the text but
  // keeps the DOM structure, and the observer will catch the next utterance.
  const candidates = [
    // polite is standard; assertive has been observed in some Meet versions
    ...document.querySelectorAll('[aria-live="polite"], [aria-live="assertive"]'),
  ].filter(el => {
    if (isInDialog(el)) return false;
    // Meet's own status announcements share the aria-live mechanism with the
    // captions; matching one makes detectStrategy() report a false success.
    if (isMeetAnnouncement(el.textContent.trim())) return false;
    // Must have child elements — flat text nodes are status announcements
    if (el.children.length === 0) return false;
    const text = el.textContent.trim();
    // Very short single-child containers are likely status announcements
    if (text.length < 20 && el.children.length < 2) return false;
    return true;
  });
  if (!candidates.length) return null;
  // Prefer the container with the most child elements (speaker blocks)
  return candidates.sort((a, b) => b.children.length - a.children.length)[0];
}

// ---------------------------------------------------------------------------
// Strategy detection
// ---------------------------------------------------------------------------
function detectStrategy() {
  for (const strategy of STRATEGIES) {
    const container = strategy.findContainer();
    if (!container) continue;
    if (isInDialog(container)) {
      LOG(`Strategy "${strategy.name}" — container sits inside a dialog, rejecting`);
      continue;
    }

    LOG(`Strategy "${strategy.name}" found container`);
    logContainerStructure(container);

    const speakers = strategy.extractSpeakers(container);
    if (speakers.size > 0) {
      LOG(`Strategy "${strategy.name}" extracted ${speakers.size} speaker(s):`, [...speakers.keys()]);
      return { strategy, container };
    }

    // For jsname strategies (A/B), the container itself is a strong signal —
    // accept it even if empty (captions may appear momentarily).
    // For fallback strategies (C–F), require actual speaker data so we don't
    // attach to an unrelated aria-live element before CC is enabled.
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
// Meeting info scraping
// ---------------------------------------------------------------------------

/**
 * Detect the local user's real name from the Meet DOM without opening any panel.
 *
 * Strategies (tried in order, stops at first hit):
 *   1. data-self-name attribute on the local user's video tile
 *   2. aria-label on any element that includes "(you)" or a locale variant,
 *      e.g. "<Name> (you)" on the gallery tile or participant list item
 *   3. data-participant-id containers that include a data-self-name child
 */
function detectLocalUser(info) {
  if (info.localUser) return;

  // 1. Google Account button — always present in Meet header.
  //    aria-label format: "Google Account: Name (email)" or "Google-Konto: Name (email)"
  for (const el of document.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label') || '';
    const accountMatch = label.match(/Google(?:[\s-](?:Account|Konto|conta|compte|cuenta|账号|アカウント)):\s*(.+?)\s*(?:\(|$)/i);
    if (accountMatch?.[1]) { info.localUser = accountMatch[1].trim(); return; }
  }

  // 2. data-self-name attribute on the local user's video tile
  const selfEl = document.querySelector('[data-self-name]');
  if (selfEl) {
    const name = selfEl.getAttribute('data-self-name').trim();
    if (name) { info.localUser = name; return; }
  }

  // 3. aria-label containing "(you)" / locale variants on ANY element —
  //    e.g. "<Name> (you)" on gallery tiles or participant list items.
  const YOU_PAREN = /\(\s*(you|vous|du|Sie|tú|tu|ty)\s*\)/i;
  for (const el of document.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label') || '';
    if (YOU_PAREN.test(label)) {
      const name = label.replace(YOU_PAREN, '').replace(/,\s*$/, '').trim();
      if (name) { info.localUser = name; return; }
    }
  }

  // 4. "More options for [Name]" on the self-view tile.
  //    Meet places this button on every participant tile; the self-tile is
  //    identified by having a sibling button whose label contains "your"
  //    (e.g. "Turn off your microphone") — remote tiles say "[Name]'s microphone".
  //    Fallback: if only one such button exists in the DOM it must be the self-tile.
  const MORE_OPT_RE = /^(?:More options|Weitere Optionen|Plus d'options|Más opciones|Mais opções|Altre opzioni)\s+(?:for|für|pour|para|per)\s+(.+)$/i;
  const SELF_CTRL_RE = /\b(your|yourself|Ihre[nm]?|vous-même|su propio)\b/i;
  const moreOptButtons = [...document.querySelectorAll('[aria-label]')]
    .filter(el => MORE_OPT_RE.test(el.getAttribute('aria-label') || ''));
  for (const el of moreOptButtons) {
    const label = el.getAttribute('aria-label') || '';
    const m = label.match(MORE_OPT_RE);
    if (!m) continue;
    const tile = el.closest('[data-participant-id]') || el.parentElement?.parentElement;
    const isSelfTile = moreOptButtons.length === 1  // alone in the DOM → must be self
      || (tile && [...tile.querySelectorAll('[aria-label]')]
          .some(b => SELF_CTRL_RE.test(b.getAttribute('aria-label') || '')));
    if (isSelfTile) { info.localUser = m[1].trim(); return; }
  }

  // 5. data-participant-id containers that hold a data-self-name child
  for (const container of document.querySelectorAll('[data-participant-id]')) {
    const nameEl = container.querySelector('[data-self-name]');
    if (nameEl) {
      const name = nameEl.getAttribute('data-self-name').trim();
      if (name) { info.localUser = name; return; }
    }
  }
}

/**
 * Automatically open the Meeting details panel (if not already open), scrape
 * its content, then close it again to restore the user's UI state.
 *
 * Returns a Promise that resolves to the info object (or null).
 * Called fire-and-forget from START_CAPTURE so caption capture is not blocked.
 */
async function scrapeMeetingInfoAsync() {
  const info = {};

  detectLocalUser(info);

  // Everything below clicks Meet's own UI. Meet answers those clicks with
  // aria-live announcements ("Meeting details panel is open") that are
  // indistinguishable from captions to the fallback strategies — one ended up
  // in a real transcript as the only line. Pause capture for the duration.
  suppressCaptureFor(2000);
  try {
    return await scrapeDetailsPanel(info);
  } finally {
    // Leave a margin: Meet announces the panel *closing* too.
    suppressCaptureFor(1500);
  }
}

/**
 * Capture is paused while the extension itself operates Meet's UI, so that
 * Meet's reaction to our own clicks never reaches the transcript.
 *
 * A deadline rather than a flag: the window must stay short, because real
 * speech during it would be lost. Each click we make extends it a little.
 */
let suppressUntil = 0;

function suppressCaptureFor(ms) {
  suppressUntil = Math.max(suppressUntil, Date.now() + ms);
}

function isCaptureSuppressed() {
  return Date.now() < suppressUntil;
}

async function scrapeDetailsPanel(info) {

  // --- Meeting details panel ---
  let panel = findMeetingDetailsPanel();
  let panelWasOpened = false;

  if (!panel) {
    const infoBtn = findMeetingInfoButton();
    if (infoBtn) {
      LOG('Opening Meeting details panel automatically');
      suppressCaptureFor(2500);
      infoBtn.click();
      panelWasOpened = true;
      // Poll instead of a fixed wait — on slow machines the panel needs well
      // over 450 ms, and missing it used to leave the panel open for good.
      for (let i = 0; i < 10 && !panel; i++) {
        await sleep(150);
        panel = findMeetingDetailsPanel();
      }
    }
  }

  if (panel) {
    extractFromDetailsPanel(panel, info);
    LOG('Details panel scraped:', JSON.stringify(info));
  }

  // --- Participants from People panel (if open and guests not found yet) ---
  if (!info.participants) {
    extractParticipantsFromPeoplePanel(info);
  }

  // Close the panel if we opened it (restore UI state).
  // Runs even when `panel` stayed null — otherwise a panel that rendered too
  // slowly (or under an unsupported locale) would be left open permanently.
  if (panelWasOpened) {
    await sleep(100); // brief pause so the panel is visually acknowledged
    const openPanel = panel || findMeetingDetailsPanel();
    const closeBtn = openPanel?.querySelector(
      '[aria-label*="Close" i], [aria-label*="Schließen" i], [aria-label*="Fermer" i], [aria-label*="Cerrar" i]'
    );
    if (closeBtn) {
      suppressCaptureFor(1500);
      closeBtn.click();
      LOG('Meeting details panel closed via close button');
    } else {
      // No close button found — press Escape rather than re-clicking the info
      // button, which is a toggle and would re-open an already-closed panel.
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
      }));
      await sleep(200);
      if (findMeetingDetailsPanel()) findMeetingInfoButton()?.click(); // still open → toggle
      LOG('Meeting details panel closed via Escape');
    }
  }

  // Final pass: DOM may have rendered more tiles after the 450 ms panel wait
  detectLocalUser(info);

  const hasData = Object.keys(info).length > 0;
  LOG('Meeting info scrape result:', hasData ? JSON.stringify(info) : 'nothing found');
  return hasData ? info : null;
}

/** Tiny helper — avoids importing a library just for delays. */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run the meeting-info scrape after `delayMs`, but never while one of Meet's
 * dialogs is open — the scrape opens the details panel, and a click landing on
 * a modal overlay either does nothing or dismisses the wrong thing.
 */
function scheduleMeetingInfoScrape(delayMs) {
  setTimeout(async () => {
    if (!isCapturing) return;
    for (let i = 0; i < 10 && document.querySelector('[role="dialog"], [role="alertdialog"]'); i++) {
      await sleep(1000);
    }
    if (!isCapturing) return;
    const meetingInfo = await scrapeMeetingInfoAsync();
    if (meetingInfo) {
      chrome.runtime.sendMessage({ type: 'MEETING_INFO', info: meetingInfo }).catch(() => {});
    }
  }, delayMs);
}

/**
 * Find the ℹ button in Meet's header that opens the Meeting details panel.
 * It typically carries the same aria-label / tooltip as the panel itself.
 */
function findMeetingInfoButton() {
  for (const el of document.querySelectorAll('button, [role="button"]')) {
    const label = (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-tooltip') || '');
    if (/meeting details|meetingdetails|besprechungsdetails|détails de la réunion|detalles/i.test(label)) {
      return el;
    }
  }
  return null;
}

/**
 * Find the "Meeting details" side panel.
 * Strategy: locate the heading element whose text matches "Meeting details"
 * (or a localized variant), then walk up to its panel container.
 */
function findMeetingDetailsPanel() {
  // The ℹ button that opens the panel ALSO has aria-label="Meeting details",
  // so we cannot use aria-label to find the panel — we'd get the button.
  // Instead find the heading element *inside* the panel, then walk up to the
  // container (jsname="I2egDd" in Jul 2026 DOM).
  const PANEL_LABELS = /^(meeting details|meetingdetails|besprechungsdetails|détails de la réunion|detalles de la reunión)$/i;
  for (const el of document.querySelectorAll('[role="heading"]')) {
    if (PANEL_LABELS.test(el.textContent.trim())) {
      return el.closest('[jsname="I2egDd"], [role="complementary"], [role="dialog"], aside')
        || el.parentElement?.parentElement?.parentElement
        || el.parentElement?.parentElement;
    }
  }
  return null;
}

/**
 * Extract structured data from the Meeting details panel.
 *
 * DOM structure (verified against live Meet HTML, Jul 2026):
 *
 *   aside
 *     div[jsname="I2egDd"]
 *       div[jsname="Pitq3d"]          ← title / description / schedule
 *         div[role="heading"]         ← meeting title
 *         div.jn4CRe                  ← description (no label, plain text)
 *         div.GsLSib                  ← schedule: <i>schedule</i> + <div>date</div>
 *       div[jsname="aVg3Fb"]          ← joining info section
 *         div[role="heading"]         ← "Joining info"
 *         span                        ← meet URL
 *         "(CC) +xx ..."              ← dial-in
 */
function extractFromDetailsPanel(panel, info) {
  // ── Title / Description / Schedule ──────────────────────────────────────
  // Primary: use the known jsname for the content area.
  const contentArea = panel.querySelector('[jsname="Pitq3d"]');
  if (contentArea) {
    for (const child of contentArea.children) {
      if (child.getAttribute('role') === 'heading') continue; // skip meeting title

      // Schedule row: identified by a Material Icon named "schedule"
      const scheduleIcon = [...child.querySelectorAll('i')].find(i => i.textContent.trim() === 'schedule');
      if (scheduleIcon) {
        // Time text is the sibling div next to the icon
        const timeEl = scheduleIcon.nextElementSibling;
        const timeText = timeEl?.textContent.trim() || child.textContent.replace('schedule', '').trim();
        if (timeText && /\d{1,2}:\d{2}/.test(timeText) && !info.scheduledTime) {
          info.scheduledTime = timeText;
        }
        continue;
      }

      // Any remaining direct child with text = description
      const text = child.textContent.trim();
      if (!info.description && text.length > 5 && text.length < 1000 && !/^https?:/.test(text)) {
        info.description = text;
      }
    }
  } else {
    // Fallback: extract schedule from full panel text via regex
    const TIME_PATTERNS = [
      /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)\s*[-–]\s*\d{1,2}:\d{2}\s*(?:AM|PM)/i,
      /(?:Mo|Di|Mi|Do|Fr|Sa|So)\.?,?\s*\d{1,2}\.\s*(?:Jan|Feb|Mär|Apr|Mai|Jun|Jul|Aug|Sep|Okt|Nov|Dez)[a-z]*\.?\s*\d{4},?\s*\d{1,2}:\d{2}\s*[-–]\s*\d{1,2}:\d{2}/i,
      /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}\s*(?:AM|PM)?\s*[-–]\s*\d{1,2}:\d{2}\s*(?:AM|PM)?/i,
    ];
    const fullText = panel.textContent;
    for (const p of TIME_PATTERNS) {
      const m = p.exec(fullText);
      if (m) { info.scheduledTime = m[0].replace(/\s+/g, ' ').trim(); break; }
    }
  }

  // ── Joining info ─────────────────────────────────────────────────────────
  // jsname="aVg3Fb" is the joining info container — scope lookups to it
  // to avoid false matches elsewhere in the panel.
  const joiningSection = panel.querySelector('[jsname="aVg3Fb"]') || panel;
  const joiningText = joiningSection.textContent;

  const meetUrlMatch = joiningText.match(/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/);
  if (meetUrlMatch) info.meetUrl = meetUrlMatch[0];

  const phoneMatch = joiningText.match(/\(\w{2,3}\)\s*\+[\d\s\-()]{7,25}/);
  if (phoneMatch) info.dialIn = phoneMatch[0].trim();

  // ── Organizer & Guests ───────────────────────────────────────────────────
  // Not shown in the verified DOM — handled by extractParticipantsFromPeoplePanel
  // when the People panel is open. Keep a regex fallback in case future Meet
  // versions add a guest list to the details panel.
  const fullText = panel.textContent;
  const organizerMatch = fullText.match(/([^\n\r,]{2,60}?)\s*[-–]\s*(?:organizer|organisator|organisateur|organizador)/i);
  if (organizerMatch) info.organizer = organizerMatch[1].trim();

  const guestSection = findSectionByLabel(panel,
    /^(guests?|gäste?|attendees?|teilnehmer|eingeladene|invités?|invitados?)$/i
  );
  if (guestSection) {
    const items = guestSection.querySelectorAll('[role="listitem"], li, [data-hovercard-id]');
    const names = [...(items.length > 0 ? items : guestSection.children)]
      .map(el => {
        const raw = el.textContent.trim().split('\n')[0];
        if (!info.localUser && /\(you\)/i.test(raw)) {
          info.localUser = raw
            .replace(/\s*[-–]\s*(?:organizer|organisator|organisateur)/i, '')
            .replace(/\s*\(you\)\s*/i, '').trim();
        }
        return raw
          .replace(/\s*[-–]\s*(?:organizer|organisator|organisateur)/i, '')
          .replace(/\s*\(you\)\s*/i, '').trim();
      })
      .filter(n => n.length > 1 && n.length < 80 && !/^https?:/.test(n));
    if (names.length > 0) info.participants = [...new Set(names)];
  }
}

/**
 * Walk the panel's heading/label elements, find one matching labelPattern,
 * and return the following sibling element (the content area).
 */
function findSectionByLabel(panel, labelPattern) {
  for (const el of panel.querySelectorAll('[role="heading"], h3, h4, strong, b')) {
    if (el.children.length === 0 && labelPattern.test(el.textContent.trim())) {
      return el.nextElementSibling || el.parentElement?.nextElementSibling;
    }
  }
  // Second pass: spans/divs that are standalone labels (leaf nodes)
  for (const el of panel.querySelectorAll('span, div')) {
    if (el.children.length === 0 && labelPattern.test(el.textContent.trim())) {
      return el.nextElementSibling || el.parentElement?.nextElementSibling;
    }
  }
  return null;
}

/** Extract participants (and detect the local user) from the People panel if open. */
function extractParticipantsFromPeoplePanel(info) {
  // Re-run user detection now that more DOM might be rendered
  detectLocalUser(info);

  const YOU_RE = /\(\s*(you|vous|du|Sie|tú|tu|ty)\s*\)/i;

  // Strategy 1: data-participant-id containers (reliable across Meet versions)
  const participantContainers = document.querySelectorAll('[data-participant-id]');
  if (participantContainers.length > 0) {
    const names = [...participantContainers]
      .map(el => {
        const nameEl = el.querySelector('[data-self-name], [jsname="gNMbOd"], .zWfAib');
        const raw = nameEl?.getAttribute('data-self-name')
          || nameEl?.textContent.trim()
          || el.getAttribute('aria-label') || '';
        return raw.replace(YOU_RE, '').replace(/,\s*$/, '').trim();
      })
      .filter(n => n.length > 0 && n.length < 80);
    if (names.length > 0) { info.participants = [...new Set(names)]; return; }
  }

  // Strategy 2: aria-labelled people panel list.
  // Scope the selector to containers that look like actual panels (not buttons),
  // and guard against unexpected element types.
  const peoplePanelCandidates = [...document.querySelectorAll(
    '[aria-label*="People" i], [aria-label*="Teilnehmer" i], [aria-label*="participants" i]'
  )].filter(el =>
    // Exclude small interactive controls (buttons, inputs) — only keep containers
    !['BUTTON', 'INPUT', 'A', 'SELECT'].includes(el.tagName) &&
    el.children.length > 0
  );
  const peoplePanel = peoplePanelCandidates[0] ?? null;
  if (peoplePanel) {
    try {
      const items = [...peoplePanel.querySelectorAll('[role="listitem"], li')];
      const names = items
        .map(el => el.textContent.trim().split('\n')[0].replace(YOU_RE, '').trim())
        .filter(n => n.length > 0 && n.length < 80);
      if (names.length > 0) info.participants = [...new Set(names)];
    } catch (err) {
      LOG('extractParticipantsFromPeoplePanel error:', err.message);
    }
  }
}

// ---------------------------------------------------------------------------
// Port to background (keeps the MV3 service worker alive during capture)
// ---------------------------------------------------------------------------
let bgPort = null;

function openPort() {
  if (bgPort) return;
  try {
    bgPort = chrome.runtime.connect({ name: 'content-script' });
    bgPort.onDisconnect.addListener(() => {
      bgPort = null;
      if (isCapturing) {
        // SW was terminated — reconnect to wake it and resume delivery
        setTimeout(openPort, 200);
      }
    });
    LOG('Port to background opened');
  } catch (err) {
    // Extension context invalidated (tab open across extension reload) — bail out.
    // The popup's "Reload Meet tab" view will guide the user.
    INFO('openPort failed:', err.message);
    bgPort = null;
  }
}

function closePort() {
  if (bgPort) { bgPort.disconnect(); bgPort = null; }
  LOG('Port to background closed');
}

function sendCaption(speaker, text, timestamp, replaceLastLine = false) {
  if (bgPort) {
    linesCommitted++;
    bgPort.postMessage({ type: 'CAPTION_LINE', speaker, text, timestamp, replaceLastLine });
    // Enable unload guard on first actual caption data
    if (!hasUnsavedTranscript) enableUnloadGuard();
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let isCapturing = false;
let observer = null;
let scanInterval = null;
let activeStrategy = null;
let localUserSent = false; // prevent redundant MEETING_INFO updates

/// Map<speakerKey, { pendingText: string, timer: TimeoutID }>
const speakerBuffers = new Map();
// Full committed text of each speaker's CURRENT active utterance (the line
// currently shown in the transcript). Used both for deduplication and as the
// base for overlap-merging Meet's rolling caption window.
const lastCommitted = new Map();
// Timestamp of each speaker's last commit (to expire stale utterance context)
const utteranceTimes = new Map();

/**
 * Lazy localUser detection: called the first time "You" appears as a caption
 * speaker. At that moment the local user's video tile is guaranteed to be in
 * the DOM, so detectLocalUser() is much more likely to succeed than at capture
 * start. Sends a MEETING_INFO patch (background merges it).
 */
function tryDetectAndSendLocalUser() {
  if (localUserSent) return;
  const info = {};
  detectLocalUser(info);
  if (info.localUser) {
    localUserSent = true;
    chrome.runtime.sendMessage({ type: 'MEETING_INFO', info: { localUser: info.localUser } })
      .catch(() => {});
    LOG('localUser detected lazily:', info.localUser);
  }
}

const DEBOUNCE_MS = 800;
// Minimum suffix/prefix overlap (chars) to treat a new caption window as a
// continuation of the current utterance rather than a brand-new one.
const MIN_OVERLAP_CHARS = 12;
// After this much silence, always start a new line even if text looks similar
const UTTERANCE_EXPIRY_MS = 12000;

// ---------------------------------------------------------------------------
// Debounce / deduplication
// ---------------------------------------------------------------------------
function processCaptionUpdate(currentSpeakers) {
  if (isCaptureSuppressed()) return; // the extension is operating Meet's UI right now
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

/**
 * Largest k (≤ cap) such that the last k chars of `a` equal the first k chars
 * of `b`. Used to stitch Google Meet's rolling caption window: when the top of
 * the window scrolls off, the new window text overlaps the tail of what we
 * already committed, and we append only the non-overlapping remainder.
 */
/**
 * Trailing punctuation and whitespace that Meet adds when it considers a phrase
 * finished and removes again when the sentence turns out to continue.
 */
function stripTrailingPunctuation(s) {
  return s.replace(/[\s.,!?;:…]+$/u, '');
}

function overlapLength(a, b) {
  const max = Math.min(a.length, b.length, 400);
  for (let k = max; k > 0; k--) {
    if (a.slice(a.length - k) === b.slice(0, k)) return k;
  }
  return 0;
}

function commitLine(speaker) {
  const buf = speakerBuffers.get(speaker);
  if (!buf) return;

  const windowText = buf.pendingText.trim();
  speakerBuffers.delete(speaker);
  if (!windowText) return;

  const now = Date.now();
  const prev = lastCommitted.get(speaker) || '';
  const lastCommitTime = utteranceTimes.get(speaker) || 0;
  const expired = (now - lastCommitTime) > UTTERANCE_EXPIRY_MS;

  // Determine how the new caption-window text relates to the text already
  // committed for this speaker's active utterance, and merge accordingly.
  // Google Meet shows a rolling ~2–3 line window: as someone keeps talking the
  // start scrolls out of view, so window text neither strictly grows nor stays
  // prefix-stable. We reconstruct the full utterance via suffix/prefix overlap.
  let merged;
  let isSameUtterance;

  // Compare on punctuation-stripped text. Meet appends a period once it
  // considers a phrase finished and drops it again as the sentence continues,
  // so "Wir fangen an." vs "Wir fangen an mit dem Thema." failed
  // every raw prefix and overlap check and produced three lines for one
  // sentence. Only the comparisons are normalised — output keeps Meet's
  // punctuation.
  const prevCore = stripTrailingPunctuation(prev);
  const windowCore = stripTrailingPunctuation(windowText);

  if (!prev || expired) {
    // Nothing to continue (or too much silence) — start a fresh line.
    merged = windowText;
    isSameUtterance = false;
  } else if (windowCore === prevCore) {
    // Same words — Meet only added or removed trailing punctuation.
    if (windowText === prev) return;
    merged = windowText;
    isSameUtterance = true;
  } else if (windowCore.startsWith(prevCore)) {
    // Window grew while the start is still visible — same utterance, longer.
    merged = windowText;
    isSameUtterance = true;
  } else if (prevCore.startsWith(windowCore)) {
    // New window is a shorter prefix of what we have — a revision, keep prev.
    return;
  } else if (windowCore.length >= MIN_OVERLAP_CHARS && prevCore.includes(windowCore)) {
    // Already contained somewhere inside the current line — keep prev.
    // Length-gated: without it a genuine short utterance ("Ja genau", "gut")
    // that happens to appear inside the previous line is silently dropped.
    return;
  } else {
    const k = overlapLength(prevCore, windowCore);
    if (k >= MIN_OVERLAP_CHARS) {
      // Rolling window scrolled: stitch the non-overlapping tail onto prev.
      // prevCore, not prev — otherwise a stripped period would reappear
      // mid-sentence ("… hier. eine Nachricht").
      merged = prevCore + windowText.slice(k);
      isSameUtterance = true;
    } else {
      // No meaningful overlap → a genuinely new utterance.
      merged = windowText;
      isSameUtterance = false;
    }
  }

  if (isSameUtterance && merged === prev) return;

  lastCommitted.set(speaker, merged);
  utteranceTimes.set(speaker, now);

  const textToSend = merged.trim();
  if (!textToSend) return;

  // When "You" appears as a speaker the local user's video tile is in the DOM —
  // take the opportunity to detect their real name if not yet known.
  if (/^(you|vous|du|tú|tu|ty|вы|あなた)$/i.test(speaker.trim())) {
    tryDetectAndSendLocalUser();
  }

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
  observedContainer = container;
  attachedAt = Date.now();
  INFO(`Observer attached via strategy "${strategy.name}"`);
  startHealthCheck();
}

function stopObserver() {
  if (observer) { observer.disconnect(); observer = null; }
  observedContainer = null;
  stopHealthCheck();
  // Flush remaining buffers
  for (const [speaker, buf] of speakerBuffers) {
    clearTimeout(buf.timer);
    commitLine(speaker);
  }
}

// ---------------------------------------------------------------------------
// Observer health check
//
// A MutationObserver is bound to one specific node. When Meet tears the caption
// region down and rebuilds it — CC toggled off/on, presentation started, layout
// change, breakout room — the observed node is detached and the callback simply
// never fires again. Re-acquiring the container *inside* the callback does not
// help, because the callback is exactly what stopped running. The capture then
// silently records nothing while the popup keeps saying "Aufnahme läuft".
// ---------------------------------------------------------------------------
let healthTimer = null;
let observedContainer = null;
let attachedAt = 0;
let linesCommitted = 0;

const HEALTH_INTERVAL_MS = 5000;
// If a strategy attached but never produced a line within this window, it most
// likely latched onto the wrong element — re-detect and try again.
const SILENT_STRATEGY_MS = 60000;

function startHealthCheck() {
  stopHealthCheck();
  healthTimer = setInterval(checkObserverHealth, HEALTH_INTERVAL_MS);
}

function stopHealthCheck() {
  if (healthTimer) { clearInterval(healthTimer); healthTimer = null; }
}

function checkObserverHealth() {
  if (!isCapturing || !observer) return;

  // 1. Observed node gone from the document → re-attach or fall back to polling.
  if (!observedContainer?.isConnected) {
    INFO('Caption container was removed from the DOM — re-detecting');
    reattachOrScan();
    return;
  }

  // 2. Attached but silent for too long → the strategy may have matched the
  //    wrong element. Only act if another strategy would pick something else.
  if (linesCommitted === 0 && Date.now() - attachedAt > SILENT_STRATEGY_MS) {
    const match = detectStrategy();
    if (match && match.container !== observedContainer) {
      INFO(`No captions from strategy "${activeStrategy?.name}" — switching to "${match.strategy.name}"`);
      activeStrategy = match.strategy;
      startObserver(match.strategy, match.container);
    } else {
      // Nothing better available; stop re-checking every 5s but keep capturing.
      attachedAt = Date.now();
    }
  }
}

function reattachOrScan() {
  const match = detectStrategy();
  if (match) {
    activeStrategy = match.strategy;
    startObserver(match.strategy, match.container);
    return;
  }
  // Container is gone and nothing new found — go back to polling. startScan()
  // re-attaches (and re-notifies the popup) as soon as captions reappear.
  if (observer) { observer.disconnect(); observer = null; }
  observedContainer = null;
  stopHealthCheck();
  chrome.runtime.sendMessage({ type: 'CC_STATUS', status: 'lost' }).catch(() => {});
  startScan(true);
}

// ---------------------------------------------------------------------------
// Auto-enable CC (Closed Captions)
// ---------------------------------------------------------------------------

/**
 * Attempts to find and click the CC toggle in Google Meet.
 * Returns 'already_on' | 'clicked' | 'not_found'.
 */
function tryEnableCC() {
  const ccButton = findCCButton();
  if (!ccButton) {
    LOG('CC button not found in DOM — user must enable manually');
    logCCDiagnostics();
    return 'not_found';
  }

  if (isCCButtonOn(ccButton)) {
    // Clicking now would turn captions OFF. Happens regularly: CC is already
    // enabled but nobody has spoken yet, so no caption container exists in the
    // DOM and detectStrategy() found nothing.
    LOG('CC button found — captions already enabled, not clicking');
    return 'already_on';
  }

  // Meet announces the toggle ("Captions are on") via aria-live, and may open
  // the settings dialog we then click through — none of that is speech.
  suppressCaptureFor(2000);
  ccButton.click();
  INFO('CC button clicked:', labelOf(ccButton).trim());
  // Meet may respond by opening Settings → Captions instead of switching
  // captions on directly (users without a saved caption language). Handle that
  // panel; fire-and-forget, the capture polling picks up from there.
  handleCaptionSettingsDialog();
  return 'clicked';
}

/**
 * Is the CC toggle currently ON?
 *
 * `aria-pressed` is the reliable signal when Meet sets it, but several Meet
 * versions omit it. Fall back to the label verb: Meet labels the button with
 * the action it *performs*, i.e. "Turn off captions" / "Untertitel deaktivieren"
 * while captions are on.
 */
function isCCButtonOn(btn) {
  const pressed = btn.getAttribute('aria-pressed');
  if (pressed === 'true') return true;
  if (pressed === 'false') return false;

  const label = (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('data-tooltip') || '');
  const TURN_OFF = /turn off|disable|hide|deaktivier|ausschalten|ausblenden|désactiver|masquer|desactivar|ocultar|disattiva|nascondi/i;
  return TURN_OFF.test(label);
}

/**
 * Meet's Settings dialog, Captions tab — shown when captions are switched on
 * without a stored preference (and the dialog our own CC-button search used to
 * open by mistake in ≤ v1.4.12).
 *
 * The dialog has NO confirm button: Meet applies changes immediately and the
 * user closes it with the ✕. So we only ever do two things here:
 *   1. select the "automatic captions" radio if captions are set to off
 *   2. close the dialog
 *
 * Deliberately never clicks an unidentified button — a blind "last button"
 * guess can hit "Reset" (wiping the user's caption preferences) or, in a
 * misidentified dialog, something far worse.
 */
async function handleCaptionSettingsDialog() {
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(300);
    const dialog = findCaptionSettingsDialog();
    if (!dialog) continue;

    INFO('Caption settings dialog detected — configuring and closing');
    suppressCaptureFor(2000);
    selectAutomaticCaptions(dialog);
    await sleep(300); // let Meet apply the radio change before the dialog goes away
    closeDialog(dialog);
    return true;
  }
  return false;
}

/**
 * Find Meet's caption settings dialog.
 *
 * Requires BOTH a caption term and an actual radio group — a settings dialog on
 * a different tab, a feedback form or a "leave meeting" confirmation must never
 * match, because we click inside whatever we return here.
 */
function findCaptionSettingsDialog() {
  const CAPTION_TERM = /caption|subtitle|untertitel|sous-titre|sottotitoli|subtítulo|legenda|ondertiteling/i;
  const DESTRUCTIVE = /leave|verlassen|end (the )?(call|meeting)|beenden|remove|entfernen|report|melden/i;

  for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    const text = (d.getAttribute('aria-label') || '') + ' ' + (d.textContent || '').slice(0, 600);
    if (!CAPTION_TERM.test(text)) continue;
    if (DESTRUCTIVE.test(text)) continue;
    if (!d.querySelector('[role="radio"], input[type="radio"]')) continue;
    return d;
  }
  return null;
}

const CAPTIONS_AUTO_RE = /^(automatic captions?|automatische untertitel|sous-titres automatiques|subtítulos automáticos|legendas automáticas|sottotitoli automatici|automatische ondertiteling)/i;

/** Switch the caption radio group to "automatic captions" if it is set to off. */
function selectAutomaticCaptions(dialog) {
  const radios = [...dialog.querySelectorAll('[role="radio"], input[type="radio"]')];
  const autoRadio = radios.find((r) => {
    const label = (r.getAttribute('aria-label') || '') || radioLabelText(r);
    return CAPTIONS_AUTO_RE.test(label.trim());
  });

  if (!autoRadio) {
    LOG('Caption settings dialog: no "automatic captions" radio found');
    return;
  }
  const checked = autoRadio.getAttribute('aria-checked') === 'true' || autoRadio.checked === true;
  if (checked) {
    LOG('Caption settings dialog: automatic captions already selected');
    return;
  }
  autoRadio.click();
  INFO('Caption settings dialog: selected automatic captions');
}

/** Text of the label row a custom radio belongs to. */
function radioLabelText(radio) {
  const row = radio.closest('label, [role="radiogroup"] > *, li') || radio.parentElement;
  return row ? row.textContent.trim() : '';
}

/** Close a dialog via its close button, falling back to Escape. */
function closeDialog(dialog) {
  const CLOSE = /close|schließen|schliessen|fermer|cerrar|chiudi|sluiten/i;
  const closeBtn = [...dialog.querySelectorAll('button, [role="button"]')].find((b) => {
    const label = (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('data-tooltip') || '');
    return CLOSE.test(label);
  });

  if (closeBtn) {
    closeBtn.click();
    LOG('Dialog closed via close button');
    return;
  }
  for (const target of [dialog, document.activeElement, document.body]) {
    target?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
    }));
  }
  LOG('Dialog closed via Escape');
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

  // Every pass below is filtered through isCaptionToggle(): a settings/options
  // control also carries a caption keyword, and clicking it opens Meet's
  // Settings → Captions dialog instead of switching captions on. That was the
  // root cause of the "a window opens on start" reports up to v1.4.12.
  const candidates = [...document.querySelectorAll(clickableSelector)].filter(isCaptionToggle);

  // Pass 1: language-independent — Meet includes the keyboard shortcut "(c)"
  // in the CC *toggle* label across virtually all locales. Settings entries
  // have no shortcut, so this is the strongest signal.
  for (const el of candidates) {
    const combined = labelOf(el);
    if (/\(c\)/i.test(combined)) {
      LOG('findCCButton: matched via shortcut hint "(c)":', combined.trim());
      return el;
    }
  }

  // Pass 2: caption keyword in aria-label / data-tooltip.
  for (const el of candidates) {
    const combined = labelOf(el);
    if (keywordPattern.test(combined)) {
      LOG('findCCButton: matched via keyword in aria-label/tooltip:', combined.trim());
      return el;
    }
  }

  // Pass 3: check jsname — Meet's CC button has been seen with these values
  const CC_JSNAMES = ['r8qRAd', 'Dg9Wp'];
  for (const jsname of CC_JSNAMES) {
    const el = document.querySelector(`[jsname="${jsname}"]`);
    const btn = el?.closest(clickableSelector) || el;
    if (btn && isCaptionToggle(btn)) {
      LOG('findCCButton: matched via jsname:', jsname);
      return btn;
    }
  }

  // Pass 4: toolbar scan with keywords
  const toolbars = document.querySelectorAll('[role="toolbar"], [jsname="EaZ7Cc"]');
  for (const toolbar of toolbars) {
    for (const el of toolbar.querySelectorAll(clickableSelector)) {
      if (!isCaptionToggle(el)) continue;
      const text = labelOf(el) + ' ' + el.textContent;
      if (keywordPattern.test(text) || /\(c\)/i.test(text)) {
        LOG('findCCButton: matched via toolbar scan:', text.trim().slice(0, 60));
        return el;
      }
    }
  }

  return null;
}

/** aria-label + data-tooltip of an element, as one string. */
function labelOf(el) {
  return (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-tooltip') || '');
}

/**
 * Labels that mark a settings / language / overflow control rather than the
 * captions on-off toggle. Clicking one of these opens a dialog instead of
 * enabling captions, so they are excluded from every search pass.
 */
const CC_SETTINGS_PATTERN =
  /settings|einstellung|preferences|optionen|options?\b|language|sprache|langue|idioma|lingua|impostazioni|configuraci|configura|instellingen|more\b|weitere|mehr\b/i;

/**
 * True unless the element is recognisably a settings/options entry or sits in a
 * dialog. An unlabelled element passes — the keyword passes reject it anyway,
 * and the jsname pass must keep working on buttons without an aria-label.
 */
function isCaptionToggle(el) {
  if (CC_SETTINGS_PATTERN.test(labelOf(el))) return false;
  // Never click inside an open dialog — the toggle lives in the meeting toolbar.
  if (isInDialog(el)) return false;
  return true;
}

function logCCDiagnostics() {
  const clickables = [...document.querySelectorAll('button, [role="button"]')];
  const labels = clickables
    .map(el => ({
      tag: el.tagName,
      ariaLabel: el.getAttribute('aria-label'),
      tooltip: el.getAttribute('data-tooltip'),
      jsname: el.getAttribute('jsname'),
    }))
    .filter(x => x.ariaLabel || x.tooltip);

  // Shown without DEBUG: when auto-enable fails this is the one thing needed to
  // fix it, and asking users to flip a source constant first does not work.
  const captionish = labels.filter(x =>
    /caption|untertitel|subtitle|sous-titre|sottotitoli|subtítulo|legenda|\(c\)/i
      .test((x.ariaLabel || '') + ' ' + (x.tooltip || ''))
  );
  INFO('CC button not found. Caption-related controls in the DOM:',
    captionish.length ? captionish : '(none — is the meeting toolbar loaded?)');

  LOG('CC diagnostics — all clickable elements with labels:', JSON.stringify(labels, null, 2));
}

// ---------------------------------------------------------------------------
// Polling (waits for CC widget to appear in DOM)
// ---------------------------------------------------------------------------
let ccAttempts = 0;

/**
 * Poll for the caption container.
 *
 * `ccKnownOn` means the CC toggle reported itself as already enabled. Meet only
 * renders the caption container once somebody has spoken, so an empty DOM is
 * expected during silence — warning after 6 s would be wrong. Wait ~40 s before
 * suggesting manual steps in that case.
 */
function startScan(ccKnownOn = false) {
  stopScan();
  ccAttempts = 0;
  const warnAfter = ccKnownOn ? 20 : 3;
  LOG('Polling for caption container every 2s…');
  scanInterval = setInterval(() => {
    // Never latch onto a container while our own clicks are changing Meet's UI.
    if (isCaptureSuppressed()) return;
    const match = detectStrategy();
    if (match) {
      stopScan();
      activeStrategy = match.strategy;
      startObserver(match.strategy, match.container);
      chrome.runtime.sendMessage({ type: 'CC_STATUS', status: 'found' }).catch(() => {});
    } else {
      ccAttempts++;
      if (ccAttempts === warnAfter) {
        chrome.runtime.sendMessage({ type: 'CC_STATUS', status: 'not_found' }).catch(() => {});
      }
    }
  }, 2000);
}

function stopScan() {
  if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
}

// ---------------------------------------------------------------------------
// beforeunload guard — warn user about unsaved transcript
// ---------------------------------------------------------------------------
let hasUnsavedTranscript = false;

function onBeforeUnload(e) {
  if (hasUnsavedTranscript) {
    e.preventDefault();
    // Modern browsers ignore custom text but require returnValue to be set
    e.returnValue = '';
  }
}

function enableUnloadGuard() {
  hasUnsavedTranscript = true;
  window.addEventListener('beforeunload', onBeforeUnload);
  LOG('Unload guard enabled — user will be warned before leaving');
}

function disableUnloadGuard() {
  hasUnsavedTranscript = false;
  window.removeEventListener('beforeunload', onBeforeUnload);
  LOG('Unload guard disabled');
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'START_CAPTURE') {
    isCapturing = true;
    localUserSent = false;
    linesCommitted = 0;
    speakerBuffers.clear();
    lastCommitted.clear();
    utteranceTimes.clear();
    activeStrategy = null;
    openPort();

    INFO('Start capture requested');

    const match = detectStrategy();

    if (match) {
      activeStrategy = match.strategy;
      startObserver(match.strategy, match.container);
      sendResponse({ status: 'ok' });
      scheduleMeetingInfoScrape(0);
    } else {
      // No caption container yet. Note this does NOT prove captions are off —
      // Meet only renders the container once someone has spoken. tryEnableCC()
      // therefore checks the toggle's own state before clicking anything.
      const ccResult = tryEnableCC();
      INFO('Auto-enable CC result:', ccResult);
      startScan(ccResult === 'already_on');
      sendResponse({ status: 'waiting_for_captions', ccAction: ccResult });
      // Delay the meeting-info scrape: it opens and closes Meet's details
      // panel, which must not overlap with the CC click and any dialog Meet
      // shows in response.
      scheduleMeetingInfoScrape(ccResult === 'clicked' ? 5000 : 1000);
    }
  }

  if (msg.type === 'STOP_CAPTURE') {
    isCapturing = false;
    stopObserver();
    stopScan();
    closePort();
    // Keep unload guard active — transcript still needs to be downloaded
    INFO('Capture stopped');
    sendResponse({ status: 'ok' });
  }

  if (msg.type === 'TRANSCRIPT_DOWNLOADED' || msg.type === 'TRANSCRIPT_CLEARED') {
    disableUnloadGuard();
    sendResponse({ status: 'ok' });
  }

  if (msg.type === 'PING') {
    sendResponse({ status: 'ready' });
  }

  return true;
});
