# 손필기 펜슬 입력 실기기 호환성 테스트 결과

생성일: 2026-04-30
테스트 문구: 안녕하세요
테스트 URL: `http://10.1.100.73:5177/?pencilReport=1`

## 목적

Apple Pencil, Wacom, S Pen 환경에서 실제 스타일러스 입력으로 동일한 문구를 작성하고, 브라우저 입력 이벤트와 stroke 생성 결과를 기준으로 손필기 기능의 호환성을 확인한다.

## 결론

현재 구현은 iPad + Apple Pencil, Galaxy Tab + S Pen 환경에서 실기기 펜 입력을 정상 처리한다. 두 모바일 태블릿 환경 모두 `pointerType: pen`으로 인식되었고, pressure 값이 실제로 변화했으며, stroke 생성도 정상적으로 증가했다.

Windows + Wacom 환경은 필기 자체는 가능하지만 브라우저 이벤트가 `pen`이 아니라 `mouse`로 들어왔다. 따라서 stroke 생성 관점에서는 사용 가능하지만, 펜 전용 입력/필압/tilt 기반 품질 검증 관점에서는 WARN으로 분류한다.

실사용 체감 기준으로는 Galaxy Tab + S Pen의 필기감과 반응 속도가 가장 좋았다. iPad + Apple Pencil도 정상적으로 필기 가능했으며, Windows + Wacom도 필기 기능 자체는 동작했다. 다만 Wacom은 프로젝트 내부 캔버스뿐 아니라 일반 배경/화면 터치에서도 좌표가 어긋나는 양상이 관찰되어, 해당 좌표 문제는 프로젝트 단독 이슈라기보다 Wacom 장비/드라이버/OS 입력 매핑 환경의 영향으로 보는 것이 타당하다.

LAN HTTP 환경에서는 `Secure Context`가 `false`이므로 `crypto.randomUUID()`만 사용하는 구현은 stroke id 생성 단계에서 실패할 수 있다. 현재처럼 `makeId` fallback은 유지해야 한다.

## 요약표

| 기기 | 입력 장비 | OS / Platform | 브라우저 | Secure Context | pointerType | pressure | strokeDelta | touch events | 결과 | 판정 근거 |
|---|---|---|---|---|---|---|---:|---:|---|---|
| iPad | Apple Pencil | iPad | Safari | false | pen | 0.00~0.58 | 69 | 500 | PASS | pen 인식, pressure 변화, tilt 값 수집, stroke 정상 생성 |
| Windows PC | Wacom | Win32 | Edge | false | mouse | 0.00~0.50 | 70 | 0 | WARN | 필기는 되지만 pen pointer 미인식, pressure는 mouse 기본값 형태, 장비/OS 레벨 좌표 어긋남 관찰 |
| Galaxy Tab | S Pen | Linux armv81 | Chrome/Samsung Internet 계열 | false | pen | 0.00~0.67 | 68 | 500 | PASS | pen 인식, pressure 변화, tilt 값 수집, stroke 정상 생성, 필기감/반응 속도 가장 우수 |

## 기기별 상세 결과

### iPad + Apple Pencil

| 항목 | 결과 |
|---|---|
| 테스트 일시 | 2026-04-30T06:53:10.003Z |
| URL | `http://10.1.100.73:5177/?pencilReport=1` |
| Secure Context | false |
| pointerType | pen |
| pressure 범위 | 0.00~0.58 |
| tilt | 지원 확인 |
| strokeDelta | 69 |
| pointerdown / move / up / cancel | 20 / 459 / 21 / 0 |
| pen pointerdown / pen pointermove | 20 / 459 |
| touchstart / move / end / cancel | 44 / 411 / 45 / 0 |
| 최종 결과 | PASS |

iPad Safari에서 Apple Pencil은 `pointerType: pen`으로 정상 인식되었다. pressure 값은 `0.00~0.58` 범위로 변화했고, tilt 값도 수집되었다. strokeDelta가 69로 증가하여 stroke 생성 실패나 첫 획 누락 문제는 재현되지 않았다.

단, 테스트 URL이 LAN HTTP이므로 `Secure Context`는 false다. 이 환경에서는 `crypto.randomUUID()` fallback이 반드시 필요하다.

### Windows + Wacom

| 항목 | 결과 |
|---|---|
| 테스트 일시 | 2026-04-30T06:50:06.137Z |
| URL | `http://10.1.100.73:5177/?pencilReport=1` |
| Secure Context | false |
| pointerType | mouse |
| pressure 범위 | 0.00~0.50 |
| 의미 있는 tilt | 미확인 |
| strokeDelta | 70 |
| pointerdown / move / up / cancel | 20 / 460 / 20 / 0 |
| pen pointerdown / pen pointermove | 0 / 0 |
| touchstart / move / end / cancel | 0 / 0 / 0 / 0 |
| 최종 결과 | WARN |

Windows + Wacom 환경에서는 strokeDelta가 70으로 증가해 필기 자체는 정상 동작했다. 하지만 브라우저 PointerEvent 기준으로 입력이 `pen`이 아니라 `mouse`로 기록되었고, pen pointer 이벤트는 0건이었다.

pressure 값도 `0.00~0.50` 형태로 기록되어 실제 펜 필압이라기보다 mouse 입력 기본값에 가깝다. 따라서 “필기 가능”은 확인되었지만 “펜 입력 호환성”은 제한적으로만 확인되어 WARN으로 분류한다.

실사용 관찰에서는 캔버스 내부뿐 아니라 일반 배경/화면 터치에서도 좌표점이 잘 맞지 않는 현상이 있었다. 따라서 Wacom 좌표 어긋남은 현재 프로젝트의 WebGL/R3F 캔버스 처리만의 문제로 단정하기 어렵고, Wacom 드라이버, Windows 입력 설정, 디스플레이 배율, 브라우저 입력 매핑 조합의 영향을 함께 확인해야 한다.

### Galaxy Tab + S Pen

| 항목 | 결과 |
|---|---|
| 테스트 일시 | 2026-04-30T07:00:59.581Z |
| URL | `http://10.1.100.73:5177/?pencilReport=1` |
| Secure Context | false |
| pointerType | pen |
| pressure 범위 | 0.00~0.67 |
| tilt | 지원 확인 |
| strokeDelta | 68 |
| pointerdown / move / up / cancel | 14 / 471 / 15 / 0 |
| pen pointerdown / pen pointermove | 14 / 471 |
| touchstart / move / end / cancel | 31 / 437 / 32 / 0 |
| 최종 결과 | PASS |

Galaxy Tab + S Pen 환경에서는 S Pen이 `pointerType: pen`으로 정상 인식되었다. pressure 값은 `0.00~0.67` 범위로 변화했고, tilt 값도 수집되었다. strokeDelta가 68로 증가하여 stroke 생성도 정상 동작했다.

실사용 체감상 세 기기 중 필기감과 반응 속도가 가장 좋았다. 입력 이벤트도 `pen`으로 안정적으로 잡혔고, stroke 생성 결과와 체감 품질이 모두 양호했다.

다만 pointer event와 함께 touch event도 다수 발생했다. 현재 결과에서는 필기 실패나 stroke 누락으로 이어지지 않았지만, 손바닥 터치 간섭 여부는 실제 사용 플로우에서 추가로 관찰하는 것이 좋다.

## 공통 관찰

1. LAN HTTP 접속은 `Secure Context: false`로 기록된다.
2. `Secure Context: false`에서는 `crypto.randomUUID()`가 항상 사용 가능하다고 보면 안 된다.
3. iPad와 Galaxy Tab은 실기기 펜 입력이 `pointerType: pen`으로 들어온다.
4. Wacom은 현재 테스트 환경에서 `pointerType: mouse`로 들어오므로 펜 전용 기능 검증에 한계가 있다.
5. Wacom의 좌표 어긋남은 프로젝트 외부 화면에서도 관찰되어 프로젝트 단독 이슈로 보기 어렵다.
6. 모바일 태블릿은 pointer event와 touch event가 같이 들어오는 양상이 있다.
7. capture layer를 통해 실제 stroke 생성은 세 기기 모두 성공했다.

## 판정 기준

| 결과 | 기준 |
|---|---|
| PASS | `pointerType: pen` 인식, pressure 변화, stroke 정상 생성, 첫 획 누락 없음 |
| WARN | 필기는 가능하지만 pen 인식/필압/좌표/지연 등 일부 품질 또는 호환성 이슈 존재 |
| FAIL | stroke 생성 실패, 필기 불가, 좌표 큰 오차, export 누락 등 핵심 기능 실패 |

## 최종 판정

| 항목 | 판정 |
|---|---|
| Apple Pencil 지원 | PASS |
| Galaxy Tab S Pen 지원 | PASS |
| Windows Wacom 지원 | WARN |
| LAN HTTP 테스트 대응 | PASS, 단 makeId fallback 유지 필요 |
| 실기기 손필기 기능 전체 | 조건부 PASS |

정성 평가 기준으로는 Galaxy Tab + S Pen이 가장 우수한 필기감과 반응 속도를 보였다. iPad + Apple Pencil도 정상 필기 가능하며, Windows + Wacom은 사용은 가능하나 좌표 정합성과 pen 인식 측면에서 추가 확인이 필요하다.

## 권장 후속 작업

1. `makeId`의 `crypto.randomUUID()` fallback은 제거하지 않는다.
2. Wacom에서 `pointerType: pen`으로 인식되는 브라우저/드라이버 조합을 별도 확인한다.
3. Galaxy Tab에서 손바닥 터치가 많은 상황을 추가 테스트한다.
4. export 이미지에 stroke가 정상 포함되는지 3개 기기별로 1회씩 증빙 이미지를 남긴다.
5. 가능하면 HTTPS 또는 배포 환경에서도 같은 리포트를 한 번 더 생성해 LAN HTTP 결과와 비교한다.

## 원본 증빙 파일

| 기기 | 파일 |
|---|---|
| iPad + Apple Pencil | `/Users/mildang/Downloads/pencil-handwriting-device-report 2.json` |
| Windows + Wacom | `/Users/mildang/Downloads/pencil-handwriting-device-report (2).md` |
| Galaxy Tab + S Pen | `/Users/mildang/Downloads/pencil-handwriting-device-report (1).json`, `/Users/mildang/Downloads/pencil-handwriting-device-report (3).md` |
