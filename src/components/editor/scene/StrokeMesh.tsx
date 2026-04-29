import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as ClipperLib from 'clipper-lib';
import { getStrokePoints } from 'perfect-freehand';
import * as THREE from 'three';
import { getPointBounds, layerToZ } from '../../../lib/sceneMath';
import type { Point2D, Stroke } from '../../../types/editor';
import { ResizeHandleMarker, SelectionFrame } from './SelectionVisuals';

const clipperScale = 100;
const strokeSmoothingOptions = {
  thinning: 0,
  smoothing: 0.46,
  streamline: 0.18,
  simulatePressure: true,
  last: true,
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
} as const;

function createShapeGeometryFromPaths(paths: ClipperLib.Paths) {
  const validPaths = paths.filter((path) => path.length >= 3);
  const outerPaths = validPaths.filter((path) => ClipperLib.Clipper.Orientation(path));
  const holePaths = validPaths.filter((path) => !ClipperLib.Clipper.Orientation(path));

  const shapes = outerPaths.map((path) => {
    const shape = new THREE.Shape();
    shape.moveTo(path[0].X / clipperScale, path[0].Y / clipperScale);

    for (let index = 1; index < path.length; index += 1) {
      shape.lineTo(path[index].X / clipperScale, path[index].Y / clipperScale);
    }
    shape.closePath();
    return { shape, path };
  });

  holePaths.forEach((holePath) => {
    const target = shapes.find(({ path }) => ClipperLib.Clipper.PointInPolygon(holePath[0], path) !== 0);
    if (!target) return;

    const hole = new THREE.Path();
    hole.moveTo(holePath[0].X / clipperScale, holePath[0].Y / clipperScale);

    for (let index = 1; index < holePath.length; index += 1) {
      hole.lineTo(holePath[index].X / clipperScale, holePath[index].Y / clipperScale);
    }
    hole.closePath();
    target.shape.holes.push(hole);
  });

  if (shapes.length === 0) return null;

  const geometry = new THREE.ShapeGeometry(shapes.map(({ shape }) => shape));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function getUsableStrokePoints(points: Point2D[]) {
  return points.filter((point, index) => {
    const previous = points[index - 1];
    if (!previous) return true;
    return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.001;
  });
}

function getPerfectFreehandCenterPoints(points: Point2D[], radius: number) {
  const usablePoints = getUsableStrokePoints(points);
  if (usablePoints.length < 2) return null;

  const strokePoints = getStrokePoints(
    usablePoints.map((point) => [point.x, point.y]),
    {
      ...strokeSmoothingOptions,
      size: radius * 2,
    },
  );

  const centerPoints = strokePoints.map(({ point }) => ({ x: point[0], y: point[1] }));
  return centerPoints.length >= 2 ? centerPoints : null;
}

function createStrokeRibbonGeometry(points: Point2D[], radius: number, jointSegments = 6) {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const dx = next.x - current.x;
    const dy = next.y - current.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.001) continue;

    const normalX = -dy / length;
    const normalY = dx / length;
    const base = vertices.length / 3;
    vertices.push(
      current.x + normalX * radius,
      current.y + normalY * radius,
      0,
      current.x - normalX * radius,
      current.y - normalY * radius,
      0,
      next.x + normalX * radius,
      next.y + normalY * radius,
      0,
      next.x - normalX * radius,
      next.y - normalY * radius,
      0,
    );
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  points.forEach((point, index) => {
    const isEndpoint = index === 0 || index === points.length - 1;
    const segments = isEndpoint ? jointSegments + 2 : jointSegments;
    const base = vertices.length / 3;
    vertices.push(point.x, point.y, 0);

    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      vertices.push(point.x + Math.cos(angle) * radius, point.y + Math.sin(angle) * radius, 0);
    }

    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(base, base + segment + 1, base + segment + 2);
    }
  });

  if (vertices.length === 0 || indices.length === 0) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRoundedStrokeGeometry(points: Point2D[], radius: number) {
  const centerPoints = getPerfectFreehandCenterPoints(points, radius);
  if (!centerPoints) return null;

  const path = centerPoints.map((point) => ({
    X: Math.round(point.x * clipperScale),
    Y: Math.round(point.y * clipperScale),
  }));
  const offset = new ClipperLib.ClipperOffset(2, Math.max(1, radius * clipperScale * 0.08));
  const solution: ClipperLib.Paths = [];

  offset.AddPath(path, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etOpenRound);
  offset.Execute(solution, radius * clipperScale);

  const cleaned = ClipperLib.Clipper.CleanPolygons(solution, Math.max(1, clipperScale * 0.02));
  return createShapeGeometryFromPaths(cleaned) ?? createStrokeRibbonGeometry(centerPoints, radius, 8);
}

type StrokeMeshProps = {
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
}: StrokeMeshProps) {
  const strokeSceneName = `stroke:${stroke.id}`;
  const geometry = useMemo(() => {
    if (stroke.points.length < 2) return null;
    const pickerRadius = Math.max(stroke.size * 1.45, stroke.size + 1.8);
    const visual = createRoundedStrokeGeometry(stroke.points, stroke.size);
    if (!visual) return null;

    return {
      visual,
      picker: hitTestEnabled ? createRoundedStrokeGeometry(stroke.points, pickerRadius) : null,
    };
  }, [activelyDrawing, hitTestEnabled, stroke.points, stroke.size]);

  const bounds = useMemo(() => getPointBounds(stroke.points), [stroke.points]);

  return (
    <group name={strokeSceneName} position={[0, 0, layerToZ(stroke.layer)]}>
      {geometry ? (
        <>
          {geometry.picker ? (
            <mesh
              name={`${strokeSceneName}:picker`}
              geometry={geometry.picker}
              renderOrder={stroke.layer * 10 + 2}
              onPointerDown={onSelect}
              userData={{ sceneType: 'stroke', sceneId: stroke.id, sceneLayer: stroke.layer, sceneName: strokeSceneName }}
            >
              <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
            </mesh>
          ) : null}
          {renderVisual ? (
            <>
              <mesh
                name={`${strokeSceneName}:visual`}
                geometry={geometry.visual}
                renderOrder={stroke.layer * 10 + 1}
                onPointerDown={onSelect}
                userData={{ sceneType: 'stroke', sceneId: stroke.id, sceneLayer: stroke.layer, sceneName: strokeSceneName }}
              >
                <meshBasicMaterial color={stroke.color} transparent opacity={1} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
              </mesh>
            </>
          ) : null}
        </>
      ) : null}
      {selected || groupSelected ? (
        <group name={`${strokeSceneName}:selection`} position={[bounds.centerX, bounds.centerY, 0.04]}>
          <SelectionFrame name={`${strokeSceneName}:selection-frame`} width={bounds.width + 22} height={bounds.height + 22} />
          {selected && canResize ? (
            <ResizeHandleMarker name={`${strokeSceneName}:resize-handle:se`} width={bounds.width + 22} height={bounds.height + 22} />
          ) : null}
        </group>
      ) : null}
    </group>
  );
}
