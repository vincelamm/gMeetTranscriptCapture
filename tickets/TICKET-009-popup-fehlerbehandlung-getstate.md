# TICKET-009: Popup robust gegen fehlerhafte GET_STATE-Antworten machen

**Typ:** Bug · **Priorität:** Niedrig · **Aufwand:** Sehr klein

## Problem

`popup/popup.js:147–162` (`initialize`) geht davon aus, dass `GET_STATE` immer ein
gültiges State-Objekt liefert:

```js
const state = await sendMessage({ type: 'GET_STATE' });
if (state.isCapturing) { ... }
```

Fehlerfälle, die real auftreten:
- Der Background-Handler antwortet `{ error: ... }` (Fehlerzweig in `background.js:96–99`).
- `chrome.runtime.sendMessage` rejected (Service Worker gerade im Neustart) →
  unhandled rejection, das Popup bleibt leer/hängend, da `initialize` abbricht.
- `state` ist `undefined`, wenn kein Listener antwortet.

Gleiches Muster in den Button-Handlern (`btnStop`, `btnCancelWait`, `btnClear`), die das
Ergebnis eines zweiten `GET_STATE` ungeprüft an `renderIdle` geben.

## Lösung

1. `sendMessage` defensiv machen:
   ```js
   async function sendMessage(msg) {
     try {
       return await chrome.runtime.sendMessage(msg) ?? {};
     } catch {
       return {};
     }
   }
   ```
2. In `initialize`: bei `state.error` oder fehlendem `isCapturing`-Feld auf einen
   sinnvollen Default zurückfallen (`renderIdle({ lineCount: 0 })`) statt zu crashen.
3. `renderIdle` tolerant gegen `lineCount === undefined` machen (`state.lineCount > 0`
   ist bereits safe — nur sicherstellen, dass kein `undefined` in den UI-Text läuft).

## Akzeptanzkriterien

- [ ] Popup öffnen, während der Service Worker gestoppt ist (chrome://serviceworker-internals) → Popup rendert Idle-View statt leer zu bleiben; keine unhandled rejection in der Popup-Konsole.
- [ ] Keine „undefined" in sichtbaren UI-Texten in Fehlerfällen.
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `popup/popup.js` (`sendMessage` Z. 105, `initialize` Z. 147, `renderIdle` Z. 54, Button-Handler Z. 192–203, 236–240)
