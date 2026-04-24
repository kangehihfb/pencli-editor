# Drei Official Docs 기반 Cursor 협업 가이드

이 문서는 `@react-three/drei` 작업을 Cursor에서 계속 진행할 때, **공식 문서를 최우선 근거**로 쓰기 위한 기준 문서입니다.

## 1) 공식 소스 우선순위

아래 순서대로 참고합니다.

1. 공식 문서 사이트: `https://drei.docs.pmnd.rs`
2. 공식 문서 인덱스(전체 페이지 목록): `https://drei.docs.pmnd.rs/getting-started/introduction`
3. 공식 저장소 README: `https://github.com/pmndrs/drei` 및 raw README
4. 문서가 부족한 경우에만 소스 코드 확인

## 2) 공식 문서 기반 핵심 사실

- `drei`는 `@react-three/fiber`용 헬퍼/추상화 모음이다.
- 설치: `npm install @react-three/drei`
- 기본 import:
  - `import { ... } from '@react-three/drei'`
- React Native import:
  - `import { ... } from '@react-three/drei/native'`
- 주의: `native` 엔트리는 `Html`, `Loader`를 export하지 않는다.
- 주의: `drei`는 `three/examples/jsm` 대신 `three-stdlib` 기반이다.

## 3) Cursor 대화 기본 규칙 (이 문서 기준)

아래 규칙을 매 요청마다 적용합니다.

- 답변/구현은 먼저 `drei.docs.pmnd.rs`를 근거로 한다.
- 공식 문서에 없는 내용은 "추정"으로 분리해서 표시한다.
- 컴포넌트/훅 설명 시:
  - 언제 쓰는지
  - 최소 예제
  - 자주 틀리는 포인트
  - 성능/렌더링 주의점
  을 함께 정리한다.
- 코드 작성 시 가능한 경우 타입스크립트 기준으로 제시한다.
- 환경 차이(web/native), 로더 제약, 성능 관련 옵션은 누락하지 않는다.

## 4) Cursor에 바로 붙여넣을 고정 프롬프트

아래 텍스트를 이후 채팅 첫 메시지나 프로젝트 메모로 사용하면 됩니다.

```text
앞으로 @react-three/drei 관련 답변과 코드 변경은 공식 문서(https://drei.docs.pmnd.rs)를 최우선 근거로 진행해줘.
공식 문서 근거가 없는 내용은 추정이라고 명확히 표시해줘.
답변에는 항상 최소 실행 예제와 주의사항(성능, web/native 차이, 로더/asset 제약)을 포함해줘.
가능하면 TypeScript + React Three Fiber 기준으로 작성해줘.
```

## 5) 요청 템플릿 (계속 대화용)

필요할 때 아래 형식으로 요청하면 품질이 안정적입니다.

```text
[목표]
- 예: ScrollControls + Html로 제품 소개 섹션 만들기

[조건]
- Next.js App Router
- TypeScript
- 모바일 FPS 저하 최소화

[원하는 결과]
- 컴포넌트 구조 제안
- 실제 코드 수정
- 성능 체크 포인트
- 공식 문서 링크 기반 설명
```

## 6) 빠른 공식 링크

- 문서 홈: `https://drei.docs.pmnd.rs`
- 문서 인트로/전체 인덱스: `https://drei.docs.pmnd.rs/getting-started/introduction`
- 저장소: `https://github.com/pmndrs/drei`
- NPM: `https://www.npmjs.com/package/@react-three/drei`
- R3F 저장소: `https://github.com/pmndrs/react-three-fiber`

## 7) 유지보수 메모

- Drei 버전 업데이트 시 문서 URL/API 변경 여부를 먼저 확인한다.
- 컴포넌트별 props는 답변 직전에 문서 페이지를 다시 확인한다.
- 팀 내에서 규칙을 통일하려면 이 파일을 프로젝트 루트에 유지한다.

## 8) 복붙용 요청 문장 5개

아래 문장 중 하나를 채팅 첫 줄에 붙여서 사용하면 됩니다.

1. `@drei-official-cursor-guide.md 기준으로 작업해줘. 공식문서 우선으로 진행해줘.`
2. `drei 공식문서(https://drei.docs.pmnd.rs) + @drei-official-cursor-guide.md 규칙을 적용해서 답변해줘.`
3. `@drei-official-cursor-guide.md 참고해서 TypeScript 기준으로 코드 수정까지 해줘.`
4. `이번 요청은 @drei-official-cursor-guide.md 기준으로, 추정 내용은 추정이라고 명확히 표시해줘.`
5. `공식문서 우선, web/native 차이와 성능 주의사항 포함, 최소 실행 예제 포함해서 답변해줘. 기준 문서는 @drei-official-cursor-guide.md.`

