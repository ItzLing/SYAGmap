import type { Graph } from '../types';

class MinHeap {
  private k: number[] = [];
  private v: number[] = [];

  get size() {
    return this.k.length;
  }

  push(key: number, val: number) {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      this.swap(i, p);
      i = p;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.k[0], this.v[0]];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}

export interface Terminal {
  node: number;
  /** cost already spent to reach this node from the snapped point (or vice versa) */
  cost: number;
}

export interface PathResult {
  sourceIdx: number;
  targetIdx: number;
  nodeIds: number[];
  edgeIds: number[];
  cost: number;
}

/**
 * Multi-source / multi-target Dijkstra. A snapped start point sits in the middle
 * of a street segment, so it can leave through either end (two sources); the same
 * goes for the destination (two targets). `edgeCost` must return a POSITIVE
 * number, or Infinity to forbid the edge, which keeps Dijkstra correct.
 */
export function dijkstraMulti(
  g: Graph,
  sources: Terminal[],
  targets: Terminal[],
  edgeCost: (edgeId: number) => number,
): PathResult | null {
  const n = g.nodes.length;
  const dist = new Array<number>(n).fill(Infinity);
  const prevEdge = new Array<number>(n).fill(-1);
  const prevNode = new Array<number>(n).fill(-1);
  const srcOf = new Array<number>(n).fill(-1);
  const heap = new MinHeap();

  sources.forEach((s, i) => {
    if (Number.isFinite(s.cost) && s.cost < dist[s.node]) {
      dist[s.node] = s.cost;
      srcOf[s.node] = i;
      heap.push(s.cost, s.node);
    }
  });
  const tgtAt = new Map<number, number>();
  targets.forEach((t, i) => {
    if (Number.isFinite(t.cost) && (!tgtAt.has(t.node) || t.cost < targets[tgtAt.get(t.node)!].cost)) tgtAt.set(t.node, i);
  });

  let best = Infinity;
  let bestNode = -1;
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (d >= best) break;
    const ti = tgtAt.get(u);
    if (ti !== undefined && d + targets[ti].cost < best) {
      best = d + targets[ti].cost;
      bestNode = u;
    }
    for (const eid of g.adj[u]) {
      const c = edgeCost(eid);
      if (!Number.isFinite(c)) continue;
      const e = g.edges[eid];
      const v = e.a === u ? e.b : e.a;
      const nd = d + c;
      if (nd < dist[v]) {
        dist[v] = nd;
        prevEdge[v] = eid;
        prevNode[v] = u;
        srcOf[v] = -1;
        heap.push(nd, v);
      }
    }
  }
  if (bestNode < 0) return null;

  const nodeIds = [bestNode];
  const edgeIds: number[] = [];
  let cur = bestNode;
  while (prevNode[cur] !== -1) {
    edgeIds.push(prevEdge[cur]);
    cur = prevNode[cur];
    nodeIds.push(cur);
  }
  nodeIds.reverse();
  edgeIds.reverse();
  // srcOf[cur] is only set while cur has never been relaxed from another node.
  const sourceIdx = srcOf[cur] >= 0 ? srcOf[cur] : sources.findIndex((s) => s.node === cur);
  return { sourceIdx, targetIdx: tgtAt.get(bestNode)!, nodeIds, edgeIds, cost: best };
}
