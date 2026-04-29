import { OrthographicCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { ExamPreset } from "../../data/examPresets";
import { exportPageImage } from "../../lib/exportPageImage";
import { downloadClientPageExportComparison } from "../../lib/pageExportMethods";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../../lib/pageGeometry";
import { PerformanceMonitor } from "./PerformanceMonitor";
import { EditorScene } from "./scene/EditorScene";
import type { EditorSceneProps } from "./scene/EditorScene";
import { ExamLibraryOverlay } from "./ExamLibraryOverlay";

type EditorStageProps = EditorSceneProps & {
  examPresets: ExamPreset[];
  activeExamPresetId: string | null;
  onSelectExamPreset: (presetId: string) => void;
  questionContent?: ReactNode;
  pageZoom?: number;
  exportRequestId?: number;
  comparisonExportRequestId?: number;
};

export function EditorStage({
  examPresets,
  activeExamPresetId,
  onSelectExamPreset,
  questionContent,
  pageZoom = 1,
  exportRequestId = 0,
  comparisonExportRequestId = 0,
  ...sceneProps
}: EditorStageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const activeExamIndex = examPresets.findIndex(
    (preset) => preset.id === activeExamPresetId,
  );
  const visibleExamNumber = activeExamIndex >= 0 ? activeExamIndex + 1 : 0;
  const examAspectRatio = sceneProps.drawingBounds
    ? sceneProps.drawingBounds.width / sceneProps.drawingBounds.height
    : 1;
  const usesFixedPage = Boolean(questionContent);
  const stagePageScale = usesFixedPage ? fitScale * pageZoom : 1;
  const canvasFrameStyle = {
    "--exam-aspect": String(usesFixedPage ? PAGE_WIDTH / PAGE_HEIGHT : examAspectRatio),
    "--stage-page-width": `${PAGE_WIDTH}px`,
    "--stage-page-height": `${PAGE_HEIGHT}px`,
    "--stage-page-scale": String(stagePageScale),
  } as CSSProperties;
  const shouldPassPointerToQuestion =
    Boolean(questionContent) &&
    (sceneProps.tool === "answer" || (usesFixedPage && sceneProps.tool === "pan"));
  const isInkPassive = shouldPassPointerToQuestion;

  useEffect(() => {
    if (!usesFixedPage) {
      setFitScale(1);
      return;
    }

    const frame = frameRef.current;
    if (!frame) return;

    const updateScale = () => {
      const rect = frame.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      setFitScale(
        Math.max(
          0.1,
          Math.min(rect.width / PAGE_WIDTH, rect.height / PAGE_HEIGHT),
        ),
      );
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [usesFixedPage]);

  useEffect(() => {
    if (!exportRequestId || !usesFixedPage) return;

    let cancelled = false;
    setIsExporting(true);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;

        const frame = frameRef.current;
        const pageElement = frame?.querySelector<HTMLElement>(".stage-react-exam-page");
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

        const frame = frameRef.current;
        const pageElement = frame?.querySelector<HTMLElement>(".stage-react-exam-page");
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
            strokes: sceneProps.strokes,
            objects: sceneProps.objects,
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
        ref={frameRef}
        className={[
          "stage-canvas-frame",
          usesFixedPage ? "is-fixed-page" : "",
          shouldPassPointerToQuestion ? "is-question-interactive" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        style={canvasFrameStyle}
      >
        <div className={usesFixedPage ? "stage-page-scale-box" : "stage-page-scale-box is-fluid"}>
          <div className="stage-canvas-shell">
            {questionContent ? (
              <div className="stage-react-exam-layer">
                <div className="stage-react-exam-page">
                  {questionContent}
                </div>
              </div>
            ) : null}
            <div
              className={isInkPassive ? "stage-ink-layer is-passive" : "stage-ink-layer"}
              style={isInkPassive ? { pointerEvents: "none" } : undefined}
            >
              <Canvas
                className="stage-canvas stage-ink-canvas"
                dpr={[1, 2]}
                gl={{ alpha: true, preserveDrawingBuffer: true }}
                style={isInkPassive ? { pointerEvents: "none" } : undefined}
              >
                {!isInkPassive ? <PerformanceMonitor /> : null}
                <OrthographicCamera
                  makeDefault
                  position={[0, 0, 7]}
                  zoom={120}
                  near={0.1}
                  far={100}
                />
                {!questionContent ? <color attach="background" args={["#ffffff"]} /> : null}
                <ambientLight intensity={1.4} />
                <EditorScene
                  {...sceneProps}
                  readonly={isInkPassive || sceneProps.readonly}
                  hideEditorChrome={isInkPassive || isExporting}
                  renderSceneBackground={!questionContent}
                  viewportLocked={usesFixedPage}
                />
              </Canvas>
            </div>
          </div>
        </div>
      </div>
      <ExamLibraryOverlay
        presets={examPresets}
        activePresetId={activeExamPresetId}
        onSelectPreset={onSelectExamPreset}
      />
    </section>
  );
}
