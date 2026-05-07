import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { Stroke, WebGLObject } from "../types/editor";
import { ExamPresentation } from "../components/exam/ExamPresentation";
import { EditorDebugPanel } from "../components/editor/debug/EditorDebugPanel";
import { RealtimeInkDebugPanel } from "../components/editor/debug/RealtimeInkDebugPanel";
import { EditorStage } from "../components/editor/EditorStage";
import { EditorToolbar } from "../components/editor/EditorToolbar";
import { reactExams } from "../data/reactExams";
import useEditorState from "../hooks/useEditorState";
import useRealtimeInk from "../hooks/useRealtimeInk";
import { PAGE_BOUNDS } from "../lib/pageGeometry";

type ClampRange = {
  min: number;
  max: number;
};

function clamp(value: number, range: ClampRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

function EditorPage(): JSX.Element {
  const editor = useEditorState(PAGE_BOUNDS);
  const realtimeInk = useRealtimeInk();
  const [pageZoom, setPageZoom] = useState(1);
  const [comparisonExportRequestId, setComparisonExportRequestId] = useState(0);
  const activeReactExam =
    reactExams.find((exam) => exam.id === editor.activeExamPresetId) ??
    reactExams[0];
  const visibleStrokes = useMemo(
    () =>
      realtimeInk.enabled
        ? [
            ...editor.strokes,
            ...realtimeInk.remoteFinalStrokes,
            ...realtimeInk.remoteStrokes,
          ]
        : editor.strokes,
    [
      editor.strokes,
      realtimeInk.enabled,
      realtimeInk.remoteFinalStrokes,
      realtimeInk.remoteStrokes,
    ],
  );
  const visibleObjects = useMemo(
    () =>
      realtimeInk.enabled
        ? [...editor.objects, ...realtimeInk.remoteObjects]
        : editor.objects,
    [editor.objects, realtimeInk.enabled, realtimeInk.remoteObjects],
  );
  const localRealtimeObjectIdsRef = useRef<Set<string>>(new Set());
  const committedObjectSnapshotsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!realtimeInk.enabled || editor.objects.length === 0) return;

    const nextObjects = editor.objects.filter((object) => {
      if (!localRealtimeObjectIdsRef.current.has(object.id)) return false;
      const nextSnapshot = JSON.stringify(object);
      if (committedObjectSnapshotsRef.current.get(object.id) === nextSnapshot) {
        return false;
      }
      committedObjectSnapshotsRef.current.set(object.id, nextSnapshot);
      return true;
    });

    if (nextObjects.length > 0) {
      realtimeInk.commitObjects(nextObjects);
    }
  }, [editor.objects, realtimeInk]);

  const handleAddText = useCallback(() => {
    const object = editor.addText();
    if (!object) return;
    localRealtimeObjectIdsRef.current.add(object.id);
    committedObjectSnapshotsRef.current.set(object.id, JSON.stringify(object));
    realtimeInk.commitObjects([object]);
  }, [editor, realtimeInk]);
  const handleImageFileChange = useCallback(
    (event: Parameters<typeof editor.addImageFromFile>[0]) => {
      editor.addImageFromFile(event, (object) => {
        localRealtimeObjectIdsRef.current.add(object.id);
        committedObjectSnapshotsRef.current.set(
          object.id,
          JSON.stringify(object),
        );
        realtimeInk.commitObjects([object]);
      });
    },
    [editor, realtimeInk],
  );
  const handleToolChange = (nextTool: typeof editor.tool): void => {
    if (editor.editingText) {
      editor.commitTextEdit();
    }

    editor.setTool(nextTool);
    editor.setDragState(undefined);
    editor.setResizeState(undefined);
    editor.setRotateState(undefined);

    if (nextTool !== "select") {
      editor.setSelection(undefined);
      editor.setGroupSelection([]);
    }
  };
  const handleBeginStroke = useCallback(
    (point: Parameters<typeof editor.beginStroke>[0]) => {
      editor.beginStroke(point);
      realtimeInk.beginStroke(point, {
        color: editor.penColor,
        size: editor.penSize,
      });
    },
    [editor, realtimeInk],
  );
  const handleAppendStrokePoint = useCallback(
    (pointOrPoints: Parameters<typeof editor.appendStrokePoint>[0]) => {
      editor.appendStrokePoint(pointOrPoints);
      realtimeInk.appendStrokePoints(pointOrPoints);
    },
    [editor, realtimeInk],
  );
  const handleEndStroke = useCallback(() => {
    editor.endStroke();
    realtimeInk.endStroke();
  }, [editor, realtimeInk]);

  return (
    <main className="whiteboard-shell">
      <EditorToolbar
        tool={editor.tool}
        readonly={editor.readonly}
        penColor={editor.activeColor}
        textFontFamily={editor.activeTextFontFamily}
        textFontSize={editor.activeTextFontSize}
        penSize={editor.penSize}
        imageInputRef={editor.imageInputRef as RefObject<HTMLInputElement>}
        onToolChange={handleToolChange}
        onPenColorChange={editor.applyColor}
        onTextFontFamilyChange={editor.applyTextFontFamily}
        onTextFontSizeChange={editor.applyTextFontSize}
        onPenSizeChange={editor.setPenSize}
        onAddText={handleAddText}
        onAddImage={editor.addImage}
        onImageFileChange={handleImageFileChange}
        onExportComparisonImages={() =>
          setComparisonExportRequestId((value) => value + 1)
        }
        onZoomIn={() =>
          setPageZoom((value) => clamp(value * 1.2, { min: 0.5, max: 3 }))
        }
        onZoomOut={() =>
          setPageZoom((value) => clamp(value / 1.2, { min: 0.5, max: 3 }))
        }
        onToggleReadonly={() => editor.setReadonly((value) => !value)}
        onDeleteSelection={editor.deleteSelection}
        onClearAll={editor.clearAll}
        onBringForward={editor.bringForward}
        onSendBackward={editor.sendBackward}
        onUndo={editor.undo}
        onRedo={editor.redo}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
      />

      {realtimeInk.enabled ? (
        <RealtimeInkDebugPanel
          status={realtimeInk.status}
          draftCount={realtimeInk.remoteStrokes.length}
          yjsDebug={realtimeInk.yjsDebug}
          actorRole={realtimeInk.actorRole}
          actorId={realtimeInk.actorId}
          roomId={realtimeInk.roomId}
        />
      ) : null}

      <EditorStage
        tool={editor.tool}
        readonly={editor.readonly}
        strokes={visibleStrokes}
        objects={visibleObjects}
        activeStrokeId={editor.activeStrokeId as string | undefined}
        selection={editor.selection}
        groupSelection={editor.groupSelection}
        dragState={editor.dragState}
        resizeState={editor.resizeState}
        rotateState={editor.rotateState}
        editingText={editor.editingText}
        zoomCommand={undefined}
        drawingBounds={PAGE_BOUNDS}
        pageZoom={pageZoom}
        comparisonExportRequestId={comparisonExportRequestId}
        examPresets={editor.examPresets}
        activeExamPresetId={editor.activeExamPresetId as string | undefined}
        questionContent={<ExamPresentation exam={activeReactExam} />}
        onSelectExamPreset={editor.selectExamPreset}
        onSelectionChange={editor.setSelection}
        onGroupSelectionChange={editor.setGroupSelection}
        onDragStateChange={editor.setDragState}
        onResizeStateChange={editor.setResizeState}
        onRotateStateChange={editor.setRotateState}
        onBeginStroke={handleBeginStroke}
        onAppendStrokePoint={handleAppendStrokePoint}
        onEndStroke={handleEndStroke}
        onMoveStroke={editor.moveStroke}
        onMoveObject={editor.moveObject}
        onMoveGroup={editor.moveGroup}
        onResizeObject={editor.resizeObject}
        onResizeStroke={editor.resizeStroke}
        onRotateObject={editor.rotateObject}
        onRotateStroke={editor.rotateStroke}
        onRotateGroup={editor.rotateGroup}
        onResizeGroup={editor.resizeGroup}
        onEraseStroke={editor.eraseStroke}
        onStartTextEdit={editor.startTextEdit}
        onUpdateTextEdit={editor.updateTextEdit}
        onTextEditKeyDown={editor.handleTextEditKeyDown}
        onCommitTextEdit={editor.commitTextEdit}
      />

      <EditorDebugPanel
        selectedObject={editor.selectedObject as WebGLObject | undefined}
        selectedStroke={editor.selectedStroke as Stroke | undefined}
        onUpdateObject={editor.updateObject}
        onUpdateStroke={editor.updateStroke}
      />
    </main>
  );
}

export default EditorPage;
