import { OrbitControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ElementRef, FocusEvent, KeyboardEvent } from "react";
import * as THREE from "three";
import {
  getBoundsFromPoints,
  getEditorPointerPoint,
  getItemsInBounds,
  getGroupResizeTransform,
  getObjectBounds,
  getPointBounds,
  getPointerAngle,
  getRotatedResizeHandleAtPoint,
  getResizedObjectRect,
  getResizedStrokePoints,
  getSceneHits,
  getSelectionItemsBounds,
  getStrokeSelectionThreshold,
  getUniformResizedObjectRect,
  isPointInBounds,
  isPointInRotatedBounds,
  isPointInRotationHandle,
  isPointNearStroke,
  normalizeRotation,
} from "../../../lib/sceneMath";
import type {
  DragState,
  EditingText,
  GroupRotateOrigin,
  GroupResizeOrigin,
  MarqueeState,
  Point2D,
  PointBounds,
  ResizeHandle,
  ResizeState,
  RotateState,
  SceneHit,
  Selection,
  SelectionItem,
  Stroke,
  Tool,
  WebGLObject,
  ZoomCommand,
} from "../../../types/editor";
import { BoardGrid } from "./BoardGrid";
import {
  MarqueeFrame,
  ResizeHandleMarker,
  RotationHandleMarker,
  SelectionFrame,
} from "./SelectionVisuals";
import { StrokeMesh } from "./StrokeMesh";
import { TextEditOverlay } from "./TextEditOverlay";
import { WebGLObjectMesh } from "./WebGLObjectMesh";

const editorPointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const activeExamObjectId = "object_exam_active";
const cameraFitPadding = 1;
const maxOrthographicZoomScale = 4;

function clampPointToBounds(point: Point2D, bounds: PointBounds) {
  return {
    x: THREE.MathUtils.clamp(point.x, bounds.minX, bounds.maxX),
    y: THREE.MathUtils.clamp(point.y, bounds.minY, bounds.maxY),
  };
}

function getOrthographicFitZoom(
  camera: THREE.OrthographicCamera,
  bounds: PointBounds,
) {
  const frustumWidth = Math.abs(camera.right - camera.left);
  const frustumHeight = Math.abs(camera.top - camera.bottom);
  return (
    Math.min(frustumWidth / bounds.width, frustumHeight / bounds.height) *
    cameraFitPadding
  );
}

function getOrthographicVisibleSize(camera: THREE.OrthographicCamera) {
  return {
    width: Math.abs(camera.right - camera.left) / Math.max(camera.zoom, 0.001),
    height: Math.abs(camera.top - camera.bottom) / Math.max(camera.zoom, 0.001),
  };
}

function getSceneHitRenderOrder(hit: SceneHit) {
  return hit.layer * 10 + (hit.type === "stroke" ? 2 : 0);
}

function getCoalescedPointerEvents(event: PointerEvent) {
  const coalescedEvents =
    typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [];
  if (coalescedEvents.length === 0) return [event];

  const lastEvent = coalescedEvents.at(-1);
  if (
    lastEvent.clientX !== event.clientX ||
    lastEvent.clientY !== event.clientY ||
    lastEvent.pressure !== event.pressure
  ) {
    return [...coalescedEvents, event];
  }

  return coalescedEvents;
}

function translateBounds(bounds: PointBounds, delta: Point2D): PointBounds {
  return {
    ...bounds,
    minX: bounds.minX + delta.x,
    maxX: bounds.maxX + delta.x,
    minY: bounds.minY + delta.y,
    maxY: bounds.maxY + delta.y,
    centerX: bounds.centerX + delta.x,
    centerY: bounds.centerY + delta.y,
  };
}

function configureLockedPageCamera(
  camera: THREE.Camera,
  bounds: PointBounds,
  controls: ElementRef<typeof OrbitControls> | undefined,
) {
  if (!(camera instanceof THREE.OrthographicCamera)) return false;

  camera.left = bounds.minX;
  camera.right = bounds.maxX;
  camera.top = bounds.minY;
  camera.bottom = bounds.maxY;
  camera.zoom = 1;
  camera.position.set(0, 0, 7);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  controls?.target.set(0, 0, 0);
  return true;
}

export type EditorSceneProps = {
  tool: Tool;
  readonly: boolean;
  strokes: Stroke[];
  objects: WebGLObject[];
  activeStrokeId: string | undefined;
  selection: Selection;
  groupSelection: SelectionItem[];
  dragState: DragState;
  resizeState: ResizeState;
  rotateState: RotateState;
  editingText: EditingText;
  zoomCommand: ZoomCommand | undefined;
  drawingBounds: PointBounds | undefined;
  onSelectionChange: (selection: Selection) => void;
  onGroupSelectionChange: (selection: SelectionItem[]) => void;
  onDragStateChange: (dragState: DragState) => void;
  onResizeStateChange: (resizeState: ResizeState) => void;
  onRotateStateChange: (rotateState: RotateState) => void;
  onBeginStroke: (point: Point2D) => void;
  onAppendStrokePoint: (point: Point2D | Point2D[]) => void;
  onEndStroke: () => void;
  onMoveStroke: (id: string, delta: Point2D) => void;
  onMoveObject: (input: {
    id: string;
    point: Point2D;
    offset: Point2D;
  }) => void;
  onMoveGroup: (items: SelectionItem[], delta: Point2D) => void;
  onResizeObject: (
    id: string,
    patch: Pick<WebGLObject, "x" | "y" | "width" | "height">,
  ) => void;
  onResizeStroke: (id: string, points: Point2D[]) => void;
  onRotateObject: (id: string, rotation: number) => void;
  onRotateStroke: (id: string, rotation: number) => void;
  onRotateGroup: (origin: GroupRotateOrigin, angleDelta: number) => void;
  onResizeGroup: (origin: GroupResizeOrigin, point: Point2D) => void;
  onEraseStroke: (id: string) => void;
  onStartTextEdit: (object: WebGLObject) => void;
  onUpdateTextEdit: (value: string) => void;
  onTextEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCommitTextEdit: (value?: string) => void;
  hideEditorChrome?: boolean;
  renderSceneBackground?: boolean;
  renderVisualLayer?: boolean;
  viewportLocked?: boolean;
};

export function EditorScene({
  tool,
  readonly,
  strokes,
  objects,
  activeStrokeId,
  selection,
  groupSelection,
  dragState,
  resizeState,
  rotateState,
  editingText,
  zoomCommand,
  drawingBounds,
  onSelectionChange,
  onGroupSelectionChange,
  onDragStateChange,
  onResizeStateChange,
  onRotateStateChange,
  onBeginStroke,
  onAppendStrokePoint,
  onEndStroke,
  onMoveStroke,
  onMoveObject,
  onMoveGroup,
  onResizeObject,
  onResizeStroke,
  onRotateObject,
  onRotateStroke,
  onRotateGroup,
  onResizeGroup,
  onEraseStroke,
  onStartTextEdit,
  onUpdateTextEdit,
  onTextEditKeyDown,
  onCommitTextEdit,
  hideEditorChrome = false,
  renderSceneBackground = true,
  renderVisualLayer = true,
  viewportLocked = false,
}: EditorSceneProps) {
  const controlsReference = useRef<ElementRef<typeof OrbitControls>>();
  const { camera, gl, size } = useThree();
  const pointerRaycasterReference = useRef(new THREE.Raycaster());
  const drawingBoundsReference = useRef(drawingBounds);
  const isClampingCameraReference = useRef(false);
  const [marqueeState, setMarqueeState] = useState<MarqueeState>();
  const [groupTransformBox, setGroupTransformBox] = useState<{
    itemsKey: string;
    bounds: PointBounds;
    rotation: number;
  } | undefined>();
  const isDrawingReference = useRef(false);
  const activePointerIdReference = useRef<number>();
  const lastObjectClickReference = useRef<{ id: string; time: number }>();
  const groupBounds = useMemo(
    () => getSelectionItemsBounds(groupSelection, strokes, objects),
    [groupSelection, objects, strokes],
  );
  const groupSelectionKey = useMemo(
    () =>
      groupSelection
        .map((item) => `${item.type}:${item.id}`)
        .sort()
        .join("|"),
    [groupSelection],
  );
  const activeGroupBox =
    groupSelection.length > 1 &&
    groupTransformBox?.itemsKey === groupSelectionKey
      ? groupTransformBox
      : undefined;
  const effectiveGroupBounds = activeGroupBox?.bounds ?? groupBounds;
  const effectiveGroupRotation = activeGroupBox?.rotation ?? 0;
  const drawingBoundsKey = drawingBounds
    ? `${drawingBounds.minX}:${drawingBounds.maxX}:${drawingBounds.minY}:${drawingBounds.maxY}`
    : "none";
  const cameraZoomLimits = useMemo(() => {
    if (!drawingBounds || size.width <= 0 || size.height <= 0) {
      return { min: 0.45, max: 4 };
    }
    const fitZoom =
      Math.min(
        size.width / drawingBounds.width,
        size.height / drawingBounds.height,
      ) * cameraFitPadding;
    return {
      min: fitZoom,
      max: fitZoom * maxOrthographicZoomScale,
    };
  }, [drawingBounds, size.height, size.width]);
  const interactionBounds = drawingBounds ?? {
    minX: -50,
    maxX: 50,
    minY: -50,
    maxY: 50,
    centerX: 0,
    centerY: 0,
    width: 100,
    height: 100,
  };

  useEffect(() => {
    drawingBoundsReference.current = drawingBounds;
  }, [drawingBounds]);

  useEffect(() => {
    if (groupSelection.length < 2 || !groupBounds) {
      setGroupTransformBox(undefined);
      return;
    }

    setGroupTransformBox((current) => {
      if (current?.itemsKey === groupSelectionKey) return current;
      return { itemsKey: groupSelectionKey, bounds: groupBounds, rotation: 0 };
    });
  }, [groupBounds, groupSelection.length, groupSelectionKey]);

  const clampCameraToDrawingBounds = useCallback(
    (fitToBounds = false) => {
      const bounds = drawingBoundsReference.current;
      if (!bounds || size.width <= 0 || size.height <= 0) return;
      if (isClampingCameraReference.current) return;

      const controls = controlsReference.current;
      if (
        viewportLocked &&
        configureLockedPageCamera(camera, bounds, controls)
      ) {
        return;
      }

      if (camera instanceof THREE.OrthographicCamera) {
        const fitZoom = getOrthographicFitZoom(camera, bounds);
        const nextZoom = fitToBounds
          ? fitZoom
          : THREE.MathUtils.clamp(
              camera.zoom,
              fitZoom,
              fitZoom * maxOrthographicZoomScale,
            );

        camera.zoom = nextZoom;
        const visibleSize = getOrthographicVisibleSize(camera);
        const halfWidth = visibleSize.width / 2;
        const halfHeight = visibleSize.height / 2;
        const currentTarget =
          controls?.target ??
          new THREE.Vector3(bounds.centerX, bounds.centerY, 0);
        const nextTarget = new THREE.Vector3(
          fitToBounds || visibleSize.width >= bounds.width
            ? bounds.centerX
            : THREE.MathUtils.clamp(
                currentTarget.x,
                bounds.minX + halfWidth,
                bounds.maxX - halfWidth,
              ),
          fitToBounds || visibleSize.height >= bounds.height
            ? bounds.centerY
            : THREE.MathUtils.clamp(
                currentTarget.y,
                bounds.minY + halfHeight,
                bounds.maxY - halfHeight,
              ),
          0,
        );

        isClampingCameraReference.current = true;
        controls?.target.copy(nextTarget);
        camera.position.set(nextTarget.x, nextTarget.y, 7);
        camera.lookAt(nextTarget);
        camera.updateProjectionMatrix();
        controls?.update();
        isClampingCameraReference.current = false;
        return;
      }

      if (!(camera instanceof THREE.PerspectiveCamera)) return;

      const aspect = size.width / size.height;
      const fov = THREE.MathUtils.degToRad(camera.fov);
      const fitDistance = Math.max(
        bounds.height / (2 * Math.tan(fov / 2)),
        bounds.width / (2 * Math.tan(fov / 2) * aspect),
      );
      const maxDistance = fitDistance * Math.max(camera.zoom, 0.001);
      const minDistance = Math.max(0.65, maxDistance * 0.24);

      const currentTarget =
        controls?.target ??
        new THREE.Vector3(bounds.centerX, bounds.centerY, 0);
      const currentDistance = camera.position.distanceTo(currentTarget);
      const nextDistance = fitToBounds
        ? maxDistance
        : THREE.MathUtils.clamp(currentDistance, minDistance, maxDistance);
      const visibleHeight =
        (2 * nextDistance * Math.tan(fov / 2)) / Math.max(camera.zoom, 0.001);
      const visibleWidth = visibleHeight * aspect;
      const halfWidth = visibleWidth / 2;
      const halfHeight = visibleHeight / 2;

      const nextTarget = new THREE.Vector3(
        fitToBounds || visibleWidth >= bounds.width
          ? bounds.centerX
          : THREE.MathUtils.clamp(
              currentTarget.x,
              bounds.minX + halfWidth,
              bounds.maxX - halfWidth,
            ),
        fitToBounds || visibleHeight >= bounds.height
          ? bounds.centerY
          : THREE.MathUtils.clamp(
              currentTarget.y,
              bounds.minY + halfHeight,
              bounds.maxY - halfHeight,
            ),
        0,
      );

      const direction = camera.position.clone().sub(currentTarget);
      if (direction.lengthSq() < 0.0001) {
        direction.set(0, 0, 1);
      } else {
        direction.normalize();
      }

      isClampingCameraReference.current = true;
      controls?.target.copy(nextTarget);
      camera.position
        .copy(nextTarget)
        .add(direction.multiplyScalar(nextDistance));
      camera.lookAt(nextTarget);
      camera.updateProjectionMatrix();
      controls?.update();
      isClampingCameraReference.current = false;
    },
    [camera, size.height, size.width, viewportLocked],
  );

  useEffect(() => {
    if (!zoomCommand) return;
    if (viewportLocked) return;
    if (zoomCommand.factor === 0) {
      camera.position.set(0, 0, 7);
      camera.zoom = 1;
      camera.updateProjectionMatrix();
      controlsReference.current?.target.set(
        drawingBounds?.centerX ?? 0,
        drawingBounds?.centerY ?? 0,
        0,
      );
      clampCameraToDrawingBounds(true);
      return;
    }

    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom *= zoomCommand.factor;
    } else {
      camera.zoom = THREE.MathUtils.clamp(
        camera.zoom * zoomCommand.factor,
        0.45,
        4,
      );
    }
    camera.updateProjectionMatrix();
    clampCameraToDrawingBounds(false);
  }, [
    camera,
    clampCameraToDrawingBounds,
    drawingBounds?.centerX,
    drawingBounds?.centerY,
    viewportLocked,
    zoomCommand,
  ]);

  useEffect(() => {
    const bounds = drawingBoundsReference.current;
    if (!bounds) return;
    if (
      viewportLocked &&
      configureLockedPageCamera(camera, bounds, controlsReference.current)
    ) {
      return;
    }

    camera.position.set(bounds.centerX, bounds.centerY, 7);
    controlsReference.current?.target.set(bounds.centerX, bounds.centerY, 0);
    clampCameraToDrawingBounds(true);
  }, [
    camera,
    clampCameraToDrawingBounds,
    drawingBoundsKey,
    size.height,
    size.width,
    viewportLocked,
  ]);

  const getPointerPointFromClient = useCallback(
    (event: PointerEvent): Point2D | undefined => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return undefined;

      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      const point = new THREE.Vector3();
      const raycaster = pointerRaycasterReference.current;
      camera.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(editorPointerPlane, point);
      if (!hit) return undefined;
      return { x: point.x, y: point.y };
    },
    [camera, gl.domElement],
  );
  const getPointerPointFromEvent = useCallback(
    (event: ThreeEvent<PointerEvent>) => getEditorPointerPoint(event),
    [],
  );
  const capturePointer = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const { pointerId } = event.nativeEvent;
      if (gl.domElement.hasPointerCapture?.(pointerId)) return;
      gl.domElement.setPointerCapture?.(pointerId);
      activePointerIdReference.current = pointerId;
    },
    [gl.domElement],
  );
  const releasePointer = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const { pointerId } = event.nativeEvent;
      if (!gl.domElement.hasPointerCapture?.(pointerId)) return;
      gl.domElement.releasePointerCapture?.(pointerId);
      if (activePointerIdReference.current === pointerId) {
        activePointerIdReference.current = undefined;
      }
    },
    [gl.domElement],
  );
  const releaseActivePointer = useCallback(() => {
    const pointerId = activePointerIdReference.current;
    if (pointerId === undefined) return;
    if (gl.domElement.hasPointerCapture?.(pointerId)) {
      gl.domElement.releasePointerCapture?.(pointerId);
    }
    activePointerIdReference.current = undefined;
  }, [gl.domElement]);
  const getBoundedPoint = useCallback(
    (point: Point2D) =>
      drawingBounds ? clampPointToBounds(point, drawingBounds) : point,
    [drawingBounds],
  );

  const getPointerPointsFromClientEvent = useCallback(
    (event: PointerEvent) =>
      getCoalescedPointerEvents(event)
        .map((pointerEvent) => getPointerPointFromClient(pointerEvent))
        .filter(Boolean),
    [getPointerPointFromClient],
  );

  const appendStrokePointsFromClientEvent = useCallback(
    (event: PointerEvent) => {
      const rawPoints = getPointerPointsFromClientEvent(event);
      if (rawPoints.length === 0) return true;

      const boundedPoints: Point2D[] = [];
      for (const rawPoint of rawPoints) {
        if (drawingBounds && !isPointInBounds(rawPoint, drawingBounds)) {
          if (boundedPoints.length > 0) {
            onAppendStrokePoint(boundedPoints);
          }
          return false;
        }

        boundedPoints.push(getBoundedPoint(rawPoint));
      }

      if (boundedPoints.length > 0) {
        onAppendStrokePoint(boundedPoints);
      }
      return true;
    },
    [
      drawingBounds,
      getBoundedPoint,
      getPointerPointsFromClientEvent,
      onAppendStrokePoint,
    ],
  );

  const finishStrokeFromClientEvent = useCallback(
    (event?: PointerEvent) => {
      if (!isDrawingReference.current) return;
      if (event) {
        appendStrokePointsFromClientEvent(event);
      }
      isDrawingReference.current = false;
      onEndStroke();
    },
    [appendStrokePointsFromClientEvent, onEndStroke],
  );

  const updateResize = useCallback(
    (currentResizeState: ResizeState, point: Point2D) => {
      if (!currentResizeState) return false;
      if (currentResizeState.type === "object") {
        onResizeObject(
          currentResizeState.id,
          currentResizeState.origin.kind === "text"
            ? getUniformResizedObjectRect(
                currentResizeState.handle,
                currentResizeState.origin,
                point,
                0.25,
              )
            : getResizedObjectRect(
                currentResizeState.handle,
                currentResizeState.origin,
                point,
              ),
        );
        return true;
      }

      if (currentResizeState.type === "group") {
        onResizeGroup(currentResizeState.origin, point);
        setGroupTransformBox({
          itemsKey: groupSelectionKey,
          bounds: getGroupResizeTransform(currentResizeState.origin, point)
            .bounds,
          rotation: currentResizeState.origin.rotation ?? 0,
        });
        return true;
      }

      onResizeStroke(
        currentResizeState.id,
        getResizedStrokePoints(
          currentResizeState.handle,
          currentResizeState.origin,
          point,
        ),
      );
      return true;
    },
    [groupSelectionKey, onResizeGroup, onResizeObject, onResizeStroke],
  );

  const updateRotate = useCallback(
    (currentRotateState: RotateState, point: Point2D) => {
      if (!currentRotateState) return false;
      const angle = getPointerAngle(currentRotateState.origin.center, point);
      const angleDelta = angle - currentRotateState.origin.pointerAngle;

      if (currentRotateState.type === "object") {
        onRotateObject(
          currentRotateState.id,
          normalizeRotation(currentRotateState.origin.rotation + angleDelta),
        );
        return true;
      }

      if (currentRotateState.type === "group") {
        const nextRotation = normalizeRotation(
          currentRotateState.origin.rotation + angleDelta,
        );
        onRotateGroup(currentRotateState.origin, angleDelta);
        setGroupTransformBox({
          itemsKey: groupSelectionKey,
          bounds: currentRotateState.origin.bounds,
          rotation: nextRotation,
        });
        return true;
      }

      onRotateStroke(
        currentRotateState.id,
        normalizeRotation(currentRotateState.origin.rotation + angleDelta),
      );
      return true;
    },
    [groupSelectionKey, onRotateGroup, onRotateObject, onRotateStroke],
  );

  useEffect(() => {
    const stopPointerWork = (event?: PointerEvent) => {
      if (isDrawingReference.current) {
        finishStrokeFromClientEvent(event);
      }
      releaseActivePointer();
      onDragStateChange(undefined);
      onResizeStateChange(undefined);
      onRotateStateChange(undefined);
      setMarqueeState(undefined);
    };

    const handlePointerEnd = (event: PointerEvent) => stopPointerWork(event);
    const handleWindowBlur = () => stopPointerWork();

    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, [
    finishStrokeFromClientEvent,
    onDragStateChange,
    onResizeStateChange,
    onRotateStateChange,
    releaseActivePointer,
  ]);

  useEffect(() => {
    if ((!resizeState && !rotateState) || readonly) return;

    const handlePointerMove = (event: PointerEvent) => {
      const point = getPointerPointFromClient(event);
      if (!point) return;
      if (resizeState) {
        updateResize(resizeState, getBoundedPoint(point));
        return;
      }
      updateRotate(rotateState, point);
    };

    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [
    getBoundedPoint,
    getPointerPointFromClient,
    readonly,
    resizeState,
    rotateState,
    updateResize,
    updateRotate,
  ]);

  useEffect(() => {
    if (readonly || tool !== "pen") return;

    const handleDrawingPointerMove: EventListener = (event) => {
      if (!(event instanceof PointerEvent)) return;
      if (!isDrawingReference.current) return;

      const isInsideDrawingBounds = appendStrokePointsFromClientEvent(event);
      if (!isInsideDrawingBounds) {
        isDrawingReference.current = false;
        releaseActivePointer();
        onEndStroke();
      }
    };

    window.addEventListener("pointerrawupdate", handleDrawingPointerMove, true);
    window.addEventListener("pointermove", handleDrawingPointerMove, true);
    return () => {
      window.removeEventListener(
        "pointerrawupdate",
        handleDrawingPointerMove,
        true,
      );
      window.removeEventListener("pointermove", handleDrawingPointerMove, true);
    };
  }, [
    appendStrokePointsFromClientEvent,
    onEndStroke,
    readonly,
    releaseActivePointer,
    tool,
  ]);

  const toPoint = getPointerPointFromEvent;

  const setSelectionItems = (items: SelectionItem[]) => {
    onGroupSelectionChange(items);
    onSelectionChange(items.length === 1 ? items[0] : undefined);
  };

  const isSelectedItem = (type: SelectionItem["type"], id: string) =>
    groupSelection.some((item) => item.type === type && item.id === id);

  const tryStartGroupMove = (pointer: Point2D) => {
    if (
      readonly ||
      tool !== "select" ||
      groupSelection.length < 2 ||
      !effectiveGroupBounds
    )
      return false;
    if (
      !isPointInRotatedBounds(
        pointer,
        effectiveGroupBounds,
        effectiveGroupRotation,
        8,
      )
    )
      return false;
    onResizeStateChange(undefined);
    onRotateStateChange(undefined);
    onDragStateChange({ type: "group", items: groupSelection, last: pointer });
    return true;
  };

  const tryStartGroupResize = (pointer: Point2D) => {
    if (
      readonly ||
      tool !== "select" ||
      groupSelection.length < 2 ||
      !effectiveGroupBounds
    )
      return false;
    const handle = getRotatedResizeHandleAtPoint(
      pointer,
      effectiveGroupBounds,
      "object",
      effectiveGroupRotation,
    );
    if (!handle) return false;

    const objectIds = new Set(
      groupSelection
        .filter((item) => item.type === "object")
        .map((item) => item.id),
    );
    const strokeIds = new Set(
      groupSelection
        .filter((item) => item.type === "stroke")
        .map((item) => item.id),
    );

    onDragStateChange(undefined);
    onRotateStateChange(undefined);
    onResizeStateChange({
      type: "group",
      handle,
      origin: {
        pointer,
        handle,
        rotation: effectiveGroupRotation,
        bounds: effectiveGroupBounds,
        items: groupSelection,
        objects: objects
          .filter((object) => objectIds.has(object.id))
          .map((object) => ({
            id: object.id,
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
            rotation: object.rotation ?? 0,
            kind: object.kind,
            fontSize: object.fontSize,
            fontFamily: object.fontFamily,
            text: object.text,
          })),
        strokes: strokes
          .filter((stroke) => strokeIds.has(stroke.id))
          .map((stroke) => ({
            id: stroke.id,
            points: stroke.points.map((point) => ({ ...point })),
            rotation: stroke.rotation ?? 0,
          })),
      },
    });
    return true;
  };

  const selectFromIntersections = (
    event: ThreeEvent<PointerEvent>,
    startDrag: boolean,
  ) => {
    const pointer = toPoint(event);
    const objectHits = new Map<string, SceneHit>();
    const strokeHits = new Map<string, SceneHit>();

    for (const hit of getSceneHits(event)) {
      if (hit.type === "object") {
        if (hit.id === activeExamObjectId) continue;
        objectHits.set(hit.id, { ...hit, point: pointer });
        continue;
      }

      const stroke = strokes.find((item) => item.id === hit.id);
      if (
        stroke &&
        isPointNearStroke(stroke, pointer, getStrokeSelectionThreshold(stroke))
      ) {
        strokeHits.set(hit.id, { ...hit, point: pointer });
      }
    }

    for (const stroke of strokes) {
      if (
        isPointNearStroke(stroke, pointer, getStrokeSelectionThreshold(stroke))
      ) {
        strokeHits.set(stroke.id, {
          type: "stroke",
          id: stroke.id,
          layer: stroke.layer,
          point: pointer,
        });
      }
    }

    const hit = [...strokeHits.values(), ...objectHits.values()].sort(
      (a, b) => getSceneHitRenderOrder(b) - getSceneHitRenderOrder(a),
    )[0];

    if (!hit) return false;

    if (hit.type === "stroke") {
      const nextSelection: SelectionItem = { type: "stroke", id: hit.id };
      setSelectionItems([nextSelection]);
      if (startDrag) {
        onResizeStateChange(undefined);
        onRotateStateChange(undefined);
        onDragStateChange({ type: "stroke", id: hit.id, last: hit.point });
      }
      return true;
    }

    const object = objects.find((item) => item.id === hit.id);
    if (!object || object.id === activeExamObjectId) return false;

    const nextSelection: SelectionItem = { type: "object", id: hit.id };
    setSelectionItems([nextSelection]);
    if (startDrag) {
      onResizeStateChange(undefined);
      onRotateStateChange(undefined);
      onDragStateChange({
        type: "object",
        id: hit.id,
        offset: { x: hit.point.x - object.x, y: hit.point.y - object.y },
      });
    }
    return true;
  };

  const beginObjectResize = (
    object: WebGLObject,
    handle: ResizeHandle,
    pointer: Point2D,
  ) => {
    if (readonly || tool !== "select") return;
    setSelectionItems([{ type: "object", id: object.id }]);
    onDragStateChange(undefined);
    onRotateStateChange(undefined);
    onResizeStateChange({
      type: "object",
      id: object.id,
      handle,
      origin: {
        pointer,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation ?? 0,
        kind: object.kind,
        fontSize: object.fontSize,
      },
    });
  };

  const beginStrokeResize = (
    stroke: Stroke,
    handle: ResizeHandle,
    pointer: Point2D,
  ) => {
    if (readonly || tool !== "select") return;
    setSelectionItems([{ type: "stroke", id: stroke.id }]);
    onDragStateChange(undefined);
    onRotateStateChange(undefined);
    onResizeStateChange({
      type: "stroke",
      id: stroke.id,
      handle,
      origin: {
        pointer,
        points: stroke.points.map((point) => ({ ...point })),
        bounds: getPointBounds(stroke.points),
        rotation: stroke.rotation ?? 0,
      },
    });
  };

  const beginStrokeMove = (stroke: Stroke, pointer: Point2D) => {
    if (readonly || tool !== "select") return;
    setSelectionItems([{ type: "stroke", id: stroke.id }]);
    onResizeStateChange(undefined);
    onRotateStateChange(undefined);
    onDragStateChange({ type: "stroke", id: stroke.id, last: pointer });
  };

  const beginObjectRotate = (object: WebGLObject, pointer: Point2D) => {
    if (readonly || tool !== "select") return;
    const bounds = getObjectBounds(object);
    const center = { x: bounds.centerX, y: bounds.centerY };
    setSelectionItems([{ type: "object", id: object.id }]);
    onDragStateChange(undefined);
    onResizeStateChange(undefined);
    onRotateStateChange({
      type: "object",
      id: object.id,
      origin: {
        center,
        pointerAngle: getPointerAngle(center, pointer),
        rotation: object.rotation ?? 0,
      },
    });
  };

  const beginStrokeRotate = (stroke: Stroke, pointer: Point2D) => {
    if (readonly || tool !== "select") return;
    const bounds = getPointBounds(stroke.points);
    const center = { x: bounds.centerX, y: bounds.centerY };
    setSelectionItems([{ type: "stroke", id: stroke.id }]);
    onDragStateChange(undefined);
    onResizeStateChange(undefined);
    onRotateStateChange({
      type: "stroke",
      id: stroke.id,
      origin: {
        center,
        pointerAngle: getPointerAngle(center, pointer),
        rotation: stroke.rotation ?? 0,
      },
    });
  };

  const beginGroupRotate = (pointer: Point2D) => {
    if (
      readonly ||
      tool !== "select" ||
      groupSelection.length < 2 ||
      !effectiveGroupBounds
    )
      return;
    const objectIds = new Set(
      groupSelection
        .filter((item) => item.type === "object")
        .map((item) => item.id),
    );
    const strokeIds = new Set(
      groupSelection
        .filter((item) => item.type === "stroke")
        .map((item) => item.id),
    );
    const center = {
      x: effectiveGroupBounds.centerX,
      y: effectiveGroupBounds.centerY,
    };

    onDragStateChange(undefined);
    onResizeStateChange(undefined);
    onRotateStateChange({
      type: "group",
      origin: {
        center,
        pointerAngle: getPointerAngle(center, pointer),
        rotation: effectiveGroupRotation,
        bounds: effectiveGroupBounds,
        items: groupSelection,
        objects: objects
          .filter(
            (object) =>
              objectIds.has(object.id) && object.id !== activeExamObjectId,
          )
          .map((object) => ({
            id: object.id,
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
            rotation: object.rotation ?? 0,
          })),
        strokes: strokes
          .filter((stroke) => strokeIds.has(stroke.id))
          .map((stroke) => ({
            id: stroke.id,
            points: stroke.points.map((point) => ({ ...point })),
            rotation: stroke.rotation ?? 0,
          })),
      },
    });
  };

  const tryStartGroupRotate = (pointer: Point2D) => {
    if (
      readonly ||
      tool !== "select" ||
      groupSelection.length < 2 ||
      !effectiveGroupBounds
    )
      return false;
    if (
      !isPointInRotationHandle(
        pointer,
        effectiveGroupBounds,
        "object",
        effectiveGroupRotation,
      )
    )
      return false;
    beginGroupRotate(pointer);
    return true;
  };

  const tryStartSelectedRotate = (pointer: Point2D) => {
    if (readonly || tool !== "select" || !selection) return false;

    if (selection.type === "object") {
      const object = objects.find((item) => item.id === selection.id);
      if (!object) return false;
      const bounds = getObjectBounds(object);
      if (
        !isPointInRotationHandle(
          pointer,
          bounds,
          "object",
          object.rotation ?? 0,
        )
      )
        return false;
      beginObjectRotate(object, pointer);
      return true;
    }

    const stroke = strokes.find((item) => item.id === selection.id);
    if (!stroke) return false;
    const bounds = getPointBounds(stroke.points);
    if (
      !isPointInRotationHandle(pointer, bounds, "stroke", stroke.rotation ?? 0)
    )
      return false;
    beginStrokeRotate(stroke, pointer);
    return true;
  };

  const tryStartSelectedResize = (pointer: Point2D) => {
    if (readonly || tool !== "select" || !selection) return false;

    if (selection.type === "object") {
      const object = objects.find((item) => item.id === selection.id);
      if (!object) return false;
      const handle = getRotatedResizeHandleAtPoint(
        pointer,
        getObjectBounds(object),
        "object",
        object.rotation ?? 0,
      );
      if (!handle) return false;
      beginObjectResize(object, handle, pointer);
      return true;
    }

    const stroke = strokes.find((item) => item.id === selection.id);
    if (!stroke) return false;
    const handle = getRotatedResizeHandleAtPoint(
      pointer,
      getPointBounds(stroke.points),
      "stroke",
      stroke.rotation ?? 0,
    );
    if (!handle) return false;
    beginStrokeResize(stroke, handle, pointer);
    return true;
  };

  return (
    <>
      <OrbitControls
        ref={controlsReference}
        enableRotate={false}
        enablePan={!viewportLocked && tool === "pan"}
        enableZoom={Boolean(drawingBounds) && !viewportLocked}
        minDistance={0.65}
        maxDistance={80}
        minZoom={cameraZoomLimits.min}
        maxZoom={cameraZoomLimits.max}
        onChange={() => clampCameraToDrawingBounds(false)}
        mouseButtons={
          viewportLocked
            ? {
                LEFT: undefined,
                MIDDLE: undefined,
                RIGHT: undefined,
              }
            : {
                LEFT: tool === "pan" ? THREE.MOUSE.PAN : undefined,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN,
              }
        }
      />

      {renderSceneBackground ? <BoardGrid /> : undefined}
      <mesh
        name="editor:interaction-plane"
        position={[interactionBounds.centerX, interactionBounds.centerY, -0.4]}
        onPointerDown={(event) => {
          const rawPoint = toPoint(event);
          const point = getBoundedPoint(rawPoint);
          if (readonly) return;

          if (tool === "pen") {
            if (drawingBounds && !isPointInBounds(rawPoint, drawingBounds))
              return;
            event.stopPropagation();
            isDrawingReference.current = true;
            capturePointer(event);
            onBeginStroke(point);
            return;
          }

          if (tool === "select") {
            if (tryStartGroupRotate(rawPoint)) {
              capturePointer(event);
              return;
            }
            if (tryStartSelectedRotate(rawPoint)) {
              capturePointer(event);
              return;
            }
            if (tryStartGroupResize(point)) {
              capturePointer(event);
              return;
            }
            if (tryStartSelectedResize(point)) {
              capturePointer(event);
              return;
            }
            if (tryStartGroupMove(point)) {
              capturePointer(event);
              return;
            }
            if (selectFromIntersections(event, true)) {
              capturePointer(event);
              return;
            }

            event.stopPropagation();
            capturePointer(event);
            onDragStateChange(undefined);
            onResizeStateChange(undefined);
            onRotateStateChange(undefined);
            setMarqueeState({ start: point, current: point });
            setSelectionItems([]);
          }
        }}
        onPointerMove={(event) => {
          if (tool === "pen" && isDrawingReference.current) {
            event.stopPropagation();
            return;
          }

          const rawPoint = toPoint(event);
          const point = getBoundedPoint(rawPoint);

          if (resizeState && !readonly) {
            event.stopPropagation();
            updateResize(resizeState, point);
            return;
          }

          if (rotateState && !readonly) {
            event.stopPropagation();
            updateRotate(rotateState, rawPoint);
            return;
          }

          if (marqueeState && tool === "select" && !readonly) {
            event.stopPropagation();
            const nextMarquee = { ...marqueeState, current: point };
            setMarqueeState(nextMarquee);
            setSelectionItems(
              getItemsInBounds(
                getBoundsFromPoints(nextMarquee.start, nextMarquee.current),
                strokes,
                objects,
              ).filter(
                (item) =>
                  item.type !== "object" || item.id !== activeExamObjectId,
              ),
            );
            return;
          }

          if (!dragState || readonly) return;
          event.stopPropagation();

          if (dragState.type === "stroke") {
            onMoveStroke(dragState.id, {
              x: point.x - dragState.last.x,
              y: point.y - dragState.last.y,
            });
            onDragStateChange({ ...dragState, last: point });
            return;
          }

          if (dragState.type === "group") {
            const delta = {
              x: point.x - dragState.last.x,
              y: point.y - dragState.last.y,
            };
            onMoveGroup(dragState.items, delta);
            setGroupTransformBox((current) =>
              current?.itemsKey === groupSelectionKey
                ? { ...current, bounds: translateBounds(current.bounds, delta) }
                : current,
            );
            onDragStateChange({ ...dragState, last: point });
            return;
          }

          onMoveObject({ id: dragState.id, point, offset: dragState.offset });
        }}
        onPointerUp={(event) => {
          if (tool === "pen" && isDrawingReference.current) {
            event.stopPropagation();
            finishStrokeFromClientEvent(event.nativeEvent);
            releasePointer(event);
          }
          onDragStateChange(undefined);
          onResizeStateChange(undefined);
          onRotateStateChange(undefined);
          setMarqueeState(undefined);
        }}
      >
        <planeGeometry
          args={[interactionBounds.width, interactionBounds.height]}
        />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {[...objects]
        .filter(
          (object) => renderSceneBackground || object.id !== activeExamObjectId,
        )
        .sort((a, b) => a.layer - b.layer)
        .map((object) => (
          <WebGLObjectMesh
            key={object.id}
            object={object}
            renderVisual={renderVisualLayer}
            selected={
              !hideEditorChrome &&
              selection?.type === "object" &&
              selection.id === object.id
            }
            groupSelected={
              !hideEditorChrome && isSelectedItem("object", object.id)
            }
            editing={editingText?.id === object.id}
            draftText={
              editingText?.id === object.id ? editingText.value : undefined
            }
            canResize={!hideEditorChrome && tool === "select"}
            onStartTextEdit={onStartTextEdit}
            onSelect={(event) => {
              if (object.id === activeExamObjectId) return;
              if (readonly) return;
              if (tool === "erase") return;
              if (tool !== "select") return;
              event.stopPropagation();
              capturePointer(event);
              const point = toPoint(event);
              if (tryStartGroupRotate(point)) return;
              if (tryStartSelectedRotate(point)) return;
              if (tryStartGroupResize(point)) return;
              if (tryStartSelectedResize(point)) return;
              if (tryStartGroupMove(point)) return;
              const now = performance.now();
              const lastClick = lastObjectClickReference.current;
              if (
                object.kind === "text" &&
                lastClick?.id === object.id &&
                now - lastClick.time < 450
              ) {
                onStartTextEdit(object);
                lastObjectClickReference.current = undefined;
                return;
              }
              lastObjectClickReference.current = { id: object.id, time: now };
              selectFromIntersections(event, true);
            }}
          />
        ))}

      {[...strokes]
        .sort((a, b) => a.layer - b.layer)
        .map((stroke) => (
          <StrokeMesh
            key={stroke.id}
            stroke={stroke}
            renderVisual={renderVisualLayer}
            activelyDrawing={
              tool === "pen" &&
              isDrawingReference.current &&
              stroke.id === activeStrokeId
            }
            hitTestEnabled={
              !readonly && (tool === "select" || tool === "erase")
            }
            selected={
              !hideEditorChrome &&
              selection?.type === "stroke" &&
              selection.id === stroke.id
            }
            groupSelected={
              !hideEditorChrome && isSelectedItem("stroke", stroke.id)
            }
            canMove={tool === "select"}
            canResize={!hideEditorChrome && tool === "select"}
            onMoveStart={(point) => beginStrokeMove(stroke, point)}
            onSelect={(event) => {
              if (readonly) return;
              if (tool !== "select" && tool !== "erase") return;
              event.stopPropagation();
              if (tool === "erase") {
                onEraseStroke(stroke.id);
                return;
              }
              const point = toPoint(event);
              capturePointer(event);
              if (tryStartGroupRotate(point)) return;
              if (tryStartSelectedRotate(point)) return;
              if (tryStartGroupResize(point)) return;
              if (tryStartSelectedResize(point)) return;
              if (tryStartGroupMove(point)) return;
              selectFromIntersections(event, true);
            }}
          />
        ))}

      {!hideEditorChrome &&
      groupSelection.length > 1 &&
      effectiveGroupBounds ? (
        <group
          name={`selection:group:${groupSelection.length}`}
          position={[
            effectiveGroupBounds.centerX,
            effectiveGroupBounds.centerY,
            0.08,
          ]}
          rotation={[0, 0, THREE.MathUtils.degToRad(effectiveGroupRotation)]}
        >
          <SelectionFrame
            name="selection:group:frame"
            width={effectiveGroupBounds.width}
            height={effectiveGroupBounds.height}
            padding={28}
          />
          <ResizeHandleMarker
            name="selection:group:resize-handle:se"
            width={effectiveGroupBounds.width}
            height={effectiveGroupBounds.height}
          />
          <RotationHandleMarker
            name="selection:group:rotation-handle"
            height={effectiveGroupBounds.height}
          />
        </group>
      ) : undefined}

      {!hideEditorChrome && marqueeState ? (
        <MarqueeFrame
          name="selection:marquee"
          bounds={getBoundsFromPoints(marqueeState.start, marqueeState.current)}
        />
      ) : undefined}

      {!hideEditorChrome && editingText
        ? objects
            .filter((object) => object.id === editingText.id)
            .map((object) => (
              <TextEditOverlay
                key={object.id}
                object={object}
                value={editingText.value}
                onChange={onUpdateTextEdit}
                onKeyDown={onTextEditKeyDown}
                onBlur={(event: FocusEvent<HTMLTextAreaElement>) =>
                  onCommitTextEdit(event.currentTarget.value)
                }
              />
            ))
        : undefined}
    </>
  );
}
