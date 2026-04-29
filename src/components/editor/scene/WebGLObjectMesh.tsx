import type { ThreeEvent } from '@react-three/fiber';
import { useMemo } from 'react';
import * as THREE from 'three';
import { createImageObjectTexture, createTextObjectTexture } from '../../../lib/objectTexture';
import { layerToZ } from '../../../lib/sceneMath';
import type { WebGLObject } from '../../../types/editor';
import { ResizeHandleMarker, RotationHandleMarker, SelectionFrame } from './SelectionVisuals';

type WebGLObjectMeshProps = {
  object: WebGLObject;
  renderVisual: boolean;
  selected: boolean;
  groupSelected: boolean;
  editing: boolean;
  canResize: boolean;
  onSelect: (event: ThreeEvent<PointerEvent>) => void;
  onStartTextEdit: (object: WebGLObject) => void;
};

export function WebGLObjectMesh({
  object,
  renderVisual,
  selected,
  groupSelected,
  editing,
  canResize,
  onSelect,
  onStartTextEdit,
}: WebGLObjectMeshProps) {
  const objectSceneName = `object:${object.kind}:${object.id}`;
  const isExamImage = object.id === 'object_exam_active';
  const texture = useMemo(() => {
    if (object.kind === 'image') {
      return createImageObjectTexture({
        imageSrc: object.imageSrc,
        backgroundColor: object.imageBackground,
      });
    }
    if (object.kind === 'text') {
      return createTextObjectTexture({
        text: object.text ?? '',
        width: object.width,
        height: object.height,
        fontSize: object.fontSize,
        color: object.color,
      });
    }
    return null;
  }, [object.color, object.fontSize, object.height, object.imageBackground, object.imageSrc, object.kind, object.text, object.width]);
  const shouldRenderVisual = renderVisual && !editing;

  return (
    <group name={objectSceneName} position={[object.x, object.y, layerToZ(object.layer)]} rotation={[0, 0, THREE.MathUtils.degToRad(object.rotation ?? 0)]}>
      <mesh
        name={`${objectSceneName}:surface`}
        renderOrder={object.layer * 10}
        onPointerDown={isExamImage ? undefined : onSelect}
        onDoubleClick={
          isExamImage || object.kind !== 'text'
            ? undefined
            : (event) => {
                event.stopPropagation();
                onStartTextEdit(object);
              }
        }
        userData={{ sceneType: 'object', sceneId: object.id, sceneKind: object.kind, sceneLayer: object.layer, sceneName: objectSceneName }}
      >
        <planeGeometry args={[object.width, object.height]} />
        <meshBasicMaterial
          map={shouldRenderVisual ? texture : undefined}
          colorWrite={shouldRenderVisual}
          opacity={shouldRenderVisual ? 1 : 0}
          transparent
          alphaTest={0}
          side={THREE.DoubleSide}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {(selected || groupSelected) && !isExamImage && !editing ? (
        <>
          <SelectionFrame name={`${objectSceneName}:selection-frame`} width={object.width} height={object.height} />
          {selected && canResize ? (
            <>
              <ResizeHandleMarker name={`${objectSceneName}:resize-handle:se`} width={object.width} height={object.height} />
              <RotationHandleMarker name={`${objectSceneName}:rotation-handle`} height={object.height} />
            </>
          ) : null}
        </>
      ) : null}
    </group>
  );
}
