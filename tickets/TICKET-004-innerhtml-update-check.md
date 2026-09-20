# TICKET-004: innerHTML-Injection im Update-Check beseitigen

**Typ:** Security · **Priorität:** Mittel · **Aufwand:** Sehr klein

## Problem

`popup/popup.js:285–287` baut den Update-Hinweis per `innerHTML` mit einem String aus der
GitHub-API-Antwort zusammen:

```js
el.innerHTML =
  `<a href="https://github.com/...">` +
  `${latestTag} verfügbar</a>`;
```

`latestTag` (`data.tag_name`) ist externer Input. Zwar ist das Risiko begrenzt (eigenes
Repo, MV3-CSP blockt Inline-Skripte), aber HTML-Markup-Injection ins Popup bleibt möglich
(z. B. Tag-Name mit `<img src=x onerror=…>` würde vom CSP zwar am Skript gehindert, aber
Layout-/Phishing-Markup ist möglich). `innerHTML` mit Fremddaten ist in Extensions
grundsätzlich zu vermeiden und fällt bei einem Chrome-Web-Store-Review negativ auf.

## Lösung

DOM-API statt `innerHTML`:

```js
const link = document.createElement('a');
link.href = 'https://github.com/vincelamm/gMeetTranscriptCapture/releases/latest';
link.target = '_blank';
link.rel = 'noopener';
link.textContent = `${latestTag} verfügbar`;
el.replaceChildren(link);
```

Zusätzlich im gleichen Zug:
- Die doppelt hardcodierte Repo-URL (`popup.js:267` und `popup.js:286`) in eine Konstante
  `const REPO = 'vincelamm/gMeetTranscriptCapture';` ziehen.
- `latestTag` vor Nutzung gegen ein striktes Muster validieren: `/^v?\d+\.\d+\.\d+$/` —
  sonst Update-Hinweis gar nicht anzeigen. Damit ist auch `isNewerVersion` gegen
  unerwartete Tag-Formate (NaN-Vergleiche) abgesichert.

## Akzeptanzkriterien

- [ ] Kein `innerHTML` mehr in `popup.js`.
- [ ] Tag-Namen, die nicht `v?x.y.z` entsprechen, führen zu keinem Update-Hinweis.
- [ ] Update-Hinweis erscheint weiterhin korrekt, wenn ein neueres Release existiert (manuell testbar: lokale Version in manifest.json temporär runtersetzen).
- [ ] Version in `manifest.json` gebumpt (Patch).

## Betroffene Dateien

- `popup/popup.js` (Zeilen 254–289)
