# Whiteboard PoC Test Checklist

목적: 현재 `index.html` 기반 SVG PoC를 PC/iPad/모바일에서 같은 기준으로 검증한다.

사용법:
- 각 항목을 `PASS` / `FAIL` / `N/A` 중 하나로 기록
- `FAIL`이면 재현 절차와 화면 상태를 메모
- 기기별로 별도 복사본을 만들어 기록

---

## 0) 테스트 환경

- Device:
- OS:
- Browser:
- Input:
  - Mouse / Touch / Pen (Apple Pencil, Wacom, Surface Pen 등)
- Build/URL:
- Tester:
- Date:

---

## 1) 기본 기능

- [ ] 펜으로 자유곡선 필기가 자연스럽게 된다 (`id: 1-pen-natural`)
- [ ] 선택 툴로 stroke / text / image를 선택할 수 있다 (`id: 1-select-stroke-text-image`)
- [ ] 선택된 객체를 이동할 수 있다 (`id: 1-move-selected`)
- [ ] 선택 핸들로 text / image / stroke 리사이즈가 된다 (`id: 1-resize-all-types`)
- [ ] 지우개로 객체 삭제가 된다 (`id: 1-erase-delete`)
- [ ] 읽기 전용 모드에서 편집 동작이 차단된다 (`id: 1-readonly-block`)
- [ ] 읽기 전용 OFF 후 다시 편집이 가능하다 (`id: 1-readonly-off-edit`)

메모:

---

## 2) 뷰포트(줌/패닝) 정합성

- [ ] 손툴 패닝 시 화면이 찢기거나 심하게 끊기지 않는다 (`id: 2-pan-smooth`)
- [ ] 줌 인/아웃 후 선택 위치가 시각적으로 맞는다 (`id: 2-zoom-select-align`)
- [ ] 줌 후 이동/리사이즈 좌표가 튀지 않는다 (`id: 2-zoom-transform-stable`)
- [ ] 뷰 리셋 이후 편집 동작이 정상이다 (`id: 2-reset-view-ok`)

메모:

---

## 3) 입력 품질

- [ ] 마우스 입력에서 포인터 위치와 실제 선 위치가 일치한다 (`id: 3-mouse-point-align`)
- [ ] 터치 입력에서 오동작 없이 필기/선택이 된다 (`id: 3-touch-input-ok`)
- [ ] 펜 입력에서 pressure 반응이 체감된다 (지원 기기) (`id: 3-pen-pressure`)
- [ ] 빠른 필기 시 선이 뒤늦게 그려지지 않는다 (`id: 3-fast-draw-latency`)

메모:

---

## 4) 히스토리(되돌리기/앞으로가기)

- [ ] 필기 후 undo/redo가 정상 동작한다 (`id: 4-undo-redo-draw`)
- [ ] 이동/리사이즈 후 undo/redo가 정상 동작한다 (`id: 4-undo-redo-transform`)
- [ ] 지우개 후 undo/redo가 정상 동작한다 (`id: 4-undo-redo-erase`)
- [ ] JSON import 후 undo가 정상 동작한다 (`id: 4-undo-after-import`)

메모:

---

## 5) 데이터(저장/복원/내보내기)

- [ ] JSON 내보내기 파일이 생성된다 (`id: 5-export-json-file`)
- [ ] JSON 불러오기로 동일 상태가 복원된다 (`id: 5-import-roundtrip`)
- [ ] GraphQL용 내보내기 파일 2개가 생성된다 (`id: 5-export-graphql-two-files`)
- [ ] GraphQL 변수 템플릿의 필드를 실제 백엔드 스키마로 매핑 가능하다 (`id: 5-graphql-template-mapping`)

메모:

---

## 6) 성능

실행 절차:
- `요소 2000개 테스트` 클릭
- 손툴 패닝 10초, 줌 인/아웃 10회, 선택/이동 10회

체크:
- [ ] 조작 중 멈춤(프리즈) 없이 동작한다 (`id: 6-no-freeze`)
- [ ] 상태바 `render=...ms`가 과도하게 급등하지 않는다 (`id: 6-render-ms-stable`)
- [ ] `visible` 컬링이 동작해 화면 밖 요소 렌더가 줄어든다 (`id: 6-visible-culling`)
- [ ] 열 사용(발열)/배터리 소모가 비정상적으로 크지 않다 (모바일) (`id: 6-thermal-battery`)

메모:

---

## 7) 권장 합격 기준 (PoC 기준)

- 정상 기능 항목 PASS 비율 90% 이상
- 치명 실패 없음:
  - 필기 불가
  - 선택/이동 불가
  - undo/redo 불가
  - 저장/복원 불가
- 대량 요소 테스트에서 "사용 불가 수준" 프레임 드랍 없음

---

## 8) 실패 기록 템플릿

- 항목:
- 기기/브라우저:
- 재현 단계:
  1.
  2.
  3.
- 기대 결과:
- 실제 결과:
- 빈도: 항상 / 간헐
- 스크린샷/영상 파일명:
- 비고:

---

## 9) 리포트 자동 항목

- `0-pointer-support`: PointerEvent 런타임 지원
- `0-history-recorded`: 히스토리 스택 활동 기록 존재

`테스트 리포트` JSON의 `passFailChecklist`는 위 id를 기준으로 수동/자동 항목을 함께 담는다.
