import type { Graph, LngLat, PEdge, ProfileId, Report, ReportType, Snap } from '../types';
import { REPORT_HALF_LIFE_DAYS, SOURCE_WEIGHT } from '../config';
import { distM, pointAlong, projectOnPoly, sliceAlong } from '../geo';
import { dijkstraMulti, type PathResult } from './dijkstra';
import { PROFILES, type Profile } from './profiles';
import { mulberry32 } from '../data/rng';

export const REPORT_LABEL: Record<ReportType, string> = {
  blocked: 'Vehicle / object blocking path',
  broken_pavement: 'Broken pavement',
  open_drain: 'Open drain',
  pole: 'Pole in walkway',
  no_ramp: 'Missing kerb ramp',
  other: 'Other',
};

export const SEVERITY: Record<ReportType, number> = {
  blocked: 3, broken_pavement: 1.5, open_drain: 2, pole: 1.2, no_ramp: 1.5, other: 0.5,
};

/** Report types that make a segment impassable for a profile (strict mode). */
const HARD_BLOCK: Record<ProfileId, ReportType[]> = {
  walking: [],
  wheelchair: ['blocked', 'no_ramp', 'open_drain', 'pole'],
  stroller: ['blocked', 'open_drain'],
  elderly: ['blocked'],
  visual: ['blocked', 'open_drain', 'pole'],
};

const SNAP_REPORT_M = 40;

export interface EdgeReports {
  /** summed influence (decayed, source-weighted, severity-weighted) */
  weight: number;
  items: { type: ReportType; w: number }[];
}

/** Influence of one report right now: source weight x time decay. */
export function reportInfluence(r: Report, now: number): number {
  const ageDays = Math.max(0, (now - r.createdAt) / 86_400_000);
  return SOURCE_WEIGHT[r.source] * Math.pow(0.5, ageDays / REPORT_HALF_LIFE_DAYS);
}

/** Closest point on the street network. Returns null for an empty graph. */
export function snapToGraph(g: Graph, p: LngLat): Snap | null {
  let best: Snap | null = null;
  for (const e of g.edges) {
    const pr = projectOnPoly(p, e.geom);
    if (!best || pr.distM < best.distM) best = { edgeId: e.id, alongM: pr.alongM, pos: pr.pos, distM: pr.distM };
  }
  return best;
}

export function indexReports(g: Graph, reports: Report[], now: number): Map<number, EdgeReports> {
  const m = new Map<number, EdgeReports>();
  for (const r of reports) {
    const w = reportInfluence(r, now);
    if (w < 0.05) continue; // decayed away
    const s = snapToGraph(g, r.pos);
    if (!s || s.distM > SNAP_REPORT_M) continue;
    const cur = m.get(s.edgeId) ?? { weight: 0, items: [] };
    cur.weight += w * SEVERITY[r.type];
    cur.items.push({ type: r.type, w });
    m.set(s.edgeId, cur);
  }
  return m;
}

/** Human-readable barriers on a segment for a given profile. */
export function edgeBarriers(e: PEdge, p: Profile, rep?: EdgeReports): string[] {
  const out: string[] = [];
  if (e.steps) out.push('Steps');
  if (e.slopePct > p.maxSlopePct) out.push(`Steep slope (${e.slopePct.toFixed(0)}%)`);
  if (e.kind === 'crossing' && !e.kerbRamp && p.blockMissingRamp) out.push('No kerb ramp');
  if (e.surface === 'broken') out.push('Broken surface');
  if (rep) for (const it of rep.items) if (it.w >= 0.3) out.push(`Reported: ${REPORT_LABEL[it.type]}`);
  return out;
}

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
  if (e.exposed) mul += p.exposedPenalty;
  if (rep) mul += rep.weight * p.reportW;
  return Math.max(e.lengthM, 0.5) * Math.max(0.5, mul);
}

export interface RouteEval {
  /** exact street geometry, start to end */
  coords: LngLat[];
  /** every segment touched, including the partial first and last ones */
  edgeIds: number[];
  lengthM: number;
  barrierEdges: { edgeId: number; labels: string[]; at: LngLat }[];
  /** share of route length on roads with no mapped footpath (0..1) */
  exposedShare: number;
  /** names of streets used, in order, without repeats */
  streets: string[];
  /** true if no strictly barrier-free route existed and a relaxed search was used */
  relaxed: boolean;
}

type CostFn = (edgeId: number) => number;

/** Route between two snapped points along real street geometry. */
function route(g: Graph, from: Snap, to: Snap, cost: CostFn): { coords: LngLat[]; edgeIds: number[]; lengthM: number } | null {
  const e1 = g.edges[from.edgeId], e2 = g.edges[to.edgeId];
  const L1 = e1.lengthM || 1, L2 = e2.lengthM || 1;

  const sources = [
    { node: e1.a, cost: cost(e1.id) * (from.alongM / L1) },
    { node: e1.b, cost: cost(e1.id) * (1 - from.alongM / L1) },
  ];
  const targets = [
    { node: e2.a, cost: cost(e2.id) * (to.alongM / L2) },
    { node: e2.b, cost: cost(e2.id) * (1 - to.alongM / L2) },
  ];
  const res: PathResult | null = dijkstraMulti(g, sources, targets, cost);

  // Walking directly along one segment is always an option.
  if (from.edgeId === to.edgeId) {
    const direct = cost(e1.id) * (Math.abs(to.alongM - from.alongM) / L1);
    if (Number.isFinite(direct) && (!res || direct <= res.cost)) {
      return {
        coords: sliceAlong(e1.geom, from.alongM, to.alongM),
        edgeIds: [e1.id],
        lengthM: Math.abs(to.alongM - from.alongM),
      };
    }
  }
  if (!res) return null;

  const coords: LngLat[] = [];
  const edgeIds: number[] = [];
  let lengthM = 0;
  const startAtA = res.sourceIdx === 0;
  const startPart = startAtA ? sliceAlong(e1.geom, from.alongM, 0) : sliceAlong(e1.geom, from.alongM, L1);
  coords.push(...startPart);
  lengthM += startAtA ? from.alongM : L1 - from.alongM;
  edgeIds.push(e1.id);

  for (let i = 0; i < res.edgeIds.length; i++) {
    const e = g.edges[res.edgeIds[i]];
    const u = res.nodeIds[i];
    const geom = e.a === u ? e.geom : [...e.geom].reverse();
    coords.push(...geom.slice(1));
    lengthM += e.lengthM;
    edgeIds.push(e.id);
  }

  const endAtA = res.targetIdx === 0;
  const endPart = endAtA ? sliceAlong(e2.geom, 0, to.alongM) : sliceAlong(e2.geom, L2, to.alongM);
  coords.push(...endPart.slice(1));
  lengthM += endAtA ? to.alongM : L2 - to.alongM;
  if (edgeIds[edgeIds.length - 1] !== e2.id) edgeIds.push(e2.id);
  return { coords, edgeIds, lengthM };
}

function evaluate(
  g: Graph,
  r: { coords: LngLat[]; edgeIds: number[]; lengthM: number },
  p: Profile,
  idx: Map<number, EdgeReports>,
  relaxed: boolean,
): RouteEval {
  const barrierEdges: RouteEval['barrierEdges'] = [];
  const streets: string[] = [];
  let exposedLen = 0, totalLen = 0;
  for (const id of r.edgeIds) {
    const e = g.edges[id];
    totalLen += e.lengthM;
    if (e.exposed) exposedLen += e.lengthM;
    if (e.name && streets[streets.length - 1] !== e.name) streets.push(e.name);
    const labels = edgeBarriers(e, p, idx.get(id));
    if (labels.length) barrierEdges.push({ edgeId: id, labels, at: pointAlong(e.geom, e.lengthM / 2) });
  }
  return {
    coords: r.coords, edgeIds: r.edgeIds, lengthM: r.lengthM, barrierEdges,
    exposedShare: totalLen ? exposedLen / totalLen : 0, streets, relaxed,
  };
}

export interface RouteResult {
  shortest: RouteEval | null;
  syag: RouteEval | null;
}

/**
 * `shortest` ignores everything but length (what a generic map would do).
 * `syag` uses the profile cost model, user reports included.
 */
export function computeRoutes(
  g: Graph, profileId: ProfileId, from: Snap, to: Snap, idx: Map<number, EdgeReports>,
): RouteResult {
  const p = PROFILES[profileId];
  const shortRoute = route(g, from, to, (id) => g.edges[id].lengthM || 0.5);
  let relaxed = false;
  let syagRoute = route(g, from, to, (id) => edgeCost(g.edges[id], p, idx.get(id), true));
  if (!syagRoute) {
    syagRoute = route(g, from, to, (id) => edgeCost(g.edges[id], p, idx.get(id), false));
    relaxed = true;
  }
  return {
    shortest: shortRoute ? evaluate(g, shortRoute, p, idx, false) : null,
    syag: syagRoute ? evaluate(g, syagRoute, p, idx, relaxed) : null,
  };
}

export interface BatchResult {
  trips: number;
  shortestBarrierFree: number;
  syagBarrierFree: number;
  noAccessibleRoute: number;
}

/**
 * Prototype "Test" metric on SIMULATED trips: share of random trips completed
 * with zero known barriers, shortest-path vs SYAGmap routing.
 */
export function runBatch(g: Graph, profileId: ProfileId, reports: Report[], trips = 200): BatchResult {
  const rnd = mulberry32(99);
  const idx = indexReports(g, reports, Date.now());
  const res: BatchResult = { trips: 0, shortestBarrierFree: 0, syagBarrierFree: 0, noAccessibleRoute: 0 };
  const randomSnap = (): Snap => {
    const e = g.edges[Math.floor(rnd() * g.edges.length)];
    const along = rnd() * e.lengthM;
    return { edgeId: e.id, alongM: along, pos: pointAlong(e.geom, along), distM: 0 };
  };
  let guard = 0;
  while (res.trips < trips && guard++ < trips * 20) {
    const a = randomSnap(), b = randomSnap();
    if (distM(a.pos, b.pos) < 150) continue;
    res.trips++;
    const r = computeRoutes(g, profileId, a, b, idx);
    if (r.shortest && r.shortest.barrierEdges.length === 0) res.shortestBarrierFree++;
    if (r.syag && !r.syag.relaxed && r.syag.barrierEdges.length === 0) res.syagBarrierFree++;
    else res.noAccessibleRoute++;
  }
  return res;
}
