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

export interface PathResult {
  nodeIds: number[];
  edgeIds: number[];
  cost: number;
}

/**
 * Dijkstra over the pedestrian graph. `edgeCost` must return a POSITIVE number,
 * or Infinity to forbid the edge. Positive costs keep Dijkstra correct.
 */
export function dijkstra(
  g: Graph,
  from: number,
  to: number,
  edgeCost: (edgeId: number) => number,
): PathResult | null {
  const dist = new Array<number>(g.nodes.length).fill(Infinity);
  const prevEdge = new Array<number>(g.nodes.length).fill(-1);
  const prevNode = new Array<number>(g.nodes.length).fill(-1);
  const heap = new MinHeap();
  dist[from] = 0;
  heap.push(0, from);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (d > dist[u]) continue;
    if (u === to) break;
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
        heap.push(nd, v);
      }
    }
  }
  if (!Number.isFinite(dist[to])) return null;
  const nodeIds = [to];
  const edgeIds: number[] = [];
  for (let n = to; n !== from; n = prevNode[n]) {
    edgeIds.push(prevEdge[n]);
    nodeIds.push(prevNode[n]);
  }
  nodeIds.reverse();
  edgeIds.reverse();
  return { nodeIds, edgeIds, cost: dist[to] };
}
