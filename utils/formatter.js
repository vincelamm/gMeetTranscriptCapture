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

  const body = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `[${relTime}] ${speaker}\n${text}\n`;
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

  const body = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `**[${relTime}] ${speaker}**  \n${text}\n`;
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

  const metaLines = [
    `Meeting: ${meetingTitle || 'Google Meet'}`,
    `Datum: ${formatDate(startTime)}`,
    `Dauer: ${duration}`,
  ];
  if (meetingInfo?.scheduledTime) metaLines.push(`Terminzeit: ${meetingInfo.scheduledTime}`);
  if (meetingInfo?.organizer) metaLines.push(`Organisator: ${meetingInfo.organizer}`);
  if (meetingInfo?.participants?.length > 0) {
    metaLines.push(`Teilnehmer: ${meetingInfo.participants.join(', ')}`);
  }
  if (meetingInfo?.description) {
    metaLines.push(`Beschreibung: ${meetingInfo.description.trim()}`);
  }

  const transcriptBody = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `[${relTime}] ${speaker}: ${text}`;
    })
    .join('\n');

  return [
    'Du bist ein professioneller Meeting-Assistent. Erstelle ein strukturiertes Protokoll auf Basis des folgenden Transkripts.',
    '',
    'Das Protokoll soll folgende Abschnitte enthalten:',
    '1. **Zusammenfassung** – Was wurde besprochen? (2–4 Sätze)',
    '2. **Beschlüsse** – Welche Entscheidungen wurden getroffen?',
    '3. **Aufgaben & nächste Schritte** – Wer macht was? Mit Verantwortlichkeit und ggf. Frist.',
    '4. **Offene Punkte** – Ungelöste Fragen oder Themen für das nächste Meeting.',
    '',
    'Verwende einen sachlichen, professionellen Ton. Falls keine klaren Beschlüsse oder Aufgaben erkennbar sind, notiere das explizit.',
    '',
    '---',
    '',
    ...metaLines,
    '',
    'TRANSKRIPT:',
    '',
    transcriptBody,
    '',
    '---',
  ].join('\n');
}
