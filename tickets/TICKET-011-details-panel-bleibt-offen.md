# TICKET-011: Meeting-Details-Panel öffnet sich sichtbar und bleibt teilweise offen

**Typ:** Bug/UX · **Priorität:** **Hoch** · **Aufwand:** Klein

## Problem

Das ist mit hoher Wahrscheinlichkeit das „Popup-Fenster", das Nutzende beim Start melden.

`content.js:316–365` (`scrapeMeetingInfoAsync`) klickt beim Start der Aufnahme den
ℹ-Button in Meet, öffnet damit sichtbar das Seitenpanel „Besprechungsdetails",
wartet 450 ms und schließt es wieder. Das Panel blinkt also bei jedem Start auf,
verschiebt das Video-Layout und zieht den Fokus.

Schlimmer: **das Schließen kann ausfallen.**

```js
if (!panel) {
  const infoBtn = findMeetingInfoButton();
  if (infoBtn) {
    infoBtn.click();
    panelWasOpened = true;
    await sleep(450);
    panel = findMeetingDetailsPanel();   // ← kann null bleiben
  }
}
...
if (panelWasOpened && panel) {           // ← null ⇒ Close-Zweig wird übersprungen
```

`findMeetingDetailsPanel()` (`content.js:389–403`) erkennt die Überschrift nur in
EN/DE/FR/ES. Sobald

- das Panel länger als 450 ms zum Rendern braucht (langsamer Rechner, großes Meeting), **oder**
- die Locale nicht abgedeckt ist (IT, PT, NL, PL, …) — der ℹ-Button wird über
  `/detalles/i` u. a. teils trotzdem gefunden,

wird `panel` zu `null` und das Panel **bleibt dauerhaft offen stehen**. Aus Sicht der
Nutzenden: „Ich starte die Aufnahme und es geht ein Fenster auf, das nicht mehr weggeht."

Zusätzlich ist der Fallback zum Schließen ein Toggle:

```js
const closeBtn = panel.querySelector('[aria-label*="Close" i], …') || findMeetingInfoButton();
```

Hat der Nutzer das Panel in der Zwischenzeit selbst geschlossen, **öffnet** dieser Klick
es wieder.

## Lösung

1. **Standardmäßig kein Panel mehr öffnen.** Die wirklich wertvollen Felder
   (`localUser`, `participants`) kommen bereits aus dem DOM ohne Panel
   (`detectLocalUser`, `[data-participant-id]`). Panel-only-Felder
   (`scheduledTime`, `description`, `dialIn`) sind Nice-to-have.
   → Neues Popup-Setting „Meeting-Details automatisch auslesen" (Default: **aus**),
   gespeichert in `chrome.storage.local`.
2. Wenn aktiviert, robust schließen:
   - `panelWasOpened` unabhängig von `panel` auswerten;
   - vor dem Schließen prüfen, ob das Panel *jetzt* offen ist (`findMeetingDetailsPanel()`
     erneut aufrufen), und nur dann toggeln;
   - alternativ `Escape` senden statt einen Button zu klicken:
     `document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`;
   - Panel-Erkennung locale-unabhängig ergänzen (z. B. über den `aria-expanded`-Zustand
     des ℹ-Buttons statt über den Überschriftstext).
3. Retry statt festem `sleep(450)`: bis zu ~1,5 s in 150-ms-Schritten pollen, bis
   `findMeetingDetailsPanel()` trifft.

## Akzeptanzkriterien

- [ ] Start der Aufnahme öffnet im Default kein sichtbares Panel.
- [ ] Mit aktiviertem Setting: Panel schließt sich in ≥ 3 Testläufen zuverlässig wieder,
      auch bei künstlich verzögertem Rendern (DevTools CPU-Throttling 6×).
- [ ] Panel, das der Nutzer selbst geschlossen hat, wird nicht erneut geöffnet.
- [ ] Version in `manifest.json` gebumpt (Minor — neues Setting).

## Betroffene Dateien

- `content.js` (`scrapeMeetingInfoAsync` Z. 316, `findMeetingDetailsPanel` Z. 389, `findMeetingInfoButton` Z. 374)
- `popup/popup.html`, `popup/popup.js` (Setting)
