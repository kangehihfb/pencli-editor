# Handwriting Test Results Log

This file stores running results using the fixed 5-field format.

## Run-000 (Initialization)
- Test ID: baseline-initial
- Axis: performance
- Date/Time: TBD
- Environment: TBD
- 재현 조건: 테스트 환경 초기 생성 직후, 아직 실행 전.
- 기대 동작: 테스트 항목 기록 체계가 준비됨.
- 실제 동작: 템플릿/케이스/옵션 리뷰 문서 생성 완료.
- 원인 가설: 해당 없음 (초기 상태 기록).
- 조치: 첫 실제 실행 결과를 Run-001부터 누적 기록.

## Run-001 (DOM overlay start-capture conflict)
- Test ID: C2-html-overlap-start
- Axis: event-conflict
- Date/Time: 2026-04-23
- Environment: Web (local Vite), macOS, mouse
- 재현 조건: `drei Html` floating 요소가 캔버스 위에 있을 때, 해당 영역에서 드로잉 시작.
- 기대 동작: 오버레이 경계/내부에서도 스트로크 시작이 안정적으로 가능.
- 실제 동작: Html 영역에서 `pointerdown`이 DOM에 우선 귀속되어 드로잉 시작 누락.
- 원인 가설: Html은 DOM 오버레이로 렌더되어 캔버스 이벤트보다 우선적으로 포인터를 점유.
- 조치: draw 모드에서 Html pointer pass-through 적용(`pointer-events: none`), edit 모드 분리.

## Run-002 (Visual layer mismatch over Html)
- Test ID: C2-html-visual-stack
- Axis: correctness
- Date/Time: 2026-04-23
- Environment: Web (local Vite), macOS, mouse
- 재현 조건: Html 오버레이 위/근처에서 연속 필기.
- 기대 동작: 필기 선이 사용자 시야 기준으로 오버레이와 자연스럽게 겹쳐 보임.
- 실제 동작: 선은 WebGL 캔버스에 그려지지만 Html DOM이 상단 레이어라 선이 위로 보이지 않음.
- 원인 가설: WebGL과 DOM은 렌더 스택이 분리되어 WebGL renderOrder로 DOM 상단 우선순위를 넘길 수 없음.
- 조치: 선택지 분리
  - Html 유지 시: draw 중 pass-through/페이드 정책 적용
  - 완전 겹침 요구 시: 오버레이를 WebGL 오브젝트로 구현

## Run-003 (Mode-based ownership policy verification)
- Test ID: E1-draw-edit-policy
- Axis: event-conflict
- Date/Time: 2026-04-23
- Environment: Web (local Vite), macOS, mouse
- 재현 조건: draw/edit 모드 토글하며 Html 밀도(5/20/50)에서 입력 소유권 확인.
- 기대 동작: draw 모드=필기 우선, edit 모드=DOM 상호작용 우선.
- 실제 동작: 정책 기반 전환 시 충돌 빈도 감소, 입력 소유권이 예측 가능해짐.
- 원인 가설: 모드별 단일 오너를 강제하면 혼합 계층의 랜덤 충돌을 줄일 수 있음.
- 조치: 정책 유지 + 다음 단계에서 계량화(누락 세그먼트율, 재현율, FPS) 추가.
