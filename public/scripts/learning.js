export function normalizeAnswer(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a, b) {
  const s = normalizeAnswer(a);
  const t = normalizeAnswer(b);
  const m = s.length;
  const n = t.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i += 1) dp[i][0] = i;
  for (let j = 0; j <= n; j += 1) dp[0][j] = j;

  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return dp[m][n];
}

export function evaluateFillBlank(input, target, synonyms = [], maxDistance = 1) {
  const normalizedInput = normalizeAnswer(input);
  const candidates = [target, ...synonyms].map(normalizeAnswer).filter(Boolean);
  if (!normalizedInput || !candidates.length) return { score: 0, status: 'incorrect' };

  if (candidates.includes(normalizedInput)) return { score: 1, status: 'exact' };

  const minDist = Math.min(...candidates.map((candidate) => levenshtein(normalizedInput, candidate)));
  if (minDist <= maxDistance) return { score: 0.75, status: 'close' };
  if (candidates.some((candidate) => candidate.includes(normalizedInput) || normalizedInput.includes(candidate))) {
    return { score: 0.5, status: 'partial' };
  }

  return { score: 0, status: 'incorrect' };
}

export function sm2Schedule(prev = {}, quality = 3, nowTs = Date.now()) {
  const clampedQ = Math.max(0, Math.min(5, quality));
  const repetition = Number(prev.repetition || 0);
  const ef = Number(prev.easeFactor || 2.5);
  const interval = Number(prev.intervalDays || 0);

  const nextEf = Math.max(1.3, ef + (0.1 - (5 - clampedQ) * (0.08 + (5 - clampedQ) * 0.02)));
  let nextRepetition = repetition;
  let nextInterval = interval;

  if (clampedQ < 3) {
    nextRepetition = 0;
    nextInterval = 1;
  } else {
    nextRepetition += 1;
    if (nextRepetition === 1) nextInterval = 1;
    else if (nextRepetition === 2) nextInterval = 3;
    else nextInterval = Math.round(interval * nextEf || 6);
  }

  const dueAt = nowTs + nextInterval * 24 * 60 * 60 * 1000;
  return {
    repetition: nextRepetition,
    easeFactor: Number(nextEf.toFixed(3)),
    intervalDays: nextInterval,
    dueAt,
  };
}
