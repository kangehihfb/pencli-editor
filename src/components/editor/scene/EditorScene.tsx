import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { ThreeEvent } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ElementRef, KeyboardEvent } from 'react';
import * as THREE from 'three';
import {
  getBoundsFromPoints,
  getEditorPointerPoint,
  getItemsInBounds,
  getObjectBounds,
  getPointBounds,
  getResizedObjectRect,
  getResizedStrokePoints,
  getSceneHits,
  getSelectionItemsBounds,
  getStrokeSelectionThreshold,
  isPointInBounds,
  isPointInResizeHandle,
  isPointNearStroke,
} from '../../../lib/sceneMath';
import type {
  DragState,
  EditingText,
  GroupResizeOrigin,
  MarqueeState,
  Point2D,
  PointBounds,
  ResizeHandle,
  ResizeState,
  SceneHit,
  Selection,
  SelectionItem,
  Stroke,
  Tool,
  WebGLObject,
  ZoomCommand,
} from '../../../types/editor';
import { BoardGrid } from './BoardGrid';
import { MarqueeFrame, ResizeHandleMarker, SelectionFrame } from './SelectionVisuals';
import { StrokeMesh } from './StrokeMesh';
import { TextEditOverlay } from './TextEditOverlay';
import { WebGLObjectMesh } from './WebGLObjectMesh';

const editorPointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const activeExamObjectId = 'object_exam_active';
const cameraFitPadding = 1;
const maxOrthographicZoomScale = 4;

function clampPointToBounds(point: Point2D, bounds: PointBounds) {
  return {
    x: THREE.MathUtils.clamp(point.x, bounds.minX, bounds.maxX),
    y: THREE.MathUtils.clamp(point.y, bounds.minY, bounds.maxY),
  };
}

function getOrthographicFitZoom(camera: THREE.OrthographicCamera, bounds: PointBounds) {
  const frustumWidth = Math.abs(camera.right - camera.left);
  const frustumHeight = Math.abs(camera.top - camera.bottom);
  return Math.min(frustumWidth / bounds.width, frustumHeight / bounds.height) * cameraFitPadding;
}

function getOrthographicVisibleSize(camera: THREE.OrthographicCamera) {
  return {
    width: Math.abs(camera.right - camera.left) / Math.max(camera.zoom, 0.001),
    height: Math.abs(camera.top - camera.bottom) / Math.max(camera.zoom, 0.001),
  };
}

function configureLockedPageCamera(
  camera: THREE.Camera,
  bounds: PointBounds,
  controls: ElementRef<typeof OrbitControls> | null,
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
  selection: Selection;
  groupSelection: SelectionItem[];
  dragState: DragState;
  resizeState: ResizeState;
  editingText: EditingText;
  zoomCommand: ZoomCommand | null;
  drawingBounds: PointBounds | null;
  onSelectionChange: (selection: Selection) => void;
  onGroupSelectionChange: (selection: SelectionItem[]) => void;
  onDragStateChange: (dragState: DragState) => void;
  onResizeStateChange: (resizeState: ResizeState) => void;
  onBeginStroke: (point: Point2D) => void;
  onAppendStrokePoint: (point: Point2D) => void;
  onEndStroke: () => void;
  onMoveStroke: (id: string, delta: Point2D) => void;
  onMoveObject: (id: string, point: Point2D, offset: Point2D) => void;
  onMoveGroup: (items: SelectionItem[], delta: Point2D) => void;
  onResizeObject: (id: string, patch: Pick<WebGLObject, 'x' | 'y' | 'width' | 'height'>) => void;
  onResizeStroke: (id: string, points: Point2D[]) => void;
  onResizeGroup: (origin: GroupResizeOrigin, point: Point2D) => void;
  onEraseStroke: (id: string) => void;
  onStartTextEdit: (object: WebGLObject) => void;
  onTextEditChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTextEditKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCommitTextEdit: () => void;
  renderSceneBackground?: boolean;
  renderVisualLayer?: boolean;
  viewportLocked?: boolean;
};

export function EditorScene({
  tool,
  readonly,
  strokes,
  objects,
  selection,
  groupSelection,
  dragState,
  resizeState,
  editingText,
  zoomCommand,
  drawingBounds,
  onSelectionChange,
  onGroupSelectionChange,
  onDragStateChange,
  onResizeStateChange,
  onBeginStroke,
  onAppendStrokePoint,
  onEndStroke,
  onMoveStroke,
  onMoveObject,
  onMoveGroup,
  onResizeObject,
  onResizeStroke,
  onResizeGroup,
  onEraseStroke,
  onStartTextEdit,
  onTextEditChange,
  onTextEditKeyDown,
  onCommitTextEdit,
  renderSceneBackground = true,
  renderVisualLayer = true,
  viewportLocked = false,
}: EditorSceneProps) {
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const { camera, gl, size } = useThree();
  const pointerRaycasterRef = useRef(new THREE.Raycaster());
  const drawingBoundsRef = useRef(drawingBounds);
  const isClampingCameraRef = useRef(false);
  const [marqueeState, setMarqueeState] = useState<MarqueeState>(null);
  const isDrawingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const lastObjectClickRef = useRef<{ id: string; time: number } | null>(null);
  const groupBounds = useMemo(() => getSelectionItemsBounds(groupSelection, strokes, objects), [groupSelection, objects, strokes]);
  const drawingBoundsKey = drawingBounds
    ? `${drawingBounds.minX}:${drawingBounds.maxX}:${drawingBounds.minY}:${drawingBounds.maxY}`
    : 'none';
  const cameraZoomLimits = useMemo(() => {
    if (!drawingBounds || size.width <= 0 || size.height <= 0) {
      return { min: 0.45, max: 4 };
    }
    const fitZoom = Math.min(size.width / drawingBounds.width, size.height / drawingBounds.height) * cameraFitPadding;
    return {
      min: fitZoom,
      max: fitZoom * maxOrthographicZoomScale,
    };
  }, [drawingBounds, size.height, size.width]);
  const interactionBounds =
    drawingBounds ?? {
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
    drawingBoundsRef.current = drawingBounds;
  }, [drawingBounds]);

  const clampCameraToDrawingBounds = useCallback(
    (fitToBounds = false) => {
      const bounds = drawingBoundsRef.current;
      if (!bounds || size.width <= 0 || size.height <= 0) return;
      if (isClampingCameraRef.current) return;

      const controls = controlsRef.current;
      if (viewportLocked && configureLockedPageCamera(camera, bounds, controls)) {
        return;
      }

      if (camera instanceof THREE.OrthographicCamera) {
        const fitZoom = getOrthographicFitZoom(camera, bounds);
        const nextZoom = fitToBounds
          ? fitZoom
          : THREE.MathUtils.clamp(camera.zoom, fitZoom, fitZoom * maxOrthographicZoomScale);

        camera.zoom = nextZoom;
        const visibleSize = getOrthographicVisibleSize(camera);
        const halfWidth = visibleSize.width / 2;
        const halfHeight = visibleSize.height / 2;
        const currentTarget = controls?.target ?? new THREE.Vector3(bounds.centerX, bounds.centerY, 0);
        const nextTarget = new THREE.Vector3(
          fitToBounds || visibleSize.width >= bounds.width
            ? bounds.centerX
            : THREE.MathUtils.clamp(currentTarget.x, bounds.minX + halfWidth, bounds.maxX - halfWidth),
          fitToBounds || visibleSize.height >= bounds.height
            ? bounds.centerY
            : THREE.MathUtils.clamp(currentTarget.y, bounds.minY + halfHeight, bounds.maxY - halfHeight),
          0,
        );

        isClampingCameraRef.current = true;
        controls?.target.copy(nextTarget);
        camera.position.set(nextTarget.x, nextTarget.y, 7);
        camera.lookAt(nextTarget);
        camera.updateProjectionMatrix();
        controls?.update();
        isClampingCameraRef.current = false;
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

      const currentTarget = controls?.target ?? new THREE.Vector3(bounds.centerX, bounds.centerY, 0);
      const currentDistance = camera.position.distanceTo(currentTarget);
      const nextDistance = fitToBounds ? maxDistance : THREE.MathUtils.clamp(currentDistance, minDistance, maxDistance);
      const visibleHeight = (2 * nextDistance * Math.tan(fov / 2)) / Math.max(camera.zoom, 0.001);
      const visibleWidth = visibleHeight * aspect;
      const halfWidth = visibleWidth / 2;
      const halfHeight = visibleHeight / 2;

      const nextTarget = new THREE.Vector3(
        fitToBounds || visibleWidth >= bounds.width
          ? bounds.centerX
          : THREE.MathUtils.clamp(currentTarget.x, bounds.minX + halfWidth, bounds.maxX - halfWidth),
        fitToBounds || visibleHeight >= bounds.height
          ? bounds.centerY
          : THREE.MathUtils.clamp(currentTarget.y, bounds.minY + halfHeight, bounds.maxY - halfHeight),
        0,
      );

      const direction = camera.position.clone().sub(currentTarget);
      if (direction.lengthSq() < 0.0001) {
        direction.set(0, 0, 1);
      } else {
        direction.normalize();
      }

      isClampingCameraRef.current = true;
      controls?.target.copy(nextTarget);
      camera.position.copy(nextTarget).add(direction.multiplyScalar(nextDistance));
      camera.lookAt(nextTarget);
      camera.updateProjectionMatrix();
      controls?.update();
      isClampingCameraRef.current = false;
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
      controlsRef.current?.target.set(drawingBounds?.centerX ?? 0, drawingBounds?.centerY ?? 0, 0);
      clampCameraToDrawingBounds(true);
      return;
    }

    if (camera instanceof THREE.OrthographicCamera) {
      camera.zoom *= zoomCommand.factor;
    } else {
      camera.zoom = THREE.MathUtils.clamp(camera.zoom * zoomCommand.factor, 0.45, 4);
    }
    camera.updateProjectionMatrix();
    clampCameraToDrawingBounds(false);
  }, [camera, clampCameraToDrawingBounds, drawingBounds?.centerX, drawingBounds?.centerY, viewportLocked, zoomCommand]);

  useEffect(() => {
    const bounds = drawingBoundsRef.current;
    if (!bounds) return;
    if (viewportLocked && configureLockedPageCamera(camera, bounds, controlsRef.current)) {
      return;
    }

    camera.position.set(bounds.centerX, bounds.centerY, 7);
    controlsRef.current?.target.set(bounds.centerX, bounds.centerY, 0);
    clampCameraToDrawingBounds(true);
  }, [camera, clampCameraToDrawingBounds, drawingBoundsKey, size.height, size.width, viewportLocked]);

  const getPointerPointFromClient = useCallback(
    (event: PointerEvent): Point2D | null => {
      const rect = gl.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const pointer = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      const point = new THREE.Vector3();
      const raycaster = pointerRaycasterRef.current;
      camera.updateMatrixWorld();
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.ray.intersectPlane(editorPointerPlane, point);
      if (!hit) return null;
      return { x: point.x, y: point.y };
    },
    [camera, gl.domElement],
  );
  const getPointerPointFromEvent = useCallback((event: ThreeEvent<PointerEvent>) => getEditorPointerPoint(event), []);
  const capturePointer = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const pointerId = event.nativeEvent.pointerId;
      if (gl.domElement.hasPointerCapture?.(pointerId)) return;
      gl.domElement.setPointerCapture?.(pointerId);
      activePointerIdRef.current = pointerId;
    },
    [gl.domElement],
  );
  const releasePointer = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      const pointerId = event.nativeEvent.pointerId;
      if (!gl.domElement.hasPointerCapture?.(pointerId)) return;
      gl.domElement.releasePointerCapture?.(pointerId);
      if (activePointerIdRef.current === pointerId) {
        activePointerIdRef.current = null;
      }
    },
    [gl.domElement],
  );
  const releaseActivePointer = useCallback(() => {
    const pointerId = activePointerIdRef.current;
    if (pointerId === null) return;
    if (gl.domElement.hasPointerCapture?.(pointerId)) {
      gl.domElement.releasePointerCapture?.(pointerId);
    }
    activePointerIdRef.current = null;
  }, [gl.domElement]);
  const getBoundedPoint = useCallback((point: Point2D) => (drawingBounds ? clampPointToBounds(point, drawingBounds) : point), [drawingBounds]);

  const updateResize = useCallback(
    (currentResizeState: ResizeState, point: Point2D) => {
      if (!currentResizeState) return false;
      if (currentResizeState.handle !== 'se') {
        onResizeStateChange(null);
        return false;
      }
      if (currentResizeState.type === 'object') {
        onResizeObject(currentResizeState.id, getResizedObjectRect(currentResizeState.handle, currentResizeState.origin, point));
        return true;
      }

      if (currentResizeState.type === 'group') {
        onResizeGroup(currentResizeState.origin, point);
        return true;
      }

      onResizeStroke(currentResizeState.id, getResizedStrokePoints(currentResizeState.handle, currentResizeState.origin, point));
      return true;
    },
    [onResizeGroup, onResizeObject, onResizeStateChange, onResizeStroke],
  );

  useEffect(() => {
    const stopPointerWork = () => {
      if (isDrawingRef.current) {
        isDrawingRef.current = false;
        onEndStroke();
      }
      releaseActivePointer();
      onDragStateChange(null);
      onResizeStateChange(null);
      setMarqueeState(null);
    };

    window.addEventListener('pointerup', stopPointerWork);
    window.addEventListener('pointercancel', stopPointerWork);
    window.addEventListener('blur', stopPointerWork);
    return () => {
      window.removeEventListener('pointerup', stopPointerWork);
      window.removeEventListener('pointercancel', stopPointerWork);
      window.removeEventListener('blur', stopPointerWork);
    };
  }, [onDragStateChange, onEndStroke, onResizeStateChange, releaseActivePointer]);

  useEffect(() => {
    if (!resizeState || readonly) return;

    const handlePointerMove = (event: PointerEvent) => {
      const point = getPointerPointFromClient(event);
      if (!point) return;
      updateResize(resizeState, getBoundedPoint(point));
    };

    window.addEventListener('pointermove', handlePointerMove);
    return () => window.removeEventListener('pointermove', handlePointerMove);
  }, [getBoundedPoint, getPointerPointFromClient, readonly, resizeState, updateResize]);

  const toPoint = getPointerPointFromEvent;

  const setSelectionItems = (items: SelectionItem[]) => {
    onGroupSelectionChange(items);
    onSelectionChange(items.length === 1 ? items[0] : null);
  };

  const isSelectedItem = (type: SelectionItem['type'], id: string) => groupSelection.some((item) => item.type === type && item.id === id);

  const tryStartGroupMove = (pointer: Point2D) => {
    if (readonly || tool !== 'select' || groupSelection.length < 2 || !groupBounds) return false;
    if (!isPointInBounds(pointer, groupBounds, 8)) return false;
    onResizeStateChange(null);
    onDragStateChange({ type: 'group', items: groupSelection, last: pointer });
    return true;
  };

  const tryStartGroupResize = (pointer: Point2D) => {
    if (readonly || tool !== 'select' || groupSelection.length < 2 || !groupBounds) return false;
    if (!isPointInResizeHandle(pointer, groupBounds, 'object')) return false;

    const objectIds = new Set(groupSelection.filter((item) => item.type === 'object').map((item) => item.id));
    const strokeIds = new Set(groupSelection.filter((item) => item.type === 'stroke').map((item) => item.id));

    onDragStateChange(null);
    onResizeStateChange({
      type: 'group',
      handle: 'se',
      origin: {
        pointer,
        bounds: groupBounds,
        items: groupSelection,
        objects: objects
          .filter((object) => objectIds.has(object.id))
          .map((object) => ({
            id: object.id,
            x: object.x,
            y: object.y,
            width: object.width,
            height: object.height,
          })),
        strokes: strokes
          .filter((stroke) => strokeIds.has(stroke.id))
          .map((stroke) => ({
            id: stroke.id,
            points: stroke.points.map((point) => ({ ...point })),
          })),
      },
    });
    return true;
  };

  const selectFromIntersections = (event: ThreeEvent<PointerEvent>, startDrag: boolean) => {
    const pointer = toPoint(event);
    const objectHits = new Map<string, SceneHit>();
    const strokeHits = new Map<string, SceneHit>();

    for (const hit of getSceneHits(event)) {
      if (hit.type === 'object') {
        if (hit.id === activeExamObjectId) continue;
        objectHits.set(hit.id, { ...hit, point: pointer });
        continue;
      }

      const stroke = strokes.find((item) => item.id === hit.id);
      if (stroke && isPointNearStroke(stroke, pointer, getStrokeSelectionThreshold(stroke))) {
        strokeHits.set(hit.id, { ...hit, point: pointer });
      }
    }

    for (const stroke of strokes) {
      if (isPointNearStroke(stroke, pointer, getStrokeSelectionThreshold(stroke))) {
        strokeHits.set(stroke.id, {
          type: 'stroke',
          id: stroke.id,
          layer: stroke.layer,
          point: pointer,
        });
      }
    }

    const hit = [...strokeHits.values(), ...objectHits.values()].sort((a, b) => b.layer - a.layer)[0];

    if (!hit) return false;

    if (hit.type === 'stroke') {
      const nextSelection: SelectionItem = { type: 'stroke', id: hit.id };
      setSelectionItems([nextSelection]);
      if (startDrag) {
        onResizeStateChange(null);
        onDragStateChange({ type: 'stroke', id: hit.id, last: hit.point });
      }
      return true;
    }

    const object = objects.find((item) => item.id === hit.id);
    if (!object || object.id === activeExamObjectId) return false;

    const nextSelection: SelectionItem = { type: 'object', id: hit.id };
    setSelectionItems([nextSelection]);
    if (startDrag) {
      onResizeStateChange(null);
      onDragStateChange({ type: 'object', id: hit.id, offset: { x: hit.point.x - object.x, y: hit.point.y - object.y } });
    }
    return true;
  };

  const beginObjectResize = (object: WebGLObject, handle: ResizeHandle, pointer: Point2D) => {
    if (readonly || tool !== 'select') return;
    if (handle !== 'se') return;
    setSelectionItems([{ type: 'object', id: object.id }]);
    onDragStateChange(null);
    onResizeStateChange({
      type: 'object',
      id: object.id,
      handle,
      origin: {
        pointer,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
      },
    });
  };

  const beginStrokeResize = (stroke: Stroke, handle: ResizeHandle, pointer: Point2D) => {
    if (readonly || tool !== 'select') return;
    if (handle !== 'se') return;
    setSelectionItems([{ type: 'stroke', id: stroke.id }]);
    onDragStateChange(null);
    onResizeStateChange({
      type: 'stroke',
      id: stroke.id,
      handle,
      origin: {
        pointer,
        points: stroke.points,
        bounds: getPointBounds(stroke.points),
      },
    });
  };

  const beginStrokeMove = (stroke: Stroke, pointer: Point2D) => {
    if (readonly || tool !== 'select') return;
    setSelectionItems([{ type: 'stroke', id: stroke.id }]);
    onResizeStateChange(null);
    onDragStateChange({ type: 'stroke', id: stroke.id, last: pointer });
  };

  const tryStartSelectedResize = (pointer: Point2D) => {
    if (readonly || tool !== 'select' || !selection) return false;

    if (selection.type === 'object') {
      const object = objects.find((item) => item.id === selection.id);
      if (!object || !isPointInResizeHandle(pointer, getObjectBounds(object), 'object')) return false;
      beginObjectResize(object, 'se', pointer);
      return true;
    }

    const stroke = strokes.find((item) => item.id === selection.id);
    if (!stroke || !isPointInResizeHandle(pointer, getPointBounds(stroke.points), 'stroke')) return false;
    beginStrokeResize(stroke, 'se', pointer);
    return true;
  };

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        enableRotate={false}
        enablePan={!viewportLocked && tool === 'pan'}
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
                LEFT: tool === 'pan' ? THREE.MOUSE.PAN : undefined,
                MIDDLE: THREE.MOUSE.DOLLY,
                RIGHT: THREE.MOUSE.PAN,
              }
        }
      />

      {renderSceneBackground ? <BoardGrid /> : null}
      <mesh
        name="editor:interaction-plane"
        position={[interactionBounds.centerX, interactionBounds.centerY, -0.4]}
        onPointerDown={(event) => {
          const rawPoint = toPoint(event);
          const point = getBoundedPoint(rawPoint);
          if (readonly) return;

          if (tool === 'pen') {
            if (drawingBounds && !isPointInBounds(rawPoint, drawingBounds)) return;
            event.stopPropagation();
            isDrawingRef.current = true;
            capturePointer(event);
            onBeginStroke(point);
            return;
          }

          if (tool === 'select') {
            if (tryStartGroupResize(point)) return;
            if (tryStartSelectedResize(point)) return;
            if (tryStartGroupMove(point)) return;
            if (selectFromIntersections(event, true)) return;

            event.stopPropagation();
            capturePointer(event);
            onDragStateChange(null);
            onResizeStateChange(null);
            setMarqueeState({ start: point, current: point });
            setSelectionItems([]);
          }
        }}
        onPointerMove={(event) => {
          const rawPoint = toPoint(event);
          const point = getBoundedPoint(rawPoint);

          if (tool === 'pen' && isDrawingRef.current) {
            if (drawingBounds && !isPointInBounds(rawPoint, drawingBounds)) {
              isDrawingRef.current = false;
              releasePointer(event);
              onEndStroke();
              return;
            }
            event.stopPropagation();
            onAppendStrokePoint(point);
            return;
          }

          if (resizeState && !readonly) {
            event.stopPropagation();
            updateResize(resizeState, point);
            return;
          }

          if (marqueeState && tool === 'select' && !readonly) {
            event.stopPropagation();
            const nextMarquee = { ...marqueeState, current: point };
            setMarqueeState(nextMarquee);
            setSelectionItems(
              getItemsInBounds(getBoundsFromPoints(nextMarquee.start, nextMarquee.current), strokes, objects).filter(
                (item) => item.type !== 'object' || item.id !== activeExamObjectId,
              ),
            );
            return;
          }

          if (!dragState || readonly) return;
          event.stopPropagation();

          if (dragState.type === 'stroke') {
            onMoveStroke(dragState.id, { x: point.x - dragState.last.x, y: point.y - dragState.last.y });
            onDragStateChange({ ...dragState, last: point });
            return;
          }

          if (dragState.type === 'group') {
            onMoveGroup(dragState.items, { x: point.x - dragState.last.x, y: point.y - dragState.last.y });
            onDragStateChange({ ...dragState, last: point });
            return;
          }

          onMoveObject(dragState.id, point, dragState.offset);
        }}
        onPointerUp={(event) => {
          if (tool === 'pen' && isDrawingRef.current) {
            event.stopPropagation();
            isDrawingRef.current = false;
            releasePointer(event);
            onEndStroke();
          }
          onDragStateChange(null);
          onResizeStateChange(null);
          setMarqueeState(null);
        }}
      >
        <planeGeometry args={[interactionBounds.width, interactionBounds.height]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {[...objects]
        .filter((object) => renderSceneBackground || object.id !== activeExamObjectId)
        .sort((a, b) => a.layer - b.layer)
        .map((object) => (
          <WebGLObjectMesh
            key={object.id}
            object={object}
            renderVisual={renderVisualLayer}
            selected={selection?.type === 'object' && selection.id === object.id}
            groupSelected={isSelectedItem('object', object.id)}
            editing={editingText?.id === object.id}
            canResize={tool === 'select'}
            onStartTextEdit={onStartTextEdit}
            onSelect={(event) => {
              if (object.id === activeExamObjectId) return;
              if (readonly) return;
              if (tool === 'erase') return;
              if (tool !== 'select') return;
              event.stopPropagation();
              const point = toPoint(event);
              if (tryStartGroupResize(point)) return;
              if (tryStartSelectedResize(point)) return;
              if (tryStartGroupMove(point)) return;
              const now = performance.now();
              const lastClick = lastObjectClickRef.current;
              if (object.kind === 'text' && lastClick?.id === object.id && now - lastClick.time < 450) {
                onStartTextEdit(object);
                lastObjectClickRef.current = null;
                return;
              }
              lastObjectClickRef.current = { id: object.id, time: now };
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
            selected={selection?.type === 'stroke' && selection.id === stroke.id}
            groupSelected={isSelectedItem('stroke', stroke.id)}
            canMove={tool === 'select'}
            canResize={tool === 'select'}
            onMoveStart={(point) => beginStrokeMove(stroke, point)}
            onSelect={(event) => {
              if (readonly) return;
              if (tool !== 'select' && tool !== 'erase') return;
              event.stopPropagation();
              if (tool === 'erase') {
                onEraseStroke(stroke.id);
                return;
              }
              const point = toPoint(event);
              if (tryStartGroupResize(point)) return;
              if (tryStartSelectedResize(point)) return;
              if (tryStartGroupMove(point)) return;
              selectFromIntersections(event, true);
            }}
          />
        ))}

      {groupSelection.length > 1 && groupBounds ? (
        <group name={`selection:group:${groupSelection.length}`} position={[groupBounds.centerX, groupBounds.centerY, 0.08]}>
          <SelectionFrame name="selection:group:frame" width={groupBounds.width + 28} height={groupBounds.height + 28} />
          <ResizeHandleMarker name="selection:group:resize-handle:se" width={groupBounds.width} height={groupBounds.height} />
        </group>
      ) : null}

      {marqueeState ? <MarqueeFrame name="selection:marquee" bounds={getBoundsFromPoints(marqueeState.start, marqueeState.current)} /> : null}

      {editingText
        ? objects
            .filter((object) => object.id === editingText.id)
            .map((object) => (
              <TextEditOverlay
                key={object.id}
                object={object}
                value={editingText.value}
                onChange={onTextEditChange}
                onKeyDown={onTextEditKeyDown}
                onBlur={onCommitTextEdit}
              />
            ))
        : null}
    </>
  );
}
