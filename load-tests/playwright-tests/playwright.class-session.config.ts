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

const sessionDurationMs = readInteger(
  "CLASS_SESSION_DURATION_MS",
  3_600_000,
  1_000,
);
const runTimeoutMs = readTimeout("CLASS_SESSION_RUN_TIMEOUT_MS", 0, 1_000);
const testTimeoutMs = readInteger(
  "CLASS_SESSION_TEST_TIMEOUT_MS",
  runTimeoutMs > 0
    ? Math.max(90_000, runTimeoutMs + 30_000)
    : sessionDurationMs + 180_000,
  0,
);
const keepArtifacts = process.env.CLASS_SESSION_ARTIFACTS === "1";

export default defineConfig({
  testDir: "./",
  testMatch: "realtime-class-session.spec.ts",
  timeout: testTimeoutMs,
  expect: {
    timeout: readInteger("CLASS_SESSION_EXPECT_TIMEOUT_MS", 10_000, 1_000),
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
            outputFolder: "../../export-results/playwright-class-session-report",
            open: "never",
          },
        ],
        [
          "json",
          {
            outputFile:
              "../../export-results/playwright-class-session-results.json",
          },
        ],
      ]
    : [["list"]],
  use: {
    headless: process.env.CLASS_SESSION_HEADLESS !== "0",
    viewport: {
      width: readInteger("CLASS_SESSION_VIEWPORT_WIDTH", 1280, 320),
      height: readInteger("CLASS_SESSION_VIEWPORT_HEIGHT", 820, 240),
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
