# TICKET-005: Dateiname nutzt UTC, Transkript-Header lokale Zeit

**Typ:** Bug · **Priorität:** Niedrig · **Aufwand:** Sehr klein

## Problem

`utils/formatter.js:36–39`:

```js
export function buildFilename(startTime, format = 'txt') {
  const iso = new Date(startTime).toISOString().slice(0, 19).replace(/:/g, '-');
  return `meet-transcript-${iso}.${format}`;
}
```

`toISOString()` liefert UTC. Der Header im Transkript (`formatDate`, Zeile 24–30) nutzt
lokale Zeit. Bei einem Meeting um 09:00 Uhr deutscher Zeit (CEST) heißt die Datei
`meet-transcript-…T07-00-00.txt`, der Header sagt aber `09:00`. Bei Meetings kurz nach
Mitternacht stimmt sogar das **Datum** im Dateinamen nicht.

## Lösung

Dateinamen aus lokalen Datumskomponenten bauen (analog zu `formatDate`):

```js
export function buildFilename(startTime, format = 'txt') {
  const d = new Date(startTime);
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
                `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `meet-transcript-${stamp}.${format}`;
}
```

Optional: den `pad`-Helper aus `formatDate` wiederverwenden (auf Modulebene ziehen).

## Akzeptanzkriterien

- [ ] Datum+Uhrzeit im Dateinamen stimmen mit dem `Start:`-Feld im Transkript-Header überein.
- [ ] Dateiname enthält weiterhin keine für Dateisysteme problematischen Zeichen (kein `:`).
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `utils/formatter.js` (Zeilen 36–39)
