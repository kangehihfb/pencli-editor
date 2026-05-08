import type { ThreeEvent } from "@react-three/fiber";
import { useMemo } from "react";
import * as THREE from "three";
import { getPointBounds, layerToZ } from "../../../lib/sceneMath";
import type { Point2D, Stroke } from "../../../types/editor";
import {
  ResizeHandleMarker,
  RotationHandleMarker,
  SelectionFrame,
} from "./SelectionVisuals";

function createStrokeRibbonGeometry(
  points: Point2D[],
  radius: number,
  jointSegments = 6,
) {
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

  for (const [index, point] of points.entries()) {
    const isEndpoint = index === 0 || index === points.length - 1;
    const segments = isEndpoint ? jointSegments + 2 : jointSegments;
    const base = vertices.length / 3;
    vertices.push(point.x, point.y, 0);

    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      vertices.push(
        point.x + Math.cos(angle) * radius,
        point.y + Math.sin(angle) * radius,
        0,
      );
    }

    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(base, base + segment + 1, base + segment + 2);
    }
  }

  if (vertices.length === 0 || indices.length === 0) return undefined;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
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
    const pickerRadius = Math.max(stroke.size * 1.45, stroke.size + 1.8);
    const visual = createStrokeRibbonGeometry(
      localPoints,
      stroke.size,
      activelyDrawing ? 3 : 5,
    );
    if (!visual) return undefined;

    return {
      visual,
      picker: hitTestEnabled
        ? createStrokeRibbonGeometry(
            localPoints,
            pickerRadius,
            5,
          )
        : undefined,
    };
  }, [activelyDrawing, hitTestEnabled, localPoints, stroke.size]);

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
