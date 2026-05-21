import { readFile } from "node:fs/promises";

const reportPath = process.argv[2];

if (!reportPath) {
  console.error("Usage: node scripts/analysis/analyze-realtime-fleet.mjs <report.json>");
  process.exitCode = 1;
}

function pickApp(client) {
  return client.metrics?.app;
}

function pickReceive(client) {
  return client.metrics?.receiveDiagnostics;
}

function numberOr(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function topClients(clients, pickValue, limit = 8) {
  return clients
    .map((client) => ({
      index: client.index,
      actorId: client.actorId,
      value: pickValue(client),
      fps: pickApp(client)?.frame?.fps,
      p95FrameMs: pickApp(client)?.frame?.p95FrameMs,
      longTaskCount: pickApp(client)?.longTasks?.count,
      longTaskMaxMs: pickApp(client)?.longTasks?.maxDurationMs,
      received: pickReceive(client)?.received,
      applied: pickReceive(client)?.applied,
      receiveHandlerAvgMs: pickReceive(client)?.handlerMs?.average,
      receiveHandlerMaxMs: pickReceive(client)?.handlerMs?.max,
      strokes: pickApp(client)?.canvas?.strokes,
      strokePoints: pickApp(client)?.canvas?.strokePoints,
      remoteDrafts: pickApp(client)?.canvas?.remoteDrafts,
      yjsStrokeCount: pickApp(client)?.realtime?.strokeCount,
      messages: client.messages?.length ?? 0,
    }))
    .sort((left, right) => numberOr(right.value, -1) - numberOr(left.value, -1))
    .slice(0, limit);
}

function printTable(title, rows) {
  console.log(`\n${title}`);
  console.table(
    rows.map((row) => ({
      client: row.index + 1,
      value:
        typeof row.value === "number" ? Number(row.value.toFixed(2)) : row.value,
      fps: row.fps === undefined ? undefined : Number(row.fps.toFixed(2)),
      p95Frame:
        row.p95FrameMs === undefined
          ? undefined
          : Number(row.p95FrameMs.toFixed(2)),
      longTasks: row.longTaskCount,
      longTaskMax:
        row.longTaskMaxMs === undefined
          ? undefined
          : Number(row.longTaskMaxMs.toFixed(2)),
      received: row.received,
      applied: row.applied,
      handlerAvg:
        row.receiveHandlerAvgMs === undefined
          ? undefined
          : Number(row.receiveHandlerAvgMs.toFixed(3)),
      handlerMax:
        row.receiveHandlerMaxMs === undefined
          ? undefined
          : Number(row.receiveHandlerMaxMs.toFixed(3)),
      strokes: row.strokes,
      points: row.strokePoints,
      drafts: row.remoteDrafts,
      yjsStrokes: row.yjsStrokeCount,
      messages: row.messages,
    })),
  );
}

async function main() {
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const clients = report.clients ?? [];
  const summary = report.summary ?? {};

  console.log("[realtime-fleet-analysis]");
  console.log(
    JSON.stringify(
      {
        report: reportPath,
        startedAt: report.startedAt,
        durationMs: report.durationMs,
        verdict: report.verdict?.pass ? "pass" : "fail",
        issues: report.verdict?.issues ?? [],
        summary: {
          ready: summary.ready,
          connected: summary.connected,
          fps: summary.fps,
          p95FrameMs: summary.p95FrameMs,
          longTasks: summary.longTasks,
          receive: summary.receive,
          consistency: summary.consistency,
        },
      },
      null,
      2,
    ),
  );

  printTable(
    "Worst p95 frame clients",
    topClients(clients, (client) => pickApp(client)?.frame?.p95FrameMs),
  );
  printTable(
    "Worst receive handler clients",
    topClients(clients, (client) => pickReceive(client)?.handlerMs?.max),
  );
  printTable(
    "Worst long task clients",
    topClients(clients, (client) => pickApp(client)?.longTasks?.maxDurationMs),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
