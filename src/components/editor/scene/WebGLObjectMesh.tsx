import type { ThreeEvent } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { loadEditorTextFont } from '../../../lib/editorTextFonts';
import { createImageObjectTexture, createTextObjectTexture, measureTextObject } from '../../../lib/objectTexture';
import { layerToZ } from '../../../lib/sceneMath';
import type { WebGLObject } from '../../../types/editor';
import { ResizeHandleMarker, RotationHandleMarker, SelectionFrame } from './SelectionVisuals';

type WebGLObjectMeshProps = {
  object: WebGLObject;
  renderVisual: boolean;
  selected: boolean;
  groupSelected: boolean;
  editing: boolean;
  draftText?: string;
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
  draftText,
  canResize,
  onSelect,
  onStartTextEdit,
}: WebGLObjectMeshProps) {
  const [fontReadyRevision, setFontReadyRevision] = useState(0);
  const objectSceneName = `object:${object.kind}:${object.id}`;
  const isExamImage = object.id === 'object_exam_active';

  useEffect(() => {
    if (object.kind !== 'text') return;

    let cancelled = false;
    loadEditorTextFont(object.fontFamily)
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setFontReadyRevision((value) => value + 1);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [object.fontFamily, object.kind]);

  const textValue = object.kind === 'text' ? draftText ?? object.text ?? '' : '';
  const visualSize = useMemo(() => {
    if (object.kind !== 'text' || draftText === undefined) {
      return {
        width: object.width,
        height: object.height,
      };
    }

    return measureTextObject(textValue, object.fontSize, object.fontFamily);
  }, [draftText, object.fontFamily, object.fontSize, object.height, object.kind, object.width, textValue]);

  const texture = useMemo(() => {
    if (object.kind === 'image') {
      return createImageObjectTexture({
        imageSrc: object.imageSrc,
        backgroundColor: object.imageBackground,
      });
    }
    if (object.kind === 'text') {
      return createTextObjectTexture({
        text: textValue,
        width: visualSize.width,
        height: visualSize.height,
        fontSize: object.fontSize,
        fontFamily: object.fontFamily,
        color: object.color,
      });
    }
    return null;
  }, [fontReadyRevision, object.color, object.fontFamily, object.fontSize, object.imageBackground, object.imageSrc, object.kind, textValue, visualSize.height, visualSize.width]);
  const shouldRenderVisual = renderVisual && (!editing || object.kind === 'text');

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
        <planeGeometry args={[visualSize.width, visualSize.height]} />
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
          <SelectionFrame name={`${objectSceneName}:selection-frame`} width={visualSize.width} height={visualSize.height} />
          {selected && canResize ? (
            <>
              <ResizeHandleMarker name={`${objectSceneName}:resize-handle:se`} width={visualSize.width} height={visualSize.height} />
              <RotationHandleMarker name={`${objectSceneName}:rotation-handle`} height={visualSize.height} />
            </>
          ) : null}
        </>
      ) : null}
    </group>
  );
}
