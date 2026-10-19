import type { Graph, PEdge, PNode, EdgeKind } from '../types';
import type { TownshipConfig } from '../config';
import { distM, offsetM } from '../geo';

/** Small deterministic PRNG so every run of a township looks the same. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * SIMULATED pedestrian network. A jittered grid with a "main road" band across
 * the middle that can only be crossed at a few places. Attributes (slope,
 * steps, surface, ramps, tactile paving) are random, NOT surveyed.
 *
 * Replace this module with a real loader (OSM / Overpass) that returns the same
 * Graph shape and nothing else in the app has to change.
 */
export function generateGraph(cfg: TownshipConfig): Graph {
  const rnd = mulberry32(cfg.seed);
  const spacing = 70;
  const cols = Math.max(4, Math.floor((cfg.radiusM * 2) / spacing));
  const rows = cols;
  const roadAfterRow = Math.floor(rows / 2) - 1;
  const crossingCols = new Set([1, cols - 2]);
  const skyCols = new Set([Math.floor(cols / 2)]);

  const nodes: PNode[] = [];
  const idx = (c: number, r: number) => r * cols + c;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const gap = r > roadAfterRow ? 40 : 0; // widen the road band
      const east = (c - (cols - 1) / 2) * spacing + (rnd() - 0.5) * 16;
      const north = ((rows - 1) / 2 - r) * spacing - gap + 20 + (rnd() - 0.5) * 16;
      nodes.push({ id: idx(c, r), pos: offsetM(cfg.center, east, north) });
    }
  }

  const edges: PEdge[] = [];
  const adj: number[][] = nodes.map(() => []);

  const add = (a: number, b: number, kind: EdgeKind) => {
    const e: PEdge = {
      id: edges.length,
      a,
      b,
      kind,
      lengthM: distM(nodes[a].pos, nodes[b].pos) * (kind === 'skybridge' ? 1.35 : 1),
      slopePct: rnd() < 0.15 ? 5 + rnd() * 6 : rnd() * 3.5,
      surface: rnd() < 0.08 ? 'broken' : rnd() < 0.22 ? 'rough' : 'good',
      steps: kind === 'footpath' && rnd() < 0.05,
      kerbRamp: kind === 'crossing' ? rnd() < 0.7 : true,
      tactile: kind === 'crossing' ? rnd() < 0.5 : rnd() < 0.3,
      narrow: kind === 'footpath' && rnd() < 0.1,
    };
    if (kind === 'skybridge') {
      e.slopePct = 2;
      e.surface = 'good';
      e.steps = false;
      e.kerbRamp = true;
      e.tactile = true;
      e.narrow = false;
    }
    edges.push(e);
    adj[a].push(e.id);
    adj[b].push(e.id);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols) add(idx(c, r), idx(c + 1, r), 'footpath');
      if (r + 1 < rows) {
        if (r === roadAfterRow) {
          if (skyCols.has(c)) add(idx(c, r), idx(c, r + 1), 'skybridge');
          else if (crossingCols.has(c)) add(idx(c, r), idx(c, r + 1), 'crossing');
          // otherwise: no connection, the road is a barrier here
        } else {
          add(idx(c, r), idx(c, r + 1), 'footpath');
        }
      }
    }
  }
  return { nodes, edges, adj };
}
