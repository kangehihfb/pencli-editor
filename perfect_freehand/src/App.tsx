import { useMemo, useRef, useState, type PointerEvent } from "react";
import { getStroke } from "perfect-freehand";

type Point = [number, number, number];
type StrokeOptions = Parameters<typeof getStroke>[1];

const strokeOptions: StrokeOptions = {
  size: 14,
  thinning: 0.6,
  smoothing: 0.55,
  streamline: 0.4,
  simulatePressure: false,
  start: { cap: true },
  end: { cap: true },
};
const MIN_POINT_DISTANCE = 0.35;

function average(a: number, b: number): number {
  return (a + b) / 2;
}

function getSvgPathFromStroke(points: number[][]): string {
  if (points.length < 4) {
    return "";
  }

  let path = "";
  let a = points[0];
  let b = points[1];
  const c = points[2];

  path += `M${a[0].toFixed(2)},${a[1].toFixed(2)} `;
  path += `Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(
    b[1],
    c[1],
  ).toFixed(2)} `;

  for (let i = 2; i < points.length - 1; i += 1) {
    a = points[i];
    b = points[i + 1];
    path += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }

  path += "Z";
  return path;
}

export default function App() {
  const [completedPaths, setCompletedPaths] = useState<string[]>([]);
  const [currentPath, setCurrentPath] = useState("");
  const isDrawingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const currentPointsRef = useRef<Point[]>([]);

  const paths = useMemo(
    () => (currentPath ? [...completedPaths, currentPath] : completedPaths),
    [completedPaths, currentPath],
  );

  function toPointFromNativeEvent(e: globalThis.PointerEvent): Point {
    const pressure = e.pressure > 0 ? e.pressure : 0.5;
    return [e.clientX, e.clientY, pressure];
  }

  function makePath(points: Point[], last: boolean): string {
    return getSvgPathFromStroke(
      getStroke(points, {
        ...strokeOptions,
        last,
      }),
    );
  }

  function appendSampledPoints(e: PointerEvent<SVGSVGElement>): void {
    const nativeEvent = e.nativeEvent;
    const sampledEvents =
      typeof nativeEvent.getCoalescedEvents === "function" ? nativeEvent.getCoalescedEvents() : [];
    const sourceEvents = sampledEvents.length > 0 ? sampledEvents : [nativeEvent];
    const nextPoints: Point[] = [];
    const seedPoint = currentPointsRef.current[currentPointsRef.current.length - 1];
    let previousPoint = seedPoint;

    for (const sampledEvent of sourceEvents) {
      const point = toPointFromNativeEvent(sampledEvent);
      if (previousPoint) {
        const dx = point[0] - previousPoint[0];
        const dy = point[1] - previousPoint[1];
        const isNearDuplicate = dx * dx + dy * dy < MIN_POINT_DISTANCE * MIN_POINT_DISTANCE;
        if (isNearDuplicate) {
          continue;
        }
      }
      nextPoints.push(point);
      previousPoint = point;
    }

    if (nextPoints.length === 0) {
      return;
    }

    currentPointsRef.current = [...currentPointsRef.current, ...nextPoints];
    setCurrentPath(makePath(currentPointsRef.current, false));
  }

  function handlePointerDown(e: PointerEvent<SVGSVGElement>): void {
    if (!e.isPrimary) {
      return;
    }
    if (e.pointerType === "touch") {
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawingRef.current = true;
    activePointerIdRef.current = e.pointerId;
    currentPointsRef.current = [toPointFromNativeEvent(e.nativeEvent)];
    setCurrentPath(makePath(currentPointsRef.current, false));
  }

  function handlePointerMove(e: PointerEvent<SVGSVGElement>): void {
    if (!e.isPrimary) {
      return;
    }
    if (!isDrawingRef.current) {
      return;
    }
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) {
      return;
    }
    // Apple Pencil on iPad may report buttons=0 during move; only ignore clear non-draw multi-button input.
    if (e.buttons > 1) {
      return;
    }

    appendSampledPoints(e);
  }

  function finishDrawing(e: PointerEvent<SVGSVGElement>): void {
    if (!e.isPrimary) {
      return;
    }
    if (activePointerIdRef.current !== e.pointerId) {
      return;
    }

    appendSampledPoints(e);

    if (currentPointsRef.current.length > 0) {
      const finalPath = makePath(currentPointsRef.current, true);
      if (finalPath) {
        setCompletedPaths((prev) => [...prev, finalPath]);
      }
    }

    currentPointsRef.current = [];
    setCurrentPath("");
    activePointerIdRef.current = null;
    isDrawingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <main className="app">
      <div className="toolbar">
        <span>Perfect Freehand iPad Test</span>
        <button
          type="button"
          onClick={() => {
            setCompletedPaths([]);
            setCurrentPath("");
            currentPointsRef.current = [];
            isDrawingRef.current = false;
            activePointerIdRef.current = null;
          }}
        >
          Clear
        </button>
      </div>

      <svg
        className="draw-surface"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrawing}
        onPointerCancel={finishDrawing}
        viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
      >
        {paths.map((d, index) => (
          <path key={`${index}-${d.length}`} d={d} />
        ))}
      </svg>
    </main>
  );
}
