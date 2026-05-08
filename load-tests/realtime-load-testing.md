# Realtime Load Testing

This is the lightweight path for checking 20, 50, 100, or more realtime ink users without Docker.

## What This Runs

`scripts/realtime-fleet.mjs` uses Playwright to open many real Chromium clients in the same room.

- `--users=100` means 100 app clients connect to the same realtime room.
- `--headed=4` means 4 clients are visible browser windows, and the rest run headless.
- `--headless-browsers=4` splits headless clients across 4 Chromium processes.
- `--mode=draw` makes every virtual client draw random strokes.
- `--draw-after-ready=1` waits until startup finishes before synthetic drawing begins.
- `--preflight=1` checks Socket.IO auth once before launching the browser fleet.
- `--wait-realtime=1` waits until each client reaches Socket.IO `connected`.
- `--app-metrics=1` collects in-app FPS, frame time, Yjs, WebGL, stroke, point, and object metrics.
- The printed manual URL lets you join the same room from your own browser and interact with the fleet.

This is lighter than Selenoid/Selenium Grid, but it is not a replacement for a multi-machine browser grid. If `--headed=100` is used, the local PC can become the bottleneck before the app does.

## Run

Start the handwriting backend and frontend first.

Generate a local JWT from the handwriting backend:

```sh
cd /Users/mildang/Desktop/mildang-backend-study-activity/mildang-backend-handwriting
node -e "const jwt = require('jsonwebtoken'); const secret = process.env.JWT_SECRET || 'set-your-local-jwt-secret'; console.log(jwt.sign({ sub: 'local-load-test', scope: 'handwriting' }, secret, { expiresIn: '12h' }));"
```

Run a 20-user test:

```sh
cd /Users/mildang/Desktop/pentest/pentest
INK_TOKEN="paste-jwt-here" npm run load:realtime-fleet -- --users=20 --headed=4 --room=load-test-20
```

Run 50 or 100 users:

```sh
INK_TOKEN="paste-jwt-here" npm run load:realtime-fleet -- --users=50 --headed=4 --headless-browsers=2 --room=load-test-50
INK_TOKEN="paste-jwt-here" npm run load:realtime-fleet -- --users=100 --headed=6 --headless-browsers=4 --room=load-test-100
```

For connection-only load, without synthetic drawing:

```sh
INK_TOKEN="paste-jwt-here" npm run load:realtime-fleet -- --users=100 --headed=4 --mode=idle --room=load-test-idle
```

## Read The Result

The script logs:

- ready users
- connected users
- failed users
- total synthetic strokes
- browser console warnings/errors
- min/average/max FPS
- worst p95 frame time
- stroke/point/object consistency across clients
- local runner RSS memory
- host load average

It also writes a JSON report under:

```txt
export-results/realtime-fleet/
```

The report has a top-level `verdict`:

```json
{
  "verdict": {
    "pass": false,
    "issues": [
      "slowest client FPS 18.4 is below 25",
      "client state differs: strokes=120/119"
    ]
  }
}
```

Default pass thresholds:

- ready rate: `99%`
- connected rate: `99%`
- slowest client FPS: `>= 25`
- worst client p95 frame: `<= 80ms`
- console/page messages per client: `0`
- average points per stroke: `<= 120`
- stroke/object/image/Yjs counts should be consistent across sampled clients

Adjust thresholds per run:

```sh
INK_TOKEN="paste-jwt-here" npm run load:realtime-fleet -- \
  --users=100 \
  --headed=6 \
  --headless-browsers=4 \
  --room=load-test-100 \
  --ramp=60000 \
  --startup-timeout=90000 \
  --realtime-timeout=90000 \
  --min-fps=20 \
  --max-p95-frame=100 \
  --max-client-messages=2
```

Use the manual URL printed at startup to join the same room as a teacher/client while the fleet is running.

## Recommended Steps

1. Run `--users=20 --headed=4 --mode=draw`.
2. Join with the manual URL and draw/move/rotate objects.
3. Run `--users=50 --headed=4 --mode=draw`.
4. Run `--users=100 --headed=6 --mode=idle`.
5. Run `--users=100 --headed=6 --mode=draw`.

If idle mode is stable but draw mode is unstable, the likely bottleneck is message volume, stroke commit, Yjs update fanout, or rendering. If both idle and draw modes are unstable, check socket connection scaling, auth, room join, and backend process resources first.

## If Every User Fails With `Realtime status is error`

That usually means the browser opened the app, but Socket.IO auth failed.

Check these first:

- `INK_TOKEN` is not empty and is not the literal placeholder `JWT`.
- The token was generated with the same `JWT_SECRET` as the running handwriting backend.
- The token has not expired.
- `--server` points to the handwriting backend, not the frontend.

The script runs a Socket.IO preflight by default, so token/server mistakes should fail before opening 100 browser clients.

## If Failures Start Around 30 Users

Errors like these usually mean the local load generator or dev server is saturated during startup:

- `locator.click: Timeout ... waiting for getByRole('button', { name: '펜' })`
- `locator.waitFor: Timeout ... .stage-canvas-shell`
- `page.waitForFunction: Timeout ...`

Use a slower startup ramp and longer timeouts:

```sh
INK_TOKEN="paste-jwt-here" npm run load:realtime-fleet -- \
  --users=100 \
  --headed=6 \
  --headless-browsers=4 \
  --room=load-test-100 \
  --ramp=60000 \
  --startup-timeout=90000 \
  --realtime-timeout=90000 \
  --tool-timeout=60000
```

For pure connection tests, avoid selecting the pen tool:

```sh
INK_TOKEN="paste-jwt-here" npm run load:realtime-fleet -- \
  --users=100 \
  --mode=idle \
  --click-pen=0 \
  --room=load-idle-100
```
