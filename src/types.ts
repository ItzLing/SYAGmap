export type LngLat = [number, number];

export type EdgeKind = 'footpath' | 'crossing' | 'skybridge';
export type Surface = 'good' | 'rough' | 'broken';

export interface PNode {
  id: number;
  pos: LngLat;
}

/** Attributes an admin can set or override on a segment. */
export interface EdgeAttrs {
  kind: EdgeKind;
  surface: Surface;
  slopePct: number;
  steps: boolean;
  kerbRamp: boolean;
  tactile: boolean;
  narrow: boolean;
}

export interface PEdge extends EdgeAttrs {
  id: number;
  /** stable key: OSM way id + part, or "admin-<doc>-<i>" for admin-drawn paths */
  key: string;
  a: number;
  b: number;
  /** real street geometry, ordered a -> b */
  geom: LngLat[];
  lengthM: number;
  hw: string;
  name: string | null;
  /** road with no sidewalk tagged in OSM: pedestrians share the carriageway */
  exposed: boolean;
  covered: boolean;
  custom: boolean;
}

export interface GraphMeta {
  township: string;
  fetchedAt: string;
  source: string;
  stats: Record<string, number>;
}

export interface Graph {
  nodes: PNode[];
  edges: PEdge[];
  /** adj[nodeId] = edge ids touching that node */
  adj: number[][];
  meta: GraphMeta;
}

/** A point snapped onto the nearest street segment. */
export interface Snap {
  edgeId: number;
  alongM: number;
  pos: LngLat;
  distM: number;
}

export type ReportType = 'blocked' | 'broken_pavement' | 'open_drain' | 'pole' | 'no_ramp' | 'other';

export interface Report {
  id: string;
  pos: LngLat;
  type: ReportType;
  note: string;
  createdAt: number;
  source: 'user' | 'vision';
  simulated?: boolean;
}

export type ProfileId = 'walking' | 'wheelchair' | 'elderly' | 'stroller' | 'visual';

export interface Place {
  pos: LngLat;
  name: string;
}
