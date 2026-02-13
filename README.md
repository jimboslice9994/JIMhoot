# Household Study Platform

A local-first study app built with vanilla JS + Node + `ws`.

## What it does
- Smooth flip flashcards with self-check (correct/incorrect + redo missed)
- Single-player quiz mode (A/B/C/D) with timer, summary, review missed, and shuffle restart
- Fill-in-the-blank mode with hints and answer feedback
- CSV upload (paste or file) that auto-generates available study modes per deck
- Realtime host/join mode over WebSockets (optional)
- Mobile on-screen debug console for troubleshooting

## Run
```bash
npm install
npm start
```
Open: `http://localhost:3000/#/solo`

## Routes
- `/#/solo` study deck library
- `/#/import` CSV import
- `/#/host` realtime host
- `/#/join` realtime player

## CSV columns
Required:
- `deck_name`

Optional quiz fields:
- `question`, `choice_a`, `choice_b`, `choice_c`, `choice_d`, `correct_choice`, `answer_explanation`

Optional flashcard fields:
- `flashcard_front`, `flashcard_back`

Optional fill-blank fields:
- `fill_blank_sentence`, `fill_blank_answer`

Optional metadata:
- `tags` (pipe-delimited), `difficulty`

Each row can generate one or more modes depending on fields present.

## Household multiplayer performance tips
- For lowest latency, run server on one home device and have everyone join `http://<host-lan-ip>:3000`.
- Keep all devices on same Wi-Fi network and avoid guest-network isolation.
- Host can use **Skip wait / Next** to advance phases faster in live games.
- The app now includes client RTT logging and reconnect counters in host/player views.
