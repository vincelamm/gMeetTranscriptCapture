/**
 * caption-core.js — caption parsing and classification, free of the DOM and
 * the chrome.* APIs.
 *
 * Everything here takes plain arguments and returns plain values, so it can be
 * required directly in Node. That is the point: the pipeline in this file has
 * silently dropped caption data twice, and tests for it must not depend on
 * stubbing a browser.
 *
 * Loaded as the FIRST content script (see manifest.json) so content.js can use
 * these declarations — classic content scripts share one global scope; ES
 * modules are not available for content scripts declared in the manifest.
 *
 * The extraction helpers accept anything element-shaped: `children`,
 * `textContent`, `nodeType`, `querySelector(All)`, `closest`. Tests pass plain
 * objects, the browser passes real elements.
 */

// Set to true to get the full DOM/caption diagnostics in the console.
// Leave false in released builds: LOG covers the MutationObserver hot path and
// prints caption contents, which is meeting material.
const DEBUG = false;

/** Once-per-meeting lifecycle events — always on. */
const INFO = (...args) => console.log('[MeetTranscript]', ...args);
/** Verbose diagnostics — silenced unless DEBUG. */
const LOG = (...args) => { if (DEBUG) console.log('[MeetTranscript]', ...args); };

// Minimum suffix/prefix overlap (chars) to treat a new caption window as a
// continuation of the current utterance rather than a brand-new one.
const MIN_OVERLAP_CHARS = 12;
// After this much silence, always start a new line even if text looks similar
const UTTERANCE_EXPIRY_MS = 12000;

const ELEMENT_NODE = 1; // Node.ELEMENT_NODE — spelled out so Node.js needs no DOM stub

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
    if (block.nodeType !== ELEMENT_NODE) continue;

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
    } else if (text.length > 0) {
      // Dropping a block here means losing that participant's words with no
      // trace in the transcript — the failure mode that hid lowercase display
      // names for months. Make it visible.
      LOG('extractByPosition: rejected block — speaker candidate',
        JSON.stringify(speaker.slice(0, 40)), 'text', JSON.stringify(text.slice(0, 40)));
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
  // Contains common sentence-internal punctuation
  if (/[,;]/.test(str)) return true;

  const words = str.split(/\s+/);
  // More than 4 words is probably not a name
  if (words.length > 4) return true;

  // A lowercase start alone must NOT disqualify a name. Meet display names are
  // frequently lowercase — "test", "sa", nicknames, handles — and rejecting
  // them dropped that participant's contributions from the transcript
  // entirely, with no trace anywhere.
  //
  // Only an all-lowercase multi-word string reads as running text rather than
  // a name: "und dann sagte er". A capital somewhere keeps name particles
  // intact ("van Dijk", "de la Cruz"). Longer German fragments carrying a
  // capitalised noun are caught by the >4 words rule above.
  //
  // Deliberately permissive: a wrong speaker label is visible and correctable,
  // a rejected block loses that person's words without any sign of it.
  if (words.length >= 3 && /^\p{Ll}/u.test(str) && !/\p{Lu}/u.test(str)) return true;

  return false;
}

/**
 * Largest k (≤ cap) such that the last k chars of `a` equal the first k chars
 * of `b`. Used to stitch Google Meet's rolling caption window: when the top of
 * the window scrolls off, the new window text overlaps the tail of what we
 * already committed, and we append only the non-overlapping remainder.
 */
function overlapLength(a, b) {
  const max = Math.min(a.length, b.length, 400);
  for (let k = max; k > 0; k--) {
    if (a.slice(a.length - k) === b.slice(0, k)) return k;
  }
  return 0;
}

// Requirable from Node for tests; `module` is undefined in the browser, so the
// content script simply skips this.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEBUG, INFO, LOG,
    MIN_OVERLAP_CHARS, UTTERANCE_EXPIRY_MS,
    looksLikeCaptionRegion, extractByJsname, extractByPosition, extractTextOnly,
    MEET_ANNOUNCEMENT_RE, isMeetAnnouncement, isSentenceFragment, overlapLength,
  };
}
