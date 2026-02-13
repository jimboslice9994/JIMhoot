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

export function normalizeText(raw) {
  return String(raw || '').trim().toLowerCase();
}

export function shuffleArray(input) {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
