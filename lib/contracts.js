const WS_EVENTS = [
  'join_room',
  'rejoin_room',
  'session_info',
  'lobby_state',
  'start_game',
  'question',
  'submit_answer',
  'answer_ack',
  'phase_update',
  'reveal',
  'leaderboard_update',
  'next_question',
  'game_end',
  'error',
];

const STATES = ['LOBBY', 'QUESTION_ACTIVE', 'COLLECT', 'REVEAL', 'LEADERBOARD', 'GAME_END'];

module.exports = { WS_EVENTS, STATES };
