import { mkdir, rename, writeFile } from "node:fs/promises";
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
    strokeHash?: string;
    objects?: number;
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

type HeartbeatResult = {
  index: number;
  ok: boolean;
  startedAtMs: number;
  endedAtMs: number;
  elapsedMs: number;
  realtimeReadyMs?: number;
  strokeDrawMs?: number;
  waitForSyncMs?: number;
  assertionMs?: number;
  settleMs?: number;
  snapshotMs?: number;
  waveStartedAtMs?: number;
  waveEndedAtMs?: number;
  waveElapsedMs?: number;
  syncMs?: number;
  error?: string;
  teacherSnapshot?: ClientSnapshot;
  studentSnapshot?: ClientSnapshot;
};

type RoomSession = {
  roomIndex: number;
  roomId: string;
  teacherActorId: string;
  studentActorId: string;
  teacherMessages: ClientMessage[];
  studentMessages: ClientMessage[];
  contexts: BrowserContext[];
  teacherPage?: Page;
  studentPage?: Page;
  startedAtMs: number;
  readyAtMs?: number;
  endedAtMs?: number;
  setupError?: string;
  finalError?: string;
  teacherSnapshot?: ClientSnapshot;
  studentSnapshot?: ClientSnapshot;
  heartbeats: HeartbeatResult[];
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

const runId = process.env.CLASS_SESSION_RUN_ID ?? makeRunId();
const config = {
  appUrl: process.env.APP_URL ?? "http://127.0.0.1:5173",
  inkServer: process.env.INK_SERVER ?? "http://127.0.0.1:3001",
  inkToken: process.env.INK_TOKEN ?? "",
  otelEndpoint: process.env.OTEL_ENDPOINT,
  testScenario:
    process.env.TEST_SCENARIO ??
    process.env.CLASS_SESSION_SCENARIO ??
    "class-session-1h-1to1",
  testStack:
    process.env.TEST_STACK ?? process.env.CLASS_SESSION_STACK ?? "socketio-yjs",
  rooms: readInteger("CLASS_SESSION_ROOMS", 100, 1),
  totalRooms: readInteger(
    "CLASS_SESSION_TOTAL_ROOMS",
    readInteger("CLASS_SESSION_ROOMS", 100, 1),
    1,
  ),
  roomStartIndex: readInteger("CLASS_SESSION_ROOM_START_INDEX", 1, 1),
  usersPerRoom: 2,
  startupConcurrency: readInteger("CLASS_SESSION_CONCURRENCY", 25, 1),
  heartbeatConcurrency: readInteger(
    "CLASS_SESSION_HEARTBEAT_CONCURRENCY",
    25,
    1,
  ),
  durationMs: readInteger("CLASS_SESSION_DURATION_MS", 3_600_000, 1_000),
  heartbeatIntervalMs: readInteger(
    "CLASS_SESSION_HEARTBEAT_INTERVAL_MS",
    300_000,
    1_000,
  ),
  initialHeartbeat: readBoolean("CLASS_SESSION_INITIAL_HEARTBEAT", true),
  startupTimeoutMs: readInteger(
    "CLASS_SESSION_STARTUP_TIMEOUT_MS",
    60_000,
    1_000,
  ),
  realtimeTimeoutMs: readInteger(
    "CLASS_SESSION_REALTIME_TIMEOUT_MS",
    60_000,
    1_000,
  ),
  syncTimeoutMs: readInteger("CLASS_SESSION_SYNC_TIMEOUT_MS", 30_000, 1_000),
  syncP95SlaMs: readTimeout("CLASS_SESSION_SYNC_P95_SLA_MS", 0, 1),
  syncMaxSlaMs: readTimeout("CLASS_SESSION_SYNC_MAX_SLA_MS", 0, 1),
  runTimeoutMs: readTimeout("CLASS_SESSION_RUN_TIMEOUT_MS", 0, 1_000),
  settleMs: readInteger("CLASS_SESSION_SETTLE_MS", 500, 0),
  headless: readBoolean("CLASS_SESSION_HEADLESS", true),
  preflight: readBoolean("CLASS_SESSION_PREFLIGHT", true),
  preflightTimeoutMs: readInteger(
    "CLASS_SESSION_PREFLIGHT_TIMEOUT_MS",
    5_000,
    1_000,
  ),
  writeReport: readBoolean("CLASS_SESSION_WRITE_REPORT", true),
  emitOtelSummary: readBoolean("CLASS_SESSION_OTEL_SUMMARY", true),
  emitPartialOtel: readBoolean("CLASS_SESSION_PARTIAL_OTEL", true),
  partialReportIntervalMs: readTimeout(
    "CLASS_SESSION_PARTIAL_REPORT_INTERVAL_MS",
    60_000,
    1_000,
  ),
  failOnOtelSummary: readBoolean("CLASS_SESSION_FAIL_ON_OTEL_SUMMARY", false),
  strictAssertions: readBoolean("CLASS_SESSION_STRICT_ASSERTIONS", true),
  maxFailureDetails: readInteger("CLASS_SESSION_MAX_FAILURE_DETAILS", 30, 1),
  viewport: {
    width: readInteger("CLASS_SESSION_VIEWPORT_WIDTH", 1280, 320),
    height: readInteger("CLASS_SESSION_VIEWPORT_HEIGHT", 820, 240),
  },
  shardId: process.env.CLASS_SESSION_SHARD_ID ?? "single",
  shardTotal: readInteger("CLASS_SESSION_SHARD_TOTAL", 1, 1),
  machineId:
    process.env.CLASS_SESSION_MACHINE_ID ?? process.env.HOSTNAME ?? "local",
  roomPrefix: process.env.CLASS_SESSION_ROOM_PREFIX ?? "class-session",
  actorPrefix: process.env.CLASS_SESSION_ACTOR_PREFIX ?? "class-session",
  pageId: process.env.CLASS_SESSION_PAGE_ID ?? "page-1",
  contextMode: process.env.CLASS_SESSION_CONTEXT_MODE ?? "room",
  failOnConsoleError: readBoolean("CLASS_SESSION_FAIL_ON_CONSOLE_ERROR", true),
  reportPath: path.resolve(
    process.cwd(),
    process.env.CLASS_SESSION_REPORT ??
      `export-results/playwright-class-session/realtime-class-session-${runId}.json`,
  ),
};

type OtlpAttributeValue = string | number | boolean | undefined;
type OtlpAttributes = Record<string, OtlpAttributeValue>;

function getTestUsers(): number {
  return config.rooms * config.usersPerRoom;
}

function getTotalTestUsers(): number {
  return config.totalRooms * config.usersPerRoom;
}

function hasRunTimeout(): boolean {
  return config.runTimeoutMs > 0;
}

function isElapsedWithinRunTimeout(elapsedMs: number): boolean {
  return !hasRunTimeout() || elapsedMs <= config.runTimeoutMs;
}

function getBaseTestAttributes(): OtlpAttributes {
  return {
    "test.kind": "class-session",
    "test.run_id": runId,
    "test.scenario": config.testScenario,
    "test.stack": config.testStack,
    "test.shard_id": config.shardId,
    "test.shard_total": config.shardTotal,
    "test.machine_id": config.machineId,
    "test.rooms": config.rooms,
    "test.total_rooms": config.totalRooms,
    "test.room_start_index": config.roomStartIndex,
    "test.users": getTestUsers(),
    "test.total_users": getTotalTestUsers(),
    "test.users_per_room": config.usersPerRoom,
    "test.concurrency": config.startupConcurrency,
    "test.duration_ms": config.durationMs,
    "test.heartbeat_interval_ms": config.heartbeatIntervalMs,
    "test.initial_heartbeat": config.initialHeartbeat,
    "test.run_timeout_enabled": hasRunTimeout(),
    "test.run_timeout_ms": config.runTimeoutMs,
    "test.partial_otel_enabled": config.emitPartialOtel,
    "test.partial_report_interval_ms": config.partialReportIntervalMs,
    "test.sync_p95_sla_ms": config.syncP95SlaMs || undefined,
    "test.sync_max_sla_ms": config.syncMaxSlaMs || undefined,
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
        "Start Vite on that exact port, or pass APP_URL with the actual dev/preview server URL.",
      ].join("\n"),
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function checkRealtimeEndpoint(): Promise<void> {
  if (!config.inkToken) {
    throw new Error(
      "INK_TOKEN is required for class-session load tests. Pass a valid backend JWT with INK_TOKEN.",
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function redactSensitiveText(value: string): string {
  return value
    .replace(/([?&](?:token|inkToken)=)[^&\s'"]+/g, "$1[redacted]")
    .replace(
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

function getGlobalRoomIndex(roomIndex: number): number {
  return config.roomStartIndex + roomIndex;
}

function getRoomNumberWidth(): number {
  return String(
    Math.max(config.totalRooms, config.roomStartIndex + config.rooms - 1),
  ).length;
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
  const roomNumber = String(getGlobalRoomIndex(index)).padStart(
    getRoomNumberWidth(),
    "0",
  );
  return `${config.roomPrefix}-${runId}-${roomNumber}`;
}

function makeActorId(roomIndex: number, role: ClientRole): string {
  const roomNumber = String(getGlobalRoomIndex(roomIndex)).padStart(
    getRoomNumberWidth(),
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
  url.searchParams.set("testScenario", config.testScenario);
  url.searchParams.set("testStack", config.testStack);
  url.searchParams.set("testRooms", String(config.rooms));
  url.searchParams.set("testTotalRooms", String(config.totalRooms));
  url.searchParams.set("testUsers", String(getTestUsers()));
  url.searchParams.set("testTotalUsers", String(getTotalTestUsers()));
  url.searchParams.set("testConcurrency", String(config.startupConcurrency));
  url.searchParams.set("testShardId", config.shardId);
  url.searchParams.set("testShardTotal", String(config.shardTotal));
  url.searchParams.set("inkTraceReceiveSampleRate", "1");
  if (config.otelEndpoint) {
    url.searchParams.set("otelEndpoint", config.otelEndpoint);
  }
  return url.toString();
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

async function waitForRealtimeConnected(page: Page, timeout: number) {
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
    { timeout },
  );
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
  await waitForRealtimeConnected(page, config.realtimeTimeoutMs);

  return page;
}

async function readSnapshot(page: Page | undefined): Promise<ClientSnapshot> {
  if (!page || page.isClosed()) return { status: "closed" };
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
  await waitForUsableCanvasShell(page, config.syncTimeoutMs);
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

async function drawHeartbeatStroke(
  page: Page,
  roomIndex: number,
  heartbeatIndex: number,
) {
  const box = await getCanvasShellBox(page);
  const seed = getGlobalRoomIndex(roomIndex) * 53 + heartbeatIndex * 29;
  const startX = box.x + box.width * (0.16 + (seed % 7) * 0.08);
  const startY = box.y + box.height * (0.22 + (seed % 9) * 0.055);
  const width = box.width * 0.16;
  const height = box.height * 0.035;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    const progress = step / 8;
    await page.mouse.move(
      startX + width * progress,
      startY + Math.sin(progress * Math.PI * 2 + seed) * height,
      { steps: 1 },
    );
  }
  await page.mouse.up();
}

async function waitForStudentStroke(page: Page, expectedStrokes: number) {
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

type NumberSummary = {
  count: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  average: number;
};

function summarizeNumbers(values: number[]): NumberSummary | undefined {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const pick = (percentile: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))
    ];
  return {
    count: sorted.length,
    min: sorted[0],
    p50: pick(0.5),
    p95: pick(0.95),
    p99: pick(0.99),
    max: sorted[sorted.length - 1],
    average: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function getExpectedHeartbeatWaves(): number {
  const intervalWaves = Math.ceil(
    config.durationMs / config.heartbeatIntervalMs,
  );
  return intervalWaves + (config.initialHeartbeat ? 1 : 0);
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
      "[class-session] Bundled Chromium launch failed. Falling back to local Chrome.",
    );
    console.warn(formatEndpointError(error));
    return chromium.launch({
      headless: config.headless,
      channel: "chrome",
      args,
    });
  }
}

async function closeSessions(sessions: RoomSession[]) {
  const contexts = sessions.flatMap((session) => session.contexts);
  await Promise.allSettled(contexts.map((context) => context.close()));
}

async function startRoomSession(
  browser: Browser,
  roomIndex: number,
): Promise<RoomSession> {
  const roomId = makeRoomId(roomIndex);
  const teacherActorId = makeActorId(roomIndex, "teacher");
  const studentActorId = makeActorId(roomIndex, "student");
  const teacherMessages: ClientMessage[] = [];
  const studentMessages: ClientMessage[] = [];
  const contexts: BrowserContext[] = [];
  const session: RoomSession = {
    roomIndex,
    roomId,
    teacherActorId,
    studentActorId,
    teacherMessages,
    studentMessages,
    contexts,
    startedAtMs: Date.now(),
    heartbeats: [],
  };

  try {
    if (config.contextMode === "user") {
      const teacherContext = await createContext(browser);
      const studentContext = await createContext(browser);
      contexts.push(teacherContext, studentContext);
      [session.teacherPage, session.studentPage] = await Promise.all([
        openClient(
          teacherContext,
          roomId,
          teacherActorId,
          "teacher",
          teacherMessages,
        ),
        openClient(
          studentContext,
          roomId,
          studentActorId,
          "student",
          studentMessages,
        ),
      ]);
    } else {
      const context = await createContext(browser);
      contexts.push(context);
      [session.teacherPage, session.studentPage] = await Promise.all([
        openClient(context, roomId, teacherActorId, "teacher", teacherMessages),
        openClient(context, roomId, studentActorId, "student", studentMessages),
      ]);
    }
    session.readyAtMs = Date.now();
  } catch (error) {
    session.setupError = formatEndpointError(error);
  }

  return session;
}

async function runHeartbeat(
  session: RoomSession,
  heartbeatIndex: number,
): Promise<HeartbeatResult> {
  const startedAtMs = Date.now();
  let syncMs: number | undefined;
  let realtimeReadyMs: number | undefined;
  let strokeDrawMs: number | undefined;
  let waitForSyncMs: number | undefined;
  let assertionMs: number | undefined;
  let settleMs: number | undefined;
  let snapshotMs: number | undefined;
  let error: string | undefined;

  try {
    if (!session.teacherPage || !session.studentPage) {
      throw new Error("room session was not ready");
    }
    if (session.teacherPage.isClosed() || session.studentPage.isClosed()) {
      throw new Error("page closed before heartbeat");
    }

    const realtimeStartedAt = Date.now();
    await Promise.all([
      waitForRealtimeConnected(session.teacherPage, config.realtimeTimeoutMs),
      waitForRealtimeConnected(session.studentPage, config.realtimeTimeoutMs),
    ]);
    realtimeReadyMs = Date.now() - realtimeStartedAt;

    const drawStartedAt = Date.now();
    await drawHeartbeatStroke(
      session.teacherPage,
      session.roomIndex,
      heartbeatIndex,
    );
    strokeDrawMs = Date.now() - drawStartedAt;

    const syncStartedAt = Date.now();
    waitForSyncMs = await waitForStudentStroke(
      session.studentPage,
      heartbeatIndex,
    );
    syncMs = waitForSyncMs;
    assertionMs = Date.now() - syncStartedAt;

    if (config.settleMs > 0) {
      const settleStartedAt = Date.now();
      await session.studentPage.waitForTimeout(config.settleMs);
      settleMs = Date.now() - settleStartedAt;
    }
  } catch (caught) {
    error = formatEndpointError(caught);
  }

  const snapshotStartedAt = Date.now();
  const [teacherSnapshot, studentSnapshot] = await Promise.all([
    readSnapshot(session.teacherPage),
    readSnapshot(session.studentPage),
  ]);
  snapshotMs = Date.now() - snapshotStartedAt;
  const endedAtMs = Date.now();
  const result: HeartbeatResult = {
    index: heartbeatIndex,
    ok: !error,
    startedAtMs,
    endedAtMs,
    elapsedMs: endedAtMs - startedAtMs,
    realtimeReadyMs,
    strokeDrawMs,
    waitForSyncMs,
    assertionMs,
    settleMs,
    snapshotMs,
    syncMs,
    error,
    teacherSnapshot,
    studentSnapshot,
  };
  session.heartbeats.push(result);
  return result;
}

function getRoomOk(session: RoomSession): boolean {
  if (session.setupError || session.finalError) return false;
  if (session.heartbeats.length === 0) return false;
  if (session.heartbeats.some((heartbeat) => !heartbeat.ok)) return false;
  if (session.teacherSnapshot?.status !== "connected") return false;
  if (session.studentSnapshot?.status !== "connected") return false;
  const messages = [...session.teacherMessages, ...session.studentMessages];
  if (
    config.failOnConsoleError &&
    messages.some(
      (message) => message.type === "pageerror" || message.type === "error",
    )
  ) {
    return false;
  }
  return true;
}

function classifyHeartbeatFailure(heartbeat: HeartbeatResult): string {
  if (heartbeat.ok) return "none";
  const error = heartbeat.error?.toLowerCase() ?? "";
  if (error.includes("connected")) return "realtime_not_connected";
  if (error.includes("closed")) return "page_closed";
  if (error.includes("stage-canvas-shell")) return "canvas_not_ready";
  if (error.includes("waitforfunction")) return "heartbeat_sync_timeout";
  if (error.includes("page.goto")) return "frontend_load_timeout";
  return "unknown";
}

function classifyRoomFailure(session: RoomSession): string {
  if (getRoomOk(session)) return "none";
  const error =
    session.setupError ??
    session.finalError ??
    session.heartbeats.find((heartbeat) => !heartbeat.ok)?.error ??
    "";
  const normalized = error.toLowerCase();
  if (session.setupError) return "room_setup_failed";
  if (normalized.includes("closed")) return "page_closed";
  if (normalized.includes("connected")) return "realtime_not_connected";
  if (normalized.includes("waitforfunction")) return "heartbeat_sync_timeout";
  if (normalized.includes("stage-canvas-shell")) return "canvas_not_ready";
  if (normalized.includes("console") || normalized.includes("pageerror")) {
    return "browser_error";
  }
  if (session.heartbeats.length === 0) return "no_heartbeat";
  return "unknown";
}

function getSnapshotAttributes(
  prefix: "teacher" | "student",
  snapshot: ClientSnapshot | undefined,
): OtlpAttributes {
  return {
    [`${prefix}.status`]: snapshot?.status,
    [`${prefix}.canvas.strokes`]: snapshot?.canvas?.strokes,
    [`${prefix}.canvas.stroke_points`]: snapshot?.canvas?.strokePoints,
    [`${prefix}.canvas.stroke_hash`]: snapshot?.canvas?.strokeHash,
    [`${prefix}.canvas.objects`]: snapshot?.canvas?.objects,
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

function getStrokeMatchAttributes(
  teacherSnapshot: ClientSnapshot | undefined,
  studentSnapshot: ClientSnapshot | undefined,
): OtlpAttributes {
  const teacherStrokes = teacherSnapshot?.canvas?.strokes;
  const studentStrokes = studentSnapshot?.canvas?.strokes;
  const teacherStrokePoints = teacherSnapshot?.canvas?.strokePoints;
  const studentStrokePoints = studentSnapshot?.canvas?.strokePoints;
  const teacherStrokeHash = teacherSnapshot?.canvas?.strokeHash;
  const studentStrokeHash = studentSnapshot?.canvas?.strokeHash;
  const hasStrokeHashes = Boolean(teacherStrokeHash && studentStrokeHash);

  return {
    "stroke.teacher_count": teacherStrokes,
    "stroke.student_count": studentStrokes,
    "stroke.count_delta":
      teacherStrokes !== undefined && studentStrokes !== undefined
        ? studentStrokes - teacherStrokes
        : undefined,
    "stroke.count_match":
      teacherStrokes !== undefined && studentStrokes !== undefined
        ? teacherStrokes === studentStrokes
        : undefined,
    "stroke.teacher_point_count": teacherStrokePoints,
    "stroke.student_point_count": studentStrokePoints,
    "stroke.point_count_delta":
      teacherStrokePoints !== undefined && studentStrokePoints !== undefined
        ? studentStrokePoints - teacherStrokePoints
        : undefined,
    "stroke.point_count_match":
      teacherStrokePoints !== undefined && studentStrokePoints !== undefined
        ? teacherStrokePoints === studentStrokePoints
        : undefined,
    "stroke.teacher_hash": teacherStrokeHash,
    "stroke.student_hash": studentStrokeHash,
    "stroke.hash_match": hasStrokeHashes
      ? teacherStrokeHash === studentStrokeHash
      : undefined,
  };
}

function getHeartbeatSummary(sessions: RoomSession[]) {
  const heartbeats = sessions.flatMap((session) => session.heartbeats);
  const failed = heartbeats.filter((heartbeat) => !heartbeat.ok);
  const syncValues = heartbeats
    .map((heartbeat) => heartbeat.syncMs)
    .filter((value): value is number => value !== undefined);
  const elapsedValues = heartbeats.map((heartbeat) => heartbeat.elapsedMs);
  const drawValues = heartbeats
    .map((heartbeat) => heartbeat.strokeDrawMs)
    .filter((value): value is number => value !== undefined);
  const waitForSyncValues = heartbeats
    .map((heartbeat) => heartbeat.waitForSyncMs)
    .filter((value): value is number => value !== undefined);
  const snapshotValues = heartbeats
    .map((heartbeat) => heartbeat.snapshotMs)
    .filter((value): value is number => value !== undefined);
  const waveElapsedValues = Array.from(
    new Map(
      heartbeats
        .filter(
          (
            heartbeat,
          ): heartbeat is HeartbeatResult & {
            waveElapsedMs: number;
          } => heartbeat.waveElapsedMs !== undefined,
        )
        .map((heartbeat) => [heartbeat.index, heartbeat.waveElapsedMs]),
    ).values(),
  );
  const actualWaves = new Set(heartbeats.map((heartbeat) => heartbeat.index))
    .size;
  const syncSummary = summarizeNumbers(syncValues);
  const elapsedSummary = summarizeNumbers(elapsedValues);
  return {
    total: heartbeats.length,
    passed: heartbeats.length - failed.length,
    failed: failed.length,
    actualWaves,
    syncMs: syncSummary,
    elapsedMs: elapsedSummary,
    strokeDrawMs: summarizeNumbers(drawValues),
    waitForSyncMs: summarizeNumbers(waitForSyncValues),
    snapshotMs: summarizeNumbers(snapshotValues),
    waveElapsedMs: summarizeNumbers(waveElapsedValues),
    maxSyncMs: syncSummary?.max ?? 0,
  };
}

function isRunSuccessful(sessions: RoomSession[], elapsedMs: number): boolean {
  const heartbeatSummary = getHeartbeatSummary(sessions);
  const syncP95Ok =
    config.syncP95SlaMs === 0 ||
    (heartbeatSummary.syncMs?.p95 !== undefined &&
      heartbeatSummary.syncMs.p95 <= config.syncP95SlaMs);
  const syncMaxOk =
    config.syncMaxSlaMs === 0 ||
    (heartbeatSummary.syncMs?.max !== undefined &&
      heartbeatSummary.syncMs.max <= config.syncMaxSlaMs);
  return (
    sessions.every((session) => getRoomOk(session)) &&
    isElapsedWithinRunTimeout(elapsedMs) &&
    syncP95Ok &&
    syncMaxOk
  );
}

function makeFailureMessage(session: RoomSession): string {
  const failedHeartbeat = session.heartbeats.find((heartbeat) => !heartbeat.ok);
  const teacherStatus = session.teacherSnapshot?.status ?? "unknown";
  const studentStatus = session.studentSnapshot?.status ?? "unknown";
  const studentRemote =
    session.studentSnapshot?.realtime?.remoteStrokeCount ?? 0;
  return `${session.roomId}: ${classifyRoomFailure(session)} ${
    session.setupError ??
    session.finalError ??
    failedHeartbeat?.error ??
    "failed"
  } teacher=${teacherStatus} student=${studentStatus} studentRemote=${studentRemote}`;
}

function makeFailureSummary(
  sessions: RoomSession[],
  elapsedMs: number,
): string {
  const failed = sessions.filter((session) => !getRoomOk(session));
  const heartbeatSummary = getHeartbeatSummary(sessions);
  const qualityLines = [
    `Heartbeat waves: ${heartbeatSummary.actualWaves}/${getExpectedHeartbeatWaves()}`,
    heartbeatSummary.syncMs
      ? `Heartbeat sync ms: p50=${heartbeatSummary.syncMs.p50} p95=${heartbeatSummary.syncMs.p95} max=${heartbeatSummary.syncMs.max}`
      : undefined,
    heartbeatSummary.waveElapsedMs
      ? `Heartbeat wave elapsed ms: p50=${heartbeatSummary.waveElapsedMs.p50} p95=${heartbeatSummary.waveElapsedMs.p95} max=${heartbeatSummary.waveElapsedMs.max}`
      : undefined,
  ]
    .filter(Boolean)
    .join("\n");
  if (failed.length === 0) {
    return [`Elapsed ${elapsedMs}ms.`, qualityLines].filter(Boolean).join("\n");
  }

  const details = failed
    .slice(0, config.maxFailureDetails)
    .map((session) => `- ${makeFailureMessage(session)}`)
    .join("\n");
  const hidden =
    failed.length - Math.min(failed.length, config.maxFailureDetails);
  const hiddenText = hidden > 0 ? `\n... ${hidden} more failures omitted` : "";
  return [
    `${failed.length}/${sessions.length} rooms failed. Elapsed ${elapsedMs}ms.`,
    qualityLines,
    details,
    hiddenText,
  ]
    .filter(Boolean)
    .join("\n");
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

function getOtlpResourceAttributes(): OtlpAttributes {
  return {
    "service.name": "playwright-loadtest",
    "deployment.environment.name": "local",
    ...getBaseTestAttributes(),
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

async function postOtlpSpans(spans: unknown[]): Promise<void> {
  if (!config.otelEndpoint || spans.length === 0) return;

  const body = {
    resourceSpans: [
      {
        resource: {
          attributes: toOtlpAttributes(getOtlpResourceAttributes()),
        },
        scopeSpans: [
          {
            scope: {
              name: "playwright-class-session",
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

function makeRunSummaryAttributes(
  sessions: RoomSession[],
  startedAt: number,
  elapsedMs: number,
): OtlpAttributes {
  const failedRooms = sessions.filter((session) => !getRoomOk(session));
  const heartbeatSummary = getHeartbeatSummary(sessions);
  const readyRooms = sessions.filter((session) => session.readyAtMs).length;
  return {
    ...getBaseTestAttributes(),
    "test.result": isRunSuccessful(sessions, elapsedMs) ? "pass" : "fail",
    "test.started_at": new Date(startedAt).toISOString(),
    "test.ended_at": new Date(startedAt + elapsedMs).toISOString(),
    "test.elapsed_ms": elapsedMs,
    "test.ready_rooms": readyRooms,
    "test.passed_rooms": sessions.length - failedRooms.length,
    "test.failed_rooms": failedRooms.length,
    "test.expected_heartbeat_waves": getExpectedHeartbeatWaves(),
    "test.actual_heartbeat_waves": heartbeatSummary.actualWaves,
    "test.heartbeat_total": heartbeatSummary.total,
    "test.heartbeat_passed": heartbeatSummary.passed,
    "test.heartbeat_failed": heartbeatSummary.failed,
    "test.max_heartbeat_sync_ms": heartbeatSummary.maxSyncMs,
    "test.p50_heartbeat_sync_ms": heartbeatSummary.syncMs?.p50,
    "test.p95_heartbeat_sync_ms": heartbeatSummary.syncMs?.p95,
    "test.p99_heartbeat_sync_ms": heartbeatSummary.syncMs?.p99,
    "test.p50_heartbeat_elapsed_ms": heartbeatSummary.elapsedMs?.p50,
    "test.p95_heartbeat_elapsed_ms": heartbeatSummary.elapsedMs?.p95,
    "test.p95_heartbeat_draw_ms": heartbeatSummary.strokeDrawMs?.p95,
    "test.p95_heartbeat_wait_for_sync_ms": heartbeatSummary.waitForSyncMs?.p95,
    "test.p95_heartbeat_snapshot_ms": heartbeatSummary.snapshotMs?.p95,
    "test.p95_heartbeat_wave_elapsed_ms": heartbeatSummary.waveElapsedMs?.p95,
  };
}

function makeRoomSummaryAttributes(session: RoomSession): OtlpAttributes {
  const failedHeartbeats = session.heartbeats.filter(
    (heartbeat) => !heartbeat.ok,
  );
  const syncValues = session.heartbeats
    .map((heartbeat) => heartbeat.syncMs)
    .filter((value): value is number => value !== undefined);
  const endedAtMs = session.endedAtMs ?? Date.now();
  return {
    ...getBaseTestAttributes(),
    "room.id": session.roomId,
    "room.index": session.roomIndex + 1,
    "room.global_index": getGlobalRoomIndex(session.roomIndex),
    "room.ok": getRoomOk(session),
    "room.ready": session.readyAtMs !== undefined,
    "room.elapsed_ms": endedAtMs - session.startedAtMs,
    "room.setup_ms": session.readyAtMs
      ? session.readyAtMs - session.startedAtMs
      : undefined,
    "room.failure_type": classifyRoomFailure(session),
    "room.error": session.setupError
      ? truncateAttribute(session.setupError)
      : session.finalError
        ? truncateAttribute(session.finalError)
        : undefined,
    "room.heartbeat_total": session.heartbeats.length,
    "room.heartbeat_failed": failedHeartbeats.length,
    "room.heartbeat_max_sync_ms":
      syncValues.length > 0 ? Math.max(...syncValues) : undefined,
    "teacher.actor.id": session.teacherActorId,
    "student.actor.id": session.studentActorId,
    ...getSnapshotAttributes("teacher", session.teacherSnapshot),
    ...getSnapshotAttributes("student", session.studentSnapshot),
  };
}

function makeHeartbeatAttributes(
  session: RoomSession,
  heartbeat: HeartbeatResult,
): OtlpAttributes {
  return {
    ...getBaseTestAttributes(),
    "room.id": session.roomId,
    "room.index": session.roomIndex + 1,
    "room.global_index": getGlobalRoomIndex(session.roomIndex),
    "heartbeat.index": heartbeat.index,
    "heartbeat.ok": heartbeat.ok,
    "heartbeat.elapsed_ms": heartbeat.elapsedMs,
    "heartbeat.realtime_ready_ms": heartbeat.realtimeReadyMs,
    "heartbeat.stroke_draw_ms": heartbeat.strokeDrawMs,
    "heartbeat.wait_for_sync_ms": heartbeat.waitForSyncMs,
    "heartbeat.assertion_ms": heartbeat.assertionMs,
    "heartbeat.settle_ms": heartbeat.settleMs,
    "heartbeat.snapshot_ms": heartbeat.snapshotMs,
    "heartbeat.wave_elapsed_ms": heartbeat.waveElapsedMs,
    "heartbeat.sync_ms": heartbeat.syncMs,
    "heartbeat.failure_type": classifyHeartbeatFailure(heartbeat),
    "heartbeat.error": heartbeat.error
      ? truncateAttribute(heartbeat.error)
      : undefined,
    ...getSnapshotAttributes("teacher", heartbeat.teacherSnapshot),
    ...getSnapshotAttributes("student", heartbeat.studentSnapshot),
    ...getStrokeMatchAttributes(
      heartbeat.teacherSnapshot,
      heartbeat.studentSnapshot,
    ),
  };
}

function makeHeartbeatWaveAttributes(
  sessions: RoomSession[],
  heartbeatIndex: number,
  results: HeartbeatResult[],
): OtlpAttributes {
  const syncSummary = summarizeNumbers(
    results
      .map((heartbeat) => heartbeat.syncMs)
      .filter((value): value is number => value !== undefined),
  );
  const elapsedSummary = summarizeNumbers(
    results.map((heartbeat) => heartbeat.elapsedMs),
  );
  const drawSummary = summarizeNumbers(
    results
      .map((heartbeat) => heartbeat.strokeDrawMs)
      .filter((value): value is number => value !== undefined),
  );
  const snapshotSummary = summarizeNumbers(
    results
      .map((heartbeat) => heartbeat.snapshotMs)
      .filter((value): value is number => value !== undefined),
  );
  const waveElapsedMs = results[0]?.waveElapsedMs;
  return {
    ...getBaseTestAttributes(),
    "test.export_phase": "partial",
    "heartbeat.index": heartbeatIndex,
    "heartbeat.wave_elapsed_ms": waveElapsedMs,
    "heartbeat.wave_expected_rooms": sessions.filter(
      (session) => !session.setupError,
    ).length,
    "heartbeat.wave_total": results.length,
    "heartbeat.wave_passed": results.filter((heartbeat) => heartbeat.ok).length,
    "heartbeat.wave_failed": results.filter((heartbeat) => !heartbeat.ok)
      .length,
    "heartbeat.wave_p50_sync_ms": syncSummary?.p50,
    "heartbeat.wave_p95_sync_ms": syncSummary?.p95,
    "heartbeat.wave_max_sync_ms": syncSummary?.max,
    "heartbeat.wave_p50_elapsed_ms": elapsedSummary?.p50,
    "heartbeat.wave_p95_elapsed_ms": elapsedSummary?.p95,
    "heartbeat.wave_p95_draw_ms": drawSummary?.p95,
    "heartbeat.wave_p95_snapshot_ms": snapshotSummary?.p95,
  };
}

async function emitHeartbeatWaveSpans(
  sessions: RoomSession[],
  heartbeatIndex: number,
  results: HeartbeatResult[],
): Promise<void> {
  if (!config.emitOtelSummary || !config.emitPartialOtel) return;
  if (!config.otelEndpoint) return;

  const traceId = makeTraceId();
  const waveSpanId = makeSpanId();
  const waveStartedAtMs =
    results[0]?.waveStartedAtMs ?? results[0]?.startedAtMs ?? Date.now();
  const waveEndedAtMs =
    results[0]?.waveEndedAtMs ?? results[0]?.endedAtMs ?? waveStartedAtMs;
  const sessionByRoomId = new Map(
    sessions.map((session) => [session.roomId, session]),
  );
  const resultSessionPairs = results
    .map((heartbeat) => {
      const session = sessions.find((candidate) =>
        candidate.heartbeats.includes(heartbeat),
      );
      return session ? { session, heartbeat } : undefined;
    })
    .filter(
      (
        pair,
      ): pair is {
        session: RoomSession;
        heartbeat: HeartbeatResult;
      } => Boolean(pair),
    );

  const spans = [
    makeOtlpSpan({
      traceId,
      spanId: waveSpanId,
      name: "loadtest.heartbeat-wave",
      startMs: waveStartedAtMs,
      endMs: waveEndedAtMs,
      attributes: makeHeartbeatWaveAttributes(
        Array.from(sessionByRoomId.values()),
        heartbeatIndex,
        results,
      ),
      ok: results.every((heartbeat) => heartbeat.ok),
    }),
    ...resultSessionPairs.map(({ session, heartbeat }) =>
      makeOtlpSpan({
        traceId,
        spanId: makeSpanId(),
        parentSpanId: waveSpanId,
        name: "loadtest.heartbeat",
        startMs: heartbeat.startedAtMs,
        endMs: heartbeat.endedAtMs,
        attributes: {
          ...makeHeartbeatAttributes(session, heartbeat),
          "test.export_phase": "partial",
        },
        ok: heartbeat.ok,
      }),
    ),
  ];

  await postOtlpSpans(spans);
}

async function emitLoadTestSummarySpans(
  sessions: RoomSession[],
  startedAt: number,
  elapsedMs: number,
): Promise<void> {
  if (!config.emitOtelSummary || !config.otelEndpoint) return;

  const traceId = makeTraceId();
  const runSpanId = makeSpanId();
  const runOk = isRunSuccessful(sessions, elapsedMs);
  const spans = [
    makeOtlpSpan({
      traceId,
      spanId: runSpanId,
      name: "loadtest.run",
      startMs: startedAt,
      endMs: startedAt + elapsedMs,
      attributes: {
        ...makeRunSummaryAttributes(sessions, startedAt, elapsedMs),
        "test.export_phase": "final",
      },
      ok: runOk,
    }),
    ...sessions.map((session) =>
      makeOtlpSpan({
        traceId,
        spanId: makeSpanId(),
        parentSpanId: runSpanId,
        name: "loadtest.room",
        startMs: session.startedAtMs,
        endMs: session.endedAtMs ?? startedAt + elapsedMs,
        attributes: {
          ...makeRoomSummaryAttributes(session),
          "test.export_phase": "final",
        },
        ok: getRoomOk(session),
      }),
    ),
    ...(config.emitPartialOtel
      ? []
      : sessions.flatMap((session) =>
          session.heartbeats.map((heartbeat) =>
            makeOtlpSpan({
              traceId,
              spanId: makeSpanId(),
              parentSpanId: runSpanId,
              name: "loadtest.heartbeat",
              startMs: heartbeat.startedAtMs,
              endMs: heartbeat.endedAtMs,
              attributes: {
                ...makeHeartbeatAttributes(session, heartbeat),
                "test.export_phase": "final",
              },
              ok: heartbeat.ok,
            }),
          ),
        )),
  ];
  await postOtlpSpans(spans);
}

function serializeSession(session: RoomSession) {
  return {
    roomIndex: session.roomIndex,
    roomGlobalIndex: getGlobalRoomIndex(session.roomIndex),
    roomId: session.roomId,
    ok: getRoomOk(session),
    failureType: classifyRoomFailure(session),
    teacherActorId: session.teacherActorId,
    studentActorId: session.studentActorId,
    startedAt: new Date(session.startedAtMs).toISOString(),
    readyAt: session.readyAtMs
      ? new Date(session.readyAtMs).toISOString()
      : undefined,
    endedAt: session.endedAtMs
      ? new Date(session.endedAtMs).toISOString()
      : undefined,
    setupError: session.setupError,
    finalError: session.finalError,
    teacherSnapshot: session.teacherSnapshot,
    studentSnapshot: session.studentSnapshot,
    heartbeats: session.heartbeats,
    teacherMessages: session.teacherMessages.slice(-20),
    studentMessages: session.studentMessages.slice(-20),
  };
}

async function writeReport(
  sessions: RoomSession[],
  startedAt: number,
  elapsedMs: number,
  options: {
    phase?: "partial" | "final";
    completed?: boolean;
    reason?: string;
  } = {},
) {
  if (!config.writeReport) return;
  const phase = options.phase ?? "final";
  const report = {
    runId,
    phase,
    completed: options.completed ?? phase === "final",
    reason: options.reason,
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(startedAt + elapsedMs).toISOString(),
    elapsedMs,
    config: {
      ...config,
      inkToken: config.inkToken ? "[redacted]" : "",
    },
    summary: makeRunSummaryAttributes(sessions, startedAt, elapsedMs),
    sessions: sessions.map(serializeSession),
  };
  await mkdir(path.dirname(config.reportPath), { recursive: true });
  const tempPath = `${config.reportPath}.tmp-${process.pid}`;
  await writeFile(tempPath, `${JSON.stringify(report, null, 2)}\n`);
  await rename(tempPath, config.reportPath);
}

async function collectFinalSnapshots(sessions: RoomSession[]) {
  await Promise.all(
    sessions.map(async (session) => {
      try {
        const [teacherSnapshot, studentSnapshot] = await Promise.all([
          readSnapshot(session.teacherPage),
          readSnapshot(session.studentPage),
        ]);
        session.teacherSnapshot = teacherSnapshot;
        session.studentSnapshot = studentSnapshot;
      } catch (error) {
        session.finalError = formatEndpointError(error);
      } finally {
        session.endedAtMs = Date.now();
      }
    }),
  );
}

type PartialReportWriter = (reason: string) => Promise<void>;
type HeartbeatWaveComplete = (
  heartbeatIndex: number,
  results: HeartbeatResult[],
) => Promise<void>;

async function runHeartbeatWave(
  sessions: RoomSession[],
  heartbeatIndex: number,
  onWaveComplete?: HeartbeatWaveComplete,
) {
  const readySessions = sessions.filter((session) => !session.setupError);
  const runWithHeartbeatSlot = createSemaphore(config.heartbeatConcurrency);
  const waveStartedAtMs = Date.now();
  const results = await Promise.all(
    readySessions.map((session) =>
      runWithHeartbeatSlot(() => runHeartbeat(session, heartbeatIndex)),
    ),
  );
  const waveEndedAtMs = Date.now();
  const waveElapsedMs = waveEndedAtMs - waveStartedAtMs;
  for (const result of results) {
    result.waveStartedAtMs = waveStartedAtMs;
    result.waveEndedAtMs = waveEndedAtMs;
    result.waveElapsedMs = waveElapsedMs;
  }
  await onWaveComplete?.(heartbeatIndex, results);
}

async function runSessionDuration(
  sessions: RoomSession[],
  onWaveComplete?: HeartbeatWaveComplete,
) {
  let heartbeatIndex = 0;
  const startedAt = Date.now();

  if (config.initialHeartbeat) {
    heartbeatIndex += 1;
    await runHeartbeatWave(sessions, heartbeatIndex, onWaveComplete);
  }

  while (Date.now() - startedAt < config.durationMs) {
    const elapsedMs = Date.now() - startedAt;
    const remainingMs = config.durationMs - elapsedMs;
    await sleep(Math.min(config.heartbeatIntervalMs, remainingMs));
    heartbeatIndex += 1;
    await runHeartbeatWave(sessions, heartbeatIndex, onWaveComplete);
  }
}

test.describe("Realtime class session load", () => {
  test(`keeps ${config.rooms} one-to-one class rooms alive and syncing heartbeat strokes`, async () => {
    test.setTimeout(
      readInteger(
        "CLASS_SESSION_TEST_TIMEOUT_MS",
        config.durationMs + config.startupTimeoutMs + 180_000,
        0,
      ),
    );

    await runPreflight();

    const startedAt = Date.now();
    const sessions: RoomSession[] = [];
    let finalReportWritten = false;
    let partialReportWrite: Promise<void> = Promise.resolve();
    let partialReportTimer: ReturnType<typeof setInterval> | undefined;
    const queuePartialReport: PartialReportWriter = async (reason) => {
      if (!config.writeReport || config.partialReportIntervalMs === 0) return;
      const nextWrite = partialReportWrite
        .then(async () => {
          await writeReport(sessions, startedAt, Date.now() - startedAt, {
            phase: "partial",
            completed: false,
            reason,
          });
        })
        .catch((error) => {
          console.warn(
            `[class-session] partial report failed (${reason}): ${formatEndpointError(
              error,
            )}`,
          );
        });
      partialReportWrite = nextWrite;
      await nextWrite;
    };
    const handleHeartbeatWaveComplete: HeartbeatWaveComplete = async (
      heartbeatIndex,
      results,
    ) => {
      try {
        await emitHeartbeatWaveSpans(sessions, heartbeatIndex, results);
      } catch (error) {
        if (config.failOnOtelSummary) throw error;
        console.warn(
          `[class-session] partial otel failed (heartbeat ${heartbeatIndex}): ${formatEndpointError(
            error,
          )}`,
        );
      }
      await queuePartialReport(`heartbeat-wave-${heartbeatIndex}`);
    };
    let browser: Browser | undefined;

    try {
      if (config.partialReportIntervalMs > 0) {
        partialReportTimer = setInterval(() => {
          void queuePartialReport("interval");
        }, config.partialReportIntervalMs);
      }
      browser = await launchBrowser();
      await queuePartialReport("startup-begin");
      const runWithStartupSlot = createSemaphore(config.startupConcurrency);
      const startedSessions = await Promise.all(
        Array.from({ length: config.rooms }, (_, roomIndex) =>
          runWithStartupSlot(() => startRoomSession(browser, roomIndex)),
        ),
      );
      sessions.push(...startedSessions);
      await queuePartialReport("startup-complete");

      await runSessionDuration(sessions, handleHeartbeatWaveComplete);
      await queuePartialReport("duration-complete");
      await collectFinalSnapshots(sessions);
      await queuePartialReport("final-snapshots-complete");

      const elapsedMs = Date.now() - startedAt;
      let otelError: string | undefined;
      try {
        await emitLoadTestSummarySpans(sessions, startedAt, elapsedMs);
      } catch (error) {
        otelError = formatEndpointError(error);
        if (config.failOnOtelSummary) throw error;
        console.warn(`[class-session] ${otelError}`);
      }

      if (partialReportTimer) {
        clearInterval(partialReportTimer);
        partialReportTimer = undefined;
      }
      await partialReportWrite;
      await writeReport(sessions, startedAt, elapsedMs, {
        phase: "final",
        completed: true,
      });
      finalReportWritten = true;

      const failed = sessions.filter((session) => !getRoomOk(session));
      const failureSummary = makeFailureSummary(sessions, elapsedMs);
      const heartbeatSummary = getHeartbeatSummary(sessions);
      console.log(
        [
          `[class-session] runId=${runId}`,
          `rooms=${config.rooms}`,
          `failedRooms=${failed.length}`,
          `heartbeats=${heartbeatSummary.passed}/${heartbeatSummary.total}`,
          `elapsedMs=${elapsedMs}`,
          `report=${config.writeReport ? config.reportPath : "disabled"}`,
          otelError ? `otelError=${otelError}` : undefined,
        ]
          .filter(Boolean)
          .join(" "),
      );

      if (config.strictAssertions) {
        expect(failed.length, failureSummary).toBe(0);
        expect(heartbeatSummary.failed, failureSummary).toBe(0);
        if (config.syncP95SlaMs > 0) {
          expect(
            heartbeatSummary.syncMs?.p95 ?? Number.POSITIVE_INFINITY,
            failureSummary,
          ).toBeLessThanOrEqual(config.syncP95SlaMs);
        }
        if (config.syncMaxSlaMs > 0) {
          expect(
            heartbeatSummary.syncMs?.max ?? Number.POSITIVE_INFINITY,
            failureSummary,
          ).toBeLessThanOrEqual(config.syncMaxSlaMs);
        }
        if (hasRunTimeout()) {
          expect(elapsedMs, failureSummary).toBeLessThanOrEqual(
            config.runTimeoutMs,
          );
        }
      }
    } finally {
      if (partialReportTimer) {
        clearInterval(partialReportTimer);
      }
      if (!finalReportWritten) {
        await queuePartialReport("finally");
      }
      await partialReportWrite;
      await closeSessions(sessions);
      await browser?.close();
    }
  });
});
