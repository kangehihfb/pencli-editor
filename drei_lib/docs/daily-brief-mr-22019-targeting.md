# MR-22019 Daily Brief (Target/Event Validation)

## Why this test exists
- Goal: verify pointer target ownership when `WebGL` drawing and `drei Html` overlays overlap.
- Reason: in production-like editor flows (embedded content, floating panels), input conflicts can break handwriting continuity.
- Product intent: keep WebGL as scene core, but allow selective DOM interactivity without breaking draw correctness.

## What we learned so far
- `Html` in drei is rendered as DOM overlay above the canvas.
- Therefore, WebGL strokes cannot visually render above `Html` elements.
- If DOM overlay is interactive, it can steal pointer start (`pointerdown`) unless explicitly controlled.
- Conclusion: overlap conflicts are expected unless we define ownership policy by mode.

## Decision frame for team
- **Draw mode**
  - Owner: WebGL drawing layer.
  - Rule: DOM overlays are pass-through (`pointer-events: none`).
  - Success: no segment loss while crossing overlay regions.
- **Edit mode**
  - Owner: DOM widgets/panels.
  - Rule: drawing paused or locked.
  - Success: widgets interactive with no phantom strokes.

## Candidate architectures
- **A. Hybrid (recommended now)**
  - WebGL: scene + drawing core.
  - DOM: inspector/forms/embedded media.
  - Mode switch controls event ownership.
  - Pros: fastest path to stable behavior.
- **B. Full canvas interaction (Figma-like direction)**
  - Move most in-canvas interactive overlays to WebGL objects.
  - Keep only heavy app chrome in DOM.
  - Pros: unified event/render pipeline; fewer overlap edge-cases.
  - Cost: higher implementation complexity for rich UI.

## Validation checkpoints (for reporting)
- C1: fast short-stroke burst (10s).
- C2: repeated crossing over floating overlay boundaries.
- E1: draw/edit mode toggling and ownership handoff.
- E2: panel click then immediate draw resume.
- P1: overlay density 5/20/50 with continuity check.

## Pass/Fail criteria for tomorrow update
- Pass if:
  - Draw mode has no major pointer loss across overlays.
  - Edit mode has stable DOM interactivity and no phantom draw segments.
  - Density test identifies a usable default profile (5/20/50).
- Fail if:
  - Ownership ambiguity persists (random steals between DOM/WebGL).
  - Visual/interaction mismatch blocks practical handwriting.

## Talking points for daily
- "This is not a single bug; it's a layering ownership problem."
- "Current prototype proved the constraint: `Html` is above canvas by design."
- "Next step is policy-first: mode-based ownership, then tune performance."
- "Recommend hybrid baseline now, keep full-canvas path as phase 2."
