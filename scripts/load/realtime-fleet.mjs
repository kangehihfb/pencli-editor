import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { io } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const defaultViewport = {
  width: 1280,
  height: 820,
};

const defaultDurationMs = 180_000;
const defaultDrawIntervalMs = 4500;
const defaultDrawErrorBackoffMs = 15_000;
const defaultMetricsTimeoutMs = 5000;
const defaultStopTimeoutMs = 10_000;
const defaultMaxDrawConcurrency = Math.max(
  2,
  Math.min(6, Math.ceil(os.cpus().length / 2)),
);

const helpText = `
Realtime ink browser fleet

Runs many real Chromium clients in the same realtime ink room.
Use this for 20/50/100-user local load checks without Docker/Selenoid.

Usage:
  npm run load:realtime-fleet -- --users=100 --headed=4 --room=load-room --token="$INK_TOKEN"
  node scripts/load/realtime-fleet.mjs --users=100 --headed=4

Options:
  --url=<url>              Frontend URL. Default: http://127.0.0.1:5178/
  --server=<url>           Realtime ink server URL. Default: http://127.0.0.1:3000
  --token=<jwt>            Handwriting server JWT. Or set INK_TOKEN.
  --room=<room-id>         Shared room id. Default: load:<timestamp>
  --actor-prefix=<prefix>  Actor id prefix. Use a different prefix per machine.
  --users=<n>              Total virtual browser clients. Default: 20
  --headed=<n>             Visible browser windows. Default: 2
  --headless-browsers=<n>  Headless browser process shards. Default: up to 4
  --mode=<idle|draw>       idle only joins room, draw also runs the selected scenario. Default: draw
  --scenario=<pen|text|mixed> Synthetic browser action profile. Default: pen
  --text-every-strokes=<n> In mixed mode, selected clients add text every n strokes. Default: 3
  --duration=<ms>          Run duration. Default: ${defaultDurationMs}
  --draw-interval=<ms>     Delay between strokes per drawing client. Default: ${defaultDrawIntervalMs}
  --draw-concurrency=<n>   Max simultaneous synthetic stroke actions. Default: ${defaultMaxDrawConcurrency}
  --draw-error-backoff=<ms> Extra recovery delay after draw errors. Default: ${defaultDrawErrorBackoffMs}
  --draw-after-ready=<0|1> Start synthetic drawing after all clients launch. Default: 1
  --ramp=<ms>              Total user startup ramp time. Default: 10000
  --settle=<ms>            Wait after stopping synthetic input before collecting metrics. Default: 2000
  --metrics-timeout=<ms>   Max wait per client for app metrics. Default: ${defaultMetricsTimeoutMs}
  --stop-timeout=<ms>      Max wait for synthetic input loops to stop. Default: ${defaultStopTimeoutMs}
  --startup-timeout=<ms>   Wait for the editor canvas to render. Default: 60000
  --realtime-timeout=<ms>  Wait for Socket.IO connected status. Default: 60000
  --tool-timeout=<ms>      Wait for toolbar tool selection. Default: 30000
  --click-pen=<0|1>        Select the pen tool for clients. Default: enabled in draw mode
  --receive-trace-sample-rate=<n> Frontend receive span sample rate. Default: 1
  --app-metrics=<0|1>      Collect in-app FPS/Yjs/WebGL/canvas metrics. Default: 1
  --probe=<0|1>            Show app perf probe UI in fleet clients. Default: 0
  --debug=<0|1>            Enable app ink debug query flag. Default: 0
  --preflight=<0|1>        Check Socket.IO auth before launching browsers. Default: 1
  --wait-realtime=<0|1>    Wait until each client reaches realtime connected. Default: 1
  --min-ready-rate=<n>     Pass threshold for ready clients. Default: 0.99
  --min-fps=<n>            Pass threshold for slowest client FPS. Default: 25
  --max-p95-frame=<ms>     Pass threshold for worst client p95 frame. Default: 80
  --max-client-messages=<n> Pass threshold for console/page errors per client. Default: 0
  --max-average-points=<n> Pass threshold for average points per stroke. Default: 120
  --report=<path>          JSON report path. Default: export-results/realtime-fleet/<timestamp>.json
  --help                   Show this help.
`;

function parseArguments(argv) {
  const result = {};

  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }

    if (!argument.startsWith("--")) continue;
    const [rawKey, ...rawValue] = argument.slice(2).split("=");
    const key = rawKey.trim();
    const value = rawValue.length > 0 ? rawValue.join("=") : "true";
    result[key] = value;
  }

  return result;
}

function parseInteger(value, fallback, minimum = 0) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  if (value === true) return true;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function createSemaphore(limit) {
  let active = 0;
  const queue = [];

  return async function runWithSlot(task) {
    if (active >= limit) {
      await new Promise((resolve) => {
        queue.push(resolve);
      });
    }

    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      queue.shift()?.();
    }
  };
}

function isUsableBox(box) {
  return (
    box &&
    Number.isFinite(box.x) &&
    Number.isFinite(box.y) &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width > 1 &&
    box.height > 1
  );
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForSettledWithTimeout(promises, timeoutMs) {
  const settled = Promise.allSettled(promises);
  const result = await Promise.race([
    settled.then(() => "settled"),
    sleep(timeoutMs).then(() => "timeout"),
  ]);

  return result;
}

async function withTimeout(promise, timeoutMs, makeError) {
  if (timeoutMs <= 0) return promise;

  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(makeError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function redactSensitiveText(value) {
  return String(value ?? "")
    .replaceAll(/([?&](?:token|inkToken)=)[^&\s'"]+/g, "$1[redacted]")
    .replaceAll(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[jwt-redacted]",
    );
}

function shouldRecordConsoleMessage(text) {
  if (text.includes("GPU stall due to ReadPixels")) return false;
  if (
    text.includes("/handwriting/socket.io/") &&
    text.includes("WebSocket is closed before the connection is established")
  ) {
    return false;
  }
  return true;
}

function pushClientMessage(client, message) {
  client.messages.push({
    ...message,
    text: redactSensitiveText(message.text),
  });
}

function formatSocketError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const details =
    typeof error === "object" && error !== null && "description" in error
      ? ` (${String(error.description)})`
      : "";
  return redactSensitiveText(`${message}${details}`);
}

function makeRunId() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function makeClientUrl(config, index) {
  const url = new URL(config.url);
  url.searchParams.set("realtimeInk", "1");
  url.searchParams.set("inkServer", config.server);
  url.searchParams.set("inkRoom", config.room);
  url.searchParams.set("inkToken", config.token);
  url.searchParams.set("inkActor", `${config.actorPrefix}-${index + 1}`);
  url.searchParams.set("inkRole", config.role);
  url.searchParams.set(
    "perfProbe",
    config.appMetrics || config.probe ? "1" : "0",
  );
  url.searchParams.set(
    "inkDebug",
    config.debug || config.waitRealtime ? "1" : "0",
  );
  url.searchParams.set(
    "inkTraceReceiveSampleRate",
    String(config.receiveTraceSampleRate),
  );
  return url.toString();
}

function makeManualUrl(config) {
  const url = new URL(config.url);
  url.searchParams.set("realtimeInk", "1");
  url.searchParams.set("inkServer", config.server);
  url.searchParams.set("inkRoom", config.room);
  url.searchParams.set("inkToken", config.token);
  url.searchParams.set("inkActor", `${config.actorPrefix}-manual`);
  url.searchParams.set("inkRole", "teacher");
  url.searchParams.set("perfProbe", "1");
  url.searchParams.set("inkDebug", "1");
  return url.toString();
}

function shouldRunScenarioStep(client, scenarioStep) {
  if (scenarioStep === "pen") return true;
  if (scenarioStep === "text") return client.index % 10 === 0;
  return false;
}

function getWindowPosition(index, width, height) {
  const columns = 3;
  const x = (index % columns) * Math.floor(width * 0.7);
  const y = Math.floor(index / columns) * Math.floor(height * 0.72);
  return { x, y };
}

async function launchChromium(headless, index, config) {
  const windowPosition = getWindowPosition(
    index,
    config.viewport.width,
    config.viewport.height,
  );
  const args = [
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    `--window-size=${config.viewport.width},${config.viewport.height}`,
    `--window-position=${windowPosition.x},${windowPosition.y}`,
  ];

  try {
    return await chromium.launch({ headless, args });
  } catch (error) {
    console.warn(
      "[realtime-fleet] Bundled Chromium launch failed. Falling back to local Chrome.",
    );
    console.warn(error instanceof Error ? error.message : error);
    return chromium.launch({ headless, channel: "chrome", args });
  }
}

async function runSocketPreflight(config) {
  await new Promise((resolve, reject) => {
    const socket = io(config.server, {
      path: "/handwriting/socket.io/",
      transports: ["websocket"],
      query: {
        token: config.token,
      },
      forceNew: true,
      reconnection: false,
      timeout: 8000,
    });

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("Socket.IO preflight timed out after 8000ms."));
    }, 9000);

    socket.on("connect", () => {
      socket.emit("join-room", config.room);
      clearTimeout(timeout);
      socket.close();
      resolve();
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(
        new Error(`Socket.IO preflight connect_error: ${formatSocketError(error)}`),
      );
    });
  });
}

async function measureCanvasShell(page, timeoutMs) {
  const locator = page.locator(".stage-canvas-shell").first();
  await locator.waitFor({
    state: "visible",
    timeout: timeoutMs,
  });

  const boundingBoxTimeoutMs = Math.min(timeoutMs, 10_000);
  const boundingBox = await locator
    .boundingBox({
      timeout: boundingBoxTimeoutMs,
    })
    .catch(() => undefined);
  if (isUsableBox(boundingBox)) return boundingBox;

  const rect = await locator.evaluate(
    (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        x: bounds.left + window.scrollX,
        y: bounds.top + window.scrollY,
        width: bounds.width,
        height: bounds.height,
      };
    },
    undefined,
    { timeout: boundingBoxTimeoutMs },
  );

  if (!isUsableBox(rect)) {
    throw new Error("Missing stage canvas shell bounds.");
  }

  return rect;
}

async function preparePage(page, client, config) {
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const text = message.text();
      if (!shouldRecordConsoleMessage(text)) return;
      pushClientMessage(client, {
        type: message.type(),
        text,
        at: Date.now(),
      });
    }
  });

  page.on("pageerror", (error) => {
    pushClientMessage(client, {
      type: "pageerror",
      text: error instanceof Error ? error.message : String(error),
      at: Date.now(),
    });
  });

  const url = makeClientUrl(config, client.index);
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: config.startupTimeoutMs,
  });
  await page.locator(".stage-canvas-shell").waitFor({
    state: "visible",
    timeout: config.startupTimeoutMs,
  });
  await page.addStyleTag({
    content: `
      #leva__root,
      .r3f-perf-debug${config.debug ? "" : ", .realtime-ink-status"}${
        config.probe ? "" : ", .realtime-ink-perf-probe"
      } {
        display: none !important;
      }
    `,
  });
  if (config.waitRealtime) {
    await page.waitForFunction(
      () => {
        const status = document
          .querySelector(".realtime-ink-status summary span")
          ?.textContent?.trim();
        return ["connected", "disconnected", "error"].includes(status ?? "");
      },
      undefined,
      { timeout: config.realtimeTimeoutMs },
    );

    client.realtimeStatus = await page
      .locator(".realtime-ink-status summary span")
      .textContent();
    client.realtimeStatus = client.realtimeStatus?.trim() ?? "unknown";

    if (client.realtimeStatus !== "connected") {
      throw new Error(`Realtime status is ${client.realtimeStatus}.`);
    }
  }

  if (config.clickPen) {
    await page.getByRole("button", { name: "펜", exact: true }).click({
      force: true,
      timeout: config.toolTimeoutMs,
    });
  }

  client.canvasBox = await measureCanvasShell(page, config.startupTimeoutMs);
}

async function collectClientMetrics(client, config) {
  if (!client.page || client.failed) return;

  try {
    client.collectedMetrics = await withTimeout(
      client.page.evaluate(() => {
        const performanceWithMemory = performance;
        return {
          collectedAt: new Date().toISOString(),
          url: window.location.href,
          title: document.title,
          app: window.__realtimeInkPerfSnapshot,
          receiveDiagnostics: window.__realtimeInkReceiveDiagnostics,
          browser: {
            visibilityState: document.visibilityState,
            userAgent: navigator.userAgent,
            devicePixelRatio: window.devicePixelRatio,
            viewport: {
              width: window.innerWidth,
              height: window.innerHeight,
            },
            memory: performanceWithMemory.memory,
          },
        };
      }),
      config.metricsTimeoutMs,
      () =>
        new Error(
          `metrics collection timed out after ${config.metricsTimeoutMs}ms`,
        ),
    );
    if (client.collectedMetrics && typeof client.collectedMetrics === "object") {
      if (typeof client.collectedMetrics.url === "string") {
        client.collectedMetrics.url = redactSensitiveText(client.collectedMetrics.url);
      }
      if (typeof client.collectedMetrics.title === "string") {
        client.collectedMetrics.title = redactSensitiveText(
          client.collectedMetrics.title,
        );
      }
    }
  } catch (error) {
    pushClientMessage(client, {
      type: "metrics-error",
      text: error instanceof Error ? error.message : String(error),
      at: Date.now(),
    });
  }
}

async function collectAllClientMetrics(clients, config) {
  await Promise.allSettled(
    clients.map((client) => collectClientMetrics(client, config)),
  );
}

async function drawStroke(page, client, config) {
  let box = client.canvasBox;
  if (!isUsableBox(box)) {
    box = await measureCanvasShell(page, config.toolTimeoutMs);
    client.canvasBox = box;
  }

  const seed = client.index * 17 + client.strokesDrawn * 23;
  const row = seed % 11;
  const baseX = box.x + box.width * (0.12 + ((seed % 7) * 0.1));
  const baseY = box.y + box.height * (0.18 + row * 0.055);
  const width = box.width * (0.12 + ((seed % 3) * 0.035));
  const height = box.height * (0.025 + ((seed % 4) * 0.014));
  const steps = 7;

  await page.mouse.move(baseX, baseY);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const wave = Math.sin(progress * Math.PI * 2 + seed);
    await page.mouse.move(baseX + width * progress, baseY + height * wave, {
      steps: 1,
    });
  }
  await page.mouse.up();

  client.strokesDrawn += 1;
  client.lastStrokeAt = Date.now();
}

async function addTextObject(page, client, config) {
  const button = page.getByRole("button", {
    name: "텍스트 추가",
    exact: true,
  });
  await button.click({
    force: true,
    timeout: config.toolTimeoutMs,
  });
  client.objectsAdded += 1;
  client.lastObjectAt = Date.now();
}

async function runScenarioAction(page, client, config) {
  if (config.scenario === "pen") {
    await drawStroke(page, client, config);
    return;
  }

  if (config.scenario === "text") {
    if (shouldRunScenarioStep(client, "text")) {
      await addTextObject(page, client, config);
    }
    return;
  }

  if (config.scenario === "mixed") {
    if (
      shouldRunScenarioStep(client, "text") &&
      client.strokesDrawn > 0 &&
      client.strokesDrawn % config.textEveryStrokes === 0 &&
      client.lastTextStrokeCount !== client.strokesDrawn
    ) {
      await addTextObject(page, client, config);
      client.lastTextStrokeCount = client.strokesDrawn;
      return;
    }
    await drawStroke(page, client, config);
    return;
  }

  throw new Error(`Unsupported scenario: ${config.scenario}`);
}

async function startDrawingLoop(page, client, config, state) {
  await sleep(Math.random() * config.drawIntervalMs);
  let consecutiveErrors = 0;

  while (!state.stopping) {
    try {
      await state.runDrawTask(async () => {
        if (state.stopping) return;
        await runScenarioAction(page, client, config);
      });
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      pushClientMessage(client, {
        type: "draw-error",
        text: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
    }

    const recoveryDelay =
      consecutiveErrors > 0
        ? Math.min(config.drawErrorBackoffMs * consecutiveErrors, 60_000)
        : 0;
    await sleep(
      config.drawIntervalMs +
        recoveryDelay +
        Math.random() * Math.floor(config.drawIntervalMs / 2),
    );
  }
}

function summarizeClients(clients) {
  const ready = clients.filter((client) => client.ready).length;
  const failed = clients.filter((client) => client.failed).length;
  const connected = clients.filter(
    (client) => client.realtimeStatus === "connected",
  ).length;
  const strokes = clients.reduce((sum, client) => sum + client.strokesDrawn, 0);
  const objectsAdded = clients.reduce(
    (sum, client) => sum + client.objectsAdded,
    0,
  );
  const messages = clients.reduce(
    (sum, client) => sum + client.messages.length,
    0,
  );
  const appMetrics = clients
    .map((client) => client.collectedMetrics?.app)
    .filter(Boolean);
  const frameMetrics = appMetrics
    .map((metrics) => metrics.frame)
    .filter(Boolean);
  const canvasMetrics = appMetrics
    .map((metrics) => metrics.canvas)
    .filter(Boolean);
  const fpsValues = frameMetrics
    .map((frame) => frame.fps)
    .filter((value) => Number.isFinite(value));
  const p95FrameValues = frameMetrics
    .map((frame) => frame.p95FrameMs)
    .filter((value) => Number.isFinite(value));
  const longTaskCounts = appMetrics
    .map((metrics) => metrics.longTasks?.count)
    .filter((value) => Number.isFinite(value));
  const longTaskMaxDurations = appMetrics
    .map((metrics) => metrics.longTasks?.maxDurationMs)
    .filter((value) => Number.isFinite(value));
  const averagePointsPerStrokeValues = canvasMetrics
    .map((canvas) => canvas.averagePointsPerStroke)
    .filter((value) => Number.isFinite(value));
  const receiveDiagnostics = clients
    .map((client) => client.collectedMetrics?.receiveDiagnostics)
    .filter(Boolean);
  const receiveHandlerAverageValues = receiveDiagnostics
    .map((diagnostics) => diagnostics.handlerMs?.average)
    .filter((value) => Number.isFinite(value));
  const receiveHandlerMaxValues = receiveDiagnostics
    .map((diagnostics) => diagnostics.handlerMs?.max)
    .filter((value) => Number.isFinite(value));

  return {
    ready,
    failed,
    connected,
    strokes,
    objectsAdded,
    messages,
    appMetrics: appMetrics.length,
    fps: summarizeNumbers(fpsValues),
    p95FrameMs: summarizeNumbers(p95FrameValues),
    longTasks: {
      count: summarizeNumbers(longTaskCounts),
      maxDurationMs: summarizeNumbers(longTaskMaxDurations),
    },
    receive: {
      samples: receiveDiagnostics.length,
      received: receiveDiagnostics.reduce(
        (sum, diagnostics) => sum + diagnostics.received,
        0,
      ),
      applied: receiveDiagnostics.reduce(
        (sum, diagnostics) => sum + diagnostics.applied,
        0,
      ),
      ignored: receiveDiagnostics.reduce(
        (sum, diagnostics) => sum + diagnostics.ignored,
        0,
      ),
      errors: receiveDiagnostics.reduce(
        (sum, diagnostics) => sum + diagnostics.errors,
        0,
      ),
      handlerAverageMs: summarizeNumbers(receiveHandlerAverageValues),
      handlerMaxMs: summarizeNumbers(receiveHandlerMaxValues),
    },
    averagePointsPerStroke: summarizeNumbers(averagePointsPerStrokeValues),
    consistency: summarizeConsistency(appMetrics),
  };
}

function summarizeNumbers(values) {
  if (values.length === 0) {
    return {
      count: 0,
      min: undefined,
      average: undefined,
      max: undefined,
    };
  }

  return {
    count: values.length,
    min: Math.min(...values),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    max: Math.max(...values),
  };
}

function summarizeConsistency(appMetrics) {
  const keys = [
    ["strokes", (metrics) => metrics.canvas?.strokes],
    ["strokePoints", (metrics) => metrics.canvas?.strokePoints],
    ["objects", (metrics) => metrics.canvas?.objects],
    ["images", (metrics) => metrics.canvas?.images],
    ["remoteDrafts", (metrics) => metrics.canvas?.remoteDrafts],
    ["yjsStrokeCount", (metrics) => metrics.realtime?.strokeCount],
    ["yjsObjectCount", (metrics) => metrics.realtime?.objectCount],
  ];

  return Object.fromEntries(
    keys.map(([key, pickValue]) => {
      const values = appMetrics
        .map((metrics) => pickValue(metrics))
        .filter((value) => typeof value === "number" && Number.isFinite(value));
      const uniqueValues = [...new Set(values)];
      return [
        key,
        {
          samples: values.length,
          consistent: uniqueValues.length <= 1,
          values: uniqueValues.slice(0, 20),
        },
      ];
    }),
  );
}

function getRunVerdict(config, clients, summary) {
  const issues = [];
  const readyRate = config.users > 0 ? summary.ready / config.users : 0;
  const connectedRate = config.users > 0 ? summary.connected / config.users : 0;
  const worstClientMessages = Math.max(
    0,
    ...clients.map((client) => client.messages.length),
  );
  const disconnectedClients = clients
    .filter((client) => client.realtimeStatus && client.realtimeStatus !== "connected")
    .map((client) => `${config.actorPrefix}-${client.index + 1}`);
  const inconsistentKeys = Object.entries(summary.consistency)
    .filter(([, value]) => value.samples > 1 && !value.consistent)
    .map(([key, value]) => `${key}=${value.values.join("/")}`);

  if (readyRate < config.minReadyRate) {
    issues.push(
      `ready rate ${(readyRate * 100).toFixed(1)}% is below ${(
        config.minReadyRate * 100
      ).toFixed(1)}%`,
    );
  }

  if (connectedRate < config.minReadyRate) {
    issues.push(
      `connected rate ${(connectedRate * 100).toFixed(1)}% is below ${(
        config.minReadyRate * 100
      ).toFixed(1)}%`,
    );
  }

  if (worstClientMessages > config.maxClientMessages) {
    issues.push(
      `worst client console/page messages ${worstClientMessages} exceeds ${config.maxClientMessages}`,
    );
  }

  if (
    summary.fps.count > 0 &&
    summary.fps.min !== undefined &&
    summary.fps.min < config.minFps
  ) {
    issues.push(
      `slowest client FPS ${summary.fps.min.toFixed(1)} is below ${config.minFps}`,
    );
  }

  if (
    summary.p95FrameMs.count > 0 &&
    summary.p95FrameMs.max !== undefined &&
    summary.p95FrameMs.max > config.maxP95FrameMs
  ) {
    issues.push(
      `worst client p95 frame ${summary.p95FrameMs.max.toFixed(1)}ms exceeds ${config.maxP95FrameMs}ms`,
    );
  }

  if (
    summary.averagePointsPerStroke.count > 0 &&
    summary.averagePointsPerStroke.max !== undefined &&
    summary.averagePointsPerStroke.max > config.maxAveragePoints
  ) {
    issues.push(
      `max average points/stroke ${summary.averagePointsPerStroke.max.toFixed(1)} exceeds ${config.maxAveragePoints}`,
    );
  }

  if (inconsistentKeys.length > 0) {
    issues.push(`client state differs: ${inconsistentKeys.join(", ")}`);
  }

  if (disconnectedClients.length > 0) {
    issues.push(
      `non-connected clients: ${disconnectedClients.slice(0, 20).join(", ")}`,
    );
  }

  return {
    pass: issues.length === 0,
    issues,
    thresholds: {
      minReadyRate: config.minReadyRate,
      minFps: config.minFps,
      maxP95FrameMs: config.maxP95FrameMs,
      maxClientMessages: config.maxClientMessages,
      maxAveragePoints: config.maxAveragePoints,
    },
  };
}

async function closeClients(clients, browsers) {
  for (const client of clients) {
    await client.context?.close().catch(() => {});
  }

  for (const browser of browsers) {
    await browser.close().catch(() => {});
  }
}

async function writeReport(reportPath, config, clients, startedAt, endedAt) {
  await mkdir(path.dirname(reportPath), { recursive: true });
  const summary = summarizeClients(clients);
  const report = {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs: endedAt - startedAt,
    config: {
      ...config,
      token: config.token ? "[redacted]" : "",
    },
    summary,
    verdict: getRunVerdict(config, clients, summary),
    clients: clients.map((client) => ({
      index: client.index,
      actorId: `${config.actorPrefix}-${client.index + 1}`,
      headed: client.headed,
      ready: client.ready,
      failed: client.failed,
      realtimeStatus: client.realtimeStatus,
      strokesDrawn: client.strokesDrawn,
      objectsAdded: client.objectsAdded,
      lastStrokeAt: client.lastStrokeAt
        ? new Date(client.lastStrokeAt).toISOString()
        : undefined,
      lastObjectAt: client.lastObjectAt
        ? new Date(client.lastObjectAt).toISOString()
        : undefined,
      messages: client.messages.slice(-20).map((message) => ({
        ...message,
        text: redactSensitiveText(message.text),
      })),
      metrics: client.collectedMetrics,
    })),
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(helpText.trim());
    return;
  }

  const runId = makeRunId();
  const users = parseInteger(args.users ?? process.env.REALTIME_FLEET_USERS, 20, 1);
  const headed = parseInteger(args.headed ?? process.env.REALTIME_FLEET_HEADED, 2, 0);
  const defaultHeadlessBrowsers = Math.min(
    12,
    Math.max(1, Math.ceil(Math.max(0, users - headed) / 10)),
  );
  const config = {
    url: args.url ?? process.env.REALTIME_FLEET_URL ?? "http://127.0.0.1:5178/",
    server: args.server ?? process.env.INK_SERVER ?? "http://127.0.0.1:3000",
    token: args.token ?? process.env.INK_TOKEN ?? "",
    room: args.room ?? process.env.INK_ROOM ?? `load:${runId}`,
    users,
    headed,
    headlessBrowsers: parseInteger(
      args["headless-browsers"] ?? process.env.REALTIME_FLEET_HEADLESS_BROWSERS,
      defaultHeadlessBrowsers,
      1,
    ),
    durationMs: parseInteger(
      args.duration ?? process.env.REALTIME_FLEET_DURATION_MS,
      defaultDurationMs,
      1000,
    ),
    drawIntervalMs: parseInteger(
      args["draw-interval"] ?? process.env.REALTIME_FLEET_DRAW_INTERVAL_MS,
      defaultDrawIntervalMs,
      250,
    ),
    drawConcurrency: parseInteger(
      args["draw-concurrency"] ?? process.env.REALTIME_FLEET_DRAW_CONCURRENCY,
      defaultMaxDrawConcurrency,
      1,
    ),
    drawErrorBackoffMs: parseInteger(
      args["draw-error-backoff"] ??
        process.env.REALTIME_FLEET_DRAW_ERROR_BACKOFF_MS,
      defaultDrawErrorBackoffMs,
      0,
    ),
    drawAfterReady: parseBoolean(
      args["draw-after-ready"] ?? process.env.REALTIME_FLEET_DRAW_AFTER_READY,
      true,
    ),
    rampMs: parseInteger(args.ramp ?? process.env.REALTIME_FLEET_RAMP_MS, 10_000, 0),
    settleMs: parseInteger(
      args.settle ?? process.env.REALTIME_FLEET_SETTLE_MS,
      2000,
      0,
    ),
    metricsTimeoutMs: parseInteger(
      args["metrics-timeout"] ?? process.env.REALTIME_FLEET_METRICS_TIMEOUT_MS,
      defaultMetricsTimeoutMs,
      0,
    ),
    stopTimeoutMs: parseInteger(
      args["stop-timeout"] ?? process.env.REALTIME_FLEET_STOP_TIMEOUT_MS,
      defaultStopTimeoutMs,
      0,
    ),
    mode: args.mode ?? process.env.REALTIME_FLEET_MODE ?? "draw",
    scenario: args.scenario ?? process.env.REALTIME_FLEET_SCENARIO ?? "pen",
    textEveryStrokes: parseInteger(
      args["text-every-strokes"] ??
        process.env.REALTIME_FLEET_TEXT_EVERY_STROKES,
      3,
      1,
    ),
    receiveTraceSampleRate: Number(
      args["receive-trace-sample-rate"] ??
        process.env.REALTIME_FLEET_RECEIVE_TRACE_SAMPLE_RATE ??
        1,
    ),
    startupTimeoutMs: parseInteger(
      args["startup-timeout"] ?? process.env.REALTIME_FLEET_STARTUP_TIMEOUT_MS,
      60_000,
      1000,
    ),
    realtimeTimeoutMs: parseInteger(
      args["realtime-timeout"] ?? process.env.REALTIME_FLEET_REALTIME_TIMEOUT_MS,
      60_000,
      1000,
    ),
    toolTimeoutMs: parseInteger(
      args["tool-timeout"] ?? process.env.REALTIME_FLEET_TOOL_TIMEOUT_MS,
      30_000,
      1000,
    ),
    appMetrics: parseBoolean(
      args["app-metrics"] ?? process.env.REALTIME_FLEET_APP_METRICS,
      true,
    ),
    probe: parseBoolean(args.probe ?? process.env.REALTIME_FLEET_PROBE, false),
    debug: parseBoolean(args.debug ?? process.env.REALTIME_FLEET_DEBUG, false),
    preflight: parseBoolean(
      args.preflight ?? process.env.REALTIME_FLEET_PREFLIGHT,
      true,
    ),
    waitRealtime: parseBoolean(
      args["wait-realtime"] ?? process.env.REALTIME_FLEET_WAIT_REALTIME,
      true,
    ),
    role: args.role ?? process.env.REALTIME_FLEET_ROLE ?? "student",
    actorPrefix: args["actor-prefix"] ?? `fleet-${runId}`,
    minReadyRate: Number(args["min-ready-rate"] ?? 0.99),
    minFps: Number(args["min-fps"] ?? 25),
    maxP95FrameMs: Number(args["max-p95-frame"] ?? 80),
    maxClientMessages: Number(args["max-client-messages"] ?? 0),
    maxAveragePoints: Number(args["max-average-points"] ?? 120),
    viewport: {
      width: parseInteger(args.width, defaultViewport.width, 320),
      height: parseInteger(args.height, defaultViewport.height, 240),
    },
    reportPath: path.resolve(
      projectRoot,
      args.report ??
        process.env.REALTIME_FLEET_REPORT ??
        `export-results/realtime-fleet/realtime-fleet-${runId}.json`,
    ),
  };

  config.headed = Math.min(config.headed, config.users);
  const headlessUserCount = config.users - config.headed;
  config.headlessBrowsers =
    headlessUserCount > 0
      ? Math.min(config.headlessBrowsers, headlessUserCount)
      : 0;
  config.drawConcurrency = Math.min(config.drawConcurrency, config.users);

  if (!["idle", "draw"].includes(config.mode)) {
    throw new Error(`Unsupported mode: ${config.mode}. Use idle or draw.`);
  }
  if (!["pen", "text", "mixed"].includes(config.scenario)) {
    throw new Error(
      `Unsupported scenario: ${config.scenario}. Use pen, text, or mixed.`,
    );
  }
  config.receiveTraceSampleRate = Math.min(
    1,
    Math.max(0, config.receiveTraceSampleRate),
  );
  config.clickPen = parseBoolean(
    args["click-pen"] ?? process.env.REALTIME_FLEET_CLICK_PEN,
    config.mode === "draw" && config.scenario !== "text",
  );

  if (!config.token) {
    console.error("[realtime-fleet] Missing --token or INK_TOKEN.");
    console.error("Generate a local JWT from the handwriting backend, then retry.");
    console.error(helpText.trim());
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const clients = [];
  const browsers = [];
  const state = {
    stopping: false,
    runDrawTask: createSemaphore(config.drawConcurrency),
  };
  const drawingTasks = [];

  console.log("[realtime-fleet] starting");
  console.log(
    JSON.stringify(
      {
        users: config.users,
        headed: config.headed,
        headlessBrowsers: config.headlessBrowsers,
        mode: config.mode,
        scenario: config.scenario,
        durationMs: config.durationMs,
        drawConcurrency: config.drawConcurrency,
        drawErrorBackoffMs: config.drawErrorBackoffMs,
        drawAfterReady: config.drawAfterReady,
        metricsTimeoutMs: config.metricsTimeoutMs,
        stopTimeoutMs: config.stopTimeoutMs,
        startupTimeoutMs: config.startupTimeoutMs,
        realtimeTimeoutMs: config.realtimeTimeoutMs,
        room: config.room,
        url: config.url,
        server: config.server,
        manualUrl: redactSensitiveText(makeManualUrl(config)),
      },
      null,
      2,
    ),
  );

  if (config.preflight) {
    try {
      await runSocketPreflight(config);
      console.log("[realtime-fleet] socket preflight ok");
    } catch (error) {
      console.error(
        `[realtime-fleet] socket preflight failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
      console.error(
        "[realtime-fleet] Check --server, --token/INK_TOKEN, JWT_SECRET, and whether the handwriting backend is running.",
      );
      process.exitCode = 1;
      return;
    }
  }

  let stopPromise;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      state.stopping = true;
      const stopResult = await waitForSettledWithTimeout(
        drawingTasks,
        config.stopTimeoutMs,
      );
      if (stopResult === "timeout") {
        console.warn(
          `[realtime-fleet] synthetic draw loops did not stop within ${config.stopTimeoutMs}ms; collecting metrics anyway`,
        );
      }
      if (config.settleMs > 0) await sleep(config.settleMs);
      await collectAllClientMetrics(clients, config);
      const endedAt = Date.now();
      await writeReport(config.reportPath, config, clients, startedAt, endedAt);
      await closeClients(clients, browsers);
      const summary = summarizeClients(clients);
      const verdict = getRunVerdict(config, clients, summary);
      console.log(
        `[realtime-fleet] verdict=${verdict.pass ? "pass" : "fail"} ready=${summary.ready}/${config.users} connected=${summary.connected}/${config.users} fpsMin=${
          summary.fps.min === undefined ? "n/a" : summary.fps.min.toFixed(1)
        } p95FrameMax=${
          summary.p95FrameMs.max === undefined
            ? "n/a"
            : `${summary.p95FrameMs.max.toFixed(1)}ms`
        }`,
      );
      if (!verdict.pass) {
        for (const issue of verdict.issues.slice(0, 10)) {
          console.log(`[realtime-fleet] issue: ${issue}`);
        }
      }
      console.log(`[realtime-fleet] report: ${config.reportPath}`);
    })();
    return stopPromise;
  };

  process.once("SIGINT", () => {
    console.log("\n[realtime-fleet] stopping");
    stop()
      .then(() => {
        process.exit(0);
      })
      .catch((error) => {
        console.error(error);
        process.exit(1);
      });
  });

  const headlessBrowsers = [];
  for (let index = 0; index < config.headlessBrowsers; index += 1) {
    const browser = await launchChromium(true, config.headed + index, config);
    headlessBrowsers.push(browser);
    browsers.push(browser);
  }

  const rampDelay = config.users > 0 ? Math.floor(config.rampMs / config.users) : 0;

  for (let index = 0; index < config.users; index += 1) {
    const headed = index < config.headed;
    const client = {
      index,
      headed,
      ready: false,
      failed: false,
      context: undefined,
      page: undefined,
      messages: [],
      realtimeStatus: undefined,
      collectedMetrics: undefined,
      canvasBox: undefined,
      strokesDrawn: 0,
      lastStrokeAt: undefined,
      objectsAdded: 0,
      lastObjectAt: undefined,
      lastTextStrokeCount: undefined,
    };
    clients.push(client);

    try {
      const browser = headed
        ? await launchChromium(false, index, config)
        : headlessBrowsers[(index - config.headed) % headlessBrowsers.length];
      if (headed && browser) browsers.push(browser);

      if (!browser) {
        throw new Error("Browser was not initialized.");
      }

      const context = await browser.newContext({
        viewport: config.viewport,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      client.context = context;
      client.page = page;

      await preparePage(page, client, config);
      client.ready = true;

      if (config.mode === "draw" && !config.drawAfterReady) {
        drawingTasks.push(startDrawingLoop(page, client, config, state));
      }
    } catch (error) {
      client.failed = true;
      pushClientMessage(client, {
        type: "startup-error",
        text: error instanceof Error ? error.message : String(error),
        at: Date.now(),
      });
      console.error(
        `[realtime-fleet] user ${index + 1} failed: ${
          error instanceof Error ? error.message : error
        }`,
      );
    }

    const summary = summarizeClients(clients);
    console.log(
      `[realtime-fleet] users=${clients.length}/${config.users} ready=${summary.ready} failed=${summary.failed}`,
    );

    if (rampDelay > 0) await sleep(rampDelay);
  }

  if (config.mode === "draw" && config.drawAfterReady) {
    const drawableClients = clients.filter((client) => client.ready && !client.failed);
    console.log(
      `[realtime-fleet] starting draw loops for ${drawableClients.length}/${config.users} ready clients`,
    );
    for (const client of drawableClients) {
      if (!client.page) continue;
      drawingTasks.push(startDrawingLoop(client.page, client, config, state));
    }
  }

  const statusTimer = setInterval(() => {
    const summary = summarizeClients(clients);
    const memory = process.memoryUsage();
    console.log(
      `[realtime-fleet] ready=${summary.ready}/${config.users} failed=${summary.failed} strokes=${summary.strokes} messages=${summary.messages} rss=${Math.round(
        memory.rss / 1024 / 1024,
      )}mb load=${os.loadavg()[0].toFixed(2)}`,
    );
  }, 5000);

  await sleep(config.durationMs);
  clearInterval(statusTimer);
  await stop();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
