import type { Graph, PEdge, ProfileId, Report, ReportType } from '../types';
import { REPORT_HALF_LIFE_DAYS, SOURCE_WEIGHT } from '../config';
import { distM, distToSegmentM } from '../geo';
import { dijkstra, type PathResult } from './dijkstra';
import { PROFILES, type Profile } from './profiles';
import { mulberry32 } from '../data/simulate';

export const REPORT_LABEL: Record<ReportType, string> = {
  blocked: 'Vehicle / object blocking path',
  broken_pavement: 'Broken pavement',
  open_drain: 'Open drain',
  pole: 'Pole in walkway',
  no_ramp: 'Missing kerb ramp',
  other: 'Other',
};

const SEVERITY: Record<ReportType, number> = {
  blocked: 3, broken_pavement: 1.5, open_drain: 2, pole: 1.2, no_ramp: 1.5, other: 0.5,
};

/** Report types that make an edge impassable for a profile (strict mode). */
const HARD_BLOCK: Record<ProfileId, ReportType[]> = {
  walking: [],
  wheelchair: ['blocked', 'no_ramp', 'open_drain', 'pole'],
  stroller: ['blocked', 'open_drain'],
  elderly: ['blocked'],
  visual: ['blocked', 'open_drain', 'pole'],
};

const SNAP_M = 40;

export interface EdgeReports {
  /** summed influence (decayed, source-weighted) */
  weight: number;
  items: { type: ReportType; w: number }[];
}

/** Influence of one report right now: source weight x time decay. */
export function reportInfluence(r: Report, now: number): number {
  const ageDays = Math.max(0, (now - r.createdAt) / 86_400_000);
  return SOURCE_WEIGHT[r.source] * Math.pow(0.5, ageDays / REPORT_HALF_LIFE_DAYS);
}

export function nearestNode(g: Graph, p: [number, number]): number {
  let best = 0, bd = Infinity;
  for (const n of g.nodes) {
    const d = distM(p, n.pos);
    if (d < bd) { bd = d; best = n.id; }
  }
  return best;
}

export function nearestEdge(g: Graph, p: [number, number]): { edgeId: number; distM: number } {
  let best = 0, bd = Infinity;
  for (const e of g.edges) {
    const d = distToSegmentM(p, g.nodes[e.a].pos, g.nodes[e.b].pos);
    if (d < bd) { bd = d; best = e.id; }
  }
  return { edgeId: best, distM: bd };
}

export function indexReports(g: Graph, reports: Report[], now: number): Map<number, EdgeReports> {
  const m = new Map<number, EdgeReports>();
  for (const r of reports) {
    const { edgeId, distM: d } = nearestEdge(g, r.pos);
    if (d > SNAP_M) continue;
    const w = reportInfluence(r, now);
    if (w < 0.05) continue; // decayed away
    const cur = m.get(edgeId) ?? { weight: 0, items: [] };
    cur.weight += w * SEVERITY[r.type];
    cur.items.push({ type: r.type, w });
    m.set(edgeId, cur);
  }
  return m;
}

/** Human-readable barriers on an edge for a given profile. */
export function edgeBarriers(e: PEdge, p: Profile, rep?: EdgeReports): string[] {
  const out: string[] = [];
  if (e.steps) out.push('Steps');
  if (e.slopePct > p.maxSlopePct) out.push(`Steep slope (${e.slopePct.toFixed(0)}%)`);
  if (e.kind === 'crossing' && !e.kerbRamp && p.blockMissingRamp) out.push('No kerb ramp');
  if (e.surface === 'broken') out.push('Broken surface');
  if (rep) {
    for (const it of rep.items) if (it.w >= 0.3) out.push(`Reported: ${REPORT_LABEL[it.type]}`);
  }
  return out;
}

/** Hard blocks that strict mode refuses to cross. */
function hardBlocked(e: PEdge, p: Profile, rep?: EdgeReports): boolean {
  if (e.steps && p.blockSteps) return true;
  if (e.slopePct > p.maxSlopePct) return true;
  if (e.kind === 'crossing' && !e.kerbRamp && p.blockMissingRamp) return true;
  if (rep) {
    const hard = HARD_BLOCK[p.id];
    if (rep.items.some((it) => it.w >= 0.5 && hard.includes(it.type))) return true;
  }
  return false;
}

/** Cost is always > 0, or Infinity when strictly blocked. */
export function edgeCost(e: PEdge, p: Profile, rep: EdgeReports | undefined, strict: boolean): number {
  if (hardBlocked(e, p, rep)) return strict ? Infinity : e.lengthM * 50;
  let mul = 1;
  mul += e.slopePct * p.slopeW;
  if (e.steps) mul += p.stepPenalty;
  if (e.surface === 'rough') mul += p.roughPenalty;
  if (e.surface === 'broken') mul += p.brokenPenalty;
  if (e.narrow) mul += p.narrowPenalty;
  if (e.tactile) mul *= p.tactileMul;
  else mul += p.noTactilePenalty;
  if (e.kind === 'skybridge') mul *= p.skybridgeMul;
  if (e.kind === 'crossing') mul += 0.3; // traffic exposure
  if (rep) mul += rep.weight * p.reportW;
  return e.lengthM * Math.max(0.5, mul);
}

export interface RouteEval {
  path: PathResult;
  lengthM: number;
  barrierEdges: { edgeId: number; labels: string[] }[];
  /** true if no strictly barrier-free route existed and a relaxed search was used */
  relaxed: boolean;
}

function evaluate(g: Graph, path: PathResult, p: Profile, idx: Map<number, EdgeReports>, relaxed: boolean): RouteEval {
  let lengthM = 0;
  const barrierEdges: RouteEval['barrierEdges'] = [];
  for (const id of path.edgeIds) {
    const e = g.edges[id];
    lengthM += e.lengthM;
    const labels = edgeBarriers(e, p, idx.get(id));
    if (labels.length) barrierEdges.push({ edgeId: id, labels });
  }
  return { path, lengthM, barrierEdges, relaxed };
}

export interface RouteResult {
  shortest: RouteEval | null;
  syag: RouteEval | null;
}

/**
 * `shortest` ignores everything but length (what a generic map would do).
 * `syag` uses the profile cost model, user reports included.
 */
export function computeRoutes(g: Graph, profileId: ProfileId, from: number, to: number, reports: Report[], now = Date.now()): RouteResult {
  const p = PROFILES[profileId];
  const idx = indexReports(g, reports, now);
  const short = dijkstra(g, from, to, (id) => g.edges[id].lengthM);
  let syag = dijkstra(g, from, to, (id) => edgeCost(g.edges[id], p, idx.get(id), true));
  let relaxed = false;
  if (!syag) {
    syag = dijkstra(g, from, to, (id) => edgeCost(g.edges[id], p, idx.get(id), false));
    relaxed = true;
  }
  return {
    shortest: short ? evaluate(g, short, p, idx, false) : null,
    syag: syag ? evaluate(g, syag, p, idx, relaxed) : null,
  };
}

export interface BatchResult {
  trips: number;
  shortestBarrierFree: number;
  syagBarrierFree: number;
  noAccessibleRoute: number;
}

/**
 * Prototype "Test" metric on SIMULATED data: share of random trips completed
 * with zero barriers, shortest-path vs SYAGmap routing.
 */
export function runBatch(g: Graph, profileId: ProfileId, reports: Report[], trips = 300): BatchResult {
  const rnd = mulberry32(99);
  const res: BatchResult = { trips: 0, shortestBarrierFree: 0, syagBarrierFree: 0, noAccessibleRoute: 0 };
  while (res.trips < trips) {
    const a = Math.floor(rnd() * g.nodes.length);
    const b = Math.floor(rnd() * g.nodes.length);
    if (a === b || distM(g.nodes[a].pos, g.nodes[b].pos) < 150) continue;
    res.trips++;
    const r = computeRoutes(g, profileId, a, b, reports);
    if (r.shortest && r.shortest.barrierEdges.length === 0) res.shortestBarrierFree++;
    if (r.syag && !r.syag.relaxed && r.syag.barrierEdges.length === 0) res.syagBarrierFree++;
    else res.noAccessibleRoute++;
  }
  return res;
}
