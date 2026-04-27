import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import type { ChangeEvent, KeyboardEvent } from 'react';
import * as THREE from 'three';
import { layerToZ } from '../../../lib/sceneMath';
import type { WebGLObject } from '../../../types/editor';

type TextEditOverlayProps = {
  object: WebGLObject;
  value: string;
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
};

export function TextEditOverlay({ object, value, onChange, onKeyDown, onBlur }: TextEditOverlayProps) {
  const { camera, size } = useThree();
  const overlayName = `text-edit-overlay:${object.id}`;
  const pixelScale =
    camera instanceof THREE.OrthographicCamera
      ? Math.min(
          size.width / (Math.abs(camera.right - camera.left) / Math.max(camera.zoom, 0.001)),
          size.height / (Math.abs(camera.top - camera.bottom) / Math.max(camera.zoom, 0.001)),
        )
      : 1;
  const overlayWidth = Math.max(100, object.width * pixelScale);
  const overlayHeight = Math.max(36, object.height * pixelScale);

  return (
    <Html
      name={overlayName}
      position={[object.x, object.y, layerToZ(object.layer) + 0.08]}
      center
      occlude={false}
      zIndexRange={[100, 0]}
      style={{ pointerEvents: 'auto' }}
    >
      <textarea
        className="text-edit-overlay"
        data-scene-name={overlayName}
        style={{ width: `${overlayWidth}px`, height: `${overlayHeight}px` }}
        value={value}
        autoFocus
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      />
    </Html>
  );
}
