# TICKET-002: Captions gehen verloren, während der Port zum Service Worker getrennt ist

**Typ:** Bug · **Priorität:** Mittel · **Aufwand:** Klein

## Problem

`content.js:598` verwirft Captions stillschweigend, wenn der Port gerade nicht verbunden ist:

```js
function sendCaption(speaker, text, timestamp, replaceLastLine = false) {
  if (bgPort) {
    bgPort.postMessage({ ... });
    ...
  }
  // ← kein else: Zeile ist weg
}
```

Der MV3-Service-Worker kann jederzeit schlafen gelegt werden. Beim Disconnect reconnectet
`openPort()` erst nach 200 ms (`content.js:577–583`). Jede Caption, die in diesem Fenster
committet wird, geht verloren. Zusätzlich kann `postMessage` auf einem gerade sterbenden
Port werfen — das ist aktuell nicht abgefangen.

## Lösung

Eine kleine **Outbox-Queue** in `content.js`:

1. `const outbox = [];` — `sendCaption` pusht die Message immer zuerst in die Outbox.
2. Eine `flushOutbox()`-Funktion sendet alle Einträge der Reihe nach über `bgPort.postMessage`
   und leert die Queue; `postMessage` in try/catch — bei Fehler Port auf `null`, Reconnect
   anstoßen, Einträge bleiben in der Queue.
3. `flushOutbox()` aufrufen: (a) direkt in `sendCaption` nach dem Push, (b) in `openPort()`
   nach erfolgreichem Connect.
4. Obergrenze (z. B. 200 Einträge) gegen unbegrenztes Wachstum, falls die Extension
   dauerhaft nicht erreichbar ist (Kontext invalidiert); bei Überlauf älteste Einträge
   verwerfen und einmalig loggen.
5. Bei `STOP_CAPTURE` (`closePort`) vorher flushen.

Wichtig: Die Reihenfolge der Messages muss erhalten bleiben (FIFO), sonst greift
`replaceLastLine` im Background auf der falschen Zeile.

## Akzeptanzkriterien

- [ ] Simulierter Port-Ausfall (Service Worker in `chrome://serviceworker-internals` stoppen bzw. `bgPort.disconnect()` in DevTools) → währenddessen committete Zeilen erscheinen nach Reconnect vollständig und in korrekter Reihenfolge im Transkript.
- [ ] `postMessage`-Exceptions crashen den Observer-Callback nicht mehr.
- [ ] Queue wächst nicht unbegrenzt (Limit + Log nachweisbar).
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `content.js` (`sendCaption` Zeile 598, `openPort` Zeile 573, `closePort` Zeile 593)
