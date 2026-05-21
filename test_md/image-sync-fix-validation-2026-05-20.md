# 이미지 동기화 Fix 검증 리포트

작성일: 2026-05-20  
SigNoz 대시보드: http://127.0.0.1:8080/dashboard/019e444a-38b6-7e0f-aeaf-3fd0c3f95758?relativeTime=3d

## 1. 목적

이미지 삽입 시 Yjs update payload가 커지면서 실시간 동기화가 막히거나 teacher/student 상태가 갈라지는 문제를 검증한다.

검증 기준은 다음 네 가지다.

| 항목 | 통과 기준 |
|---|---:|
| yjs:update payload | max(payload.bytes) < 100KB |
| 송신/수신 count | server-broadcast count와 client-broadcast count가 큰 차이 없이 일치 |
| teacher/student object, image count | heartbeat마다 동일 |
| stroke hash match | heartbeat 100% true |

## 2. SigNoz 대시보드 구성

대시보드 이름: `Image Sync Fix Validation - Before vs After`

Time range는 `Last 3 days`로 두면 5/18 문제 run과 5/20 fix 후 run을 함께 볼 수 있다.

| 패널 | 목적 |
|---|---|
| Run Compare - Headed Sanity | headed sanity run 전체 비교 |
| A. yjs:update Payload Gate | yjs:update payload가 100KB 이하인지 확인 |
| A2. Socket Payload by Message Type | yjs:update / image:preview / image:ready payload 비교 |
| B1. Send Count - Server Broadcast | 송신 count와 payload 확인 |
| B2. Receive Count - Client Broadcast | 수신 count와 payload 확인 |
| C. Object/Image Count - Teacher vs Student | teacher/student object, image 개수 일치 여부 확인 |
| D. YJS Apply Count by Actor | actor별 remote update apply 흐름 확인 |
| E. Stroke Hash Match | stroke 개수, point 수, hash 정합성 확인 |
| F. Image Optimize / Upload Latency | 이미지 압축 및 업로드 지연 확인 |

실제 attribute 이름은 코드 기준으로 맞췄다.

| 의도 | 실제 attribute |
|---|---|
| actor.role | `realtime.actor.role` |
| room | `room.id` |
| yjs update message type | `realtime.message.type = 'yjs:update'` |
| socket payload | `payload.bytes` |
| heartbeat object count | `teacher.canvas.objects`, `student.canvas.objects` |
| heartbeat image count | `teacher.canvas.images`, `student.canvas.images` |

주의: `client.yjs.update` span에는 현재 role attribute가 없어서, teacher/student 구분은 `realtime.actor.id` 또는 actor id 문자열로 봐야 한다.

## 3. 비교 대상 Run

| 구분 | run id | KST 시작 시각 | 조건 | 결과 |
|---|---|---:|---|---|
| 문제 재현 | `2026-05-18T07-35-57-576Z` | 2026-05-18 16:35:57 | 10방 / 20 브라우저 / 사진 삽입 | pass로 찍혔지만 room 상태 불일치 발생 |
| 추가 문제 재현 | `2026-05-18T08-56-05-320Z` | 2026-05-18 17:56:05 | 10방 / 20 브라우저 / 사진 삽입 | stroke는 pass, object/image count 불일치 |
| fix 후 검증 | `2026-05-20T06-27-40-597Z` | 2026-05-20 15:27:40 | 10방 / 20 브라우저 / 이미지 최적화/preview 구조 | sync 정합성 정상, 콘솔 404 때문에 run result만 fail |

## 4. Fix 전 문제 증거

5/18 run에서는 room-08에서 큰 payload와 상태 불일치가 같이 나타났다.

| 지표 | 값 |
|---|---:|
| room-08 max(payload.bytes) | 10,573,560 bytes |
| 문제 message | `client.socket.server-broadcast`, `realtime.message.type = yjs:update`, `realtime.actor.role = student` |
| room-08 stroke mismatch | HB #4~#6에서 `stroke.hash_match = false` |
| room-08 stroke delta | student가 teacher보다 +3 strokes, +64 points |
| room-08 object/image mismatch | teacher/student count 갈라짐 |

핵심 해석: 이미지 base64가 Yjs update에 실리면서 10MiB급 payload가 만들어졌고, 이때 teacher/student 상태가 갈라졌다. 더 나쁜 경우에는 stroke hash가 true로 보여도 양쪽이 같이 멈춰서 false positive가 날 수 있었다.

## 5. Fix 후 검증 결과

5/20 fix 후 run은 Playwright 결과상 `fail`이지만, 실패 원인은 동기화가 아니라 콘솔 404다.

| 지표 | 값 |
|---|---:|
| ready rooms | 10/10 |
| heartbeat total | 60 |
| heartbeat failed | 0 |
| stroke hash match | 60/60 |
| object count match | 60/60 |
| image count match | 60/60 |
| sync p50 | 41ms |
| sync p95 | 783ms |
| sync max | 800ms |
| failed rooms | 3 |

failed rooms 3개는 `Product handwriting load failed: 404` 콘솔 에러로 분류된 것이다. teacher/student stroke/object/image 정합성은 모두 맞았다.

5/20 run에서 확인한 yjs:update payload는 다음과 같다.

| 항목 | 값 |
|---|---:|
| room | `class-session-2026-05-20T06-27-40-597Z-07` |
| actor role | `student` |
| message type | `yjs:update` |
| max(payload.bytes) | 10,837 bytes |
| 크기 환산 | 약 10.6 KiB |
| 통과 기준 | 100KB 미만 |
| 판정 | 통과 |

5/18 문제 run의 `10,573,560 bytes`와 비교하면 약 `1/975` 수준으로 줄었다. 즉 10MiB급 base64 payload가 Yjs update에 실리던 문제는 이 run 기준으로 재현되지 않았다.

최종 snapshot 기준으로도 모든 방에서 teacher와 student의 object/image/stroke가 일치했다.

| 방 | objects | images | strokes | points |
|---|---:|---:|---:|---:|
| 01 | 1 = 1 | 1 = 1 | 6 = 6 | 54 = 54 |
| 02 | 1 = 1 | 1 = 1 | 6 = 6 | 54 = 54 |
| 03 | 3 = 3 | 3 = 3 | 10 = 10 | 202 = 202 |
| 04 | 1 = 1 | 1 = 1 | 6 = 6 | 69 = 69 |
| 05 | 3 = 3 | 3 = 3 | 4 = 4 | 36 = 36 |
| 06 | 2 = 2 | 2 = 2 | 7 = 7 | 165 = 165 |
| 07 | 5 = 5 | 5 = 5 | 4 = 4 | 350 = 350 |
| 08 | 1 = 1 | 1 = 1 | 9 = 9 | 290 = 290 |
| 09 | 7 = 7 | 5 = 5 | 10 = 10 | 166 = 166 |
| 10 | 2 = 2 | 2 = 2 | 7 = 7 | 133 = 133 |

## 6. 이미지 최적화 지표

별도 추출 CSV 기준, 이미지 최적화 span은 다음 값을 기록했다.

| 항목 | 값 |
|---|---:|
| span | `client.image.optimize` |
| duration | 175.1ms |
| original size | 2,363,764 bytes |
| output size | 36,562 bytes |
| saved bytes | 2,327,202 bytes |
| output type | image/webp |
| output width/height | 1600 x 910 |
| quality | 0.72 |

업로드 전 압축 자체는 충분히 짧다. 이전에 관측한 긴 체감 시간은 압축보다 storage upload / backend storage path / UX에서 upload 완료를 기다리는 구조가 더 큰 원인이었다.

## 7. 판정

현재 기준으로는 base64를 Yjs update에 싣는 문제는 fix 방향이 맞다.

| 검증 항목 | 판정 |
|---|---|
| 10MiB yjs:update 제거 | 5/18 문제 run 10,573,560 bytes → 5/20 fix 후 run 10,837 bytes |
| teacher/student object/image 정합성 | 5/20 run에서 60/60 정상 |
| stroke hash 정합성 | 5/20 run에서 60/60 정상 |
| sync failure | 5/20 run에서 0건 |
| 남은 실패 | 제품 로딩 404 콘솔 에러. 이미지 sync 자체와 별도 |

## 8. 다음 체크

1. 대시보드에서 5/20 run만 시간 범위로 잡고 `A. yjs:update Payload Gate`의 max(payload.bytes)가 100KB 미만인지 확인한다.
2. 5/18 16:35 KST 근처와 5/20 15:27 KST 근처를 각각 고정해 같은 패널을 비교한다.
3. `client.yjs.update` span에 `realtime.actor.role`을 추가하면 teacher/student apply count 패널이 더 명확해진다.
4. object/image hash까지 있으면 “개수는 같지만 실제 image가 다름” 상태도 잡을 수 있다.
5. Product handwriting 404는 별도 이슈로 처리한다. 현재 run result를 fail로 만들지만 sync 판단에는 직접 영향이 없다.
