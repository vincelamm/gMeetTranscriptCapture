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
 * Build a filename for the transcript download, using LOCAL time so it matches
 * the "Inicio:" field in the transcript header (which is also local time).
 * Example: meet-transcript-2026-03-19T14-32-00.txt
 */
export function buildFilename(startTime, format = 'txt') {
  const d = new Date(startTime);
  const pad = n => String(n).padStart(2, '0');
  const stamp =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  return `meet-transcript-${stamp}.${format}`;
}

// Locale words Google Meet uses to label the local user's own captions.
// Keep in sync with YOU_WORDS in content.js (no shared import — different module
// systems). If you add a locale here, mirror it there.
const YOU_EXACT_RE = /^(?:you|vous|du|tú|tu|ty|вы|あなた)$/i;

/**
 * Replace Meet's generic "You" speaker label with the detected local user name.
 * Meet uses locale-specific words for the local user's captions (e.g. "You", "Du", "Vous").
 */
function resolveSpeaker(speaker, localUser) {
  if (localUser && YOU_EXACT_RE.test(speaker.trim())) {
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
  return [...new Set(lines.map(l => resolveSpeaker(l.speaker, localUser)))]
    .filter(s => s.length > 0 && (localUser || !YOU_EXACT_RE.test(s.trim())));
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
  field('Fecha y hora programadas', meetingInfo?.scheduledTime);
  field('Organizador', meetingInfo?.organizer);
  field('Transcripción realizada por', meetingInfo?.localUser);
  const participants = meetingInfo?.participants?.length > 0
    ? meetingInfo.participants
    : fallbackParticipants;
  if (participants.length > 0) field('Participantes', participants.join(', '));
  field('Descripción', meetingInfo?.description);
  field('Enlace de la reunión', meetingInfo?.meetUrl);
  field('Número de acceso telefónico', meetingInfo?.dialIn);
  return rows;
}

/**
 * Format an array of CaptionLines into a plain-text transcript.
 * Optional endTime preserves raw transcript duration after export-only cleanup.
 */
export function formatTxt(lines, meetingTitle, startTime, meetingInfo = null,
  endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime) {
  const duration = formatDuration(endTime - startTime);
  const divider = '─'.repeat(50);
  const localUser = meetingInfo?.localUser;
  const fallback = speakersFromLines(lines, localUser);

  const headerLines = [
    `Reunión: ${meetingTitle || 'Google Meet'}`,
    `Inicio: ${formatDate(startTime)}`,
    `Duración: ${duration}`,
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

  return headerLines.join('\n') + body + [divider, 'Fin de la transcripción'].join('\n');
}

/**
 * Format an array of CaptionLines into a Markdown transcript.
 * Optional endTime preserves raw transcript duration after export-only cleanup.
 */
export function formatMd(lines, meetingTitle, startTime, meetingInfo = null,
  endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime) {
  const duration = formatDuration(endTime - startTime);
  const localUser = meetingInfo?.localUser;
  const fallback = speakersFromLines(lines, localUser);

  const headerLines = [
    `# Transcripción de la reunión: ${meetingTitle || 'Google Meet'}`,
    `**Inicio:** ${formatDate(startTime)}  `,
    `**Duración:** ${duration}`,
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
 * Wrap transcript in a Spanish AI prompt for generating meeting minutes.
 */
export function formatAIPrompt(lines, meetingTitle, startTime, meetingInfo = null) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const localUser = meetingInfo?.localUser;
  const ph = '[POR COMPLETAR]';

  // Participants: always derived from who actually spoke in the transcript
  const participants = speakersFromLines(lines, localUser);

  const meetingDetails = [
    `- Reunión: ${meetingTitle || ph}`,
    `- Fecha: ${meetingInfo?.scheduledTime || formatDate(startTime)}`,
    `- Formato: En línea (Google Meet)`,
    `- Participantes: ${participants.length > 0 ? participants.join(', ') : ph}`,
    `- Transcripción realizada por: ${localUser || ph}`,
  ];
  if (meetingInfo?.organizer) meetingDetails.push(`- Organizador: ${meetingInfo.organizer}`);
  if (meetingInfo?.description) meetingDetails.push(`- Agenda/Descripción: ${meetingInfo.description.trim()}`);

  const localUserNote = localUser
    ? `Nota: En la transcripción, «${localUser}» identifica a la persona que realiza la transcripción.`
    : '';

  const transcriptBody = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `[${relTime}] ${resolveSpeaker(speaker, localUser)}: ${text}`;
    })
    .join('\n');

  // Build the interactive clarification block
  const missingFields = [];
  if (!meetingTitle) missingFields.push('Reunión (nombre de la reunión o del grupo de trabajo)');
  if (!localUser)    missingFields.push('Transcripción realizada por (nombre de la persona)');

  const participantLine = participants.length > 0
    ? `Participantes identificados en la transcripción: **${participants.join(', ')}**`
    : 'No se pudieron identificar participantes en la transcripción.';

  const clarificationBlock = [
    '## Antes de redactar: plantea estas preguntas',
    '',
    'Hazme **todas las siguientes preguntas en un único mensaje** y espera mi respuesta antes de redactar el acta:',
    '',
    ...(missingFields.length > 0 ? [
      '**Datos de la reunión pendientes:**',
      ...missingFields.map(f => `- ¿${f}?`),
      '',
    ] : []),
    `**Participantes:** ${participantLine}`,
    '- ¿La lista está completa? Si no, ¿quién falta o no estuvo presente?',
    '',
    'Redacta el acta solo después de recibir mi respuesta.',
  ];

  return [
    'Eres una persona con experiencia en la redacción de actas. Elabora un acta profesional de resultados a partir de la siguiente transcripción de una reunión.',
    ...(localUserNote ? ['', localUserNote] : []),
    '',
    '## Datos de la reunión',
    '',
    ...meetingDetails,
    '',
    ...clarificationBlock,
    '',
    '## Requisitos del acta',
    '',
    '1. **Estructura:** Encabezado con los datos de la reunión, seguido de los puntos de la agenda o bloques temáticos.',
    '2. **Estilo:** Objetivo y neutral, en presente o mediante discurso indirecto. Evita las citas textuales, salvo en propuestas formales o acuerdos.',
    '3. **Contenido por bloque:** Resumen breve de la discusión, distintas posiciones sin valoraciones, acuerdos adoptados con resultados de votación si existen y asuntos pendientes.',
    '4. **Al final:** Lista de tareas con responsables y plazos, y la fecha de la próxima reunión si se conoce.',
    '',
    '## Reglas de selección del contenido',
    '',
    '- Incluye únicamente contenido técnico y organizativo relevante para la reunión.',
    '- Omite temas privados, conversaciones informales, anécdotas personales, referencias a la salud o a la familia y comentarios ajenos a la reunión.',
    '- Omite las exageraciones emocionales y los ataques personales; recoge solo el contenido objetivo de las discusiones controvertidas.',
    '- Si no está claro si un pasaje es relevante, colócalo al final en «Para revisión de la persona que realizó la transcripción», en lugar de incluirlo en el acta.',
    '',
    '---',
    '',
    `Inicio de la transcripción: ${formatDate(startTime)} · Duración: ${duration}`,
    '',
    'TRANSCRIPCIÓN:',
    '',
    transcriptBody,
    '',
    '---',
  ].join('\n');
}
