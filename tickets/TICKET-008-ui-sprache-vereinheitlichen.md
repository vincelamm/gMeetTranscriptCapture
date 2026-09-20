# TICKET-008: Popup-UI-Sprache vereinheitlichen (Deutsch)

**Typ:** UX · **Priorität:** Mittel · **Aufwand:** Klein

## Problem

Das Popup mischt Englisch und Deutsch:

- Englisch: „Start Capture", „Stop Capture", „Capturing…", „N lines captured",
  „Download .txt", „Waiting for captions…", die komplette CC-Warnung, der
  Consent-Hinweis („By starting, you confirm …"), „Open a Google Meet tab …",
  „Tab reload required" (`popup/popup.html`).
- Deutsch: „KI-Prompt kopieren", „Kopiert!", „Transkript exportieren",
  „… verfügbar" (`popup/popup.html:57`, `popup/popup.js:215–219, 287`).
- Die Transkript-Ausgabe (`utils/formatter.js`) ist bereits durchgehend deutsch
  („Dauer", „Teilnehmende", „Ende des Transkripts").

Dazu kommt englische Pluralisierung in `popup/popup.js:58` und `:99`
(`line${count !== 1 ? 's' : ''} captured`).

## Lösung

Alle sichtbaren Strings auf Deutsch umstellen (Zielgruppe ist deutschsprachig, die
Ausgabeformate sind es bereits). Kein i18n-Framework einführen — bei einer einzigen
Zielsprache wäre `chrome.i18n` Overhead; einfache Ersetzung genügt.

Vorschläge:

| Aktuell | Neu |
|---|---|
| Start Capture | Aufnahme starten |
| Stop Capture | Aufnahme stoppen |
| Capturing… | Aufnahme läuft… |
| N line(s) captured | N Zeilen erfasst (Singular: 1 Zeile erfasst) |
| Download .txt / .md | .txt herunterladen / .md herunterladen |
| Clear | Verwerfen |
| Cancel | Abbrechen |
| Waiting for captions… | Warte auf Untertitel… |
| Captions not detected yet. | Untertitel noch nicht erkannt. |
| CC-Warnung (Liste) | „Bitte Untertitel manuell aktivieren: CC-Button in der Meet-Leiste klicken oder Taste c drücken. Die Aufnahme startet automatisch, sobald Untertitel erscheinen." |
| Consent-Hinweis | „Mit dem Start bestätigst du, dass alle Teilnehmenden über die Transkription informiert wurden." |
| Open a Google Meet tab… | Öffne einen Google-Meet-Tab, um die Extension zu nutzen. |
| Tab reload required / Reload Meet tab | Tab-Neuladen erforderlich / Meet-Tab neu laden |
| Captions (CC) will be enabled automatically… | Untertitel (CC) werden beim Start automatisch aktiviert. |

Hinweise:
- Gendergerechte Sprache verwenden: „Teilnehmende", „Organisator*in" (Konvention des Projekts).
- `popup.html` `<html lang="en">` → `lang="de"`.
- Dynamische Strings in `popup.js` anpassen: `renderIdle` (Z. 58), `updateLineCount` (Z. 99),
  `waitingMessage`-Texte im Start-Handler (Z. 174–180) und im Port-Listener (Z. 122).

## Akzeptanzkriterien

- [ ] Alle sichtbaren Texte in Popup-HTML und -JS sind deutsch, inkl. dynamischer Zustandsmeldungen.
- [ ] Korrekte Singular-/Pluralform bei der Zeilenanzahl („1 Zeile erfasst" / „5 Zeilen erfasst").
- [ ] Alle 5 Views geprüft (no-meet, reload, idle, capturing, waiting) — kein englischer Resttext.
- [ ] Version in `manifest.json` gebumpt (Minor).

## Betroffene Dateien

- `popup/popup.html`
- `popup/popup.js`
