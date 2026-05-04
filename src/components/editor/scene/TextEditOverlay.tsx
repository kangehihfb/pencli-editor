import { Html } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent } from "react";
import * as THREE from "three";
import { getEditorTextFontFamily } from "../../../lib/editorTextFonts";
import {
  DEFAULT_TEXT_FONT_SIZE,
  measureTextObject,
} from "../../../lib/objectTexture";
import { layerToZ } from "../../../lib/sceneMath";
import type { WebGLObject } from "../../../types/editor";

type TextEditOverlayProperties = {
  object: WebGLObject;
  value: string;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: (event: FocusEvent<HTMLTextAreaElement>) => void;
};

export function TextEditOverlay({
  object,
  value,
  onChange,
  onKeyDown,
  onBlur,
}: TextEditOverlayProperties) {
  const { camera, size } = useThree();
  const textareaReference = useRef<HTMLTextAreaElement>(undefined);
  const scrollContainerReference = useRef<HTMLElement | undefined>(undefined);
  const scrollPositionReference = useRef({ left: 0, top: 0 });
  const [draftValue, setDraftValue] = useState(value);
  const overlayName = `text-edit-overlay:${object.id}`;
  const pixelScale =
    camera instanceof THREE.OrthographicCamera
      ? Math.min(
          size.width /
            (Math.abs(camera.right - camera.left) /
              Math.max(camera.zoom, 0.001)),
          size.height /
            (Math.abs(camera.top - camera.bottom) /
              Math.max(camera.zoom, 0.001)),
        )
      : 1;
  const fontSize = object.fontSize ?? DEFAULT_TEXT_FONT_SIZE;
  const fontFamily = getEditorTextFontFamily(object.fontFamily);
  const measured = useMemo(
    () => measureTextObject(draftValue, fontSize, object.fontFamily),
    [draftValue, fontSize, object.fontFamily],
  );
  const maxOverlayWidth = Math.max(96, size.width - 24);
  const maxOverlayHeight = Math.max(
    fontSize * 1.55 * pixelScale,
    size.height - 24,
  );
  const overlayWidth = Math.min(
    maxOverlayWidth,
    Math.max(96, object.width * pixelScale, measured.width * pixelScale),
  );
  const overlayHeight = Math.min(
    maxOverlayHeight,
    Math.max(
      fontSize * 1.55 * pixelScale,
      object.height * pixelScale,
      measured.height * pixelScale,
    ),
  );
  const overlayFontSize = fontSize * pixelScale;
  const overlayLineHeight = fontSize * 1.22 * pixelScale;

  const captureScrollPosition = useCallback(() => {
    const textarea = textareaReference.current;
    const scrollContainer = textarea?.closest<HTMLElement>(
      ".stage-canvas-frame",
    );
    if (!scrollContainer) return;

    scrollContainerReference.current = scrollContainer;
    scrollPositionReference.current = {
      left: scrollContainer.scrollLeft,
      top: scrollContainer.scrollTop,
    };
  }, []);

  const restoreScrollPosition = useCallback(() => {
    const scrollContainer = scrollContainerReference.current;
    if (!scrollContainer) return;

    scrollContainer.scrollLeft = scrollPositionReference.current.left;
    scrollContainer.scrollTop = scrollPositionReference.current.top;
  }, []);

  const restoreScrollAfterBrowserFocus = useCallback(() => {
    restoreScrollPosition();
    requestAnimationFrame(restoreScrollPosition);
  }, [restoreScrollPosition]);

  const focusTextarea = useCallback(() => {
    const textarea = textareaReference.current;
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
      style={{ pointerEvents: "auto", zIndex: 2_147_483_647 }}
    >
      <div
        className="text-edit-overlay-wrap"
        style={{ transform: `rotate(${object.rotation ?? 0}deg)` }}
      >
        <textarea
          ref={textareaReference}
          className="text-edit-overlay"
          data-scene-name={overlayName}
          style={{
            width: `${overlayWidth}px`,
            height: `${overlayHeight}px`,
            color: "transparent",
            WebkitTextFillColor: "transparent",
            fontFamily,
            fontSize: `${overlayFontSize}px`,
            lineHeight: `${overlayLineHeight}px`,
          }}
          defaultValue={value}
          autoFocus
          spellCheck={false}
          wrap="off"
          aria-label="텍스트 입력"
          onCompositionEnd={(event) => {
            const { value } = event.currentTarget;
            setDraftValue(value);
            onChange(value);
            restoreScrollAfterBrowserFocus();
          }}
          onInput={(event) => {
            const { value } = event.currentTarget;
            setDraftValue(value);
            onChange(value);
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
