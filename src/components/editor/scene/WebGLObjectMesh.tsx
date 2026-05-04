import { Text } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { useThree } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import {
  EDITOR_TEXT_TROIKA_PRELOAD_CHARACTERS,
  getEditorTextTroikaFontUrl,
  loadEditorTextFont,
} from '../../../lib/editorTextFonts';
import { createImageObjectTexture, createTextObjectTexture, measureTextObject } from '../../../lib/objectTexture';
import { layerToZ } from '../../../lib/sceneMath';
import type { WebGLObject } from '../../../types/editor';
import { ResizeHandleMarker, RotationHandleMarker, SelectionFrame } from './SelectionVisuals';

const useTroikaTextPoc = true;
const troikaTextSdfGlyphSize = 512;

type WebGLObjectMeshProps = {
  object: WebGLObject;
  renderVisual: boolean;
  renderTextVisual: boolean;
  selected: boolean;
  groupSelected: boolean;
  editing: boolean;
  draftText?: string;
  canResize: boolean;
  onSelect: (event: ThreeEvent<PointerEvent>) => void;
  onStartTextEdit: (object: WebGLObject) => void;
};

function getScreenPixelsPerWorldUnit(camera: THREE.Camera, size: { width: number; height: number }, devicePixelRatio: number) {
  if (!(camera instanceof THREE.OrthographicCamera)) return undefined;

  const visibleWorldWidth = Math.abs(camera.right - camera.left) / Math.max(camera.zoom, 0.001);
  const visibleWorldHeight = Math.abs(camera.top - camera.bottom) / Math.max(camera.zoom, 0.001);
  const horizontalScale = size.width / Math.max(visibleWorldWidth, 0.001);
  const verticalScale = size.height / Math.max(visibleWorldHeight, 0.001);
  return Math.min(horizontalScale, verticalScale) * devicePixelRatio;
}

function getPixelSnappedPoint(
  point: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number },
  devicePixelRatio: number,
) {
  const width = size.width * devicePixelRatio;
  const height = size.height * devicePixelRatio;
  if (width <= 0 || height <= 0) return point;

  const projected = point.clone().project(camera);
  const screenX = (projected.x * 0.5 + 0.5) * width;
  const screenY = (-projected.y * 0.5 + 0.5) * height;
  const snappedX = Math.round(screenX);
  const snappedY = Math.round(screenY);
  return new THREE.Vector3(
    (snappedX / width) * 2 - 1,
    -(snappedY / height) * 2 + 1,
    projected.z,
  ).unproject(camera);
}

export function WebGLObjectMesh({
  object,
  renderVisual,
  renderTextVisual,
  selected,
  groupSelected,
  editing,
  draftText,
  canResize,
  onSelect,
  onStartTextEdit,
}: WebGLObjectMeshProps) {
  const { camera, size, viewport } = useThree();
  const [fontReadyRevision, setFontReadyRevision] = useState(0);
  const objectSceneName = `object:${object.kind}:${object.id}`;
  const isExamImage = object.id === 'object_exam_active';
  const devicePixelRatio = viewport.dpr || 1;
  const textPixelsPerWorldUnit = useMemo(
    () => (object.kind === 'text' ? getScreenPixelsPerWorldUnit(camera, size, devicePixelRatio) : undefined),
    [camera, devicePixelRatio, object.kind, size],
  );
  const layerZ = layerToZ(object.layer);
  const visualPosition = useMemo(() => {
    if (object.kind !== 'text') return new THREE.Vector3(object.x, object.y, layerZ);
    return getPixelSnappedPoint(new THREE.Vector3(object.x, object.y, layerZ), camera, size, devicePixelRatio);
  }, [camera, devicePixelRatio, layerZ, object.kind, object.x, object.y, size]);

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
  const useTroikaTextVisual = object.kind === 'text' && renderTextVisual && useTroikaTextPoc;
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
      if (useTroikaTextVisual) return null;
      if (!renderTextVisual) return null;
      return createTextObjectTexture({
        text: textValue,
        width: visualSize.width,
        height: visualSize.height,
        fontSize: object.fontSize,
        fontFamily: object.fontFamily,
        color: object.color,
        pixelsPerWorldUnit: textPixelsPerWorldUnit,
      });
    }
    return null;
  }, [fontReadyRevision, object.color, object.fontFamily, object.fontSize, object.imageBackground, object.imageSrc, object.kind, renderTextVisual, textPixelsPerWorldUnit, textValue, useTroikaTextVisual, visualSize.height, visualSize.width]);
  const shouldRenderVisual = renderVisual && (!editing || object.kind === 'text') && (object.kind !== 'text' || renderTextVisual);
  const shouldRenderCanvasTexture = shouldRenderVisual && !useTroikaTextVisual;
  const shouldRenderTroikaText = shouldRenderVisual && useTroikaTextVisual;
  const textFontUrl = object.kind === 'text' ? getEditorTextTroikaFontUrl(object.fontFamily) : undefined;

  return (
    <group name={objectSceneName} position={visualPosition} rotation={[0, 0, THREE.MathUtils.degToRad(object.rotation ?? 0)]}>
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
          map={shouldRenderCanvasTexture ? texture : undefined}
          colorWrite={shouldRenderCanvasTexture}
          opacity={shouldRenderCanvasTexture ? 1 : 0}
          transparent
          alphaTest={0}
          side={THREE.DoubleSide}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      {object.kind === 'text' && shouldRenderTroikaText ? (
        <Text
          name={`${objectSceneName}:troika-text`}
          font={textFontUrl}
          characters={`${EDITOR_TEXT_TROIKA_PRELOAD_CHARACTERS}${textValue}`}
          sdfGlyphSize={troikaTextSdfGlyphSize}
          fontSize={object.fontSize}
          maxWidth={visualSize.width}
          color={object.color}
          lineHeight={1.22}
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          whiteSpace="normal"
          scale={[1, -1, 1]}
          renderOrder={object.layer * 10 + 1}
          userData={{ sceneType: 'object', sceneId: object.id, sceneKind: object.kind, sceneLayer: object.layer, sceneName: objectSceneName }}
        >
          {textValue || ' '}
        </Text>
      ) : null}
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
