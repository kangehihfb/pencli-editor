## 테스트 결과 정리본 (iPad)

### 1) 테스트 개요

- 목적: 경량 화이트보드 에디터 기능/성능 스모크 검증
- 리포트 원본: `webgl-poc-test-report-1776844113263.json`
- 테스트 방식:
  - 기능 스모크 2회
  - 성능 스모크 2회
  - 전체 스위트 실행 후 리포트 추출
- 환경 특징:
  - `maxTouchPoints=5` -> 터치 기기(iPad)로 판단 가능
  - UA는 Safari 계열이며 데스크톱형 식별 문자열로 표시됨

---

### 2) iPad 결과 요약

- 전체 스위트 판정: **PASS**
  - `latestSuite.overallStatus = PASS`
- 체크리스트 결과:
  - PASS: **22**
  - FAIL: **0**
  - N/A: **0**

### 기능 스모크

- 2회 모두 **PASS (8/8)**
  - `scene-create`
  - `draw-mesh`
  - `export-shape`
  - `pointer-support`
  - `text-select`
  - `text-resize`
  - `image-select`
  - `image-move`

### 성능 스모크

- 2회 모두 **PASS (3/3)**
  - `culling` PASS
  - `benchmark-fps` PASS (`minFps=59.9`, `60`)
  - `benchmark-max-render` PASS (`maxRender=1ms`)

---

### 3) 성능 수치 (핵심)

- 벤치 FPS: **60.0 / 59.9 / 62.5 / 60.0**
- 평균 FPS: **약 60.6**
- 최고/최저 FPS: **62.5 / 59.9**
- benchmark avgRenderMs: **0.38 / 0.35 / 0.17 / 0.24ms**
- benchmark maxRenderMs: **1ms (모든 런 동일)**
- runtime avgRenderMs: **0.219ms**
- runtime maxRenderMs: **1.0ms**
- runtime longFrameCount: **0**
- visible/total: **900 / 2000**

해석:

- iPad 기준 성능 스모크는 안정적으로 통과
- FPS와 렌더 시간 모두 매우 여유 있는 구간
- 장시간 필기/실사용 체감 확인은 별도로 권장

---

### 4) FAIL 항목 분류

- 본 JSON 기준 **FAIL 항목 없음**
- 이전 정리에서 언급된 FAIL(`3-fast-draw-latency`, `6-no-freeze`, `4-undo-after-import`, `6-render-ms-stable`)은
  - 현재 첨부 JSON과 불일치하거나
  - 다른 시점/다른 빌드 리포트의 결과일 가능성이 큼

---

### 5) 결론 (현재 시점)

- **좋은 점:** 기능/성능 스모크가 전부 PASS이며 성능 여유도 충분
- **남은 점:** 최근 이슈였던 iPad 펜/터치 중복 입력(팜 터치, 중복 스트로크)은 자동 스모크 항목에 직접 반영되지 않으므로 수동 시나리오 검증 필요
- **실무 결론:**
  - 현재 JSON 기준 품질 판정은 **정상 통과**
  - 최종 배포/공유 전에는 iPad 실사용 필기 회귀 테스트(빠른 필기, 손바닥 접촉, 펜/터치 혼합) 추가 권장

