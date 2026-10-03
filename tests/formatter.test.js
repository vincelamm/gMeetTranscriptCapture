const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const formatter = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, '../utils/formatter.js')).toString('base64')}`);
const start = new Date(2026, 9, 3, 12, 30, 4).getTime();
const lines = [
  { speaker: 'Tú', text: '¡Esto funciona correctamente!', timestamp: start + 13000 },
  { speaker: 'Ana', text: 'Sí, revisemos producción.', timestamp: start + 20000 },
];
const info = {
  localUser: 'Manuel', participants: ['Manuel', 'Ana', 'Luis'],
  scheduledTime: '2026-10-03 12:30', organizer: 'Ana', description: 'Revisión de datos',
  meetUrl: 'https://meet.google.com/abc-defg-hij', dialIn: '+51 1234567',
};

for (const format of ['Txt', 'Md']) {
  test(`${format} exports Spanish metadata without changing captions or speaker timestamps`, async () => {
    const module = await formatter;
    const result = module[`format${format}`](lines, 'Revisión', start, info);
    for (const label of ['Inicio', 'Duración', 'Fecha y hora programadas', 'Organizador',
      'Transcripción realizada por', 'Participantes', 'Descripción', 'Enlace de la reunión', 'Número de acceso telefónico']) {
      assert.ok(result.includes(label), `Missing Spanish label: ${label}`);
    }
    assert.ok(result.includes('00:00:20'));
    assert.ok(result.includes('[00:00:13] Manuel'));
    assert.ok(result.includes('[00:00:20] Ana'));
    for (const line of lines) assert.ok(result.includes(line.text));
    for (const value of Object.values(info).flat()) assert.ok(result.includes(value));
    if (format === 'Txt') assert.ok(result.endsWith('Fin de la transcripción'));
    else assert.ok(result.startsWith('# Transcripción de la reunión: Revisión'));
    assert.equal(lines[0].speaker, 'Tú');
  });
}

test('empty exports remain valid and use Spanish headers with Google Meet fallback', async () => {
  const { formatTxt, formatMd } = await formatter;
  for (const result of [formatTxt([], '', start), formatMd([], '', start)]) {
    assert.ok(result.includes('Google Meet'));
    assert.ok(result.includes('Duración'));
    assert.ok(result.includes('00:00:00'));
    assert.ok(!result.includes('undefined'));
  }
});

test('AI prompt is Spanish and preserves clarification, privacy filters and transcript', async () => {
  const { formatAIPrompt } = await formatter;
  const result = formatAIPrompt(lines, 'Revisión', start, info);
  assert.ok(result.includes('Participantes'));
  assert.ok(result.includes('Transcripción realizada por'));
  assert.match(result, /(?:un único mensaje|un solo mensaje|una sola respuesta|una única respuesta)/i);
  assert.match(result, /espera.*respuesta/i);
  assert.match(result, /privad|personal/i);
  assert.match(result, /responsables/i);
  assert.match(result, /plazos/i);
  assert.ok(result.includes('[00:00:13] Manuel: ¡Esto funciona correctamente!'));
  assert.ok(!result.includes('Luis'), 'AI participants are derived from speakers, not attendees');
  const empty = formatAIPrompt([], '', start);
  assert.ok(empty.includes('[POR COMPLETAR]'));
  assert.ok(empty.includes('Google Meet'));
});

test('filename retains stable prefix and local wall-clock time', async () => {
  const { buildFilename } = await formatter;
  assert.equal(buildFilename(start), 'meet-transcript-2026-10-03T12-30-04.txt');
  assert.equal(buildFilename(start, 'md'), 'meet-transcript-2026-10-03T12-30-04.md');
});
