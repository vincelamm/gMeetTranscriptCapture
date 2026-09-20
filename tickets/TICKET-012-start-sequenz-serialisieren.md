# TICKET-012: Start-Sequenz serialisieren — Panel-Scraping und CC-Aktivierung kollidieren

**Typ:** Bug · **Priorität:** **Hoch** · **Aufwand:** Klein

## Problem

Im `START_CAPTURE`-Handler (`content.js:1028–1059`) laufen zwei UI-manipulierende
Abläufe **gleichzeitig**:

```js
scrapeMeetingInfoAsync().then(…);   // klickt SOFORT den ℹ-Button (erster await kommt danach)
const match = detectStrategy();
if (!match) {
  const ccResult = tryEnableCC();   // klickt den CC-Button — Panel ist jetzt offen
  startScan();
}
```

Zeitlicher Ablauf bei einem Nutzer ohne aktive Untertitel:

| t | Ereignis |
|---|---|
| 0 ms | ℹ-Klick → Details-Panel öffnet sich |
| ~1 ms | CC-Klick → Meet zeigt ggf. den Sprachauswahl-Dialog **über** dem Panel |
| 450 ms | `scrapeMeetingInfoAsync` sucht das Panel — evtl. vom Dialog verdeckt |
| 500 ms | `dismissCaptionLanguageModal` klickt im Dialog |
| 550 ms | Scrape-Routine klickt „Schließen" bzw. den ℹ-Button — dieser Klick kann vom Modal-Overlay abgefangen werden oder den Dialog unbeabsichtigt schließen |

Ergebnis: mal bleibt das Panel offen, mal wird der Sprachdialog weggeklickt bevor eine
Sprache gewählt ist, mal passiert beides nicht — das erklärt, warum sich das Problem
für manche Nutzende „zufällig" verhält.

## Lösung

Start-Sequenz strikt serialisieren:

1. **Phase 1 — Untertitel:** `detectStrategy()`; wenn kein Treffer → `tryEnableCC()`,
   Sprachdialog-Behandlung **abwarten** (`await dismissCaptionLanguageModal()`),
   dann `startScan()`.
2. **Phase 2 — Meeting-Info:** erst starten, wenn Phase 1 abgeschlossen ist, d. h.
   wenn der Observer hängt (Strategy gefunden) *oder* nach Ablauf des CC-Zweigs.
   Sinnvoller Ort: im `startScan()`-Erfolgsfall bzw. direkt nach `startObserver()`.
3. `sendResponse` weiterhin synchron zurückgeben (Popup soll nicht blockieren) —
   Phase 2 läuft danach fire-and-forget.

Alternativ (noch unauffälliger): Meeting-Info erst beim **Stoppen** der Aufnahme
scrapen. Dann sieht niemand ein aufblitzendes Panel während des Meetings, und die
Teilnehmendenliste ist sogar vollständiger.

## Akzeptanzkriterien

- [ ] Bei ausgeschalteten Untertiteln: CC-Klick und Sprachdialog laufen ohne
      gleichzeitige Panel-Interaktion ab (im DevTools-Log nachvollziehbar).
- [ ] `MEETING_INFO` kommt weiterhin im Background an (Transkript-Header enthält
      Zeitraum/Teilnehmende).
- [ ] Popup wechselt weiterhin unmittelbar in die Warte- bzw. Aufnahme-Ansicht.

## Betroffene Dateien

- `content.js` (`START_CAPTURE`-Handler Z. 1027, `tryEnableCC` Z. 789, `startScan` Z. 974)
