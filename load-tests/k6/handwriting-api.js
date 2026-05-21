/**
 * k6 — 필기 저장/불러오기 HTTP API 부하 테스트
 *
 * 실행:
 *   k6 run load-tests/k6/handwriting-api.js
 *   k6 run --env BASE_URL=http://localhost:3001 --env TOKEN=xxx load-tests/k6/handwriting-api.js
 */
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend, Rate, Counter } from "k6/metrics";

// 커스텀 메트릭
const saveDuration = new Trend("handwriting_save_duration", true);
const loadDuration = new Trend("handwriting_load_duration", true);
const saveErrors = new Rate("handwriting_save_errors");
const loadErrors = new Rate("handwriting_load_errors");
const totalOps = new Counter("handwriting_total_ops");

export const options = {
  // 부하 단계: 10 → 50 → 100 VU ramping
  stages: [
    { duration: "30s", target: 10 },   // warmup
    { duration: "60s", target: 50 },   // ramp up
    { duration: "120s", target: 100 }, // peak
    { duration: "30s", target: 0 },    // cooldown
  ],

  // 임계값 — 초과 시 테스트 실패 표시
  thresholds: {
    http_req_duration: ["p(99)<3000"],         // 전체 HTTP p99 < 3s
    handwriting_save_duration: ["p(95)<2000"], // save p95 < 2s
    handwriting_load_duration: ["p(95)<1500"], // load p95 < 1.5s
    handwriting_save_errors: ["rate<0.01"],    // save 에러율 < 1%
    handwriting_load_errors: ["rate<0.01"],    // load 에러율 < 1%
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:3001";
const TOKEN = __ENV.TOKEN || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJzdHVkZW50LXBlbnRlc3QiLCJuYW1lIjoic3R1ZGVudCIsInJvbGUiOiJzdHVkZW50Iiwicm9vbSI6InBlbnRlc3QifQ.Ub1IF4AxjNcnllrf7KAQcka3Rlh1wfxjld4I3-cJcOE";

const headers = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${TOKEN}`,
};

// 테스트용 필기 데이터 생성
function makeHandwritingPayload(userId) {
  return JSON.stringify({
    roomId: "load-test-k6",
    pageId: "page-1",
    actorId: `k6-user-${userId}`,
    strokes: Array.from({ length: 5 }, (_, i) => ({
      id: `stroke-${userId}-${i}`,
      points: Array.from({ length: 20 }, () => ({
        x: Math.random() * 800,
        y: Math.random() * 600,
      })),
      color: "#3498db",
      size: 3,
    })),
  });
}

export default function () {
  const userId = `${__VU}-${__ITER}`;
  const payload = makeHandwritingPayload(userId);

  // --- Save ---
  const saveStart = Date.now();
  const saveRes = http.post(`${BASE_URL}/test/storage-json`, payload, {
    headers,
    tags: { operation: "save" },
  });
  saveDuration.add(Date.now() - saveStart);
  saveErrors.add(saveRes.status >= 400);
  totalOps.add(1);

  check(saveRes, {
    "save: status 2xx": (r) => r.status >= 200 && r.status < 300,
    "save: response time < 2000ms": (r) => r.timings.duration < 2000,
  });

  sleep(0.5);

  // --- Load ---
  const loadStart = Date.now();
  const loadRes = http.get(
    `${BASE_URL}/test/storage-json?roomId=load-test-k6&pageId=page-1`,
    {
      headers,
      tags: { operation: "load" },
    },
  );
  loadDuration.add(Date.now() - loadStart);
  loadErrors.add(loadRes.status >= 400);
  totalOps.add(1);

  check(loadRes, {
    "load: status 2xx": (r) => r.status >= 200 && r.status < 300,
    "load: response time < 1500ms": (r) => r.timings.duration < 1500,
  });

  sleep(1);
}

export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    thresholds_passed: Object.entries(data.metrics)
      .filter(([, m]) => m.thresholds)
      .every(([, m]) => Object.values(m.thresholds).every((t) => !t.ok === false)),
    save_p95_ms: data.metrics.handwriting_save_duration?.values?.["p(95)"],
    load_p95_ms: data.metrics.handwriting_load_duration?.values?.["p(95)"],
    save_error_rate: data.metrics.handwriting_save_errors?.values?.rate,
    load_error_rate: data.metrics.handwriting_load_errors?.values?.rate,
    total_ops: data.metrics.handwriting_total_ops?.values?.count,
  };

  console.log("\n=== K6 Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  return {
    stdout: JSON.stringify(summary, null, 2),
  };
}
