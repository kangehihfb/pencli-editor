# drei Html Options Review

## Official Facts (from docs)
Reference:
- https://drei.docs.pmnd.rs/misc/html
- https://drei.docs.pmnd.rs/getting-started/introduction

The following points are direct doc-backed behavior:
- `Html` ties DOM content to objects in the 3D scene and projects position automatically.
- `zIndexRange` controls z-order; default range is `[16777271, 0]`.
- `transform` enables matrix3d-based transforms.
- `sprite` works only when `transform` mode is enabled.
- `fullscreen` and `center` are ignored in `transform` mode.
- `occlude` can hide Html behind geometry.
- `occlude="blending"` enables blending-style occlusion behavior.
- In blending mode, default occlusion shape is rectangle unless custom `geometry` is provided.
- With `transform`, size depends on camera position/FOV and `distanceFactor`.
- Transform mode may appear blurry on some devices; docs mention scale-down parent and scale-up child as a mitigation.

## Plan for This Sandbox

### Selected options
- Use `Html` with `transform` for floating stress widgets.
- Use explicit `zIndexRange` per panel to control overlap with drawing layer.
- Keep `occlude` disabled for the base handwriting tests to isolate input conflicts first.

### Deferred options
- `occlude` and `occlude="blending"` are deferred to phase-2 experiments after base input stability.
- `material`, `castShadow`, and `receiveShadow` are out of scope for current P0/P1 input tests.

## Assumptions (추정)
- **추정:** Large counts of moving `Html` islands can increase style/layout cost and indirectly affect pointer responsiveness.
- **추정:** In WebView, transform-heavy Html may show stronger blur or micro-jank than desktop browsers.
- **추정:** For handwriting-first UX, reducing `Html` motion should improve perceived latency under stress.

## Validation Notes
- Every time an Html option is changed, run:
  - correctness tests (`C1`, `C2`)
  - event conflict tests (`E1`, `E2`)
  - performance tests (`P1`, `P2`)
- Record outcomes in `docs/test-results-handwriting.md` using the fixed 5-field format.
