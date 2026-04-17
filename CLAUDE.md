# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Extension (Manifest V3) that captures Google Meet live captions and saves them as a timestamped transcript with speaker names. No build step — pure vanilla JS loaded directly by Chrome.

## Loading the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

After any code change, click the reload icon on the extension card in `chrome://extensions`. Content script changes also require refreshing the Meet tab.

## File structure

```
manifest.json         # MV3 manifest — wires all components together
background.js         # Service worker: state management, download trigger
content.js            # Injected into meet.google.com: DOM observer + caption parser
utils/formatter.js    # ES module: formats CaptionLine[] into .txt or .md
popup/
  popup.html          # Extension popup UI
  popup.js            # Popup state machine + background messaging
  popup.css           # Popup styles
icons/                # Required: icon16.png, icon48.png, icon128.png
```

## Architecture

**Data flow:**

```
meet.google.com DOM
  └─ content.js (MutationObserver)
        └─ chrome.runtime.sendMessage CAPTION_LINE
              └─ background.js (service worker)
                    ├─ chrome.storage.session  ← persists across SW sleep cycles
                    └─ Port → popup.js         ← live line count updates
```

**Key design decisions:**

- `chrome.storage.session` (not an in-memory variable) stores the transcript lines because the MV3 service worker is ephemeral and can be terminated mid-meeting.
- The popup opens a long-lived `chrome.runtime.Port` (named `"popup"`) to receive push updates from the background rather than polling.
- `background.js` uses `"type": "module"` in the manifest so it can import `utils/formatter.js` as an ES module.

## Auto-enable CC (Closed Captions)

When the user clicks "Start Capture" and captions are not yet visible, `content.js` automatically tries to enable CC by finding and clicking Meet's CC button. The detection uses a multi-pass strategy:

1. **Keyword match** — checks `aria-label` / `data-tooltip` for caption-related words in EN, DE, FR, IT, ES, PT, NL, PL, RU, JA, ZH, KO
2. **Shortcut hint `(c)`** — language-independent; Meet includes the keyboard shortcut in the label across virtually all locales
3. **`jsname` match** — known `jsname` values for the CC button (`r8qRAd`, `Dg9Wp`)
4. **Toolbar scan** — searches inside `[role="toolbar"]` containers with the same keyword/shortcut matching

If auto-enable fails, the extension polls every 2s and retries once after ~4s (the toolbar may load late). After ~6s the popup shows a warning with manual instructions.

**If auto-enable stops working after a Meet update:** open DevTools, inspect the CC button, and check its `aria-label`, `data-tooltip`, and `jsname`. Update `findCCButton()` in `content.js`.

### False positive protection (`findAriaLiveContainer`)

Meet has multiple `aria-live="polite"` elements (e.g. "Your camera is on"). The caption container is distinguished by:
- Having child elements (speaker blocks) — status messages are flat text
- Having substantial text length (>80 chars) or multiple children

## Google Meet DOM selectors

`content.js` uses a three-layer resilience strategy because Meet uses obfuscated CSS class names that change with deployments:

1. **`jsname` attributes** (primary) — more stable than class names
2. **`aria-live` region** (fallback) — Meet always marks its CC widget as polite
3. **Structural heuristics** (last resort) — infers speaker/text from DOM shape

The current `jsname` values in `SELECTORS` (top of `content.js`):
- `tgaKEf` — caption window container
- `YSxPC` — per-speaker block
- `r4nke` — speaker name span
- `bVV8Bd` — caption text span

**If captions stop working after a Meet update:** enable CC in Meet, open DevTools → Elements, search for the live caption text, and trace up to find the new `jsname` values. Update the `SELECTORS` object in `content.js`.

## Rolling caption deduplication

Google Meet streams captions word-by-word. `content.js` debounces each speaker's text for 700 ms after the last DOM change. A line is committed when:
- The debounce timer fires (speaker paused/finished)
- The speaker's block disappears from the DOM
- The text is not a prefix of what was already committed

## Transcript format

Each `CaptionLine`: `{ speaker: string, text: string, timestamp: number }` (Unix ms).

Output timestamps are relative to `startTime` (when "Start Capture" was clicked), formatted as `HH:MM:SS`.

Two formats available: `.txt` and `.md` — both produced by `utils/formatter.js`.
