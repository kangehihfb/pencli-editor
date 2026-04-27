import type { PointBounds } from '../types/editor';

export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 760;

export const PAGE_BOUNDS: PointBounds = {
  minX: 0,
  maxX: PAGE_WIDTH,
  minY: 0,
  maxY: PAGE_HEIGHT,
  centerX: PAGE_WIDTH / 2,
  centerY: PAGE_HEIGHT / 2,
  width: PAGE_WIDTH,
  height: PAGE_HEIGHT,
};
