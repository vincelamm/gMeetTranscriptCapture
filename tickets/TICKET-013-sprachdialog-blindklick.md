# TICKET-013: Sprachauswahl-Dialog — Blindklick auf „letzten Button" absichern

**Typ:** Bug · **Priorität:** **Hoch** · **Aufwand:** Klein

## Problem

`dismissCaptionLanguageModal` (`content.js:818–833`) klickt in einem erkannten Dialog
einen Button, den `findDialogConfirmButton` (`content.js:851–867`) auswählt. Drei
Schwachstellen:

**1. Zu breite Dialog-Erkennung.** `findCaptionLanguageDialog` akzeptiert *jeden*
`[role="dialog"]`, dessen erste 400 Zeichen irgendwo `language|sprache|caption|…`
enthalten. Meet-Dialoge wie „Einstellungen" oder ein Feedback-Dialog enthalten das Wort
„Sprache" ebenfalls.

**2. Blindklick-Fallback.** Findet sich kein explizit bestätigend beschrifteter Button,
wird der **letzte nicht-abbrechende Button** geklickt:

```js
return candidates[candidates.length - 1] || null;
```

In einem falsch erkannten Dialog kann das ein beliebiger Button sein — z. B.
„Meeting verlassen", „Für alle beenden" oder „Aufzeichnung starten". Das ist der
riskanteste Klick im gesamten Code.

**3. Deaktivierte Buttons werden geklickt.** In Meets Sprachauswahl ist „Übernehmen"
erst aktiv, wenn eine Sprache gewählt wurde. `findDialogConfirmButton` prüft weder
`disabled` noch `aria-disabled`. Der Klick verpufft, nach 3 Versuchen (≈ 1,5 s) gibt die
Routine auf — **der Dialog bleibt offen stehen** und blockiert die Untertitel.
Genau dieses Symptom passt zur Nutzermeldung „es öffnet sich ein Popup".

## Lösung

1. **Dialog-Erkennung verschärfen:** Treffer nur, wenn der Dialog sowohl einen
   Untertitel-Begriff (`caption|untertitel|subtitle|…`) **als auch** einen
   Sprach-Begriff enthält — oder eine Sprachliste/`<select>`/Radiogruppe besitzt.
   Dialoge mit destruktiven Labels (`verlassen|leave|beenden|end call|entfernen|remove`)
   grundsätzlich ausschließen.
2. **Fallback entfernen.** Nur explizit bestätigend beschriftete Buttons klicken.
   Kein Treffer ⇒ nicht klicken, stattdessen `CC_STATUS: 'language_modal'` an den
   Background senden und im Popup anzeigen: *„Meet fragt nach der Untertitelsprache —
   bitte im Meeting bestätigen. Die Aufnahme startet danach automatisch."*
3. **Disabled-Check:** `btn.disabled === true` oder `aria-disabled="true"` ⇒ überspringen.
   Ist der Bestätigen-Button deaktiviert, vorher die erste auswählbare Sprachoption
   klicken (Radio/Listitem), erneut prüfen, dann bestätigen.
4. **Zeitfenster verlängern:** 3 × 500 ms ist zu knapp. Bis ~5 s in 300-ms-Schritten
   pollen — der Dialog erscheint bei langsamer Verbindung deutlich später.

## Akzeptanzkriterien

- [ ] Mit einem frischen Google-Profil (keine gespeicherte Untertitelsprache):
      Start → Sprachdialog wird korrekt bestätigt, Untertitel erscheinen.
- [ ] Kein Klick, wenn kein eindeutiger Bestätigen-Button existiert; das Popup zeigt
      stattdessen die manuelle Anweisung.
- [ ] Ein offener Meet-Einstellungsdialog wird **nicht** als Sprachdialog erkannt
      (manuell verifizierbar: Einstellungen öffnen, dann Aufnahme starten).
- [ ] Deaktivierte Buttons werden nie geklickt.

## Betroffene Dateien

- `content.js` (`dismissCaptionLanguageModal` Z. 818, `findCaptionLanguageDialog` Z. 836, `findDialogConfirmButton` Z. 851)
- `popup/popup.html`, `popup/popup.js` (neuer Status-Text)
- `background.js` (`CC_STATUS`-Weiterleitung Z. 278)
