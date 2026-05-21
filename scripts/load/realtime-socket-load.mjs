import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { io } from "socket.io-client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const socketPath = "/handwriting/socket.io/";
const protocolName = "pentest-ink";

const helpText = `
Realtime socket-only load test

Runs Socket.IO clients without browsers. Use this to isolate relay/fanout
capacity from WebGL, React, Yjs rendering, and browser trace overhead.

Usage:
  npm run load:realtime-socket -- --users=200 --room=socket-load --token=local-dev
  node scripts/load/realtime-socket-load.mjs --users=200 --room=socket-load

Options:
  --server=<url>              Realtime server URL. Default: http://127.0.0.1:3000
  --token=<token>             Socket token. Default: INK_TOKEN or local-dev
  --room=<room-id>            Shared room id or room prefix. Default: socket:<timestamp>
  --users=<n>                 Socket clients for single-room mode. Default: 100
  --rooms=<n>                 Room count for multi-room mode. Default: 1
  --users-per-room=<n>        Socket clients per room when rooms > 1. Default: 2
  --senders=<n>               Active sender clients for single-room mode. Default: min(users, 10)
  --senders-per-room=<n>      Active sender clients per room when rooms > 1. Default: 1
  --duration=<ms>             Test duration. Default: 60000
  --send-interval=<ms>        Delay between strokes per sender. Default: 1000
  --append-batches=<n>        Append batches per stroke. Default: 4
  --points-per-batch=<n>      Points per append batch. Default: 2
  --ramp=<ms>                 Startup ramp. Default: 5000
  --volatile=<0|1>            Send append through volatile relay. Default: 1
  --report=<path>             JSON report path.
`;

function parseArguments(argv) {
  const result = {};
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") {
      result.help = true;
      continue;
    }
    if (!argument.startsWith("--")) continue;
    const [key, ...rawValue] = argument.slice(2).split("=");
    result[key] = rawValue.length > 0 ? rawValue.join("=") : "true";
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
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function redactConfig(config) {
  return {
    ...config,
    token: config.token ? "[redacted]" : "",
  };
}

function formatErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeRunId() {
  return new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

function encodeMessage(message) {
  return new TextEncoder().encode(JSON.stringify(message)).buffer;
}

function decodeMessage(payload) {
  try {
    const text =
      typeof payload === "string"
        ? payload
        : Buffer.from(payload).toString("utf8");
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function makeTraceCarrier(index, sequence) {
  const traceId = `${(index + 1).toString(16).padStart(8, "0")}${Date.now()
    .toString(16)
    .padStart(16, "0")}${sequence.toString(16).padStart(8, "0")}`.slice(0, 32);
  const spanId = `${index.toString(16).padStart(4, "0")}${sequence
    .toString(16)
    .padStart(12, "0")}`.slice(0, 16);
  return {
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

function makeRoomId(config, index) {
  if (config.rooms <= 1) return config.room;
  const width = String(config.rooms).length;
  const roomIndex = Math.floor(index / config.usersPerRoom);
  return `${config.room}-${String(roomIndex + 1).padStart(width, "0")}`;
}

async function connectClient(config, index) {
  const roomIndex =
    config.rooms <= 1 ? 0 : Math.floor(index / config.usersPerRoom);
  const roomMemberIndex =
    config.rooms <= 1 ? index : index % config.usersPerRoom;
  const client = {
    index,
    actorId: `${config.actorPrefix}-${index + 1}`,
    roomId: makeRoomId(config, index),
    roomIndex,
    roomMemberIndex,
    connected: false,
    joined: false,
    sent: 0,
    received: 0,
    receiveLatencyMs: [],
    messageTypes: {},
    errors: [],
    socket: undefined,
  };

  await new Promise((resolve, reject) => {
    const socket = io(config.server, {
      path: socketPath,
      transports: ["websocket"],
      query: { token: config.token },
      forceNew: true,
      reconnection: false,
      timeout: 10_000,
    });
    client.socket = socket;

    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`client ${index + 1} connect timeout`));
    }, 12_000);

    socket.on("connect", () => {
      client.connected = true;
      socket.emit("join-room", client.roomId, makeTraceCarrier(index, 0));
      client.joined = true;
      clearTimeout(timeout);
      resolve();
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("client-broadcast", (payload) => {
      const message = decodeMessage(payload);
      if (!message || message.actorId === client.actorId) return;
      client.received += 1;
      client.messageTypes[message.type] =
        (client.messageTypes[message.type] ?? 0) + 1;
      if (typeof message.sentAt === "number") {
        client.receiveLatencyMs.push(Date.now() - message.sentAt);
      }
    });
    socket.on("disconnect", (reason) => {
      client.connected = false;
      if (reason !== "io client disconnect")
        client.errors.push(`disconnect:${reason}`);
    });
  });

  return client;
}

function makePoint(senderIndex, strokeIndex, batchIndex, pointIndex) {
  return {
    x: 120 + senderIndex * 7 + strokeIndex * 3 + pointIndex * 12,
    y: 160 + batchIndex * 8 + Math.sin(pointIndex + strokeIndex) * 12,
  };
}

function emitMessage(client, config, eventName, message, sequence) {
  client.socket.emit(
    eventName,
    client.roomId,
    encodeMessage(message),
    new Uint8Array(),
    makeTraceCarrier(client.index, sequence),
  );
  client.sent += 1;
}

async function runSender(client, config, state) {
  let strokeIndex = 0;
  let sequence = 1;
  await sleep(Math.random() * config.sendIntervalMs);

  while (!state.stopping) {
    const strokeId = `socket_stroke_${client.index}_${strokeIndex}`;
    const firstPoint = makePoint(client.index, strokeIndex, 0, 0);
    emitMessage(
      client,
      config,
      "server-broadcast",
      {
        protocol: protocolName,
        version: 1,
        type: "ink:stroke:start",
        roomId: client.roomId,
        pageId: "page-1",
        actorId: client.actorId,
        actorRole: "student",
        strokeId,
        color: "#123c36",
        size: 4,
        layer: 50,
        point: firstPoint,
        sentAt: Date.now(),
      },
      sequence++,
    );

    const points = [firstPoint];
    for (let batch = 0; batch < config.appendBatches; batch += 1) {
      const batchPoints = [];
      for (let point = 0; point < config.pointsPerBatch; point += 1) {
        const nextPoint = makePoint(
          client.index,
          strokeIndex,
          batch,
          point + 1,
        );
        batchPoints.push(nextPoint);
        points.push(nextPoint);
      }
      emitMessage(
        client,
        config,
        config.volatile ? "server-volatile-broadcast" : "server-broadcast",
        {
          protocol: protocolName,
          version: 1,
          type: "ink:stroke:append",
          roomId: client.roomId,
          pageId: "page-1",
          actorId: client.actorId,
          actorRole: "student",
          strokeId,
          seq: batch + 1,
          color: "#123c36",
          size: 4,
          layer: 50,
          points: batchPoints,
          sentAt: Date.now(),
        },
        sequence++,
      );
    }

    emitMessage(
      client,
      config,
      "server-broadcast",
      {
        protocol: protocolName,
        version: 1,
        type: "ink:stroke:end",
        roomId: client.roomId,
        pageId: "page-1",
        actorId: client.actorId,
        actorRole: "student",
        strokeId,
        points,
        sentAt: Date.now(),
      },
      sequence++,
    );

    strokeIndex += 1;
    await sleep(config.sendIntervalMs + Math.random() * config.sendIntervalMs);
  }
}

function summarizeNumbers(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return undefined;
  const pick = (p) =>
    sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
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

function summarizeClientErrors(clients, limit = 5) {
  const counts = new Map();
  for (const client of clients) {
    for (const error of client.errors) {
      counts.set(error, (counts.get(error) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([message, count]) => ({ message, count }));
}

function countJoinedByRoom(clients) {
  const counts = new Map();
  for (const client of clients) {
    if (!client.joined) continue;
    counts.set(client.roomId, (counts.get(client.roomId) ?? 0) + 1);
  }
  return counts;
}

function countActiveRooms(clients) {
  const roomIds = new Set();
  for (const client of clients) {
    if (client.socket?.connected) roomIds.add(client.roomId);
  }
  return roomIds.size;
}

function selectSenderClients(clients, config) {
  const connectedClients = clients.filter((client) => client.socket?.connected);
  if (config.sendersPerRoom <= 0 || config.rooms <= 1) {
    return connectedClients.slice(0, config.senders);
  }

  const byRoom = new Map();
  for (const client of connectedClients) {
    const roomClients = byRoom.get(client.roomId) ?? [];
    roomClients.push(client);
    byRoom.set(client.roomId, roomClients);
  }

  const selected = [];
  for (const roomClients of byRoom.values()) {
    roomClients.sort((a, b) => a.roomMemberIndex - b.roomMemberIndex);
    selected.push(...roomClients.slice(0, config.sendersPerRoom));
  }
  return selected.slice(0, config.senders);
}

function makeReport(config, startedAt, clients, endedAt = Date.now()) {
  const joined = clients.filter((client) => client.joined).length;
  const activeSockets = clients.filter(
    (client) => client.socket?.connected,
  ).length;
  const sent = clients.reduce((sum, client) => sum + client.sent, 0);
  const received = clients.reduce((sum, client) => sum + client.received, 0);
  const joinedByRoom = countJoinedByRoom(clients);
  const expectedReceived = clients.reduce(
    (sum, client) =>
      sum +
      client.sent * Math.max(0, (joinedByRoom.get(client.roomId) ?? 0) - 1),
    0,
  );
  const latencyValues = clients.flatMap((client) => client.receiveLatencyMs);
  return {
    startedAt: new Date(startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    config: redactConfig(config),
    summary: {
      connected: joined,
      joined,
      activeSockets,
      activeRooms: countActiveRooms(clients),
      senderClients: clients.filter((client) => client.sent > 0).length,
      sent,
      received,
      expectedReceived,
      expectedMaxReceived: expectedReceived,
      receiveRate:
        expectedReceived > 0 ? received / expectedReceived : undefined,
      latencyMs: summarizeNumbers(latencyValues),
      errors: clients.reduce((sum, client) => sum + client.errors.length, 0),
      errorSamples: summarizeClientErrors(clients),
    },
    clients: clients.map((client) => ({
      index: client.index,
      actorId: client.actorId,
      roomId: client.roomId,
      roomIndex: client.roomIndex,
      roomMemberIndex: client.roomMemberIndex,
      joined: client.joined,
      active: Boolean(client.socket?.connected),
      sent: client.sent,
      received: client.received,
      messageTypes: client.messageTypes,
      latencyMs: summarizeNumbers(client.receiveLatencyMs),
      errors: client.errors,
    })),
  };
}

async function writeReport(config, report) {
  await mkdir(path.dirname(config.reportPath), { recursive: true });
  await writeFile(
    config.reportPath,
    `${JSON.stringify(report, null, 2)}\n`,
    "utf8",
  );
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    console.log(helpText.trim());
    return;
  }

  const runId = makeRunId();
  const rooms = parseInteger(
    args.rooms ?? process.env.REALTIME_SOCKET_ROOMS,
    1,
    1,
  );
  const usersPerRoom = parseInteger(
    args["users-per-room"] ?? process.env.REALTIME_SOCKET_USERS_PER_ROOM,
    rooms > 1 ? 2 : 0,
    0,
  );
  const requestedUsers = parseInteger(
    args.users ?? process.env.REALTIME_SOCKET_USERS,
    100,
    1,
  );
  const users = rooms > 1 ? rooms * usersPerRoom : requestedUsers;
  const sendersPerRoom = parseInteger(
    args["senders-per-room"] ?? process.env.REALTIME_SOCKET_SENDERS_PER_ROOM,
    rooms > 1 ? 1 : 0,
    0,
  );
  const requestedSenders = parseInteger(
    args.senders ?? process.env.REALTIME_SOCKET_SENDERS,
    10,
    1,
  );
  const config = {
    server: args.server ?? process.env.INK_SERVER ?? "http://127.0.0.1:3000",
    token: args.token ?? process.env.INK_TOKEN ?? "local-dev",
    room: args.room ?? process.env.INK_ROOM ?? `socket:${runId}`,
    rooms,
    usersPerRoom: rooms > 1 ? usersPerRoom : users,
    users,
    sendersPerRoom,
    senders: sendersPerRoom > 0 ? rooms * sendersPerRoom : requestedSenders,
    durationMs: parseInteger(
      args.duration ?? process.env.REALTIME_SOCKET_DURATION_MS,
      60_000,
      1000,
    ),
    sendIntervalMs: parseInteger(
      args["send-interval"] ?? process.env.REALTIME_SOCKET_SEND_INTERVAL_MS,
      1000,
      10,
    ),
    appendBatches: parseInteger(
      args["append-batches"] ?? process.env.REALTIME_SOCKET_APPEND_BATCHES,
      4,
      0,
    ),
    pointsPerBatch: parseInteger(
      args["points-per-batch"] ?? process.env.REALTIME_SOCKET_POINTS_PER_BATCH,
      2,
      1,
    ),
    rampMs: parseInteger(
      args.ramp ?? process.env.REALTIME_SOCKET_RAMP_MS,
      5000,
      0,
    ),
    volatile: parseBoolean(
      args.volatile ?? process.env.REALTIME_SOCKET_VOLATILE,
      true,
    ),
    actorPrefix: args["actor-prefix"] ?? `socket-${runId}`,
    reportPath: path.resolve(
      projectRoot,
      args.report ??
        process.env.REALTIME_SOCKET_REPORT ??
        `export-results/realtime-socket/realtime-socket-${runId}.json`,
    ),
  };
  config.senders = Math.min(config.senders, config.users);

  console.log("[realtime-socket] starting");
  console.log(JSON.stringify(redactConfig(config), null, 2));

  const startedAt = Date.now();
  const clients = [];
  const rampDelay =
    config.users > 0 ? Math.floor(config.rampMs / config.users) : 0;
  for (let index = 0; index < config.users; index += 1) {
    try {
      clients.push(await connectClient(config, index));
    } catch (error) {
      clients.push({
        index,
        actorId: `${config.actorPrefix}-${index + 1}`,
        roomId: makeRoomId(config, index),
        roomIndex:
          config.rooms <= 1 ? 0 : Math.floor(index / config.usersPerRoom),
        roomMemberIndex:
          config.rooms <= 1 ? index : index % config.usersPerRoom,
        connected: false,
        joined: false,
        sent: 0,
        received: 0,
        receiveLatencyMs: [],
        messageTypes: {},
        errors: [formatErrorMessage(error)],
      });
    }
    if ((index + 1) % 25 === 0 || index + 1 === config.users) {
      console.log(`[realtime-socket] clients=${index + 1}/${config.users}`);
    }
    if (rampDelay > 0) await sleep(rampDelay);
  }

  const joinedAfterStartup = clients.filter((client) => client.joined).length;
  const activeAfterStartup = clients.filter(
    (client) => client.socket?.connected,
  ).length;
  const errorSamples = summarizeClientErrors(clients);
  console.log(
    `[realtime-socket] startup joined=${joinedAfterStartup}/${config.users} active=${activeAfterStartup}/${config.users} errors=${clients.reduce(
      (sum, client) => sum + client.errors.length,
      0,
    )}`,
  );
  for (const sample of errorSamples) {
    console.log(`[realtime-socket] error x${sample.count}: ${sample.message}`);
  }

  const state = { stopping: false };
  const senderClients = selectSenderClients(clients, config);
  const senderTasks = senderClients.map((client) =>
    runSender(client, config, state),
  );

  if (senderClients.length === 0) {
    const report = makeReport(config, startedAt, clients);
    await writeReport(config, report);
    for (const client of clients) client.socket?.close();
    console.log(
      `[realtime-socket] no connected sender clients; report: ${config.reportPath}`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `[realtime-socket] senders=${senderClients.length}/${config.senders}`,
  );

  const statusTimer = setInterval(() => {
    const sent = clients.reduce((sum, client) => sum + client.sent, 0);
    const received = clients.reduce((sum, client) => sum + client.received, 0);
    const active = clients.filter((client) => client.socket?.connected).length;
    console.log(
      `[realtime-socket] active=${active} sent=${sent} received=${received}`,
    );
  }, 5000);

  await sleep(config.durationMs);
  clearInterval(statusTimer);
  state.stopping = true;
  await Promise.allSettled(senderTasks);
  await sleep(1000);

  for (const client of clients) client.socket?.close();

  const report = makeReport(config, startedAt, clients);

  await writeReport(config, report);
  console.log(
    `[realtime-socket] connected=${report.summary.joined}/${config.users} active=${report.summary.activeSockets}/${config.users} sent=${report.summary.sent} received=${report.summary.received} receiveRate=${
      report.summary.receiveRate === undefined
        ? "n/a"
        : `${(report.summary.receiveRate * 100).toFixed(2)}%`
    } p95Latency=${
      report.summary.latencyMs?.p95 === undefined
        ? "n/a"
        : `${report.summary.latencyMs.p95.toFixed(1)}ms`
    }`,
  );
  console.log(`[realtime-socket] report: ${config.reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
