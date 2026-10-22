import type { LngLat, Report } from '../types';
import { distM } from '../geo';

export const REPORT_HEAT_DAYS = 30;
export const REPORT_INSPECT_M = 50;

/** Equal-weight submissions in a rolling window; independent of routing decay. */
export function recentHeatReports(reports: Report[], includeSim: boolean, now = Date.now()): Report[] {
  const cutoff = now - REPORT_HEAT_DAYS * 86_400_000;
  return reports.filter((r) => r.createdAt >= cutoff && r.createdAt <= now && (includeSim || !r.simulated));
}

/** One point per report: overlapping points add heat without normalising against other hotspots. */
export function reportHeatData(reports: Report[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: reports.map((r) => ({
      type: 'Feature', properties: { weight: 1 }, geometry: { type: 'Point', coordinates: r.pos },
    })),
  };
}

export function reportsNear(reports: Report[], pos: LngLat): Report[] {
  return reports.filter((r) => distM(r.pos, pos) <= REPORT_INSPECT_M);
}
