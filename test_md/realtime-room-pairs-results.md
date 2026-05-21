# 실시간 필기 동기화 부하 테스트 누적 결과

이 문서는 SigNoz 대시보드에서 export한 CSV를 기준으로 테스트 결과를 누적 정리한다.

## 누적 요약

| 회차 | Run ID | Stack | Scenario | 방 | 총 사용자 | 결과 | 성공 방 | 실패 방 | 전체 시간 | Sync P50 | Sync P95 | Sync Max |
| ---: | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | `2026-05-15T08-21-17-603Z` | `socketio-yjs` | `room-pairs-100` | 100 | 200 | `fail` | 97 | 3 | 128,658ms | 186ms | 2,862ms | 4,684ms |
| 2 | `2026-05-15T08-27-04-722Z` | `socketio-yjs` | `room-pairs-100` | 100 | 200 | `fail` | 98 | 2 | 132,412ms | 111ms | 2,054ms | 4,726ms |

## 반복 테스트 요약

같은 조건의 100방 테스트를 2회 실행했다.

| 항목 | 1차 | 2차 | 해석 |
| --- | ---: | ---: | --- |
| 실패 방 | 3개 | 2개 | 반복해서 `sync_timeout`이 발생함 |
| 성공률 | 97% | 98% | 대부분 성공하지만 100%는 아님 |
| Sync P50 | 186ms | 111ms | 중앙값은 양호 |
| Sync P95 | 2,862ms | 2,054ms | tail latency는 남아 있음 |
| Sync Max | 4,684ms | 4,726ms | 최악 케이스는 4초대 반복 |
| 전체 실행 시간 | 128.7초 | 132.4초 | 비슷한 수준 |

현재 결론:

- 100방 1:1 기본 동기화는 대체로 동작한다.
- 하지만 `sync_timeout`이 반복 발생하므로, 이 조건을 완전히 통과했다고 보긴 어렵다.
- 이 테스트만 계속 반복하기보다는, 이제 다른 축의 테스트로 넘어가는 게 맞다.

## 1차 테스트

### 한 줄 요약

100개 방, 방당 2명, 총 200명 조건에서 `socketio-yjs`를 테스트했다.
결과는 **97개 방 성공, 3개 방 실패**였고, 실패한 방은 모두 `sync_timeout`이었다.

### 원본 CSV

| 파일 | 용도 |
| --- | --- |
| `/Users/mildang/Downloads/all.csv` | 전체 run 요약 |
| `/Users/mildang/Downloads/slow-room.csv` | 방별 처리 시간 및 sync 시간 |
| `/Users/mildang/Downloads/stroke_slow.csv` | 학생 receiver 쪽 span 처리 시간 |
| `/Users/mildang/Downloads/fail.csv` | 실패한 방 상세 |

### 테스트 조건

| 항목 | 값 |
| --- | --- |
| Run ID | `2026-05-15T08-21-17-603Z` |
| 기술 스택 | `socketio-yjs` |
| 시나리오 | `room-pairs-100` |
| 방 개수 | 100개 |
| 방당 사용자 | 2명 |
| 총 사용자 | 200명 |
| 최종 결과 | `fail` |
| 전체 실행 시간 | 128,658ms, 약 128.7초 |

### 전체 결과

| 구분 | 값 |
| --- | ---: |
| 전체 방 | 100 |
| 성공 방 | 97 |
| 실패 방 | 3 |
| 실패율 | 3% |

이번 테스트는 전체 timeout 때문에 실패한 것이 아니다.
실패 방 3개에서 학생 화면이 remote stroke를 제한 시간 안에 확인하지 못해서 `fail`로 기록되었다.

## 실패한 방

| 방 번호 | 실패 타입 | Drawer | Viewer | Viewer Remote Stroke | 방 처리 시간 | Sync 시간 |
| --- | --- | --- | --- | ---: | ---: | ---: |
| `100` | `sync_timeout` | connected | connected | 0 | 34,902ms | n/a |
| `085` | `sync_timeout` | connected | connected | 0 | 17,642ms | n/a |
| `084` | `sync_timeout` | connected | connected | 0 | 17,217ms | n/a |

### 실패 해석

3개 실패 모두 같은 패턴이다.

- teacher/drawer 상태: `connected`
- student/viewer 상태: `connected`
- `viewer.realtime.remote_stroke_count`: 0
- 에러: `page.waitForFunction: Timeout 10000ms exceeded.`

즉, 프론트 페이지가 아예 안 뜬 문제나 socket 연결 실패가 아니다.
**student 쪽에서 remote stroke가 들어오거나 적용된 것을 확인하지 못한 문제**다.

SigNoz에서 실패 방을 볼 때는 아래처럼 방 ID를 바꿔가며 확인하면 된다.

```txt
service.name = 'pentest-frontend' AND room.id = 'room-pair-2026-05-15T08-21-17-603Z-100'
```

확인할 포인트:

| 확인 항목 | 의미 |
| --- | --- |
| `client.socket.client-broadcast`가 학생 쪽에 있었는지 | 서버가 student에게 메시지를 보냈는지 |
| `realtime.message.type` | 어떤 메시지 타입까지 들어왔는지 |
| `viewer.realtime.remote_stroke_count` | 학생 화면에 remote stroke가 실제 반영됐는지 |
| backend room broadcast span | 서버 broadcast가 해당 room에 대해 발생했는지 |

## 방 전체 처리 시간

`room.elapsed_ms`는 stroke latency가 아니다.
Playwright page 생성, 앱 로딩, 캔버스 준비, realtime 연결, Yjs 초기 sync, stroke 입력, student 확인 시간이 모두 섞인 값이다.

| 지표 | 값 |
| --- | ---: |
| 최소 | 17,217ms |
| 평균 | 60,649ms |
| P50 | 56,329ms |
| P90 | 78,333ms |
| P95 | 80,289ms |
| P99 | 81,390ms |
| 최대 | 83,287ms |

### 방 처리 시간 구간

| 구간 | 방 개수 |
| --- | ---: |
| 90초 이상 | 0 |
| 60초 이상 90초 미만 | 46 |
| 30초 이상 60초 미만 | 52 |
| 30초 미만 | 2 |

해석:

- 전체 방 처리 시간은 평균 약 60.6초다.
- 90초 이상 걸린 방은 없다.
- 전체 처리 시간은 여전히 긴 편이지만, 실시간 stroke 자체의 지연 시간과는 분리해서 봐야 한다.

## stroke 동기화 시간

`room.sync_ms`는 teacher가 stroke를 그린 뒤 student 화면에서 remote stroke 확인이 완료되기까지 걸린 시간이다.
실시간 필기 품질을 판단할 때는 이 값이 더 중요하다.

실패한 3개 방은 `sync_ms = n/a`라서, 아래 통계는 성공한 97개 방 기준이다.

| 지표 | 값 |
| --- | ---: |
| 측정 방 | 97 |
| 최소 | 7ms |
| 평균 | 562ms |
| P50 | 186ms |
| P90 | 1,479ms |
| P95 | 2,862ms |
| P99 | 4,684ms |
| 최대 | 4,684ms |

### stroke 동기화 시간 구간

| 구간 | 방 개수 |
| --- | ---: |
| 2초 이상 | 7 |
| 1초 이상 2초 미만 | 9 |
| 100ms 이상 1초 미만 | 40 |
| 100ms 미만 | 41 |
| 실패 또는 미측정 | 3 |

해석:

- 성공한 방의 절반은 186ms 이하로 동기화됐다.
- 41개 방은 100ms 미만으로 동기화됐다.
- 7개 방은 2초 이상 걸렸다.
- P95가 2.862초라서, 대부분은 괜찮지만 tail latency가 아직 있다.

## 전체 처리 시간이 길었던 방 Top 10

이 표는 `room.elapsed_ms` 기준이다.
방 전체 준비와 실행이 오래 걸린 케이스를 보는 용도다.

| 순위 | 방 번호 | 성공 여부 | 실패 타입 | 방 처리 시간 | Sync 시간 |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `043` | 성공 | `none` | 83,287ms | 1,475ms |
| 2 | `042` | 성공 | `none` | 81,390ms | 1,479ms |
| 3 | `012` | 성공 | `none` | 81,306ms | 344ms |
| 4 | `041` | 성공 | `none` | 81,165ms | 2,862ms |
| 5 | `036` | 성공 | `none` | 80,307ms | 186ms |
| 6 | `016` | 성공 | `none` | 80,289ms | 375ms |
| 7 | `029` | 성공 | `none` | 79,081ms | 423ms |
| 8 | `046` | 성공 | `none` | 79,070ms | 82ms |
| 9 | `028` | 성공 | `none` | 79,056ms | 12ms |
| 10 | `033` | 성공 | `none` | 78,678ms | 11ms |

중요한 점:

- 전체 처리 시간이 긴 방이라고 해서 sync가 반드시 느린 것은 아니다.
- 예를 들어 `028`, `033`은 방 처리 시간은 길지만 sync는 12ms, 11ms로 매우 빠르다.

## stroke 동기화가 느렸던 방 Top 10

이 표가 사용자 체감에 더 가깝다.

| 순위 | 방 번호 | 성공 여부 | 실패 타입 | 방 처리 시간 | Sync 시간 |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `010` | 성공 | `none` | 69,435ms | 4,684ms |
| 2 | `009` | 성공 | `none` | 68,308ms | 4,541ms |
| 3 | `020` | 성공 | `none` | 68,619ms | 4,415ms |
| 4 | `002` | 성공 | `none` | 51,752ms | 3,020ms |
| 5 | `041` | 성공 | `none` | 81,165ms | 2,862ms |
| 6 | `023` | 성공 | `none` | 68,939ms | 2,524ms |
| 7 | `027` | 성공 | `none` | 67,024ms | 2,453ms |
| 8 | `054` | 성공 | `none` | 62,056ms | 1,973ms |
| 9 | `052` | 성공 | `none` | 70,922ms | 1,722ms |
| 10 | `042` | 성공 | `none` | 81,390ms | 1,479ms |

해석:

- 가장 느린 성공 케이스는 4.684초다.
- `009`, `010`, `020`처럼 초반 방 번호 일부에서 sync tail이 길게 튄다.
- 실패 방 `084`, `085`, `100`은 sync 자체가 확인되지 않아 이 Top 10에는 포함되지 않는다.

## 학생 receiver span 분석

`stroke_slow.csv`는 student 쪽 `client.socket.client-broadcast` span의 처리 시간을 본 것이다.
단위는 `duration_nano`라서, 아래 표에서는 ms로 변환했다.

주의: 이 값은 end-to-end stroke sync 시간이 아니라 **학생 브라우저에서 특정 메시지를 처리한 span 시간**이다.

| 항목 | 값 |
| --- | ---: |
| 전체 row | 550 |
| 측정 가능 row | 484 |
| P50 | 0.500ms |
| P90 | 2.115ms |
| P95 | 2.780ms |
| 최대 | 5.920ms |

### 메시지 타입별 row 수

| 메시지 타입 | Row 수 |
| --- | ---: |
| `ink:stroke:append` | 97 |
| `ink:stroke:start` | 97 |
| `yjs:update` | 92 |
| `ink:stroke:end` | 92 |
| `yjs:sync-request` | 87 |
| `yjs:sync-response` | 85 |

### 학생 receiver 처리 시간이 길었던 케이스 Top 10

| 순위 | 학생 방 번호 | 메시지 타입 | P95 처리 시간 |
| ---: | --- | --- | ---: |
| 1 | `050` | `yjs:update` | 5.920ms |
| 2 | `051` | `yjs:update` | 5.450ms |
| 3 | `002` | `yjs:sync-request` | 4.900ms |
| 4 | `052` | `yjs:update` | 4.785ms |
| 5 | `045` | `ink:stroke:append` | 4.550ms |
| 6 | `014` | `yjs:update` | 4.395ms |
| 7 | `007` | `yjs:update` | 4.205ms |
| 8 | `024` | `ink:stroke:append` | 4.180ms |
| 9 | `007` | `yjs:sync-request` | 3.700ms |
| 10 | `033` | `yjs:update` | 3.630ms |

해석:

- 학생 receiver span 자체는 대부분 ms 단위로 짧다.
- 가장 긴 처리 시간도 5.92ms 수준이다.
- 따라서 10초짜리 `sync_timeout`은 단순히 student handler 하나가 오래 걸려서 발생한 문제로 보기는 어렵다.
- 더 가능성 있는 원인은 메시지가 특정 student에게 도달하지 않았거나, 도달했지만 stroke 적용/관측 조건으로 이어지지 않은 경우다.

## 대시보드 개선 메모

`stroke_slow.csv`에서 `test.run_id`가 `n/a`로 내려왔다.
`realtime.actor.id` 안에는 run id가 들어있어서 이번 분석은 가능했지만, 대시보드 필터링에는 좋지 않다.

개선 필요:

- `Slow Students / Receivers` 패널에서 `test.run_id` group by가 올바른 attribute 타입으로 잡혔는지 확인
- 안 되면 임시로 `realtime.actor.id contains '2026-05-15T08-21-17-603Z'` 조건 사용
- 장기적으로는 frontend span에 `test.run_id`가 tag/resource 중 어디에 들어가는지 SigNoz에서 확정하고 패널을 고정

## 1차 테스트 결론

### 긍정적인 신호

- 100개 방 중 97개 방에서 stroke 동기화 성공
- 성공 방 기준 sync P50은 186ms
- 41개 방은 100ms 미만으로 동기화
- 학생 receiver span 처리 시간은 대부분 매우 짧음

### 문제 신호

- 실패 방 3개 모두 `sync_timeout`
- 실패 방 모두 viewer remote stroke count가 0
- sync tail latency가 일부 방에서 4초 이상 발생
- 성공률이 97%라서, 실서비스 안정성 기준으로는 아직 부족함

### 현재 판단

`socketio-yjs`는 100개 1:1 방 조건에서 대체로 동작하지만, 아직 안정성 검증을 통과했다고 보기는 어렵다.
특히 `sync_timeout`이 3% 발생했고, 실패 방이 모두 `connected` 상태였다는 점이 중요하다.

다음 테스트에서는 같은 조건을 반복해서 실패율이 재현되는지 봐야 한다.

## 2차 테스트

### 한 줄 요약

1차와 같은 조건으로 다시 실행했다.
결과는 **98개 방 성공, 2개 방 실패**였고, 실패한 방은 모두 `sync_timeout`이었다.

### 원본 CSV

| 파일 | 용도 |
| --- | --- |
| `/Users/mildang/Downloads/all (1).csv` | 전체 run 요약 |
| `/Users/mildang/Downloads/slow-room (1).csv` | 방별 처리 시간 및 sync 시간 |
| `/Users/mildang/Downloads/stroke_slow (1).csv` | 학생 receiver 쪽 span 처리 시간 |
| `/Users/mildang/Downloads/fail (1).csv` | 실패한 방 상세 |

### 테스트 조건

| 항목 | 값 |
| --- | --- |
| Run ID | `2026-05-15T08-27-04-722Z` |
| 기술 스택 | `socketio-yjs` |
| 시나리오 | `room-pairs-100` |
| 방 개수 | 100개 |
| 방당 사용자 | 2명 |
| 총 사용자 | 200명 |
| 최종 결과 | `fail` |
| 전체 실행 시간 | 132,412ms, 약 132.4초 |

### 전체 결과

| 구분 | 값 |
| --- | ---: |
| 전체 방 | 100 |
| 성공 방 | 98 |
| 실패 방 | 2 |
| 실패율 | 2% |

1차와 마찬가지로 전체 timeout 문제가 아니라, 일부 방에서 student가 remote stroke를 확인하지 못한 문제다.

## 2차 실패한 방

| 방 번호 | 실패 타입 | Drawer | Viewer | Viewer Remote Stroke | 방 처리 시간 | Sync 시간 |
| --- | --- | --- | --- | ---: | ---: | ---: |
| `099` | `sync_timeout` | connected | connected | 0 | 29,127ms | n/a |
| `100` | `sync_timeout` | connected | connected | 0 | 28,353ms | n/a |

### 2차 실패 해석

2차 실패도 1차와 같은 패턴이다.

- teacher/drawer 상태: `connected`
- student/viewer 상태: `connected`
- `viewer.realtime.remote_stroke_count`: 0
- 에러: `page.waitForFunction: Timeout 10000ms exceeded.`

특히 2차는 `099`, `100`처럼 후반 방 번호에서 실패가 발생했다.
1차도 `084`, `085`, `100`에서 실패했으므로, 후반 batch에서 sync timeout이 반복되는지 추가 확인 가치가 있다.

## 2차 방 전체 처리 시간

| 지표 | 값 |
| --- | ---: |
| 최소 | 28,353ms |
| 평균 | 62,503ms |
| P50 | 57,860ms |
| P90 | 86,644ms |
| P95 | 89,005ms |
| P99 | 89,649ms |
| 최대 | 90,148ms |

### 2차 방 처리 시간 구간

| 구간 | 방 개수 |
| --- | ---: |
| 90초 이상 | 1 |
| 60초 이상 90초 미만 | 40 |
| 30초 이상 60초 미만 | 57 |
| 30초 미만 | 2 |

## 2차 stroke 동기화 시간

실패한 2개 방은 `sync_ms = n/a`라서, 아래 통계는 성공한 98개 방 기준이다.

| 지표 | 값 |
| --- | ---: |
| 측정 방 | 98 |
| 최소 | 6ms |
| 평균 | 355ms |
| P50 | 111ms |
| P90 | 999ms |
| P95 | 2,054ms |
| P99 | 4,726ms |
| 최대 | 4,726ms |

### 2차 stroke 동기화 시간 구간

| 구간 | 방 개수 |
| --- | ---: |
| 2초 이상 | 5 |
| 1초 이상 2초 미만 | 4 |
| 100ms 이상 1초 미만 | 44 |
| 100ms 미만 | 45 |
| 실패 또는 미측정 | 2 |

해석:

- 2차는 1차보다 sync P50, P90, P95가 좋아졌다.
- 하지만 실패 방이 2개 남았고, sync max는 여전히 4.7초 수준이다.
- 따라서 평균적인 성능은 괜찮지만, 안정성/tail latency 문제가 남아 있다.

## 2차 전체 처리 시간이 길었던 방 Top 10

| 순위 | 방 번호 | 성공 여부 | 실패 타입 | 방 처리 시간 | Sync 시간 |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `047` | 성공 | `none` | 90,148ms | 785ms |
| 2 | `048` | 성공 | `none` | 89,649ms | 144ms |
| 3 | `038` | 성공 | `none` | 89,139ms | 8ms |
| 4 | `046` | 성공 | `none` | 89,057ms | 171ms |
| 5 | `025` | 성공 | `none` | 89,055ms | 110ms |
| 6 | `042` | 성공 | `none` | 89,005ms | 47ms |
| 7 | `050` | 성공 | `none` | 88,972ms | 57ms |
| 8 | `043` | 성공 | `none` | 88,881ms | 579ms |
| 9 | `045` | 성공 | `none` | 88,561ms | 28ms |
| 10 | `031` | 성공 | `none` | 87,108ms | 504ms |

## 2차 stroke 동기화가 느렸던 방 Top 10

| 순위 | 방 번호 | 성공 여부 | 실패 타입 | 방 처리 시간 | Sync 시간 |
| ---: | --- | --- | --- | ---: | ---: |
| 1 | `018` | 성공 | `none` | 86,101ms | 4,726ms |
| 2 | `039` | 성공 | `none` | 81,012ms | 2,892ms |
| 3 | `053` | 성공 | `none` | 60,222ms | 2,477ms |
| 4 | `017` | 성공 | `none` | 81,842ms | 2,358ms |
| 5 | `013` | 성공 | `none` | 79,882ms | 2,054ms |
| 6 | `026` | 성공 | `none` | 80,819ms | 1,702ms |
| 7 | `011` | 성공 | `none` | 64,888ms | 1,358ms |
| 8 | `023` | 성공 | `none` | 79,204ms | 1,219ms |
| 9 | `061` | 성공 | `none` | 51,354ms | 1,077ms |
| 10 | `009` | 성공 | `none` | 54,501ms | 999ms |

## 2차 학생 receiver span 분석

`stroke_slow (1).csv` 기준이다.
단위는 `duration_nano`를 ms로 변환했다.

| 항목 | 값 |
| --- | ---: |
| 전체 row | 560 |
| 측정 가능 row | 492 |
| P50 | 0.500ms |
| P90 | 2.025ms |
| P95 | 2.700ms |
| 최대 | 28.760ms |

### 2차 메시지 타입별 row 수

| 메시지 타입 | Row 수 |
| --- | ---: |
| `ink:stroke:append` | 98 |
| `ink:stroke:start` | 98 |
| `yjs:update` | 95 |
| `ink:stroke:end` | 95 |
| `yjs:sync-response` | 87 |
| `yjs:sync-request` | 87 |

### 2차 학생 receiver 처리 시간이 길었던 케이스 Top 10

| 순위 | 학생 방 번호 | 메시지 타입 | P95 처리 시간 |
| ---: | --- | --- | ---: |
| 1 | `031` | `yjs:update` | 28.760ms |
| 2 | `018` | `yjs:update` | 5.160ms |
| 3 | `049` | `yjs:update` | 5.055ms |
| 4 | `033` | `yjs:update` | 4.495ms |
| 5 | `032` | `yjs:sync-response` | 4.400ms |
| 6 | `017` | `yjs:update` | 4.320ms |
| 7 | `026` | `yjs:update` | 4.025ms |
| 8 | `005` | `yjs:update` | 4.000ms |
| 9 | `016` | `yjs:update` | 3.735ms |
| 10 | `020` | `yjs:update` | 3.730ms |

해석:

- 2차에서도 학생 receiver span 대부분은 ms 단위로 짧다.
- 단, `031`번 학생의 `yjs:update`가 28.76ms로 튀었다.
- 그래도 이 값은 `sync_timeout` 10초와 직접 같은 규모가 아니다.
- 실패 원인은 handler CPU 시간보다는 메시지 도달/적용/관측 조건 문제일 가능성이 더 높다.

## 2차 결론

2차는 1차보다 성공률과 sync P95가 좋아졌지만, `sync_timeout`은 반복됐다.

| 항목 | 1차 | 2차 |
| --- | ---: | ---: |
| 성공 방 | 97 | 98 |
| 실패 방 | 3 | 2 |
| Sync P50 | 186ms | 111ms |
| Sync P95 | 2,862ms | 2,054ms |
| Sync Max | 4,684ms | 4,726ms |

결론적으로, 이 100방 1:1 기본 테스트는 여기서 충분히 봤다.
이제 같은 테스트를 계속 반복하기보다는, 오늘 목표에 맞게 다른 검증 축으로 넘어가야 한다.

## 다음 테스트 방향

우리가 이미 만든 테스트 축은 대략 아래와 같다.

| 테스트 | 목적 | 현재 판단 |
| --- | --- | --- |
| `test:room-pairs:100` | 100개 1:1 방에서 실제 브라우저 stroke sync 확인 | 2회 수행 완료, 반복 그만 |
| `test:room-pairs:200` | 200개 1:1 방 확장성 확인 | 다음 후보 |
| `ROOM_PAIR_CONCURRENCY=25/50/100` | 동시성 민감도 확인 | 다음 후보 |
| `ROOM_PAIR_STROKES=5/10` | 한 방에서 stroke를 여러 번 보낼 때 안정성 확인 | 다음 후보 |
| `load:realtime-socket` | 브라우저 없이 socket 레벨 부하 확인 | 브라우저 비용 분리용 |
| `load:realtime-fleet` | 다수 realtime client 시뮬레이션 | 서버/프로토콜 부하용 |
| `load:artillery` | Artillery 기반 socket 부하 | 외부 부하 도구 비교용 |
| `load:k6` | k6 기반 API 부하 | HTTP/API 레이어 확인용 |
| `test:e2e` | 일반 기능 회귀 확인 | 부하 전후 안정성 체크용 |

추천 순서:

1. **브라우저 비용 분리 테스트**
   - `load:realtime-socket` 또는 `load:realtime-fleet`
   - 목적: Playwright 200페이지 때문에 느린 건지, 서버/프로토콜 자체가 느린 건지 분리

2. **stroke 수 증가 테스트**
   - `ROOM_PAIR_STROKES=5 npm run test:room-pairs:100`
   - 목적: 한 번 긋는 테스트가 아니라 실제 수업처럼 연속 입력을 볼 수 있음

3. **동시성 민감도 테스트**
   - `ROOM_PAIR_CONCURRENCY=25`, `50`, `100`
   - 목적: 실패가 후반 batch/동시성 때문인지 확인

4. **200방 확장 테스트**
   - `npm run test:room-pairs:200`
   - 목적: 현재 구조가 더 큰 방 수에서 어디까지 버티는지 확인

현재 내 추천은 **1번 브라우저 비용 분리 테스트**다.
지금 `room.elapsed_ms`가 Playwright 영향을 많이 받아서, 기술스택 판단을 하려면 socket/protocol 레벨 부하를 따로 봐야 한다.
