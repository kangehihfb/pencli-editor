# 실시간 부하 테스트

Docker 없이 20명, 50명, 100명 이상의 실시간 판서 사용자를 가볍게 확인하기 위한 실행 가이드다.

현재 관측 구조, OpenTelemetry 흐름, 2026-05-13 테스트 결과 정리는 아래 문서를 본다.

```txt
docs/realtime-observability-and-load-flow-2026-05-13.md
```

---

## 관측 백엔드 (SigNoz) 실행

> **SigNoz**가 Jaeger를 대체한다. OTLP 4317/4318 포트 + UI 8080 포트를 사용한다.

### 시작

```sh
# 최초 실행 시 SigNoz 레포를 observability/signoz/repo/에 자동 클론 (약 1분 소요)
npm run dev:signoz
```

SigNoz UI: **http://localhost:8080**

### 종료

```sh
npm run dev:signoz:down
```

### 데이터 초기화 (trace 전체 삭제)

```sh
npm run dev:signoz:reset
```

### 포트 충돌 주의

Jaeger가 실행 중이라면 포트 4317/4318이 충돌한다. SigNoz 시작 전 Jaeger를 먼저 종료한다.

```sh
# Jaeger 프로세스 찾기
lsof -i :4318
kill <PID>
```

### 백엔드 OTLP 설정 확인

`mildang-backend-handwriting/.env.development`에 아래 항목이 있어야 한다 (SigNoz와 Jaeger 모두 4318 포트 사용):

```env
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://localhost:4318/v1/traces
OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://localhost:4318/v1/metrics
OTEL_SERVICE_NAME=handwriting-backend
```

### 프론트엔드 OTel endpoint 설정

프론트 URL에 `otelEndpoint` 파라미터를 추가한다:

```
http://localhost:5173/?realtimeInk=1&inkServer=http%3A%2F%2Flocalhost%3A3001&...&otelEndpoint=http%3A%2F%2Flocalhost%3A3001%2Fotel%2Fv1%2Ftraces
```

### 전체 환경 한 번에 실행

```sh
# 터미널 3개 또는 tmux
npm run dev:signoz   # Docker: SigNoz
npm run dev:realtime # 백엔드 (로컬)
npm run dev          # 프론트엔드 (로컬)
```

---

## 이 테스트가 하는 일

`scripts/realtime-fleet.mjs`는 Playwright로 실제 Chromium 클라이언트를 여러 개 열고, 모두 같은 실시간 방에 접속시킨다.

- `--users=100`: 앱 클라이언트 100개가 같은 실시간 방에 접속한다.
- `--headed=4`: 4개는 눈에 보이는 브라우저 창으로 열고, 나머지는 headless로 실행한다.
- `--headless-browsers=4`: headless 클라이언트를 Chromium 프로세스 4개로 나눠 실행한다.
- `--mode=draw`: 각 가상 클라이언트가 synthetic stroke를 그린다.
- `--scenario=pen|text|mixed`: pen-only, text-only, mixed 부하를 분리해서 테스트한다.
- `--receive-trace-sample-rate=0.01`: 브라우저 receive span을 샘플링해서 Jaeger는 볼 수 있게 하되, 부하 테스트를 왜곡하지 않게 한다.
- `--draw-after-ready=1`: 모든 클라이언트 startup이 끝난 뒤 synthetic drawing을 시작한다.
- `--preflight=1`: 브라우저 100개를 열기 전에 Socket.IO 인증을 먼저 확인한다.
- `--wait-realtime=1`: 각 클라이언트가 Socket.IO `connected` 상태가 될 때까지 기다린다.
- `--app-metrics=1`: 앱 내부 FPS, frame time, Yjs, WebGL, stroke, point, object 지표를 수집한다.
- 시작 로그에 찍히는 manual URL로 같은 방에 직접 접속해서 fleet과 상호작용할 수 있다.

이 방식은 Selenoid/Selenium Grid보다 가볍다. 다만 여러 머신 브라우저 grid의 대체재는 아니다. 예를 들어 `--headed=100`처럼 한 PC에서 너무 많은 브라우저를 띄우면 앱보다 로컬 PC가 먼저 병목이 될 수 있다.

## 실행 준비

먼저 SigNoz, 백엔드, 프론트엔드를 실행한다.

```sh
npm run dev:signoz   # SigNoz (Docker) - 최초 클론 포함 자동 실행
npm run dev:realtime # 백엔드
npm run dev          # 프론트엔드
```

현재 백엔드 JWT 시크릿은 `.env.development`의 `JWT_SECRET` 값을 사용한다.

## 20명 테스트

```sh
npm run load:realtime-fleet -- \
  --url=http://127.0.0.1:5178/ \
  --server=http://127.0.0.1:3000 \
  --token=local-dev \
  --room=load-test-20 \
  --users=20 \
  --headed=4 \
  --mode=draw \
  --scenario=pen
```

## 50명 테스트

```sh
npm run load:realtime-fleet -- \
  --url=http://127.0.0.1:5178/ \
  --server=http://127.0.0.1:3000 \
  --token=local-dev \
  --room=load-test-50 \
  --users=50 \
  --headed=2 \
  --headless-browsers=8 \
  --mode=draw \
  --scenario=pen \
  --receive-trace-sample-rate=0.01 \
  --duration=60000 \
  --draw-interval=7000 \
  --settle=15000 \
  --metrics-timeout=20000 \
  --debug=1 \
  --probe=1 \
  --max-client-messages=2 \
  --stop-timeout=30000
```

## 접속만 확인하는 테스트

synthetic drawing 없이 접속/방 join만 확인한다.

```sh
npm run load:realtime-fleet -- \
  --url=http://127.0.0.1:5178/ \
  --server=http://127.0.0.1:3000 \
  --token=local-dev \
  --room=load-idle-100 \
  --users=100 \
  --headed=4 \
  --mode=idle \
  --click-pen=0
```

## 결과 확인

스크립트는 실행 중 아래 내용을 로그로 출력한다.

- ready client 수
- connected client 수
- failed client 수
- synthetic stroke 수
- 브라우저 console/page warning 또는 error
- min/average/max FPS
- 가장 나쁜 p95 frame time
- stroke/point/object consistency
- Yjs stroke/object consistency
- receive handler 처리 시간
- long task 수와 최대 시간

JSON report는 아래 경로에 저장된다.

```txt
export-results/realtime-fleet/
```

브라우저 병목 관점으로 report를 요약하려면:

```sh
npm run analyze:realtime-fleet -- export-results/realtime-fleet/realtime-fleet-YYYY-MM-DD.json
```

report에는 top-level `verdict`가 있다.

```json
{
  "verdict": {
    "pass": false,
    "issues": [
      "slowest client FPS 18.4 is below 25",
      "client state differs: strokes=120/119"
    ]
  }
}
```

기본 pass 기준:

- ready rate: `99%`
- connected rate: `99%`
- 가장 느린 client FPS: `>= 25`
- 가장 나쁜 client p95 frame: `<= 80ms`
- client console/page message: 기본 `0`, 로컬 favicon/정적 404까지 허용하려면 `--max-client-messages=2`
- average points per stroke: `<= 120`
- stroke/object/image/Yjs count가 client 간 일치해야 함

## 기준 조정

로컬 머신 병목이나 startup 지연이 있으면 threshold와 timeout을 조정한다.

```sh
npm run load:realtime-fleet -- \
  --url=http://127.0.0.1:5178/ \
  --server=http://127.0.0.1:3000 \
  --token=local-dev \
  --room=load-test-100 \
  --users=100 \
  --headed=6 \
  --headless-browsers=4 \
  --ramp=60000 \
  --startup-timeout=90000 \
  --realtime-timeout=90000 \
  --min-fps=20 \
  --max-p95-frame=100 \
  --max-client-messages=2
```

시작 로그에 찍히는 manual URL을 열면 fleet이 실행되는 방에 직접 teacher/client로 들어가서 그리기, 이동, 회전 등을 같이 확인할 수 있다.

## 추천 순서

1. `--users=20 --mode=draw --scenario=pen`
2. manual URL로 직접 접속해서 같이 그려보기
3. `--users=50 --mode=draw --scenario=pen`
4. `--users=100 --mode=idle`
5. `--scenario=text`
6. `--scenario=mixed`

idle은 안정적인데 draw만 불안정하면 메시지 양, stroke commit, Yjs update fanout, 렌더링 쪽을 본다.

idle도 draw도 모두 불안정하면 Socket.IO 연결, 인증, room join, 서버 process resource를 먼저 본다.

## 서버 relay만 테스트하기

브라우저/WebGL/React/Yjs를 빼고 서버 relay capacity만 보려면 Artillery Socket.IO 테스트를 기본으로 사용한다.

```sh
INK_TOKEN="your-jwt-token" npm run load:realtime-socket
```

`load:realtime-socket`은 서버 fanout 압박을 만드는 기본 엔트리다. 실제 브라우저에서 stroke/object가 맞는지까지 검증하는 테스트가 아니라, 많은 Socket.IO client가 한 방에 들어왔을 때 서버가 broadcast를 얼마나 버티는지 보는 용도다.

기존 Node 기반 socket-only 부하기는 상세 수신 카운트, multi-room, 1:1 구조를 빠르게 파고들 때 쓰는 debug 도구로 남겨둔다.

```sh
npm run load:realtime-socket:debug -- \
  --server=http://127.0.0.1:3000 \
  --token=local-dev \
  --room=socket-load-500 \
  --users=500 \
  --senders=20 \
  --duration=60000 \
  --send-interval=1000 \
  --append-batches=4 \
  --points-per-batch=2
```

주요 확인값:

- `connected`
- `sent`
- `received`
- `receiveRate`
- `p95Latency`

예시로 debug 부하기에서 500명 socket-only가 `receiveRate=100%`로 통과하면, relay 서버보다는 브라우저/렌더링/Yjs 쪽을 먼저 의심한다.

## 모든 사용자가 `Realtime status is error`로 실패할 때

대부분 브라우저는 앱을 열었지만 Socket.IO 인증 또는 서버 연결에 실패한 경우다.

먼저 확인할 것:

- `--token`이 비어 있지 않은지
- `--token=local-dev`를 쓰고 있는지
- `--server`가 frontend가 아니라 realtime 서버인지
- realtime 서버가 실제로 떠 있는지

기본으로 Socket.IO preflight를 먼저 실행하므로, token/server 문제가 있으면 브라우저 100개를 열기 전에 실패한다.

## 30명 근처부터 실패가 시작될 때

아래 오류는 로컬 load generator 또는 dev server가 startup 중 포화됐을 때 자주 나온다.

- `locator.click: Timeout ... waiting for getByRole('button', { name: '펜' })`
- `locator.waitFor: Timeout ... .stage-canvas-shell`
- `page.waitForFunction: Timeout ...`

이때는 startup ramp와 timeout을 늘린다.

```sh
npm run load:realtime-fleet -- \
  --url=http://127.0.0.1:5178/ \
  --server=http://127.0.0.1:3000 \
  --token=local-dev \
  --room=load-test-100 \
  --users=100 \
  --headed=6 \
  --headless-browsers=4 \
  --ramp=60000 \
  --startup-timeout=90000 \
  --realtime-timeout=90000 \
  --tool-timeout=60000
```

접속만 보는 테스트라면 pen tool 선택도 끈다.

```sh
npm run load:realtime-fleet -- \
  --url=http://127.0.0.1:5178/ \
  --server=http://127.0.0.1:3000 \
  --token=local-dev \
  --users=100 \
  --mode=idle \
  --click-pen=0 \
  --room=load-idle-100
```

---

## 이슈 5: 부하 테스트 인프라 (Artillery + k6 + Playwright Test)

### 도구별 역할

| 도구                  | 역할                                          | 명령                                 |
| --------------------- | --------------------------------------------- | ------------------------------------ |
| Artillery             | Socket.IO 서버 fanout 부하의 기본 도구        | `npm run load:realtime-socket`       |
| k6                    | HTTP API save/load 부하                       | `npm run load:k6`                    |
| Playwright Test       | 실제 브라우저 정합성, 체감 지연, UI 회귀 검증 | `npm run test:e2e`                   |
| realtime-socket debug | 수신 카운트, multi-room, 1:1 socket 구조 진단 | `npm run load:realtime-socket:debug` |
| realtime-fleet        | 눈으로 보는 시각적 확인 (기존 유지)           | `npm run load:realtime-fleet`        |

### 핵심 시나리오: Artillery + Playwright 동시 실행

```
터미널 A (서버 부하):   INK_TOKEN="xxx" npm run load:realtime-socket
터미널 B (클라이언트):  npm run test:e2e
터미널 C (관측):        SigNoz http://localhost:8080
```

Artillery로 서버 fanout 부하를 만들고, 실제 브라우저 5개가 그 상태에서 어떻게 동작하는지 SigNoz에서 동시에 확인한다.

---

### 5-1. Artillery Socket.IO 부하

**파일**: `load-tests/artillery/realtime-socket.yml`

**단계**: warmup(30s) → ramp(60s, 2→5명/s) → peak(120s, 5명/s) → cooldown(30s)

이 테스트는 서버에 많은 Socket.IO client를 붙이고 `join-room` + `server-broadcast` 이벤트를 반복해서 fanout 압박을 만든다. UI 렌더링, canvas 정합성, 이미지/object 동기화는 포함하지 않는다. 그쪽은 Playwright class-session/room-pairs 테스트에서 본다.

**실행**:

```sh
# 기본 실행 (JWT 토큰 필요)
INK_TOKEN="your-jwt-token" npm run load:realtime-socket

# 설정 파일 포맷 확인
npm run load:realtime-socket:check

# 서버/토큰 연결까지 짧은 Artillery 시나리오로 빠르게 확인
INK_TOKEN="your-jwt-token" npm run load:realtime-socket:smoke

# 이전 이름도 alias로 유지
INK_TOKEN="your-jwt-token" npm run load:artillery
```

**SigNoz에서 확인할 것**:

- `server-broadcast.handle` duration p99 추이
- `v8js.memory.heap` 지속 증가 여부 (메모리 누수)
- `v8js.gc.duration` 급증 여부

---

### 5-2. k6 HTTP API 부하

**파일**: `load-tests/k6/handwriting-api.js`

> k6는 별도 설치 필요: https://k6.io/docs/get-started/installation/
> macOS: `brew install k6`

**단계**: 10 → 50 → 100 VU ramping

**실행**:

```sh
# k6 설치 후
npm run load:k6

# 환경변수 지정
BASE_URL=http://localhost:3001 TOKEN=xxx npm run load:k6
```

**임계값** (초과 시 테스트 fail):

- `handwriting_save_duration p(95) < 2000ms`
- `handwriting_load_duration p(95) < 1500ms`
- 에러율 < 1%

---

### 5-3. Playwright Test E2E

**파일**: `load-tests/playwright-tests/realtime-e2e.spec.ts`

앱 자체 OTel을 활용한다. 브라우저가 앱을 열면 `useRealtimeInk`가 자동으로 span을 SigNoz에 전송한다. 테스트 코드는 UI assertion만 담당한다.

**테스트 케이스**:

| TC   | 내용                                 | SigNoz에서 확인                                            |
| ---- | ------------------------------------ | ---------------------------------------------------------- |
| TC-1 | cold start: 방 입장 후 5초 안에 연결 | `client.realtime.cold-start`                               |
| TC-2 | stroke 전송: 선생님 → 학생 수신      | `client.realtime.stroke`, `client.socket.client-broadcast` |
| TC-3 | 5명 동시 접속 + 동시 필기            | span 5개씩 수집 확인                                       |

**실행**:

```sh
# headless (CI/자동)
npm run test:e2e

# headed (눈으로 보면서)
npm run test:e2e:headed

# 리포트 열기
npm run test:e2e:report
```

**Artillery와 동시 실행** (권장):

```sh
# 터미널 A
INK_TOKEN="xxx" npm run load:realtime-socket

# 터미널 B (Artillery 시작 30초 후)
npm run test:e2e
```

---

### 이슈 4 지표와 연결

Playwright Test 실행 중 SigNoz Traces에서 아래를 모니터링한다.

| 상황           | 확인할 span                        | 위험 신호                         |
| -------------- | ---------------------------------- | --------------------------------- |
| 필기 끊김      | `client.realtime.stroke`           | `stroke.completed = false` 증가   |
| 방 입장 지연   | `client.realtime.cold-start`       | `cold_start.duration_ms` > 2000ms |
| 수신 처리 지연 | `client.socket.client-broadcast`   | duration > 100ms 증가             |
| 서버 처리 지연 | `server-broadcast.handle`          | duration p99 > 500ms              |
| 렌더링 저하    | Metrics `client.render.frame_time` | > 33ms 지속                       |
