import { useState } from "react";
import { ExamPresentation } from "../components/exam/ExamPresentation";
import { EditorDebugPanel } from "../components/editor/debug/EditorDebugPanel";
import { EditorStage } from "../components/editor/EditorStage";
import { EditorToolbar } from "../components/editor/EditorToolbar";
import { reactExams } from "../data/reactExams";
import { useEditorState } from "../hooks/useEditorState";
import { PAGE_BOUNDS } from "../lib/pageGeometry";

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function EditorPage() {
  const editor = useEditorState(PAGE_BOUNDS);
  const [pageZoom, setPageZoom] = useState(1);
  const [comparisonExportRequestId, setComparisonExportRequestId] = useState(0);
  const handleToolChange = (nextTool: typeof editor.tool) => {
    if (editor.editingText) {
      editor.commitTextEdit();
    }

    editor.setTool(nextTool);
    editor.setDragState(null);
    editor.setResizeState(null);
    editor.setRotateState(null);

    if (nextTool !== "select") {
      editor.setSelection(null);
      editor.setGroupSelection([]);
    }
  };

  return (
    <main className="whiteboard-shell">
      <EditorToolbar
        tool={editor.tool}
        readonly={editor.readonly}
        penColor={editor.activeColor}
        textFontFamily={editor.activeTextFontFamily}
        penSize={editor.penSize}
        imageInputRef={editor.imageInputRef}
        onToolChange={handleToolChange}
        onPenColorChange={editor.applyColor}
        onTextFontFamilyChange={editor.applyTextFontFamily}
        onPenSizeChange={editor.setPenSize}
        onAddText={editor.addText}
        onAddImage={editor.addImage}
        onImageFileChange={editor.addImageFromFile}
        onExportComparisonImages={() => setComparisonExportRequestId((value) => value + 1)}
        onZoomIn={() => setPageZoom((value) => clamp(value * 1.2, 0.5, 3))}
        onZoomOut={() => setPageZoom((value) => clamp(value / 1.2, 0.5, 3))}
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

      <EditorStage
        tool={editor.tool}
        readonly={editor.readonly}
        strokes={editor.strokes}
        objects={editor.objects}
        activeStrokeId={editor.activeStrokeId}
        selection={editor.selection}
        groupSelection={editor.groupSelection}
        dragState={editor.dragState}
        resizeState={editor.resizeState}
        rotateState={editor.rotateState}
        editingText={editor.editingText}
        zoomCommand={null}
        drawingBounds={PAGE_BOUNDS}
        pageZoom={pageZoom}
        comparisonExportRequestId={comparisonExportRequestId}
        examPresets={editor.examPresets}
        activeExamPresetId={editor.activeExamPresetId}
        questionContent={<ExamPresentation exam={reactExams[0]} />}
        onSelectExamPreset={editor.selectExamPreset}
        onSelectionChange={editor.setSelection}
        onGroupSelectionChange={editor.setGroupSelection}
        onDragStateChange={editor.setDragState}
        onResizeStateChange={editor.setResizeState}
        onRotateStateChange={editor.setRotateState}
        onBeginStroke={editor.beginStroke}
        onAppendStrokePoint={editor.appendStrokePoint}
        onEndStroke={editor.endStroke}
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
        onTextEditKeyDown={editor.handleTextEditKeyDown}
        onCommitTextEdit={editor.commitTextEdit}
      />

      <EditorDebugPanel
        selectedObject={editor.selectedObject}
        selectedStroke={editor.selectedStroke}
        onUpdateObject={editor.updateObject}
        onUpdateStroke={editor.updateStroke}
      />
    </main>
  );
}
