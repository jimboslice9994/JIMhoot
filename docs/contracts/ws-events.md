# WebSocket Event Contract (MVP)

## Client -> Server
- `join_room` `{ role, playerId, nickname, roomCode?, deckId?, gameMode?, timerSec? }`
- `rejoin_room` `{ roomCode, playerId, nickname? }`
- `start_game` `{ roomCode, playerId }`
- `submit_answer` `{ roomCode, playerId, questionInstanceId, choice }`
- `next_question` `{ roomCode, playerId }`
- `ping` `{ sentTs }`

## Server -> Client
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
