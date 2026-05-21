import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { io } from "socket.io-client";

type ClientRole = "teacher" | "student";

type ClientMessage = {
  at: string;
  type: string;
  text: string;
};

type ClientSnapshot = {
  status: string;
  canvas?: {
    strokes?: number;
    strokePoints?: number;
    averagePointsPerStroke?: number;
  };
  realtime?: {
    strokeCount?: number;
    remoteStrokeCount?: number;
    localUpdateCount?: number;
    remoteUpdateCount?: number;
    sentUpdateCount?: number;
    appliedUpdateCount?: number;
    syncRequestCount?: number;
    syncResponseCount?: number;
    syncAppliedCount?: number;
  };
  receiveDiagnostics?: {
    received?: number;
    invalid?: number;
    ignored?: number;
    applied?: number;
    errors?: number;
    byType?: Record<string, number>;
    appliedByType?: Record<string, number>;
    handlerMs?: {
      count?: number;
      average?: number;
      max?: number;
    };
    lastError?: string;
  };
};

type RoomResult = {
  roomId: string;
  ok: boolean;
  startedAtMs: number;
  endedAtMs: number;
  elapsedMs: number;
  syncMs?: number;
  error?: string;
  drawer: {
    actorId: string;
    messages: ClientMessage[];
    snapshot?: ClientSnapshot;
  };
  viewer: {
    actorId: string;
    messages: ClientMessage[];
    snapshot?: ClientSnapshot;
  };
};

const socketPath = "/handwriting/socket.io/";

function makeRunId(): string {
  return new Date().toISOString().replace(/[.:]/g, "-");
}

function readInteger(name: string, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function readTimeout(name: string, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed <= 0) return 0;
  return Math.max(minimum, parsed);
}

function readBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

const runId = process.env.ROOM_PAIR_RUN_ID ?? makeRunId();
const config = {
  appUrl: process.env.APP_URL ?? "http://127.0.0.1:5173",
  inkServer: process.env.INK_SERVER ?? "http://127.0.0.1:3001",
  inkToken: process.env.INK_TOKEN ?? "",
  otelEndpoint: process.env.OTEL_ENDPOINT,
  testScenario: process.env.TEST_SCENARIO ?? process.env.ROOM_PAIR_SCENARIO,
  testStack:
    process.env.TEST_STACK ?? process.env.ROOM_PAIR_STACK ?? "socketio-yjs",
  rooms: readInteger("ROOM_PAIR_ROOMS", 100, 1),
  usersPerRoom: readInteger("ROOM_PAIR_USERS_PER_ROOM", 2, 1),
  roomConcurrency: readInteger("ROOM_PAIR_CONCURRENCY", 100, 1),
  strokesPerRoom: readInteger("ROOM_PAIR_STROKES", 1, 1),
  startupTimeoutMs: readInteger("ROOM_PAIR_STARTUP_TIMEOUT_MS", 20_000, 1_000),
  realtimeTimeoutMs: readInteger(
    "ROOM_PAIR_REALTIME_TIMEOUT_MS",
    20_000,
    1_000,
  ),
  syncTimeoutMs: readInteger("ROOM_PAIR_SYNC_TIMEOUT_MS", 10_000, 1_000),
  runTimeoutMs: readTimeout("ROOM_PAIR_RUN_TIMEOUT_MS", 0, 1_000),
  toolTimeoutMs: readInteger("ROOM_PAIR_TOOL_TIMEOUT_MS", 10_000, 1_000),
  headless: readBoolean("ROOM_PAIR_HEADLESS", true),
  preflight: readBoolean("ROOM_PAIR_PREFLIGHT", true),
  preflightTimeoutMs: readInteger(
    "ROOM_PAIR_PREFLIGHT_TIMEOUT_MS",
    5_000,
    1_000,
  ),
  settleMs: readInteger("ROOM_PAIR_SETTLE_MS", 1_000, 0),
  writeReport: readBoolean("ROOM_PAIR_WRITE_REPORT", false),
  emitOtelSummary: readBoolean("ROOM_PAIR_OTEL_SUMMARY", true),
  failOnOtelSummary: readBoolean("ROOM_PAIR_FAIL_ON_OTEL_SUMMARY", false),
  strictAssertions: readBoolean("ROOM_PAIR_STRICT_ASSERTIONS", true),
  maxFailureDetails: readInteger("ROOM_PAIR_MAX_FAILURE_DETAILS", 20, 1),
  viewport: {
    width: readInteger("ROOM_PAIR_VIEWPORT_WIDTH", 1280, 320),
    height: readInteger("ROOM_PAIR_VIEWPORT_HEIGHT", 820, 240),
  },
  roomPrefix: process.env.ROOM_PAIR_ROOM_PREFIX ?? "room-pair",
  actorPrefix: process.env.ROOM_PAIR_ACTOR_PREFIX ?? "room-pair",
  pageId: process.env.ROOM_PAIR_PAGE_ID ?? "page-1",
  contextMode: process.env.ROOM_PAIR_CONTEXT_MODE ?? "room",
  failOnConsoleError: readBoolean("ROOM_PAIR_FAIL_ON_CONSOLE_ERROR", true),
  reportPath: path.resolve(
    process.cwd(),
    process.env.ROOM_PAIR_REPORT ??
      `export-results/playwright-room-pairs/realtime-room-pairs-${runId}.json`,
  ),
};

type OtlpAttributeValue = string | number | boolean | undefined;
type OtlpAttributes = Record<string, OtlpAttributeValue>;

function getTestScenario(): string {
  return config.testScenario ?? `room-pairs-${config.rooms}`;
}

function getTestUsers(): number {
  return config.rooms * config.usersPerRoom;
}

function hasRunTimeout(): boolean {
  return config.runTimeoutMs > 0;
}

function isElapsedWithinRunTimeout(elapsedMs: number): boolean {
  return !hasRunTimeout() || elapsedMs <= config.runTimeoutMs;
}

function isRunSuccessful(results: RoomResult[], elapsedMs: number): boolean {
  return (
    results.every((result) => result.ok) && isElapsedWithinRunTimeout(elapsedMs)
  );
}

function getBaseTestAttributes(): OtlpAttributes {
  return {
    "test.run_id": runId,
    "test.scenario": getTestScenario(),
    "test.stack": config.testStack,
    "test.rooms": config.rooms,
    "test.users": getTestUsers(),
    "test.users_per_room": config.usersPerRoom,
    "test.concurrency": config.roomConcurrency,
    "test.strokes_per_room": config.strokesPerRoom,
    "test.context_mode": config.contextMode,
    "test.run_timeout_enabled": hasRunTimeout(),
    "test.run_timeout_ms": config.runTimeoutMs,
    "test.strict_assertions": config.strictAssertions,
  };
}

function formatEndpointError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkFrontendEndpoint(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, config.preflightTimeoutMs);

  try {
    await fetch(config.appUrl, {
      method: "GET",
      signal: controller.signal,
    });
  } catch (error) {
    throw new Error(
      [
        `APP_URL is not reachable: ${config.appUrl}`,
        `Original error: ${formatEndpointError(error)}`,
        "Start Vite on that exact port, or pass APP_URL with the actual dev server URL.",
        "Example: npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
      ].join("\n"),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function checkRealtimeEndpoint(): Promise<void> {
  if (!config.inkToken) {
    throw new Error(
      "INK_TOKEN is required for room-pairs load tests. Pass a valid backend JWT with INK_TOKEN.",
    );
  }

  await new Promise<void>((resolve, reject) => {
    const socket = io(config.inkServer, {
      path: socketPath,
      transports: ["websocket"],
      query: {
        token: config.inkToken,
      },
      forceNew: true,
      reconnection: false,
      timeout: config.preflightTimeoutMs,
    });

    const timeout = setTimeout(() => {
      socket.close();
      reject(
        new Error(
          `INK_SERVER Socket.IO preflight timed out: ${config.inkServer}${socketPath}`,
        ),
      );
    }, config.preflightTimeoutMs + 500);

    socket.on("connect", () => {
      socket.emit("join-room", `${config.roomPrefix}-${runId}-preflight`);
      clearTimeout(timeout);
      socket.close();
      resolve();
    });

    socket.on("connect_error", (error) => {
      clearTimeout(timeout);
      socket.close();
      reject(
        new Error(
          [
            `INK_SERVER is not reachable or token was rejected: ${config.inkServer}`,
            `Original error: ${formatEndpointError(error)}`,
            "Start the realtime backend, or pass INK_SERVER/INK_TOKEN for the running backend.",
          ].join("\n"),
        ),
      );
    });
  });
}

async function runPreflight(): Promise<void> {
  if (!config.preflight) return;
  await checkFrontendEndpoint();
  await checkRealtimeEndpoint();
}

function createSemaphore(limit: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  return async function runWithSlot<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => {
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

function redactSensitiveText(value: string): string {
  return value
    .replaceAll(/([?&](?:token|inkToken)=)[^&\s'"]+/g, "$1[redacted]")
    .replaceAll(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      "[jwt-redacted]",
    );
}

function shouldRecordConsoleMessage(text: string): boolean {
  if (text.includes("GPU stall due to ReadPixels")) return false;
  const appUrl = new URL(config.appUrl);
  if (
    text.includes("WebSocket connection to") &&
    text.includes(`ws://${appUrl.host}/`)
  ) {
    return false;
  }
  if (
    text.includes("/handwriting/socket.io/") &&
    text.includes("WebSocket is closed before the connection is established")
  ) {
    return false;
  }
  return true;
}

function recordPageMessages(page: Page, messages: ClientMessage[]) {
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    if (!shouldRecordConsoleMessage(text)) return;
    messages.push({
      at: new Date().toISOString(),
      type: message.type(),
      text: redactSensitiveText(text),
    });
  });

  page.on("pageerror", (error) => {
    messages.push({
      at: new Date().toISOString(),
      type: "pageerror",
      text: redactSensitiveText(error.message),
    });
  });
}

function makeRoomId(index: number): string {
  const roomNumber = String(index + 1).padStart(
    String(config.rooms).length,
    "0",
  );
  return `${config.roomPrefix}-${runId}-${roomNumber}`;
}

function makeActorId(roomIndex: number, role: ClientRole): string {
  const roomNumber = String(roomIndex + 1).padStart(
    String(config.rooms).length,
    "0",
  );
  return `${config.actorPrefix}-${runId}-${roomNumber}-${role}`;
}

function makeClientUrl(
  roomId: string,
  actorId: string,
  role: ClientRole,
): string {
  const url = new URL(config.appUrl);
  url.searchParams.set("realtimeInk", "1");
  url.searchParams.set("inkServer", config.inkServer);
  url.searchParams.set("inkRoom", roomId);
  url.searchParams.set("inkRole", role);
  url.searchParams.set("inkActor", actorId);
  url.searchParams.set("inkPage", config.pageId);
  url.searchParams.set("inkToken", config.inkToken);
  url.searchParams.set("inkDebug", "1");
  url.searchParams.set("perfProbe", "1");
  url.searchParams.set("initialTool", "pen");
  url.searchParams.set("loadTestId", runId);
  url.searchParams.set("testRunId", runId);
  url.searchParams.set("testScenario", getTestScenario());
  url.searchParams.set("testStack", config.testStack);
  url.searchParams.set("testRooms", String(config.rooms));
  url.searchParams.set("testUsers", String(getTestUsers()));
  url.searchParams.set("testConcurrency", String(config.roomConcurrency));
  url.searchParams.set("inkTraceReceiveSampleRate", "1");
  if (config.otelEndpoint) {
    url.searchParams.set("otelEndpoint", config.otelEndpoint);
  }
  return url.toString();
}

async function openClient(
  context: BrowserContext,
  roomId: string,
  actorId: string,
  role: ClientRole,
  messages: ClientMessage[],
): Promise<Page> {
  const page = await context.newPage();
  recordPageMessages(page, messages);

  await page.goto(makeClientUrl(roomId, actorId, role), {
    waitUntil: "commit",
    timeout: config.startupTimeoutMs,
  });
  await waitForUsableCanvasShell(page, config.startupTimeoutMs);
  await page.addStyleTag({
    content: `
      #leva__root,
      .r3f-perf-debug,
      .realtime-ink-status,
      .realtime-ink-perf-probe {
        display: none !important;
      }
    `,
  });
  await page.waitForFunction(
    () => {
      const windowWithProbe = window as typeof window & {
        __realtimeInkPerfSnapshot?: { status?: string };
      };
      const probeStatus = windowWithProbe.__realtimeInkPerfSnapshot?.status;
      const panelStatus = document
        .querySelector(".realtime-ink-status summary span")
        ?.textContent?.trim();
      return probeStatus === "connected" || panelStatus === "connected";
    },
    undefined,
    { timeout: config.realtimeTimeoutMs },
  );

  return page;
}

async function waitForUsableCanvasShell(page: Page, timeout: number) {
  await page.waitForFunction(
    () => {
      const shell = document.querySelector<HTMLElement>(".stage-canvas-shell");
      if (!shell) return false;
      const style = window.getComputedStyle(shell);
      const rect = shell.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 1 &&
        rect.height > 1
      );
    },
    undefined,
    { timeout },
  );
}

async function readSnapshot(page: Page): Promise<ClientSnapshot> {
  return page.evaluate(() => {
    const windowWithTelemetry = window as typeof window & {
      __realtimeInkPerfSnapshot?: {
        status?: string;
        canvas?: ClientSnapshot["canvas"];
        realtime?: ClientSnapshot["realtime"];
      };
      __realtimeInkReceiveDiagnostics?: ClientSnapshot["receiveDiagnostics"];
    };
    const probe = windowWithTelemetry.__realtimeInkPerfSnapshot;
    const panelStatus = document
      .querySelector(".realtime-ink-status summary span")
      ?.textContent?.trim();

    return {
      status: probe?.status ?? panelStatus ?? "unknown",
      canvas: probe?.canvas,
      realtime: probe?.realtime,
      receiveDiagnostics: windowWithTelemetry.__realtimeInkReceiveDiagnostics,
    };
  });
}

async function getCanvasShellBox(page: Page) {
  await waitForUsableCanvasShell(page, config.toolTimeoutMs);
  const box = await page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>(".stage-canvas-shell");
    if (!shell) {
      throw new Error("stage canvas shell was not found");
    }
    const rect = shell.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  });
  if (box.width <= 1 || box.height <= 1) {
    throw new Error("stage canvas shell bounds are not usable");
  }
  return box;
}

async function drawStroke(page: Page, roomIndex: number, strokeIndex: number) {
  const box = await getCanvasShellBox(page);
  const seed = roomIndex * 31 + strokeIndex * 17;
  const startX = box.x + box.width * (0.18 + (seed % 6) * 0.08);
  const startY = box.y + box.height * (0.24 + (seed % 8) * 0.06);
  const width = box.width * 0.18;
  const height = box.height * 0.04;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    const progress = step / 10;
    await page.mouse.move(
      startX + width * progress,
      startY + Math.sin(progress * Math.PI * 2 + seed) * height,
      { steps: 1 },
    );
  }
  await page.mouse.up();
}

async function waitForViewerStroke(page: Page, expectedStrokes: number) {
  const startedAt = Date.now();
  await page.waitForFunction(
    (minimumStrokes) => {
      const windowWithTelemetry = window as typeof window & {
        __realtimeInkPerfSnapshot?: {
          canvas?: { strokes?: number };
          realtime?: {
            remoteStrokeCount?: number;
            appliedUpdateCount?: number;
          };
        };
        __realtimeInkReceiveDiagnostics?: {
          appliedByType?: Record<string, number>;
          errors?: number;
        };
      };
      const snapshot = windowWithTelemetry.__realtimeInkPerfSnapshot;
      const diagnostics = windowWithTelemetry.__realtimeInkReceiveDiagnostics;
      if ((diagnostics?.errors ?? 0) > 0) return false;
      const canvasStrokes = snapshot?.canvas?.strokes ?? 0;
      const remoteStrokes = snapshot?.realtime?.remoteStrokeCount ?? 0;
      const yjsUpdates = snapshot?.realtime?.appliedUpdateCount ?? 0;
      const strokeEnds = diagnostics?.appliedByType?.["ink:stroke:end"] ?? 0;
      return (
        remoteStrokes >= minimumStrokes ||
        canvasStrokes >= minimumStrokes ||
        yjsUpdates >= minimumStrokes ||
        strokeEnds >= minimumStrokes
      );
    },
    expectedStrokes,
    { timeout: config.syncTimeoutMs },
  );
  return Date.now() - startedAt;
}

async function closeContexts(contexts: BrowserContext[]) {
  await Promise.allSettled(contexts.map((context) => context.close()));
}

async function createContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 1,
  });
}

async function launchBrowser(): Promise<Browser> {
  const args = [
    "--disable-dev-shm-usage",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ];

  try {
    return await chromium.launch({
      headless: config.headless,
      args,
    });
  } catch (error) {
    console.warn(
      "[room-pairs] Bundled Chromium launch failed. Falling back to local Chrome.",
    );
    console.warn(formatEndpointError(error));
    return chromium.launch({
      headless: config.headless,
      channel: "chrome",
      args,
    });
  }
}

function makeFailureMessage(result: RoomResult): string {
  const drawerStatus = result.drawer.snapshot?.status ?? "unknown";
  const viewerStatus = result.viewer.snapshot?.status ?? "unknown";
  const viewerRemote = result.viewer.snapshot?.realtime?.remoteStrokeCount ?? 0;
  return `${result.roomId}: ${result.error ?? "failed"} drawer=${drawerStatus} viewer=${viewerStatus} viewerRemote=${viewerRemote}`;
}

function makeFailureSummary(results: RoomResult[], elapsedMs: number): string {
  const failed = results.filter((result) => !result.ok);
  if (failed.length === 0) {
    return `Elapsed ${elapsedMs}ms.`;
  }

  const details = failed
    .slice(0, config.maxFailureDetails)
    .map((result) => `- ${makeFailureMessage(result)}`)
    .join("\n");
  const hidden =
    failed.length - Math.min(failed.length, config.maxFailureDetails);
  const hiddenText = hidden > 0 ? `\n... ${hidden} more failures omitted` : "";
  return [
    `${failed.length}/${results.length} rooms failed. Elapsed ${elapsedMs}ms.`,
    details,
    hiddenText,
  ].join("\n");
}

function makeTraceId(): string {
  return randomBytes(16).toString("hex");
}

function makeSpanId(): string {
  return randomBytes(8).toString("hex");
}

function toUnixNanoString(ms: number): string {
  return String(Math.round(ms * 1_000_000));
}

function truncateAttribute(value: string, maxLength = 500): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function toOtlpAttributeValue(value: Exclude<OtlpAttributeValue, undefined>) {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value)
      ? { intValue: String(value) }
      : { doubleValue: value };
  }
  return { stringValue: value };
}

function toOtlpAttributes(attributes: OtlpAttributes) {
  return Object.entries(attributes)
    .filter(
      (entry): entry is [string, Exclude<OtlpAttributeValue, undefined>] =>
        entry[1] !== undefined,
    )
    .map(([key, value]) => ({
      key,
      value: toOtlpAttributeValue(value),
    }));
}

function classifyFailure(result: RoomResult): string {
  if (result.ok) return "none";
  const error = result.error?.toLowerCase() ?? "";
  if (error.includes("socket")) return "socket_error";
  if (error.includes("page.goto")) return "frontend_load_timeout";
  if (error.includes("stage-canvas-shell")) return "canvas_not_ready";
  if (error.includes("waitforfunction")) return "sync_timeout";
  if (error.includes("locator.click") || error.includes("펜")) {
    return "tool_not_ready";
  }
  if (error.includes("console") || error.includes("pageerror")) {
    return "browser_error";
  }
  return "unknown";
}

function getSnapshotAttributes(
  prefix: "drawer" | "viewer",
  snapshot: ClientSnapshot | undefined,
): OtlpAttributes {
  return {
    [`${prefix}.status`]: snapshot?.status,
    [`${prefix}.canvas.strokes`]: snapshot?.canvas?.strokes,
    [`${prefix}.canvas.stroke_points`]: snapshot?.canvas?.strokePoints,
    [`${prefix}.realtime.remote_stroke_count`]:
      snapshot?.realtime?.remoteStrokeCount,
    [`${prefix}.realtime.applied_update_count`]:
      snapshot?.realtime?.appliedUpdateCount,
    [`${prefix}.realtime.sync_request_count`]:
      snapshot?.realtime?.syncRequestCount,
    [`${prefix}.realtime.sync_response_count`]:
      snapshot?.realtime?.syncResponseCount,
    [`${prefix}.receive.applied`]: snapshot?.receiveDiagnostics?.applied,
    [`${prefix}.receive.errors`]: snapshot?.receiveDiagnostics?.errors,
    [`${prefix}.receive.handler_max_ms`]:
      snapshot?.receiveDiagnostics?.handlerMs?.max,
  };
}

function makeRoomSummaryAttributes(
  result: RoomResult,
  roomIndex: number,
): OtlpAttributes {
  return {
    ...getBaseTestAttributes(),
    "room.id": result.roomId,
    "room.index": roomIndex + 1,
    "room.ok": result.ok,
    "room.elapsed_ms": result.elapsedMs,
    "room.sync_ms": result.syncMs,
    "room.failure_type": classifyFailure(result),
    "room.error": result.error ? truncateAttribute(result.error) : undefined,
    "drawer.actor.id": result.drawer.actorId,
    "viewer.actor.id": result.viewer.actorId,
    ...getSnapshotAttributes("drawer", result.drawer.snapshot),
    ...getSnapshotAttributes("viewer", result.viewer.snapshot),
  };
}

function makeRunSummaryAttributes(
  results: RoomResult[],
  startedAt: number,
  elapsedMs: number,
): OtlpAttributes {
  const failed = results.filter((result) => !result.ok);
  return {
    ...getBaseTestAttributes(),
    "test.result": isRunSuccessful(results, elapsedMs) ? "pass" : "fail",
    "test.started_at": new Date(startedAt).toISOString(),
    "test.ended_at": new Date(startedAt + elapsedMs).toISOString(),
    "test.elapsed_ms": elapsedMs,
    "test.passed_rooms": results.length - failed.length,
    "test.failed_rooms": failed.length,
    "test.max_room_elapsed_ms": Math.max(
      ...results.map((result) => result.elapsedMs),
    ),
    "test.max_sync_ms": Math.max(
      ...results.map((result) => result.syncMs ?? 0),
    ),
  };
}

function makeOtlpSpan(input: {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startMs: number;
  endMs: number;
  attributes: OtlpAttributes;
  ok: boolean;
}) {
  return {
    traceId: input.traceId,
    spanId: input.spanId,
    parentSpanId: input.parentSpanId,
    name: input.name,
    kind: 1,
    startTimeUnixNano: toUnixNanoString(input.startMs),
    endTimeUnixNano: toUnixNanoString(input.endMs),
    attributes: toOtlpAttributes(input.attributes),
    status: input.ok ? { code: 1 } : { code: 2, message: "failed" },
  };
}

async function emitLoadTestSummarySpans(
  results: RoomResult[],
  startedAt: number,
  elapsedMs: number,
): Promise<void> {
  if (!config.emitOtelSummary || !config.otelEndpoint) return;

  const traceId = makeTraceId();
  const runSpanId = makeSpanId();
  const runOk = isRunSuccessful(results, elapsedMs);
  const spans = [
    makeOtlpSpan({
      traceId,
      spanId: runSpanId,
      name: "loadtest.run",
      startMs: startedAt,
      endMs: startedAt + elapsedMs,
      attributes: makeRunSummaryAttributes(results, startedAt, elapsedMs),
      ok: runOk,
    }),
    ...results.map((result, roomIndex) =>
      makeOtlpSpan({
        traceId,
        spanId: makeSpanId(),
        parentSpanId: runSpanId,
        name: "loadtest.room",
        startMs: result.startedAtMs,
        endMs: result.endedAtMs,
        attributes: makeRoomSummaryAttributes(result, roomIndex),
        ok: result.ok,
      }),
    ),
  ];
  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: toOtlpAttributes({
            "service.name": "playwright-loadtest",
            "deployment.environment.name": "local",
            ...getBaseTestAttributes(),
          }),
        },
        scopeSpans: [
          {
            scope: {
              name: "playwright-room-pairs",
            },
            spans,
          },
        ],
      },
    ],
  };

  const response = await fetch(config.otelEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `OTEL summary export failed: ${response.status} ${response.statusText}`,
    );
  }
}

async function runRoomPair(
  browser: Browser,
  roomIndex: number,
): Promise<RoomResult> {
  const roomId = makeRoomId(roomIndex);
  const drawerActorId = makeActorId(roomIndex, "teacher");
  const viewerActorId = makeActorId(roomIndex, "student");
  const drawerMessages: ClientMessage[] = [];
  const viewerMessages: ClientMessage[] = [];
  const contexts: BrowserContext[] = [];
  const startedAt = Date.now();
  let drawerPage: Page | undefined;
  let viewerPage: Page | undefined;
  let syncMs: number | undefined;

  try {
    if (config.contextMode === "user") {
      const drawerContext = await createContext(browser);
      const viewerContext = await createContext(browser);
      contexts.push(drawerContext, viewerContext);
      [drawerPage, viewerPage] = await Promise.all([
        openClient(
          drawerContext,
          roomId,
          drawerActorId,
          "teacher",
          drawerMessages,
        ),
        openClient(
          viewerContext,
          roomId,
          viewerActorId,
          "student",
          viewerMessages,
        ),
      ]);
    } else {
      const context = await createContext(browser);
      contexts.push(context);
      [drawerPage, viewerPage] = await Promise.all([
        openClient(context, roomId, drawerActorId, "teacher", drawerMessages),
        openClient(context, roomId, viewerActorId, "student", viewerMessages),
      ]);
    }

    for (
      let strokeIndex = 0;
      strokeIndex < config.strokesPerRoom;
      strokeIndex += 1
    ) {
      await drawStroke(drawerPage, roomIndex, strokeIndex);
    }
    syncMs = await waitForViewerStroke(viewerPage, config.strokesPerRoom);
    if (config.settleMs > 0) {
      await viewerPage.waitForTimeout(config.settleMs);
    }

    const [drawerSnapshot, viewerSnapshot] = await Promise.all([
      readSnapshot(drawerPage),
      readSnapshot(viewerPage),
    ]);
    const messages = [...drawerMessages, ...viewerMessages].filter(
      (message) => message.type === "pageerror" || message.type === "error",
    );
    if (config.failOnConsoleError && messages.length > 0) {
      throw new Error(
        messages
          .slice(0, 3)
          .map((message) => message.text)
          .join(" | "),
      );
    }

    const endedAt = Date.now();
    return {
      roomId,
      ok: true,
      startedAtMs: startedAt,
      endedAtMs: endedAt,
      elapsedMs: endedAt - startedAt,
      syncMs,
      drawer: {
        actorId: drawerActorId,
        messages: drawerMessages,
        snapshot: drawerSnapshot,
      },
      viewer: {
        actorId: viewerActorId,
        messages: viewerMessages,
        snapshot: viewerSnapshot,
      },
    };
  } catch (error) {
    const [drawerSnapshot, viewerSnapshot] = await Promise.all([
      drawerPage ? readSnapshot(drawerPage).catch(() => undefined) : undefined,
      viewerPage ? readSnapshot(viewerPage).catch(() => undefined) : undefined,
    ]);

    const endedAt = Date.now();
    return {
      roomId,
      ok: false,
      startedAtMs: startedAt,
      endedAtMs: endedAt,
      elapsedMs: endedAt - startedAt,
      syncMs,
      error: redactSensitiveText(
        error instanceof Error ? error.message : String(error),
      ),
      drawer: {
        actorId: drawerActorId,
        messages: drawerMessages,
        snapshot: drawerSnapshot,
      },
      viewer: {
        actorId: viewerActorId,
        messages: viewerMessages,
        snapshot: viewerSnapshot,
      },
    };
  } finally {
    await closeContexts(contexts);
  }
}

test.describe("Realtime room pairs load", () => {
  const timeoutLabel = hasRunTimeout()
    ? "within the run timeout"
    : "without a total run timeout";

  test(`${config.rooms} rooms x ${config.usersPerRoom} users can join and sync strokes ${timeoutLabel}`, async ({}, testInfo) => {
    expect(
      config.usersPerRoom,
      "This test is intentionally scoped to 1:1 rooms.",
    ).toBe(2);
    expect(["room", "user"].includes(config.contextMode)).toBe(true);
    await runPreflight();

    const browser = await launchBrowser();
    const startedAt = Date.now();
    try {
      const runWithSlot = createSemaphore(
        Math.min(config.roomConcurrency, config.rooms),
      );
      const results = await Promise.all(
        Array.from({ length: config.rooms }, (_, roomIndex) =>
          runWithSlot(() => runRoomPair(browser, roomIndex)),
        ),
      );
      const elapsedMs = Date.now() - startedAt;
      const failed = results.filter((result) => !result.ok);
      const report = {
        runId,
        startedAt: new Date(startedAt).toISOString(),
        endedAt: new Date().toISOString(),
        elapsedMs,
        config: {
          appUrl: config.appUrl,
          inkServer: config.inkServer,
          testRunId: runId,
          testScenario: getTestScenario(),
          testStack: config.testStack,
          rooms: config.rooms,
          usersPerRoom: config.usersPerRoom,
          roomConcurrency: config.roomConcurrency,
          strokesPerRoom: config.strokesPerRoom,
          startupTimeoutMs: config.startupTimeoutMs,
          realtimeTimeoutMs: config.realtimeTimeoutMs,
          syncTimeoutMs: config.syncTimeoutMs,
          runTimeoutMs: config.runTimeoutMs,
          preflight: config.preflight,
          settleMs: config.settleMs,
          viewport: config.viewport,
          contextMode: config.contextMode,
          failOnConsoleError: config.failOnConsoleError,
          roomPrefix: config.roomPrefix,
          actorPrefix: config.actorPrefix,
          pageId: config.pageId,
          otelEndpoint: config.otelEndpoint,
          emitOtelSummary: config.emitOtelSummary,
          strictAssertions: config.strictAssertions,
        },
        summary: {
          ok: failed.length === 0 && isElapsedWithinRunTimeout(elapsedMs),
          rooms: config.rooms,
          passed: results.length - failed.length,
          failed: failed.length,
          maxRoomElapsedMs: Math.max(
            ...results.map((result) => result.elapsedMs),
          ),
          maxSyncMs: Math.max(...results.map((result) => result.syncMs ?? 0)),
        },
        failures: failed.map(makeFailureMessage),
        results,
      };

      if (config.writeReport) {
        await mkdir(path.dirname(config.reportPath), { recursive: true });
        await writeFile(config.reportPath, JSON.stringify(report, null, 2));
        await testInfo.attach("realtime-room-pairs-report", {
          path: config.reportPath,
          contentType: "application/json",
        });
      }

      try {
        await emitLoadTestSummarySpans(results, startedAt, elapsedMs);
      } catch (error) {
        const message = `[room-pairs] ${formatEndpointError(error)}`;
        if (config.failOnOtelSummary) {
          throw new Error(message);
        }
        console.warn(message);
      }

      const failureSummary = makeFailureSummary(results, elapsedMs);
      if (config.strictAssertions) {
        expect(failed.length, failureSummary).toBe(0);
        if (hasRunTimeout()) {
          expect(
            elapsedMs,
            config.writeReport
              ? `${failureSummary}\nReport: ${config.reportPath}`
              : failureSummary,
          ).toBeLessThanOrEqual(config.runTimeoutMs);
        }
      } else if (failed.length > 0 || !isElapsedWithinRunTimeout(elapsedMs)) {
        console.warn(
          `[room-pairs] non-strict run completed:\n${failureSummary}`,
        );
      }
    } finally {
      await browser.close();
    }
  });
});
