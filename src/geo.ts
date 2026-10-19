import type { LngLat } from './types';

const M_PER_DEG_LAT = 111_320;

export function mPerDegLng(lat: number): number {
  return M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

/** Approximate distance in metres (equirectangular; fine at township scale). */
export function distM(a: LngLat, b: LngLat): number {
  const lat = (a[1] + b[1]) / 2;
  const dx = (a[0] - b[0]) * mPerDegLng(lat);
  const dy = (a[1] - b[1]) * M_PER_DEG_LAT;
  return Math.hypot(dx, dy);
}

/** Distance in metres from point p to segment a-b. */
export function distToSegmentM(p: LngLat, a: LngLat, b: LngLat): number {
  const k = mPerDegLng(p[1]);
  const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * M_PER_DEG_LAT;
  const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * M_PER_DEG_LAT;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function offsetM(origin: LngLat, eastM: number, northM: number): LngLat {
  return [origin[0] + eastM / mPerDegLng(origin[1]), origin[1] + northM / M_PER_DEG_LAT];
}
