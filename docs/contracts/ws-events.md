# WebSocket Event Contract (MVP)

## Client -> Server
- `join_room` `{ role, playerId, nickname, roomCode?, deckId?, gameMode?, timerSec? }`
- `rejoin_room` `{ roomCode, playerId, reconnectKey, nickname? }`
- `start_game` `{ roomCode }`
- `submit_answer` `{ roomCode, questionInstanceId, choice }`
- `next_question` `{ roomCode }`
- `ping` `{ sentTs }`

## Server -> Client
- `session_info` `{ roomCode, playerId, reconnectKey }`
- `lobby_state`
- `question`
- `answer_ack`
- `phase_update`
- `reveal`
- `leaderboard_update`
- `game_end`
- `error`
- `pong`

## State lifecycle
`LOBBY -> QUESTION_ACTIVE -> COLLECT -> REVEAL -> LEADERBOARD -> (QUESTION_ACTIVE | GAME_END)`
