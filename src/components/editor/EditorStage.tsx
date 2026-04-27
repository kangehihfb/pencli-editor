import { OrthographicCamera } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import type { CSSProperties, ReactNode } from "react";
import type { ExamPreset } from "../../data/examPresets";
import { EditorScene } from "./scene/EditorScene";
import type { EditorSceneProps } from "./scene/EditorScene";
import { ExamLibraryOverlay } from "./ExamLibraryOverlay";

const ACTIVE_EXAM_OBJECT_ID = "object_exam_active";

type EditorStageProps = EditorSceneProps & {
  examPresets: ExamPreset[];
  activeExamPresetId: string | null;
  onSelectExamPreset: (presetId: string) => void;
  questionContent?: ReactNode;
};

export function EditorStage({
  examPresets,
  activeExamPresetId,
  onSelectExamPreset,
  questionContent,
  ...sceneProps
}: EditorStageProps) {
  const activeExamIndex = examPresets.findIndex(
    (preset) => preset.id === activeExamPresetId,
  );
  const visibleExamNumber = activeExamIndex >= 0 ? activeExamIndex + 1 : 0;
  const examAspectRatio = sceneProps.drawingBounds
    ? sceneProps.drawingBounds.width / sceneProps.drawingBounds.height
    : 1;
  const canvasFrameStyle = {
    "--exam-aspect": String(examAspectRatio),
  } as CSSProperties;
  const shouldPassPointerToQuestion =
    Boolean(questionContent) && sceneProps.tool === "answer";
  const shouldRenderCanvasOverlay = !shouldPassPointerToQuestion;
  const previewObjects = sceneProps.objects.filter(
    (object) => object.id !== ACTIVE_EXAM_OBJECT_ID,
  );
  const shouldRenderHandwritingPreview =
    shouldPassPointerToQuestion &&
    Boolean(sceneProps.drawingBounds) &&
    (sceneProps.strokes.length > 0 || previewObjects.length > 0);

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
      <div className="stage-canvas-frame" style={canvasFrameStyle}>
        <div className="stage-canvas-shell">
          {questionContent ? (
            <div className="stage-react-exam-layer">
              {questionContent}
            </div>
          ) : null}
          {shouldRenderHandwritingPreview && sceneProps.drawingBounds ? (
            <svg
              className="stage-handwriting-preview"
              viewBox={`${sceneProps.drawingBounds.minX} ${-sceneProps.drawingBounds.maxY} ${sceneProps.drawingBounds.width} ${sceneProps.drawingBounds.height}`}
              aria-hidden="true"
            >
              {previewObjects
                .sort((a, b) => a.layer - b.layer)
                .map((object) => {
                  const x = object.x - object.width / 2;
                  const y = -object.y - object.height / 2;

                  if (object.kind === "image") {
                    return (
                      <image
                        key={object.id}
                        href={object.imageSrc}
                        x={x}
                        y={y}
                        width={object.width}
                        height={object.height}
                        preserveAspectRatio="none"
                      />
                    );
                  }

                  return (
                    <foreignObject
                      key={object.id}
                      x={x}
                      y={y}
                      width={object.width}
                      height={object.height}
                    >
                      <div className="stage-object-preview-text">
                        {object.text}
                      </div>
                    </foreignObject>
                  );
                })}
              {sceneProps.strokes.map((stroke) => (
                <polyline
                  key={stroke.id}
                  points={stroke.points
                    .map((point) => `${point.x},${-point.y}`)
                    .join(" ")}
                  fill="none"
                  stroke={stroke.color}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={stroke.size}
                />
              ))}
            </svg>
          ) : null}
          {shouldRenderCanvasOverlay ? (
            <div className="stage-canvas-overlay">
              <Canvas className="stage-canvas" dpr={[1, 2]} gl={{ alpha: true }}>
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
                  renderSceneBackground={!questionContent}
                />
              </Canvas>
            </div>
          ) : null}
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
