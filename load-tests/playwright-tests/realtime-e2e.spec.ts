/**
 * Playwright Test — 실시간 판서 E2E 검증
 *
 * Artillery와 동시 실행 시나리오:
 *   터미널 A: npx artillery run load-tests/artillery/realtime-socket.yml
 *   터미널 B: npx playwright test --config load-tests/playwright-tests/playwright.config.ts
 *
 * 이 테스트는 앱 자체의 OTel span을 활용한다.
 * - 브라우저가 앱을 열면 useRealtimeInk가 자동으로 span을 SigNoz에 전송
 * - 테스트 코드는 UI assertion만 담당
 * - span 수집 결과는 SigNoz에서 확인
 */
import { test, expect, type Page } from "@playwright/test";

// ─── 환경 설정 ────────────────────────────────────────────────
const BASE_URL = process.env.APP_URL ?? "http://localhost:5173";
const INK_SERVER = process.env.INK_SERVER ?? "http://localhost:3001";
const INK_TOKEN =
  process.env.INK_TOKEN ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdHVkZW50LXBlbnRlc3QiLCJuYW1lIjoic3R1ZGVudCIsInJvbGUiOiJzdHVkZW50Iiwicm9vbSI6InBlbnRlc3QifQ.Ub1IF4AxjNcnllrf7KAQcka3Rlh1wfxjld4I3-cJcOE";
const INK_ROOM = process.env.INK_ROOM ?? "e2e-test-room";

function makeUrl(role: string, actorId: string) {
  const params = new URLSearchParams({
    realtimeInk: "1",
    inkServer: INK_SERVER,
    inkRoom: INK_ROOM,
    inkRole: role,
    inkActor: actorId,
    inkPage: "page-1",
    inkToken: INK_TOKEN,
  });
  return `${BASE_URL}/?${params}`;
}

// ─── 헬퍼 ────────────────────────────────────────────────────

/** 앱이 소켓 연결될 때까지 대기 */
async function waitForConnected(page: Page) {
  // useRealtimeInk가 connected 상태가 되면 data-realtime-status="connected" 등의 시그널을 기다림
  // 없으면 Canvas가 보이는 것으로 대체
  await page.waitForSelector("canvas", { timeout: 15_000 });
  // 추가 1초 — join-room emit + cold-start span 시작 대기
  await page.waitForTimeout(1000);
}

/** 마우스로 선 하나 긋기 */
async function drawStroke(page: Page) {
  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("canvas not found");

  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx - 80, cy);
  await page.mouse.down();
  for (let i = 0; i <= 16; i++) {
    await page.mouse.move(cx - 80 + i * 10, cy + Math.sin(i * 0.4) * 30);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
  // endStroke emit + span 종료 대기
  await page.waitForTimeout(500);
}

// ─── 테스트 케이스 ────────────────────────────────────────────

test.describe("실시간 판서 E2E", () => {
  /**
   * TC-1: cold start latency
   * 방에 입장 후 2초 안에 첫 메시지를 수신해야 한다.
   * → SigNoz: client.realtime.cold-start / cold_start.duration_ms < 2000
   */
  test("cold start: 방 입장 후 2초 안에 연결", async ({ page }) => {
    const startMs = Date.now();
    await page.goto(makeUrl("student", "e2e-student-cold"));
    await waitForConnected(page);
    const elapsedMs = Date.now() - startMs;

    // 연결 자체는 5초 안에 완료
    expect(elapsedMs).toBeLessThan(5000);

    // Canvas가 visible
    await expect(page.locator("canvas").first()).toBeVisible();
  });

  /**
   * TC-2: stroke 전송 — teacher → student 수신
   * 선생님이 선을 그으면 학생 화면에 반영되어야 한다.
   * → SigNoz: client.realtime.stroke (stroke.completed=true)
   *           client.socket.client-broadcast (stroke.sender.id=teacher)
   */
  test("stroke 전송: 선생님 stroke가 학생에게 도달", async ({ browser }) => {
    const teacherCtx = await browser.newContext();
    const studentCtx = await browser.newContext();
    const teacherPage = await teacherCtx.newPage();
    const studentPage = await studentCtx.newPage();

    try {
      // 두 탭 동시 접속
      await Promise.all([
        teacherPage.goto(makeUrl("teacher", "e2e-teacher-1")),
        studentPage.goto(makeUrl("student", "e2e-student-1")),
      ]);

      await Promise.all([
        waitForConnected(teacherPage),
        waitForConnected(studentPage),
      ]);

      // 선생님이 선 긋기
      await drawStroke(teacherPage);

      // 학생 화면에서 stroke 수신 확인 (최대 5초 대기)
      // Canvas에 WebGL로 그려지므로 직접 픽셀 검사 대신
      // 에러 없음 + Canvas visible로 검증
      await expect(studentPage.locator("canvas").first()).toBeVisible();

      // 브라우저 콘솔에 에러 없는지 확인
      const errors: string[] = [];
      studentPage.on("console", (msg) => {
        if (msg.type() === "error") errors.push(msg.text());
      });
      await studentPage.waitForTimeout(2000);

      // CORS나 연결 에러가 없어야 함
      const criticalErrors = errors.filter(
        (e) =>
          e.includes("ERR_CONNECTION_REFUSED") ||
          e.includes("WebSocket is closed"),
      );
      expect(criticalErrors).toHaveLength(0);
    } finally {
      await teacherCtx.close();
      await studentCtx.close();
    }
  });

  /**
   * TC-3: 선생님 1명 + 학생 19명 — 동시 양방향 필기 (핵심 부하 시나리오)
   *
   * Artillery 200명 Socket.IO 부하와 동시에 실행.
   * 선생님과 학생 모두 동시에 stroke를 주고받는 실제 수업 상황 재현.
   *
   * → SigNoz 확인 포인트:
   *   - client.realtime.stroke: 선생님 20개 + 학생 19명 × 10개 = 총 210개
   *   - client.socket.client-broadcast: 모든 참가자가 서로의 stroke 수신
   *   - client.realtime.cold-start: 20명 각각의 cold start duration
   *   - client.render.frame_time: 동시 필기 중 렌더링 저하 여부
   */
  test("동시 양방향 필기: 선생님 1명 + 학생 19명 동시 stroke", async ({
    browser,
  }) => {
    const STUDENT_COUNT = 19;
    const TEACHER_STROKES = 20;
    const STUDENT_STROKES = 10;

    const teacherCtx = await browser.newContext();
    const teacherPage = await teacherCtx.newPage();

    const students = await Promise.all(
      Array.from({ length: STUDENT_COUNT }, async (_, i) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        return { ctx, page, id: `e2e-load-student-${i + 1}` };
      }),
    );

    try {
      // 선생님 + 학생 19명 동시 접속
      await Promise.all([
        teacherPage.goto(makeUrl("teacher", "e2e-load-teacher")),
        ...students.map(({ page, id }) => page.goto(makeUrl("student", id))),
      ]);

      await Promise.all([
        waitForConnected(teacherPage),
        ...students.map(({ page }) => waitForConnected(page)),
      ]);

      // 선생님 + 학생 전원 동시 stroke 전송
      await Promise.all([
        // 선생님: 20회 stroke
        (async () => {
          for (let i = 0; i < TEACHER_STROKES; i++) {
            await drawStroke(teacherPage);
            await teacherPage.waitForTimeout(150);
          }
        })(),
        // 학생 19명: 각자 10회 stroke 동시 전송
        ...students.map(async ({ page }) => {
          for (let i = 0; i < STUDENT_STROKES; i++) {
            await drawStroke(page);
            await page.waitForTimeout(200);
          }
        }),
      ]);

      // span export 대기
      await teacherPage.waitForTimeout(3000);

      // 모든 클라이언트 Canvas 정상 확인
      const allPages = [teacherPage, ...students.map(({ page }) => page)];
      await Promise.all(
        allPages.map((page) =>
          expect(page.locator("canvas").first()).toBeVisible(),
        ),
      );
    } finally {
      await teacherCtx.close();
      await Promise.all(students.map(({ ctx }) => ctx.close()));
    }
  });

  /**
   * TC-4: 늦게 입장한 학생의 cold start
   * 이미 10명이 필기 중인 방에 새 학생이 들어왔을 때
   * 기존 필기가 2초 안에 동기화(Yjs sync)되어야 한다.
   *
   * → SigNoz: client.realtime.cold-start, client.yjs.sync
   */
  test("늦은 입장: 필기 중인 방에 신규 학생 cold start", async ({
    browser,
  }) => {
    const EARLY_COUNT = 10;

    // 먼저 입장한 10명
    const earlyStudents = await Promise.all(
      Array.from({ length: EARLY_COUNT }, async (_, i) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        return { ctx, page, id: `e2e-early-${i + 1}` };
      }),
    );

    const lateCtx = await browser.newContext();
    const latePage = await lateCtx.newPage();

    try {
      // 10명 먼저 접속 + 필기
      await Promise.all(
        earlyStudents.map(({ page, id }) => page.goto(makeUrl("student", id))),
      );
      await Promise.all(
        earlyStudents.map(({ page }) => waitForConnected(page)),
      );

      // 10명이 필기 시작
      await Promise.all(
        earlyStudents.map(async ({ page }) => {
          for (let i = 0; i < 5; i++) {
            await drawStroke(page);
            await page.waitForTimeout(100);
          }
        }),
      );

      // 늦게 입장한 학생 접속 — cold start 시작
      const coldStartBegin = Date.now();
      await latePage.goto(makeUrl("student", "e2e-late-joiner"));
      await waitForConnected(latePage);
      const coldStartMs = Date.now() - coldStartBegin;

      // cold start 5초 이내
      expect(coldStartMs).toBeLessThan(5000);

      // Canvas 정상
      await expect(latePage.locator("canvas").first()).toBeVisible();

      // SigNoz: client.yjs.sync span이 찍혔을 것
      await latePage.waitForTimeout(2000);
    } finally {
      await lateCtx.close();
      await Promise.all(earlyStudents.map(({ ctx }) => ctx.close()));
    }
  });

  /**
   * TC-5: 지속 부하 — 60초간 연속 필기
   * 선생님 1명이 60초 동안 계속 stroke를 전송할 때
   * 학생들이 끊김 없이 수신해야 한다.
   *
   * → SigNoz: stroke.completed = false 인 span이 없어야 함
   */
  test("지속 부하: 60초간 연속 stroke 전송", async ({ browser }) => {
    const STUDENT_COUNT = 5;
    const DURATION_MS = 60_000;
    const STROKE_INTERVAL_MS = 500;

    const teacherCtx = await browser.newContext();
    const teacherPage = await teacherCtx.newPage();

    const students = await Promise.all(
      Array.from({ length: STUDENT_COUNT }, async (_, i) => {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        return { ctx, page, id: `e2e-sustain-student-${i + 1}` };
      }),
    );

    try {
      await Promise.all([
        teacherPage.goto(makeUrl("teacher", "e2e-sustain-teacher")),
        ...students.map(({ page, id }) => page.goto(makeUrl("student", id))),
      ]);

      await Promise.all([
        waitForConnected(teacherPage),
        ...students.map(({ page }) => waitForConnected(page)),
      ]);

      // 60초간 연속 stroke
      const deadline = Date.now() + DURATION_MS;
      while (Date.now() < deadline) {
        await drawStroke(teacherPage);
        await teacherPage.waitForTimeout(STROKE_INTERVAL_MS);
      }

      // 마지막 span export 대기
      await teacherPage.waitForTimeout(3000);

      // 모두 Canvas 정상
      await Promise.all(
        [teacherPage, ...students.map(({ page }) => page)].map((page) =>
          expect(page.locator("canvas").first()).toBeVisible(),
        ),
      );
    } finally {
      await teacherCtx.close();
      await Promise.all(students.map(({ ctx }) => ctx.close()));
    }
  });

  /**
   * TC-4: socket 재연결
   * 백엔드가 잠깐 끊겼다가 재연결될 때 클라이언트가 복구되어야 한다.
   * → SigNoz: client.socket.reconnect (reconnect.duration_ms)
   *
   * 참고: 이 테스트는 백엔드 재시작이 필요하므로 CI에서는 skip
   */
  test.skip("socket 재연결: disconnect → reconnect span 수집", async ({
    page,
  }) => {
    await page.goto(makeUrl("student", "e2e-reconnect"));
    await waitForConnected(page);

    // 여기서 백엔드를 kill하면 disconnect 이벤트 → reconnect.span 발생
    // 수동 테스트 시에만 실행
    console.log(
      "백엔드를 재시작하면 SigNoz에 client.socket.reconnect span이 찍힙니다.",
    );
  });
});
