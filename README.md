# PulseLearn (original learning platform)

PulseLearn is a local-first learning app inspired by modern study/game tools with three modes:
- Real-time multiplayer quiz (host + players)
- Flashcards with spaced repetition and mastery tracking
- Fill-in-the-blank with fuzzy matching + partial credit

## Current status (Milestone 2, chunk 1)
- ✅ Baseline mode shell + routing (`#/solo`, `#/import`, `#/host`, `#/join`)
- ✅ Deck import (CSV + JSON) with validation and row-level reporting
- ✅ Flashcards with SM-2-style scheduling logic
- ✅ Fill-in with normalization + Levenshtein-based close/partial scoring
- ✅ Multiplayer scaffold + lobby + event contract endpoint
- ✅ Feature flags + analytics hooks + safer user-facing error messages
- ✅ Unit tests for learning logic, contract checks, multiplayer state machine, and auth store
- ✅ Auth API (register/login/logout/me) with cookie sessions and auth rate limits

## Architecture snapshot
- **Frontend:** Vanilla JS modules (`public/scripts`) + hash routing
- **Backend:** Node HTTP server + `ws` WebSocket server (`server.js`)
- **Data model:** localStorage for study/user state, server memory for live rooms
- **Feature flags:** server env (`FEATURE_MULTIPLAYER`, `FEATURE_ANALYTICS`, `FEATURE_NEW_SCORING`)

## Folder blueprint
```text
.
├── server.js
├── lib/
│   ├── contracts.js
│   ├── featureFlags.js
│   └── multiplayerState.js
├── tests/
│   ├── contracts.test.js
│   ├── learning.test.js
│   └── state-machine.test.js
├── public/
│   ├── index.html
│   ├── data/
│   ├── styles/main.css
│   └── scripts/
│       ├── app.js
│       ├── importer.js
│       ├── learning.js
│       ├── flashcards.js
│       ├── fillBlank.js
│       ├── soloQuiz.js
│       ├── multiplayerHost.js
│       ├── multiplayerPlayer.js
│       ├── wsClient.js
│       ├── featureFlags.js
│       ├── analytics.js
│       └── ...
└── package.json
```

## Local run
```bash
npm install
npm run check
npm test
npm start
```
Open `http://localhost:3000/#/solo`

## Env vars
```bash
PORT=3000
FEATURE_MULTIPLAYER=true
FEATURE_ANALYTICS=false
FEATURE_NEW_SCORING=true
FEATURE_AUTH=true
ALLOWED_ORIGINS=http://localhost:3000
```

## API + WS contracts
- `GET /healthz`
- `GET /api/feature-flags`
- `GET /api/decks`
- `GET /api/contracts/ws`
- `POST /api/analytics` (best-effort, no UI crash)
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/auth/csrf`

WebSocket events are exposed via `/api/contracts/ws` for contract-level checks.

## Replit deploy
1. Import repo into Replit
2. Run `npm install`
3. Set env vars in Replit Secrets (optional)
4. Run `npm start`

## GitHub + CI
- CI config included in `.github/workflows/ci.yml`
- Push and open PR; CI runs `npm run check` + `npm test`

## Accessibility + UX baseline
- Semantic sections and labels
- Keyboard support for flashcards
- Focus-visible controls and aria-live feedback areas
- User-safe error copy for import failures

## Security/reliability baseline
- Input normalization and validation on client + server
- WS message size limits and event rate limits
- Room caps and idle room reaping
- Structured event logging for multiplayer lifecycle


## Security notes
- Auth uses HttpOnly session cookie plus per-session CSRF token for state-changing auth actions.
- Session tokens are rotated on register/login and expire server-side.
- HTTP and WS endpoints include rate limiting and request payload validation.
- Configure `ALLOWED_ORIGINS` in production to restrict cross-origin API writes.
