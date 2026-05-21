import { defineConfig, devices } from "@playwright/test";

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

const runTimeoutMs = readTimeout("ROOM_PAIR_RUN_TIMEOUT_MS", 0, 1_000);
const testTimeoutMs = readInteger(
  "ROOM_PAIR_TEST_TIMEOUT_MS",
  runTimeoutMs > 0 ? Math.max(90_000, runTimeoutMs + 30_000) : 0,
  runTimeoutMs,
);
const keepArtifacts = process.env.ROOM_PAIR_ARTIFACTS === "1";

export default defineConfig({
  testDir: "./",
  testMatch: "realtime-room-pairs.spec.ts",
  timeout: testTimeoutMs,
  expect: {
    timeout: readInteger("ROOM_PAIR_EXPECT_TIMEOUT_MS", 10_000, 1_000),
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: keepArtifacts
    ? [
        ["list"],
        [
          "html",
          {
            outputFolder: "../../export-results/playwright-room-pairs-report",
            open: "never",
          },
        ],
        [
          "json",
          {
            outputFile:
              "../../export-results/playwright-room-pairs-results.json",
          },
        ],
      ]
    : [["list"]],
  use: {
    headless: process.env.ROOM_PAIR_HEADLESS !== "0",
    viewport: {
      width: readInteger("ROOM_PAIR_VIEWPORT_WIDTH", 1280, 320),
      height: readInteger("ROOM_PAIR_VIEWPORT_HEIGHT", 820, 240),
    },
    deviceScaleFactor: 1,
    trace: keepArtifacts ? "retain-on-failure" : "off",
    screenshot: keepArtifacts ? "only-on-failure" : "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
