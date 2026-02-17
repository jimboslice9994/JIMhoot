import { getAnalyticsOptIn } from './storage.js';
import { log } from './debug.js';

export function track(event, payload = {}) {
  if (!getAnalyticsOptIn()) return;
  const body = { event, payload, ts: Date.now() };
  log('analytics.event', body);
  fetch('/api/analytics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {
    // swallow in client; debug logger already captured
  });
}
