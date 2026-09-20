# TICKET-015: „Warte auf Untertitel"-Phase überlebt das Schließen des Popups nicht

**Typ:** Bug/UX · **Priorität:** Mittel · **Aufwand:** Klein

## Problem

Die Warte-Phase existiert **nur im geöffneten Popup**. Sie wird ausschließlich aus der
Antwort auf den Start-Klick abgeleitet (`popup/popup.js:181–204`) und über
Port-Nachrichten aktualisiert (`CC_STATUS`, `CC_FOUND`).

Ein Extension-Popup schließt sich aber, sobald irgendwo ins Meet-Fenster geklickt wird —
also fast immer direkt nach dem Start. Beim erneuten Öffnen läuft `initialize()`:

```js
const state = await sendMessage({ type: 'GET_STATE' });
if (state.isCapturing) renderCapturing(state);
```

`isCapturing` wurde vom Background bereits in `START_CAPTURE` auf `true` gesetzt
(`background.js:169–176`) — **bevor** feststeht, ob Untertitel überhaupt gefunden wurden.
Das Popup zeigt darum „Aufnahme läuft… 0 Zeilen erfasst", obwohl in Wahrheit noch auf
Untertitel gewartet wird. Die Warnung mit der manuellen Anleitung
(`view-waiting` / `cc-warning`) bekommt niemand mehr zu sehen.

Ebenso gehen `CC_STATUS`- und `CC_FOUND`-Broadcasts ins Leere, wenn kein Popup offen ist
(`broadcastToPopup` iteriert eine leere Menge, `background.js:140–148`).

## Lösung

1. **Phase in den State aufnehmen**, statt sie nur im Popup zu halten:
   ```js
   capturePhase: 'idle' | 'waiting_for_captions' | 'capturing'
   ```
   - `START_CAPTURE` setzt sie anhand der Content-Script-Antwort (`status`).
   - `CC_STATUS: 'found'` → `'capturing'`; `'not_found'` → Flag `ccWarning: true`.
2. `GET_STATE` liefert `capturePhase` und `ccWarning` mit; `initialize()` rendert daraus
   die richtige View — auch nach Schließen/Öffnen des Popups und nach einem
   Service-Worker-Neustart.
3. Optional: Badge auf dem Extension-Icon (`chrome.action.setBadgeText`) — „…" beim
   Warten, Zeilenzahl beim Aufnehmen. Dann ist der Zustand ohne Popup sichtbar, was die
   eigentliche Beschwerde („ich weiß nicht, ob es läuft") mit entschärft.

## Akzeptanzkriterien

- [ ] Start ohne aktive Untertitel → Popup schließen → erneut öffnen: Warte-Ansicht wird
      wieder gezeigt, nicht „Aufnahme läuft".
- [ ] Die CC-Warnung mit der manuellen Anleitung erscheint auch, wenn das Popup zum
      Zeitpunkt des `not_found`-Broadcasts geschlossen war.
- [ ] Nach erfolgreicher CC-Erkennung wechselt die Ansicht beim nächsten Öffnen korrekt
      in „Aufnahme läuft".

## Betroffene Dateien

- `background.js` (`defaultState` Z. 25, `START_CAPTURE` Z. 163, `CC_STATUS` Z. 278, `GET_STATE` Z. 251)
- `popup/popup.js` (`initialize` Z. 159, Port-Listener Z. 123)
