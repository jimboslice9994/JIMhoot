export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

export function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

export function uid(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function sanitizeNickname(raw) {
  return String(raw || '').replace(/[^\w\- ]/g, '').trim().slice(0, 20);
}
