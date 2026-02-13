# Performance Budget

## Scope
Baseline thresholds for prototype stability (solo + realtime multiplayer).

## Targets
- First local app load (cold): **<= 1500ms**
- Static payload budgets:
  - JavaScript total (gzip): **<= 220KB**
  - CSS total (gzip): **<= 70KB**
- Realtime server processing:
  - WS handler p50: **<= 5ms**
  - WS handler p95: **<= 15ms**
- Load-test join latency (multi-room):
  - join p50: **<= 120ms**
  - join p95: **<= 400ms**
- Load-test ping latency:
  - ping p50: **<= 60ms**
  - ping p95: **<= 180ms**
- Memory:
  - idle RSS: **<= 120MB**
  - 100+ users simulated: **<= 250MB**

## Measurement commands
- `npm run bench`
- `npm run bench:ws`
- `npm run load`
- `curl -s http://127.0.0.1:3000/metrics`

## Notes
- Budgets are enforced as engineering guardrails in PR review.
- CI runs check/test/bench/load with a CI-safe load size.
