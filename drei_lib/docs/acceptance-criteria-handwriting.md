# Handwriting Acceptance Criteria (P0)

## Scope
- Target: Web and WebView.
- Rendering context: `@react-three/fiber` `Canvas` + `@react-three/drei` `Html`.
- Priority: input correctness over visual effects.

## Layer Model
- **DrawingLayer**: full-screen 2D drawing input layer (authoritative for strokes).
- **SceneLayer**: minimal R3F scene host for layout and interoperability tests.
- **DomOverlayLayer**: floating UI rendered with `Html` for overlap stress tests.

## Event Priority Rules
1. When drawing is active, pointer ownership stays on `DrawingLayer` until stroke ends.
2. Floating DOM controls can receive hover/click, but must not break active stroke capture.
3. If pointer enters/exits DOM islands during draw, stroke continuity is preserved.
4. UI actions that intentionally lock drawing must set and clear lock state explicitly.

## Pass Criteria
1. **No pointer loss during draw**
   - No dropped segments while moving across fast paths and boundaries.
2. **No input conflict with DOM widgets**
   - Hover/click on floating widgets does not create phantom draw events.
3. **No severe frame drop during continuous drawing**
   - Under repeated drawing with floating DOM enabled, interaction remains smooth.

## Required Scenarios
- Fast short-stroke burst (10s).
- Edge crossing (drag near viewport edges and back).
- Repeated DOM enter/leave while drawing.
- Draw-lock toggling via panel actions.
- DOM stress level comparison (`Html` count: 5, 20, 50).

## Measurement Template
- Environment: browser/WebView, OS, input device.
- Scenario: test case name.
- Expected: criterion target.
- Actual: observed behavior.
- Delta: mismatch summary.
- Action: mitigation or follow-up.
