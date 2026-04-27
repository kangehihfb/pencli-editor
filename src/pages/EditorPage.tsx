import { EditorStage } from "../components/editor/EditorStage";
import { EditorToolbar } from "../components/editor/EditorToolbar";
import { EditorDebugPanel } from "../components/editor/debug/EditorDebugPanel";
import { useEditorState } from "../hooks/useEditorState";

export function EditorPage() {
  const editor = useEditorState();

  return (
    <main className="whiteboard-shell">
      <EditorToolbar
        tool={editor.tool}
        readonly={editor.readonly}
        penColor={editor.penColor}
        penSize={editor.penSize}
        imageInputRef={editor.imageInputRef}
        onToolChange={editor.setTool}
        onPenColorChange={editor.setPenColor}
        onPenSizeChange={editor.setPenSize}
        onAddText={editor.addText}
        onAddImage={editor.addImage}
        onImageFileChange={editor.addImageFromFile}
        onZoomIn={() => editor.requestZoom(1.2)}
        onZoomOut={() => editor.requestZoom(1 / 1.2)}
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
        zoomCommand={editor.zoomCommand}
        drawingBounds={editor.drawingBounds}
        examPresets={editor.examPresets}
        activeExamPresetId={editor.activeExamPresetId}
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
