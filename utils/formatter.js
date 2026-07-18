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
 * Build a meeting info block for headers.
 * @param {object|null} meetingInfo
 * @param {'txt'|'md'} format
 */
function buildMeetingInfoBlock(meetingInfo, format) {
  if (!meetingInfo) return [];
  const lines = [];
  const field = (label, value, mdLabel) => {
    if (!value) return;
    lines.push(format === 'md' ? `**${mdLabel || label}:** ${value}` : `${label}: ${value}`);
  };
  field('Scheduled', meetingInfo.scheduledTime, 'Scheduled');
  field('Organizer', meetingInfo.organizer, 'Organizer');
  field('Author', meetingInfo.localUser, 'Author');
  if (meetingInfo.participants?.length > 0) {
    field('Participants', meetingInfo.participants.join(', '), 'Participants');
  }
  field('Description', meetingInfo.description, 'Description');
  field('Join URL', meetingInfo.meetUrl, 'Join URL');
  field('Dial-in', meetingInfo.dialIn, 'Dial-in');
  return lines;
}

/**
 * Format an array of CaptionLines into a plain-text transcript.
 *
 * @param {Array<{speaker: string, text: string, timestamp: number}>} lines
 * @param {string} meetingTitle
 * @param {number} startTime - Unix ms when capture started
 * @param {object|null} [meetingInfo]
 * @returns {string}
 */
export function formatTxt(lines, meetingTitle, startTime, meetingInfo = null) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const divider = '─'.repeat(50);

  const headerLines = [
    `Meeting: ${meetingTitle || 'Google Meet'}`,
    `Start: ${formatDate(startTime)}`,
    `Duration: ${duration}`,
    ...buildMeetingInfoBlock(meetingInfo, 'txt'),
    divider,
    '',
  ];

  const localUser = meetingInfo?.localUser;
  const body = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `[${relTime}] ${resolveSpeaker(speaker, localUser)}\n${text}\n`;
    })
    .join('\n');

  const footer = [divider, 'End of transcript'].join('\n');

  return headerLines.join('\n') + body + footer;
}

/**
 * Format an array of CaptionLines into a Markdown transcript.
 *
 * @param {Array<{speaker: string, text: string, timestamp: number}>} lines
 * @param {string} meetingTitle
 * @param {number} startTime - Unix ms when capture started
 * @param {object|null} [meetingInfo]
 * @returns {string}
 */
export function formatMd(lines, meetingTitle, startTime, meetingInfo = null) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);

  const headerLines = [
    `# Meeting Transcript: ${meetingTitle || 'Google Meet'}`,
    `**Start:** ${formatDate(startTime)}  `,
    `**Duration:** ${duration}`,
    ...buildMeetingInfoBlock(meetingInfo, 'md').map(l => `${l}  `),
    '',
    '---',
    '',
  ];

  const localUser = meetingInfo?.localUser;
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
 *
 * @param {Array<{speaker: string, text: string, timestamp: number}>} lines
 * @param {string} meetingTitle
 * @param {number} startTime
 * @param {object|null} [meetingInfo]
 * @returns {string}
 */
export function formatAIPrompt(lines, meetingTitle, startTime, meetingInfo = null) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const localUser = meetingInfo?.localUser;
  const ph = '[PLATZHALTER]';

  // Pre-fill Rahmendaten from scraped metadata; fall back to placeholder
  const rahmendaten = [
    `- Gremium/Runde: ${meetingTitle || ph}`,
    `- Datum: ${meetingInfo?.scheduledTime || formatDate(startTime)}`,
    `- Format: Online (Google Meet)`,
    `- Teilnehmende: ${meetingInfo?.participants?.length > 0 ? meetingInfo.participants.join(', ') : ph}`,
    `- Protokollführung: ${localUser || ph}`,
  ];
  if (meetingInfo?.organizer) rahmendaten.push(`- Organisator/in: ${meetingInfo.organizer}`);
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

  return [
    'Du bist ein erfahrener Protokollant. Erstelle aus dem folgenden Meeting-Transkript ein professionelles Ergebnisprotokoll.',
    ...(localUserNote ? ['', localUserNote] : []),
    '',
    '## Rahmendaten',
    '(aus Transkript-Metadaten entnommen – fehlende Angaben bitte als [PLATZHALTER] belassen)',
    '',
    ...rahmendaten,
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
