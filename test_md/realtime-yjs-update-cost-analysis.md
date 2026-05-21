# Yjs 업데이트 비용 관측 메모

작성일: 2026-05-15

## 목적

SigNoz에서 `client.yjs.update` 또는 Yjs 관련 span 시간이 생각보다 크게 보이는 이유를 정리한다.

이 문서는 특정 테스트의 pass/fail 결과가 아니라, 현재 realtime ink 구조에서 Yjs 업데이트 비용을 어떻게 해석해야 하는지와 이후 개선 방향을 남기기 위한 메모다.

## 현재 판단

현재 관측되는 `client.yjs.update` 시간은 **순수한 Yjs apply 비용만 의미하지 않는다**.

실제로는 아래 작업들이 한 span 안에 같이 포함되어 있다.

| 단계 | 내용 |
| --- | --- |
| 1 | socket `client-broadcast` 수신 |
| 2 | `yjs:update` 메시지 판별 |
| 3 | `Y.applyUpdate()` 실행 |
| 4 | stroke/object 전체 목록 refresh |
| 5 | React state 업데이트 준비 |
| 6 | 이후 렌더링 영향 발생 가능 |

따라서 SigNoz에서 `client.yjs.update`가 길게 보일 때, 그것을 바로 “Yjs 라이브러리가 느리다”로 해석하면 안 된다.

더 정확한 해석은 다음에 가깝다.

```txt
Yjs apply 비용
+ 현재 프론트의 전체 stroke/object 상태 재계산 비용
+ React state 반영 비용
+ 로컬 브라우저 부하와 trace export 비용
```

## 왜 시간이 커질 수 있나

### 1. `client.yjs.update` span이 너무 넓다

현재 `client.yjs.update` span은 remote update를 적용하는 전체 흐름을 감싼다.

즉, span 안에는 `Y.applyUpdate()`뿐 아니라 `applyRemoteUpdate()` 안의 후처리까지 들어간다.

결과적으로 SigNoz에서 보이는 값은 “Yjs 내부 처리 시간”이 아니라 “Yjs update 수신 후 프론트 상태 반영 전체 시간”이다.

### 2. remote update마다 전체 stroke/object를 다시 훑는다

현재 구조에서는 remote update가 들어오면 stroke와 object 목록을 다시 만든다.

개념적으로는 아래와 같다.

```txt
Array.from(yStrokes.values()).filter(...)
Array.from(yObjects.values()).filter(...)
```

stroke/object가 누적될수록 이 비용은 커질 수 있다.

1시간 수업처럼 방이 오래 살아 있고 heartbeat stroke가 계속 쌓이는 테스트에서는 이 비용이 tail latency로 나타날 가능성이 있다.

### 3. observe 기반 refresh와 수동 refresh가 중복될 수 있다

Y.Map에는 observe가 걸려 있고, remote update 적용 후에도 수동으로 refresh를 호출한다.

따라서 update 1개에 대해 아래 일이 겹칠 수 있다.

```txt
Y.applyUpdate()
→ Y.Map observe로 refresh
→ applyRemoteUpdate 끝에서 다시 refresh
```

이 경우 실제 Yjs apply보다 refresh 중복 비용이 더 크게 보일 수 있다.

### 4. stroke 하나가 여러 메시지로 표현된다

현재 필기 하나는 대략 아래 흐름으로 전달된다.

```txt
ink:stroke:start
ink:stroke:append
ink:stroke:end
yjs:update
```

실시간 드래프트는 socket 메시지로 보여주고, 최종 확정본은 Yjs에 저장하는 구조다.

이 구조 자체는 자연스럽다. 다만 관측상으로는 stroke 1개가 단일 업데이트가 아니라 여러 이벤트와 span으로 보인다.

### 5. 1시간 수업 테스트에서는 누적 효과가 커진다

예를 들어 100개 방, 방당 teacher/student 1명, 5분마다 heartbeat stroke를 보내면 대략 이런 규모가 된다.

```txt
100 rooms
x 약 13 heartbeat rounds
= 최소 1300개 이상의 확정 stroke/Yjs update 관측 가능
```

로컬 머신에서 브라우저 200개를 동시에 띄우고, SigNoz trace까지 함께 export하면 span duration이 더 크게 보일 수 있다.

## 단위 주의

SigNoz의 `duration_nano`는 nanosecond 단위다.

예를 들어:

```txt
29,400,000 duration_nano = 29.4ms
5,800,000 duration_nano = 5.8ms
```

숫자가 커 보여도 초 단위가 아닐 수 있으므로, ms로 변환해서 봐야 한다.

## 지금 봐야 할 결론

현재 관측값은 다음 의미로 보는 것이 안전하다.

```txt
Yjs 업데이트 수신 후 프론트 상태 반영 비용이 보이고 있다.
```

아직 아래 결론을 내리기는 이르다.

```txt
Yjs 자체가 병목이다.
```

현재 병목 후보는 더 넓다.

| 후보 | 설명 |
| --- | --- |
| Yjs apply | `Y.applyUpdate()` 자체 비용 |
| 전체 refresh | 모든 stroke/object를 배열로 다시 만드는 비용 |
| React state | `setYjsStrokes`, `setYjsObjects`, debug state 업데이트 비용 |
| 렌더링 | state 변경 후 canvas/WebGL/React 렌더링 비용 |
| 관측 오버헤드 | OpenTelemetry span 생성/export 비용 |
| 로컬 브라우저 부하 | Playwright/Chromium 100~200개 실행 비용 |

## 개선 방향

### 1. 계측을 더 잘게 쪼갠다

우선 `client.yjs.update`를 아래처럼 나눠서 봐야 한다.

```txt
client.yjs.apply_update
client.yjs.refresh_strokes
client.yjs.refresh_objects
client.react.state_commit
```

이렇게 해야 진짜 느린 부분이 어디인지 분리된다.

예상은 다음과 같다.

```txt
Y.applyUpdate 자체 < 전체 refresh < React/render 영향
```

### 2. refresh 중복을 제거한다

현재는 observe와 수동 refresh가 같이 존재한다.

개선 방향은 둘 중 하나다.

```txt
observe를 믿고 applyRemoteUpdate 안의 수동 refresh 제거
```

또는:

```txt
observe를 제거하고 applyRemoteUpdate/commit 경로에서만 명시적으로 refresh
```

지금 구조에서는 observe를 이미 사용하고 있으므로, 우선은 수동 refresh를 줄이는 쪽이 자연스럽다.

### 3. 전체 map 재스캔을 줄인다

현재는 업데이트 하나가 와도 전체 stroke/object 목록을 다시 계산한다.

장기적으로는 Y.Map observe 이벤트의 변경 key를 이용해 변경분만 반영하는 방식이 좋다.

목표 구조:

```txt
전체 목록 재계산
→ 변경된 key만 React state에 patch
```

이렇게 하면 수업 시간이 길어져 stroke/object가 누적되어도 비용 증가가 완만해진다.

### 4. live stroke와 확정 Yjs 상태의 역할을 분리해서 본다

현재 구조는 다음 역할 분리가 있다.

| 경로 | 역할 |
| --- | --- |
| `ink:stroke:start/append/end` | 실시간 드래프트 표시 |
| `yjs:update` | 최종 stroke/object 상태 확정 및 늦은 join/sync 복구 |

이 방향 자체는 괜찮다.

다만 student가 이미 `ink:stroke:end`로 최종 stroke를 화면에 반영했다면, 이후 같은 stroke의 `yjs:update`에서는 화면 전체 refresh 비용을 최소화하는 것이 좋다.

## 추천 우선순위

| 우선순위 | 작업 | 기대 효과 |
| ---: | --- | --- |
| 1 | `client.yjs.update` 내부 계측 분리 | 실제 병목 위치 확인 |
| 2 | observe/수동 refresh 중복 제거 | 즉시 비용 감소 가능 |
| 3 | 전체 stroke/object refresh를 key 기반 patch로 변경 | 장기 수업 세션 안정성 개선 |
| 4 | sync-response 전체 state 적용과 일반 yjs:update 적용 경로 분리 | 늦은 join 복구와 일반 업데이트 비용 분리 |
| 5 | trace sample rate 조정 | 부하 테스트 중 관측 오버헤드 감소 |

## 테스트 해석에 반영할 점

앞으로 `class-session-1h-1to1` 결과를 볼 때는 아래를 분리해서 봐야 한다.

```txt
heartbeat sync timeout
client.yjs.update duration
client.socket.client-broadcast duration
room.heartbeat_max_sync_ms
student.realtime.remote_stroke_count
student.receive.handler_max_ms
```

특히 `client.yjs.update`가 길게 나와도, 그것만으로 기술스택 탈락 판단을 하면 안 된다.

먼저 refresh/React 비용을 분리한 뒤에 판단해야 한다.
