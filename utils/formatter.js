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
 * Format an absolute timestamp as a wall-clock date string.
 */
function formatDate(ts) {
  return new Date(ts).toISOString().slice(0, 10); // YYYY-MM-DD
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
 * Format an array of CaptionLines into a plain-text transcript.
 *
 * @param {Array<{speaker: string, text: string, timestamp: number}>} lines
 * @param {string} meetingTitle
 * @param {number} startTime - Unix ms when capture started
 * @returns {string}
 */
export function formatTxt(lines, meetingTitle, startTime) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const date = formatDate(startTime);
  const divider = '─'.repeat(50);

  const header = [
    `Meeting: ${meetingTitle || 'Google Meet'}`,
    `Date: ${date}`,
    `Duration: ${duration}`,
    divider,
    '',
  ].join('\n');

  const body = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `[${relTime}] ${speaker}\n${text}\n`;
    })
    .join('\n');

  const footer = [divider, 'End of transcript'].join('\n');

  return header + body + footer;
}

/**
 * Format an array of CaptionLines into a Markdown transcript.
 *
 * @param {Array<{speaker: string, text: string, timestamp: number}>} lines
 * @param {string} meetingTitle
 * @param {number} startTime - Unix ms when capture started
 * @returns {string}
 */
export function formatMd(lines, meetingTitle, startTime) {
  const endTime = lines.length > 0 ? lines[lines.length - 1].timestamp : startTime;
  const duration = formatDuration(endTime - startTime);
  const date = formatDate(startTime);

  const header = [
    `# Meeting Transcript: ${meetingTitle || 'Google Meet'}`,
    `**Date:** ${date}  `,
    `**Duration:** ${duration}`,
    '',
    '---',
    '',
  ].join('\n');

  const body = lines
    .map(({ speaker, text, timestamp }) => {
      const relTime = formatDuration(timestamp - startTime);
      return `**[${relTime}] ${speaker}**  \n${text}\n`;
    })
    .join('\n');

  return header + body;
}
