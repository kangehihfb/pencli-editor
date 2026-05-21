import type { Point2D } from "../types/editor";

export type PointerMoveEventName = "pointerrawupdate" | "pointermove";

export function getPreferredPointerMoveEventName(
  _scope: typeof globalThis = globalThis,
): PointerMoveEventName {
  return "pointermove";
}

export function getCoalescedPointerEvents(event: PointerEvent) {
  const coalescedEvents =
    typeof event.getCoalescedEvents === "function"
      ? event.getCoalescedEvents()
      : [];
  if (coalescedEvents.length === 0) return [event];

  const lastEvent = coalescedEvents.at(-1);
  if (
    !lastEvent ||
    lastEvent.clientX !== event.clientX ||
    lastEvent.clientY !== event.clientY ||
    lastEvent.pressure !== event.pressure
  ) {
    return [...coalescedEvents, event];
  }

  return coalescedEvents;
}

export function getPointerPointsFromEvent(
  event: PointerEvent,
  toPoint: (event: PointerEvent) => Point2D | undefined,
) {
  return getCoalescedPointerEvents(event).reduce<Point2D[]>((points, item) => {
    const point = toPoint(item);
    if (point) points.push(point);
    return points;
  }, []);
}
