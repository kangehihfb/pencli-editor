import * as THREE from "three";
import { getEditorPointerPoint } from "../../../lib/sceneMath";
import type { Point2D, PointBounds } from "../../../types/editor";

const selectionGreen = "#22c55e";
const selectionRenderOrder = 1_000_000;

export function SelectedMoveSurface({
  name = "selection:move-surface",
  width,
  height,
  onMoveStart,
}: {
  name?: string;
  width: number;
  height: number;
  onMoveStart: (point: Point2D) => void;
}) {
  return (
    <mesh
      name={name}
      position={[0, 0, 0.02]}
      renderOrder={selectionRenderOrder}
      onPointerDown={(event) => {
        event.stopPropagation();
        onMoveStart(getEditorPointerPoint(event));
      }}
    >
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial
        transparent
        opacity={0}
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
}

export function SelectionFrame({
  name = "selection:frame",
  width,
  height,
  padding = 28,
}: {
  name?: string;
  width: number;
  height: number;
  padding?: number;
}) {
  const paddedWidth = width + padding;
  const paddedHeight = height + padding;

  return (
    <group name={name} position={[0, 0, 0.04]}>
      <lineSegments
        name={`${name}:outline`}
        renderOrder={selectionRenderOrder}
        raycast={() => undefined}
      >
        <edgesGeometry
          args={[new THREE.PlaneGeometry(paddedWidth, paddedHeight)]}
        />
        <lineBasicMaterial
          color={selectionGreen}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

export function MarqueeFrame({
  name = "selection:marquee",
  bounds,
}: {
  name?: string;
  bounds: PointBounds;
}) {
  return (
    <group name={name} position={[bounds.centerX, bounds.centerY, 0.12]}>
      <mesh name={`${name}:fill`} renderOrder={selectionRenderOrder + 2}>
        <planeGeometry args={[bounds.width, bounds.height]} />
        <meshBasicMaterial
          color="#2a63ff"
          transparent
          opacity={0.08}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <lineSegments
        name={`${name}:border`}
        renderOrder={selectionRenderOrder + 3}
      >
        <edgesGeometry
          args={[new THREE.PlaneGeometry(bounds.width, bounds.height)]}
        />
        <lineBasicMaterial
          color="#2a63ff"
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}

export function ResizeHandleMarker({
  name = "selection:resize-handle:se",
  width,
  height,
  offset = 14,
  handleSize = 8,
}: {
  name?: string;
  width: number;
  height: number;
  offset?: number;
  handleSize?: number;
}) {
  const halfWidth = width / 2 + offset;
  const halfHeight = height / 2 + offset;
  const visualSize = handleSize;
  const handlePositions = [
    [-halfWidth, -halfHeight],
    [0, -halfHeight],
    [halfWidth, -halfHeight],
    [-halfWidth, 0],
    [halfWidth, 0],
    [-halfWidth, halfHeight],
    [0, halfHeight],
    [halfWidth, halfHeight],
  ];

  return (
    <group name={name} position={[0, 0, 0.08]}>
      {handlePositions.map(([x, y], index) => (
        <group
          key={`${name}:handle:${index}`}
          name={`${name}:handle:${index}`}
          position={[x, y, 0]}
        >
          <mesh
            name={`${name}:handle:${index}:fill`}
            position={[0, 0, 0.01]}
            renderOrder={selectionRenderOrder + 2}
            raycast={() => undefined}
          >
            <planeGeometry args={[visualSize, visualSize]} />
            <meshBasicMaterial
              color="#ffffff"
              transparent
              opacity={1}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
          <lineSegments
            name={`${name}:handle:${index}:border`}
            position={[0, 0, 0.02]}
            renderOrder={selectionRenderOrder + 3}
            raycast={() => undefined}
          >
            <edgesGeometry
              args={[new THREE.PlaneGeometry(visualSize, visualSize)]}
            />
            <lineBasicMaterial
              color={selectionGreen}
              transparent
              opacity={1}
              depthTest={false}
              depthWrite={false}
            />
          </lineSegments>
        </group>
      ))}
    </group>
  );
}

export function RotationHandleMarker({
  name = "selection:rotation-handle",
  height,
  offset = 14,
  distance = 26,
  handleSize = 9,
}: {
  name?: string;
  height: number;
  offset?: number;
  distance?: number;
  handleSize?: number;
}) {
  const topY = -height / 2 - offset;
  const handleY = topY - distance;

  return (
    <group name={name} position={[0, 0, 0.09]}>
      <mesh
        name={`${name}:stem`}
        position={[0, topY - distance / 2, 0]}
        renderOrder={selectionRenderOrder + 2}
        raycast={() => undefined}
      >
        <planeGeometry args={[1, distance]} />
        <meshBasicMaterial
          color={selectionGreen}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        name={`${name}:fill`}
        position={[0, handleY, 0.01]}
        renderOrder={selectionRenderOrder + 3}
        raycast={() => undefined}
      >
        <circleGeometry args={[handleSize / 2, 24]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <lineSegments
        name={`${name}:border`}
        position={[0, handleY, 0.02]}
        renderOrder={selectionRenderOrder + 4}
        raycast={() => undefined}
      >
        <edgesGeometry args={[new THREE.CircleGeometry(handleSize / 2, 24)]} />
        <lineBasicMaterial
          color={selectionGreen}
          transparent
          opacity={1}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
    </group>
  );
}
