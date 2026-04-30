import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type {
  Point2D,
  PointBounds,
  ResizeHandle,
  ResizeState,
  SceneHit,
  SelectionItem,
  Stroke,
  WebGLObject,
} from '../types/editor';

const editorPointerPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

export const makeId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const layerToZ = (layer: number) => layer * 0.02;
const resizeHandles: ResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const strokePointMinDistance = 0.18;
const strokePointMaxSpacing = 0.85;

export function getEditorPointerPoint(event: ThreeEvent<PointerEvent>): Point2D {
  const point = new THREE.Vector3();
  const hit = event.ray.intersectPlane(editorPointerPlane, point);
  if (!hit) return { x: event.point.x, y: event.point.y };
  return { x: point.x, y: point.y };
}

export function getObjectBounds(object: WebGLObject): PointBounds {
  const minX = object.x - object.width / 2;
  const maxX = object.x + object.width / 2;
  const minY = object.y - object.height / 2;
  const maxY = object.y + object.height / 2;
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: object.x,
    centerY: object.y,
    width: object.width,
    height: object.height,
  };
}

export function getBoundsFromPoints(a: Point2D, b: Point2D): PointBounds {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(maxX - minX, 0.001),
    height: Math.max(maxY - minY, 0.001),
  };
}

export function getItemsInBounds(bounds: PointBounds, strokes: Stroke[], objects: WebGLObject[]): SelectionItem[] {
  const strokeItems = strokes
    .filter((stroke) => intersectsBounds(bounds, getPointBounds(getRotatedStrokePoints(stroke))))
    .map((stroke): SelectionItem => ({ type: 'stroke', id: stroke.id }));
  const objectItems = objects
    .filter((object) => intersectsBounds(bounds, getObjectBounds(object)))
    .map((object): SelectionItem => ({ type: 'object', id: object.id }));
  return [...strokeItems, ...objectItems];
}

export function getSelectionItemsBounds(
  items: SelectionItem[],
  strokes: Stroke[],
  objects: WebGLObject[],
): PointBounds | null {
  const bounds = items
    .map((item) => {
      if (item.type === 'stroke') {
        const stroke = strokes.find((candidate) => candidate.id === item.id);
        return stroke ? getPointBounds(getRotatedStrokePoints(stroke)) : null;
      }
      const object = objects.find((candidate) => candidate.id === item.id);
      return object ? getObjectBounds(object) : null;
    })
    .filter((item): item is PointBounds => Boolean(item));

  if (bounds.length === 0) return null;

  const minX = Math.min(...bounds.map((item) => item.minX));
  const maxX = Math.max(...bounds.map((item) => item.maxX));
  const minY = Math.min(...bounds.map((item) => item.minY));
  const maxY = Math.max(...bounds.map((item) => item.maxY));
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(maxX - minX, 20),
    height: Math.max(maxY - minY, 20),
  };
}

export function intersectsBounds(a: PointBounds, b: PointBounds) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function isPointInBounds(point: Point2D, bounds: PointBounds, padding = 0) {
  return (
    point.x >= bounds.minX - padding &&
    point.x <= bounds.maxX + padding &&
    point.y >= bounds.minY - padding &&
    point.y <= bounds.maxY + padding
  );
}

export function isPointInRotatedBounds(point: Point2D, bounds: PointBounds, rotation = 0, padding = 0) {
  const localPoint = rotatePoint(point, getBoundsCenter(bounds), -rotation);
  return isPointInBounds(localPoint, bounds, padding);
}

export function isPointInResizeHandle(point: Point2D, bounds: PointBounds, variant: 'object' | 'stroke') {
  return getResizeHandleAtPoint(point, bounds, variant) !== null;
}

export function getResizeHandleAtPoint(point: Point2D, bounds: PointBounds, variant: 'object' | 'stroke'): ResizeHandle | null {
  return getRotatedResizeHandleAtPoint(point, bounds, variant, 0);
}

export function getRotatedResizeHandleAtPoint(
  point: Point2D,
  bounds: PointBounds,
  variant: 'object' | 'stroke',
  rotation = 0,
): ResizeHandle | null {
  const offset = getResizeHandleOffset(variant);
  const hitSize = getResizeHandleHitSize(variant);

  for (const handle of resizeHandles) {
    const center = rotatePoint(getResizeHandleCenter(handle, bounds, offset), getBoundsCenter(bounds), rotation);
    if (Math.abs(point.x - center.x) <= hitSize / 2 && Math.abs(point.y - center.y) <= hitSize / 2) {
      return handle;
    }
  }

  return null;
}

export function isPointInRotationHandle(point: Point2D, bounds: PointBounds, variant: 'object' | 'stroke', rotation = 0) {
  const center = getRotationHandleCenter(bounds, variant, rotation);
  const hitSize = variant === 'stroke' ? 18 : 20;
  return Math.abs(point.x - center.x) <= hitSize / 2 && Math.abs(point.y - center.y) <= hitSize / 2;
}

export function getPointerAngle(center: Point2D, point: Point2D) {
  return THREE.MathUtils.radToDeg(Math.atan2(point.y - center.y, point.x - center.x));
}

export function normalizeRotation(rotation: number) {
  const next = rotation % 360;
  if (next > 180) return next - 360;
  if (next < -180) return next + 360;
  return next;
}

export function rotatePoint(point: Point2D, center: Point2D, angleDegrees: number): Point2D {
  if (Math.abs(angleDegrees) < 0.0001) return { ...point };

  const angle = THREE.MathUtils.degToRad(angleDegrees);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function rotatePoints(points: Point2D[], center: Point2D, angleDegrees: number) {
  return points.map((point) => rotatePoint(point, center, angleDegrees));
}

function getResizeHandleOffset(variant: 'object' | 'stroke') {
  return variant === 'stroke' ? 23 : 14;
}

function getResizeHandleHitSize(variant: 'object' | 'stroke') {
  return variant === 'stroke' ? 16 : 18;
}

export function getResizedObjectRect(
  handle: ResizeHandle,
  origin: Extract<ResizeState, { type: 'object' }>['origin'],
  point: Point2D,
) {
  const minWidth = 18;
  const minHeight = 12;
  const safeWidth = Math.max(origin.width, minWidth);
  const safeHeight = Math.max(origin.height, minHeight);
  const rotation = origin.rotation ?? 0;
  const originCenter = { x: origin.x, y: origin.y };
  const originPointerLocal = getLocalPoint(origin.pointer, originCenter, rotation);
  const pointLocal = getLocalPoint(point, originCenter, rotation);
  const bounds: PointBounds = {
    minX: -origin.width / 2,
    maxX: origin.width / 2,
    minY: -origin.height / 2,
    maxY: origin.height / 2,
    centerX: 0,
    centerY: 0,
    width: origin.width,
    height: origin.height,
  };
  const delta = {
    x: pointLocal.x - originPointerLocal.x,
    y: pointLocal.y - originPointerLocal.y,
  };

  if (!isCornerResizeHandle(handle)) {
    const nextRect = getResizedBoundsRect(handle, bounds, delta, minWidth, minHeight);
    const nextCenter = rotatePoint({ x: origin.x + nextRect.x, y: origin.y + nextRect.y }, originCenter, rotation);
    return {
      ...nextRect,
      x: nextCenter.x,
      y: nextCenter.y,
    };
  }

  const corner = getHandlePoint(handle, bounds);
  const anchor = getOppositeHandlePoint(handle, bounds);
  const movedCorner = {
    x: corner.x + delta.x,
    y: corner.y + delta.y,
  };
  const scale = getUniformResizeScale(anchor, corner, movedCorner, Math.max(minWidth / safeWidth, minHeight / safeHeight));
  const nextCorner = {
    x: anchor.x + (corner.x - anchor.x) * scale,
    y: anchor.y + (corner.y - anchor.y) * scale,
  };
  const left = Math.min(anchor.x, nextCorner.x);
  const right = Math.max(anchor.x, nextCorner.x);
  const bottom = Math.min(anchor.y, nextCorner.y);
  const top = Math.max(anchor.y, nextCorner.y);
  const nextLocalCenter = {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
  };
  const nextCenter = rotatePoint({ x: origin.x + nextLocalCenter.x, y: origin.y + nextLocalCenter.y }, originCenter, rotation);

  return {
    x: nextCenter.x,
    y: nextCenter.y,
    width: right - left,
    height: top - bottom,
  };
}

export function getUniformResizedObjectRect(
  handle: ResizeHandle,
  origin: Extract<ResizeState, { type: 'object' }>['origin'],
  point: Point2D,
  minScale = 0.2,
) {
  const safeWidth = Math.max(origin.width, 0.001);
  const safeHeight = Math.max(origin.height, 0.001);
  const rotation = origin.rotation ?? 0;
  const originCenter = { x: origin.x, y: origin.y };
  const originPointerLocal = getLocalPoint(origin.pointer, originCenter, rotation);
  const pointLocal = getLocalPoint(point, originCenter, rotation);
  const bounds: PointBounds = {
    minX: -origin.width / 2,
    maxX: origin.width / 2,
    minY: -origin.height / 2,
    maxY: origin.height / 2,
    centerX: 0,
    centerY: 0,
    width: origin.width,
    height: origin.height,
  };
  const delta = {
    x: pointLocal.x - originPointerLocal.x,
    y: pointLocal.y - originPointerLocal.y,
  };

  if (isCornerResizeHandle(handle)) {
    const nextRect = getUniformResizedBoundsRect(handle, bounds, delta, minScale);
    const nextCenter = rotatePoint({ x: origin.x + nextRect.x, y: origin.y + nextRect.y }, originCenter, rotation);
    return {
      ...nextRect,
      x: nextCenter.x,
      y: nextCenter.y,
    };
  }

  let scale = 1;
  let localCenter = { x: 0, y: 0 };

  if (handle === 'e') {
    scale = Math.max(minScale, (origin.width + delta.x) / safeWidth);
    localCenter = { x: -origin.width / 2 + (origin.width * scale) / 2, y: 0 };
  } else if (handle === 'w') {
    scale = Math.max(minScale, (origin.width - delta.x) / safeWidth);
    localCenter = { x: origin.width / 2 - (origin.width * scale) / 2, y: 0 };
  } else if (handle === 's') {
    scale = Math.max(minScale, (origin.height + delta.y) / safeHeight);
    localCenter = { x: 0, y: -origin.height / 2 + (origin.height * scale) / 2 };
  } else if (handle === 'n') {
    scale = Math.max(minScale, (origin.height - delta.y) / safeHeight);
    localCenter = { x: 0, y: origin.height / 2 - (origin.height * scale) / 2 };
  }

  const nextCenter = rotatePoint({ x: origin.x + localCenter.x, y: origin.y + localCenter.y }, originCenter, rotation);
  return {
    x: nextCenter.x,
    y: nextCenter.y,
    width: origin.width * scale,
    height: origin.height * scale,
  };
}

export function getResizedStrokePoints(
  handle: ResizeHandle,
  origin: Extract<ResizeState, { type: 'stroke' }>['origin'],
  point: Point2D,
) {
  const { bounds } = origin;
  const rotation = origin.rotation ?? 0;
  const center = getBoundsCenter(bounds);
  const originPointerLocal = rotatePoint(origin.pointer, center, -rotation);
  const pointLocal = rotatePoint(point, center, -rotation);
  const delta = { x: pointLocal.x - originPointerLocal.x, y: pointLocal.y - originPointerLocal.y };

  if (!isCornerResizeHandle(handle)) {
    const nextBounds = getResizedBoundsRect(handle, bounds, delta, 15, 15);
    const scaleX = nextBounds.width / Math.max(bounds.width, 0.001);
    const scaleY = nextBounds.height / Math.max(bounds.height, 0.001);
    const fixedX = handle.includes('w') ? bounds.maxX : bounds.minX;
    const fixedY = handle.includes('n') ? bounds.maxY : bounds.minY;

    return origin.points.map((item) => ({
      x: handle.includes('w') || handle.includes('e') ? fixedX + (item.x - fixedX) * scaleX : item.x,
      y: handle.includes('n') || handle.includes('s') ? fixedY + (item.y - fixedY) * scaleY : item.y,
    }));
  }

  const corner = getHandlePoint(handle, bounds);
  const anchor = getOppositeHandlePoint(handle, bounds);
  const movedCorner = { x: corner.x + delta.x, y: corner.y + delta.y };
  const minScale = Math.max(15 / bounds.width, 15 / bounds.height, 0.15);
  const scale = getUniformResizeScale(anchor, corner, movedCorner, minScale);

  return origin.points.map((item) => ({
    x: anchor.x + (item.x - anchor.x) * scale,
    y: anchor.y + (item.y - anchor.y) * scale,
  }));
}

export function getGroupResizeScale(origin: Extract<ResizeState, { type: 'group' }>['origin'], point: Point2D) {
  const { bounds } = origin;
  const corner = getHandlePoint('se', bounds);
  const anchor = getOppositeHandlePoint('se', bounds);
  const movedCorner = {
    x: corner.x + point.x - origin.pointer.x,
    y: corner.y + point.y - origin.pointer.y,
  };
  const minScale = Math.max(20 / bounds.width, 20 / bounds.height, 0.15);
  return getUniformResizeScale(anchor, corner, movedCorner, minScale);
}

export function getGroupResizeTransform(origin: Extract<ResizeState, { type: 'group' }>['origin'], point: Point2D) {
  const minWidth = 20;
  const minHeight = 20;
  const rotation = origin.rotation ?? 0;
  const originCenter = getBoundsCenter(origin.bounds);
  const originPointerLocal = rotatePoint(origin.pointer, originCenter, -rotation);
  const pointLocal = rotatePoint(point, originCenter, -rotation);
  const delta = {
    x: pointLocal.x - originPointerLocal.x,
    y: pointLocal.y - originPointerLocal.y,
  };

  const localRect = isCornerResizeHandle(origin.handle)
    ? getUniformResizedBoundsRect(
        origin.handle,
        origin.bounds,
        delta,
        Math.max(minWidth / Math.max(origin.bounds.width, 0.001), minHeight / Math.max(origin.bounds.height, 0.001), 0.15),
      )
    : getResizedBoundsRect(origin.handle, origin.bounds, delta, minWidth, minHeight);
  const nextCenter = rotatePoint({ x: localRect.x, y: localRect.y }, originCenter, rotation);
  const bounds = makeBoundsFromCenter(nextCenter, localRect.width, localRect.height);

  return {
    bounds,
    localBounds: makeBoundsFromCenter({ x: localRect.x, y: localRect.y }, localRect.width, localRect.height),
    scaleX: localRect.width / Math.max(origin.bounds.width, 0.001),
    scaleY: localRect.height / Math.max(origin.bounds.height, 0.001),
    originCenter,
    rotation,
  };
}

function getUniformResizeScale(anchor: Point2D, corner: Point2D, point: Point2D, minScale: number) {
  const vector = { x: corner.x - anchor.x, y: corner.y - anchor.y };
  const pointer = { x: point.x - anchor.x, y: point.y - anchor.y };
  const lengthSquared = vector.x * vector.x + vector.y * vector.y;
  if (lengthSquared < 0.0001) return 1;
  const projectedScale = (pointer.x * vector.x + pointer.y * vector.y) / lengthSquared;
  if (!Number.isFinite(projectedScale)) return 1;
  return Math.max(minScale, projectedScale);
}

function isCornerResizeHandle(handle: ResizeHandle) {
  return handle.length === 2;
}

function getUniformResizedBoundsRect(handle: ResizeHandle, bounds: PointBounds, delta: Point2D, minScale: number) {
  const corner = getHandlePoint(handle, bounds);
  const anchor = getOppositeHandlePoint(handle, bounds);
  const movedCorner = { x: corner.x + delta.x, y: corner.y + delta.y };
  const scale = getUniformResizeScale(anchor, corner, movedCorner, minScale);
  const nextCorner = {
    x: anchor.x + (corner.x - anchor.x) * scale,
    y: anchor.y + (corner.y - anchor.y) * scale,
  };
  const left = Math.min(anchor.x, nextCorner.x);
  const right = Math.max(anchor.x, nextCorner.x);
  const bottom = Math.min(anchor.y, nextCorner.y);
  const top = Math.max(anchor.y, nextCorner.y);

  return {
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left,
    height: top - bottom,
  };
}

function getResizeHandleCenter(handle: ResizeHandle, bounds: PointBounds, offset: number): Point2D {
  return {
    x: handle.includes('w') ? bounds.minX - offset : handle.includes('e') ? bounds.maxX + offset : bounds.centerX,
    y: handle.includes('n') ? bounds.minY - offset : handle.includes('s') ? bounds.maxY + offset : bounds.centerY,
  };
}

function getRotationHandleCenter(bounds: PointBounds, variant: 'object' | 'stroke', rotation: number) {
  const offset = getResizeHandleOffset(variant);
  const distance = variant === 'stroke' ? 30 : 26;
  const center = getBoundsCenter(bounds);
  return rotatePoint({ x: bounds.centerX, y: bounds.minY - offset - distance }, center, rotation);
}

function getBoundsCenter(bounds: PointBounds): Point2D {
  return { x: bounds.centerX, y: bounds.centerY };
}

function getLocalPoint(point: Point2D, center: Point2D, rotation: number) {
  const unrotated = rotatePoint(point, center, -rotation);
  return {
    x: unrotated.x - center.x,
    y: unrotated.y - center.y,
  };
}

function getHandlePoint(handle: ResizeHandle, bounds: PointBounds): Point2D {
  return {
    x: handle.includes('w') ? bounds.minX : handle.includes('e') ? bounds.maxX : bounds.centerX,
    y: handle.includes('n') ? bounds.minY : handle.includes('s') ? bounds.maxY : bounds.centerY,
  };
}

function getOppositeHandlePoint(handle: ResizeHandle, bounds: PointBounds): Point2D {
  return {
    x: handle.includes('w') ? bounds.maxX : handle.includes('e') ? bounds.minX : bounds.centerX,
    y: handle.includes('n') ? bounds.maxY : handle.includes('s') ? bounds.minY : bounds.centerY,
  };
}

function getResizedBoundsRect(handle: ResizeHandle, bounds: PointBounds, delta: Point2D, minWidth: number, minHeight: number) {
  let minX = bounds.minX;
  let maxX = bounds.maxX;
  let minY = bounds.minY;
  let maxY = bounds.maxY;

  if (handle.includes('w')) {
    minX = Math.min(bounds.minX + delta.x, bounds.maxX - minWidth);
  }
  if (handle.includes('e')) {
    maxX = Math.max(bounds.maxX + delta.x, bounds.minX + minWidth);
  }
  if (handle.includes('n')) {
    minY = Math.min(bounds.minY + delta.y, bounds.maxY - minHeight);
  }
  if (handle.includes('s')) {
    maxY = Math.max(bounds.maxY + delta.y, bounds.minY + minHeight);
  }

  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function makeBoundsFromCenter(center: Point2D, width: number, height: number): PointBounds {
  return {
    minX: center.x - width / 2,
    maxX: center.x + width / 2,
    minY: center.y - height / 2,
    maxY: center.y + height / 2,
    centerX: center.x,
    centerY: center.y,
    width,
    height,
  };
}

export function getPointBounds(points: Point2D[]): PointBounds {
  if (points.length === 0) {
    return { minX: -10, maxX: 10, minY: -10, maxY: 10, centerX: 0, centerY: 0, width: 20, height: 20 };
  }
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    maxX,
    minY,
    maxY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(maxX - minX, 20),
    height: Math.max(maxY - minY, 20),
  };
}

export function getRotatedStrokePoints(stroke: Stroke) {
  const rotation = stroke.rotation ?? 0;
  if (Math.abs(rotation) < 0.0001) return stroke.points;
  const bounds = getPointBounds(stroke.points);
  return rotatePoints(stroke.points, getBoundsCenter(bounds), rotation);
}

export function getNextStrokePoints(points: Point2D[], point: Point2D) {
  const last = points[points.length - 1];
  if (!last) return [point];

  const segmentLength = distance(point, last);
  if (segmentLength < strokePointMinDistance) return points;

  const segmentCount = Math.max(1, Math.ceil(segmentLength / strokePointMaxSpacing));
  const nextPoints = Array.from({ length: segmentCount }, (_, index) => {
    const t = (index + 1) / segmentCount;
    return {
      x: last.x + (point.x - last.x) * t,
      y: last.y + (point.y - last.y) * t,
    };
  });

  return [...points, ...nextPoints];
}

export function getSmoothedStrokePoints(points: Point2D[]) {
  if (points.length < 3) return points;

  const smoothed: Point2D[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    smoothed.push(
      current,
      {
        x: current.x * 0.5 + next.x * 0.5,
        y: current.y * 0.5 + next.y * 0.5,
      },
    );
  }
  smoothed.push(points[points.length - 1]);

  const relaxed = smoothed.map((point, index) => {
    if (index === 0 || index === smoothed.length - 1) return point;
    const previous = smoothed[index - 1];
    const next = smoothed[index + 1];
    return {
      x: point.x * 0.55 + (previous.x + next.x) * 0.225,
      y: point.y * 0.55 + (previous.y + next.y) * 0.225,
    };
  });

  return relaxed;
}

export function getSceneHits(event: ThreeEvent<PointerEvent>): SceneHit[] {
  return event.intersections
    .map((intersection) => {
      const { sceneType, sceneId, sceneLayer } = intersection.object.userData as {
        sceneType?: 'stroke' | 'object';
        sceneId?: string;
        sceneLayer?: number;
      };

      if (!sceneType || !sceneId || typeof sceneLayer !== 'number') return null;

      return {
        type: sceneType,
        id: sceneId,
        layer: sceneLayer,
        point: { x: intersection.point.x, y: intersection.point.y },
      };
    })
    .filter((hit): hit is SceneHit => Boolean(hit));
}

export function isPointNearStroke(stroke: Stroke, point: Point2D, threshold: number) {
  const points = getRotatedStrokePoints(stroke);
  return points.some((current, index) => {
    const next = points[index + 1];
    if (!next) return distance(point, current) <= threshold;
    return distanceToSegment(point, current, next) <= threshold;
  });
}

export function getStrokeHitThreshold(stroke: Stroke) {
  return Math.max(stroke.size * 3.5, 11);
}

export function getStrokeSelectionThreshold(stroke: Stroke) {
  return Math.max(stroke.size * 1.2, 3.5);
}

function distance(a: Point2D, b: Point2D) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: Point2D, start: Point2D, end: Point2D) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) return distance(point, start);

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}
