const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadPopup(response = {}) {
  const nodes = new Map();
  const timers = [];
  const alerts = [];
  const clipboard = [];
  const element = () => {
    const classes = new Set(['hidden']);
    return {
      textContent: '', listeners: {}, children: [],
      classList: { add: c => classes.add(c), remove: c => classes.delete(c),
        contains: c => classes.has(c), toggle: (c, force) => force ? classes.add(c) : classes.delete(c) },
      addEventListener(type, fn) { this.listeners[type] = fn; },
      replaceChildren(...children) { this.children = children; },
    };
  };
  const document = {
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); },
    createElement: element,
  };
  const context = vm.createContext({
    document, navigator: { clipboard: { writeText: async text => clipboard.push(text) } },
    alert: text => alerts.push(text), window: { close() {} },
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; },
    setInterval: () => 1, clearInterval() {}, Date,
    chrome: {
      runtime: {
        sendMessage: async msg => msg.type === 'GET_STATE' ? { isCapturing: false, lineCount: 0 } : response,
        connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }),
        getManifest: () => ({ version: '1.4.21' }),
      },
      tabs: { query: (_query, callback) => callback([{ id: 1, url: 'https://meet.google.com/test' }]), reload() {} },
      storage: { local: { get: async () => ({ updateCheck: { ts: Date.now(), tag: 'v9.0.0' } }) } },
    },
    fetch: () => { throw new Error('Unexpected network access in popup tests'); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../popup/popup.js'), 'utf8'), context);
  return { context, nodes, timers, alerts, clipboard };
}

test('popup HTML exposes Spanish controls, consent and document language', () => {
  const html = fs.readFileSync(path.join(__dirname, '../popup/popup.html'), 'utf8');
  assert.match(html, /<html lang="es">/);
  for (const label of ['Iniciar transcripción', 'Detener transcripción', 'Descargar .txt',
    'Descargar .md', 'Copiar prompt para IA', 'Descartar', 'participantes', 'subtítulos']) {
    assert.ok(html.includes(label), `Missing Spanish UI text: ${label}`);
  }
});

test('line counter handles zero, singular and plural in Spanish', () => {
  const { context } = loadPopup();
  for (const [count, expected] of [[0, '0 intervenciones capturadas'], [1, '1 intervención capturada'], [2, '2 intervenciones capturadas']]) {
    assert.equal(vm.runInContext(`lineCountText(${count})`, context), expected);
  }
});

test('waiting statuses explain caption activation in Spanish', () => {
  const { context, nodes } = loadPopup();
  for (const [action, expected] of [['clicked', /Subtítulos activados/], ['already_on', /subtítulos.*activos/i], ['', /Esperando subtítulos/]]) {
    context.state = { ccAction: action, ccWarning: false };
    vm.runInContext('renderWaiting(state)', context);
    assert.match(nodes.get('waiting-message').textContent, expected);
  }
});

test('copy feedback and two-second restoration remain Spanish', async () => {
  const { nodes, timers, clipboard } = loadPopup({ content: 'Contenido privado' });
  await nodes.get('btn-copy-prompt').listeners.click();
  assert.deepEqual(clipboard, ['Contenido privado']);
  assert.equal(nodes.get('btn-copy-prompt').textContent, '¡Copiado!');
  assert.equal(timers[0].delay, 2000);
  timers[0].fn();
  assert.equal(nodes.get('btn-copy-prompt').textContent, 'Copiar prompt para IA');
});

test('localized START failure uses stable error code to show reload view', async () => {
  const { nodes, alerts } = loadPopup({ errorCode: 'MEET_TAB_UNREACHABLE', error: 'No se pudo conectar con la pestaña de Meet.' });
  await nodes.get('btn-start').listeners.click();
  assert.equal(nodes.get('view-reload').classList.contains('hidden'), false);
  assert.deepEqual(alerts, []);
});

test('cached update notice renders Spanish without network access', async () => {
  const { context, nodes } = loadPopup();
  await vm.runInContext('checkForUpdate()', context);
  const link = nodes.get('footer-update').children[0];
  assert.equal(link.textContent, 'v9.0.0 disponible');
  assert.equal(link.rel, 'noopener');
});
