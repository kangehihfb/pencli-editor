import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { getPointBounds, getSmoothedStrokePoints, layerToZ } from '../../../lib/sceneMath';
import type { Point2D, Stroke } from '../../../types/editor';
import { ResizeHandleMarker, SelectionFrame } from './SelectionVisuals';

type StrokeMeshProps = {
  stroke: Stroke;
  selected: boolean;
  groupSelected: boolean;
  canMove: boolean;
  canResize: boolean;
  onSelect: (event: ThreeEvent<PointerEvent>) => void;
  onMoveStart: (point: Point2D) => void;
};

export function StrokeMesh({
  stroke,
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
    const points = getSmoothedStrokePoints(stroke.points).map((point) => new THREE.Vector3(point.x, point.y, 0));
    const tubularSegments = Math.max(24, points.length * 2);
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal', 0.35);
    const pickerRadius = Math.max(stroke.size * 1.45, stroke.size + 0.018);
    return {
      visual: new THREE.TubeGeometry(curve, tubularSegments, stroke.size, 8, false),
      picker: new THREE.TubeGeometry(curve, tubularSegments, pickerRadius, 8, false),
    };
  }, [stroke.points, stroke.size]);

  const bounds = useMemo(() => getPointBounds(stroke.points), [stroke.points]);

  return (
    <group name={strokeSceneName} position={[0, 0, layerToZ(stroke.layer)]}>
      {geometry ? (
        <>
          <mesh
            name={`${strokeSceneName}:picker`}
            geometry={geometry.picker}
            renderOrder={stroke.layer * 10 + 2}
            onPointerDown={onSelect}
            userData={{ sceneType: 'stroke', sceneId: stroke.id, sceneLayer: stroke.layer, sceneName: strokeSceneName }}
          >
            <meshBasicMaterial transparent opacity={0} depthTest={false} depthWrite={false} />
          </mesh>
          <mesh
            name={`${strokeSceneName}:visual`}
            geometry={geometry.visual}
            renderOrder={stroke.layer * 10 + 1}
            onPointerDown={onSelect}
            userData={{ sceneType: 'stroke', sceneId: stroke.id, sceneLayer: stroke.layer, sceneName: strokeSceneName }}
          >
            <meshBasicMaterial color={stroke.color} depthTest={false} depthWrite={false} />
          </mesh>
        </>
      ) : null}
      {selected || groupSelected ? (
        <group name={`${strokeSceneName}:selection`} position={[bounds.centerX, bounds.centerY, 0.04]}>
          <SelectionFrame name={`${strokeSceneName}:selection-frame`} width={bounds.width + 0.22} height={bounds.height + 0.22} />
          {selected && canResize ? (
            <ResizeHandleMarker name={`${strokeSceneName}:resize-handle:se`} width={bounds.width + 0.22} height={bounds.height + 0.22} />
          ) : null}
        </group>
      ) : null}
    </group>
  );
}
