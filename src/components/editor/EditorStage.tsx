import { OrthographicCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ExamPreset } from "../../data/examPresets";
import { exportPageImage } from "../../lib/exportPageImage";
import { downloadClientPageExportComparison } from "../../lib/pageExportMethods";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../../lib/pageGeometry";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { EditorScene } from "./scene/EditorScene";
import type { EditorSceneProps as EditorSceneProperties } from "./scene/EditorScene";
import { ExamLibraryOverlay } from "./ExamLibraryOverlay";

type EditorStageProperties = EditorSceneProperties & {
  examPresets: ExamPreset[];
  activeExamPresetId: string | undefined;
  onSelectExamPreset: (presetId: string) => void;
  questionContent?: ReactNode;
  pageZoom?: number;
  exportRequestId?: number;
  comparisonExportRequestId?: number;
};

type PencilReportPointerEvent = {
  type: string;
  pointerType: string;
  pressure: number;
  tiltX: number;
  tiltY: number;
  twist: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
};

type PencilReportTouchEvent = {
  type: string;
  touches: number;
  changedTouches: number;
  clientX: number | undefined;
  clientY: number | undefined;
  force: number | undefined;
  timeStamp: number;
};

function shouldShowPencilReport() {
  if (typeof window === "undefined") return false;
  const isEnabledValue = (value: string | undefined) =>
    value === "" || value === "1" || value === "true";
  const searchParameters = new URLSearchParams(window.location.search);
  if (isEnabledValue(searchParameters.get("pencilReport"))) return true;

  const hash = window.location.hash.replace(/^#\??/, "");
  const hashParameters = new URLSearchParams(hash);
  if (isEnabledValue(hashParameters.get("pencilReport"))) return true;

  return window.localStorage.getItem("pencilReport") === "1";
}

function getTouchForce(touch: unknown) {
  const candidate = touch as { force?: unknown };
  return typeof candidate.force === "number" ? candidate.force : undefined;
}

function getPressureSummary(events: PencilReportPointerEvent[]) {
  const values = events
    .map((event) => event.pressure)
    .filter((value) => Number.isFinite(value));
  if (values.length === 0) return "확인 불가";
  return `${Math.min(...values).toFixed(2)}~${Math.max(...values).toFixed(2)}`;
}

function getPointerTypeSummary(events: PencilReportPointerEvent[]) {
  const values = [
    ...new Set(events.map((event) => event.pointerType).filter(Boolean)),
  ];
  return values.length > 0 ? values.join(", ") : "확인 불가";
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function markdownCell(value: unknown) {
  return String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", "<br>");
}

function countPointerEvents(
  events: PencilReportPointerEvent[],
  type: string,
  pointerType?: string,
) {
  return events.filter(
    (event) =>
      event.type === type &&
      (!pointerType || event.pointerType === pointerType),
  ).length;
}

function countTouchEvents(events: PencilReportTouchEvent[], type: string) {
  return events.filter((event) => event.type === type).length;
}

function getDeviceProfile(device: string) {
  if (device.includes("iPad")) {
    return {
      summaryDevice: "iPad",
      input: "Apple Pencil",
      browser: "Safari",
      orientationLabel: "화면 방향",
      extraEventLabel: "touch 이벤트 동시 발생",
      sectionTitle: "iPad + Apple Pencil",
    };
  }

  if (device.includes("Wacom")) {
    return {
      summaryDevice: "Windows PC",
      input: "Wacom",
      browser: "Chrome / Edge",
      orientationLabel: "화면 배율",
      extraEventLabel: "드라이버/브라우저 특이사항",
      sectionTitle: "Windows + Wacom",
    };
  }

  return {
    summaryDevice: "Galaxy Tab",
    input: "S Pen",
    browser: "Chrome / Samsung Internet",
    orientationLabel: "화면 방향",
    extraEventLabel: "손바닥 터치 영향",
    sectionTitle: "Galaxy Tab + S Pen",
  };
}

export function EditorStage({
  examPresets,
  activeExamPresetId,
  onSelectExamPreset,
  questionContent,
  pageZoom = 1,
  exportRequestId = 0,
  comparisonExportRequestId = 0,
  ...sceneProperties
}: EditorStageProperties) {
  const frameReference = useRef<HTMLDivElement>();
  const inputCaptureReference = useRef<HTMLDivElement>();
  const isInputDrawingReference = useRef(false);
  const activeInputTouchIdentifierReference = useRef<number>();
  const strokesLengthReference = useRef(sceneProperties.strokes.length);
  const reportStartStrokeCountReference = useRef(0);
  const reportPointerEventsReference = useRef<PencilReportPointerEvent[]>([]);
  const reportTouchEventsReference = useRef<PencilReportTouchEvent[]>([]);
  const [fitScale, setFitScale] = useState(1);
  const [isViewportSyncing, setIsViewportSyncing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [showPencilReport] = useState(shouldShowPencilReport);
  const [isPencilReportRecording, setIsPencilReportRecording] = useState(false);
  const [pencilReportDevice, setPencilReportDevice] = useState(
    "iPad + Apple Pencil",
  );
  const [pencilReportResult, setPencilReportResult] = useState("");
  const activeExamIndex = examPresets.findIndex(
    (preset) => preset.id === activeExamPresetId,
  );
  const visibleExamNumber = activeExamIndex >= 0 ? activeExamIndex + 1 : 0;
  const examAspectRatio = sceneProperties.drawingBounds
    ? sceneProperties.drawingBounds.width / sceneProperties.drawingBounds.height
    : 1;
  const usesFixedPage = Boolean(questionContent);
  const stagePageScale = usesFixedPage ? fitScale * pageZoom : 1;
  const canvasFrameStyle = {
    "--exam-aspect": String(
      usesFixedPage ? PAGE_WIDTH / PAGE_HEIGHT : examAspectRatio,
    ),
    "--stage-page-width": `${PAGE_WIDTH}px`,
    "--stage-page-height": `${PAGE_HEIGHT}px`,
    "--stage-page-scale": String(stagePageScale),
  } as CSSProperties;
  const shouldPassPointerToQuestion =
    Boolean(questionContent) &&
    (sceneProperties.tool === "answer" ||
      (usesFixedPage && sceneProperties.tool === "pan"));
  const isInkPassive = shouldPassPointerToQuestion;
  const {
    drawingBounds,
    onAppendStrokePoint,
    onBeginStroke,
    onEndStroke,
    readonly,
    tool,
  } = sceneProperties;
  const shouldCaptureInkInput = tool === "pen" && !readonly && !isInkPassive;

  useEffect(() => {
    strokesLengthReference.current = sceneProperties.strokes.length;
  }, [sceneProperties.strokes.length]);

  useEffect(() => {
    if (!showPencilReport || !isPencilReportRecording) return;

    const isReportPanelEvent = (event: Event) =>
      event.target instanceof Element &&
      Boolean(event.target.closest(".pencil-report-panel"));

    const handlePointerEvent = (event: PointerEvent) => {
      if (isReportPanelEvent(event)) return;
      reportPointerEventsReference.current = [
        ...reportPointerEventsReference.current,
        {
          type: event.type,
          pointerType: event.pointerType,
          pressure: event.pressure,
          tiltX: event.tiltX,
          tiltY: event.tiltY,
          twist: event.twist,
          clientX: event.clientX,
          clientY: event.clientY,
          timeStamp: event.timeStamp,
        },
      ].slice(-500);
    };

    const handleTouchEvent = (event: TouchEvent) => {
      if (isReportPanelEvent(event)) return;
      const touch = event.changedTouches.item(0);
      reportTouchEventsReference.current = [
        ...reportTouchEventsReference.current,
        {
          type: event.type,
          touches: event.touches.length,
          changedTouches: event.changedTouches.length,
          clientX: touch?.clientX ?? undefined,
          clientY: touch?.clientY ?? undefined,
          force: touch ? getTouchForce(touch) : undefined,
          timeStamp: event.timeStamp,
        },
      ].slice(-500);
    };

    window.addEventListener("pointerdown", handlePointerEvent, true);
    window.addEventListener("pointermove", handlePointerEvent, true);
    window.addEventListener("pointerup", handlePointerEvent, true);
    window.addEventListener("pointercancel", handlePointerEvent, true);
    window.addEventListener("touchstart", handleTouchEvent, true);
    window.addEventListener("touchmove", handleTouchEvent, true);
    window.addEventListener("touchend", handleTouchEvent, true);
    window.addEventListener("touchcancel", handleTouchEvent, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerEvent, true);
      window.removeEventListener("pointermove", handlePointerEvent, true);
      window.removeEventListener("pointerup", handlePointerEvent, true);
      window.removeEventListener("pointercancel", handlePointerEvent, true);
      window.removeEventListener("touchstart", handleTouchEvent, true);
      window.removeEventListener("touchmove", handleTouchEvent, true);
      window.removeEventListener("touchend", handleTouchEvent, true);
      window.removeEventListener("touchcancel", handleTouchEvent, true);
    };
  }, [isPencilReportRecording, showPencilReport]);

  const startPencilReport = () => {
    reportStartStrokeCountReference.current = strokesLengthReference.current;
    reportPointerEventsReference.current = [];
    reportTouchEventsReference.current = [];
    setPencilReportResult("");
    setIsPencilReportRecording(true);
  };

  const finishPencilReport = () => {
    const pointerEvents = reportPointerEventsReference.current;
    const touchEvents = reportTouchEventsReference.current;
    const startStrokeCount = reportStartStrokeCountReference.current;
    const endStrokeCount = strokesLengthReference.current;
    const strokeDelta = endStrokeCount - startStrokeCount;
    const pointerType = getPointerTypeSummary(pointerEvents);
    const pressure = getPressureSummary(pointerEvents);
    const firstStrokeMissing = strokeDelta > 0 ? "없음" : "있음";
    const hasPenPointer = pointerEvents.some(
      (event) => event.pointerType === "pen",
    );
    const hasPressureVariation =
      new Set(pointerEvents.map((event) => event.pressure.toFixed(2))).size > 2;
    const result =
      strokeDelta <= 0
        ? "FAIL"
        : hasPenPointer && hasPressureVariation
          ? "PASS"
          : "WARN";
    const secureContext = String(window.isSecureContext);
    const generatedAt = new Date().toISOString();
    const deviceProfile = getDeviceProfile(pencilReportDevice);
    const pointerDownCount = countPointerEvents(pointerEvents, "pointerdown");
    const pointerMoveCount = countPointerEvents(pointerEvents, "pointermove");
    const pointerUpCount = countPointerEvents(pointerEvents, "pointerup");
    const pointerCancelCount = countPointerEvents(
      pointerEvents,
      "pointercancel",
    );
    const penPointerDownCount = countPointerEvents(
      pointerEvents,
      "pointerdown",
      "pen",
    );
    const penPointerMoveCount = countPointerEvents(
      pointerEvents,
      "pointermove",
      "pen",
    );
    const touchStartCount = countTouchEvents(touchEvents, "touchstart");
    const touchMoveCount = countTouchEvents(touchEvents, "touchmove");
    const touchEndCount = countTouchEvents(touchEvents, "touchend");
    const touchCancelCount = countTouchEvents(touchEvents, "touchcancel");
    const firstPointerDownResult = pointerDownCount > 0 ? "정상" : "누락";
    const pointerMoveContinuity = pointerMoveCount > 0 ? "정상" : "끊김";
    const touchConcurrent = touchEvents.length > 0 ? "있음" : "없음";
    const tiltSupport = pointerEvents.some(
      (event) => event.tiltX !== 0 || event.tiltY !== 0,
    )
      ? "지원"
      : "미지원 또는 미확인";
    const handwritingQuality = result === "FAIL" ? "FAIL" : "시각 확인 필요";
    const coordinateError = "시각 확인 필요";
    const exportIncluded = "확인 필요";
    const notes = [
      window.isSecureContext ? "secure context" : "non-secure context",
      typeof globalThis.crypto?.randomUUID === "function"
        ? "randomUUID 사용 가능"
        : "makeId fallback 필요",
      shouldCaptureInkInput ? "capture layer 사용" : "capture layer 미사용",
      hasPenPointer ? "pen pointer 확인" : "pen pointer 미확인",
      hasPressureVariation ? "pressure 변화 확인" : "pressure 변화 제한",
      `pointer events ${pointerEvents.length}`,
      `touch events ${touchEvents.length}`,
    ].join(", ");
    const summaryRows = [
      {
        device: "iPad",
        input: "Apple Pencil",
        os: pencilReportDevice.includes("iPad") ? navigator.platform : "",
        browser: "Safari",
        url: pencilReportDevice.includes("iPad") ? window.location.href : "",
        secure: pencilReportDevice.includes("iPad") ? secureContext : "",
        pointerType: pencilReportDevice.includes("iPad") ? pointerType : "",
        pressure: pencilReportDevice.includes("iPad") ? pressure : "",
        firstStrokeMissing: pencilReportDevice.includes("iPad")
          ? firstStrokeMissing
          : "",
        coordinateError: pencilReportDevice.includes("iPad")
          ? coordinateError
          : "",
        quality: pencilReportDevice.includes("iPad") ? handwritingQuality : "",
        result: pencilReportDevice.includes("iPad") ? result : "TBD",
        evidence: pencilReportDevice.includes("iPad")
          ? "다운로드된 JSON/MD, 화면 캡처 추가 필요"
          : "",
      },
      {
        device: "Windows PC",
        input: "Wacom",
        os: pencilReportDevice.includes("Wacom") ? navigator.platform : "",
        browser: "Chrome/Edge",
        url: pencilReportDevice.includes("Wacom") ? window.location.href : "",
        secure: pencilReportDevice.includes("Wacom") ? secureContext : "",
        pointerType: pencilReportDevice.includes("Wacom") ? pointerType : "",
        pressure: pencilReportDevice.includes("Wacom") ? pressure : "",
        firstStrokeMissing: pencilReportDevice.includes("Wacom")
          ? firstStrokeMissing
          : "",
        coordinateError: pencilReportDevice.includes("Wacom")
          ? coordinateError
          : "",
        quality: pencilReportDevice.includes("Wacom") ? handwritingQuality : "",
        result: pencilReportDevice.includes("Wacom") ? result : "TBD",
        evidence: pencilReportDevice.includes("Wacom")
          ? "다운로드된 JSON/MD, 화면 캡처 추가 필요"
          : "",
      },
      {
        device: "Galaxy Tab",
        input: "S Pen",
        os: pencilReportDevice.includes("Galaxy") ? navigator.platform : "",
        browser: "Chrome/Samsung Internet",
        url: pencilReportDevice.includes("Galaxy") ? window.location.href : "",
        secure: pencilReportDevice.includes("Galaxy") ? secureContext : "",
        pointerType: pencilReportDevice.includes("Galaxy") ? pointerType : "",
        pressure: pencilReportDevice.includes("Galaxy") ? pressure : "",
        firstStrokeMissing: pencilReportDevice.includes("Galaxy")
          ? firstStrokeMissing
          : "",
        coordinateError: pencilReportDevice.includes("Galaxy")
          ? coordinateError
          : "",
        quality: pencilReportDevice.includes("Galaxy")
          ? handwritingQuality
          : "",
        result: pencilReportDevice.includes("Galaxy") ? result : "TBD",
        evidence: pencilReportDevice.includes("Galaxy")
          ? "다운로드된 JSON/MD, 화면 캡처 추가 필요"
          : "",
      },
    ];

    const summaryTable = summaryRows
      .map(
        (row) =>
          `| ${[
            row.device,
            row.input,
            row.os,
            row.browser,
            row.url,
            row.secure,
            row.pointerType,
            row.pressure,
            row.firstStrokeMissing,
            row.coordinateError,
            row.quality,
            row.result,
            row.evidence,
          ]
            .map(markdownCell)
            .join(" | ")} |`,
      )
      .join("\n");

    const currentDeviceDetail = `## ${deviceProfile.sectionTitle}

| 항목 | 값 |
|---|---|
| 테스트 일시 | ${markdownCell(generatedAt)} |
| 기기 모델 | ${markdownCell(pencilReportDevice)} |
| 입력 장비 | ${markdownCell(deviceProfile.input)} |
| OS 버전 | ${markdownCell(navigator.platform)} |
| 브라우저 | ${markdownCell(navigator.userAgent)} |
| 테스트 URL | ${markdownCell(window.location.href)} |
| Secure Context | ${markdownCell(secureContext)} |
| ${deviceProfile.orientationLabel} | 시각 확인 필요 |
| 브라우저 줌/페이지 줌 | visualViewport scale ${markdownCell(window.visualViewport?.scale ?? "확인 불가")} |
| 증빙 이미지 경로 | 화면 캡처 또는 export 이미지 추가 필요 |

### 입력 이벤트

| 항목 | 결과 |
|---|---|
| pointerType | ${markdownCell(pointerType)} |
| pressure 범위 | ${markdownCell(pressure)} |
| tilt 지원 | ${markdownCell(tiltSupport)} |
| ${deviceProfile.extraEventLabel} | ${markdownCell(touchConcurrent)} |
| 첫 pointerdown 수신 | ${markdownCell(firstPointerDownResult)} |
| pointermove 연속성 | ${markdownCell(pointerMoveContinuity)} |
| pointerdown / move / up / cancel | ${pointerDownCount} / ${pointerMoveCount} / ${pointerUpCount} / ${pointerCancelCount} |
| pen pointerdown / pen pointermove | ${penPointerDownCount} / ${penPointerMoveCount} |
| touchstart / move / end / cancel | ${touchStartCount} / ${touchMoveCount} / ${touchEndCount} / ${touchCancelCount} |

### 안녕하세요 작성 결과

| 항목 | 결과 |
|---|---|
| 첫 획 누락 | ${markdownCell(firstStrokeMissing)} |
| 획 끝 잘림 | 시각 확인 필요 |
| 선 끊김 | 시각 확인 필요 |
| 좌표 오차 | ${markdownCell(coordinateError)} |
| 빠른 필기 품질 | 시각 확인 필요 |
| 느린 필기 품질 | 시각 확인 필요 |
| 필압 반영 체감 | ${hasPressureVariation ? "수집값 변화 있음" : "변화 제한 또는 미확인"} |
| 지연감 | 시각 확인 필요 |
| export 이미지 포함 | ${markdownCell(exportIncluded)} |
| 최종 결과 | ${markdownCell(result)} |

메모:

- ${markdownCell(notes)}
`;

    const markdown = `# Pencil Handwriting Device Report

Generated at: ${generatedAt}
테스트 문구: 안녕하세요

목적: 실제 펜슬/스타일러스 장비로 동일한 문구를 작성하고, 입력 이벤트/필기 품질/좌표/저장 결과를 같은 기준으로 기록한다.

## 요약표

| 기기 | 입력 장비 | OS | 브라우저 | URL | Secure Context | pointerType | pressure | 첫 획 누락 | 좌표 오차 | 필기 품질 | 결과 | 증빙 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
${summaryTable}

## 공통 테스트 절차

1. 테스트 URL에 접속한다.
2. 펜 도구를 선택한다.
3. 캔버스 중앙에 안녕하세요를 자연스럽게 1회 작성한다.
4. 같은 문구를 빠르게 1회 더 작성한다.
5. 같은 문구를 천천히 1회 더 작성한다.
6. undo/redo, 지우개, export 결과를 확인한다.
7. 화면 캡처 또는 export 이미지를 증빙으로 저장한다.

${currentDeviceDetail}

## 미실행 기기 섹션

아래 기기는 동일한 절차로 별도 리포트를 생성한 뒤 요약표에 합산한다.

### iPad + Apple Pencil

- 현재 리포트 대상 여부: ${pencilReportDevice.includes("iPad") ? "예" : "아니오"}

### Windows + Wacom

- 현재 리포트 대상 여부: ${pencilReportDevice.includes("Wacom") ? "예" : "아니오"}

### Galaxy Tab + S Pen

- 현재 리포트 대상 여부: ${pencilReportDevice.includes("Galaxy") ? "예" : "아니오"}

## 판정 기준

| 결과 | 기준 |
|---|---|
| PASS | 안녕하세요 작성 시 첫 획 누락, 선 끊김, 좌표 오차가 없고 export에도 정상 포함된다. |
| WARN | 작성은 가능하지만 지연, 약한 끊김, 필압 미지원, pointerType 미인식 등 품질 이슈가 있다. |
| FAIL | stroke 생성 실패, 필기 불가, 좌표가 크게 어긋남, export 누락 등 핵심 기능이 깨진다. |

## Summary

- startStrokeCount: ${startStrokeCount}
- endStrokeCount: ${endStrokeCount}
- strokeDelta: ${strokeDelta}
- pointerEventCount: ${pointerEvents.length}
- touchEventCount: ${touchEvents.length}
- pointerdown/move/up/cancel: ${pointerDownCount}/${pointerMoveCount}/${pointerUpCount}/${pointerCancelCount}
- touchstart/move/end/cancel: ${touchStartCount}/${touchMoveCount}/${touchEndCount}/${touchCancelCount}

## Raw Pointer Events

\`\`\`json
${JSON.stringify(pointerEvents.slice(-80), undefined, 2)}
\`\`\`

## Raw Touch Events

\`\`\`json
${JSON.stringify(touchEvents.slice(-80), undefined, 2)}
\`\`\`
`;

    const json = JSON.stringify(
      {
        generatedAt,
        testPhrase: "안녕하세요",
        device: pencilReportDevice,
        url: window.location.href,
        secureContext: window.isSecureContext,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        pointerType,
        pressure,
        tiltSupport,
        firstStrokeMissing,
        result,
        notes,
        eventCounts: {
          pointerDown: pointerDownCount,
          pointerMove: pointerMoveCount,
          pointerUp: pointerUpCount,
          pointerCancel: pointerCancelCount,
          penPointerDown: penPointerDownCount,
          penPointerMove: penPointerMoveCount,
          touchStart: touchStartCount,
          touchMove: touchMoveCount,
          touchEnd: touchEndCount,
          touchCancel: touchCancelCount,
        },
        startStrokeCount,
        endStrokeCount,
        strokeDelta,
        pointerEvents,
        touchEvents,
      },
      undefined,
      2,
    );

    setIsPencilReportRecording(false);
    setPencilReportResult(markdown);
    downloadTextFile(
      "pencil-handwriting-device-report.md",
      markdown,
      "text/markdown;charset=utf-8",
    );
    downloadTextFile(
      "pencil-handwriting-device-report.json",
      json,
      "application/json;charset=utf-8",
    );
  };

  useEffect(() => {
    if (!shouldCaptureInkInput) return;

    const captureElement = inputCaptureReference.current;
    if (!captureElement) return;

    const getInputPoint = (clientX: number, clientY: number) => {
      const shell = captureElement.closest<HTMLElement>(".stage-canvas-shell");
      if (!shell || !drawingBounds) return undefined;

      const rect = shell.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return undefined;
      if (
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      )
        return undefined;

      return {
        x: Math.min(
          Math.max(
            ((clientX - rect.left) / rect.width) * PAGE_WIDTH,
            drawingBounds.minX,
          ),
          drawingBounds.maxX,
        ),
        y: Math.min(
          Math.max(
            ((clientY - rect.top) / rect.height) * PAGE_HEIGHT,
            drawingBounds.minY,
          ),
          drawingBounds.maxY,
        ),
      };
    };

    const beginStroke = (clientX: number, clientY: number) => {
      if (isInputDrawingReference.current) return true;

      const point = getInputPoint(clientX, clientY);
      if (!point) return false;

      isInputDrawingReference.current = true;
      onBeginStroke(point);
      return true;
    };

    const appendStroke = (clientX: number, clientY: number) => {
      if (!isInputDrawingReference.current && !beginStroke(clientX, clientY))
        return;

      const point = getInputPoint(clientX, clientY);
      if (!point) return;

      onAppendStrokePoint(point);
    };

    const finishStroke = () => {
      if (!isInputDrawingReference.current) return;

      isInputDrawingReference.current = false;
      activeInputTouchIdentifierReference.current = undefined;
      onEndStroke();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!beginStroke(event.clientX, event.clientY)) return;

      event.preventDefault();
      event.stopPropagation();
      try {
        captureElement.setPointerCapture(event.pointerId);
      } catch {
        // iPad Safari can reject capture when the pointer lifecycle is already changing.
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isInputDrawingReference.current && event.pressure <= 0) return;

      event.preventDefault();
      event.stopPropagation();
      appendStroke(event.clientX, event.clientY);
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (!isInputDrawingReference.current) return;

      event.preventDefault();
      event.stopPropagation();
      finishStroke();
      try {
        if (captureElement.hasPointerCapture(event.pointerId)) {
          captureElement.releasePointerCapture(event.pointerId);
        }
      } catch {
        // Ignore cross-browser pointer capture cleanup differences.
      }
    };

    const getActiveTouch = (touches: TouchList) => {
      const activeIdentifier = activeInputTouchIdentifierReference.current;
      if (activeIdentifier === undefined) return touches.item(0);

      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (touch?.identifier === activeIdentifier) return touch;
      }

      return undefined;
    };

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.changedTouches.item(0);
      if (!touch || !beginStroke(touch.clientX, touch.clientY)) return;

      event.preventDefault();
      event.stopPropagation();
      activeInputTouchIdentifierReference.current = touch.identifier;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const touch = getActiveTouch(event.changedTouches);
      if (!touch) return;

      event.preventDefault();
      event.stopPropagation();
      appendStroke(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (
        !isInputDrawingReference.current ||
        !getActiveTouch(event.changedTouches)
      )
        return;

      event.preventDefault();
      event.stopPropagation();
      finishStroke();
    };

    captureElement.addEventListener("pointerdown", handlePointerDown, {
      capture: true,
    });
    captureElement.addEventListener("pointermove", handlePointerMove, {
      capture: true,
    });
    captureElement.addEventListener("pointerup", handlePointerEnd, {
      capture: true,
    });
    captureElement.addEventListener("pointercancel", handlePointerEnd, {
      capture: true,
    });
    captureElement.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: false,
    });
    captureElement.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    });
    captureElement.addEventListener("touchend", handleTouchEnd, {
      capture: true,
      passive: false,
    });
    captureElement.addEventListener("touchcancel", handleTouchEnd, {
      capture: true,
      passive: false,
    });

    return () => {
      captureElement.removeEventListener(
        "pointerdown",
        handlePointerDown,
        true,
      );
      captureElement.removeEventListener(
        "pointermove",
        handlePointerMove,
        true,
      );
      captureElement.removeEventListener("pointerup", handlePointerEnd, true);
      captureElement.removeEventListener(
        "pointercancel",
        handlePointerEnd,
        true,
      );
      captureElement.removeEventListener("touchstart", handleTouchStart, true);
      captureElement.removeEventListener("touchmove", handleTouchMove, true);
      captureElement.removeEventListener("touchend", handleTouchEnd, true);
      captureElement.removeEventListener("touchcancel", handleTouchEnd, true);
    };
  }, [
    drawingBounds,
    onAppendStrokePoint,
    onBeginStroke,
    onEndStroke,
    shouldCaptureInkInput,
  ]);

  useEffect(() => {
    if (!usesFixedPage) {
      setFitScale(1);
      return;
    }

    const frame = frameReference.current;
    if (!frame) return;
    let resizeSettledTimer: number | undefined = undefined;
    let syncAnimationFrame: number | undefined = undefined;

    const getNextScale = () => {
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return undefined;

      return Math.max(
        0.1,
        Math.min(rect.width / PAGE_WIDTH, rect.height / PAGE_HEIGHT),
      );
    };

    const updateScale = (immediate = false) => {
      const nextScale = getNextScale();
      if (nextScale === undefined) return;

      if (resizeSettledTimer !== undefined) {
        window.clearTimeout(resizeSettledTimer);
      }

      if (immediate) {
        setFitScale(nextScale);
        return;
      }

      resizeSettledTimer = window.setTimeout(() => {
        setIsViewportSyncing(true);
        setFitScale(nextScale);
        let syncCheckCount = 0;
        const waitForCanvasSync = () => {
          const shell = frame.querySelector<HTMLElement>(".stage-canvas-shell");
          const canvas = frame.querySelector<HTMLCanvasElement>(
            "canvas.stage-canvas, .stage-canvas canvas, canvas",
          );
          if (!shell || !canvas) {
            setIsViewportSyncing(false);
            return;
          }

          const shellRect = shell.getBoundingClientRect();
          const canvasRect = canvas.getBoundingClientRect();
          const isSynced =
            Math.abs(shellRect.width - canvasRect.width) < 1 &&
            Math.abs(shellRect.height - canvasRect.height) < 1;

          if (isSynced || syncCheckCount > 30) {
            setIsViewportSyncing(false);
            return;
          }

          syncCheckCount += 1;
          syncAnimationFrame = window.requestAnimationFrame(waitForCanvasSync);
        };

        syncAnimationFrame = window.requestAnimationFrame(waitForCanvasSync);
      }, 120);
    };

    updateScale(true);
    const observer = new ResizeObserver(() => updateScale());
    observer.observe(frame);
    return () => {
      observer.disconnect();
      if (resizeSettledTimer !== undefined) {
        window.clearTimeout(resizeSettledTimer);
      }
      if (syncAnimationFrame !== undefined) {
        window.cancelAnimationFrame(syncAnimationFrame);
      }
    };
  }, [usesFixedPage]);

  useEffect(() => {
    if (!exportRequestId || !usesFixedPage) return;

    let cancelled = false;
    setIsExporting(true);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;

        const frame = frameReference.current;
        const pageElement = frame?.querySelector<HTMLElement>(
          ".stage-react-exam-page",
        );
        const webglCanvas = frame?.querySelector<HTMLCanvasElement>(
          "canvas.stage-canvas, .stage-canvas canvas, canvas",
        );
        if (!pageElement || !webglCanvas) {
          setIsExporting(false);
          return;
        }

        exportPageImage({
          pageElement,
          webglCanvas,
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          pageZoom,
          stagePageScale,
        })
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            setIsExporting(false);
          });
      });
    });

    return () => {
      cancelled = true;
      setIsExporting(false);
    };
  }, [exportRequestId, pageZoom, stagePageScale, usesFixedPage]);

  useEffect(() => {
    if (!comparisonExportRequestId || !usesFixedPage) return;

    let cancelled = false;
    setIsExporting(true);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;

        const frame = frameReference.current;
        const pageElement = frame?.querySelector<HTMLElement>(
          ".stage-react-exam-page",
        );
        const webglCanvas = frame?.querySelector<HTMLCanvasElement>(
          "canvas.stage-canvas, .stage-canvas canvas, canvas",
        );
        if (!pageElement || !webglCanvas) {
          setIsExporting(false);
          return;
        }

        downloadClientPageExportComparison({
          pageElement,
          webglCanvas,
          width: PAGE_WIDTH,
          height: PAGE_HEIGHT,
          pageZoom,
          stagePageScale,
          editorState: {
            strokes: sceneProperties.strokes,
            objects: sceneProperties.objects,
          },
        })
          .catch((error) => {
            console.error(error);
          })
          .finally(() => {
            setIsExporting(false);
          });
      });
    });

    return () => {
      cancelled = true;
      setIsExporting(false);
    };
  }, [comparisonExportRequestId, pageZoom, stagePageScale, usesFixedPage]);

  return (
    <section className="stage">
      <div className="stage-topbar" aria-hidden="true">
        <div className="stage-status-chip">
          <strong>문제 풀기 -</strong>
          <span>
            ( {visibleExamNumber} / {examPresets.length} )
          </span>
        </div>
      </div>
      <div
        ref={frameReference}
        className={[
          "stage-canvas-frame",
          usesFixedPage ? "is-fixed-page" : "",
          shouldPassPointerToQuestion ? "is-question-interactive" : "",
          isViewportSyncing ? "is-viewport-syncing" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={canvasFrameStyle}
      >
        <div
          className={
            usesFixedPage
              ? "stage-page-scale-box"
              : "stage-page-scale-box is-fluid"
          }
        >
          <div className="stage-canvas-shell">
            {questionContent ? (
              <div className="stage-react-exam-layer">
                <div className="stage-react-exam-page">{questionContent}</div>
              </div>
            ) : undefined}
            <div
              className={
                isInkPassive ? "stage-ink-layer is-passive" : "stage-ink-layer"
              }
              style={isInkPassive ? { pointerEvents: "none" } : undefined}
            >
              <Canvas
                className="stage-canvas stage-ink-canvas"
                dpr={[1, 2]}
                gl={{ alpha: true, preserveDrawingBuffer: true }}
                style={isInkPassive ? { pointerEvents: "none" } : undefined}
              >
                {isInkPassive ? undefined : <PerformanceMonitor />}
                <OrthographicCamera
                  makeDefault
                  position={[0, 0, 7]}
                  zoom={120}
                  near={0.1}
                  far={100}
                />
                {questionContent ? undefined : (
                  <color attach="background" args={["#ffffff"]} />
                )}
                <ambientLight intensity={1.4} />
                <Suspense fallback={undefined}>
                  <EditorScene
                    {...sceneProperties}
                    readonly={isInkPassive || sceneProperties.readonly}
                    hideEditorChrome={isInkPassive || isExporting}
                    renderSceneBackground={!questionContent}
                    viewportLocked={usesFixedPage}
                  />
                </Suspense>
              </Canvas>
            </div>
            {shouldCaptureInkInput ? (
              <div
                ref={inputCaptureReference}
                className="stage-input-capture"
                aria-hidden="true"
              />
            ) : undefined}
          </div>
        </div>
      </div>
      <ExamLibraryOverlay
        presets={examPresets}
        activePresetId={activeExamPresetId}
        onSelectPreset={onSelectExamPreset}
      />
      {showPencilReport ? (
        <aside className="pencil-report-panel">
          <div className="pencil-report-header">
            <strong>실기기 필기 리포트</strong>
            <span>{isPencilReportRecording ? "recording" : "ready"}</span>
          </div>
          <label className="pencil-report-field">
            <span>기기/펜</span>
            <select
              value={pencilReportDevice}
              onChange={(event) => setPencilReportDevice(event.target.value)}
              disabled={isPencilReportRecording}
            >
              <option>iPad + Apple Pencil</option>
              <option>Windows + Wacom</option>
              <option>Galaxy Tab + S Pen</option>
            </select>
          </label>
          <div className="pencil-report-grid">
            <span>문구</span>
            <strong>안녕하세요</strong>
            <span>strokes</span>
            <strong>{sceneProperties.strokes.length}</strong>
            <span>secure</span>
            <strong>
              {typeof window === "undefined"
                ? "n/a"
                : String(window.isSecureContext)}
            </strong>
          </div>
          <div className="pencil-report-actions">
            <button
              type="button"
              onClick={startPencilReport}
              disabled={isPencilReportRecording}
            >
              Start
            </button>
            <button
              type="button"
              onClick={finishPencilReport}
              disabled={!isPencilReportRecording}
            >
              Finish & Download
            </button>
          </div>
          <p>
            Start를 누른 뒤 캔버스에 <strong>안녕하세요</strong>를 쓰고 Finish를
            누르면 Markdown/JSON 리포트가 저장됩니다.
          </p>
          {pencilReportResult ? (
            <textarea
              readOnly
              value={pencilReportResult}
              aria-label="생성된 펜슬 입력 리포트"
            />
          ) : undefined}
        </aside>
      ) : undefined}
    </section>
  );
}
