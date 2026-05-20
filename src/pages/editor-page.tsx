import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type {
  GroupResizeOrigin,
  GroupRotateOrigin,
  Point2D,
  PointBounds,
  SelectionItem,
  Stroke,
  Tool,
  WebGLObject,
} from "../types/editor";
import { ExamPresentation } from "../components/exam/ExamPresentation";
import { EditorDebugPanel } from "../components/editor/debug/EditorDebugPanel";
import { RealtimeInkPerfProbePanel } from "../components/editor/debug/RealtimeInkPerfProbePanel";
import { RealtimeInkDebugPanel } from "../components/editor/debug/RealtimeInkDebugPanel";
import { StorageTraceDebugPanel } from "../components/editor/debug/StorageTraceDebugPanel";
import { ProductTracePanel } from "../components/editor/debug/ProductTracePanel";
import { EditorStage } from "../components/editor/EditorStage";
import { EditorToolbar } from "../components/editor/EditorToolbar";
import { reactExams } from "../data/reactExams";
import useEditorState from "../hooks/useEditorState";
import useRealtimeInk from "../hooks/useRealtimeInk";
import {
  getGroupResizeTransform,
  getObjectBounds,
  getPointBounds,
  getSelectionItemsBounds,
  normalizeRotation,
  rotatePoint,
} from "../lib/sceneMath";
import {
  clampTextFontSize,
  DEFAULT_TEXT_FONT_SIZE,
  measureTextObject,
} from "../lib/objectTexture";
import { PAGE_BOUNDS } from "../lib/pageGeometry";
import {
  createPentestHandwritingSnapshot,
  getPentestLocalHandwritingInput,
  loadPentestHandwritingSnapshot,
  savePentestHandwritingSnapshot,
} from "../lib/handwritingSnapshot";
import {
  loadProductHandwriting,
  saveProductHandwriting,
} from "../lib/productTraceClient";
import {
  makeStorageAssetKey,
  uploadStorageAsset,
  type StorageAssetUploadResponse,
} from "../lib/storageTraceClient";
import { optimizeImageForUpload } from "../lib/imageUploadOptimization";
import type { EditorRenderStats } from "../components/editor/scene/EditorScene";

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

type SharedGroupResizeTransform = ReturnType<typeof getGroupResizeTransform>;
type SharedGroupResizeObject = GroupResizeOrigin["objects"][number];
type SharedGroupRotateObject = GroupRotateOrigin["objects"][number];
type SharedGroupResizeStroke = GroupResizeOrigin["strokes"][number];
type SharedGroupRotateStroke = GroupRotateOrigin["strokes"][number];

const horizontalResizeHandles = ["e", "w"] as const;
const verticalResizeHandles = ["n", "s"] as const;

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

function isUrlFlagEnabled(name: string): boolean {
  if (typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get(name);
  return value === "" || value === "1" || value === "true";
}

function isUrlFlagDisabled(name: string): boolean {
  if (typeof window === "undefined") return false;
  const value = new URLSearchParams(window.location.search).get(name);
  return value === "0" || value === "false";
}

function readInitialTool(): Tool | undefined {
  if (typeof window === "undefined") return undefined;
  const value = new URLSearchParams(window.location.search).get("initialTool");
  if (
    value === "answer" ||
    value === "pen" ||
    value === "select" ||
    value === "erase" ||
    value === "pan"
  ) {
    return value;
  }
  return undefined;
}

function clamp(value: number, range: ClampRange): number {
  return Math.min(Math.max(value, range.min), range.max);
}

function getAxisBoundedDelta(input: AxisDeltaInput): number {
  const { size, containerSize, center, containerCenter, delta, range } = input;
  if (size >= containerSize) return containerCenter - center;
  return clamp(delta, range);
}

function getBoundedDelta(input: DeltaBoundsInput): Point2D {
  const { bounds, container, delta } = input;
  return {
    x: getAxisBoundedDelta({
      size: bounds.width,
      containerSize: container.width,
      center: bounds.centerX,
      containerCenter: container.centerX,
      delta: delta.x,
      range: {
        min: container.minX - bounds.minX,
        max: container.maxX - bounds.maxX,
      },
    }),
    y: getAxisBoundedDelta({
      size: bounds.height,
      containerSize: container.height,
      center: bounds.centerY,
      containerCenter: container.centerY,
      delta: delta.y,
      range: {
        min: container.minY - bounds.minY,
        max: container.maxY - bounds.maxY,
      },
    }),
  };
}

function moveStrokePoints(points: Point2D[], delta: Point2D): Point2D[] {
  return points.map((point) => ({
    x: point.x + delta.x,
    y: point.y + delta.y,
  }));
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

function getResizedObjectFromPatch(
  object: WebGLObject,
  patch: Pick<WebGLObject, "x" | "y" | "width" | "height">,
): WebGLObject {
  if (object.kind !== "text") return { ...object, ...patch };

  const scale = patch.height / Math.max(object.height, 0.001);
  const fontSize = clampTextFontSize(
    (object.fontSize ?? DEFAULT_TEXT_FONT_SIZE) * scale,
  );
  const measured = measureTextObject(
    object.text ?? "",
    fontSize,
    object.fontFamily,
  );

  return {
    ...object,
    x: patch.x,
    y: patch.y,
    width: measured.width,
    height: measured.height,
    fontSize,
  };
}

function hasHorizontalResizeHandle(handle: string): boolean {
  return horizontalResizeHandles.some((axis) => handle.includes(axis));
}

function hasVerticalResizeHandle(handle: string): boolean {
  return verticalResizeHandles.some((axis) => handle.includes(axis));
}

function getTextScaleForResizeHandle(input: {
  handle: string;
  scaleX: number;
  scaleY: number;
}): number {
  const usesX = hasHorizontalResizeHandle(input.handle);
  const usesY = hasVerticalResizeHandle(input.handle);
  if (usesX !== usesY) return usesX ? input.scaleX : input.scaleY;
  return Math.max(input.scaleX, input.scaleY);
}

function getScaledLocalPoint(input: {
  point: Point2D;
  originBounds: PointBounds;
  transform: SharedGroupResizeTransform;
}): Point2D {
  const { point, originBounds, transform } = input;
  const pointLocal = rotatePoint(
    point,
    transform.originCenter,
    -transform.rotation,
  );
  const nextLocalPoint = {
    x:
      transform.localBounds.minX +
      (pointLocal.x - originBounds.minX) * transform.scaleX,
    y:
      transform.localBounds.minY +
      (pointLocal.y - originBounds.minY) * transform.scaleY,
  };
  return rotatePoint(
    nextLocalPoint,
    transform.originCenter,
    transform.rotation,
  );
}

function getResizedSharedGroupObject(input: {
  object: WebGLObject;
  original: SharedGroupResizeObject;
  origin: GroupResizeOrigin;
  transform: SharedGroupResizeTransform;
}): WebGLObject {
  const { object, original, origin, transform } = input;
  const nextCenter = getScaledLocalPoint({
    point: { x: original.x, y: original.y },
    originBounds: origin.bounds,
    transform,
  });

  if (object.kind !== "text") {
    return {
      ...object,
      x: nextCenter.x,
      y: nextCenter.y,
      width: Math.max(18, original.width * transform.scaleX),
      height: Math.max(12, original.height * transform.scaleY),
      rotation: original.rotation ?? object.rotation,
    };
  }

  const fontSize = clampTextFontSize(
    (original.fontSize ?? object.fontSize ?? DEFAULT_TEXT_FONT_SIZE) *
      getTextScaleForResizeHandle({
        handle: origin.handle,
        scaleX: transform.scaleX,
        scaleY: transform.scaleY,
      }),
  );
  const measured = measureTextObject(
    original.text ?? object.text ?? "",
    fontSize,
    original.fontFamily ?? object.fontFamily,
  );

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

function getResizedSharedGroupStroke(input: {
  stroke: Stroke;
  original: SharedGroupResizeStroke;
  origin: GroupResizeOrigin;
  transform: SharedGroupResizeTransform;
}): Stroke {
  const { stroke, original, origin, transform } = input;
  return {
    ...stroke,
    rotation: original.rotation ?? stroke.rotation,
    points: original.points.map((point) =>
      getScaledLocalPoint({
        point,
        originBounds: origin.bounds,
        transform,
      }),
    ),
  };
}

function getRotatedSharedGroupObject(input: {
  object: WebGLObject;
  original: SharedGroupRotateObject;
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

function getRotatedSharedGroupStroke(input: {
  stroke: Stroke;
  original: SharedGroupRotateStroke;
  origin: GroupRotateOrigin;
  angleDelta: number;
}): Stroke {
  const { stroke, original, origin, angleDelta } = input;
  const originalBounds = getPointBounds(original.points);
  const originalCenter = {
    x: originalBounds.centerX,
    y: originalBounds.centerY,
  };
  const nextCenter = rotatePoint(originalCenter, origin.center, angleDelta);
  return {
    ...stroke,
    points: moveStrokePoints(original.points, {
      x: nextCenter.x - originalCenter.x,
      y: nextCenter.y - originalCenter.y,
    }),
    rotation: normalizeRotation((original.rotation ?? 0) + angleDelta),
  };
}

function getStorageAssetUrl(
  response: StorageAssetUploadResponse,
): string | undefined {
  return response.assetUrl ?? response.objectUrl ?? response.presignedGetUrl;
}

function getUploadedImageObject(input: {
  object: WebGLObject;
  upload: StorageAssetUploadResponse;
}): WebGLObject | undefined {
  const url = getStorageAssetUrl(input.upload);
  if (!url) return undefined;

  return {
    ...input.object,
    imageSrc: url,
    imageFileId: input.object.imageFileId ?? input.upload.assetId,
    imageUrl: url,
    imageStorageKey: input.upload.key ?? input.object.imageStorageKey,
    imageMimeType: input.upload.contentType ?? input.object.imageMimeType,
    imageSizeBytes: input.upload.sizeBytes ?? input.object.imageSizeBytes,
    imageSha256: input.upload.sha256 ?? input.object.imageSha256,
    imageStatus: "uploaded",
  };
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Image preview did not produce a data URL"));
    });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image preview"));
    });
    reader.readAsDataURL(file);
  });
}

function EditorPage(): JSX.Element {
  const realtimeInk = useRealtimeInk();
  const [isPerfProbeEnabled] = useState(() => isUrlFlagEnabled("perfProbe"));
  const [isInkDebugEnabled] = useState(() => isUrlFlagEnabled("inkDebug"));
  const [isStorageDebugEnabled] = useState(() =>
    isUrlFlagEnabled("storageDebug"),
  );
  const [isProductTraceEnabled] = useState(
    () => !isUrlFlagDisabled("productTrace"),
  );
  const [isProductTracePanelEnabled] = useState(() =>
    isUrlFlagEnabled("productTracePanel"),
  );
  const [isEditorDebugEnabled] = useState(() =>
    isUrlFlagEnabled("editorDebug"),
  );
  const [isR3fPerfEnabled] = useState(() => isUrlFlagEnabled("r3fPerf"));
  const [initialTool] = useState(() => readInitialTool());
  const [renderStats, setRenderStats] = useState<EditorRenderStats>();
  const sharedMaxLayer = useMemo(
    () =>
      realtimeInk.enabled
        ? Math.max(
            0,
            ...realtimeInk.sharedStrokes.map((stroke) => stroke.layer),
            ...realtimeInk.sharedObjects.map((object) => object.layer),
          )
        : 0,
    [realtimeInk.enabled, realtimeInk.sharedObjects, realtimeInk.sharedStrokes],
  );
  const editor = useEditorState(PAGE_BOUNDS, {
    initialTool,
    sharedMaxLayer,
  });
  const editorObjectsRef = useRef(editor.objects);
  const localImageObjectUrlsRef = useRef<Set<string>>(new Set());
  const [pageZoom, setPageZoom] = useState(1);
  const [comparisonExportRequestId, setComparisonExportRequestId] = useState(0);
  const [localSaveStatus, setLocalSaveStatus] = useState<string>();
  const localSaveStatusTimerRef = useRef<number>();
  const activeReactExam =
    reactExams.find((exam) => exam.id === editor.activeExamPresetId) ??
    reactExams[0];
  const localHandwritingInput = useMemo(
    () =>
      getPentestLocalHandwritingInput({
        roomId: realtimeInk.roomId,
        pageId: realtimeInk.pageId,
      }),
    [realtimeInk.pageId, realtimeInk.roomId],
  );
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
            ...realtimeInk.remoteObjects.filter(
              (object) => !sharedObjectIds.has(object.id),
            ),
          ]
        : editor.objects,
    [
      editor.objects,
      realtimeInk.enabled,
      realtimeInk.remoteObjects,
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
  const showLocalSaveStatus = useCallback((message: string) => {
    setLocalSaveStatus(message);
    if (localSaveStatusTimerRef.current !== undefined) {
      window.clearTimeout(localSaveStatusTimerRef.current);
    }
    localSaveStatusTimerRef.current = window.setTimeout(() => {
      setLocalSaveStatus(undefined);
      localSaveStatusTimerRef.current = undefined;
    }, 2800);
  }, []);
  useEffect(
    () => () => {
      if (localSaveStatusTimerRef.current !== undefined) {
        window.clearTimeout(localSaveStatusTimerRef.current);
      }
      for (const url of localImageObjectUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      localImageObjectUrlsRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    editorObjectsRef.current = editor.objects;
  }, [editor.objects]);
  const localStrokeIds = useMemo(
    () => new Set(editor.strokes.map((stroke) => stroke.id)),
    [editor.strokes],
  );
  const localObjectIds = useMemo(
    () => new Set(editor.objects.map((object) => object.id)),
    [editor.objects],
  );
  const findSharedStroke = useCallback(
    (id: string) =>
      realtimeInk.sharedStrokes.find((stroke) => stroke.id === id),
    [realtimeInk.sharedStrokes],
  );
  const findSharedObject = useCallback(
    (id: string) =>
      realtimeInk.sharedObjects.find((object) => object.id === id),
    [realtimeInk.sharedObjects],
  );
  const commitSharedStroke = useCallback(
    (stroke: Stroke) => {
      realtimeInk.commitStroke(stroke);
      if (localStrokeIds.has(stroke.id)) {
        editor.resizeStroke(stroke.id, stroke.points);
        editor.updateStroke(stroke.id, {
          layer: stroke.layer,
          rotation: stroke.rotation,
          size: stroke.size,
        });
      }
    },
    [editor, localStrokeIds, realtimeInk],
  );
  const commitSharedObjects = useCallback(
    (objects: WebGLObject[]) => {
      if (objects.length === 0) return;
      realtimeInk.commitObjects(objects);
      for (const object of objects) {
        if (!localObjectIds.has(object.id)) continue;
        editor.updateObject(object.id, {
          x: object.x,
          y: object.y,
          width: object.width,
          height: object.height,
          rotation: object.rotation,
          layer: object.layer,
          fontSize: object.fontSize,
          fontFamily: object.fontFamily,
          color: object.color,
          imageSrc: object.imageSrc,
          imageFileId: object.imageFileId,
          imageUrl: object.imageUrl,
          imageThumbnailUrl: object.imageThumbnailUrl,
          imageStorageKey: object.imageStorageKey,
          imageMimeType: object.imageMimeType,
          imageSizeBytes: object.imageSizeBytes,
          imageSha256: object.imageSha256,
          imageStatus: object.imageStatus,
        });
      }
    },
    [editor, localObjectIds, realtimeInk],
  );
  const handleMoveStroke = useCallback(
    (id: string, delta: Point2D) => {
      const sharedStroke = findSharedStroke(id);
      if (!sharedStroke) {
        editor.moveStroke(id, delta);
        return;
      }

      const safeDelta = getBoundedDelta({
        bounds: getPointBounds(sharedStroke.points),
        container: PAGE_BOUNDS,
        delta,
      });
      commitSharedStroke({
        ...sharedStroke,
        points: moveStrokePoints(sharedStroke.points, safeDelta),
      });
    },
    [commitSharedStroke, editor, findSharedStroke],
  );
  const handleMoveObject = useCallback(
    (input: Parameters<typeof editor.moveObject>[0]) => {
      const sharedObject = findSharedObject(input.id);
      if (!sharedObject) {
        editor.moveObject(input);
        return;
      }

      commitSharedObjects([
        clampObjectToBounds(
          {
            ...sharedObject,
            x: input.point.x - input.offset.x,
            y: input.point.y - input.offset.y,
          },
          PAGE_BOUNDS,
        ),
      ]);
    },
    [commitSharedObjects, editor, findSharedObject],
  );
  const handleResizeObject = useCallback(
    (id: string, patch: Pick<WebGLObject, "x" | "y" | "width" | "height">) => {
      const sharedObject = findSharedObject(id);
      if (!sharedObject) {
        editor.resizeObject(id, patch);
        return;
      }

      commitSharedObjects([
        clampObjectToBounds(
          getResizedObjectFromPatch(sharedObject, patch),
          PAGE_BOUNDS,
        ),
      ]);
    },
    [commitSharedObjects, editor, findSharedObject],
  );
  const handleResizeStroke = useCallback(
    (id: string, points: Point2D[]) => {
      const sharedStroke = findSharedStroke(id);
      if (!sharedStroke) {
        editor.resizeStroke(id, points);
        return;
      }

      commitSharedStroke({
        ...sharedStroke,
        points: moveStrokePoints(
          points,
          getBoundedDelta({
            bounds: getPointBounds(points),
            container: PAGE_BOUNDS,
            delta: { x: 0, y: 0 },
          }),
        ),
      });
    },
    [commitSharedStroke, editor, findSharedStroke],
  );
  const handleRotateObject = useCallback(
    (id: string, rotation: number) => {
      const sharedObject = findSharedObject(id);
      if (!sharedObject) {
        editor.rotateObject(id, rotation);
        return;
      }

      commitSharedObjects([{ ...sharedObject, rotation }]);
    },
    [commitSharedObjects, editor, findSharedObject],
  );
  const handleRotateStroke = useCallback(
    (id: string, rotation: number) => {
      const sharedStroke = findSharedStroke(id);
      if (!sharedStroke) {
        editor.rotateStroke(id, rotation);
        return;
      }

      commitSharedStroke({ ...sharedStroke, rotation });
    },
    [commitSharedStroke, editor, findSharedStroke],
  );
  const handleMoveGroup = useCallback(
    (items: SelectionItem[], delta: Point2D) => {
      const groupBounds = getSelectionItemsBounds(
        items,
        visibleStrokes,
        visibleObjects,
      );
      const safeDelta = groupBounds
        ? getBoundedDelta({
            bounds: groupBounds,
            container: PAGE_BOUNDS,
            delta,
          })
        : delta;

      editor.moveGroup(items, safeDelta);

      const nextSharedObjects: WebGLObject[] = [];
      for (const item of items) {
        if (item.type !== "object") continue;
        const object = findSharedObject(item.id);
        if (!object || localObjectIds.has(object.id)) continue;
        nextSharedObjects.push(
          clampObjectToBounds(
            {
              ...object,
              x: object.x + safeDelta.x,
              y: object.y + safeDelta.y,
            },
            PAGE_BOUNDS,
          ),
        );
      }

      if (nextSharedObjects.length > 0) {
        realtimeInk.commitObjects(nextSharedObjects);
      }

      for (const item of items) {
        if (item.type !== "stroke") continue;
        if (localStrokeIds.has(item.id)) continue;
        const stroke = findSharedStroke(item.id);
        if (!stroke) continue;
        realtimeInk.commitStroke({
          ...stroke,
          points: moveStrokePoints(stroke.points, safeDelta),
        });
      }
    },
    [
      editor,
      findSharedObject,
      findSharedStroke,
      localObjectIds,
      localStrokeIds,
      realtimeInk,
      visibleObjects,
      visibleStrokes,
    ],
  );
  const handleResizeGroup = useCallback(
    (origin: GroupResizeOrigin, point: Point2D) => {
      editor.resizeGroup(origin, point);
      const transform = getGroupResizeTransform(origin, point);
      const originalObjects = new Map(
        origin.objects.map((object) => [object.id, object]),
      );
      const originalStrokes = new Map(
        origin.strokes.map((stroke) => [stroke.id, stroke]),
      );
      const nextSharedObjects: WebGLObject[] = [];

      for (const item of origin.items) {
        if (item.type === "object") {
          if (localObjectIds.has(item.id)) continue;
          const object = findSharedObject(item.id);
          const original = originalObjects.get(item.id);
          if (!object || !original) continue;
          nextSharedObjects.push(
            clampObjectToBounds(
              getResizedSharedGroupObject({
                object,
                original,
                origin,
                transform,
              }),
              PAGE_BOUNDS,
            ),
          );
          continue;
        }

        if (localStrokeIds.has(item.id)) continue;
        const stroke = findSharedStroke(item.id);
        const original = originalStrokes.get(item.id);
        if (!stroke || !original) continue;
        realtimeInk.commitStroke(
          getResizedSharedGroupStroke({
            stroke,
            original,
            origin,
            transform,
          }),
        );
      }

      if (nextSharedObjects.length > 0) {
        realtimeInk.commitObjects(nextSharedObjects);
      }
    },
    [
      editor,
      findSharedObject,
      findSharedStroke,
      localObjectIds,
      localStrokeIds,
      realtimeInk,
    ],
  );
  const handleRotateGroup = useCallback(
    (origin: GroupRotateOrigin, angleDelta: number) => {
      editor.rotateGroup(origin, angleDelta);
      const originalObjects = new Map(
        origin.objects.map((object) => [object.id, object]),
      );
      const originalStrokes = new Map(
        origin.strokes.map((stroke) => [stroke.id, stroke]),
      );
      const nextSharedObjects: WebGLObject[] = [];

      for (const item of origin.items) {
        if (item.type === "object") {
          if (localObjectIds.has(item.id)) continue;
          const object = findSharedObject(item.id);
          const original = originalObjects.get(item.id);
          if (!object || !original) continue;
          nextSharedObjects.push(
            getRotatedSharedGroupObject({
              object,
              original,
              origin,
              angleDelta,
            }),
          );
          continue;
        }

        if (localStrokeIds.has(item.id)) continue;
        const stroke = findSharedStroke(item.id);
        const original = originalStrokes.get(item.id);
        if (!stroke || !original) continue;
        realtimeInk.commitStroke(
          getRotatedSharedGroupStroke({
            stroke,
            original,
            origin,
            angleDelta,
          }),
        );
      }

      if (nextSharedObjects.length > 0) {
        realtimeInk.commitObjects(nextSharedObjects);
      }
    },
    [
      editor,
      findSharedObject,
      findSharedStroke,
      localObjectIds,
      localStrokeIds,
      realtimeInk,
    ],
  );
  const handleEraseStroke = useCallback(
    (id: string) => {
      if (localStrokeIds.has(id)) {
        editor.eraseStroke(id);
        return;
      }
      if (sharedStrokeIds.has(id)) {
        realtimeInk.deleteStrokes([id]);
      }
    },
    [editor, localStrokeIds, realtimeInk, sharedStrokeIds],
  );

  useEffect(() => {
    if (!realtimeInk.enabled) return;

    const currentStrokeIds = new Set(editor.strokes.map((stroke) => stroke.id));
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

    const currentObjectIds = new Set(editor.objects.map((object) => object.id));
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
  }, [editor, realtimeInk.enabled, sharedObjectIds, sharedStrokeIds]);

  const handleAddText = useCallback(() => {
    const object = editor.addText();
    if (!object) return;

    localRealtimeObjectIdsRef.current.add(object.id);
    committedObjectSnapshotsRef.current.set(object.id, JSON.stringify(object));
    realtimeInk.commitObjects([object]);
  }, [editor, realtimeInk]);
  const handleRenderStats = useCallback((stats: EditorRenderStats) => {
    setRenderStats(stats);
  }, []);
  const handleImageFileChange = useCallback(
    (event: Parameters<typeof editor.addImageFromFile>[0]) => {
      editor.addImageFromFile(event, (object, file) => {
        if (object.imageSrc?.startsWith("blob:")) {
          localImageObjectUrlsRef.current.add(object.imageSrc);
        }

        const uploadImage = async (): Promise<void> => {
          editor.updateObject(object.id, { imageStatus: "uploading" });

          try {
            const optimized = await optimizeImageForUpload(file);
            const uploadFile = optimized.file;
            const previewDataUrl = await fileToDataUrl(uploadFile);
            realtimeInk.broadcastImagePreview(
              {
                ...object,
                imageMimeType: uploadFile.type || object.imageMimeType,
                imageSizeBytes: uploadFile.size,
                imageStatus: "preview",
              },
              previewDataUrl,
              uploadFile,
            );

            const key = makeStorageAssetKey({
              roomId: realtimeInk.roomId,
              pageId: realtimeInk.pageId,
              fileId: object.imageFileId ?? object.id,
              fileName: uploadFile.name,
              contentType: uploadFile.type || "application/octet-stream",
            });
            const upload = await uploadStorageAsset({
              serverUrl: realtimeInk.serverUrl,
              key,
              file: uploadFile,
            });

            if (!upload.ok) {
              throw new Error(`Image asset upload failed: ${upload.status}`);
            }

            const currentObject =
              editorObjectsRef.current.find((item) => item.id === object.id) ??
              object;
            const uploadedObject = getUploadedImageObject({
              object: currentObject,
              upload,
            });
            if (!uploadedObject) {
              throw new Error("Image asset upload did not return a URL");
            }

            editor.updateObject(object.id, {
              imageSrc: uploadedObject.imageSrc,
              imageFileId: uploadedObject.imageFileId,
              imageUrl: uploadedObject.imageUrl,
              imageStorageKey: uploadedObject.imageStorageKey,
              imageMimeType: uploadedObject.imageMimeType,
              imageSizeBytes: uploadedObject.imageSizeBytes,
              imageSha256: uploadedObject.imageSha256,
              imageStatus: uploadedObject.imageStatus,
            });

            if (object.imageSrc?.startsWith("blob:")) {
              URL.revokeObjectURL(object.imageSrc);
              localImageObjectUrlsRef.current.delete(object.imageSrc);
            }

            localRealtimeObjectIdsRef.current.add(uploadedObject.id);
            committedObjectSnapshotsRef.current.set(
              uploadedObject.id,
              JSON.stringify(uploadedObject),
            );
            realtimeInk.commitObjects([uploadedObject]);
          } catch (error) {
            console.error("Failed to upload image asset", error);
            editor.updateObject(object.id, { imageStatus: "error" });
          }
        };

        void uploadImage();
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
      realtimeInk.beginStroke(
        point,
        {
          color: editor.penColor,
          size: editor.penSize,
          layer: stroke.layer,
        },
        stroke.id,
      );
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
  const handleSaveLocalHandwriting = useCallback(async () => {
    if (isProductTraceEnabled) {
      try {
        const result = await saveProductHandwriting({
          serverUrl: realtimeInk.serverUrl,
          roomId: realtimeInk.roomId,
          pageId: realtimeInk.pageId,
          actorId: realtimeInk.actorId,
          actorRole: realtimeInk.actorRole,
          strokes: visibleStrokes,
          objects: visibleObjects,
        });

        if (!result.ok) {
          throw new Error(`Product handwriting save failed: ${result.status}`);
        }

        console.info("pentest product handwriting saved", {
          result,
          strokesCount: visibleStrokes.length,
          objectsCount: visibleObjects.length,
        });
        showLocalSaveStatus(
          `제품 trace 저장 완료 (${visibleStrokes.length} strokes / ${visibleObjects.length} objects)`,
        );
      } catch (error) {
        console.error("Failed to save product handwriting trace", error);
        showLocalSaveStatus("제품 trace 저장 실패");
      }
      return;
    }

    const snapshot = createPentestHandwritingSnapshot({
      strokes: visibleStrokes,
      objects: visibleObjects,
      context: {
        roomId: realtimeInk.roomId,
        pageId: realtimeInk.pageId,
        actorId: realtimeInk.actorId,
        actorRole: realtimeInk.actorRole,
      },
    });

    try {
      const uploadResult = await savePentestHandwritingSnapshot(
        localHandwritingInput,
        snapshot,
      );
      console.info("pentest local handwriting snapshot saved", {
        input: localHandwritingInput,
        presignedUrl: uploadResult.handwriting.presignedUrl,
        file: uploadResult.storedFile.file,
        elementsCount: snapshot.elements.length,
        strokesCount: visibleStrokes.length,
        objectsCount: visibleObjects.length,
        snapshot,
      });
      showLocalSaveStatus(
        `로컬 저장 완료 (${visibleStrokes.length} strokes / ${visibleObjects.length} objects)`,
      );
    } catch (error) {
      console.error("Failed to save local handwriting snapshot", error);
      showLocalSaveStatus("로컬 저장 실패");
    }
  }, [
    isProductTraceEnabled,
    localHandwritingInput,
    realtimeInk.actorId,
    realtimeInk.actorRole,
    realtimeInk.pageId,
    realtimeInk.roomId,
    realtimeInk.serverUrl,
    showLocalSaveStatus,
    visibleObjects,
    visibleStrokes,
  ]);
  const handleLoadLocalHandwriting = useCallback(async () => {
    if (isProductTraceEnabled) {
      try {
        const result = await loadProductHandwriting({
          serverUrl: realtimeInk.serverUrl,
          roomId: realtimeInk.roomId,
          pageId: realtimeInk.pageId,
          actorId: realtimeInk.actorId,
          actorRole: realtimeInk.actorRole,
        });

        if (!result.ok) {
          throw new Error(`Product handwriting load failed: ${result.status}`);
        }

        if (!result.loaded) {
          showLocalSaveStatus("제품 trace 손필기 데이터가 비어 있습니다");
          return;
        }

        editor.loadSnapshot({
          strokes: result.loaded.strokes,
          objects: result.loaded.objects,
          activeExamPresetId: undefined,
        });
        console.info("pentest product handwriting loaded", {
          result,
          elementsCount: result.loaded.handwritingData.elements.length,
          strokesCount: result.loaded.strokes.length,
          objectsCount: result.loaded.objects.length,
        });
        showLocalSaveStatus(
          `제품 trace 불러오기 완료 (${result.loaded.strokes.length} strokes / ${result.loaded.objects.length} objects)`,
        );
      } catch (error) {
        console.error("Failed to load product handwriting trace", error);
        showLocalSaveStatus("제품 trace 불러오기 실패");
      }
      return;
    }

    try {
      const loaded = loadPentestHandwritingSnapshot(localHandwritingInput);
      if (!loaded) {
        showLocalSaveStatus("저장된 로컬 손필기가 없습니다");
        return;
      }

      editor.loadSnapshot({
        strokes: loaded.strokes,
        objects: loaded.objects,
        activeExamPresetId: undefined,
      });
      console.info("pentest local handwriting snapshot loaded", {
        input: localHandwritingInput,
        elementsCount: loaded.handwritingData.elements.length,
        strokesCount: loaded.strokes.length,
        objectsCount: loaded.objects.length,
        handwritingData: loaded.handwritingData,
      });
      showLocalSaveStatus(
        `로컬 불러오기 완료 (${loaded.strokes.length} strokes / ${loaded.objects.length} objects)`,
      );
    } catch (error) {
      console.error("Failed to load local handwriting snapshot", error);
      showLocalSaveStatus("로컬 불러오기 실패");
    }
  }, [
    editor,
    isProductTraceEnabled,
    localHandwritingInput,
    realtimeInk.actorId,
    realtimeInk.actorRole,
    realtimeInk.pageId,
    realtimeInk.roomId,
    realtimeInk.serverUrl,
    showLocalSaveStatus,
  ]);
  const handleLoadProductTraceSnapshot = useCallback(
    (snapshot: { strokes: Stroke[]; objects: WebGLObject[] }) => {
      editor.loadSnapshot({
        strokes: snapshot.strokes,
        objects: snapshot.objects,
        activeExamPresetId: undefined,
      });
      showLocalSaveStatus(
        `제품 trace 불러오기 완료 (${snapshot.strokes.length} strokes / ${snapshot.objects.length} objects)`,
      );
    },
    [editor, showLocalSaveStatus],
  );

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
        onSaveLocalHandwriting={() => {
          void handleSaveLocalHandwriting();
        }}
        onLoadLocalHandwriting={() => {
          void handleLoadLocalHandwriting();
        }}
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
        localSaveStatus={localSaveStatus}
        saveLabel={isProductTraceEnabled ? "제품 저장" : "로컬 저장"}
        loadLabel={isProductTraceEnabled ? "제품 불러오기" : "로컬 불러오기"}
      />

      {realtimeInk.enabled && isInkDebugEnabled ? (
        <RealtimeInkDebugPanel
          status={realtimeInk.status}
          draftCount={realtimeInk.remoteStrokes.length}
          yjsDebug={realtimeInk.yjsDebug}
          actorRole={realtimeInk.actorRole}
          actorId={realtimeInk.actorId}
          roomId={realtimeInk.roomId}
        />
      ) : null}

      {isPerfProbeEnabled ? (
        <RealtimeInkPerfProbePanel
          status={realtimeInk.status}
          roomId={realtimeInk.roomId}
          actorId={realtimeInk.actorId}
          actorRole={realtimeInk.actorRole}
          strokes={visibleStrokes}
          objects={visibleObjects}
          remoteDraftCount={realtimeInk.remoteStrokes.length}
          yjsDebug={realtimeInk.yjsDebug}
          renderStats={renderStats}
        />
      ) : null}

      {isStorageDebugEnabled ? (
        <StorageTraceDebugPanel
          serverUrl={realtimeInk.serverUrl}
          roomId={realtimeInk.roomId}
          actorId={realtimeInk.actorId}
        />
      ) : null}

      {isProductTracePanelEnabled ? (
        <ProductTracePanel
          serverUrl={realtimeInk.serverUrl}
          roomId={realtimeInk.roomId}
          pageId={realtimeInk.pageId}
          actorId={realtimeInk.actorId}
          actorRole={realtimeInk.actorRole}
          strokes={visibleStrokes}
          objects={visibleObjects}
          onLoadSnapshot={handleLoadProductTraceSnapshot}
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
        showPerformanceMonitor={isR3fPerfEnabled}
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
        onMoveStroke={handleMoveStroke}
        onMoveObject={handleMoveObject}
        onMoveGroup={handleMoveGroup}
        onResizeObject={handleResizeObject}
        onResizeStroke={handleResizeStroke}
        onRotateObject={handleRotateObject}
        onRotateStroke={handleRotateStroke}
        onRotateGroup={handleRotateGroup}
        onResizeGroup={handleResizeGroup}
        onEraseStroke={handleEraseStroke}
        onStartTextEdit={editor.startTextEdit}
        onUpdateTextEdit={editor.updateTextEdit}
        onTextEditKeyDown={editor.handleTextEditKeyDown}
        onCommitTextEdit={editor.commitTextEdit}
        onRenderStats={isPerfProbeEnabled ? handleRenderStats : undefined}
        actorId={realtimeInk.actorId}
      />

      {isEditorDebugEnabled ? (
        <EditorDebugPanel
          selectedObject={editor.selectedObject as WebGLObject | undefined}
          selectedStroke={editor.selectedStroke as Stroke | undefined}
          onUpdateObject={editor.updateObject}
          onUpdateStroke={editor.updateStroke}
        />
      ) : null}
    </main>
  );
}

export default EditorPage;
