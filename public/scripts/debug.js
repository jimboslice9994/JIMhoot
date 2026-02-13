const logEl = () => document.getElementById('debug-log');
let enabled = true;
const MAX_LINES = 200;

export function initDebugConsole() {
  const toggle = document.getElementById('debug-toggle');
  const box = document.getElementById('debug-console');
  const clear = document.getElementById('debug-clear');

  toggle?.addEventListener('click', () => box?.classList.toggle('hidden'));
  clear?.addEventListener('click', () => {
    const el = logEl();
    if (el) el.textContent = '';
  });

  window.addEventListener('error', (e) => log('window.error', { msg: e.message }));
  window.addEventListener('unhandledrejection', (e) => log('promise.rejection', { msg: String(e.reason) }));
}

export function log(type, payload = {}) {
  if (!enabled) return;
  const line = `${new Date().toISOString()} ${type} ${JSON.stringify(payload)}`;
  const el = logEl();
  if (!el) return;

  const lines = `${el.textContent}${line}\n`.split('\n');
  const trimmed = lines.slice(Math.max(0, lines.length - MAX_LINES - 1)).join('\n');
  el.textContent = trimmed;
  el.scrollTop = el.scrollHeight;
  console.log(line);
}

export function setDebugEnabled(v) {
  enabled = Boolean(v);
}
