# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Chrome Extension (Manifest V3) that captures Google Meet live captions and saves them as a timestamped transcript with speaker names. No build step — pure vanilla JS loaded directly by Chrome.

## Releasing

`.github/workflows/release.yml` watches `manifest.json` on `main`. When the version there changes, it syntax-checks the sources, packages the extension and creates the tag **and** the GitHub Release.

The release, not the tag, is what matters: `popup.js` polls `GET /repos/{repo}/releases/latest` for its update notice, so a tag on its own never reaches users. That is how v1.4.12–v1.4.16 stayed invisible to everyone running the extension.

- Bump `manifest.json` in the same commit/PR as the change — that bump *is* the release trigger.
- Re-running is safe: an existing tag makes the job skip.
- `workflow_dispatch` allows a manual re-run after a failed release.
- The zip contains only what Chrome loads — no `tickets/`, `CLAUDE.md`, workflows or `generate-icons.py`.

## Loading the extension

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this directory

After any code change, click the reload icon on the extension card in `chrome://extensions`. Content script changes also require refreshing the Meet tab.

## File structure

```
manifest.json         # MV3 manifest — wires all components together
background.js         # Service worker: state management, download trigger
content.js            # Injected into meet.google.com: DOM observer + caption parser + meeting info scraper
utils/formatter.js    # ES module: formats CaptionLine[] into .txt, .md, or AI prompt
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
        ├─ Port message CAPTION_LINE
        │     └─ background.js (service worker)
        │           ├─ chrome.storage.session  ← persists across SW sleep cycles
        │           └─ Port → popup.js         ← live line count updates
        └─ sendMessage MEETING_INFO  (fire-and-forget, ~500ms after START_CAPTURE)
              └─ background.js → setState({ meetingInfo })
```

**Session state shape (`chrome.storage.session → captureState`):**

```js
{
  isCapturing: boolean,
  capturePhase: 'idle' | 'waiting_for_captions' | 'capturing',
  ccWarning: boolean,         // captions not detected — popup shows manual steps
  ccAction: 'clicked' | 'already_on' | 'not_found' | null,
  meetingTitle: string,       // from tab title
  meetingInfo: {              // from DOM scraping, null if unavailable
    scheduledTime?: string,   // "Sat, Jul 18, 2026 9:00 AM – 10:00 AM"
    organizer?: string,
    localUser?: string,       // the person running the extension (= "you")
    participants?: string[],
    description?: string,
    meetUrl?: string,
    dialIn?: string,
  } | null,
  lines: CaptionLine[],
  startTime: number | null,   // Unix ms when capture started
  tabId: number | null,
}
```

**Key design decisions:**

- `chrome.storage.session` (not an in-memory variable) stores the transcript lines because the MV3 service worker is ephemeral and can be terminated mid-meeting.
- The popup opens a long-lived `chrome.runtime.Port` (named `"popup"`) to receive push updates from the background rather than polling.
- `background.js` uses `"type": "module"` in the manifest so it can import `utils/formatter.js` as an ES module.
- Meeting info is scraped **after** the CC handling finishes and only while no Meet dialog is open (`scheduleMeetingInfoScrape`). Running it concurrently with the CC click made the two click sequences interfere.
- `capturePhase` lives in the persisted state, not in the popup. The popup closes on the first click into the Meet page, so `isCapturing` alone cannot tell "waiting for captions" from "recording" on reopen.

## Observer health check

A `MutationObserver` is bound to one node. When Meet tears the caption region down and rebuilds it (CC toggled, presentation started, layout change, breakout room), the observed node is detached and **the callback never fires again** — re-acquiring the container inside the callback cannot help, because the callback is what stopped running. Capture then silently records nothing.

`checkObserverHealth()` runs every 5s while capturing:

1. `observedContainer.isConnected === false` → re-detect and re-attach, or fall back to `startScan()` and send `CC_STATUS: 'lost'`.
2. Attached for > 60s with zero lines → re-run `detectStrategy()`; switch if it now yields a *different* container (catches Strategy E/F latching onto the wrong element).

The popup shows a hint after 2 minutes of recording with 0 lines, and the toolbar badge turns amber in the same situation.

## Auto-enable CC (Closed Captions)

When the user clicks "Start Capture" and captions are not yet visible, `content.js` automatically tries to enable CC by finding and clicking Meet's CC button. The detection uses a multi-pass strategy:

1. **Keyword match** — checks `aria-label` / `data-tooltip` for caption-related words in EN, DE, FR, IT, ES, PT, NL, PL, RU, JA, ZH, KO
2. **Shortcut hint `(c)`** — language-independent; Meet includes the keyboard shortcut in the label across virtually all locales
3. **`jsname` match** — known `jsname` values for the CC button (`r8qRAd`, `Dg9Wp`)
4. **Toolbar scan** — searches inside `[role="toolbar"]` containers with the same keyword/shortcut matching

**Every pass is filtered through `isCaptionToggle()`**, which rejects elements whose label looks like a settings/options/language control and anything inside a `[role="dialog"]`. Without that filter the *caption settings* entry wins the keyword pass in localized UIs (it also contains "Untertitel"/"captions"), and clicking it opens Meet's **Settings → Captions** dialog instead of enabling captions. That was the cause of the "a window pops up when I start capture" reports up to v1.4.12.

**Before clicking, `isCCButtonOn()` checks whether captions are already on** (`aria-pressed`, else a "turn off / deaktivieren" verb in the label). This matters because a missing caption container does *not* mean captions are off — Meet only renders the container once someone has spoken. Clicking blindly would switch captions **off** for users who enabled CC themselves before starting the capture.

If Meet responds to the click by opening Settings → Captions (users without a stored caption language), `handleCaptionSettingsDialog()` selects the "automatic captions" radio and closes the dialog. That dialog has **no confirm button** — Meet applies changes immediately. Never click an unidentified button in it: the only text button is "Reset", which would wipe the user's caption preferences.

If auto-enable fails, the extension polls every 2s. The popup shows manual instructions after ~6s — or after ~40s when the CC toggle reported itself as already on, since silence is then the expected reason for having no captions yet.

**If auto-enable stops working after a Meet update:** open DevTools, inspect the CC button, and check its `aria-label`, `data-tooltip`, and `jsname`. Update `findCCButton()` in `content.js`.

### False positive protection

Meet's **status announcements share the aria-live mechanism with the captions**, so the fallback strategies cannot tell them apart by the attribute alone. Real transcripts captured nothing but announcements:

```
Meeting details panel is open
People panel is open
Someone wants to join this call. Use "People" to admit or deny.
<Name> (outside <Org>) joined
```

Worse than the noise itself: a matched announcement region makes `detectStrategy()` report success, so **CC auto-enable is skipped entirely** — the extension believes captions are already running.

Three layers guard against this:

1. **`looksLikeCaptionRegion()`** gates strategies E and F. Accepts a region only if it (or an ancestor) is labelled as captions, or it has caption *structure*: a child block with at least two text-bearing children (speaker label + text). Announcements are a single flat string. Strategy F previously accepted a lone aria-live element unconditionally — that is what produced the transcripts above.
2. **`isMeetAnnouncement()`** blocklists known announcement phrasings, applied only to strings under 120 chars so a long utterance containing such a phrase is never dropped.
3. **`isInDialog()`** rejects anything inside `[role="dialog"]`.

A blocklist alone cannot win this — the phrasings are open-ended — so layer 1 is the load-bearing one.

### Capture suppression while operating Meet's UI

The extension clicks Meet's own controls (CC button, details panel, settings dialog), and Meet answers each click with an aria-live announcement. `suppressCaptureFor(ms)` sets a short deadline during which `processCaptionUpdate()` and the polling scan ignore everything. It is a deadline rather than a flag on purpose: real speech during the window would be lost, so it must stay short (1.5–2.5s per interaction).

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

### Debug logging

`content.js` has a `DEBUG` constant at the top (default `false`). Two loggers:

- `INFO(...)` — always on; only once-per-meeting lifecycle events (capture start/stop, strategy attached, CC button clicked, language modal auto-confirmed).
- `LOG(...)` — verbose, silenced unless `DEBUG = true`. Covers the hot path: per-mutation strategy scans, DOM-structure dumps, and every committed caption line (which contains meeting content).

To diagnose caption/DOM issues, set `DEBUG = true`, reload the extension **and** the Meet tab, then filter the DevTools console by `[MeetTranscript]`. Leave it `false` for normal use so caption contents aren't written to the console on every DOM mutation.

## Meeting info scraping (`scrapeMeetingInfoAsync`)

When capture starts, `content.js` automatically:

1. Checks if the Meeting details panel is already open (`findMeetingDetailsPanel`)
2. If not, finds the ℹ button by its `aria-label` / `data-tooltip` and clicks it
3. Waits 450 ms for the panel to render
4. Extracts structured fields (`extractFromDetailsPanel`):
   - **Scheduled time** — matched via regex against English/German date patterns
   - **Meet URL** — `https://meet.google.com/xxx-xxxx-xxx` pattern
   - **Dial-in number** — `(CC) +xx ...` pattern
   - **Organizer** — `Name – Organizer` pattern in the guest list
   - **Guests/Participants** — from the Guests section in the panel
   - **Description** — from the Description/Agenda section
5. Detects the **local user** (`localUser`) via:
   - `data-self-name` attribute on the user's own video tile (works without any panel open)
   - `(you)` marker in the People panel or Meeting details guest list
6. Closes the panel again to restore the user's UI state

**If the panel structure changes after a Meet update:** enable the panel manually, open DevTools → Elements, and check what heading text / `aria-label` / DOM structure the panel uses. Update `findMeetingDetailsPanel()` and `extractFromDetailsPanel()` in `content.js`.

## Rolling caption deduplication

Google Meet streams captions word-by-word. `content.js` debounces each speaker's text for 800 ms after the last DOM change. A line is committed when:
- The debounce timer fires (speaker paused/finished)
- The speaker's block disappears from the DOM
- The text is not a prefix of what was already committed

**Accumulation guard:** Meet sometimes accumulates multiple utterances in one growing DOM element. `commitLine()` tracks `lineStartLen` per speaker and slices already-committed text before sending. A prefix-match check ensures the slice is only applied when the DOM text genuinely starts with the previously committed content — preventing the first characters of a new utterance from being silently dropped.

## Transcript format

Each `CaptionLine`: `{ speaker: string, text: string, timestamp: number }` (Unix ms).

Output timestamps are relative to `startTime` (when "Start Capture" was clicked), formatted as `HH:MM:SS`. The header shows the actual wall-clock start time as `YYYY-MM-DD HH:MM` (local time).

Three formats, all produced by `utils/formatter.js`:
- `.txt` — plain text with divider lines
- `.md` — Markdown with bold speaker names
- **AI prompt** — wraps the transcript in a structured German prompt for generating meeting minutes (Protokoll); includes a `localUser` authorship note if the user was identified
