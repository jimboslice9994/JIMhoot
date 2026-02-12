# Household Study Platform

Vanilla JS + Node + `ws` study app with:
- Solo flashcards + solo MCQ quiz
- Kahoot-style realtime host/player rooms
- CSV import (paste text or upload file)
- Mobile on-screen debug console

## Run
```bash
npm install
npm start
```
Open `http://localhost:3000/#/solo`.

## Routes
- `/#/solo`
- `/#/host`
- `/#/join`
- `/#/import`

## Notes
- No accounts / no database.
- Imported decks and personal stats are in `localStorage`.
- Multiplayer rooms are server-memory only.
- Service worker is intentionally not used to avoid stale cache issues.
