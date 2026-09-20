# TICKET-014: Observer stirbt still, wenn Meet den Caption-Container neu rendert

**Typ:** Bug · **Priorität:** **Hoch** · **Aufwand:** Klein

## Problem

`startObserver` (`content.js:758–770`) hängt den `MutationObserver` an **genau das eine**
Container-Element, das beim Start gefunden wurde:

```js
observer.observe(container, { childList: true, subtree: true, characterData: true });
```

Im Callback wird der Container zwar neu gesucht (`strategy.findContainer() || container`) —
aber **der Callback feuert nicht mehr**, sobald Meet das ursprüngliche Element aus dem DOM
entfernt und neu aufbaut. Das passiert real bei:

- CC aus- und wieder einschalten,
- Layout-Wechsel (Präsentation starten/beenden, Vollbild),
- Wechsel in einen Breakout-Room,
- Meets eigenen Re-Renders nach Netzwerk-Hängern.

Folge: Das Popup zeigt weiter „Aufnahme läuft…", der Zähler bleibt aber stehen.
Der Datenverlust fällt erst nach dem Meeting auf.

Verwandt: **Strategy F** (`content.js:54–64`) akzeptiert ein `[aria-live]`-Element
unconditional, wenn es das einzige im DOM ist — auch wenn es in Wahrheit die
Statusmeldungs-Region ist. Dann wird `CC_STATUS: 'found'` gemeldet, das Popup wechselt
in die Aufnahme-Ansicht, und es kommt nie eine Zeile an.

## Lösung

1. **Health-Check-Intervall** (z. B. alle 5 s) während der Aufnahme:
   ```js
   if (!observedContainer?.isConnected) {
     const match = detectStrategy();
     if (match) { activeStrategy = match.strategy; startObserver(match.strategy, match.container); }
     else { startScan(); }
   }
   ```
2. **Watchdog für stille Strategien:** Wenn nach dem Anhängen ≥ 60 s keine einzige Zeile
   committed wurde, `detectStrategy()` erneut laufen lassen und bei einer *anderen*
   Strategie neu anhängen. Verhindert das stille Scheitern von Strategy E/F.
3. **Sichtbares Signal im Popup:** Läuft die Aufnahme, aber der Zähler steht seit
   > 2 Minuten bei 0, einen Hinweis einblenden („Keine Untertitel empfangen — sind sie
   noch aktiv?") statt weiter grün „Aufnahme läuft" zu zeigen.

## Akzeptanzkriterien

- [ ] Aufnahme starten, CC in Meet aus- und wieder einschalten → Zähler läuft danach weiter.
- [ ] Präsentation starten/beenden während der Aufnahme → keine Lücke im Transkript.
- [ ] Popup zeigt einen Hinweis, wenn über längere Zeit keine Zeilen ankommen.

## Betroffene Dateien

- `content.js` (`startObserver` Z. 758, `stopObserver` Z. 772, `startScan` Z. 974, Strategy F Z. 54)
- `popup/popup.js`, `popup/popup.html` (Hinweis)
