# TICKET-016: DEBUG-Flag fehlt — Caption-Inhalte landen immer in der Konsole

**Typ:** Privacy/Perf · **Priorität:** Mittel · **Aufwand:** Sehr klein

## Problem

`CLAUDE.md` beschreibt seit dem letzten Stand einen `DEBUG`-Schalter und zwei Logger
(`INFO` immer an, `LOG` nur bei `DEBUG = true`). **Im Code existiert das nicht.**
`content.js:12` hat nur:

```js
const LOG = (...args) => console.log('[MeetTranscript]', ...args);
```

Konsequenzen im Normalbetrieb jedes Nutzers:

- `content.js:751` schreibt **jede committete Caption-Zeile** in die Konsole —
  also den vollständigen Meeting-Inhalt, für jeden einsehbar, der DevTools öffnet.
- `extractByPosition` (Z. 120) loggt bei **jeder DOM-Mutation**, also mehrmals pro Sekunde.
- `logContainerStructure` / `logDiagnostics` / `logCCDiagnostics` dumpen große
  DOM-Strukturen bzw. alle Button-Labels als JSON.

Das ist zugleich ein Performance-Thema (Konsolen-Logging im Hot Path des
MutationObservers) und ein Vertrauens-Thema für eine Transkriptions-Erweiterung.

Vgl. TICKET-006 — dort bereits als Absicht formuliert, im Code aber nicht umgesetzt.

## Lösung

```js
const DEBUG = false;
const INFO = (...a) => console.log('[MeetTranscript]', ...a);
const LOG  = (...a) => { if (DEBUG) console.log('[MeetTranscript]', ...a); };
```

Zuordnung:

- **`INFO`** — einmal-pro-Meeting-Ereignisse: Capture-Start/-Stop, welche Strategy
  angehängt wurde, CC-Button geklickt, Sprachdialog bestätigt, Port geöffnet/geschlossen.
- **`LOG`** — alles im Hot Path: `extractByPosition`-Zähler, `logContainerStructure`,
  `logDiagnostics`, `logCCDiagnostics`, `COMMIT […]` inkl. Caption-Text.

Damit stimmt der Code wieder mit der bereits geschriebenen Doku in `CLAUDE.md` überein.

## Akzeptanzkriterien

- [ ] Mit `DEBUG = false`: keine Caption-Inhalte in der Konsole; maximal eine Handvoll
      Zeilen pro Meeting.
- [ ] Mit `DEBUG = true`: unveränderter Diagnose-Umfang wie heute.
- [ ] `CLAUDE.md` beschreibt den tatsächlichen Code.

## Betroffene Dateien

- `content.js` (Logger Z. 12, Aufrufstellen Z. 120, 184, 189, 198, 202, 205, 213–235, 751, 956–967)
