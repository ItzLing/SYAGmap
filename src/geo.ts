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

export function polyLenM(g: LngLat[]): number {
  let s = 0;
  for (let i = 1; i < g.length; i++) s += distM(g[i - 1], g[i]);
  return s;
}

export interface Projection {
  distM: number;
  alongM: number;
  pos: LngLat;
}

/** Closest point on a polyline to p. */
export function projectOnPoly(p: LngLat, g: LngLat[]): Projection {
  const k = mPerDegLng(p[1]);
  let best: Projection = { distM: Infinity, alongM: 0, pos: g[0] };
  let acc = 0;
  for (let i = 1; i < g.length; i++) {
    const a = g[i - 1], b = g[i];
    const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * M_PER_DEG_LAT;
    const bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * M_PER_DEG_LAT;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    const segLen = Math.sqrt(len2);
    if (d < best.distM) {
      best = { distM: d, alongM: acc + t * segLen, pos: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] };
    }
    acc += segLen;
  }
  return best;
}

export function pointAlong(g: LngLat[], m: number): LngLat {
  let acc = 0;
  for (let i = 1; i < g.length; i++) {
    const seg = distM(g[i - 1], g[i]);
    if (acc + seg >= m && seg > 0) {
      const t = (m - acc) / seg;
      return [g[i - 1][0] + (g[i][0] - g[i - 1][0]) * t, g[i - 1][1] + (g[i][1] - g[i - 1][1]) * t];
    }
    acc += seg;
  }
  return g[g.length - 1];
}

/** Coordinates of the polyline between two distances along it (fromM may exceed toM: reversed). */
export function sliceAlong(g: LngLat[], fromM: number, toM: number): LngLat[] {
  const lo = Math.min(fromM, toM), hi = Math.max(fromM, toM);
  const out: LngLat[] = [pointAlong(g, lo)];
  let acc = 0;
  for (let i = 1; i < g.length; i++) {
    acc += distM(g[i - 1], g[i]);
    if (acc > lo && acc < hi) out.push(g[i]);
  }
  out.push(pointAlong(g, hi));
  return fromM <= toM ? out : out.reverse();
}

export function offsetM(origin: LngLat, eastM: number, northM: number): LngLat {
  return [origin[0] + eastM / mPerDegLng(origin[1]), origin[1] + northM / M_PER_DEG_LAT];
}
