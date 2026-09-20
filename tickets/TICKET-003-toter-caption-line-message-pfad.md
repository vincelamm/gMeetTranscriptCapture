# TICKET-003: Toten CAPTION_LINE-Pfad in handleMessage entfernen

**Typ:** Cleanup · **Priorität:** Niedrig · **Aufwand:** Sehr klein

## Problem

`background.js:146–160` behandelt `CAPTION_LINE` auch im `chrome.runtime.onMessage`-Handler
(`handleMessage`). Captions kommen aber ausschließlich über den `content-script`-**Port**
herein (`content.js` → `bgPort.postMessage`, verarbeitet in `background.js:50 ff.`).

Der Message-Pfad ist toter Code — und gefährlich toter Code: Er ignoriert
`msg.replaceLastLine` und würde bei versehentlicher Nutzung Duplikate erzeugen, weil er
immer `lines.push(...)` macht. Zwei divergierende Implementierungen derselben Logik.

## Lösung

- Den `case 'CAPTION_LINE'` aus `handleMessage` ersatzlos entfernen.
- Vorher per Grep sicherstellen, dass kein `chrome.runtime.sendMessage({ type: 'CAPTION_LINE' ...})`
  im Projekt existiert (Stand Review: existiert nicht).
- Optional im gleichen Zug: die Zeilen-Update-Logik des Port-Handlers (inkl.
  `replaceLastLine`-Behandlung) in eine benannte Funktion `appendCaptionLine(state, msg)`
  extrahieren — verbessert Lesbarkeit und Testbarkeit, besonders nach TICKET-001.

## Akzeptanzkriterien

- [ ] `case 'CAPTION_LINE'` existiert nicht mehr in `handleMessage`.
- [ ] Capture funktioniert unverändert (Start → Zeilen zählen hoch → Download).
- [ ] `grep -rn "CAPTION_LINE"` zeigt nur noch Port-Sender (content.js) und Port-Handler (background.js).
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `background.js` (Zeilen 146–160)
