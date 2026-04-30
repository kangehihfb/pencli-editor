import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type {
  DragState,
  EditingText,
  GroupRotateOrigin,
  GroupResizeOrigin,
  Point2D,
  PointBounds,
  ResizeState,
  RotateState,
  Selection,
  SelectionItem,
  Stroke,
  Tool,
  WebGLObject,
  ZoomCommand,
} from '../types/editor';
import { examPresets } from '../data/examPresets';
import {
  getGroupResizeTransform,
  getNextStrokePoints,
  getObjectBounds,
  getPointBounds,
  getSelectionItemsBounds,
  makeId,
  normalizeRotation,
  rotatePoint,
} from '../lib/sceneMath';
import type { PageExportState } from '../lib/exportPageImage';
import { DEFAULT_TEXT_FONT_FAMILY, preloadEditorTextFonts } from '../lib/editorTextFonts';
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_FONT_SIZE, clampTextFontSize, measureTextObject } from '../lib/objectTexture';

const activeExamObjectId = 'object_exam_active';
const maxHistorySize = 80;
const exportStateStorageKey = '__page_export_state__';

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

function readInjectedExportState(): PageExportState | null {
  if (typeof window === 'undefined') return null;

  try {
    const rawState = window.localStorage.getItem(exportStateStorageKey);
    if (!rawState) return null;
    const parsed = JSON.parse(rawState) as Partial<PageExportState>;
    if (!Array.isArray(parsed.strokes) || !Array.isArray(parsed.objects)) return null;
    return {
      strokes: cloneStrokes(parsed.strokes as Stroke[]),
      objects: cloneObjects(parsed.objects as WebGLObject[]),
    };
  } catch {
    return null;
  }
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

function getTextScaleForResizeHandle(handle: string, scaleX: number, scaleY: number) {
  const usesX = handle.includes('e') || handle.includes('w');
  const usesY = handle.includes('n') || handle.includes('s');
  if (usesX && !usesY) return scaleX;
  if (usesY && !usesX) return scaleY;
  return Math.max(scaleX, scaleY);
}

function moveStrokePoints(points: Point2D[], delta: Point2D) {
  return points.map((point) => ({ x: point.x + delta.x, y: point.y + delta.y }));
}

function closeLoopStrokeIfNeeded(stroke: Stroke) {
  if (stroke.points.length < 8) return stroke;

  const firstPoint = stroke.points[0];
  const lastPoint = stroke.points[stroke.points.length - 1];
  const bounds = getPointBounds(stroke.points);
  const minDimension = Math.min(bounds.width, bounds.height);
  const minLoopDimension = Math.max(28, stroke.size * 8);
  if (minDimension < minLoopDimension) return stroke;

  const endpointGap = Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y);
  const closeThreshold = Math.max(
    stroke.size * 2.5,
    Math.min(Math.max(stroke.size * 7, 18), minDimension * 0.35, 32),
  );
  if (endpointGap > closeThreshold) return stroke;

  const closedPoints = getNextStrokePoints(stroke.points, firstPoint);
  return closedPoints === stroke.points ? stroke : { ...stroke, points: closedPoints };
}

export function useEditorState(drawingBoundsOverride: PointBounds | null = null) {
  const injectedExportStateRef = useRef<PageExportState | null>(readInjectedExportState());
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pendingExamPresetIdRef = useRef<string | null>(null);
  const undoHistoryRef = useRef<HistorySnapshot[]>([]);
  const redoHistoryRef = useRef<HistorySnapshot[]>([]);
  const activeStrokeIdRef = useRef<string | null>(null);
  const [tool, setTool] = useState<Tool>('answer');
  const [penColor, setPenColor] = useState('#183f3a');
  const [penSize, setPenSize] = useState(3.5);
  const [textFontFamily, setTextFontFamily] = useState(DEFAULT_TEXT_FONT_FAMILY);
  const [readonly, setReadonly] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [groupSelection, setGroupSelection] = useState<SelectionItem[]>([]);
  const [dragState, setDragState] = useState<DragState>(null);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [rotateState, setRotateState] = useState<RotateState>(null);
  const [editingText, setEditingText] = useState<EditingText>(null);
  const [activeStrokeId, setActiveStrokeId] = useState<string | null>(null);
  const [zoomCommand, setZoomCommand] = useState<ZoomCommand | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>(() => injectedExportStateRef.current?.strokes ?? []);
  const [objects, setObjects] = useState<WebGLObject[]>(() => injectedExportStateRef.current?.objects ?? []);
  const [activeExamPresetId, setActiveExamPresetId] = useState<string | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);

  const maxLayer = Math.max(0, ...strokes.map((stroke) => stroke.layer), ...objects.map((object) => object.layer));
  const activeSelection = selection ?? (groupSelection.length === 1 ? groupSelection[0] : null);
  const selectedObject = activeSelection?.type === 'object' ? objects.find((object) => object.id === activeSelection.id) ?? null : null;
  const selectedStroke = activeSelection?.type === 'stroke' ? strokes.find((stroke) => stroke.id === activeSelection.id) ?? null : null;
  const selectedTextObject =
    selectedObject?.kind === 'text'
      ? selectedObject
      : objects.find((object) => object.kind === 'text' && groupSelection.some((item) => item.type === 'object' && item.id === object.id)) ?? null;
  const activeColor = selectedTextObject ? selectedTextObject.color ?? DEFAULT_TEXT_COLOR : penColor;
  const activeTextFontFamily = selectedTextObject ? selectedTextObject.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY : textFontFamily;
  const activeExamObject = objects.find((object) => object.id === activeExamObjectId) ?? null;
  const drawingBounds = drawingBoundsOverride ?? (activeExamObject ? getObjectBounds(activeExamObject) : null);
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
    activeStrokeIdRef.current = null;
    setActiveStrokeId(null);
    setDragState(null);
    setResizeState(null);
    setRotateState(null);
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
    const fontSize = DEFAULT_TEXT_FONT_SIZE;
    const measured = measureTextObject('', fontSize, textFontFamily);
    const object: WebGLObject = {
      id: makeId('text'),
      kind: 'text',
      x: drawingBounds?.centerX ?? 500,
      y: drawingBounds?.centerY ?? 380,
      width: measured.width,
      height: measured.height,
      layer: maxLayer + 1,
      color: penColor,
      text: '',
      fontSize,
      fontFamily: textFontFamily,
    };
    setObjects((prev) => [...prev, object]);
    setSelection({ type: 'object', id: object.id });
    setGroupSelection([{ type: 'object', id: object.id }]);
    setEditingText({ id: object.id, value: '' });
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
      const width = 180;
      recordHistory();
      const object: WebGLObject = {
        id: makeId('image'),
        kind: 'image',
        x: drawingBounds?.centerX ?? 500,
        y: drawingBounds?.centerY ?? 380,
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
    activeStrokeIdRef.current = null;
    setActiveStrokeId(null);
    setActiveExamPresetId(null);
    pendingExamPresetIdRef.current = null;
    setDragState(null);
    setResizeState(null);
    setRotateState(null);
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
    setRotateState(null);
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

  useEffect(() => {
    let cancelled = false;

    preloadEditorTextFonts().then(() => {
      if (cancelled) return;

      setObjects((prev) =>
        prev.map((object) => {
          if (object.kind !== 'text') return object;

          const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
          const measured = measureTextObject(object.text ?? '', fontSize, object.fontFamily);
          return {
            ...object,
            width: measured.width,
            height: measured.height,
          };
        }),
      );
    });

    return () => {
      cancelled = true;
    };
  }, []);

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
    activeStrokeIdRef.current = stroke.id;
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
    if (injectedExportStateRef.current) return;

    const firstPresetId = examPresets[0]?.id;
    if (firstPresetId) {
      selectExamPreset(firstPresetId);
    }
  }, []);

  const appendStrokePoint = (pointOrPoints: Point2D | Point2D[]) => {
    const targetStrokeId = activeStrokeIdRef.current;
    if (!targetStrokeId) return;
    const pointsToAppend = Array.isArray(pointOrPoints) ? pointOrPoints : [pointOrPoints];
    if (pointsToAppend.length === 0) return;

    setStrokes((prev) =>
      prev.map((stroke) => {
        if (stroke.id !== targetStrokeId) return stroke;
        const nextPoints = pointsToAppend.reduce(getNextStrokePoints, stroke.points);
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

  const updateObject = (id: string, patch: Partial<Pick<WebGLObject, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'layer' | 'fontSize' | 'fontFamily' | 'color'>>) => {
    setObjects((prev) => prev.map((object) => (object.id === id ? { ...object, ...patch } : object)));
  };

  const updateStroke = (id: string, patch: Partial<Pick<Stroke, 'layer' | 'size' | 'rotation'>>) => {
    setStrokes((prev) => prev.map((stroke) => (stroke.id === id ? { ...stroke, ...patch } : stroke)));
  };

  const resizeObject = (id: string, patch: Pick<WebGLObject, 'x' | 'y' | 'width' | 'height'>) => {
    if (id === activeExamObjectId) return;
    setObjects((prev) =>
      prev.map((object) => {
        if (object.id !== id) return object;
        if (object.kind === 'text') {
          const scale = patch.height / Math.max(object.height, 0.001);
          const fontSize = clampTextFontSize((object.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * scale);
          const measured = measureTextObject(object.text ?? '', fontSize, object.fontFamily);
          const nextObject = {
            ...object,
            x: patch.x,
            y: patch.y,
            width: measured.width,
            height: measured.height,
            fontSize,
          };
          return drawingBounds ? clampObjectToBounds(nextObject, drawingBounds) : nextObject;
        }
        const nextObject = { ...object, ...patch };
        return drawingBounds ? clampObjectToBounds(nextObject, drawingBounds) : nextObject;
      }),
    );
  };

  const resizeStroke = (id: string, points: Point2D[]) => {
    const nextPoints = drawingBounds ? moveStrokePoints(points, getBoundedDelta(getPointBounds(points), drawingBounds, { x: 0, y: 0 })) : points;
    setStrokes((prev) => prev.map((stroke) => (stroke.id === id ? { ...stroke, points: nextPoints } : stroke)));
  };

  const rotateObject = (id: string, rotation: number) => {
    if (id === activeExamObjectId) return;
    setObjects((prev) => prev.map((object) => (object.id === id ? { ...object, rotation } : object)));
  };

  const rotateStroke = (id: string, rotation: number) => {
    setStrokes((prev) => prev.map((stroke) => (stroke.id === id ? { ...stroke, rotation } : stroke)));
  };

  const resizeGroup = (origin: GroupResizeOrigin, point: Point2D) => {
    const transform = getGroupResizeTransform(origin, point);
    const objectMap = new Map(origin.objects.map((object) => [object.id, object]));
    const strokeMap = new Map(origin.strokes.map((stroke) => [stroke.id, stroke]));

    setObjects((prev) =>
      prev.map((object) => {
        const original = objectMap.get(object.id);
        if (!original) return object;
        const localCenter = rotatePoint({ x: original.x, y: original.y }, transform.originCenter, -transform.rotation);
        const nextLocalCenter = {
          x: transform.localBounds.minX + (localCenter.x - origin.bounds.minX) * transform.scaleX,
          y: transform.localBounds.minY + (localCenter.y - origin.bounds.minY) * transform.scaleY,
        };
        const nextCenter = rotatePoint(nextLocalCenter, transform.originCenter, transform.rotation);

        if (object.kind === 'text') {
          const scale = getTextScaleForResizeHandle(origin.handle, transform.scaleX, transform.scaleY);
          const fontSize = clampTextFontSize((original.fontSize ?? object.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * scale);
          const measured = measureTextObject(original.text ?? object.text ?? '', fontSize, original.fontFamily ?? object.fontFamily);

          return {
            ...object,
            x: nextCenter.x,
            y: nextCenter.y,
            width: measured.width,
            height: measured.height,
            fontSize,
            rotation: original.rotation ?? object.rotation,
          };
        }

        return {
          ...object,
          x: nextCenter.x,
          y: nextCenter.y,
          width: Math.max(18, original.width * transform.scaleX),
          height: Math.max(12, original.height * transform.scaleY),
          rotation: original.rotation ?? object.rotation,
        };
      }),
    );

    setStrokes((prev) =>
      prev.map((stroke) => {
        const original = strokeMap.get(stroke.id);
        if (!original) return stroke;
        return {
          ...stroke,
          rotation: original.rotation ?? stroke.rotation,
          points: original.points.map((item) => {
            const localPoint = rotatePoint(item, transform.originCenter, -transform.rotation);
            return rotatePoint(
              {
                x: transform.localBounds.minX + (localPoint.x - origin.bounds.minX) * transform.scaleX,
                y: transform.localBounds.minY + (localPoint.y - origin.bounds.minY) * transform.scaleY,
              },
              transform.originCenter,
              transform.rotation,
            );
          }),
        };
      }),
    );
  };

  const rotateGroup = (origin: GroupRotateOrigin, angleDelta: number) => {
    const objectMap = new Map(origin.objects.map((object) => [object.id, object]));
    const strokeMap = new Map(origin.strokes.map((stroke) => [stroke.id, stroke]));

    setObjects((prev) =>
      prev.map((object) => {
        const original = objectMap.get(object.id);
        if (!original) return object;

        const nextCenter = rotatePoint({ x: original.x, y: original.y }, origin.center, angleDelta);
        return {
          ...object,
          x: nextCenter.x,
          y: nextCenter.y,
          rotation: normalizeRotation((original.rotation ?? 0) + angleDelta),
        };
      }),
    );

    setStrokes((prev) =>
      prev.map((stroke) => {
        const original = strokeMap.get(stroke.id);
        if (!original) return stroke;

        const originalBounds = getPointBounds(original.points);
        const originalCenter = { x: originalBounds.centerX, y: originalBounds.centerY };
        const nextCenter = rotatePoint(originalCenter, origin.center, angleDelta);
        const centerDelta = { x: nextCenter.x - originalCenter.x, y: nextCenter.y - originalCenter.y };

        return {
          ...stroke,
          points: moveStrokePoints(original.points, centerDelta),
          rotation: normalizeRotation((original.rotation ?? 0) + angleDelta),
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

  const commitTextEdit = (value?: string) => {
    if (!editingText) return;
    recordHistory();
    const nextText = value ?? editingText.value;
    const isEmpty = nextText.trim().length === 0;
    setObjects((prev) => {
      if (isEmpty) {
        return prev.filter((object) => object.id !== editingText.id);
      }

      return prev.map((object) => {
        if (object.id !== editingText.id) return object;
        const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const measured = measureTextObject(nextText, fontSize, object.fontFamily);
        return {
          ...object,
          text: nextText,
          width: measured.width,
          height: measured.height,
          fontSize,
        };
      });
    });
    if (isEmpty) {
      setSelection(null);
      setGroupSelection([]);
    }
    setEditingText(null);
  };

  const startTextEdit = (object: WebGLObject) => {
    if (readonly || object.kind !== 'text') return;
    setSelection({ type: 'object', id: object.id });
    setGroupSelection([{ type: 'object', id: object.id }]);
    setEditingText({ id: object.id, value: object.text ?? '' });
  };

  const updateTextEdit = (value: string) => {
    setEditingText((current) => (current ? { ...current, value } : current));
  };

  const handleTextEditKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setEditingText(null);
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      commitTextEdit(event.currentTarget.value);
    }
  };

  const applyColor = (color: string) => {
    setPenColor(color);
    if (readonly) return;

    const targets = groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    const objectIds = new Set(targets.filter((item) => item.type === 'object').map((item) => item.id));
    if (objectIds.size === 0) return;

    const hasTextColorTarget = objects.some(
      (object) => objectIds.has(object.id) && object.kind === 'text' && (object.color ?? DEFAULT_TEXT_COLOR).toLowerCase() !== color.toLowerCase(),
    );
    if (!hasTextColorTarget) return;

    recordHistory();
    setObjects((prev) =>
      prev.map((object) => (objectIds.has(object.id) && object.kind === 'text' ? { ...object, color } : object)),
    );
  };

  const applyTextFontFamily = (fontFamily: string) => {
    setTextFontFamily(fontFamily);
    if (readonly) return;

    const targets = groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    const objectIds = new Set(targets.filter((item) => item.type === 'object').map((item) => item.id));
    if (objectIds.size === 0) return;

    const hasTextFontTarget = objects.some(
      (object) => objectIds.has(object.id) && object.kind === 'text' && (object.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY) !== fontFamily,
    );
    if (!hasTextFontTarget) return;

    recordHistory();
    setObjects((prev) =>
      prev.map((object) => {
        if (!objectIds.has(object.id) || object.kind !== 'text') return object;

        const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const measured = measureTextObject(object.text ?? '', fontSize, fontFamily);
        return {
          ...object,
          width: measured.width,
          height: measured.height,
          fontFamily,
        };
      }),
    );
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

  const endStroke = () => {
    const targetStrokeId = activeStrokeIdRef.current;
    if (targetStrokeId) {
      setStrokes((prev) => prev.map((stroke) => (stroke.id === targetStrokeId ? closeLoopStrokeIfNeeded(stroke) : stroke)));
    }
    activeStrokeIdRef.current = null;
    setActiveStrokeId(null);
  };

  return {
    imageInputRef,
    tool,
    penColor,
    activeColor,
    textFontFamily,
    activeTextFontFamily,
    penSize,
    readonly,
    selection,
    groupSelection,
    dragState,
    resizeState,
    rotateState,
    editingText,
    zoomCommand,
    strokes,
    objects,
    activeStrokeId,
    selectedObject,
    selectedStroke,
    drawingBounds,
    activeExamPresetId,
    examPresets,
    canUndo,
    canRedo,
    setTool,
    setPenColor,
    applyColor,
    setTextFontFamily,
    applyTextFontFamily,
    setPenSize,
    setReadonly,
    setSelection,
    setGroupSelection,
    setDragState,
    setResizeState,
    setRotateState,
    addText,
    addImage,
    addImageFromFile,
    clearAll,
    deleteSelection,
    undo,
    redo,
    beginStroke,
    appendStrokePoint,
    endStroke,
    moveStroke,
    moveObject,
    moveGroup,
    updateObject,
    updateStroke,
    resizeObject,
    resizeStroke,
    rotateObject,
    rotateStroke,
    rotateGroup,
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
