# Meet Transcript Capture

A Chrome extension that captures Google Meet live captions and saves them as a timestamped transcript with speaker names.

![Extension icon](icons/icon128.png)

## Features

- **Automatically enables captions** (CC) when you start capture — no need to remember to turn them on manually
- Captures live captions from Google Meet in real time
- Records speaker names alongside each line
- Handles Google Meet's rolling/revised captions — no duplicate lines
- Download the transcript as **plain text** (`.txt`) or **Markdown** (`.md`)
- Transcript is stored for the browser session, so you can download after the meeting ends
- Works across Meet language settings (EN, DE, FR, IT, ES, PT, NL, PL, RU, JA, ZH, KO)

**Example output:**

```
Meeting: Weekly Sync
Date: 2026-03-20
Duration: 00:47:12
──────────────────────────────────────────────────
[00:00:12] Alice
Hello everyone, just wanted to say the Q1 results look really strong.

[00:00:34] Bob
Agreed. The pipeline numbers especially exceeded forecast.
──────────────────────────────────────────────────
End of transcript
```

## Installation

This extension is not on the Chrome Web Store. Install it directly from the source:

### 1. Download the extension

Clone the repository or download the ZIP:

```bash
git clone https://github.com/vincelamm/gMeetTranscriptCapture.git
```

Or click **Code → Download ZIP** on GitHub and unzip it.

### 2. Open Chrome Extensions

Go to `chrome://extensions` in your browser.

### 3. Enable Developer mode

Toggle **Developer mode** on in the top-right corner.

### 4. Load the extension

Click **Load unpacked** and select the folder you cloned or unzipped.

The extension icon will appear in your Chrome toolbar. Pin it for easy access by clicking the puzzle piece icon and pinning **Meet Transcript Capture**.

## Privacy & consent — please read before use

> **You are responsible for informing all meeting participants that the conversation is being transcribed.**

Recording or transcribing a conversation without the knowledge of the other participants may be **illegal** in your jurisdiction. Many countries and US states require the consent of all parties to a conversation before it may be recorded (e.g. California's two-party consent law, the EU's GDPR, Germany's §201 StGB). Even where it is not legally required, transcribing without disclosure is generally considered poor practice and a breach of trust.

**Before you start capturing, you must:**

1. Announce at the start of the meeting — verbally or in the chat — that you are creating a transcript, for example:
   > *"Just a heads-up: I'm using a transcript tool to capture the notes from this call. Let me know if anyone objects."*
2. Give participants a reasonable opportunity to object or leave before you click **Start Capture**.
3. Handle the resulting transcript with care — treat it as you would any other record of a private conversation.

This tool reads Google Meet's own live captions and does not access your microphone or audio stream directly. That does not change your obligations toward other participants.

---

## Usage

1. Join a Google Meet call
2. **Inform all participants** that you will be capturing a transcript (see above)
3. Click the **Meet Transcript Capture** icon in your toolbar
4. Click **Start Capture** — captions will be enabled automatically if they aren't already
5. Talk — the extension captures every line with the speaker's name
6. When done, click **Stop Capture**
7. Click **Download .txt** or **Download .md** to save the transcript

> If auto-enable doesn't work (e.g. after a Meet UI update), the extension will show instructions to enable captions manually via the CC button or by pressing `c`.

> The transcript is kept in memory for the browser session. If you close the browser before downloading, the transcript is lost.

## Updating

After pulling new changes from the repository, go to `chrome://extensions` and click the **reload icon** on the extension card. Then refresh any open Meet tabs.

## Notes on accuracy

- The extension reads Meet's CC widget, not the audio — captions are auto-enabled on capture start, but if that fails you'll need to enable them manually
- Google Meet's speech recognition may revise words after they're spoken; the extension handles this by updating lines in place rather than creating duplicates
- Speaker names come directly from Meet's caption display and match what Meet shows on screen
- The extension uses `jsname` attributes in Meet's DOM to find the captions widget. If Google updates their frontend and captions stop being captured, see [`CLAUDE.md`](CLAUDE.md) for how to update the selectors

## Permissions

| Permission | Why |
|---|---|
| `meet.google.com` | Read the captions from the Meet tab |
| `storage` | Keep the transcript in memory during the session |
| `downloads` | Save the transcript file to your Downloads folder |

## License

[MIT](LICENSE)
