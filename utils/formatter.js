/**
 * formatter.js — Transcript formatting utilities
 *
 * Imported as an ES module by background.js.
 * Converts an array of CaptionLine objects into a human-readable transcript.
 *
 * CaptionLine: { speaker: string, text: string, timestamp: number (Unix ms) }
 */

/**
 * Format a duration in milliseconds as HH:MM:SS.
 */
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

/**
 * Format an absolute timestamp as a wall-clock date+time string (local time).
 */
function formatDate(ts) {
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${date} ${time}`;
}

/**
 * Build a filename for the transcript download.
 * Example: meet-transcript-2026-03-19T14-32-00.txt
 */
export function buildFilename(startTime, format = 'txt') {
  const iso = new Date(startTime).toISOString().slice(0, 19).replace(/:/g, '-');
  return `meet-transcript-${iso}.${format}`;
}

/**
 * Replace Meet's generic "You" speaker label with the detected local user name.
 * Meet uses locale-specific words for the local user's captions (e.g. "You", "Du", "Vous").
 */
function resolveSpeaker(speaker, localUser) {
  if (localUser && /^(you|vous|du|tú|tu|ty|вы|あなた)$/i.test(speaker.trim())) {
    return localUser;
  }
  return speaker;
}

/**
 * Extract unique speaker names from transcript lines.
 * "You" is resolved to localUser if known; filtered out if unknown (it's the
 * local user — they know who they are; no point showing a raw "You" in the list).
 */
function speakersFromLines(lines, localUser) {
  const YOU_RE = /^(you|vous|du|tú|tu|ty|вы|あなた)$/i;
  return [...new Set(lines.map(l => resolveSpeaker(l.speaker, localUser)))]
    .filter(s => s.length > 0 && (localUser || !YOU_RE.test(s.trim())));
}

/**
 * Build a meeting info block for headers.
 * @param {object|null} meetingInfo
 * @param {'txt'|'md'} format
 * @param {string[]} [fallbackParticipants]
 */
function buildMeetingInfoBlock(meetingInfo, format, fallbackParticipants = []) {
  const rows = [];
  const field = (label, value) => {
    if (!value) return;
    rows.push(format === 'md' ? `**${label}:** ${value}` : `${label}: ${value}`);
  };
  field('Terminzeit', meetingInfo?.scheduledTime);
  field('Organisator*in', meetingInfo?.organizer);
  field('Protokollführung', meetingInfo?.localUser);
  const participants = meetingInfo?.participants?.length > 0
    ? meetingInfo.participants
    : fallbackParticipants;
  if (participants.length > 0) field('Teilnehmende', participants.join(', '));
  field('Beschreibung', meetingInfo?.description);
  field('Meeting-Link', meetingInfo?.meetUrl);
  field('Einwahl', meetingInfo?.dialIn);
  return rows;
}

/**
 * Format an array of CaptionLines into a plain-text transcript.
 */
export function formatTxt(lines, meetingTitle, startTime, meetingInfo = null) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const divider = '─'.repeat(50);
  const localUser = meetingInfo?.localUser;
  const fallback = speakersFromLines(lines, localUser);

  const headerLines = [
    `Meeting: ${meetingTitle || 'Google Meet'}`,
    `Start: ${formatDate(startTime)}`,
    `Dauer: ${duration}`,
    ...buildMeetingInfoBlock(meetingInfo, 'txt', fallback),
    divider,
    '',
  ];

  const body = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `[${relTime}] ${resolveSpeaker(speaker, localUser)}\n${text}\n`;
    })
    .join('\n');

  return headerLines.join('\n') + body + [divider, 'Ende des Transkripts'].join('\n');
}

/**
 * Format an array of CaptionLines into a Markdown transcript.
 */
export function formatMd(lines, meetingTitle, startTime, meetingInfo = null) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const localUser = meetingInfo?.localUser;
  const fallback = speakersFromLines(lines, localUser);

  const headerLines = [
    `# Meeting-Transkript: ${meetingTitle || 'Google Meet'}`,
    `**Start:** ${formatDate(startTime)}  `,
    `**Dauer:** ${duration}`,
    ...buildMeetingInfoBlock(meetingInfo, 'md', fallback).map(l => `${l}  `),
    '',
    '---',
    '',
  ];

  const body = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `**[${relTime}] ${resolveSpeaker(speaker, localUser)}**  \n${text}\n`;
    })
    .join('\n');

  return headerLines.join('\n') + body;
}

/**
 * Wrap transcript in an AI prompt for generating meeting minutes (Protokoll).
 */
export function formatAIPrompt(lines, meetingTitle, startTime, meetingInfo = null) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const localUser = meetingInfo?.localUser;
  const ph = '[PLATZHALTER]';

  // Teilnehmende: always derived from who actually spoke in the transcript
  const participants = speakersFromLines(lines, localUser);

  const rahmendaten = [
    `- Gremium/Runde: ${meetingTitle || ph}`,
    `- Datum: ${meetingInfo?.scheduledTime || formatDate(startTime)}`,
    `- Format: Online (Google Meet)`,
    `- Teilnehmende: ${participants.length > 0 ? participants.join(', ') : ph}`,
    `- Protokollführung: ${localUser || ph}`,
  ];
  if (meetingInfo?.organizer) rahmendaten.push(`- Organisator*in: ${meetingInfo.organizer}`);
  if (meetingInfo?.description) rahmendaten.push(`- Agenda/Beschreibung: ${meetingInfo.description.trim()}`);

  const localUserNote = localUser
    ? `Hinweis: Im Transkript steht „${localUser}" für die protokollführende Person.`
    : '';

  const transcriptBody = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `[${relTime}] ${resolveSpeaker(speaker, localUser)}: ${text}`;
    })
    .join('\n');

  // Build the interactive clarification block
  const missingFields = [];
  if (!meetingTitle) missingFields.push('Gremium/Runde (Name des Arbeitskreises o. Ä.)');
  if (!localUser)    missingFields.push('Protokollführung (Name der protokollierenden Person)');

  const participantLine = participants.length > 0
    ? `Aus dem Transkript erkannte Teilnehmende: **${participants.join(', ')}**`
    : 'Aus dem Transkript konnten keine Teilnehmenden erkannt werden.';

  const clarificationBlock = [
    '## Vor dem Schreiben: Bitte stelle diese Fragen',
    '',
    'Stelle mir **alle folgenden Fragen in einer einzigen Nachricht** und warte auf meine Antwort, bevor du das Protokoll erstellst:',
    '',
    ...(missingFields.length > 0 ? [
      '**Fehlende Rahmendaten:**',
      ...missingFields.map(f => `- ${f}?`),
      '',
    ] : []),
    `**Teilnehmende:** ${participantLine}`,
    '- Ist diese Liste vollständig? Falls nicht: wer fehlt oder war nicht anwesend?',
    '',
    'Erst nach meiner Antwort erstellst du das Protokoll.',
  ];

  return [
    'Du bist eine erfahrene Protokollant*in. Erstelle aus dem folgenden Meeting-Transkript ein professionelles Ergebnisprotokoll.',
    ...(localUserNote ? ['', localUserNote] : []),
    '',
    '## Rahmendaten',
    '',
    ...rahmendaten,
    '',
    ...clarificationBlock,
    '',
    '## Anforderungen an das Protokoll',
    '',
    '1. **Struktur:** Kopf mit Rahmendaten, danach Gliederung nach Tagesordnungspunkten bzw. thematischen Blöcken.',
    '2. **Stil:** Sachlich, neutral, im Präsens oder Konjunktiv der indirekten Rede. Keine wörtlichen Zitate, außer bei formalen Anträgen oder Beschlüssen.',
    '3. **Inhalt pro Themenblock:** Kurze Zusammenfassung der Diskussion, unterschiedliche Positionen (ohne Wertung), gefasste Beschlüsse mit Abstimmungsergebnis (falls vorhanden), offene Punkte.',
    '4. **Am Ende:** Übersicht aller Aufgaben/To-dos mit Verantwortlichen und Fristen sowie ggf. der nächste Termin.',
    '',
    '## Wichtige Filterregeln',
    '',
    '- Nimm ausschließlich fachlich und organisatorisch relevante Inhalte auf.',
    '- Lasse private Themen, Smalltalk, persönliche Anekdoten, gesundheitliche oder familiäre Erwähnungen sowie Äußerungen ohne Bezug zur Sitzung vollständig weg.',
    '- Lasse emotionale Zuspitzungen oder persönliche Angriffe weg; gib nur den sachlichen Kern einer kontroversen Diskussion wieder.',
    '- Wenn unklar ist, ob eine Passage relevant ist, liste sie am Ende unter „Zur Prüfung durch Protokollführung" auf, statt sie ins Protokoll aufzunehmen.',
    '',
    '---',
    '',
    `Aufzeichnungsbeginn: ${formatDate(startTime)} · Dauer: ${duration}`,
    '',
    'TRANSKRIPT:',
    '',
    transcriptBody,
    '',
    '---',
  ].join('\n');
}
