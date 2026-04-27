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
  const [exportRequestId, setExportRequestId] = useState(0);
  const handleToolChange = (nextTool: typeof editor.tool) => {
    editor.setTool(nextTool);

    if (nextTool === "answer") {
      editor.setSelection(null);
      editor.setGroupSelection([]);
      editor.setDragState(null);
      editor.setResizeState(null);
    }
  };

  return (
    <main className="whiteboard-shell">
      <EditorToolbar
        tool={editor.tool}
        readonly={editor.readonly}
        penColor={editor.penColor}
        penSize={editor.penSize}
        imageInputRef={editor.imageInputRef}
        onToolChange={handleToolChange}
        onPenColorChange={editor.setPenColor}
        onPenSizeChange={editor.setPenSize}
        onAddText={editor.addText}
        onAddImage={editor.addImage}
        onImageFileChange={editor.addImageFromFile}
        onExportImage={() => setExportRequestId((value) => value + 1)}
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
        selection={editor.selection}
        groupSelection={editor.groupSelection}
        dragState={editor.dragState}
        resizeState={editor.resizeState}
        editingText={editor.editingText}
        zoomCommand={null}
        drawingBounds={PAGE_BOUNDS}
        pageZoom={pageZoom}
        exportRequestId={exportRequestId}
        examPresets={editor.examPresets}
        activeExamPresetId={editor.activeExamPresetId}
        questionContent={<ExamPresentation exam={reactExams[0]} />}
        onSelectExamPreset={editor.selectExamPreset}
        onSelectionChange={editor.setSelection}
        onGroupSelectionChange={editor.setGroupSelection}
        onDragStateChange={editor.setDragState}
        onResizeStateChange={editor.setResizeState}
        onBeginStroke={editor.beginStroke}
        onAppendStrokePoint={editor.appendStrokePoint}
        onEndStroke={editor.endStroke}
        onMoveStroke={editor.moveStroke}
        onMoveObject={editor.moveObject}
        onMoveGroup={editor.moveGroup}
        onResizeObject={editor.resizeObject}
        onResizeStroke={editor.resizeStroke}
        onResizeGroup={editor.resizeGroup}
        onEraseStroke={editor.eraseStroke}
        onStartTextEdit={editor.startTextEdit}
        onTextEditChange={editor.updateTextEdit}
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
