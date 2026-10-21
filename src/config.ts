import type { LngLat } from './types';
import townshipList from './townships.json';

/**
 * Township configuration. Add an entry to src/townships.json, then run
 * `npm run fetch-osm <id>` to download its real street network. Nothing else in
 * the app is area-specific.
 */
export interface TownshipConfig {
  id: string;
  name: string;
  center: LngLat;
  /** Half-width of the downloaded street network, in metres. */
  radiusM: number;
  zoom: number;
}

export const TOWNSHIPS = townshipList as TownshipConfig[];

export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Help requests expire after this many hours. */
export const HELP_TTL_HOURS = 12;
/** Half-life (days) for the influence of a user report. */
export const REPORT_HALF_LIFE_DAYS = 7;
/** Relative influence of each report source on route cost. */
export const SOURCE_WEIGHT = { user: 1.0, vision: 0.4 } as const;
