import { Leva } from "leva";
import type { Stroke, WebGLObject } from "../../../types/editor";
import { SelectionDebugControls } from "./SelectionDebugControls";

type EditorDebugPanelProperties = {
  selectedObject: WebGLObject | undefined;
  selectedStroke: Stroke | undefined;
  onUpdateObject: (
    id: string,
    patch: Partial<
      Pick<WebGLObject, "x" | "y" | "width" | "height" | "rotation" | "layer">
    >,
  ) => void;
  onUpdateStroke: (
    id: string,
    patch: Partial<Pick<Stroke, "layer" | "size">>,
  ) => void;
};

export function EditorDebugPanel({
  selectedObject,
  selectedStroke,
  onUpdateObject,
  onUpdateStroke,
}: EditorDebugPanelProperties) {
  return (
    <>
      <SelectionDebugControls
        selectedObject={selectedObject}
        selectedStroke={selectedStroke}
        onUpdateObject={onUpdateObject}
        onUpdateStroke={onUpdateStroke}
      />
      {/* <Leva
        collapsed={false}
        hidden={false}
        titleBar={{
          drag: true,
          filter: true,
          position: { x: 0, y: 120 },
        }}
      /> */}
    </>
  );
}
