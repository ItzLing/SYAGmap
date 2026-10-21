import type { EdgeAttrs, Graph, GraphMeta, LngLat, PEdge, PNode } from '../types';
import { distM, polyLenM } from '../geo';

/** Shape of public/data/townships/<id>.json, produced by scripts/fetch-osm.mjs */
interface RawEdge {
  k: string; a: number; b: number; g: LngLat[]; len: number; kind: PEdge['kind']; hw: string;
  name: string | null; surface: PEdge['surface']; slope: number; steps: boolean; ramp: boolean;
  tactile: boolean; narrow: boolean; exposed: boolean; covered: boolean;
}
export interface RawGraph {
  township: string; fetchedAt: string; source: string; stats: Record<string, number>;
  nodes: LngLat[]; edges: RawEdge[];
}

/**
 * Admin edits are stored in the JSON database and re-applied on top of the OSM
 * download every time the graph loads, so a re-download never loses them.
 */
export type GraphEdit =
  | { id: string; township: string; kind: 'add'; coords: LngLat[]; attrs: Partial<EdgeAttrs>; name?: string; createdAt: number }
  | { id: string; township: string; kind: 'remove'; key: string; createdAt: number }
  | { id: string; township: string; kind: 'attr'; key: string; attrs: Partial<EdgeAttrs>; createdAt: number };

export const DEFAULT_ATTRS: EdgeAttrs = {
  kind: 'footpath', surface: 'good', slopePct: 0, steps: false, kerbRamp: true, tactile: false, narrow: false,
};

/** An admin-drawn vertex within this distance of an existing junction joins it. */
const MERGE_M = 20;

export async function fetchRawGraph(township: string): Promise<RawGraph> {
  const r = await fetch(`${import.meta.env.BASE_URL}data/townships/${township}.json`);
  if (!r.ok) throw new Error(`No street data for "${township}". Run: npm run fetch-osm ${township}`);
  return r.json();
}

export function buildGraph(raw: RawGraph, edits: GraphEdit[]): Graph {
  const nodes: PNode[] = raw.nodes.map((pos, id) => ({ id, pos }));
  const removed = new Set<string>();
  const attrOverrides = new Map<string, Partial<EdgeAttrs>>();
  for (const e of edits) {
    if (e.kind === 'remove') removed.add(e.key);
    else if (e.kind === 'attr') attrOverrides.set(e.key, { ...attrOverrides.get(e.key), ...e.attrs });
  }

  const edges: PEdge[] = [];
  for (const r of raw.edges) {
    if (removed.has(r.k)) continue;
    const base: EdgeAttrs = {
      kind: r.kind, surface: r.surface, slopePct: r.slope, steps: r.steps, kerbRamp: r.ramp, tactile: r.tactile, narrow: r.narrow,
    };
    edges.push({
      ...base, ...attrOverrides.get(r.k),
      id: edges.length, key: r.k, a: r.a, b: r.b, geom: r.g, lengthM: r.len, hw: r.hw, name: r.name,
      exposed: r.exposed, covered: r.covered, custom: false,
    });
  }

  const snapNode = (p: LngLat): number => {
    let best = -1, bd = MERGE_M;
    for (const n of nodes) {
      const d = distM(p, n.pos);
      if (d < bd) { bd = d; best = n.id; }
    }
    if (best >= 0) return best;
    nodes.push({ id: nodes.length, pos: p });
    return nodes.length - 1;
  };

  for (const e of edits) {
    if (e.kind !== 'add') continue;
    const ids = e.coords.map(snapNode);
    for (let i = 1; i < ids.length; i++) {
      if (ids[i - 1] === ids[i]) continue;
      const geom: LngLat[] = [nodes[ids[i - 1]].pos, nodes[ids[i]].pos];
      const attrs: EdgeAttrs = { ...DEFAULT_ATTRS, ...e.attrs };
      edges.push({
        ...attrs, id: edges.length, key: `admin-${e.id}-${i}`, a: ids[i - 1], b: ids[i], geom,
        lengthM: polyLenM(geom), hw: 'footway', name: e.name ?? 'Admin path', exposed: false, covered: false, custom: true,
      });
    }
  }

  const adj: number[][] = nodes.map(() => []);
  for (const e of edges) {
    adj[e.a].push(e.id);
    if (e.b !== e.a) adj[e.b].push(e.id);
  }
  const meta: GraphMeta = { township: raw.township, fetchedAt: raw.fetchedAt, source: raw.source, stats: raw.stats };
  return { nodes, edges, adj, meta };
}
