# TICKET-006: Konsolen-Logging im Meeting drosseln (Debug-Flag)

**Typ:** Performance/Hygiene · **Priorität:** Mittel · **Aufwand:** Klein

## Problem

`content.js` loggt im heißen Pfad bei **jeder DOM-Mutation** des Caption-Containers:

- `extractByPosition` loggt jedes Mal `'extractByPosition found: N speakers'` (`content.js:120`)
  und bei 0 Treffern zusätzlich die komplette Container-Struktur (`logContainerStructure`).
- Der MutationObserver feuert bei laufenden Captions mehrmals pro Sekunde → hunderte
  Log-Zeilen pro Minute in der Konsole des Meet-Tabs.

Das kostet Performance (String-Serialisierung von DOM-Text bei jeder Mutation, auch wenn
DevTools zu sind), macht die Konsole für echtes Debugging unbrauchbar und schreibt
laufend Meeting-**Inhalte** (Caption-Text) in die Konsole — unnötige Datenexposition.

## Lösung

1. Debug-Flag am Dateianfang von `content.js`:
   ```js
   const DEBUG = false; // für Diagnose auf true setzen
   const LOG = (...args) => { if (DEBUG) console.log('[MeetTranscript]', ...args); };
   ```
2. **Wichtige Einmal-Ereignisse** weiterhin immer loggen (eigenes `INFO = (...a) => console.log(...)`):
   Strategie gefunden, Capture gestartet/gestoppt, CC-Button geklickt, Fehlerfälle.
   Kriterium: alles, was pro Meeting O(1)-mal vorkommt → `INFO`; alles im
   Mutation-/Commit-Pfad → `LOG` (nur bei DEBUG).
3. `logContainerStructure`/`logDiagnostics` nur unter DEBUG bzw. beim erstmaligen
   Strategie-Scan aufrufen, nicht wiederholt im Observer-Callback.
4. Den Hinweis in den Datei-Kommentaren (`content.js:4–6`) und in `CLAUDE.md`
   (Abschnitte zu Debugging) aktualisieren: „`DEBUG = true` setzen, dann Konsole filtern".

## Akzeptanzkriterien

- [ ] Mit `DEBUG = false` (Default) erscheinen während eines laufenden Meetings keine per-Mutation-Logs mehr; nur Einmal-Ereignisse.
- [ ] Mit `DEBUG = true` ist das bisherige Diagnose-Verhalten vollständig verfügbar.
- [ ] Caption-Texte landen mit Default-Einstellung nicht mehr in der Konsole.
- [ ] `CLAUDE.md` Debugging-Hinweise angepasst.
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `content.js` (LOG-Definition Zeile 12, `extractByPosition` Zeile 120–124, `logContainerStructure`, `logDiagnostics`, Observer-Callback)
- `CLAUDE.md` (Debugging-Abschnitte)
