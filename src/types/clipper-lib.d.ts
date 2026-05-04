declare module "clipper-lib" {
  export type IntPoint = { X: number; Y: number };
  export type Path = IntPoint[];
  export type Paths = Path[];

  export const JoinType: {
    jtSquare: number;
    jtRound: number;
    jtMiter: number;
  };

  export const EndType: {
    etOpenSquare: number;
    etOpenRound: number;
    etOpenButt: number;
    etClosedLine: number;
    etClosedPolygon: number;
  };

  export class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPath(path: Path, joinType: number, endType: number): void;
    Execute(solution: Paths, delta: number): void;
  }

  export const Clipper: {
    CleanPolygons(paths: Paths, distance?: number): Paths;
    Orientation(path: Path): boolean;
    PointInPolygon(point: IntPoint, path: Path): number;
  };
}
