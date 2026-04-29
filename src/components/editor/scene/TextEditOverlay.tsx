import { Html } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import * as THREE from 'three';
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_FONT_SIZE, measureTextObject } from '../../../lib/objectTexture';
import { layerToZ } from '../../../lib/sceneMath';
import type { WebGLObject } from '../../../types/editor';

type TextEditOverlayProps = {
  object: WebGLObject;
  value: string;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: (event: FocusEvent<HTMLTextAreaElement>) => void;
};

export function TextEditOverlay({ object, value, onKeyDown, onBlur }: TextEditOverlayProps) {
  const { camera, size } = useThree();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollPositionRef = useRef({ left: 0, top: 0 });
  const [draftValue, setDraftValue] = useState(value);
  const overlayName = `text-edit-overlay:${object.id}`;
  const pixelScale =
    camera instanceof THREE.OrthographicCamera
      ? Math.min(
          size.width / (Math.abs(camera.right - camera.left) / Math.max(camera.zoom, 0.001)),
          size.height / (Math.abs(camera.top - camera.bottom) / Math.max(camera.zoom, 0.001)),
        )
      : 1;
  const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
  const measured = useMemo(() => measureTextObject(draftValue, fontSize), [draftValue, fontSize]);
  const maxOverlayWidth = Math.max(96, size.width - 24);
  const maxOverlayHeight = Math.max(fontSize * 1.55 * pixelScale, size.height - 24);
  const overlayWidth = Math.min(maxOverlayWidth, Math.max(96, object.width * pixelScale, measured.width * pixelScale));
  const overlayHeight = Math.min(
    maxOverlayHeight,
    Math.max(fontSize * 1.55 * pixelScale, object.height * pixelScale, measured.height * pixelScale),
  );
  const overlayFontSize = fontSize * pixelScale;
  const overlayLineHeight = fontSize * 1.22 * pixelScale;

  const captureScrollPosition = useCallback(() => {
    const textarea = textareaRef.current;
    const scrollContainer = textarea?.closest<HTMLElement>('.stage-canvas-frame');
    if (!scrollContainer) return;

    scrollContainerRef.current = scrollContainer;
    scrollPositionRef.current = {
      left: scrollContainer.scrollLeft,
      top: scrollContainer.scrollTop,
    };
  }, []);

  const restoreScrollPosition = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) return;

    scrollContainer.scrollLeft = scrollPositionRef.current.left;
    scrollContainer.scrollTop = scrollPositionRef.current.top;
  }, []);

  const restoreScrollAfterBrowserFocus = useCallback(() => {
    restoreScrollPosition();
    requestAnimationFrame(restoreScrollPosition);
  }, [restoreScrollPosition]);

  const focusTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    captureScrollPosition();
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    restoreScrollAfterBrowserFocus();
  }, [captureScrollPosition, restoreScrollAfterBrowserFocus]);

  useEffect(() => {
    focusTextarea();
    const animationFrame = requestAnimationFrame(focusTextarea);
    const fallbackTimer = window.setTimeout(focusTextarea, 80);

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(fallbackTimer);
    };
  }, [focusTextarea]);

  return (
    <Html
      name={overlayName}
      position={[object.x, object.y, layerToZ(object.layer) + 0.08]}
      center
      occlude={false}
      zIndexRange={[1_000_000, 0]}
      wrapperClass="text-edit-html"
      style={{ pointerEvents: 'auto', zIndex: 2_147_483_647 }}
    >
      <div
        className="text-edit-overlay-wrap"
        style={{ transform: `rotate(${object.rotation ?? 0}deg)` }}
      >
        <textarea
          ref={textareaRef}
          className="text-edit-overlay"
          data-scene-name={overlayName}
          style={{
            width: `${overlayWidth}px`,
            height: `${overlayHeight}px`,
            color: object.color ?? DEFAULT_TEXT_COLOR,
            fontSize: `${overlayFontSize}px`,
            lineHeight: `${overlayLineHeight}px`,
          }}
          defaultValue={value}
          autoFocus
          spellCheck={false}
          wrap="off"
          aria-label="텍스트 입력"
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={(event) => {
            isComposingRef.current = false;
            setDraftValue(event.currentTarget.value);
            restoreScrollAfterBrowserFocus();
          }}
          onInput={(event) => {
            const isComposingEvent = 'isComposing' in event.nativeEvent && Boolean(event.nativeEvent.isComposing);
            if (isComposingRef.current || isComposingEvent) return;
            setDraftValue(event.currentTarget.value);
            restoreScrollAfterBrowserFocus();
          }}
          onKeyDown={onKeyDown}
          onPointerDown={(event) => event.stopPropagation()}
          onFocus={focusTextarea}
          onBlur={onBlur}
        />
      </div>
    </Html>
  );
}
