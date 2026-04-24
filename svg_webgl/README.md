# Whiteboard Migration PoC (No Excalidraw)

이 폴더는 **라이브러리 제거 이후 구조를 검증하기 위한 테스트용 PoC**입니다.
핵심 의도는 Canvas 2D 재의존이 아니라, 다음을 먼저 검증하는 것입니다.

- SVG-first 객체 편집 흐름(선택/이동/리사이즈)
- 입력/문서/렌더 경계 분리
- 읽기 전용/편집 모드 분리
- JSON 저장/복원 기반의 파일 중심 저장 모델
- 이후 WebGL 렌더러 교체 지점 확보

## 실행

정적 파일이라 간단히 웹 서버로 실행하면 됩니다.

```bash
cd /Users/mildang/Desktop/pentest
python3 -m http.server 4173
```

브라우저에서 `http://localhost:4173` 접속.

## 현재 포함 기능

- 자유곡선 필기(pressure 반영한 굵기 시작값)
- 손툴(패닝), 줌(버튼 + 휠)
- 선택/이동/리사이즈(텍스트/이미지)
- 텍스트/이미지 객체 추가
- 읽기 전용 모드 토글
- JSON 내보내기/불러오기

## 구조 메모

- 단일 파일(`index.html`)이지만 내부에서 역할을 나눠 놓았습니다.
  - 입력: pointer/wheel 처리
  - 문서: `state.doc.elements`
  - 렌더: `render()`
  - 뷰포트: `worldToScreen`, `screenToWorld`
- `WebGLRendererStub`를 넣어 렌더러 교체 포인트를 명시했습니다.

## 이 PoC로 확인할 것

- 모바일 웹뷰에서 pointer 이벤트 품질(pressure/터치 동작)
- 객체 수 증가 시 선택/이동 반응성
- 줌/패닝 이후 좌표 정합성
- JSON 포맷이 GraphQL 메타 + presigned 업로드 흐름과 결합 가능한지

## 다음 단계 추천

1. `index.html`에서 엔진 로직을 모듈 파일로 분리 (`core`, `input`, `renderer`)
2. undo/redo(Command 패턴) 추가
3. 지우개를 stroke 분할 방식으로 고도화
4. GraphQL 메타 + 파일 업로드 어댑터 스켈레톤 추가
5. SVG 병목 구간 측정 후 WebGL 레이어 전략 결정
