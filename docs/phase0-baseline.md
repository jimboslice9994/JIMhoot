# Phase 0 Baseline Audit + Performance Budgets

## Repo Tree (current)
```text
LICENSE
README.md
app.js
docs/contracts/ws-events.md
docs/phase0-baseline.md
index.html
lib/authStore.js
lib/contracts.js
lib/featureFlags.js
lib/metrics.js
lib/multiplayerState.js
package-lock.json
package.json
public/data/decks.json
public/data/sample_flashcards.json
public/data/sample_mcq.json
public/index.html
public/scripts/analytics.js
public/scripts/app.js
public/scripts/auth.js
public/scripts/csv.js
public/scripts/debug.js
public/scripts/decks.js
public/scripts/featureFlags.js
public/scripts/fillBlank.js
public/scripts/flashcards.js
public/scripts/importer.js
public/scripts/learning.js
public/scripts/multiplayerHost.js
public/scripts/multiplayerPlayer.js
public/scripts/router.js
public/scripts/soloQuiz.js
public/scripts/storage.js
public/scripts/utils.js
public/scripts/wsClient.js
public/styles/main.css
scripts/bench.js
server.js
styles.css
tests/authStore.test.js
tests/contracts.test.js
tests/learning.test.js
tests/metrics.test.js
tests/security-http.test.js
tests/security-ws-authz.test.js
tests/state-machine.test.js
```

## Entry points and architecture summary
- Backend entrypoint: `server.js` (HTTP + WebSocket on `/ws`).
- Frontend entrypoint: `public/index.html` loading `public/scripts/app.js`.
- Storage:
  - auth user store: local file `.data/users.json` via `lib/authStore.js`
  - multiplayer room/session state: in-memory Maps in `server.js`
  - solo progress: browser `localStorage` via frontend storage module
- Primary HTTP routes:
  - `/healthz`, `/metrics`
  - `/api/auth/*`, `/api/feature-flags`, `/api/decks`, `/api/contracts/ws`, `/api/analytics`
- Primary WS events:
  - inbound: `join_room`, `rejoin_room`, `start_game`, `submit_answer`, `next_question`, `ping`
  - outbound: `lobby_state`, `question`, `answer_ack`, `phase_update`, `reveal`, `leaderboard_update`, `game_end`, `error`, `pong`

## Performance budget targets (prototype)
- First local load (cold): <= 1.5s on developer laptop.
- Static asset budget:
  - JS total (gzip target): <= 220KB
  - CSS total (gzip target): <= 70KB
- Server handling target:
  - WS event handling p95: <= 15ms (single node process baseline)
- Memory targets:
  - idle server RSS: <= 120MB
  - with 20 active rooms / 100 users aggregate: <= 220MB RSS

## Drop-in observability added
- `lib/metrics.js` tracker for:
  - process memory
  - event loop lag p50/p95/max
  - WS message counts by event
  - WS handling latency p50/p95
- New endpoint:
  - `GET /metrics` returns JSON snapshot suitable for local diagnostics.

## Prioritized TODO after Phase 0
1. Add per-room metrics slices (players, current phase dwell duration).
2. Add lightweight load test for WS answer bursts (50-200 clients).
3. Add budget assertions in CI (`bench` threshold gate warning-only first).
4. Add static asset size check script.

## Phase 0 acceptance criteria
- [x] Repo tree documented.
- [x] Entrypoints/routes/events/storage documented.
- [x] Performance budgets documented.
- [x] Metrics module added as drop-in.
- [x] `/metrics` endpoint added.
- [x] `npm run bench` script added and runnable.
- [x] Metrics test added and all tests passing.


## Extended-run additions
- Structured JSON request logs now include `eventType` and `requestId`; room-aware events include `roomId`.
- Load harness added: `npm run load` for multi-room WS stress checks.
- On-demand synthetic data generator added: `npm run gen:data` (writes under `.data/`).
- CI now runs check, test, bench, ws bench, and load (CI-safe scale).
