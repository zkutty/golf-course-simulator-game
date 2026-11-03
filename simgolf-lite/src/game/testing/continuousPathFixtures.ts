import type { Course, Point, Terrain } from '../models/types';
import { corridorFeature, rasterizeSurfaceFeatureDetailed } from '../models/surfaceIntent';

export type ContinuousPathFixture = Pick<Course, 'width' | 'height' | 'tiles' | 'surfaceIntent'>;
export type ContinuousPathFixtureKind = 'empty' | 'straight' | 'diagonal' | 'bend' | 'T' | 'cross' | 'loop' | 'isolated' | 'broad' | 'corner';

/** Small frozen-coordinate fixtures shared by pure, renderer and route checks. */
export function continuousPathFixture(kind: ContinuousPathFixtureKind): ContinuousPathFixture {
  const width = 16; const height = 16; const tiles = Array<Terrain>(width * height).fill('rough');
  const paint = (x: number, y: number) => { tiles[y * width + x] = 'path'; };
  if (kind === 'straight') for (let x = 2; x <= 10; x++) paint(x, 4);
  if (kind === 'diagonal') for (const [x, y] of [[2, 2], [3, 2], [3, 3], [4, 3], [4, 4], [5, 4], [5, 5], [6, 5], [6, 6]]) paint(x, y);
  if (kind === 'bend') { for (let x = 2; x <= 8; x++) paint(x, 3); for (let y = 4; y <= 10; y++) paint(8, y); }
  if (kind === 'T' || kind === 'cross') { for (let x = 3; x <= 11; x++) paint(x, 7); for (let y = 3; y <= (kind === 'T' ? 6 : 11); y++) paint(7, y); }
  if (kind === 'loop') { for (let x = 3; x <= 11; x++) { paint(x, 3); paint(x, 11); } for (let y = 4; y <= 10; y++) { paint(3, y); paint(11, y); } }
  if (kind === 'isolated') paint(4, 4);
  if (kind === 'broad') for (let y = 5; y <= 7; y++) for (let x = 4; x <= 12; x++) paint(x, y);
  if (kind === 'corner') { paint(3, 3); paint(4, 4); }
  return { width, height, tiles };
}

export function authoredPathFixture(knots: readonly Point[] = [{ x: 2.5, y: 3.5 }, { x: 6.5, y: 2.5 }, { x: 9.5, y: 6.5 }, { x: 13.5, y: 5.5 }], envelopeWidth = 1.5): ContinuousPathFixture {
  const course = continuousPathFixture('empty'); const feature = corridorFeature(course, 'path', knots, envelopeWidth);
  const raster = rasterizeSurfaceFeatureDetailed(feature, course.width, course.height);
  feature.coverage = raster.tiles.map((point) => point.y * course.width + point.x); feature.renderRings = raster.rings;
  for (const cell of feature.coverage) course.tiles[cell] = 'path';
  course.surfaceIntent = { version: 1, nextId: 2, features: [feature] }; return course;
}
