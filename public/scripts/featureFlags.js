import { safeJsonParse } from './utils.js';

let cached = null;

export async function loadFeatureFlags() {
  if (cached) return cached;
  try {
    const res = await fetch('/api/feature-flags', { cache: 'no-store' });
    cached = res.ok ? await res.json() : { multiplayer: true, analytics: false, newScoring: true };
  } catch {
    cached = { multiplayer: true, analytics: false, newScoring: true };
  }
  return cached;
}

export function getFeatureFlagsFromLocalStorage() {
  return safeJsonParse(localStorage.getItem('study.featureFlags') || '{}', {});
}
