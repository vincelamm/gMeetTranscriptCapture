# TICKET-017: CC-Button-Suche trifft die Untertitel-Einstellung statt des Umschalters

**Typ:** Bug · **Priorität:** **Hoch** · **Aufwand:** Klein · **Status:** ✅ behoben in v1.4.13

## Problem

Die eigentliche Ursache der Nutzendenmeldung *„beim Starten poppt ein Dialog auf"*.
Belegt durch Screenshot eines Nutzers (v1.4.11): Meets **Einstellungen → Untertitel**
öffnet sich beim Klick auf „Start Capture", das Popup zeigt gleichzeitig
„Capturing… 0 lines captured" bei 00:00:06.

### Kette

1. Der Nutzer hatte CC **vorher manuell aktiviert**. Es hatte aber noch niemand
   gesprochen — und Meet rendert den Caption-Container erst mit dem ersten Text.
   `detectStrategy()` findet daher nichts.
2. Die Erweiterung schließt daraus fälschlich „CC ist aus" und ruft `tryEnableCC()`.
   `aria-pressed` war nicht gesetzt, die `isAlreadyOn`-Prüfung griff nicht.
3. `findCCButton()` Pass 1 (v1.4.11) war der Keyword-Pass **ohne Ausschlussfilter**:

   ```js
   if (keywordPattern.test(ariaLabel) || keywordPattern.test(tooltip)) return el;
   ```

   Der erste Button in DOM-Reihenfolge mit „untertitel" im Label gewinnt — in
   lokalisierten UIs ist das die Untertitel-**Einstellung**, nicht der Umschalter.
   Klick → Einstellungen-Dialog.
4. v1.4.11 hatte keinerlei Dialog-Behandlung, der Dialog blieb offen stehen.
5. Der Poll-Scan akzeptierte anschließend eine `aria-live`-Region **innerhalb des
   offenen Dialogs** als Caption-Container (Strategy C/E/F prüfen den Kontext nicht),
   meldete `CC_STATUS: 'found'` → Popup wechselte auf „Capturing", aufgezeichnet
   wurde nichts.

## Lösung (umgesetzt)

`content.js`:

1. **`isCaptionToggle(el)`** — Filter für *alle* vier Pässe von `findCCButton()`:
   verwirft Labels mit `settings|einstellung|optionen|language|sprache|…|more|weitere`
   sowie alles innerhalb eines `[role="dialog"]`. Reihenfolge zusätzlich umgedreht:
   der Tastenkürzel-Pass `(c)` läuft zuerst, da Einstellungseinträge kein Kürzel haben.
2. **`isCCButtonOn(btn)`** — prüft `aria-pressed` und, falls nicht gesetzt, das
   Verb im Label („Turn off captions" / „Untertitel deaktivieren" ⇒ CC ist an).
   Ist CC an, wird **nicht geklickt** — vorher schaltete die Erweiterung in genau
   diesem Fall die Untertitel wieder **aus**.
3. **`isInDialog()`** in `detectStrategy()` und `findAriaLiveContainer()` —
   kein Caption-Container wird je aus einem offenen Dialog heraus akzeptiert.
4. **`startScan(ccKnownOn)`** — meldet `not_found` erst nach ~40 s statt nach 6 s,
   wenn der CC-Umschalter sich selbst als „an" meldet. Stille ist dann die
   erwartete Erklärung für fehlende Untertitel, keine Fehlfunktion.
5. Dialog-Behandlung siehe [TICKET-013](TICKET-013-sprachdialog-blindklick.md).

## Akzeptanzkriterien

- [x] Kein Klick auf Einstellungs-/Options-Controls in allen vier Pässen.
- [x] Bei bereits aktivem CC wird der Umschalter nicht mehr geklickt.
- [x] Container innerhalb eines Dialogs werden nie als CC-Widget akzeptiert.
- [ ] **Manuell im echten Meeting zu verifizieren:** CC vorher aktivieren, dann
      Aufnahme starten → kein Dialog, Untertitel bleiben an, Zeilen laufen ein,
      sobald jemand spricht.
- [ ] Gegenprobe: CC aus, Aufnahme starten → CC wird aktiviert, kein Dialog bleibt stehen.

## Betroffene Dateien

- `content.js` (`findCCButton`, `isCaptionToggle`, `labelOf`, `isCCButtonOn`, `tryEnableCC`, `isInDialog`, `detectStrategy`, `findAriaLiveContainer`, `startScan`)
- `CLAUDE.md` (Abschnitt „Auto-enable CC")
