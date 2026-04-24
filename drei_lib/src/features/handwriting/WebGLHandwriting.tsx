import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls, Float, Html } from "@react-three/drei";
import CameraControlsImpl from "camera-controls";
import type { OrthographicCamera } from "three";

type Point2D = { x: number; y: number };
type Stroke = Point2D[];
type StressLevel = 5 | 20 | 50;
type ToolMode = "draw" | "select" | "ui" | "pan";
type CanvasRuntime = "detecting" | "webgl" | "webgl2" | "unknown";
type CameraViewState = { zoom: number; x: number; y: number };
type DomItem = {
  id: string;
  kind: "image" | "text";
  x: number;
  y: number;
  width: number;
  height: number;
  text?: string;
  src?: string;
};
type FloatItem = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  speed: number;
  rotationIntensity: number;
  floatIntensity: number;
};
type Metrics = {
  completedStrokes: number;
  activeMoves: number;
  overlayEnterDuringDraw: number;
  overlayLeaveDuringDraw: number;
  pointerCancelCount: number;
  modeSwitches: number;
};
type SelectionInfo =
  | { type: "none"; label: "none"; id: null }
  | { type: "stroke"; label: string; id: string }
  | { type: "dom"; label: string; id: string };
type SelectedBox =
  | { kind: "dom"; id: string; x: number; y: number; width: number; height: number }
  | { kind: "float"; id: string; x: number; y: number; width: number; height: number };

const MIN_POINT_DISTANCE = 1.75;
const DRAW_COLOR = "#7dd3fc";
const DRAW_WIDTH = 2.2;
const SELECT_COLOR = "#facc15";
const SELECT_WIDTH = 3;
const STROKE_HIT_THRESHOLD = 8;
const SAMPLE_IMAGE_SRC =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 200'%3E%3Crect width='320' height='200' fill='%23131b27'/%3E%3Crect x='10' y='10' width='300' height='180' rx='14' fill='%23203248'/%3E%3Ccircle cx='85' cy='78' r='24' fill='%2367e8f9'/%3E%3Cpath d='M24 160l74-58 45 35 52-46 100 69H24z' fill='%2393c5fd'/%3E%3Ctext x='160' y='42' text-anchor='middle' fill='%23dbeafe' font-family='Arial' font-size='16'%3ESample Photo%3C/text%3E%3C/svg%3E";

function makeDefaultFloatItem(index: number): FloatItem {
  return {
    id: `float-${index + 1}`,
    label: `Float ${index + 1}`,
    x: 20 + (index % 10) * 96,
    y: 88 + Math.floor(index / 10) * 58,
    width: 88,
    height: 32,
    speed: 0.6 + (index % 5) * 0.15,
    rotationIntensity: 0.12 + (index % 3) * 0.08,
    floatIntensity: 0.6
  };
}

function CanvasRuntimeProbe({
  onRuntime
}: {
  onRuntime: (runtime: CanvasRuntime) => void;
}) {
  const gl = useThree((state) => state.gl);

  useEffect(() => {
    const context = gl.getContext();
    if (!context) {
      onRuntime("unknown");
      return;
    }
    if ("WebGL2RenderingContext" in window && context instanceof WebGL2RenderingContext) {
      onRuntime("webgl2");
      return;
    }
    onRuntime("webgl");
  }, [gl, onRuntime]);

  return null;
}

function OverlaySyncProbe({
  onOffsetChange
}: {
  onOffsetChange: (offset: OverlayOffset) => void;
}) {
  const camera = useThree((state) => state.camera);
  const viewport = useThree((state) => state.viewport);
  const size = useThree((state) => state.size);
  const lastOffsetRef = useRef<OverlayOffset>({ x: 0, y: 0 });

  useFrame(() => {
    const pxPerWorldX = size.width / viewport.width;
    const pxPerWorldY = size.height / viewport.height;
    const next = {
      x: -camera.position.x * pxPerWorldX,
      y: camera.position.y * pxPerWorldY
    };
    const prev = lastOffsetRef.current;
    if (Math.abs(next.x - prev.x) < 0.1 && Math.abs(next.y - prev.y) < 0.1) {
      return;
    }
    lastOffsetRef.current = next;
    onOffsetChange(next);
  });

  return null;
}

function CameraViewProbe({
  onViewChange
}: {
  onViewChange: (view: CameraViewState) => void;
}) {
  const camera = useThree((state) => state.camera);
  const lastRef = useRef<CameraViewState | null>(null);

  useFrame(() => {
    const ortho = camera as OrthographicCamera;
    const next: CameraViewState = {
      zoom: "zoom" in ortho ? ortho.zoom : 1,
      x: camera.position.x,
      y: camera.position.y
    };
    const prev = lastRef.current;
    if (
      prev &&
      Math.abs(prev.zoom - next.zoom) < 0.001 &&
      Math.abs(prev.x - next.x) < 0.001 &&
      Math.abs(prev.y - next.y) < 0.001
    ) {
      return;
    }
    lastRef.current = next;
    onViewChange(next);
  });

  return null;
}

function SceneBackground() {
  const viewport = useThree((state) => state.viewport);
  return (
    <mesh position={[0, 0, -0.2]}>
      <planeGeometry args={[viewport.width, viewport.height]} />
      <meshBasicMaterial color="#0f1724" />
    </mesh>
  );
}

function PanCameraControls({ enabled }: { enabled: boolean }) {
  const ACTION = CameraControlsImpl.ACTION;

  return (
    <CameraControls
      enabled={enabled}
      minZoom={120}
      maxZoom={1200}
      dollyToCursor={false}
      mouseButtons={{
        left: ACTION.TRUCK,
        middle: ACTION.ZOOM,
        right: ACTION.NONE,
        wheel: ACTION.ZOOM
      }}
      touches={{
        one: ACTION.NONE,
        two: ACTION.TOUCH_ZOOM_TRUCK,
        three: ACTION.NONE
      }}
    />
  );
}

function DomDrawingOverlay({
  toolMode,
  overlayOffset,
  selectedBox,
  onSelectedBoxChange,
  onStrokeCountChange,
  onMetrics,
  onDrawingStateChange,
  onSelectionChange
}: {
  toolMode: ToolMode;
  overlayOffset: OverlayOffset;
  selectedBox: SelectedBox | null;
  onSelectedBoxChange: (box: SelectedBox, patch: Partial<DomItem | FloatItem>) => void;
  onStrokeCountChange: (count: number) => void;
  onMetrics: Dispatch<SetStateAction<Metrics>>;
  onDrawingStateChange: (isActive: boolean) => void;
  onSelectionChange: (selection: SelectionInfo) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const activeStrokeRef = useRef<Stroke | null>(null);
  const pointerOwnerRef = useRef<number | null>(null);
  const selectedStrokeIndexRef = useRef<number | null>(null);
  const overHtmlRef = useRef(false);
  const resizeStateRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const moveStateRef = useRef<{
    type: "box" | "stroke";
    id: string;
    startX: number;
    startY: number;
    startLeft?: number;
    startTop?: number;
  } | null>(null);
  const strokeResizeStateRef = useRef<{
    index: number;
    startX: number;
    startY: number;
    minX: number;
    minY: number;
    width: number;
    height: number;
    points: Stroke;
  } | null>(null);

  const drawStroke = (
    ctx: CanvasRenderingContext2D,
    stroke: Stroke,
    options: { color: string; width: number }
  ) => {
    if (stroke.length < 2) return;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = options.color;
    ctx.lineWidth = options.width;
    ctx.beginPath();
    ctx.moveTo(stroke[0].x, stroke[0].y);
    for (let i = 1; i < stroke.length; i += 1) {
      ctx.lineTo(stroke[i].x, stroke[i].y);
    }
    ctx.stroke();
  };

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    for (let i = 0; i < strokesRef.current.length; i += 1) {
      const isSelected = i === selectedStrokeIndexRef.current;
      drawStroke(ctx, strokesRef.current[i], {
        color: isSelected ? SELECT_COLOR : DRAW_COLOR,
        width: isSelected ? SELECT_WIDTH : DRAW_WIDTH
      });
    }
    if (activeStrokeRef.current) {
      drawStroke(ctx, activeStrokeRef.current, {
        color: DRAW_COLOR,
        width: DRAW_WIDTH
      });
    }

    if (selectedStrokeIndexRef.current !== null) {
      const stroke = strokesRef.current[selectedStrokeIndexRef.current];
      if (stroke && stroke.length > 1) {
        const xs = stroke.map((p) => p.x);
        const ys = stroke.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const handleSize = 14;
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
        ctx.lineWidth = 1;
        ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(250, 204, 21, 0.95)";
        ctx.fillRect(maxX - handleSize, maxY - handleSize, handleSize, handleSize);
      }
    }
  };

  const resizeCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  };

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, []);

  const pointFromEvent = (event: PointerEvent): Point2D => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  };

  const updateOverlayCrossingMetric = (event: PointerEvent) => {
    const underPointer = document
      .elementsFromPoint(event.clientX, event.clientY)
      .some((el) => el instanceof HTMLElement && el.classList.contains("overlay-pill"));

    if (underPointer && !overHtmlRef.current) {
      onMetrics((prev) => ({
        ...prev,
        overlayEnterDuringDraw: prev.overlayEnterDuringDraw + 1
      }));
    }
    if (!underPointer && overHtmlRef.current) {
      onMetrics((prev) => ({
        ...prev,
        overlayLeaveDuringDraw: prev.overlayLeaveDuringDraw + 1
      }));
    }
    overHtmlRef.current = underPointer;
  };

  const beginStroke = (event: PointerEvent) => {
    const point = pointFromEvent(event);
    activeStrokeRef.current = [point];
    selectedStrokeIndexRef.current = null;
    overHtmlRef.current = false;
    onDrawingStateChange(true);
    onSelectionChange({ type: "none", label: "none", id: null });
  };

  const appendStrokePoint = (event: PointerEvent) => {
    const point = pointFromEvent(event);
    const stroke = activeStrokeRef.current;
    if (!stroke) return;
    const last = stroke[stroke.length - 1];
    const dx = point.x - last.x;
    const dy = point.y - last.y;
    if (Math.hypot(dx, dy) < MIN_POINT_DISTANCE) return;
    stroke.push(point);
    onMetrics((prev) => ({ ...prev, activeMoves: prev.activeMoves + 1 }));
    updateOverlayCrossingMetric(event);
    redraw();
  };

  const endStroke = () => {
    const stroke = activeStrokeRef.current;
    activeStrokeRef.current = null;
    pointerOwnerRef.current = null;
    overHtmlRef.current = false;
    onDrawingStateChange(false);
    if (!stroke || stroke.length < 2) {
      redraw();
      return;
    }
    strokesRef.current.push(stroke);
    onStrokeCountChange(strokesRef.current.length);
    onMetrics((prev) => ({
      ...prev,
      completedStrokes: prev.completedStrokes + 1
    }));
    redraw();
  };

  const distancePointToSegment = (point: Point2D, a: Point2D, b: Point2D): number => {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = point.x - a.x;
    const apy = point.y - a.y;
    const abLenSq = abx * abx + aby * aby;
    if (abLenSq === 0) return Math.hypot(apx, apy);
    const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq));
    const cx = a.x + abx * t;
    const cy = a.y + aby * t;
    return Math.hypot(point.x - cx, point.y - cy);
  };

  const findStrokeHit = (point: Point2D): number | null => {
    for (let i = strokesRef.current.length - 1; i >= 0; i -= 1) {
      const stroke = strokesRef.current[i];
      for (let j = 1; j < stroke.length; j += 1) {
        if (distancePointToSegment(point, stroke[j - 1], stroke[j]) <= STROKE_HIT_THRESHOLD) {
          return i;
        }
      }
    }
    return null;
  };

  const findTopSelectableDom = (event: PointerEvent): HTMLElement | null => {
    const stack = document.elementsFromPoint(event.clientX, event.clientY);
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.dataset.selectable !== "true") continue;
      return el;
    }
    return null;
  };

  const getSelectedStrokeBounds = () => {
    if (selectedStrokeIndexRef.current === null) return null;
    const stroke = strokesRef.current[selectedStrokeIndexRef.current];
    if (!stroke || stroke.length < 2) return null;
    const xs = stroke.map((p) => p.x);
    const ys = stroke.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
  };

  const isOnSelectedStrokeResizeHandle = (point: Point2D): boolean => {
    const bounds = getSelectedStrokeBounds();
    if (!bounds) return false;
    const handleSize = 14;
    return (
      point.x >= bounds.maxX - handleSize &&
      point.x <= bounds.maxX &&
      point.y >= bounds.maxY - handleSize &&
      point.y <= bounds.maxY
    );
  };

  const isInsideSelectedStrokeBounds = (point: Point2D): boolean => {
    const bounds = getSelectedStrokeBounds();
    if (!bounds) return false;
    return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  };

  const selectAtPoint = (event: PointerEvent) => {
    const point = pointFromEvent(event);
    const hitStrokeIndex = findStrokeHit(point);
    if (hitStrokeIndex !== null) {
      selectedStrokeIndexRef.current = hitStrokeIndex;
      redraw();
      onSelectionChange({
        type: "stroke",
        id: `stroke-${hitStrokeIndex}`,
        label: `stroke ${hitStrokeIndex + 1}`
      });
      return;
    }

    selectedStrokeIndexRef.current = null;
    redraw();

    const domTarget = findTopSelectableDom(event);
    if (domTarget) {
      const id = domTarget.dataset.nodeId || "dom-unknown";
      const label = domTarget.dataset.nodeLabel || id;
      onSelectionChange({ type: "dom", id, label });
      return;
    }
    onSelectionChange({ type: "none", label: "none", id: null });
  };

  const isOnSelectedResizeHandle = (point: Point2D): boolean => {
    if (!selectedBox) return false;
    const handleSize = 18;
    const handleLeft = selectedBox.x + selectedBox.width - handleSize;
    const handleTop = selectedBox.y + selectedBox.height - handleSize;
    return point.x >= handleLeft && point.x <= handleLeft + handleSize && point.y >= handleTop && point.y <= handleTop + handleSize;
  };

  const isInsideSelectedBox = (point: Point2D): boolean => {
    if (!selectedBox) return false;
    return (
      point.x >= selectedBox.x &&
      point.x <= selectedBox.x + selectedBox.width &&
      point.y >= selectedBox.y &&
      point.y <= selectedBox.y + selectedBox.height
    );
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (toolMode === "ui" || toolMode === "pan") return;
    if (toolMode === "select") {
      const point = pointFromEvent(event.nativeEvent);
      if (isOnSelectedStrokeResizeHandle(point) && selectedStrokeIndexRef.current !== null) {
        const bounds = getSelectedStrokeBounds();
        const stroke = strokesRef.current[selectedStrokeIndexRef.current];
        if (!bounds || !stroke) return;
        pointerOwnerRef.current = event.pointerId;
        strokeResizeStateRef.current = {
          index: selectedStrokeIndexRef.current,
          startX: point.x,
          startY: point.y,
          minX: bounds.minX,
          minY: bounds.minY,
          width: Math.max(1, bounds.width),
          height: Math.max(1, bounds.height),
          points: stroke.map((p) => ({ x: p.x, y: p.y }))
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (isInsideSelectedStrokeBounds(point) && selectedStrokeIndexRef.current !== null) {
        pointerOwnerRef.current = event.pointerId;
        moveStateRef.current = {
          type: "stroke",
          id: `stroke-${selectedStrokeIndexRef.current}`,
          startX: point.x,
          startY: point.y
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (isOnSelectedResizeHandle(point) && selectedBox) {
        pointerOwnerRef.current = event.pointerId;
        resizeStateRef.current = {
          id: selectedBox.id,
          startX: point.x,
          startY: point.y,
          startWidth: selectedBox.width,
          startHeight: selectedBox.height
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      if (isInsideSelectedBox(point) && selectedBox) {
        pointerOwnerRef.current = event.pointerId;
        moveStateRef.current = {
          type: "box",
          id: selectedBox.id,
          startX: point.x,
          startY: point.y,
          startLeft: selectedBox.x,
          startTop: selectedBox.y
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      const strokePoint = pointFromEvent(event.nativeEvent);
      const hitStrokeIndex = findStrokeHit(strokePoint);
      if (hitStrokeIndex !== null) {
        pointerOwnerRef.current = event.pointerId;
        moveStateRef.current = {
          type: "stroke",
          id: `stroke-${hitStrokeIndex}`,
          startX: strokePoint.x,
          startY: strokePoint.y
        };
        selectedStrokeIndexRef.current = hitStrokeIndex;
        redraw();
        onSelectionChange({
          type: "stroke",
          id: `stroke-${hitStrokeIndex}`,
          label: `stroke ${hitStrokeIndex + 1}`
        });
        event.currentTarget.setPointerCapture(event.pointerId);
        return;
      }
      selectAtPoint(event.nativeEvent);
      return;
    }
    if (pointerOwnerRef.current !== null) return;
    pointerOwnerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    beginStroke(event.nativeEvent);
    redraw();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (toolMode === "select") {
      if (pointerOwnerRef.current !== event.pointerId) return;
      const point = pointFromEvent(event.nativeEvent);
      if (strokeResizeStateRef.current) {
        const state = strokeResizeStateRef.current;
        const stroke = strokesRef.current[state.index];
        if (!stroke) return;
        const scaleX = Math.max(0.2, (state.width + (point.x - state.startX)) / state.width);
        const scaleY = Math.max(0.2, (state.height + (point.y - state.startY)) / state.height);
        for (let i = 0; i < stroke.length; i += 1) {
          const p = state.points[i];
          stroke[i] = {
            x: state.minX + (p.x - state.minX) * scaleX,
            y: state.minY + (p.y - state.minY) * scaleY
          };
        }
        redraw();
        return;
      }
      if (resizeStateRef.current && selectedBox) {
        const dx = point.x - resizeStateRef.current.startX;
        const dy = point.y - resizeStateRef.current.startY;
        onSelectedBoxChange(selectedBox, {
          width: Math.max(80, resizeStateRef.current.startWidth + dx),
          height: Math.max(56, resizeStateRef.current.startHeight + dy)
        });
      }
      if (moveStateRef.current?.type === "box" && selectedBox && moveStateRef.current.startLeft !== undefined && moveStateRef.current.startTop !== undefined) {
        const dx = point.x - moveStateRef.current.startX;
        const dy = point.y - moveStateRef.current.startY;
        onSelectedBoxChange(selectedBox, {
          x: moveStateRef.current.startLeft + dx,
          y: moveStateRef.current.startTop + dy
        });
      }
      if (moveStateRef.current?.type === "stroke" && selectedStrokeIndexRef.current !== null) {
        const dx = point.x - moveStateRef.current.startX;
        const dy = point.y - moveStateRef.current.startY;
        const stroke = strokesRef.current[selectedStrokeIndexRef.current];
        if (!stroke) return;
        for (let i = 0; i < stroke.length; i += 1) {
          stroke[i] = { x: stroke[i].x + dx, y: stroke[i].y + dy };
        }
        moveStateRef.current.startX = point.x;
        moveStateRef.current.startY = point.y;
        redraw();
      }
      return;
    }
    if (toolMode !== "draw") return;
    if (pointerOwnerRef.current !== event.pointerId) return;
    appendStrokePoint(event.nativeEvent);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerOwnerRef.current !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (toolMode === "select") {
      pointerOwnerRef.current = null;
      resizeStateRef.current = null;
      moveStateRef.current = null;
      strokeResizeStateRef.current = null;
      return;
    }
    endStroke();
  };

  const onPointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerOwnerRef.current !== event.pointerId) return;
    if (toolMode === "select") {
      pointerOwnerRef.current = null;
      resizeStateRef.current = null;
      moveStateRef.current = null;
      strokeResizeStateRef.current = null;
      return;
    }
    onMetrics((prev) => ({
      ...prev,
      pointerCancelCount: prev.pointerCancelCount + 1
    }));
    endStroke();
  };

  useEffect(() => {
    const onWindowPointerUp = () => {
      if (toolMode === "draw" && pointerOwnerRef.current !== null) {
        endStroke();
        return;
      }
      if (toolMode === "select" && pointerOwnerRef.current !== null) {
        pointerOwnerRef.current = null;
        resizeStateRef.current = null;
        moveStateRef.current = null;
        strokeResizeStateRef.current = null;
      }
    };
    window.addEventListener("pointerup", onWindowPointerUp);
    return () => {
      window.removeEventListener("pointerup", onWindowPointerUp);
    };
  }, [toolMode]);

  return (
    <canvas
      ref={canvasRef}
      className={`drawing-overlay is-${toolMode}`}
      style={{ transform: `translate3d(${overlayOffset.x}px, ${overlayOffset.y}px, 0)` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    />
  );
}

function FloatingOverlay({
  item,
  overlayInteractive,
  selectedDomId,
  overlayOffset,
  toolMode
}: {
  item: FloatItem;
  overlayInteractive: boolean;
  selectedDomId: string | null;
  overlayOffset: OverlayOffset;
  toolMode: ToolMode;
}) {
  const size = useThree((state) => state.size);
  const viewport = useThree((state) => state.viewport);
  const camera = useThree((state) => state.camera);
  const domId = item.id;
  const centerPxX = item.x + overlayOffset.x + item.width / 2;
  const centerPxY = item.y + overlayOffset.y + item.height / 2;
  const x = camera.position.x + (centerPxX / size.width - 0.5) * viewport.width;
  const y = camera.position.y + (0.5 - centerPxY / size.height) * viewport.height;
  const speed = item.speed;
  const rotationIntensity = item.rotationIntensity;

  return (
    <Float speed={speed} rotationIntensity={rotationIntensity} floatIntensity={item.floatIntensity}>
      <group position={[x, y, 0.02]}>
        <Html
          transform={false}
          center
          zIndexRange={[5, 0]}
          style={{
            pointerEvents: overlayInteractive ? "auto" : "none"
          }}
        >
          <button
            type="button"
            className={`overlay-pill ${selectedDomId === domId ? "is-selected" : ""}`}
            data-selectable="true"
            data-node-id={domId}
            data-node-label={item.label}
            style={{ width: item.width, height: item.height }}
          >
            {item.label}
            {toolMode === "select" && selectedDomId === domId ? <span className="overlay-resize-handle" /> : null}
          </button>
        </Html>
      </group>
    </Float>
  );
}

function HtmlArtifactOverlay({
  item,
  index,
  overlayInteractive,
  selectedDomId,
  overlayOffset,
  toolMode
}: {
  item: DomItem;
  index: number;
  overlayInteractive: boolean;
  selectedDomId: string | null;
  overlayOffset: OverlayOffset;
  toolMode: ToolMode;
}) {
  const size = useThree((state) => state.size);
  const viewport = useThree((state) => state.viewport);
  const camera = useThree((state) => state.camera);
  const centerPxX = item.x + overlayOffset.x + item.width / 2;
  const centerPxY = item.y + overlayOffset.y + item.height / 2;
  const worldX = camera.position.x + (centerPxX / size.width - 0.5) * viewport.width;
  const worldY = camera.position.y + (0.5 - centerPxY / size.height) * viewport.height;

  return (
    <group position={[worldX, worldY, 0.03]}>
      <Html
        transform={false}
        center
        zIndexRange={[8, 0]}
        style={{ pointerEvents: overlayInteractive ? "auto" : "none" }}
      >
        <div
          className={`${item.kind === "image" ? "dom-node dom-photo" : "dom-text-inline"} ${
            selectedDomId === item.id ? "is-selected" : ""
          }`}
          data-selectable="true"
          data-node-id={item.id}
          data-node-label={item.kind === "image" ? `Image ${index + 1}` : `Text ${index + 1}`}
          style={{
            width: item.width,
            height: item.kind === "image" ? item.height : "auto"
          }}
        >
          {item.kind === "image" ? (
            <img src={item.src || SAMPLE_IMAGE_SRC} alt={`Overlay ${index + 1}`} draggable={false} />
          ) : (
            <span>{item.text || "New text note"}</span>
          )}
          {toolMode === "select" && selectedDomId === item.id ? <div className="dom-resize-handle" /> : null}
        </div>
      </Html>
    </group>
  );
}

function HtmlArtifacts({
  items,
  overlayInteractive,
  selectedDomId,
  overlayOffset,
  toolMode
}: {
  items: DomItem[];
  overlayInteractive: boolean;
  selectedDomId: string | null;
  overlayOffset: OverlayOffset;
  toolMode: ToolMode;
}) {
  return (
    <>
      {items.map((item, index) => (
        <HtmlArtifactOverlay
          key={item.id}
          item={item}
          index={index}
          overlayInteractive={overlayInteractive}
          selectedDomId={selectedDomId}
          overlayOffset={overlayOffset}
          toolMode={toolMode}
        />
      ))}
    </>
  );
}

export default function WebGLHandwriting() {
  const [toolMode, setToolMode] = useState<ToolMode>("draw");
  const [strokeCount, setStrokeCount] = useState(0);
  const [stressLevel, setStressLevel] = useState<StressLevel>(5);
  const [canvasRuntime, setCanvasRuntime] = useState<CanvasRuntime>("detecting");
  const [cameraView, setCameraView] = useState<CameraViewState>({ zoom: 300, x: 0, y: 0 });
  const [overlayOffset, setOverlayOffset] = useState<OverlayOffset>({ x: 0, y: 0 });
  const [floatItems, setFloatItems] = useState<FloatItem[]>(
    Array.from({ length: 5 }, (_, index) => makeDefaultFloatItem(index))
  );
  const [domItems, setDomItems] = useState<DomItem[]>([
    {
      id: "photo-1",
      kind: "image",
      x: window.innerWidth - 300,
      y: 130,
      width: 240,
      height: 150,
      src: SAMPLE_IMAGE_SRC
    },
    {
      id: "text-1",
      kind: "text",
      x: window.innerWidth - 320,
      y: 290,
      width: 250,
      height: 96,
      text: "DOM overlay note example. Draw mode에서는 선이 이 위에 보여요."
    }
  ]);
  const [isDrawingActive, setIsDrawingActive] = useState(false);
  const [selection, setSelection] = useState<SelectionInfo>({
    type: "none",
    label: "none",
    id: null
  });
  const [metrics, setMetrics] = useState<Metrics>({
    completedStrokes: 0,
    activeMoves: 0,
    overlayEnterDuringDraw: 0,
    overlayLeaveDuringDraw: 0,
    pointerCancelCount: 0,
    modeSwitches: 0
  });

  const overlayInteractive = toolMode === "ui" || toolMode === "select";
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedDomItem = selection.type === "dom" ? domItems.find((item) => item.id === selection.id) ?? null : null;
  const selectedFloatItem =
    selection.type === "dom" ? floatItems.find((item) => item.id === selection.id) ?? null : null;
  const selectedBox: SelectedBox | null = selectedDomItem
    ? {
        kind: "dom",
        id: selectedDomItem.id,
        x: selectedDomItem.x,
        y: selectedDomItem.y,
        width: selectedDomItem.width,
        height: selectedDomItem.height
      }
    : selectedFloatItem
      ? {
          kind: "float",
          id: selectedFloatItem.id,
          x: selectedFloatItem.x,
          y: selectedFloatItem.y,
          width: selectedFloatItem.width,
          height: selectedFloatItem.height
        }
      : null;

  const addTextItem = useCallback(() => {
    const id = `text-${Date.now()}`;
    setDomItems((prev) => [
      ...prev,
      {
        id,
        kind: "text",
        x: 80 + (prev.length % 4) * 30,
        y: 220 + (prev.length % 4) * 24,
        width: 250,
        height: 96,
        text: "새 텍스트 메모"
      }
    ]);
    setSelection({ type: "dom", id, label: id });
  }, []);

  const onClickAddImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const onImageFileChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = typeof reader.result === "string" ? reader.result : SAMPLE_IMAGE_SRC;
      const id = `image-${Date.now()}`;
      setDomItems((prev) => [
        ...prev,
        {
          id,
          kind: "image",
          x: 100 + (prev.length % 4) * 28,
          y: 120 + (prev.length % 4) * 24,
          width: 240,
          height: 150,
          src
        }
      ]);
      setSelection({ type: "dom", id, label: id });
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }, []);

  const onDomItemChange = useCallback((id: string, patch: Partial<DomItem>) => {
    setDomItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const onFloatItemChange = useCallback((id: string, patch: Partial<FloatItem>) => {
    setFloatItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const onSelectedBoxChange = useCallback(
    (box: SelectedBox, patch: Partial<DomItem | FloatItem>) => {
      if (box.kind === "dom") {
        onDomItemChange(box.id, patch as Partial<DomItem>);
        return;
      }
      onFloatItemChange(box.id, patch as Partial<FloatItem>);
    },
    [onDomItemChange, onFloatItemChange]
  );

  useEffect(() => {
    setFloatItems((prev) => {
      const next: FloatItem[] = [];
      for (let i = 0; i < stressLevel; i += 1) {
        const id = `float-${i + 1}`;
        const existing = prev.find((item) => item.id === id);
        next.push(existing ?? makeDefaultFloatItem(i));
      }
      return next;
    });
  }, [stressLevel]);

  return (
    <div className="app">
      <div className="runtime-badge">
        canvas core: {canvasRuntime.toUpperCase()} | ink canvas: DOM 2D | zoom: {cameraView.zoom.toFixed(1)} | cam: {cameraView.x.toFixed(2)}, {cameraView.y.toFixed(2)}
      </div>
      <div className="hud">
        <button
          type="button"
          onClick={() => {
            setToolMode("draw");
            setMetrics((prev) => ({ ...prev, modeSwitches: prev.modeSwitches + 1 }));
          }}
        >
          Tool: DRAW
        </button>
        <button
          type="button"
          onClick={() => {
            setToolMode("select");
            setMetrics((prev) => ({ ...prev, modeSwitches: prev.modeSwitches + 1 }));
          }}
        >
          Tool: SELECT
        </button>
        <button
          type="button"
          onClick={() => {
            setToolMode("ui");
            setMetrics((prev) => ({ ...prev, modeSwitches: prev.modeSwitches + 1 }));
          }}
        >
          Tool: UI
        </button>
        <button
          type="button"
          onClick={() => {
            setToolMode("pan");
            setMetrics((prev) => ({ ...prev, modeSwitches: prev.modeSwitches + 1 }));
          }}
        >
          Tool: PAN
        </button>
        <button type="button" onClick={() => setStressLevel(5)}>
          Html x5
        </button>
        <button type="button" onClick={() => setStressLevel(20)}>
          Html x20
        </button>
        <button type="button" onClick={() => setStressLevel(50)}>
          Html x50
        </button>
        <button type="button" onClick={addTextItem}>
          Add Text
        </button>
        <button type="button" onClick={onClickAddImage}>
          Add Image
        </button>
        <span className="status">
          tool: {toolMode} | stress: {stressLevel} | strokes: {strokeCount} | zoom: {cameraView.zoom.toFixed(1)}
        </span>
      </div>
      <div className="metrics">
        <div>policy(draw): draw capture on DOM canvas</div>
        <div>policy(select): topmost selectable target/stroke pick</div>
        <div>policy(ui): pass through to DOM widgets</div>
        <div>policy(pan): move/zoom viewport via CameraControls</div>
        <div>draw active: {isDrawingActive ? "yes" : "no"}</div>
        <div>selected: {selection.label}</div>
        <div>completed strokes: {metrics.completedStrokes}</div>
        <div>stroke move samples: {metrics.activeMoves}</div>
        <div>overlay enter during draw: {metrics.overlayEnterDuringDraw}</div>
        <div>overlay leave during draw: {metrics.overlayLeaveDuringDraw}</div>
        <div>pointer cancel count: {metrics.pointerCancelCount}</div>
        <div>mode switches: {metrics.modeSwitches}</div>
      </div>
      <Canvas orthographic camera={{ position: [0, 0, 5], zoom: 300 }}>
        <CanvasRuntimeProbe onRuntime={setCanvasRuntime} />
        <CameraViewProbe onViewChange={setCameraView} />
        <OverlaySyncProbe onOffsetChange={setOverlayOffset} />
        <PanCameraControls enabled={toolMode === "pan"} />
        <SceneBackground />
        {floatItems.map((item) => (
          <FloatingOverlay
            key={item.id}
            item={item}
            overlayInteractive={overlayInteractive}
            selectedDomId={selection.type === "dom" ? selection.id : null}
            overlayOffset={overlayOffset}
            toolMode={toolMode}
          />
        ))}
        <HtmlArtifacts
          items={domItems}
          overlayInteractive={overlayInteractive}
          selectedDomId={selection.type === "dom" ? selection.id : null}
          overlayOffset={overlayOffset}
          toolMode={toolMode}
        />
      </Canvas>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden-file-input"
        onChange={onImageFileChange}
      />
      <DomDrawingOverlay
        toolMode={toolMode}
        overlayOffset={overlayOffset}
        selectedBox={selectedBox}
        onSelectedBoxChange={onSelectedBoxChange}
        onStrokeCountChange={setStrokeCount}
        onMetrics={setMetrics}
        onDrawingStateChange={setIsDrawingActive}
        onSelectionChange={setSelection}
      />
    </div>
  );
}
