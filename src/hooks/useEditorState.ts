import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
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
} from "../types/editor";
import { examPresets } from "../data/examPresets";
import {
  getGroupResizeTransform,
  getNextStrokePoints,
  getObjectBounds,
  getPointBounds,
  getSelectionItemsBounds,
  makeId,
  normalizeRotation,
  rotatePoint,
} from "../lib/sceneMath";
import type { PageExportState } from "../lib/exportPageImage";
import {
  DEFAULT_TEXT_FONT_FAMILY,
  preloadEditorTextFonts,
} from "../lib/editorTextFonts";
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE,
  clampTextFontSize,
  measureTextObject,
} from "../lib/objectTexture";

const activeExamObjectId = "object_exam_active";
const maxHistorySize = 80;
const exportStateStorageKey = "__page_export_state__";

type HistorySnapshot = {
  strokes: Stroke[];
  objects: WebGLObject[];
  activeExamPresetId: string | undefined;
};

type ClampRange = {
  min: number;
  max: number;
};

type DeltaBoundsInput = {
  bounds: PointBounds;
  container: PointBounds;
  delta: Point2D;
};

type AxisDeltaInput = {
  size: number;
  containerSize: number;
  center: number;
  containerCenter: number;
  delta: number;
  range: ClampRange;
};

type BoundedAxisDeltaInput = {
  size: number;
  containerSize: number;
  center: number;
  containerCenter: number;
  delta: number;
  min: number;
  max: number;
};

type TextScaleInput = {
  handle: string;
  scaleX: number;
  scaleY: number;
};

type TextObjectInsertInput = {
  textFontFamily: string;
  penColor: string;
  maxLayer: number;
  drawingBounds?: PointBounds;
};

type ResizeGroupOriginalObject = GroupResizeOrigin["objects"][number];
type ResizeGroupOriginalStroke = GroupResizeOrigin["strokes"][number];
type RotateGroupOriginalObject = GroupRotateOrigin["objects"][number];
type RotateGroupOriginalStroke = GroupRotateOrigin["strokes"][number];

type ImageObjectInsertInput = {
  fileName: string;
  imageSource: string;
  aspect: number;
  maxLayer: number;
  drawingBounds?: PointBounds;
};

type MoveObjectInput = {
  id: string;
  point: Point2D;
  offset: Point2D;
};

type ScaledLocalPointInput = {
  localPoint: Point2D;
  originBounds: PointBounds;
  transform: ReturnType<typeof getGroupResizeTransform>;
};

type ScaledPointFromOriginBoundsInput = {
  point: Point2D;
  transform: ReturnType<typeof getGroupResizeTransform>;
  originBounds: PointBounds;
};

type ResizedGroupObjectInput = {
  object: WebGLObject;
  original: ResizeGroupOriginalObject;
  origin: GroupResizeOrigin;
  transform: ReturnType<typeof getGroupResizeTransform>;
};

const horizontalResizeHandles = ["e", "w"] as const;
const verticalResizeHandles = ["n", "s"] as const;

function cloneStrokes(items: Stroke[]): Stroke[] {
  return items.map((stroke) => ({
    ...stroke,
    points: stroke.points.map((point) => ({ ...point })),
  }));
}

function cloneObjects(items: WebGLObject[]): WebGLObject[] {
  return items.map((object) => ({ ...object }));
}

function isValidExportState(
  parsed: Partial<PageExportState>,
): parsed is PageExportState {
  return Array.isArray(parsed.strokes) && Array.isArray(parsed.objects);
}

function parseInjectedExportState(
  rawState: string | undefined,
): PageExportState | undefined {
  if (!rawState) return undefined;
  const parsed = JSON.parse(rawState) as Partial<PageExportState>;
  if (!isValidExportState(parsed)) return undefined;
  return {
    strokes: cloneStrokes(parsed.strokes),
    objects: cloneObjects(parsed.objects),
  };
}

function readExportStateFromStorage(): string | undefined {
  return window.localStorage.getItem(exportStateStorageKey);
}

function readInjectedExportState(): PageExportState | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    return parseInjectedExportState(readExportStateFromStorage());
  } catch {
    return undefined;
  }
}

function clamp(value: number, range: ClampRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

function getAxisBoundedDelta(input: AxisDeltaInput): number {
  const { size, containerSize, center, containerCenter, delta, range } = input;
  if (size >= containerSize) {
    return containerCenter - center;
  }

  return clamp(delta, range);
}

function getBoundedAxisDelta(input: BoundedAxisDeltaInput): number {
  const { min, max, ...axisInput } = input;
  return getAxisBoundedDelta({
    ...axisInput,
    range: { min, max },
  });
}

function clampObjectToBounds(
  object: WebGLObject,
  bounds: PointBounds,
): WebGLObject {
  const nextX =
    object.width >= bounds.width
      ? bounds.centerX
      : clamp(object.x, {
          min: bounds.minX + object.width / 2,
          max: bounds.maxX - object.width / 2,
        });
  const nextY =
    object.height >= bounds.height
      ? bounds.centerY
      : clamp(object.y, {
          min: bounds.minY + object.height / 2,
          max: bounds.maxY - object.height / 2,
        });

  return { ...object, x: nextX, y: nextY };
}

function getBoundedDeltaX(input: DeltaBoundsInput): number {
  const { bounds, container, delta } = input;
  return getBoundedAxisDelta({
    size: bounds.width,
    containerSize: container.width,
    center: bounds.centerX,
    containerCenter: container.centerX,
    delta: delta.x,
    min: container.minX - bounds.minX,
    max: container.maxX - bounds.maxX,
  });
}

function getBoundedDeltaY(input: DeltaBoundsInput): number {
  const { bounds, container, delta } = input;
  return getBoundedAxisDelta({
    size: bounds.height,
    containerSize: container.height,
    center: bounds.centerY,
    containerCenter: container.centerY,
    delta: delta.y,
    min: container.minY - bounds.minY,
    max: container.maxY - bounds.maxY,
  });
}

function getBoundedDelta(input: DeltaBoundsInput): Point2D {
  return { x: getBoundedDeltaX(input), y: getBoundedDeltaY(input) };
}

function hasHorizontalResizeHandle(handle: string): boolean {
  return horizontalResizeHandles.some((axis) => handle.includes(axis));
}

function hasVerticalResizeHandle(handle: string): boolean {
  return verticalResizeHandles.some((axis) => handle.includes(axis));
}

function getSingleAxisResizeScale(input: TextScaleInput): number | undefined {
  const { handle, scaleX, scaleY } = input;
  const usesX = hasHorizontalResizeHandle(handle);
  const usesY = hasVerticalResizeHandle(handle);
  if (usesX === usesY) return undefined;
  return usesX ? scaleX : scaleY;
}

function getTextScaleForResizeHandle(input: TextScaleInput): number {
  return (
    getSingleAxisResizeScale(input) ?? Math.max(input.scaleX, input.scaleY)
  );
}

function appendStrokePoints(
  basePoints: Point2D[],
  pointsToAppend: Point2D[],
): Point2D[] {
  if (pointsToAppend.length === 0) return basePoints;
  const [firstPoint, ...remainingPoints] = pointsToAppend;
  const nextPoints = getNextStrokePoints(basePoints, firstPoint);
  return appendStrokePoints(nextPoints, remainingPoints);
}

function moveStrokePoints(points: Point2D[], delta: Point2D): Point2D[] {
  return points.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  }));
}

function shouldCloseStrokeLoop(stroke: Stroke): boolean {
  if (stroke.points.length < 8) return false;
  const firstPoint = stroke.points[0];
  const lastPoint = stroke.points[stroke.points.length - 1];
  const bounds = getPointBounds(stroke.points);
  const minDimension = Math.min(bounds.width, bounds.height);
  const minLoopDimension = Math.max(28, stroke.size * 8);
  if (minDimension < minLoopDimension) return false;

  const endpointGap = Math.hypot(
    firstPoint.x - lastPoint.x,
    firstPoint.y - lastPoint.y,
  );
  const closeThreshold = Math.max(
    stroke.size * 2.5,
    Math.min(Math.max(stroke.size * 7, 18), minDimension * 0.35, 32),
  );
  return endpointGap <= closeThreshold;
}

function closeLoopStrokeIfNeeded(stroke: Stroke): Stroke {
  if (!shouldCloseStrokeLoop(stroke)) return stroke;

  const firstPoint = stroke.points[0];
  const closedPoints = getNextStrokePoints(stroke.points, firstPoint);
  return closedPoints === stroke.points
    ? stroke
    : { ...stroke, points: closedPoints };
}

function createInsertedTextObject(input: TextObjectInsertInput): WebGLObject {
  const { textFontFamily, penColor, maxLayer, drawingBounds } = input;
  const fontSize = DEFAULT_TEXT_FONT_SIZE;
  const measured = measureTextObject("", fontSize, textFontFamily);
  return {
    id: makeId("text"),
    kind: "text",
    x: drawingBounds?.centerX ?? 500,
    y: drawingBounds?.centerY ?? 380,
    width: measured.width,
    height: measured.height,
    layer: maxLayer + 1,
    color: penColor,
    text: "",
    fontSize,
    fontFamily: textFontFamily,
  };
}

function getSafeImageAspect(aspect: number): number {
  if (!Number.isFinite(aspect)) return 1.45;
  return aspect > 0 ? aspect : 1.45;
}

function scaleCoordinate(input: {
  value: number;
  originMin: number;
  targetMin: number;
  scale: number;
}): number {
  const { value, originMin, targetMin, scale } = input;
  return targetMin + (value - originMin) * scale;
}

function getScaledLocalPoint(input: ScaledLocalPointInput): Point2D {
  const { localPoint, originBounds, transform } = input;
  const nextX = scaleCoordinate({
    value: localPoint.x,
    originMin: originBounds.minX,
    targetMin: transform.localBounds.minX,
    scale: transform.scaleX,
  });
  const nextY = scaleCoordinate({
    value: localPoint.y,
    originMin: originBounds.minY,
    targetMin: transform.localBounds.minY,
    scale: transform.scaleY,
  });
  return { x: nextX, y: nextY };
}

function getLocalPointFromWorldPoint(
  input: ScaledPointFromOriginBoundsInput,
): Point2D {
  const { point, transform } = input;
  return rotatePoint(point, transform.originCenter, -transform.rotation);
}

function getWorldPointFromLocalPoint(input: {
  localPoint: Point2D;
  transform: ReturnType<typeof getGroupResizeTransform>;
}): Point2D {
  const { localPoint, transform } = input;
  return rotatePoint(localPoint, transform.originCenter, transform.rotation);
}

function getScaledPointFromOriginBounds(
  input: ScaledPointFromOriginBoundsInput,
): Point2D {
  const localPoint = getLocalPointFromWorldPoint(input);
  const nextLocalPoint = getScaledLocalPoint({ ...input, localPoint });
  return getWorldPointFromLocalPoint({
    localPoint: nextLocalPoint,
    transform: input.transform,
  });
}

function getResizedGroupObjectNextCenter(
  input: ResizedGroupObjectInput,
): Point2D {
  const { original, origin, transform } = input;
  return getScaledPointFromOriginBounds({
    point: { x: original.x, y: original.y },
    transform,
    originBounds: origin.bounds,
  });
}

function createInsertedImageObject(input: ImageObjectInsertInput): WebGLObject {
  const { fileName, imageSource, maxLayer, drawingBounds, aspect } = input;
  const safeAspect = getSafeImageAspect(aspect);
  const width = 180;
  return {
    id: makeId("image"),
    kind: "image",
    x: drawingBounds?.centerX ?? 500,
    y: drawingBounds?.centerY ?? 380,
    width,
    height: width / safeAspect,
    layer: maxLayer + 1,
    imageSrc: imageSource,
    imageName: fileName,
  };
}

function getResizedTextFontSize(input: {
  object: WebGLObject;
  original: ResizeGroupOriginalObject;
  origin: GroupResizeOrigin;
  transform: ReturnType<typeof getGroupResizeTransform>;
}): number {
  const { object, original, origin, transform } = input;
  const scale = getTextScaleForResizeHandle({
    handle: origin.handle,
    scaleX: transform.scaleX,
    scaleY: transform.scaleY,
  });
  return clampTextFontSize(
    (original.fontSize ?? object.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * scale,
  );
}

function getResizedTextMeasuredBounds(input: {
  object: WebGLObject;
  original: ResizeGroupOriginalObject;
  fontSize: number;
}): { width: number; height: number } {
  const { object, original, fontSize } = input;
  return measureTextObject(
    original.text ?? object.text ?? "",
    fontSize,
    original.fontFamily ?? object.fontFamily,
  );
}

function getResizedTextGroupObject(input: {
  object: WebGLObject;
  original: ResizeGroupOriginalObject;
  origin: GroupResizeOrigin;
  transform: ReturnType<typeof getGroupResizeTransform>;
  nextCenter: Point2D;
}): WebGLObject {
  const { object, original, nextCenter } = input;
  const fontSize = getResizedTextFontSize(input);
  const measured = getResizedTextMeasuredBounds({ object, original, fontSize });
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

function getResizedImageGroupObject(input: {
  object: WebGLObject;
  original: ResizeGroupOriginalObject;
  transform: ReturnType<typeof getGroupResizeTransform>;
  nextCenter: Point2D;
}): WebGLObject {
  const { object, original, transform, nextCenter } = input;
  return {
    ...object,
    x: nextCenter.x,
    y: nextCenter.y,
    width: Math.max(18, original.width * transform.scaleX),
    height: Math.max(12, original.height * transform.scaleY),
    rotation: original.rotation ?? object.rotation,
  };
}

function getResizedGroupObject(input: ResizedGroupObjectInput): WebGLObject {
  const nextCenter = getResizedGroupObjectNextCenter(input);
  if (input.object.kind === "text") {
    return getResizedTextGroupObject({ ...input, nextCenter });
  }

  return getResizedImageGroupObject({
    object: input.object,
    original: input.original,
    transform: input.transform,
    nextCenter,
  });
}

function getResizedGroupStroke(input: {
  stroke: Stroke;
  original: ResizeGroupOriginalStroke;
  origin: GroupResizeOrigin;
  transform: ReturnType<typeof getGroupResizeTransform>;
}): Stroke {
  const { stroke, original, origin, transform } = input;
  return {
    ...stroke,
    rotation: original.rotation ?? stroke.rotation,
    points: original.points.map((point) =>
      getScaledPointFromOriginBounds({
        point,
        transform,
        originBounds: origin.bounds,
      }),
    ),
  };
}

function getRotatedGroupObject(input: {
  object: WebGLObject;
  original: RotateGroupOriginalObject;
  origin: GroupRotateOrigin;
  angleDelta: number;
}): WebGLObject {
  const { object, original, origin, angleDelta } = input;
  const nextCenter = rotatePoint(
    { x: original.x, y: original.y },
    origin.center,
    angleDelta,
  );
  return {
    ...object,
    x: nextCenter.x,
    y: nextCenter.y,
    rotation: normalizeRotation((original.rotation ?? 0) + angleDelta),
  };
}

function getStrokeCenter(points: Point2D[]): Point2D {
  const bounds = getPointBounds(points);
  return { x: bounds.centerX, y: bounds.centerY };
}

function getCenterDelta(originCenter: Point2D, nextCenter: Point2D): Point2D {
  return {
    x: nextCenter.x - originCenter.x,
    y: nextCenter.y - originCenter.y,
  };
}

function getRotatedGroupStroke(input: {
  stroke: Stroke;
  original: RotateGroupOriginalStroke;
  origin: GroupRotateOrigin;
  angleDelta: number;
}): Stroke {
  const { stroke, original, origin, angleDelta } = input;
  const originalCenter = getStrokeCenter(original.points);
  const nextCenter = rotatePoint(originalCenter, origin.center, angleDelta);
  const centerDelta = getCenterDelta(originalCenter, nextCenter);
  return {
    ...stroke,
    points: moveStrokePoints(original.points, centerDelta),
    rotation: normalizeRotation((original.rotation ?? 0) + angleDelta),
  };
}

function getSelectionTargets(
  selection: Selection,
  groupSelection: SelectionItem[],
): SelectionItem[] {
  if (groupSelection.length > 0) return groupSelection;
  return selection ? [selection] : [];
}

function getSelectionIds(targets: SelectionItem[]): {
  strokeIds: Set<string>;
  objectIds: Set<string>;
} {
  return {
    strokeIds: new Set(
      targets.filter((item) => item.type === "stroke").map((item) => item.id),
    ),
    objectIds: new Set(
      targets.filter((item) => item.type === "object").map((item) => item.id),
    ),
  };
}

function isDeleteKeyPress(event: globalThis.KeyboardEvent): boolean {
  return event.key === "Delete" || event.key === "Backspace";
}

function isTextInputTarget(target: EventTarget | undefined): boolean {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  );
}

function useEditorState(drawingBoundsOverride?: PointBounds) {
  const injectedExportStateReference = useRef<PageExportState | undefined>(
    readInjectedExportState(),
  );
  const imageInputReference = useRef<HTMLInputElement>();
  const pendingExamPresetIdReference = useRef<string | undefined>();
  const undoHistoryReference = useRef<HistorySnapshot[]>([]);
  const redoHistoryReference = useRef<HistorySnapshot[]>([]);
  const activeStrokeIdReference = useRef<string | undefined>();
  const [tool, setTool] = useState<Tool>("answer");
  const [penColor, setPenColor] = useState("#183f3a");
  const [penSize, setPenSize] = useState(3.5);
  const [textFontFamily, setTextFontFamily] = useState(
    DEFAULT_TEXT_FONT_FAMILY,
  );
  const [readonly, setReadonly] = useState(false);
  const [selection, setSelection] = useState<Selection>();
  const [groupSelection, setGroupSelection] = useState<SelectionItem[]>([]);
  const [dragState, setDragState] = useState<DragState>();
  const [resizeState, setResizeState] = useState<ResizeState>();
  const [rotateState, setRotateState] = useState<RotateState>();
  const [editingText, setEditingText] = useState<EditingText>();
  const [activeStrokeId, setActiveStrokeId] = useState<string | undefined>();
  const [zoomCommand, setZoomCommand] = useState<ZoomCommand | undefined>();
  const [strokes, setStrokes] = useState<Stroke[]>(
    () => injectedExportStateReference.current?.strokes ?? [],
  );
  const [objects, setObjects] = useState<WebGLObject[]>(
    () => injectedExportStateReference.current?.objects ?? [],
  );
  const [activeExamPresetId, setActiveExamPresetId] = useState<
    string | undefined
  >();
  const [historyRevision, setHistoryRevision] = useState(0);

  const maxLayer = Math.max(
    0,
    ...strokes.map((stroke) => stroke.layer),
    ...objects.map((object) => object.layer),
  );
  const activeSelection =
    selection ?? (groupSelection.length === 1 ? groupSelection[0] : undefined);
  const selectedObject =
    activeSelection?.type === "object"
      ? (objects.find((object) => object.id === activeSelection.id) ??
        undefined)
      : undefined;
  const selectedStroke =
    activeSelection?.type === "stroke"
      ? (strokes.find((stroke) => stroke.id === activeSelection.id) ??
        undefined)
      : undefined;
  const selectedTextObject =
    selectedObject?.kind === "text"
      ? selectedObject
      : (objects.find(
          (object) =>
            object.kind === "text" &&
            groupSelection.some(
              (item) => item.type === "object" && item.id === object.id,
            ),
        ) ?? undefined);

  const activeColor = selectedTextObject
    ? (selectedTextObject.color ?? DEFAULT_TEXT_COLOR)
    : penColor;
  const activeTextFontFamily = selectedTextObject
    ? (selectedTextObject.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY)
    : textFontFamily;
  const activeTextFontSize = selectedTextObject
    ? (selectedTextObject.fontSize ?? DEFAULT_TEXT_FONT_SIZE)
    : DEFAULT_TEXT_FONT_SIZE;
  const activeExamObject =
    objects.find((object) => object.id === activeExamObjectId) ?? undefined;
  const drawingBounds =
    drawingBoundsOverride ??
    (activeExamObject ? getObjectBounds(activeExamObject) : undefined);
  const canUndo =
    historyRevision >= 0 && undoHistoryReference.current.length > 0;
  const canRedo =
    historyRevision >= 0 && redoHistoryReference.current.length > 0;

  const createHistorySnapshot = useCallback(
    (): HistorySnapshot => ({
      strokes: cloneStrokes(strokes),
      objects: cloneObjects(objects),
      activeExamPresetId,
    }),
    [activeExamPresetId, objects, strokes],
  );

  const resetInteractionState = useCallback((): void => {
    setSelection(undefined);
    setGroupSelection([]);
    activeStrokeIdReference.current = undefined;
    setActiveStrokeId(undefined);
    setDragState(undefined);
    setResizeState(undefined);
    setRotateState(undefined);
    setEditingText(undefined);
  }, []);

  const restoreHistorySnapshot = useCallback(
    (snapshot: HistorySnapshot): void => {
      setStrokes(cloneStrokes(snapshot.strokes));
      setObjects(cloneObjects(snapshot.objects));
      setActiveExamPresetId(snapshot.activeExamPresetId);
      pendingExamPresetIdReference.current = snapshot.activeExamPresetId;
      resetInteractionState();
    },
    [resetInteractionState],
  );

  const recordHistory = useCallback((): void => {
    undoHistoryReference.current = [
      ...undoHistoryReference.current.slice(-(maxHistorySize - 1)),
      createHistorySnapshot(),
    ];
    redoHistoryReference.current = [];
    setHistoryRevision((value) => value + 1);
  }, [createHistorySnapshot]);

  const undo = useCallback((): void => {
    const snapshot = undoHistoryReference.current.pop();
    if (!snapshot) return;

    redoHistoryReference.current = [
      ...redoHistoryReference.current.slice(-(maxHistorySize - 1)),
      createHistorySnapshot(),
    ];
    restoreHistorySnapshot(snapshot);
    setHistoryRevision((value) => value + 1);
  }, [createHistorySnapshot, restoreHistorySnapshot]);

  const redo = useCallback((): void => {
    const snapshot = redoHistoryReference.current.pop();
    if (!snapshot) return;

    undoHistoryReference.current = [
      ...undoHistoryReference.current.slice(-(maxHistorySize - 1)),
      createHistorySnapshot(),
    ];
    restoreHistorySnapshot(snapshot);
    setHistoryRevision((value) => value + 1);
  }, [createHistorySnapshot, restoreHistorySnapshot]);

  const addText = (): void => {
    if (readonly) return;
    recordHistory();
    const object = createInsertedTextObject({
      textFontFamily,
      penColor,
      maxLayer,
      drawingBounds,
    });

    setObjects((previous) => [...previous, object]);
    setSelection({ type: "object", id: object.id });
    setGroupSelection([{ type: "object", id: object.id }]);
    setEditingText({ id: object.id, value: "" });
    setTool("select");
  };

  const addImage = (): void => {
    if (readonly) return;
    imageInputReference.current?.click();
  };

  const addImageFromFile = (event: ChangeEvent<HTMLInputElement>): void => {
    if (readonly) return;
    const inputElement = event.currentTarget;
    const file = inputElement.files?.[0];
    inputElement.value = "";
    if (!file) return;

    const imageSource = URL.createObjectURL(file);
    const addDecodedImage = (aspect: number): void => {
      recordHistory();
      const object = createInsertedImageObject({
        fileName: file.name,
        imageSource,
        aspect,
        maxLayer,
        drawingBounds,
      });

      setObjects((previous) => [...previous, object]);
      setSelection({ type: "object", id: object.id });
      setGroupSelection([{ type: "object", id: object.id }]);
      setEditingText(undefined);
      setTool("select");
    };

    const image = new Image();
    image.decoding = "async";
    image.addEventListener("load", () => {
      addDecodedImage(image.naturalWidth / image.naturalHeight);
    });
    image.addEventListener("error", () => {
      URL.revokeObjectURL(imageSource);
    });
    image.src = imageSource;
  };

  const clearAll = (): void => {
    if (readonly) return;
    if (strokes.length > 0 || objects.length > 0) {
      recordHistory();
    }
    setStrokes([]);
    setObjects([]);
    setActiveExamPresetId(undefined);
    pendingExamPresetIdReference.current = undefined;
    resetInteractionState();
  };

  const deleteSelection = useCallback((): void => {
    const targets = getSelectionTargets(selection, groupSelection);
    if (readonly || targets.length === 0) return;
    const { strokeIds, objectIds } = getSelectionIds(targets);
    recordHistory();
    if (strokeIds.size > 0) {
      setStrokes((previous) =>
        previous.filter((stroke) => !strokeIds.has(stroke.id)),
      );
    }
    if (objectIds.size > 0) {
      setObjects((previous) =>
        previous.filter((object) => !objectIds.has(object.id)),
      );
    }
    resetInteractionState();
  }, [
    groupSelection,
    readonly,
    recordHistory,
    resetInteractionState,
    selection,
  ]);

  useEffect(() => {
    const handleDeleteKey = (event: globalThis.KeyboardEvent): void => {
      if (!isDeleteKeyPress(event)) return;
      if (editingText) return;
      if (isTextInputTarget(event.target)) return;
      if (groupSelection.length === 0 && !selection) return;

      event.preventDefault();
      deleteSelection();
    };

    window.addEventListener("keydown", handleDeleteKey);
    return (): void => window.removeEventListener("keydown", handleDeleteKey);
  }, [deleteSelection, editingText, groupSelection.length, selection]);

  useEffect(() => {
    let cancelled = false;

    preloadEditorTextFonts()
      .then(() => {
        if (cancelled) return;

        setObjects((previous) =>
          previous.map((object) => {
            if (object.kind !== "text") return object;

            const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
            const measured = measureTextObject(
              object.text ?? "",
              fontSize,
              object.fontFamily,
            );
            return {
              ...object,
              width: measured.width,
              height: measured.height,
            };
          }),
        );
      })
      .catch(() => {});

    return (): void => {
      cancelled = true;
    };
  }, []);

  const beginStroke = (point: Point2D): void => {
    if (readonly) return;
    recordHistory();
    const stroke: Stroke = {
      id: makeId("stroke"),
      kind: "stroke",
      points: [point],
      color: penColor,
      size: penSize,
      layer: maxLayer + 1,
    };
    setStrokes((previous) => [...previous, stroke]);
    setSelection(undefined);
    setGroupSelection([]);
    activeStrokeIdReference.current = stroke.id;
    setActiveStrokeId(stroke.id);
    setEditingText(undefined);
  };

  const selectExamPreset = (presetId: string): void => {
    if (readonly) return;
    const preset = examPresets.find((item) => item.id === presetId);
    if (!preset) return;

    setActiveExamPresetId(preset.id);
    pendingExamPresetIdReference.current = preset.id;
    const image = new Image();
    image.addEventListener("load", () => {
      if (pendingExamPresetIdReference.current !== preset.id) return;

      const aspect =
        image.naturalWidth && image.naturalHeight
          ? image.naturalWidth / image.naturalHeight
          : 1.45;
      const width = 8;
      const nextExamObject: WebGLObject = {
        id: activeExamObjectId,
        kind: "image",
        x: 0,
        y: 0,
        width,
        height: width / aspect,
        layer: 0,
        imageSrc: preset.imageSrc,
        imageBackground: "#ffffff",
        imageName: preset.label,
      };

      setObjects((previous) => {
        const hasActiveExam = previous.some(
          (object) => object.id === activeExamObjectId,
        );
        if (hasActiveExam) {
          return previous.map((object) =>
            object.id === activeExamObjectId ? nextExamObject : object,
          );
        }
        return [nextExamObject, ...previous];
      });
      setSelection(undefined);
      setGroupSelection([]);
    });
    image.src = preset.imageSrc;
  };

  useEffect(() => {
    if (injectedExportStateReference.current) return;

    const firstPresetId = examPresets[0]?.id;
    if (firstPresetId) {
      selectExamPreset(firstPresetId);
    }
  }, []);

  const appendStrokePoint = (pointOrPoints: Point2D | Point2D[]): void => {
    const targetStrokeId = activeStrokeIdReference.current;
    if (!targetStrokeId) return;
    const pointsToAppend = Array.isArray(pointOrPoints)
      ? pointOrPoints
      : [pointOrPoints];
    if (pointsToAppend.length === 0) return;

    setStrokes((previous) =>
      previous.map((stroke) => {
        if (stroke.id !== targetStrokeId) return stroke;
        const nextPoints = appendStrokePoints(stroke.points, pointsToAppend);
        if (nextPoints === stroke.points) return stroke;
        return { ...stroke, points: nextPoints };
      }),
    );
  };

  const moveStroke = (id: string, delta: Point2D): void => {
    setStrokes((previous) =>
      previous.map((stroke) => {
        if (stroke.id !== id) return stroke;
        const safeDelta = drawingBounds
          ? getBoundedDelta({
              bounds: getPointBounds(stroke.points),
              container: drawingBounds,
              delta,
            })
          : delta;
        return {
          ...stroke,
          points: moveStrokePoints(stroke.points, safeDelta),
        };
      }),
    );
  };

  const moveObject = ({ id, point, offset }: MoveObjectInput): void => {
    if (id === activeExamObjectId) return;

    setObjects((previous) =>
      previous.map((object) => {
        if (object.id !== id) return object;
        const nextObject = {
          ...object,
          x: point.x - offset.x,
          y: point.y - offset.y,
        };
        return drawingBounds
          ? clampObjectToBounds(nextObject, drawingBounds)
          : nextObject;
      }),
    );
  };

  const moveGroup = (items: SelectionItem[], delta: Point2D): void => {
    const strokeIds = new Set(
      items.filter((item) => item.type === "stroke").map((item) => item.id),
    );
    const objectIds = new Set(
      items
        .filter(
          (item) => item.type === "object" && item.id !== activeExamObjectId,
        )
        .map((item) => item.id),
    );
    const movableItems = items.filter(
      (item) => item.type !== "object" || item.id !== activeExamObjectId,
    );
    const groupBounds = getSelectionItemsBounds(movableItems, strokes, objects);
    const safeDelta =
      drawingBounds && groupBounds
        ? getBoundedDelta({
            bounds: groupBounds,
            container: drawingBounds,
            delta,
          })
        : delta;

    if (strokeIds.size > 0) {
      setStrokes((previous) =>
        previous.map((stroke) =>
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
      setObjects((previous) =>
        previous.map((object) =>
          objectIds.has(object.id)
            ? {
                ...object,
                x: object.x + safeDelta.x,
                y: object.y + safeDelta.y,
              }
            : object,
        ),
      );
    }
  };

  const updateObject = (
    id: string,
    patch: Partial<
      Pick<
        WebGLObject,
        | "x"
        | "y"
        | "width"
        | "height"
        | "rotation"
        | "layer"
        | "fontSize"
        | "fontFamily"
        | "color"
      >
    >,
  ): void => {
    setObjects((previous) =>
      previous.map((object) =>
        object.id === id ? { ...object, ...patch } : object,
      ),
    );
  };

  const updateStroke = (
    id: string,
    patch: Partial<Pick<Stroke, "layer" | "size" | "rotation">>,
  ): void => {
    setStrokes((previous) =>
      previous.map((stroke) =>
        stroke.id === id ? { ...stroke, ...patch } : stroke,
      ),
    );
  };

  const resizeObject = (
    id: string,
    patch: Pick<WebGLObject, "x" | "y" | "width" | "height">,
  ): void => {
    if (id === activeExamObjectId) return;
    setObjects((previous) =>
      previous.map((object) => {
        if (object.id !== id) return object;
        if (object.kind === "text") {
          const scale = patch.height / Math.max(object.height, 0.001);
          const fontSize = clampTextFontSize(
            (object.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * scale,
          );
          const measured = measureTextObject(
            object.text ?? "",
            fontSize,
            object.fontFamily,
          );
          const nextObject = {
            ...object,
            x: patch.x,
            y: patch.y,
            width: measured.width,
            height: measured.height,
            fontSize,
          };
          return drawingBounds
            ? clampObjectToBounds(nextObject, drawingBounds)
            : nextObject;
        }
        const nextObject = { ...object, ...patch };
        return drawingBounds
          ? clampObjectToBounds(nextObject, drawingBounds)
          : nextObject;
      }),
    );
  };

  const resizeStroke = (id: string, points: Point2D[]): void => {
    const nextPoints = drawingBounds
      ? moveStrokePoints(
          points,
          getBoundedDelta({
            bounds: getPointBounds(points),
            container: drawingBounds,
            delta: {
              x: 0,
              y: 0,
            },
          }),
        )
      : points;
    setStrokes((previous) =>
      previous.map((stroke) =>
        stroke.id === id ? { ...stroke, points: nextPoints } : stroke,
      ),
    );
  };

  const rotateObject = (id: string, rotation: number): void => {
    if (id === activeExamObjectId) return;
    setObjects((previous) =>
      previous.map((object) =>
        object.id === id ? { ...object, rotation } : object,
      ),
    );
  };

  const rotateStroke = (id: string, rotation: number): void => {
    setStrokes((previous) =>
      previous.map((stroke) =>
        stroke.id === id ? { ...stroke, rotation } : stroke,
      ),
    );
  };

  const resizeGroup = (origin: GroupResizeOrigin, point: Point2D): void => {
    const transform = getGroupResizeTransform(origin, point);
    const objectMap = new Map(
      origin.objects.map((object) => [object.id, object]),
    );
    const strokeMap = new Map(
      origin.strokes.map((stroke) => [stroke.id, stroke]),
    );

    setObjects((previous) =>
      previous.map((object) => {
        const original = objectMap.get(object.id);
        if (!original) return object;
        return getResizedGroupObject({
          object,
          original,
          origin,
          transform,
        });
      }),
    );

    setStrokes((previous) =>
      previous.map((stroke) => {
        const original = strokeMap.get(stroke.id);
        if (!original) return stroke;
        return getResizedGroupStroke({
          stroke,
          original,
          origin,
          transform,
        });
      }),
    );
  };

  const rotateGroup = (origin: GroupRotateOrigin, angleDelta: number): void => {
    const objectMap = new Map(
      origin.objects.map((object) => [object.id, object]),
    );
    const strokeMap = new Map(
      origin.strokes.map((stroke) => [stroke.id, stroke]),
    );

    setObjects((previous) =>
      previous.map((object) => {
        const original = objectMap.get(object.id);
        if (!original) return object;
        return getRotatedGroupObject({
          object,
          original,
          origin,
          angleDelta,
        });
      }),
    );

    setStrokes((previous) =>
      previous.map((stroke) => {
        const original = strokeMap.get(stroke.id);
        if (!original) return stroke;
        return getRotatedGroupStroke({
          stroke,
          original,
          origin,
          angleDelta,
        });
      }),
    );
  };

  const eraseStroke = (id: string): void => {
    recordHistory();
    setStrokes((previous) => previous.filter((stroke) => stroke.id !== id));
    setSelection(undefined);
    setGroupSelection([]);
  };

  const commitTextEdit = (value?: string): void => {
    if (!editingText) return;
    recordHistory();
    const nextText = value ?? editingText.value;
    const isEmpty = nextText.trim().length === 0;
    setObjects((previous) => {
      if (isEmpty) {
        return previous.filter((object) => object.id !== editingText.id);
      }

      return previous.map((object) => {
        if (object.id !== editingText.id) return object;
        const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const measured = measureTextObject(
          nextText,
          fontSize,
          object.fontFamily,
        );
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
      setSelection(undefined);
      setGroupSelection([]);
    }
    setEditingText(undefined);
  };

  const startTextEdit = (object: WebGLObject): void => {
    if (readonly || object.kind !== "text") return;
    setSelection({ type: "object", id: object.id });
    setGroupSelection([{ type: "object", id: object.id }]);
    setEditingText({ id: object.id, value: object.text ?? "" });
  };

  const updateTextEdit = (value: string): void => {
    setEditingText((current) => (current ? { ...current, value } : current));
  };

  const handleTextEditKeyDown = (
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void => {
    if (event.nativeEvent.isComposing || event.key === "Process") {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setEditingText(undefined);
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitTextEdit(event.currentTarget.value);
    }
  };

  const applyColor = (color: string): void => {
    setPenColor(color);
    if (readonly) return;

    const targets =
      groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    const objectIds = new Set(
      targets.filter((item) => item.type === "object").map((item) => item.id),
    );
    if (objectIds.size === 0) return;

    const hasTextColorTarget = objects.some(
      (object) =>
        objectIds.has(object.id) &&
        object.kind === "text" &&
        (object.color ?? DEFAULT_TEXT_COLOR).toLowerCase() !==
          color.toLowerCase(),
    );
    if (!hasTextColorTarget) return;

    recordHistory();
    setObjects((previous) =>
      previous.map((object) =>
        objectIds.has(object.id) && object.kind === "text"
          ? { ...object, color }
          : object,
      ),
    );
  };

  const applyTextFontFamily = (fontFamily: string): void => {
    setTextFontFamily(fontFamily);
    if (readonly) return;

    const targets =
      groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    const objectIds = new Set(
      targets.filter((item) => item.type === "object").map((item) => item.id),
    );
    if (objectIds.size === 0) return;

    const hasTextFontTarget = objects.some(
      (object) =>
        objectIds.has(object.id) &&
        object.kind === "text" &&
        (object.fontFamily ?? DEFAULT_TEXT_FONT_FAMILY) !== fontFamily,
    );
    if (!hasTextFontTarget) return;

    recordHistory();
    setObjects((previous) =>
      previous.map((object) => {
        if (!objectIds.has(object.id) || object.kind !== "text") return object;

        const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
        const measured = measureTextObject(
          object.text ?? "",
          fontSize,
          fontFamily,
        );
        return {
          ...object,
          width: measured.width,
          height: measured.height,
          fontFamily,
        };
      }),
    );
  };

  const applyTextFontSize = (fontSize: number): void => {
    const safeFontSize = clampTextFontSize(fontSize);
    if (readonly) return;

    const targets =
      groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    const objectIds = new Set(
      targets.filter((item) => item.type === "object").map((item) => item.id),
    );
    if (objectIds.size === 0) return;

    const hasTextSizeTarget = objects.some(
      (object) =>
        objectIds.has(object.id) &&
        object.kind === "text" &&
        (object.fontSize ?? DEFAULT_TEXT_FONT_SIZE) !== safeFontSize,
    );
    if (!hasTextSizeTarget) return;

    recordHistory();
    setObjects((previous) =>
      previous.map((object) => {
        if (!objectIds.has(object.id) || object.kind !== "text") return object;

        const measured = measureTextObject(
          object.text ?? "",
          safeFontSize,
          object.fontFamily,
        );
        return {
          ...object,
          width: measured.width,
          height: measured.height,
          fontSize: safeFontSize,
        };
      }),
    );
  };

  const bringForward = (): void => {
    const targets =
      groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    if (targets.length === 0) return;
    const strokeIds = new Set(
      targets.filter((item) => item.type === "stroke").map((item) => item.id),
    );
    const objectIds = new Set(
      targets
        .filter(
          (item) => item.type === "object" && item.id !== activeExamObjectId,
        )
        .map((item) => item.id),
    );
    if (strokeIds.size === 0 && objectIds.size === 0) return;
    recordHistory();
    setStrokes((previous) =>
      previous.map((stroke) =>
        strokeIds.has(stroke.id) ? { ...stroke, layer: maxLayer + 1 } : stroke,
      ),
    );
    setObjects((previous) =>
      previous.map((object) =>
        objectIds.has(object.id) ? { ...object, layer: maxLayer + 1 } : object,
      ),
    );
    if (targets.length > 1) {
      setGroupSelection(targets);
    }
  };

  const sendBackward = (): void => {
    const targets =
      groupSelection.length > 0 ? groupSelection : selection ? [selection] : [];
    if (targets.length === 0) return;
    const strokeIds = new Set(
      targets.filter((item) => item.type === "stroke").map((item) => item.id),
    );
    const objectIds = new Set(
      targets
        .filter(
          (item) => item.type === "object" && item.id !== activeExamObjectId,
        )
        .map((item) => item.id),
    );
    if (strokeIds.size === 0 && objectIds.size === 0) return;
    recordHistory();
    setStrokes((previous) =>
      previous.map((stroke) =>
        strokeIds.has(stroke.id)
          ? { ...stroke, layer: 1 }
          : { ...stroke, layer: stroke.layer + 1 },
      ),
    );
    setObjects((previous) =>
      previous.map((object) => {
        if (object.id === activeExamObjectId) return object;
        if (objectIds.has(object.id)) return { ...object, layer: 1 };
        return { ...object, layer: object.layer + 1 };
      }),
    );
    if (targets.length > 1) {
      setGroupSelection(targets);
    }
  };

  const requestZoom = (factor: number): void => {
    setZoomCommand({ id: Date.now(), factor });
  };

  const endStroke = (): void => {
    const targetStrokeId = activeStrokeIdReference.current;
    if (targetStrokeId) {
      setStrokes((previous) =>
        previous.map((stroke) =>
          stroke.id === targetStrokeId
            ? closeLoopStrokeIfNeeded(stroke)
            : stroke,
        ),
      );
    }
    activeStrokeIdReference.current = undefined;
    setActiveStrokeId(undefined);
  };

  return {
    imageInputRef: imageInputReference,
    tool,
    penColor,
    activeColor,
    textFontFamily,
    activeTextFontFamily,
    activeTextFontSize,
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
    applyTextFontSize,
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

export default useEditorState;
