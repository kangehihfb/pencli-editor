import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright Test 설정
 *
 * Artillery(서버 부하)와 동시에 실행해서
 * "200명 부하 상황에서 실제 클라이언트가 어떻게 동작하는지" 측정
 */
export default defineConfig({
  testDir: "./",
  testMatch: "**/*.spec.ts",

  // 전체 타임아웃 — TC-5 (60초 연속 stroke + 정리) 여유분 포함
  timeout: 90_000,
  expect: { timeout: 10_000 },

  // 병렬 실행 — 탭 수 = workers 수
  fullyParallel: true,
  workers: 20, // 실제 브라우저 20개 동시 실행 (Artillery 200명과 병행 시)

  // 실패 시 리트라이 없음 (부하 테스트는 재현성이 중요)
  retries: 0,

  reporter: [
    ["list"],
    ["html", { outputFolder: "../../export-results/playwright-e2e-report", open: "never" }],
    ["json", { outputFile: "../../export-results/playwright-e2e-results.json" }],
  ],

  use: {
    // 실제 브라우저로 실행 (headed: false = headless)
    headless: true,
    viewport: { width: 1280, height: 820 },
    // 각 테스트에서 baseURL + URL params를 직접 지정
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
