const TRANSITIONS = {
  LOBBY: new Set(['QUESTION']),
  QUESTION: new Set(['LOCK']),
  LOCK: new Set(['REVEAL']),
  REVEAL: new Set(['LEADERBOARD']),
  LEADERBOARD: new Set(['QUESTION', 'END']),
  END: new Set(['LOBBY']),
};

function canTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.has(to));
}

module.exports = {
  STATES: Object.freeze({
    LOBBY: 'LOBBY',
    QUESTION: 'QUESTION',
    LOCK: 'LOCK',
    REVEAL: 'REVEAL',
    LEADERBOARD: 'LEADERBOARD',
    END: 'END',
  }),
  TRANSITIONS,
  canTransition,
};
