# Meet Transcript Capture

A Chrome extension that captures Google Meet live captions and saves them as a timestamped transcript with speaker names.

![Extension icon](icons/icon128.png)

## Features

- Captures live captions (CC) from Google Meet in real time
- Records speaker names alongside each line
- Handles Google Meet's rolling/revised captions — no duplicate lines
- Download the transcript as **plain text** (`.txt`) or **Markdown** (`.md`)
- Transcript is stored for the browser session, so you can download after the meeting ends

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
git clone https://github.com/your-username/gMeetTranscriptCaptureChromePlugin.git
```

Or click **Code → Download ZIP** on GitHub and unzip it.

### 2. Open Chrome Extensions

Go to `chrome://extensions` in your browser.

### 3. Enable Developer mode

Toggle **Developer mode** on in the top-right corner.

![Developer mode toggle](https://developer.chrome.com/static/docs/extensions/get-started/tutorial/hello-world/image/extensions-page-e0d64d89375b.png)

### 4. Load the extension

Click **Load unpacked** and select the folder you cloned or unzipped.

The extension icon will appear in your Chrome toolbar. Pin it for easy access by clicking the puzzle piece icon and pinning **Meet Transcript Capture**.

## Usage

1. Join a Google Meet call
2. Enable captions using the **CC button** at the bottom of the Meet window
3. Click the **Meet Transcript Capture** icon in your toolbar
4. Click **Start Capture**
5. Talk — the extension captures every line with the speaker's name
6. When done, click **Stop Capture**
7. Click **Download .txt** or **Download .md** to save the transcript

> The transcript is kept in memory for the browser session. If you close the browser before downloading, the transcript is lost.

## Updating

After pulling new changes from the repository, go to `chrome://extensions` and click the **reload icon** on the extension card. Then refresh any open Meet tabs.

## Notes on accuracy

- Captions must be enabled in Meet — the extension reads the CC widget, not the audio
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
