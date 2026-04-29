import {
  ChevronsDown,
  ChevronsUp,
  Download,
  Eraser,
  GripVertical,
  Hand,
  ImagePlus,
  Keyboard,
  MousePointer2,
  PenLine,
  Redo2,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useRef, useState } from "react";
import type {
  CSSProperties,
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  RefObject,
} from "react";
import type { Tool } from "../../types/editor";

type EditorToolbarProps = {
  tool: Tool;
  readonly: boolean;
  penColor: string;
  penSize: number;
  imageInputRef: RefObject<HTMLInputElement>;
  onToolChange: (tool: Tool) => void;
  onPenColorChange: (color: string) => void;
  onPenSizeChange: (size: number) => void;
  onAddText: () => void;
  onAddImage: () => void;
  onImageFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onExportComparisonImages: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onToggleReadonly: () => void;
  onDeleteSelection: () => void;
  onClearAll: () => void;
  onBringForward: () => void;
  onSendBackward: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const PRESET_PEN_COLORS = [
  "#202020",
  "#3f5561",
  "#d64e5f",
  "#ddb820",
  "#2f9b4a",
  "#2878b9",
];

const PEN_SIZE_OPTIONS = [
  { label: "가는 펜", value: 2.2, width: 18, height: 1 },
  { label: "기본 펜", value: 3.5, width: 24, height: 2 },
  { label: "굵은 펜", value: 5.2, width: 30, height: 3 },
];

const TOOL_TAB_DRAG_LIMIT = {
  minX: -360,
  maxX: 360,
  minY: -24,
  maxY: 260,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function EditorToolbar({
  tool,
  readonly,
  penColor,
  penSize,
  imageInputRef,
  onToolChange,
  onPenColorChange,
  onPenSizeChange,
  onAddText,
  onAddImage,
  onImageFileChange,
  onExportComparisonImages,
  onZoomIn,
  onZoomOut,
  onToggleReadonly,
  onDeleteSelection,
  onClearAll,
  onBringForward,
  onSendBackward,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: EditorToolbarProps) {
  const [toolTabOffset, setToolTabOffset] = useState({ x: 0, y: 0 });
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const handleToolTabDragStart = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: toolTabOffset.x,
      originY: toolTabOffset.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleToolTabDragMove = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    setToolTabOffset({
      x: clamp(
        dragState.originX + event.clientX - dragState.startX,
        TOOL_TAB_DRAG_LIMIT.minX,
        TOOL_TAB_DRAG_LIMIT.maxX,
      ),
      y: clamp(
        dragState.originY + event.clientY - dragState.startY,
        TOOL_TAB_DRAG_LIMIT.minY,
        TOOL_TAB_DRAG_LIMIT.maxY,
      ),
    });
  };

  const handleToolTabDragEnd = (
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  };

  const toolTabStyle = {
    "--tool-tab-x": `${toolTabOffset.x}px`,
    "--tool-tab-y": `${toolTabOffset.y}px`,
  } as CSSProperties;

  return (
    <header className="whiteboard-toolbar">
      <div className="lesson-header-left">
        <strong className="lesson-title">학습하기</strong>
        <span className="lesson-divider" />
      </div>
      <input
        ref={imageInputRef}
        className="file-input"
        type="file"
        accept="image/*"
        onChange={onImageFileChange}
      />
      <div
        className="editor-tool-stack"
        style={toolTabStyle}
        aria-label="손필기 도구 탭"
      >
        <div className="handwriting-tool-tab">
          <button
            className="tool-tab-drag-handle"
            type="button"
            aria-label="손필기 도구 탭 이동"
            title="드래그로 이동, 더블클릭으로 원위치"
            onPointerDown={handleToolTabDragStart}
            onPointerMove={handleToolTabDragMove}
            onPointerUp={handleToolTabDragEnd}
            onPointerCancel={handleToolTabDragEnd}
            onLostPointerCapture={() => {
              dragStateRef.current = null;
            }}
            onDoubleClick={() => setToolTabOffset({ x: 0, y: 0 })}
          >
            <GripVertical size={16} />
          </button>
          <div className="tool-tab-group edit-history-group">
            <ToolButton label="되돌리기" disabled={!canUndo} onClick={onUndo}>
              <Undo2 size={18} />
            </ToolButton>
            <ToolButton label="다시 실행" disabled={!canRedo} onClick={onRedo}>
              <Redo2 size={18} />
            </ToolButton>
            <ToolButton label="선택 삭제" onClick={onDeleteSelection}>
              <Trash2 size={18} />
            </ToolButton>
          </div>

          <span className="toolbar-separator" />

          <div className="tool-tab-group layer-group" aria-label="레이어 순서">
            <ToolButton label="맨 앞으로" onClick={onBringForward}>
              <ChevronsUp size={18} />
            </ToolButton>
            <ToolButton label="맨 뒤로" onClick={onSendBackward}>
              <ChevronsDown size={18} />
            </ToolButton>
          </div>

          <span className="toolbar-separator" />

          <div className="tool-tab-group">
            <ToolButton
              active={tool === "answer"}
              label="답안 입력"
              onClick={() => onToolChange("answer")}
            >
              <Keyboard size={18} />
            </ToolButton>
            <ToolButton
              active={tool === "pan"}
              label="손툴"
              onClick={() => onToolChange("pan")}
            >
              <Hand size={18} />
            </ToolButton>
            <ToolButton
              active={tool === "select"}
              label="선택"
              onClick={() => onToolChange("select")}
            >
              <MousePointer2 size={18} />
            </ToolButton>
            <ToolButton
              active={tool === "pen"}
              label="펜"
              onClick={() => onToolChange("pen")}
            >
              <PenLine size={18} />
            </ToolButton>
            <ToolButton
              active={tool === "erase"}
              label="지우개"
              onClick={() => onToolChange("erase")}
            >
              <Eraser size={18} />
            </ToolButton>
          </div>

          <span className="toolbar-separator" />

          <div className="tool-tab-group color-group" aria-label="색상">
            {PRESET_PEN_COLORS.map((color) => (
              <button
                key={color}
                className={
                  penColor.toLowerCase() === color
                    ? "palette-swatch active"
                    : "palette-swatch"
                }
                style={{ backgroundColor: color }}
                type="button"
                aria-label={`${color} 색상`}
                title={`${color} 색상`}
                onClick={() => onPenColorChange(color)}
              />
            ))}
            <label className="color-picker-wrap" title="사용자 색상 선택">
              <input
                className="color-picker-input"
                type="color"
                value={penColor}
                onChange={(event) => onPenColorChange(event.target.value)}
                aria-label="사용자 색상"
              />
            </label>
          </div>

          <span className="toolbar-separator" />

          <div className="tool-tab-group size-group" aria-label="펜 굵기">
            {PEN_SIZE_OPTIONS.map((option) => (
              <button
                key={option.value}
                className={
                  penSize === option.value
                    ? "stroke-size-button active"
                    : "stroke-size-button"
                }
                type="button"
                aria-label={option.label}
                title={option.label}
                onClick={() => onPenSizeChange(option.value)}
              >
                <span style={{ width: option.width, height: option.height }} />
              </button>
            ))}
          </div>

          <span className="toolbar-separator" />

          <div className="tool-tab-group">
            <ToolButton label="텍스트 추가" onClick={onAddText}>
              <Type size={18} />
            </ToolButton>
            <ToolButton label="이미지 추가" onClick={onAddImage}>
              <ImagePlus size={18} />
            </ToolButton>
            <ToolButton label="비교 이미지 저장" onClick={onExportComparisonImages}>
              <Download size={18} />
            </ToolButton>
            <ToolButton label="축소" onClick={onZoomOut}>
              <ZoomOut size={18} />
            </ToolButton>
            <ToolButton label="확대" onClick={onZoomIn}>
              <ZoomIn size={18} />
            </ToolButton>
          </div>
        </div>
      </div>
    </header>
  );
}

function ToolButton({
  active = false,
  disabled = false,
  label,
  children,
  onClick,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={active ? "icon-button active" : "icon-button"}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
