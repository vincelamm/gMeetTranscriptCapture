# Tickets — Code-Review vom 2026-07-29 (Stand v1.4.12)

Ergebnis eines vollständigen Reviews von `content.js`, `background.js`,
`utils/formatter.js`, `popup/*` und `manifest.json`. Jedes Ticket ist eigenständig
bearbeitbar (Kontext, Lösungsvorschlag, Akzeptanzkriterien, Fundstellen).

## Übersicht nach Priorität

| # | Ticket | Typ | Priorität | Aufwand |
|---|--------|-----|-----------|---------|
| 001 | [Race Condition bei CAPTION_LINE](TICKET-001-race-condition-caption-line.md) | Bug | **Hoch** | Klein |
| 002 | [Caption-Verlust bei Port-Reconnect](TICKET-002-caption-verlust-bei-port-reconnect.md) | Bug | Mittel | Klein |
| 004 | [innerHTML-Injection im Update-Check](TICKET-004-innerhtml-update-check.md) | Security | Mittel | Sehr klein |
| 006 | [Debug-Logging drosseln](TICKET-006-debug-logging-drosseln.md) | Perf/Hygiene | Mittel | Klein |
| 008 | [UI-Sprache vereinheitlichen](TICKET-008-ui-sprache-vereinheitlichen.md) | UX | Mittel | Klein |
| 007 | [Storage-Schreiblast reduzieren](TICKET-007-storage-schreiblast.md) | Perf | Niedrig–Mittel | Mittel |
| 003 | [Toter CAPTION_LINE-Message-Pfad](TICKET-003-toter-caption-line-message-pfad.md) | Cleanup | Niedrig | Sehr klein |
| 005 | [Dateiname UTC vs. Lokalzeit](TICKET-005-dateiname-utc-vs-lokalzeit.md) | Bug | Niedrig | Sehr klein |
| 009 | [Popup-Fehlerbehandlung GET_STATE](TICKET-009-popup-fehlerbehandlung-getstate.md) | Bug | Niedrig | Sehr klein |
| 010 | [Housekeeping: Icon-Generatoren, Regex-Duplikate](TICKET-010-housekeeping.md) | Cleanup | Niedrig | Klein |

## Empfohlene Reihenfolge

1. **001** (Race Condition) — kritischster Datenverlust-Pfad, Grundlage für 007.
2. **003** — trivial, räumt den Caption-Pfad auf, bevor 002/007 darin arbeiten.
3. **002** (Port-Outbox) — zweiter Datenverlust-Pfad.
4. **004, 005, 009** — jeweils sehr klein, unabhängig, gut bündelbar in einem Commit-Zug.
5. **006** (Logging) — vor dem nächsten echten Meeting-Test sinnvoll.
6. **008** (UI-Sprache) — unabhängig, jederzeit.
7. **007** (Storage-Batching) — zuletzt, baut auf 001 auf.

---

# Review-Runde 2 — 2026-09-20 (Stand v1.4.12, Branch `fix/start-reliability`)

Anlass: Nutzendenmeldung *„beim Starten öffnet sich ein Popup-Fenster"* — die Aufnahme
startet nicht zuverlässig. Das Review hat dafür drei sich überlagernde Ursachen gefunden
(011–013) sowie zwei weitere Zuverlässigkeitslücken (014, 015).

| # | Ticket | Typ | Priorität | Aufwand | Status |
|---|--------|-----|-----------|---------|--------|
| 017 | [CC-Button-Suche trifft die Untertitel-Einstellung](TICKET-017-cc-button-trifft-einstellungen.md) | Bug | **Hoch** | Klein | ✅ v1.4.13 |
| 013 | [Sprachdialog: Blindklick auf „letzten Button"](TICKET-013-sprachdialog-blindklick.md) | Bug | **Hoch** | Klein | ✅ v1.4.13 |
| 011 | [Details-Panel öffnet sich sichtbar / bleibt offen](TICKET-011-details-panel-bleibt-offen.md) | Bug/UX | **Hoch** | Klein | ◑ Close-Bug gefixt, Opt-out offen |
| 012 | [Start-Sequenz serialisieren](TICKET-012-start-sequenz-serialisieren.md) | Bug | **Hoch** | Klein | ✅ v1.4.13 |
| 016 | [DEBUG-Flag fehlt, Caption-Inhalte im Log](TICKET-016-debug-flag-fehlt.md) | Privacy/Perf | Mittel | Sehr klein | ✅ v1.4.13 |
| 014 | [Observer stirbt still bei Re-Render](TICKET-014-observer-stirbt-still.md) | Bug | **Hoch** | Klein | ☐ offen |
| 015 | [Warte-Phase überlebt Popup-Schließen nicht](TICKET-015-wartephase-nicht-persistent.md) | Bug/UX | Mittel | Klein | ☐ offen |

## Nächste Schritte (Runde 2)

1. **014** — verhindert stillen Datenverlust mitten im Meeting.
2. **015** — macht den echten Zustand im Popup sichtbar; senkt Support-Aufwand.
3. **011** (Rest) — Panel-Scraping optional machen bzw. ans Ende der Aufnahme verschieben.

## Konventionen für die Bearbeitung

- Pro Ticket ein Commit; **Semver in `manifest.json` bumpen** (im Ticket vermerkt: Patch/Minor).
- Vor jedem Push: alle Dateien auf sensible Daten scannen.
- Änderungen an `content.js` erfordern Reload der Extension **und** des Meet-Tabs;
  Verhalten gegen echtes Meet-DOM kann nur manuell im Meeting verifiziert werden.

## Geprüft, bewusst kein Ticket

- **`host_permissions: https://api.github.com/*`** — nötig für den Update-Check; enger
  fassen geht nicht sinnvoll (Pfad-Einschränkung bei host_permissions nur begrenzt möglich).
- **`chrome.storage.session`-Quota (10 MB)** — selbst sehr lange Meetings bleiben weit darunter.
- **Download per Data-URL** (`background.js:190`) — in MV3-SW gibt es kein
  `URL.createObjectURL`; Data-URL ist hier der korrekte Weg, Größen unkritisch.
- **`replaceLastLine` behält den Timestamp des Utterance-Beginns** — gewollt: die Zeile
  zeigt an, wann der Redebeitrag begann. Die Transkript-Dauer endet dadurch minimal früher;
  vernachlässigbar.
