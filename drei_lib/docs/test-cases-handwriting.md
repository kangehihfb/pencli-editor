# Handwriting Test Cases (3-axis)

This checklist follows the P1 test axes:
- correctness
- event conflict
- performance

## Environment Record
- Browser / WebView:
- OS:
- Device:
- Input device (mouse, pen, touch):
- Build hash or branch:

## Correctness Axis

### C1. Fast short-stroke burst
- Setup: draw lock OFF, DOM animation OFF, Html count = 5.
- Steps:
  1. Draw short strokes continuously for 10 seconds.
  2. Traverse center and edge zones repeatedly.
  3. Verify continuity after stop.
- Expected:
  - No pointer loss during draw.
  - No unnatural gaps caused by event loss.

### C2. DOM boundary crossing
- Setup: draw lock OFF, DOM animation ON, Html count = 20.
- Steps:
  1. Start drawing in free area.
  2. Cross floating Html elements multiple times.
  3. Return to free area and continue same stroke.
- Expected:
  - Stroke continuity preserved.
  - No accidental UI side effect during crossing.

## Event Conflict Axis

### E1. Draw lock behavior
- Setup: use floating panel lock button.
- Steps:
  1. Set lock ON and attempt drawing.
  2. Set lock OFF and draw immediately.
  3. Repeat quickly.
- Expected:
  - Lock ON blocks draw events.
  - Lock OFF restores draw instantly.

### E2. Panel interaction safety
- Setup: DOM animation ON, Html count = 20.
- Steps:
  1. Click slider/button controls.
  2. Resume drawing right after click.
  3. Repeat with fast alternation.
- Expected:
  - Panel remains interactive.
  - No phantom stroke fragments from UI clicks.

## Performance Axis

### P1. Html density stress
- Setup: same draw pattern, count = 5 -> 20 -> 50.
- Steps:
  1. Draw 15 seconds at each count.
  2. Note latency and visual smoothness.
  3. Compare pass/fail threshold across counts.
- Expected:
  - No severe frame drop at target level.
  - Input remains practically usable.

### P2. DOM motion comparison
- Setup: Html count = 20.
- Steps:
  1. Draw 15 seconds with motion ON.
  2. Draw 15 seconds with motion OFF.
  3. Compare responsiveness.
- Expected:
  - Motion OFF should not degrade performance.
  - If ON degrades quality, mitigation is logged.

## Pass Gate
- All C/E tests pass without critical defects.
- P tests document acceptable target level and fallback.
- Failing cases must be copied to `docs/test-results-handwriting.md`.
