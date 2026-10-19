export type LngLat = [number, number];

export type EdgeKind = 'footpath' | 'crossing' | 'skybridge';
export type Surface = 'good' | 'rough' | 'broken';

export interface PNode {
  id: number;
  pos: LngLat;
}

export interface PEdge {
  id: number;
  a: number;
  b: number;
  kind: EdgeKind;
  lengthM: number;
  slopePct: number;
  surface: Surface;
  steps: boolean;
  kerbRamp: boolean;
  tactile: boolean;
  narrow: boolean;
}

export interface Graph {
  nodes: PNode[];
  edges: PEdge[];
  /** adj[nodeId] = edge ids touching that node */
  adj: number[][];
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
