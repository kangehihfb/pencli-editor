# Regression Checklist

Run this checklist after any change in Html options, pointer logic, or panel behavior.

## Correctness
- C1 fast burst passes.
- C2 DOM boundary crossing passes.

## Event Conflict
- E1 draw lock policy passes.
- E2 panel interaction safety passes.

## Performance
- P1 density stress measured at 5, 20, 50.
- P2 motion ON/OFF comparison recorded.

## Documentation
- Results added to `docs/test-results-handwriting.md`.
- If behavior depends on undocumented assumptions, mark them as `추정` in `docs/drei-html-options-review.md`.
