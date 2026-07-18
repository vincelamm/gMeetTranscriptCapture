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
    'Du bist ein erfahrener Protokollant. Fülle die folgende Protokoll-Vorlage auf Basis des Transkripts am Ende dieser Nachricht aus.',
    ...(localUserNote ? ['', localUserNote] : []),
    '',
    '## Regeln',
    '',
    '- Sachlich, neutral, im Präsens oder Konjunktiv der indirekten Rede. Keine wörtlichen Zitate außer bei Beschlüssen.',
    '- Nur fachlich und organisatorisch relevante Inhalte. Smalltalk, private Themen und persönliche Anekdoten weglassen.',
    '- Emotionale Zuspitzungen weglassen; nur den sachlichen Kern wiedergeben.',
    '- Unsichere oder schwer einzuordnende Passagen unter „Zur Prüfung durch Protokollführung" sammeln.',
    '- Fehlende Angaben als [PLATZHALTER] belassen.',
    '',
    '---',
    '',
    '# VORLAGE (bitte ausfüllen)',
    '',
    '# Ergebnisprotokoll',
    '',
    '## Rahmendaten',
    '',
    ...rahmendaten,
    '',
    '## Tagesordnung / Thematische Blöcke',
    '',
    '### TOP 1: [Thema aus Transkript ableiten]',
    '',
    '**Zusammenfassung:** [PLATZHALTER]',
    '',
    '**Positionen / Diskussion:** [PLATZHALTER]',
    '',
    '**Beschlüsse:** [PLATZHALTER – oder „Keine Beschlüsse gefasst"]',
    '',
    '**Offene Punkte:** [PLATZHALTER – oder „Keine"]',
    '',
    '### TOP 2: [Thema aus Transkript ableiten]',
    '',
    '*(weitere TOPs nach Bedarf ergänzen)*',
    '',
    '## Aufgaben / To-dos',
    '',
    '| Aufgabe | Verantwortlich | Frist |',
    '|---------|---------------|-------|',
    '| [PLATZHALTER] | [PLATZHALTER] | [PLATZHALTER] |',
    '',
    '## Nächster Termin',
    '',
    '[PLATZHALTER – oder „Nicht besprochen"]',
    '',
    '## Zur Prüfung durch Protokollführung',
    '',
    '[PLATZHALTER – oder weglassen, falls nichts unklar]',
    '',
    '---',
    '',
    '# TRANSKRIPT',
    '',
    `Aufzeichnungsbeginn: ${formatDate(startTime)} · Dauer: ${duration}`,
    '',
    transcriptBody,
    '',
    '---',
  ].join('\n');
}
