export type Tool = 'answer' | 'pen' | 'select' | 'erase' | 'pan';
export type ObjectKind = 'text' | 'image';

export type Point2D = {
  x: number;
  y: number;
};

export type Stroke = {
  id: string;
  kind: 'stroke';
  points: Point2D[];
  color: string;
  size: number;
  layer: number;
};

export type SceneHit = {
  type: 'stroke' | 'object';
  id: string;
  layer: number;
  point: Point2D;
};

export type WebGLObject = {
  id: string;
  kind: ObjectKind;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
  text?: string;
  imageSrc?: string;
  imageBackground?: string;
  imageName?: string;
};

export type SelectionItem =
  | {
      type: 'stroke';
      id: string;
    }
  | {
      type: 'object';
      id: string;
    };

export type Selection = SelectionItem | null;

export type DragState =
  | {
      type: 'stroke';
      id: string;
      last: Point2D;
    }
  | {
      type: 'object';
      id: string;
      offset: Point2D;
    }
  | {
      type: 'group';
      items: SelectionItem[];
      last: Point2D;
    }
  | null;

export type ResizeHandle = 'nw' | 'ne' | 'se' | 'sw';

export type PointBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
  width: number;
  height: number;
};

export type ResizeState =
  | {
      type: 'object';
      id: string;
      handle: ResizeHandle;
      origin: {
        pointer: Point2D;
        x: number;
        y: number;
        width: number;
        height: number;
      };
    }
  | {
      type: 'stroke';
      id: string;
      handle: ResizeHandle;
      origin: {
        pointer: Point2D;
        points: Point2D[];
        bounds: PointBounds;
      };
    }
  | {
      type: 'group';
      handle: ResizeHandle;
      origin: {
        pointer: Point2D;
        bounds: PointBounds;
        items: SelectionItem[];
        objects: Array<Pick<WebGLObject, 'id' | 'x' | 'y' | 'width' | 'height'>>;
        strokes: Array<Pick<Stroke, 'id' | 'points'>>;
      };
    }
  | null;

export type GroupResizeOrigin = Extract<ResizeState, { type: 'group' }>['origin'];

export type EditingText = {
  id: string;
  value: string;
} | null;

export type ZoomCommand = {
  id: number;
  factor: number;
};

export type MarqueeState = {
  start: Point2D;
  current: Point2D;
} | null;
