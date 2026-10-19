import type { LngLat } from './types';

/**
 * Township configuration. Change this object (or add more entries) to point
 * SYAGmap at any SDP township. Nothing else in the app is area-specific.
 */
export interface TownshipConfig {
  id: string;
  name: string;
  center: LngLat;
  /** Half-width of the simulated pedestrian network, in metres. */
  radiusM: number;
  zoom: number;
  seed: number;
}

export const TOWNSHIPS: TownshipConfig[] = [
  // Demo reference area only. Coordinates are approximate (UNVERIFIED) - fine for a simulation.
  { id: 'elmina', name: 'Elmina (demo area)', center: [101.5115, 3.2125], radiusM: 450, zoom: 15.6, seed: 7 },
  { id: 'bukit-jelutong', name: 'Bukit Jelutong (demo area)', center: [101.5370, 3.0900], radiusM: 450, zoom: 15.6, seed: 11 },
  { id: 'putra-heights', name: 'Putra Heights (demo area)', center: [101.5750, 2.9990], radiusM: 450, zoom: 15.6, seed: 23 },
];

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Help requests expire after this many hours. */
export const HELP_TTL_HOURS = 12;
/** Half-life (days) for the influence of a user report. */
export const REPORT_HALF_LIFE_DAYS = 7;
/** Relative influence of each report source on route cost. */
export const SOURCE_WEIGHT = { user: 1.0, vision: 0.4 } as const;
