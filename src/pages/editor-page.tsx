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

function getSelectionTargets(
  selection: ReturnType<typeof useEditorState>["selection"],
  groupSelection: ReturnType<typeof useEditorState>["groupSelection"],
) {
  if (groupSelection.length > 0) return groupSelection;
  return selection ? [selection] : [];
}

function isDeleteKey(event: KeyboardEvent): boolean {
  return event.key === "Delete" || event.key === "Backspace";
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLButtonElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function clamp(value: number, range: ClampRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

function EditorPage(): JSX.Element {
  const realtimeInk = useRealtimeInk();
  const sharedMaxLayer = useMemo(
    () =>
      realtimeInk.enabled
        ? Math.max(
            0,
            ...realtimeInk.sharedStrokes.map((stroke) => stroke.layer),
            ...realtimeInk.sharedObjects.map((object) => object.layer),
          )
        : 0,
    [
      realtimeInk.enabled,
      realtimeInk.sharedObjects,
      realtimeInk.sharedStrokes,
    ],
  );
  const editor = useEditorState(PAGE_BOUNDS, { sharedMaxLayer });
  const [pageZoom, setPageZoom] = useState(1);
  const [comparisonExportRequestId, setComparisonExportRequestId] = useState(0);
  const activeReactExam =
    reactExams.find((exam) => exam.id === editor.activeExamPresetId) ??
    reactExams[0];
  const sharedStrokeIds = useMemo(
    () => new Set(realtimeInk.sharedStrokes.map((stroke) => stroke.id)),
    [realtimeInk.sharedStrokes],
  );
  const sharedObjectIds = useMemo(
    () => new Set(realtimeInk.sharedObjects.map((object) => object.id)),
    [realtimeInk.sharedObjects],
  );
  const visibleStrokes = useMemo(
    () =>
      realtimeInk.enabled
        ? [
            ...realtimeInk.sharedStrokes,
            ...editor.strokes.filter(
              (stroke) => !sharedStrokeIds.has(stroke.id),
            ),
            ...realtimeInk.remoteStrokes.filter(
              (stroke) => !sharedStrokeIds.has(stroke.id),
            ),
          ]
        : editor.strokes,
    [
      editor.strokes,
      realtimeInk.enabled,
      realtimeInk.remoteStrokes,
      realtimeInk.sharedStrokes,
      sharedStrokeIds,
    ],
  );
  const visibleObjects = useMemo(
    () =>
      realtimeInk.enabled
        ? [
            ...realtimeInk.sharedObjects,
            ...editor.objects.filter(
              (object) => !sharedObjectIds.has(object.id),
            ),
          ]
        : editor.objects,
    [
      editor.objects,
      realtimeInk.enabled,
      realtimeInk.sharedObjects,
      sharedObjectIds,
    ],
  );
  const localRealtimeStrokeIdsRef = useRef<Set<string>>(new Set());
  const committedStrokeSnapshotsRef = useRef<Map<string, string>>(new Map());
  const activeLocalStrokeIdRef = useRef<string | undefined>();
  const localRealtimeObjectIdsRef = useRef<Set<string>>(new Set());
  const committedObjectSnapshotsRef = useRef<Map<string, string>>(new Map());
  const previousSharedStrokeIdsRef = useRef<Set<string>>(new Set());
  const previousSharedObjectIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!realtimeInk.enabled) return;

    const currentStrokeIds = new Set(
      editor.strokes.map((stroke) => stroke.id),
    );
    const deletedStrokeIds = Array.from(
      localRealtimeStrokeIdsRef.current,
    ).filter((strokeId) => !currentStrokeIds.has(strokeId));
    const nextStrokes = editor.strokes.filter((stroke) => {
      if (!localRealtimeStrokeIdsRef.current.has(stroke.id)) return false;
      const nextSnapshot = JSON.stringify(stroke);
      if (committedStrokeSnapshotsRef.current.get(stroke.id) === nextSnapshot) {
        return false;
      }
      committedStrokeSnapshotsRef.current.set(stroke.id, nextSnapshot);
      return true;
    });

    if (deletedStrokeIds.length > 0) {
      realtimeInk.deleteStrokes(deletedStrokeIds);
      for (const strokeId of deletedStrokeIds) {
        localRealtimeStrokeIdsRef.current.delete(strokeId);
        committedStrokeSnapshotsRef.current.delete(strokeId);
      }
    }

    for (const stroke of nextStrokes) {
      realtimeInk.commitStroke(stroke);
    }
  }, [editor.strokes, realtimeInk]);

  useEffect(() => {
    if (!realtimeInk.enabled) return;

    const currentObjectIds = new Set(
      editor.objects.map((object) => object.id),
    );
    const deletedObjectIds = Array.from(
      localRealtimeObjectIdsRef.current,
    ).filter((objectId) => !currentObjectIds.has(objectId));
    const nextObjects = editor.objects.filter((object) => {
      if (!localRealtimeObjectIdsRef.current.has(object.id)) return false;
      const nextSnapshot = JSON.stringify(object);
      if (committedObjectSnapshotsRef.current.get(object.id) === nextSnapshot) {
        return false;
      }
      committedObjectSnapshotsRef.current.set(object.id, nextSnapshot);
      return true;
    });

    if (deletedObjectIds.length > 0) {
      realtimeInk.deleteObjects(deletedObjectIds);
      for (const objectId of deletedObjectIds) {
        localRealtimeObjectIdsRef.current.delete(objectId);
        committedObjectSnapshotsRef.current.delete(objectId);
      }
    }

    if (nextObjects.length > 0) {
      realtimeInk.commitObjects(nextObjects);
    }
  }, [editor.objects, realtimeInk]);

  useEffect(() => {
    if (!realtimeInk.enabled) {
      previousSharedStrokeIdsRef.current = new Set();
      previousSharedObjectIdsRef.current = new Set();
      return;
    }

    const removedLocalStrokeIds = Array.from(
      localRealtimeStrokeIdsRef.current,
    ).filter(
      (strokeId) =>
        previousSharedStrokeIdsRef.current.has(strokeId) &&
        !sharedStrokeIds.has(strokeId),
    );
    const removedLocalObjectIds = Array.from(
      localRealtimeObjectIdsRef.current,
    ).filter(
      (objectId) =>
        previousSharedObjectIdsRef.current.has(objectId) &&
        !sharedObjectIds.has(objectId),
    );

    if (removedLocalStrokeIds.length > 0 || removedLocalObjectIds.length > 0) {
      editor.removeElementsById(removedLocalStrokeIds, removedLocalObjectIds);

      for (const strokeId of removedLocalStrokeIds) {
        localRealtimeStrokeIdsRef.current.delete(strokeId);
        committedStrokeSnapshotsRef.current.delete(strokeId);
      }
      for (const objectId of removedLocalObjectIds) {
        localRealtimeObjectIdsRef.current.delete(objectId);
        committedObjectSnapshotsRef.current.delete(objectId);
      }
    }

    previousSharedStrokeIdsRef.current = new Set(sharedStrokeIds);
    previousSharedObjectIdsRef.current = new Set(sharedObjectIds);
  }, [
    editor,
    realtimeInk.enabled,
    sharedObjectIds,
    sharedStrokeIds,
  ]);

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
      const stroke = editor.beginStroke(point);
      if (!stroke) return;
      activeLocalStrokeIdRef.current = stroke.id;
      realtimeInk.beginStroke(point, {
        color: editor.penColor,
        size: editor.penSize,
        layer: stroke.layer,
      }, stroke.id);
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
    const strokeId = activeLocalStrokeIdRef.current;
    if (strokeId) {
      localRealtimeStrokeIdsRef.current.add(strokeId);
      activeLocalStrokeIdRef.current = undefined;
    }
    realtimeInk.endStroke();
  }, [editor, realtimeInk]);
  const deleteSharedSelection = useCallback(() => {
    if (!realtimeInk.enabled) return;

    const targets = getSelectionTargets(
      editor.selection,
      editor.groupSelection,
    );
    if (targets.length === 0) return;

    const strokeIds = targets
      .filter((item) => item.type === "stroke")
      .map((item) => item.id)
      .filter((id) => sharedStrokeIds.has(id));
    const objectIds = targets
      .filter((item) => item.type === "object")
      .map((item) => item.id)
      .filter((id) => sharedObjectIds.has(id));

    if (strokeIds.length > 0) {
      realtimeInk.deleteStrokes(strokeIds);
    }
    if (objectIds.length > 0) {
      realtimeInk.deleteObjects(objectIds);
    }
  }, [
    editor.groupSelection,
    editor.selection,
    realtimeInk,
    sharedObjectIds,
    sharedStrokeIds,
  ]);
  const handleDeleteSelection = useCallback(() => {
    deleteSharedSelection();
    editor.deleteSelection();
  }, [deleteSharedSelection, editor]);

  useEffect(() => {
    if (!realtimeInk.enabled) return undefined;

    const handleSharedDeleteKey = (event: globalThis.KeyboardEvent): void => {
      if (!isDeleteKey(event)) return;
      if (editor.editingText) return;
      if (isEditableTarget(event.target)) return;
      deleteSharedSelection();
    };

    window.addEventListener("keydown", handleSharedDeleteKey, {
      capture: true,
    });
    return () => {
      window.removeEventListener("keydown", handleSharedDeleteKey, {
        capture: true,
      });
    };
  }, [deleteSharedSelection, editor.editingText, realtimeInk.enabled]);

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
        onDeleteSelection={handleDeleteSelection}
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
