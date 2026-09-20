# TICKET-001: Race Condition bei CAPTION_LINE-Verarbeitung im Service Worker

**Typ:** Bug · **Priorität:** Hoch · **Aufwand:** Klein

## Problem

In `background.js:50` ist der Port-Message-Handler eine `async`-Funktion:

```js
port.onMessage.addListener(async (msg) => {
  ...
  const state = await getState();   // ← Read
  ...
  await setState({ lines });        // ← Write
});
```

Chrome serialisiert Listener-Aufrufe **nicht** über `await`-Punkte hinweg. Treffen zwei
`CAPTION_LINE`-Messages kurz hintereinander ein (z. B. zwei Sprecher committen gleichzeitig,
oder ein Commit + ein `replaceLastLine`-Update), können beide Handler denselben alten State
lesen (`getState`) und sich anschließend gegenseitig überschreiben (`setState`) —
**Read-Modify-Write-Race**. Folge: verlorene Transkriptzeilen.

Dasselbe Muster betrifft alle `setState`-Aufrufer (`handleMessage` in `background.js:103 ff.`),
ist aber beim hochfrequenten Caption-Pfad am kritischsten.

## Lösung

Alle State-Mutationen über eine **Promise-Kette (Mutex)** serialisieren:

```js
let stateLock = Promise.resolve();
function withState(fn) {
  const run = stateLock.then(fn, fn);
  // Fehler schlucken, damit die Kette nie abreißt
  stateLock = run.catch(() => {});
  return run;
}
```

- Im `CAPTION_LINE`-Port-Handler den gesamten get→modify→set-Block in `withState(...)` legen.
- In `handleMessage` mindestens die Cases kapseln, die get+set kombinieren
  (`START_CAPTURE`, `STOP_CAPTURE`, `MEETING_INFO`, `CLEAR_TRANSCRIPT`).
- Alternativ: `setState` selbst zu `withState(async () => …)` machen reicht **nicht**,
  weil das Read (`getState`) mit im kritischen Abschnitt liegen muss.

## Akzeptanzkriterien

- [ ] Zwei unmittelbar aufeinanderfolgende `CAPTION_LINE`-Messages (verschiedene Sprecher) führen zu **zwei** Zeilen im State — nachweisbar per Testszenario/Konsole.
- [ ] `replaceLastLine`-Updates gehen bei parallelem Commit eines anderen Sprechers nicht verloren.
- [ ] Keine Verhaltensänderung an der Message-API (content.js/popup.js unverändert).
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `background.js` (Port-Handler ab Zeile 50, `handleMessage` ab Zeile 103)
