# TICKET-007: Storage-Schreiblast bei langen Meetings reduzieren

**Typ:** Performance · **Priorität:** Niedrig–Mittel · **Aufwand:** Mittel

## Problem

Bei jeder einzelnen Caption-Zeile schreibt `background.js` das **komplette**
`captureState`-Objekt inklusive aller bisherigen Zeilen neu nach
`chrome.storage.session` (Port-Handler, `background.js:50–70`):

- Pro Zeile: Array kopieren (`[...state.lines]`) + kompletter Serialize/Write.
- Gesamtaufwand über ein Meeting: O(n²) in der Zeilenzahl.
- Ein 2-Stunden-Meeting kann >1000 Zeilen erzeugen; jede spätere Zeile schreibt dann
  jedes Mal das gesamte Transkript (mehrere hundert KB) neu.
- `chrome.storage.session` hat außerdem ein 10-MB-Quota — kein akutes Risiko, aber die
  Schreibfrequenz belastet den Service Worker unnötig.

Durch `replaceLastLine` (Overlap-Merge, seit v1.4.12) kommen zusätzlich häufige
Update-Writes derselben Zeile hinzu.

## Lösung

**Write-Batching mit In-Memory-Puffer im Service Worker:**

1. Zeilen im SW in einer Modulvariablen halten (`let cachedLines`), die beim SW-Start
   lazy aus `chrome.storage.session` geladen wird (SW kann jederzeit neu starten!).
2. Eingehende `CAPTION_LINE`s mutieren nur `cachedLines`.
3. Ein Debounce-Flush (z. B. 2 s nach letzter Änderung, zusätzlich max. alle 10 s)
   persistiert nach `chrome.storage.session`.
4. **Sofort-Flush** vor allen Lesepfaden, die Konsistenz brauchen:
   `STOP_CAPTURE`, `DOWNLOAD_TRANSCRIPT`, `GET_TRANSCRIPT_CONTENT`, `GET_STATE`,
   `CLEAR_TRANSCRIPT`.
5. Achtung Zusammenspiel mit TICKET-001: Der In-Memory-Puffer ersetzt dann das
   Read-Modify-Write auf dem Storage für den Caption-Pfad — das entschärft die Race
   von TICKET-001 teilweise, macht die Serialisierung dort aber nicht überflüssig
   (Laden des Puffers und Flush müssen weiterhin serialisiert sein).
   **Empfehlung: TICKET-001 zuerst umsetzen, dieses Ticket darauf aufbauen.**

Risiko-Abwägung dokumentieren: Wird der SW zwischen zwei Flushes hart beendet, gehen
maximal ~2 s Captions verloren. Das ist akzeptabel; wer das nicht will, kann das
Flush-Intervall auf 500 ms senken — immer noch weit besser als Write-per-Line.

## Akzeptanzkriterien

- [ ] Während laufender Captions erfolgt höchstens ~1 Storage-Write pro 2 s (per Logging/DevTools nachweisbar), unabhängig von der Caption-Frequenz.
- [ ] Download/Copy/Stop liefern immer den vollständigen aktuellen Stand (Sofort-Flush).
- [ ] Nach manuellem SW-Kill (chrome://serviceworker-internals) und Wiederaufwachen gehen höchstens die Captions seit dem letzten Flush verloren; ältere Zeilen sind vollständig.
- [ ] Popup-Zeilenzähler aktualisiert weiterhin live (Broadcast bleibt pro Zeile, nur Storage-Write wird gebatcht).
- [ ] Version in `manifest.json` gebumpt (Minor).

## Betroffene Dateien

- `background.js` (Port-Handler, `getState`/`setState`, alle Cases in `handleMessage`)

## Abhängigkeiten

- Baut auf TICKET-001 (State-Serialisierung) auf.
