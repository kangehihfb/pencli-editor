import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type {
  DragState,
  EditingText,
  GroupResizeOrigin,
  Point2D,
  PointBounds,
  ResizeState,
  Selection,
  SelectionItem,
  Stroke,
  Tool,
  WebGLObject,
  ZoomCommand,
} from '../types/editor';
import { examPresets } from '../data/examPresets';
import { getGroupResizeScale, getNextStrokePoints, getObjectBounds, getPointBounds, getSelectionItemsBounds, makeId } from '../lib/sceneMath';

const activeExamObjectId = 'object_exam_active';
const maxHistorySize = 80;

type HistorySnapshot = {
  strokes: Stroke[];
  objects: WebGLObject[];
  activeExamPresetId: string | null;
};

function cloneStrokes(items: Stroke[]) {
  return items.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
  }));
}

function cloneObjects(items: WebGLObject[]) {
  return items.map((object) => ({ ...object }));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampObjectToBounds(object: WebGLObject, bounds: PointBounds) {
  const nextX =
    object.width >= bounds.width
      ? bounds.centerX
      : clamp(object.x, bounds.minX + object.width / 2, bounds.maxX - object.width / 2);
  const nextY =
    object.height >= bounds.height
      ? bounds.centerY
      : clamp(object.y, bounds.minY + object.height / 2, bounds.maxY - object.height / 2);

  return { ...object, x: nextX, y: nextY };
}

function getBoundedDelta(bounds: PointBounds, container: PointBounds, delta: Point2D) {
  const nextDeltaX =
    bounds.width >= container.width
      ? container.centerX - bounds.centerX
      : clamp(delta.x, container.minX - bounds.minX, container.maxX - bounds.maxX);
  const nextDeltaY =
    bounds.height >= container.height
      ? container.centerY - bounds.centerY
      : clamp(delta.y, container.minY - bounds.minY, container.maxY - bounds.maxY);

  return { x: nextDeltaX, y: nextDeltaY };
}

function moveStrokePoints(points: Point2D[], delta: Point2D) {
  return points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));
}

export function useEditorState() {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingExamPresetIdRef = useRef<string | null>(null);
  const undoHistoryRef = useRef<HistorySnapshot[]>([]);
  const redoHistoryRef = useRef<HistorySnapshot[]>([]);
  const [tool, setTool] = useState<Tool>('pen');
  const [penColor, setPenColor] = useState('#183f3a');
  const [penSize, setPenSize] = useState(0.035);
  const [readonly, setReadonly] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [groupSelection, setGroupSelection] = useState<SelectionItem[]>([]);
  const [dragState, setDragState] = useState<DragState>(null);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [editingText, setEditingText] = useState<EditingText>(null);
  const [activeStrokeId, setActiveStrokeId] = useState<string | null>(null);
  const [zoomCommand, setZoomCommand] = useState<ZoomCommand | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [objects, setObjects] = useState<WebGLObject[]>([]);
  const [activeExamPresetId, setActiveExamPresetId] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);

  const maxLayer = Math.max(0, ...strokes.map((stroke) => stroke.layer), ...objects.map((object) => object.layer));
  const activeSelection = selection ?? (groupSelection.length === 1 ? groupSelection[0] : null);
  const selectedObject = activeSelection?.type === 'object' ? objects.find((object) => object.id === activeSelection.id) ?? null : null;
  const selectedStroke = activeSelection?.type === 'stroke' ? strokes.find((stroke) => stroke.id === activeSelection.id) ?? null : null;
  const activeExamObject = objects.find((object) => object.id === activeExamObjectId) ?? null;
  const drawingBounds = activeExamObject ? getObjectBounds(activeExamObject) : null;
  const canUndo = historyRevision >= 0 && undoHistoryRef.current.length > 0;
  const canRedo = historyRevision >= 0 && redoHistoryRef.current.length > 0;

  const createHistorySnapshot = useCallback(
    (): HistorySnapshot => ({
      strokes: cloneStrokes(strokes),
      objects: cloneObjects(objects),
      activeExamPresetId,
    }),
    [activeExamPresetId, objects, strokes],
  );

  const resetInteractionState = useCallback(() => {
    setSelection(null);
    setGroupSelection([]);
    setActiveStrokeId(null);
    setDragState(null);
    setResizeState(null);
    setEditingText(null);
  }, []);

  const restoreHistorySnapshot = useCallback(
    (snapshot: HistorySnapshot) => {
      setStrokes(cloneStrokes(snapshot.strokes));
      setObjects(cloneObjects(snapshot.objects));
      setActiveExamPresetId(snapshot.activeExamPresetId);
      pendingExamPresetIdRef.current = snapshot.activeExamPresetId;
      resetInteractionState();
    },
    [resetInteractionState],
  );

  const recordHistory = useCallback(() => {
    undoHistoryRef.current = [...undoHistoryRef.current.slice(-(maxHistorySize - 1)), createHistorySnapshot()];
    redoHistoryRef.current = [];
    setHistoryRevision((value) => value + 1);
  }, [createHistorySnapshot]);

  const undo = useCallback(() => {
    const snapshot = undoHistoryRef.current.pop();
    if (!snapshot) return;

    redoHistoryRef.current = [...redoHistoryRef.current.slice(-(maxHistorySize - 1)), createHistorySnapshot()];
    restoreHistorySnapshot(snapshot);
    setHistoryRevision((value) => value + 1);
  }, [createHistorySnapshot, restoreHistorySnapshot]);

  const redo = useCallback(() => {
    const snapshot = redoHistoryRef.current.pop();
    if (!snapshot) return;

    undoHistoryRef.current = [...undoHistoryRef.current.slice(-(maxHistorySize - 1)), createHistorySnapshot()];
    restoreHistorySnapshot(snapshot);
    setHistoryRevision((value) => value + 1);
  }, [createHistorySnapshot, restoreHistorySnapshot]);

  const addText = () => {
    if (readonly) return;
    recordHistory();
    const object: WebGLObject = {
      id: makeId('text'),
      kind: 'text',
      x: -0.25,
      y: 0.2,
      width: 1.5,
      height: 0.46,
      layer: maxLayer + 1,
      text: '새 텍스트',
    };
    setObjects((prev) => [...prev, object]);
    setSelection({ type: 'object', id: object.id });
    setGroupSelection([{ type: 'object', id: object.id }]);
    setEditingText({ id: object.id, value: object.text ?? '' });
    setTool('select');
  };

  const addImage = () => {
    if (readonly) return;
    imageInputRef.current?.click();
  };

  const addImageFromFile = (event: ChangeEvent<HTMLInputElement>) => {
    if (readonly) return;
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const imageSrc = URL.createObjectURL(file);
    const addDecodedImage = (aspect: number) => {
      const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.45;
      const width = 1.8;
      recordHistory();
      const object: WebGLObject = {
        id: makeId('image'),
        kind: 'image',
        x: 0,
        y: 0,
        width,
        height: width / safeAspect,
        layer: maxLayer + 1,
        imageSrc,
        imageName: file.name,
      };

      setObjects((prev) => [...prev, object]);
      setSelection({ type: 'object', id: object.id });
      setGroupSelection([{ type: 'object', id: object.id }]);
      setEditingText(null);
      setTool('select');
    };

    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      addDecodedImage(image.naturalWidth / image.naturalHeight);
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageSrc);
    };
    image.src = imageSrc;
  };

  const clearAll = () => {
    if (readonly) return;
    if (strokes.length > 0 || objects.length > 0) {
      recordHistory();
    }
    setStrokes([]);
    setObjects([]);
    setSelection(null);
    setGroupSelection([]);
    setActiveStrokeId(null);
    setActiveExamPresetId(null);
    pendingExamPresetIdRef.current = null;
    setDragState(null);
    setResizeState(null);
    setEditingText(null);
  };

  const deleteSelection = useCallback(() => {
    const targets = groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    if (readonly || targets.length === 0) return;
    const strokeIds = new Set(targets.filter((item) => item.type === 'stroke').map((item) => item.id));
    const objectIds = new Set(targets.filter((item) => item.type === 'object').map((item) => item.id));
    recordHistory();
    if (strokeIds.size > 0) {
      setStrokes((prev) => prev.filter((stroke) => !strokeIds.has(stroke.id)));
    }
    if (objectIds.size > 0) {
      setObjects((prev) => prev.filter((object) => !objectIds.has(object.id)));
    }
    setSelection(null);
    setGroupSelection([]);
    setDragState(null);
    setResizeState(null);
    setEditingText(null);
  }, [groupSelection, readonly, recordHistory, selection]);

  useEffect(() => {
    const handleDeleteKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (editingText) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (groupSelection.length === 0 && !selection) return;

      event.preventDefault();
      deleteSelection();
    };

    window.addEventListener('keydown', handleDeleteKey);
    return () => window.removeEventListener('keydown', handleDeleteKey);
  }, [deleteSelection, editingText, groupSelection.length, selection]);

  const beginStroke = (point: Point2D) => {
    if (readonly) return;
    recordHistory();
    const stroke: Stroke = {
      id: makeId('stroke'),
      kind: 'stroke',
      points: [point],
      color: penColor,
      size: penSize,
      layer: maxLayer + 1,
    };
    setStrokes((prev) => [...prev, stroke]);
    setSelection(null);
    setGroupSelection([]);
    setActiveStrokeId(stroke.id);
    setEditingText(null);
  };

  const selectExamPreset = (presetId: string) => {
    if (readonly) return;
    const preset = examPresets.find((item) => item.id === presetId);
    if (!preset) return;

    setActiveExamPresetId(preset.id);
    pendingExamPresetIdRef.current = preset.id;
    const image = new Image();
    image.onload = () => {
      if (pendingExamPresetIdRef.current !== preset.id) return;

      const aspect = image.naturalWidth && image.naturalHeight ? image.naturalWidth / image.naturalHeight : 1.45;
      const width = 8;
      const nextExamObject: WebGLObject = {
        id: activeExamObjectId,
        kind: 'image',
        x: 0,
        y: 0,
        width,
        height: width / aspect,
        layer: 0,
        imageSrc: preset.imageSrc,
        imageBackground: '#ffffff',
        imageName: preset.label,
      };

      setObjects((prev) => {
        const hasActiveExam = prev.some((object) => object.id === activeExamObjectId);
        if (hasActiveExam) {
          return prev.map((object) => (object.id === activeExamObjectId ? nextExamObject : object));
        }
        return [nextExamObject, ...prev];
      });
      setSelection(null);
      setGroupSelection([]);
    };
    image.src = preset.imageSrc;
  };

  useEffect(() => {
    const firstPresetId = examPresets[0]?.id;
    if (firstPresetId) {
      selectExamPreset(firstPresetId);
    }
  }, []);

  const appendStrokePoint = (point: Point2D) => {
    if (!activeStrokeId) return;
    setStrokes((prev) =>
      prev.map((stroke) => {
        if (stroke.id !== activeStrokeId) return stroke;
        const nextPoints = getNextStrokePoints(stroke.points, point);
        if (nextPoints === stroke.points) return stroke;
        return { ...stroke, points: nextPoints };
      }),
    );
  };

  const moveStroke = (id: string, delta: Point2D) => {
    setStrokes((prev) =>
      prev.map((stroke) => {
        if (stroke.id !== id) return stroke;
        const safeDelta = drawingBounds ? getBoundedDelta(getPointBounds(stroke.points), drawingBounds, delta) : delta;
        return {
          ...stroke,
          points: moveStrokePoints(stroke.points, safeDelta),
        };
      }),
    );
  };

  const moveObject = (id: string, point: Point2D, offset: Point2D) => {
    if (id === activeExamObjectId) return;

    setObjects((prev) =>
      prev.map((object) => {
        if (object.id !== id) return object;
        const nextObject = { ...object, x: point.x - offset.x, y: point.y - offset.y };
        return drawingBounds ? clampObjectToBounds(nextObject, drawingBounds) : nextObject;
      }),
    );
  };

  const moveGroup = (items: SelectionItem[], delta: Point2D) => {
    const strokeIds = new Set(items.filter((item) => item.type === 'stroke').map((item) => item.id));
    const objectIds = new Set(items.filter((item) => item.type === 'object' && item.id !== activeExamObjectId).map((item) => item.id));
    const movableItems = items.filter((item) => item.type !== 'object' || item.id !== activeExamObjectId);
    const groupBounds = getSelectionItemsBounds(movableItems, strokes, objects);
    const safeDelta = drawingBounds && groupBounds ? getBoundedDelta(groupBounds, drawingBounds, delta) : delta;

    if (strokeIds.size > 0) {
      setStrokes((prev) =>
        prev.map((stroke) =>
          strokeIds.has(stroke.id)
            ? {
                ...stroke,
                points: moveStrokePoints(stroke.points, safeDelta),
              }
            : stroke,
        ),
      );
    }

    if (objectIds.size > 0) {
      setObjects((prev) =>
        prev.map((object) => (objectIds.has(object.id) ? { ...object, x: object.x + safeDelta.x, y: object.y + safeDelta.y } : object)),
      );
    }
  };

  const updateObject = (id: string, patch: Partial<Pick<WebGLObject, 'x' | 'y' | 'width' | 'height' | 'layer'>>) => {
    setObjects((prev) => prev.map((object) => (object.id === id ? { ...object, ...patch } : object)));
  };

  const updateStroke = (id: string, patch: Partial<Pick<Stroke, 'layer' | 'size'>>) => {
    setStrokes((prev) => prev.map((stroke) => (stroke.id === id ? { ...stroke, ...patch } : stroke)));
  };

  const resizeObject = (id: string, patch: Pick<WebGLObject, 'x' | 'y' | 'width' | 'height'>) => {
    if (id === activeExamObjectId) return;
    setObjects((prev) =>
      prev.map((object) => {
        if (object.id !== id) return object;
        const nextObject = { ...object, ...patch };
        return drawingBounds ? clampObjectToBounds(nextObject, drawingBounds) : nextObject;
      }),
    );
  };

  const resizeStroke = (id: string, points: Point2D[]) => {
    const nextPoints = drawingBounds ? moveStrokePoints(points, getBoundedDelta(getPointBounds(points), drawingBounds, { x: 0, y: 0 })) : points;
    setStrokes((prev) => prev.map((stroke) => (stroke.id === id ? { ...stroke, points: nextPoints } : stroke)));
  };

  const resizeGroup = (origin: GroupResizeOrigin, point: Point2D) => {
    const scale = getGroupResizeScale(origin, point);
    const objectMap = new Map(origin.objects.map((object) => [object.id, object]));
    const strokeMap = new Map(origin.strokes.map((stroke) => [stroke.id, stroke]));

    setObjects((prev) =>
      prev.map((object) => {
        const original = objectMap.get(object.id);
        if (!original) return object;
        return {
          ...object,
          x: origin.bounds.minX + (original.x - origin.bounds.minX) * scale,
          y: origin.bounds.maxY + (original.y - origin.bounds.maxY) * scale,
          width: Math.max(0.18, original.width * scale),
          height: Math.max(0.12, original.height * scale),
        };
      }),
    );

    setStrokes((prev) =>
      prev.map((stroke) => {
        const original = strokeMap.get(stroke.id);
        if (!original) return stroke;
        return {
          ...stroke,
          points: original.points.map((item) => ({
            x: origin.bounds.minX + (item.x - origin.bounds.minX) * scale,
            y: origin.bounds.maxY + (item.y - origin.bounds.maxY) * scale,
          })),
        };
      }),
    );
  };

  const eraseStroke = (id: string) => {
    recordHistory();
    setStrokes((prev) => prev.filter((stroke) => stroke.id !== id));
    setSelection(null);
    setGroupSelection([]);
  };

  const commitTextEdit = () => {
    if (!editingText) return;
    recordHistory();
    setObjects((prev) =>
      prev.map((object) => (object.id === editingText.id ? { ...object, text: editingText.value || ' ' } : object)),
    );
    setEditingText(null);
  };

  const startTextEdit = (object: WebGLObject) => {
    if (readonly || object.kind !== 'text') return;
    setSelection({ type: 'object', id: object.id });
    setGroupSelection([{ type: 'object', id: object.id }]);
    setEditingText({ id: object.id, value: object.text ?? '' });
  };

  const updateTextEdit = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setEditingText((current) => (current ? { ...current, value } : current));
  };

  const handleTextEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      setEditingText(null);
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      commitTextEdit();
    }
  };

  const bringForward = () => {
    const targets = groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    if (targets.length === 0) return;
    const strokeIds = new Set(targets.filter((item) => item.type === 'stroke').map((item) => item.id));
    const objectIds = new Set(targets.filter((item) => item.type === 'object' && item.id !== activeExamObjectId).map((item) => item.id));
    if (strokeIds.size === 0 && objectIds.size === 0) return;
    recordHistory();
    setStrokes((prev) => prev.map((stroke) => (strokeIds.has(stroke.id) ? { ...stroke, layer: maxLayer + 1 } : stroke)));
    setObjects((prev) => prev.map((object) => (objectIds.has(object.id) ? { ...object, layer: maxLayer + 1 } : object)));
    if (targets.length > 1) {
      setGroupSelection(targets);
    }
  };

  const sendBackward = () => {
    const targets = groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    if (targets.length === 0) return;
    const strokeIds = new Set(targets.filter((item) => item.type === 'stroke').map((item) => item.id));
    const objectIds = new Set(targets.filter((item) => item.type === 'object' && item.id !== activeExamObjectId).map((item) => item.id));
    if (strokeIds.size === 0 && objectIds.size === 0) return;
    recordHistory();
    setStrokes((prev) => prev.map((stroke) => (strokeIds.has(stroke.id) ? { ...stroke, layer: 1 } : { ...stroke, layer: stroke.layer + 1 })));
    setObjects((prev) =>
      prev.map((object) => {
        if (object.id === activeExamObjectId) return object;
        if (objectIds.has(object.id)) return { ...object, layer: 1 };
        return { ...object, layer: object.layer + 1 };
      }),
    );
    if (targets.length > 1) {
      setGroupSelection(targets);
    }
  };

  const requestZoom = (factor: number) => {
    setZoomCommand({ id: Date.now(), factor });
  };

  return {
    imageInputRef,
    tool,
    penColor,
    penSize,
    readonly,
    selection,
    groupSelection,
    dragState,
    resizeState,
    editingText,
    zoomCommand,
    strokes,
    objects,
    selectedObject,
    selectedStroke,
    drawingBounds,
    activeExamPresetId,
    examPresets,
    canUndo,
    canRedo,
    setTool,
    setPenColor,
    setPenSize,
    setReadonly,
    setSelection,
    setGroupSelection,
    setDragState,
    setResizeState,
    addText,
    addImage,
    addImageFromFile,
    clearAll,
    deleteSelection,
    undo,
    redo,
    beginStroke,
    appendStrokePoint,
    endStroke: () => setActiveStrokeId(null),
    moveStroke,
    moveObject,
    moveGroup,
    updateObject,
    updateStroke,
    resizeObject,
    resizeStroke,
    resizeGroup,
    eraseStroke,
    startTextEdit,
    updateTextEdit,
    handleTextEditKeyDown,
    commitTextEdit,
    bringForward,
    sendBackward,
    requestZoom,
    selectExamPreset,
  };
}
