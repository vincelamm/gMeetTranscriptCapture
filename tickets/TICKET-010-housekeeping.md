# TICKET-010: Housekeeping — doppelte Icon-Generatoren & duplizierte Regexe

**Typ:** Cleanup · **Priorität:** Niedrig · **Aufwand:** Klein

## Problem

**1. Zwei Icon-Generatoren im Repo-Root:**
`generate-icons.js` und `generate-icons.py` erzeugen (mutmaßlich) dieselben Icons.
Zwei Implementierungen desselben Einmal-Werkzeugs veralten unabhängig voneinander.

**2. Die „You"-Erkennungs-Regex existiert dreimal in zwei Dateien:**
- `content.js` `YOU_PAREN` (Z. 270): `/\(\s*(you|vous|du|Sie|tú|tu|ty)\s*\)/i`
- `content.js` `YOU_RE` in `extractParticipantsFromPeoplePanel` (Z. 527): gleiches Muster
- `content.js` Speaker-Check in `commitLine` (~Z. 745): `/^(you|vous|du|tú|tu|ty|вы|あなた)$/i`
- `utils/formatter.js` (Z. 46 und Z. 58): `/^(you|vous|du|tú|tu|ty|вы|あなた)$/i`

Die Varianten sind bereits **divergiert** (mal mit `Sie`/`вы`/`あなた`, mal ohne) — genau
das Risiko duplizierter Konstanten. Eine Meet-Lokalisierungsänderung müsste an 5 Stellen
nachgezogen werden.

## Lösung

**Icon-Generatoren:** Einen der beiden löschen (empfohlen: den behalten, der zuletzt
benutzt wurde / dessen Output den aktuellen `icons/`-Dateien entspricht — per
Git-Log prüfen). Im verbleibenden Skript einen Kommentar ergänzen, wie es aufgerufen wird.

**Regexe:**
- Innerhalb von `content.js`: eine Datei-Konstante `YOU_WORDS` (Wortliste) definieren und
  daraus die beiden Formen ableiten:
  ```js
  const YOU_WORDS = 'you|vous|du|Sie|tú|tu|ty|вы|あなた';
  const YOU_EXACT_RE = new RegExp(`^(${YOU_WORDS})$`, 'i');
  const YOU_PAREN_RE = new RegExp(`\\(\\s*(${YOU_WORDS})\\s*\\)`, 'i');
  ```
  Alle drei Nutzungsstellen darauf umstellen.
- `utils/formatter.js` ebenso auf eine lokale Konstante konsolidieren (beide Stellen).
- Hinweis: content.js ist **kein** ES-Modul (MV3-Content-Scripts) — ein Shared-Import
  zwischen content.js und formatter.js ist ohne Build-Schritt nicht möglich. Die
  Duplikation zwischen den beiden **Dateien** bleibt bewusst bestehen; je ein
  Kommentar an beiden Konstanten soll auf die jeweils andere Stelle verweisen
  („muss synchron gehalten werden mit …").
- Beim Konsolidieren die Wortlisten **vereinigen** (Superset), damit keine Erkennung
  verloren geht. Achtung bei `YOU_EXACT`: `Sie` ist als exakter Speaker-Name riskant
  (könnte theoretisch kollidieren), war aber bisher nur in der Klammer-Variante —
  Verhalten beibehalten: `Sie` nur in `YOU_PAREN_RE` aufnehmen.

## Akzeptanzkriterien

- [ ] Nur noch ein Icon-Generator im Repo; ein Kommentar erklärt den Aufruf.
- [ ] `content.js`: eine Wortlisten-Konstante, keine hartcodierten You-Regexe mehr an den Nutzungsstellen.
- [ ] `utils/formatter.js`: eine Konstante für beide Stellen; Querverweis-Kommentare in beiden Dateien.
- [ ] Verhalten unverändert: „You"/„Du" wird weiterhin zum localUser aufgelöst (Stichprobe mit Test-Transkript).
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `generate-icons.js` **oder** `generate-icons.py` (einer wird gelöscht)
- `content.js` (Z. 270, 527, ~745)
- `utils/formatter.js` (Z. 46, 58)
