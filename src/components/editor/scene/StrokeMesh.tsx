import type { ThreeEvent } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import {
  getPointBounds,
  getStableActiveStrokeRenderPoints,
  getStrokeRenderPoints,
  layerToZ,
  type ActiveStrokeRenderCache,
} from "../../../lib/sceneMath";
import type { Point2D, Stroke } from "../../../types/editor";
import {
  ResizeHandleMarker,
  RotationHandleMarker,
  SelectionFrame,
} from "./SelectionVisuals";

function createStrokeRibbonGeometry(
  points: Point2D[],
  radius: number,
  capSegments = 18,
) {
  const filteredPoints: Point2D[] = [];
  for (const point of points) {
    const last = filteredPoints.at(-1);
    if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 0.001) {
      filteredPoints.push(point);
    }
  }

  if (filteredPoints.length < 2) return undefined;

  const vertices: number[] = [];
  const indices: number[] = [];

  const pushVertex = (point: Point2D) => {
    const index = vertices.length / 3;
    vertices.push(point.x, point.y, 0);
    return index;
  };

  const getDirection = (from: Point2D, to: Point2D) => {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) return undefined;
    return { x: dx / length, y: dy / length };
  };

  const getNormal = (direction: Point2D) => ({
    x: -direction.y,
    y: direction.x,
  });

  const getJoinOffset = (index: number) => {
    const current = filteredPoints[index];
    const previous = filteredPoints[index - 1];
    const next = filteredPoints[index + 1];
    const fallbackDirection = next
      ? getDirection(current, next)
      : previous
        ? getDirection(previous, current)
        : undefined;
    const fallbackNormal = fallbackDirection
      ? getNormal(fallbackDirection)
      : { x: 0, y: 1 };

    if (!previous || !next) {
      return { x: fallbackNormal.x * radius, y: fallbackNormal.y * radius };
    }

    const previousDirection = getDirection(previous, current);
    const nextDirection = getDirection(current, next);
    if (!previousDirection || !nextDirection) {
      return { x: fallbackNormal.x * radius, y: fallbackNormal.y * radius };
    }

    const previousNormal = getNormal(previousDirection);
    const nextNormal = getNormal(nextDirection);
    const joinNormal = {
      x: previousNormal.x + nextNormal.x,
      y: previousNormal.y + nextNormal.y,
    };
    const joinLength = Math.hypot(joinNormal.x, joinNormal.y);
    if (joinLength < 0.001) {
      return { x: nextNormal.x * radius, y: nextNormal.y * radius };
    }

    joinNormal.x /= joinLength;
    joinNormal.y /= joinLength;
    return { x: joinNormal.x * radius, y: joinNormal.y * radius };
  };

  const addRoundCap = (
    center: Point2D,
    direction: Point2D,
    isStart: boolean,
  ) => {
    const base = vertices.length / 3;
    vertices.push(center.x, center.y, 0);
    const directionAngle = Math.atan2(direction.y, direction.x);
    const startAngle = isStart
      ? directionAngle + Math.PI / 2
      : directionAngle - Math.PI / 2;
    const endAngle = startAngle + Math.PI;

    for (let segment = 0; segment <= capSegments; segment += 1) {
      const progress = segment / capSegments;
      const angle = startAngle + (endAngle - startAngle) * progress;
      vertices.push(
        center.x + Math.cos(angle) * radius,
        center.y + Math.sin(angle) * radius,
        0,
      );
    }

    for (let segment = 0; segment < capSegments; segment += 1) {
      indices.push(base, base + segment + 1, base + segment + 2);
    }
  };

  const sideIndices = filteredPoints.map((point, index) => {
    const offset = getJoinOffset(index);
    return {
      left: pushVertex({ x: point.x + offset.x, y: point.y + offset.y }),
      right: pushVertex({ x: point.x - offset.x, y: point.y - offset.y }),
    };
  });

  for (let index = 0; index < sideIndices.length - 1; index += 1) {
    const current = sideIndices[index];
    const next = sideIndices[index + 1];
    indices.push(
      current.left,
      current.right,
      next.left,
      current.right,
      next.right,
      next.left,
    );
  }

  const firstDirection = getDirection(filteredPoints[0], filteredPoints[1]);
  const lastDirection = getDirection(
    filteredPoints[filteredPoints.length - 2],
    filteredPoints[filteredPoints.length - 1],
  );
  if (firstDirection) addRoundCap(filteredPoints[0], firstDirection, true);
  if (lastDirection) {
    addRoundCap(
      filteredPoints[filteredPoints.length - 1],
      lastDirection,
      false,
    );
  }

  if (vertices.length === 0 || indices.length === 0) return undefined;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

type StrokeMeshProperties = {
  stroke: Stroke;
  renderVisual: boolean;
  activelyDrawing: boolean;
  hitTestEnabled: boolean;
  selected: boolean;
  groupSelected: boolean;
  canMove: boolean;
  canResize: boolean;
  onSelect: (event: ThreeEvent<PointerEvent>) => void;
  onMoveStart: (point: Point2D) => void;
};

export function StrokeMesh({
  stroke,
  renderVisual,
  activelyDrawing,
  hitTestEnabled,
  selected,
  groupSelected,
  canMove,
  canResize,
  onSelect,
  onMoveStart,
}: StrokeMeshProperties) {
  const strokeSceneName = `stroke:${stroke.id}`;
  const activeRenderCacheReference = useRef<ActiveStrokeRenderCache>({
    strokeId: undefined,
    frozenPointCount: 0,
    frozenRenderPoints: [],
  });
  const bounds = useMemo(() => getPointBounds(stroke.points), [stroke.points]);
  const localPoints = useMemo(
    () =>
      stroke.points.map((point) => ({
        x: point.x - bounds.centerX,
        y: point.y - bounds.centerY,
      })),
    [bounds.centerX, bounds.centerY, stroke.points],
  );
  const geometry = useMemo(() => {
    if (localPoints.length < 2) return undefined;
    const sampledPoints = activelyDrawing
      ? getStableActiveStrokeRenderPoints({
          strokeId: stroke.id,
          points: stroke.points,
          strokeSize: stroke.size,
          cache: activeRenderCacheReference.current,
        }).map((point) => ({
          x: point.x - bounds.centerX,
          y: point.y - bounds.centerY,
        }))
      : getStrokeRenderPoints(localPoints, {
          activelyDrawing,
          strokeSize: stroke.size,
        });
    if (sampledPoints.length < 2) return undefined;
    const pickerRadius = Math.max(stroke.size * 1.45, stroke.size + 1.8);
    const visual = createStrokeRibbonGeometry(sampledPoints, stroke.size, 18);
    if (!visual) return undefined;

    return {
      visual,
      picker: hitTestEnabled
        ? createStrokeRibbonGeometry(sampledPoints, pickerRadius, 18)
        : undefined,
    };
  }, [
    activelyDrawing,
    bounds.centerX,
    bounds.centerY,
    hitTestEnabled,
    localPoints,
    stroke.id,
    stroke.points,
    stroke.size,
  ]);

  return (
    <group
      name={strokeSceneName}
      position={[bounds.centerX, bounds.centerY, layerToZ(stroke.layer)]}
      rotation={[0, 0, THREE.MathUtils.degToRad(stroke.rotation ?? 0)]}
    >
      {geometry ? (
        <>
          {geometry.picker ? (
            <mesh
              name={`${strokeSceneName}:picker`}
              geometry={geometry.picker}
              renderOrder={stroke.layer * 10 + 2}
              onPointerDown={onSelect}
              userData={{
                sceneType: "stroke",
                sceneId: stroke.id,
                sceneLayer: stroke.layer,
                sceneName: strokeSceneName,
              }}
            >
              <meshBasicMaterial
                transparent
                opacity={0}
                depthTest={false}
                depthWrite={false}
              />
            </mesh>
          ) : undefined}
          {renderVisual ? (
            <mesh
              name={`${strokeSceneName}:visual`}
              geometry={geometry.visual}
              renderOrder={stroke.layer * 10 + 1}
              onPointerDown={onSelect}
              userData={{
                sceneType: "stroke",
                sceneId: stroke.id,
                sceneLayer: stroke.layer,
                sceneName: strokeSceneName,
              }}
            >
              <meshBasicMaterial
                color={stroke.color}
                transparent
                opacity={1}
                depthTest={false}
                depthWrite={false}
                side={THREE.DoubleSide}
              />
            </mesh>
          ) : undefined}
        </>
      ) : undefined}
      {selected || groupSelected ? (
        <group name={`${strokeSceneName}:selection`} position={[0, 0, 0.04]}>
          <SelectionFrame
            name={`${strokeSceneName}:selection-frame`}
            width={bounds.width}
            height={bounds.height}
            padding={46}
          />
          {selected && canResize ? (
            <>
              <ResizeHandleMarker
                name={`${strokeSceneName}:resize-handle:se`}
                width={bounds.width}
                height={bounds.height}
                offset={23}
                handleSize={8}
              />
              <RotationHandleMarker
                name={`${strokeSceneName}:rotation-handle`}
                height={bounds.height}
                offset={23}
                distance={30}
              />
            </>
          ) : undefined}
        </group>
      ) : undefined}
    </group>
  );
}
