# Performance Baseline (Web/WebView)

## Goal
- Keep handwriting responsiveness stable while floating `Html` overlays are active.

## Baseline Scenarios
- P1: Html density at 5, 20, 50.
- P2: DOM motion ON vs OFF at Html count 20.

## Capture Rules
- Run each scenario for at least 15 seconds of continuous drawing.
- Record perceived latency and jitter severity.
- If available, note browser performance panel metrics.

## Pass Threshold (initial)
- No severe interaction breakage in target operating profile.
- Drawing remains controllable without frequent pointer loss.
- Any degradation must include concrete mitigation in results log.
