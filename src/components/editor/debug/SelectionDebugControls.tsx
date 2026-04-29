import { useControls } from 'leva';
import { useEffect, useRef } from 'react';
import type { Stroke, WebGLObject } from '../../../types/editor';

type SelectionDebugControlsProps = {
  selectedObject: WebGLObject | null;
  selectedStroke: Stroke | null;
  onUpdateObject: (id: string, patch: Partial<Pick<WebGLObject, 'x' | 'y' | 'width' | 'height' | 'rotation' | 'layer'>>) => void;
  onUpdateStroke: (id: string, patch: Partial<Pick<Stroke, 'layer' | 'size'>>) => void;
};

export function SelectionDebugControls({
  selectedObject,
  selectedStroke,
  onUpdateObject,
  onUpdateStroke,
}: SelectionDebugControlsProps) {
  const selectedId = selectedObject?.id ?? selectedStroke?.id ?? 'none';
  const selectedObjectRef = useRef(selectedObject);
  const selectedStrokeRef = useRef(selectedStroke);
  const ignoreDebugChangesUntilRef = useRef(0);

  useEffect(() => {
    selectedObjectRef.current = selectedObject;
    selectedStrokeRef.current = selectedStroke;
  }, [selectedObject, selectedStroke]);

  const [, setDebugControls] = useControls(
    'Selected Element',
    () => ({
      type: {
        value: 'none',
        editable: false,
      },
      id: {
        value: 'none',
        editable: false,
      },
      x: {
        value: 0,
        min: 0,
        max: 1000,
        step: 1,
        onChange: (value: number) => {
          if (Date.now() < ignoreDebugChangesUntilRef.current) return;
          if (selectedObjectRef.current) onUpdateObject(selectedObjectRef.current.id, { x: value });
        },
      },
      y: {
        value: 0,
        min: 0,
        max: 760,
        step: 1,
        onChange: (value: number) => {
          if (Date.now() < ignoreDebugChangesUntilRef.current) return;
          if (selectedObjectRef.current) onUpdateObject(selectedObjectRef.current.id, { y: value });
        },
      },
      width: {
        value: 100,
        min: 12,
        max: 1000,
        step: 1,
        onChange: (value: number) => {
          if (Date.now() < ignoreDebugChangesUntilRef.current) return;
          if (selectedObjectRef.current) onUpdateObject(selectedObjectRef.current.id, { width: value });
        },
      },
      height: {
        value: 46,
        min: 12,
        max: 760,
        step: 1,
        onChange: (value: number) => {
          if (Date.now() < ignoreDebugChangesUntilRef.current) return;
          if (selectedObjectRef.current) onUpdateObject(selectedObjectRef.current.id, { height: value });
        },
      },
      rotation: {
        value: 0,
        min: -180,
        max: 180,
        step: 1,
        onChange: (value: number) => {
          if (Date.now() < ignoreDebugChangesUntilRef.current) return;
          if (selectedObjectRef.current) onUpdateObject(selectedObjectRef.current.id, { rotation: value });
        },
      },
      layer: {
        value: 0,
        min: 0,
        max: 100,
        step: 1,
        onChange: (value: number) => {
          if (Date.now() < ignoreDebugChangesUntilRef.current) return;
          if (selectedObjectRef.current) onUpdateObject(selectedObjectRef.current.id, { layer: value });
          if (selectedStrokeRef.current) onUpdateStroke(selectedStrokeRef.current.id, { layer: value });
        },
      },
      strokeSize: {
        value: 3.5,
        min: 1,
        max: 16,
        step: 0.5,
        onChange: (value: number) => {
          if (Date.now() < ignoreDebugChangesUntilRef.current) return;
          if (selectedStrokeRef.current) onUpdateStroke(selectedStrokeRef.current.id, { size: value });
        },
      },
    }),
    [],
  );

  useEffect(() => {
    ignoreDebugChangesUntilRef.current = Date.now() + 150;
    setDebugControls({
      type: selectedObject ? selectedObject.kind : selectedStroke ? 'stroke' : 'none',
      id: selectedId.slice(0, 18),
      x: selectedObject?.x ?? 0,
      y: selectedObject?.y ?? 0,
      width: selectedObject?.width ?? 1,
      height: selectedObject?.height ?? 1,
      rotation: selectedObject?.rotation ?? 0,
      layer: selectedObject?.layer ?? selectedStroke?.layer ?? 0,
      strokeSize: selectedStroke?.size ?? 3.5,
    });
  }, [selectedId, selectedObject, selectedStroke, setDebugControls]);

  return null;
}
