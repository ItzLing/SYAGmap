import type { EdgeAttrs, Graph, LngLat, Place, ProfileId, ReportType, Snap } from './types';
import { TOWNSHIPS, type TownshipConfig } from './config';
import type { RawGraph, GraphEdit } from './data/graphLoader';
import type { RouteResult, BatchResult } from './routing/engine';
import type { Ranking } from './routing/priorities';
import type { ReportStore, ObservationStore, CarpoolStore, FirstAidStore, Slot } from './store/stores';

export type Tab = 'route' | 'report' | 'heat' | 'carpool' | 'aid' | 'priority' | 'admin';

/** What the next map click means. */
export type PickKind =
  | 'start' | 'end' | 'report' | 'help' | 'carpoolStart' | 'carpoolEnd' | 'obs' | 'adminDraw' | 'adminSeg';

export interface Pending {
  kind: PickKind;
  pos: LngLat;
}

export const DEFAULT_ADMIN_ATTRS: EdgeAttrs & { name: string } = {
  kind: 'footpath', surface: 'good', slopePct: 0, steps: false, kerbRamp: true, tactile: false, narrow: false, name: '',
};

export const S = {
  cfg: TOWNSHIPS[0] as TownshipConfig,
  raw: null as RawGraph | null,
  graph: null as unknown as Graph,
  edits: [] as GraphEdit[],
  loadError: '',
  loading: true,

  reports: null as unknown as ReportStore,
  obs: null as unknown as ObservationStore,
  carpool: null as unknown as CarpoolStore,
  aid: null as unknown as FirstAidStore,

  tab: 'route' as Tab,
  profile: 'wheelchair' as ProfileId,
  start: null as Snap | null,
  end: null as Snap | null,
  pick: null as PickKind | null,
  pending: null as Pending | null,
  result: null as RouteResult | null,
  batch: null as BatchResult | null,

  reportType: 'blocked' as ReportType,
  reportNote: '',
  helpNote: '',

  /** simulated current location of the user (draggable on the map) */
  me: null as unknown as LngLat,

  heatSlot: 'all' as Slot | 'all',
  heatIncludeSim: true,
  obsDraft: { pos: null as Place | null, slot: 'morning' as Slot, count: 20 },

  cpDraft: { start: null as Place | null, end: null as Place | null, seats: 3 },
  selCarpool: null as string | null,
  selHelp: null as string | null,

  ranking: null as Ranking | null,
  ranking_loading: false,
  /** reports or counts changed since the AI ranking was produced */
  rankingStale: false,

  admin: {
    drawPts: [] as LngLat[],
    attrs: { ...DEFAULT_ADMIN_ATTRS },
    selectedEdge: null as number | null,
    segAttrs: { ...DEFAULT_ADMIN_ATTRS },
  },
  toast: '',
};
