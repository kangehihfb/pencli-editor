# 실시간 필기 동기화 부하 테스트 결과

## 한 줄 요약

`socketio-yjs`로 100개 방, 방당 2명, 총 200명 조건에서 테스트했고, **99개 방은 성공**, **1개 방은 stroke 동기화 확인 실패**가 발생했다.

실패 원인은 전체 실행 시간 초과가 아니라, `051번 방`에서 학생 화면이 상대 stroke를 제한 시간 안에 확인하지 못한 `sync_timeout`이다.

## 테스트 조건

| 항목 | 값 |
| --- | --- |
| Run ID | `2026-05-15T07-37-03-863Z` |
| 기술 스택 | `socketio-yjs` |
| 시나리오 | `room-pairs-100` |
| 방 개수 | 100개 |
| 방당 사용자 | 2명 |
| 총 사용자 | 200명 |
| 전체 실행 시간 | 150,926ms, 약 150.9초 |
| 최종 결과 | `fail` |

원본 CSV:

- `/Users/mildang/Downloads/table-panel.csv`
- `/Users/mildang/Downloads/table-panel (1).csv`

## 전체 결과

| 구분 | 개수 |
| --- | ---: |
| 전체 방 | 100 |
| 성공 방 | 99 |
| 실패 방 | 1 |
| 실패율 | 1% |

이번 테스트는 완전 성공은 아니지만, **대부분의 방에서는 stroke 동기화가 성공**했다.

다만 1개 방이라도 실패했기 때문에 테스트 결과는 `fail`로 기록되었다.

## 실패한 방

| 항목 | 값 |
| --- | --- |
| 방 ID | `room-pair-2026-05-15T07-37-03-863Z-051` |
| 실패 타입 | `sync_timeout` |
| 방 처리 시간 | 22,846ms |
| stroke 동기화 시간 | `n/a` |

### 이 실패가 의미하는 것

`sync_timeout`은 다음 의미다.

- 선생님 페이지와 학생 페이지는 둘 다 연결됨
- 선생님이 stroke를 그림
- 하지만 학생 페이지에서 remote stroke가 들어온 것을 제한 시간 안에 확인하지 못함

즉, 이건 단순한 서버 접속 실패나 프론트 로딩 실패가 아니다.
**특정 방에서 stroke broadcast 또는 student-side 적용 흐름이 빠졌거나 늦어진 케이스**로 봐야 한다.

SigNoz에서 이 방을 더 볼 때는 다음 쿼리를 쓰면 된다.

```txt
service.name = 'pentest-frontend' AND room.id = 'room-pair-2026-05-15T07-37-03-863Z-051'
```

확인할 것:

| 확인 항목 | 의미 |
| --- | --- |
| `client.socket.client-broadcast`가 학생 쪽에 있었는지 | 서버에서 학생에게 메시지가 왔는지 |
| `viewer.realtime.remote_stroke_count`가 0인지 | 학생 화면이 실제 stroke를 적용했는지 |
| `realtime.message.type` | 어떤 메시지 타입에서 끊겼는지 |
| backend span | 서버가 room broadcast를 했는지 |

## 방 전체 처리 시간

`room.elapsed_ms`는 순수한 stroke 지연 시간이 아니다.

여기에는 다음 시간이 모두 포함된다.

- Playwright page 생성
- 브라우저 context 생성
- 앱 로딩
- 캔버스 준비
- realtime 연결
- Yjs 초기 sync
- stroke 그리기
- 학생 화면 동기화 확인

그래서 `room.elapsed_ms`만 보고 “stroke가 100초 걸렸다”고 해석하면 안 된다.

| 지표 | 값 |
| --- | ---: |
| 최소 | 22,846ms |
| 평균 | 73,100ms |
| P50 | 68,366ms |
| P90 | 96,604ms |
| P95 | 98,908ms |
| P99 | 99,215ms |
| 최대 | 101,398ms |

### 방 처리 시간 구간

| 구간 | 방 개수 |
| --- | ---: |
| 90초 이상 | 26 |
| 60초 이상 90초 미만 | 39 |
| 30초 이상 60초 미만 | 34 |
| 30초 미만 | 1 |

해석:

- 전체 방 처리 시간은 꽤 길다.
- 하지만 이 값은 Playwright 200페이지를 동시에 다루는 비용이 크게 섞여 있다.
- 기술 스택의 실시간 동기화 성능을 판단할 때는 `room.sync_ms`를 더 중요하게 봐야 한다.

## stroke 동기화 시간

`room.sync_ms`는 선생님이 stroke를 그린 뒤, 학생 화면에서 remote stroke가 확인되기까지 걸린 시간이다.

실시간 필기 품질을 볼 때는 이 값이 핵심이다.

실패한 1개 방은 `sync_ms = n/a`이므로, 아래 통계는 성공한 99개 방 기준이다.

| 지표 | 값 |
| --- | ---: |
| 측정 방 개수 | 99 |
| 최소 | 3ms |
| 평균 | 896ms |
| P50 | 211ms |
| P90 | 2,669ms |
| P95 | 4,351ms |
| P99 | 5,583ms |
| 최대 | 5,583ms |

### stroke 동기화 시간 구간

| 구간 | 방 개수 |
| --- | ---: |
| 2초 이상 | 16 |
| 1초 이상 2초 미만 | 14 |
| 100ms 이상 1초 미만 | 31 |
| 100ms 미만 | 38 |
| 실패 또는 미측정 | 1 |

해석:

- 절반 이상의 성공 방은 211ms 이하로 stroke가 확인됐다.
- 38개 방은 100ms 미만으로 매우 빠르게 동기화됐다.
- 하지만 16개 방은 2초 이상 걸렸다.
- P95가 4.351초라서, 사용자 체감 품질 기준으로는 아직 튐 현상이 있다.

## 전체 처리 시간이 가장 길었던 방 Top 10

이 표는 `room.elapsed_ms` 기준이다.
즉, stroke sync만 느린 방이 아니라 **방 전체 준비와 실행이 오래 걸린 방**이다.

| 순위 | 방 번호 | 성공 여부 | 실패 타입 | 방 처리 시간 | stroke 동기화 |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `031` | 성공 | `none` | 101,398ms | 836ms |
| 2 | `040` | 성공 | `none` | 99,215ms | 987ms |
| 3 | `011` | 성공 | `none` | 99,174ms | 598ms |
| 4 | `048` | 성공 | `none` | 99,159ms | 796ms |
| 5 | `016` | 성공 | `none` | 99,081ms | 933ms |
| 6 | `043` | 성공 | `none` | 98,908ms | 1,332ms |
| 7 | `045` | 성공 | `none` | 97,227ms | 599ms |
| 8 | `025` | 성공 | `none` | 97,002ms | 13ms |
| 9 | `024` | 성공 | `none` | 96,856ms | 2,378ms |
| 10 | `037` | 성공 | `none` | 96,787ms | 1,216ms |

중요한 점:

- 처리 시간이 100초에 가까운 방들도 stroke sync 자체는 대부분 1초 안팎이다.
- 따라서 이 표는 “브라우저/페이지 준비 병목”을 보는 용도에 가깝다.

## stroke 동기화가 가장 느렸던 방 Top 10

이 표가 실시간 필기 체감 성능에 더 중요하다.

| 순위 | 방 번호 | 성공 여부 | 실패 타입 | 방 처리 시간 | stroke 동기화 |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `050` | 성공 | `none` | 93,530ms | 5,583ms |
| 2 | `008` | 성공 | `none` | 79,632ms | 5,478ms |
| 3 | `041` | 성공 | `none` | 79,403ms | 4,748ms |
| 4 | `001` | 성공 | `none` | 81,034ms | 4,430ms |
| 5 | `005` | 성공 | `none` | 80,731ms | 4,351ms |
| 6 | `006` | 성공 | `none` | 79,279ms | 4,257ms |
| 7 | `039` | 성공 | `none` | 76,925ms | 3,522ms |
| 8 | `049` | 성공 | `none` | 79,629ms | 2,714ms |
| 9 | `002` | 성공 | `none` | 78,577ms | 2,691ms |
| 10 | `071` | 성공 | `none` | 54,514ms | 2,669ms |

해석:

- 가장 느린 성공 케이스는 5.583초였다.
- 상위 느린 sync 방들이 초반 방 번호에 몰린 경향이 조금 있다.
- 동시성 50 조건에서 초반 batch가 더 무거웠을 가능성이 있다.

## 이번 테스트에서 얻은 결론

### 좋았던 점

- 100개 방 중 99개 방에서 stroke 동기화 성공
- 성공 방 기준 median sync가 211ms
- 38개 방은 100ms 미만으로 동기화
- 연결 실패나 대규모 프론트 로딩 실패는 아니었음

### 아쉬운 점

- 1개 방에서 `sync_timeout` 발생
- 성공 방 중에서도 P95 sync가 4.351초로 높음
- 전체 실행 시간이 150.9초로 길다
- `room.elapsed_ms`와 `room.sync_ms`를 구분하지 않으면 해석이 헷갈림

## 다음에 봐야 할 SigNoz 패널

앞으로 대시보드는 최소한 아래처럼 나눠야 한다.

| 패널 | 목적 |
| --- | --- |
| Run Summary | 테스트 실행 단위 요약 |
| Failed Rooms | 실패한 방만 보기 |
| Slow Rooms By Total Elapsed | 방 전체 처리 시간이 긴 케이스 보기 |
| Slow Sync Rooms | 실제 stroke 동기화가 느린 케이스 보기 |
| Slow Students / Receivers | 특정 학생 또는 receiver가 느린지 보기 |

### Failed Rooms 쿼리

```txt
service.name = 'playwright-loadtest' AND name = 'loadtest.room' AND room.ok = false
```

Group by:

```txt
test.run_id
room.id
room.failure_type
room.error
```

### Slow Sync Rooms 쿼리

```txt
service.name = 'playwright-loadtest' AND name = 'loadtest.room'
```

Group by:

```txt
test.run_id
room.id
room.ok
room.failure_type
```

Order by:

```txt
max(room.sync_ms) desc
```

### Slow Students / Receivers 쿼리

```txt
service.name = 'pentest-frontend' AND name = 'client.socket.client-broadcast' AND realtime.actor.role = 'student'
```

Group by:

```txt
test.run_id
realtime.actor.id
realtime.message.type
```

## 최종 판단

이번 `socketio-yjs` 결과는 “완전 안정적”이라고 보기에는 이르다.
하지만 100개 방, 200명 조건에서 99개 방이 성공했고, 성공 방 기준 stroke sync median이 211ms라는 점은 긍정적이다.

우선순위는 다음과 같다.

1. `051번 방 sync_timeout`의 실제 원인을 SigNoz trace에서 확인한다.
2. `room.elapsed_ms`와 `room.sync_ms`를 분리해서 대시보드를 정리한다.
3. 같은 조건으로 3회 이상 반복 실행해서 실패율과 P95 sync가 재현되는지 확인한다.
4. 다른 기술 스택과 비교할 때는 전체 실행 시간보다 `failed_rooms`, `sync p95`, `sync max`, `student receiver latency`를 우선 본다.
