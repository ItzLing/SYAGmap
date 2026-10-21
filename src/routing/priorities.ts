import type { Graph, LngLat, Report, ReportType } from '../types';
import { pointAlong } from '../geo';
import { REPORT_LABEL, SEVERITY, reportInfluence, snapToGraph } from './engine';
import { placeName } from '../store/stores';

export interface Cluster {
  id: string;
  edgeId: number;
  street: string;
  pos: LngLat;
  reportCount: number;
  types: Partial<Record<ReportType, number>>;
  newestAgeDays: number;
  /** sum of severity x recency over the cluster's reports */
  severity: number;
  /** average pedestrian count per 5 minutes near this spot, from township observers */
  footfall: number;
  /** footfall relative to the busiest counted street (0..1) */
  footfallIdx: number;
  score: number;
  reason: string;
}

const WHEELCHAIR_BLOCKING: ReportType[] = ['blocked', 'no_ramp', 'open_drain', 'pole'];
const SNAP_M = 40;

/** Group reports by street segment and score them with footfall. Pure and explainable. */
export function buildClusters(g: Graph, reports: Report[], footfall: Map<number, number>, now = Date.now()): Cluster[] {
  const maxFF = Math.max(1, ...footfall.values());
  const byEdge = new Map<number, Report[]>();
  for (const r of reports) {
    const s = snapToGraph(g, r.pos);
    if (!s || s.distM > SNAP_M || reportInfluence(r, now) < 0.05) continue;
    byEdge.set(s.edgeId, [...(byEdge.get(s.edgeId) ?? []), r]);
  }

  const out: Cluster[] = [];
  for (const [edgeId, rs] of byEdge) {
    const e = g.edges[edgeId];
    const pos = pointAlong(e.geom, e.lengthM / 2);
    const types: Cluster['types'] = {};
    let severity = 0, newest = Infinity, blocking = false;
    for (const r of rs) {
      types[r.type] = (types[r.type] ?? 0) + 1;
      severity += SEVERITY[r.type] * reportInfluence(r, now);
      newest = Math.min(newest, (now - r.createdAt) / 86_400_000);
      if (WHEELCHAIR_BLOCKING.includes(r.type)) blocking = true;
    }
    // Footfall of this segment, else the average of connected segments.
    let ff = footfall.get(edgeId);
    if (ff === undefined) {
      const near = [...g.adj[e.a], ...g.adj[e.b]].map((id) => footfall.get(id)).filter((v): v is number => v !== undefined);
      ff = near.length ? near.reduce((a, b) => a + b, 0) / near.length : 0;
    }
    const idx = ff / maxFF;
    const score = severity * (1 + 2 * idx) * (blocking ? 1.3 : 1);
    const typeText = Object.entries(types).map(([t, n]) => `${n}x ${REPORT_LABEL[t as ReportType].toLowerCase()}`).join(', ');
    out.push({
      id: 'c' + edgeId, edgeId, street: e.name ?? placeName(g, pos), pos, reportCount: rs.length, types,
      newestAgeDays: +newest.toFixed(1), severity: +severity.toFixed(2), footfall: +ff.toFixed(1), footfallIdx: +idx.toFixed(2),
      score: +score.toFixed(2),
      reason: `${typeText}; ${ff > 0 ? `about ${Math.round(ff)} people / 5 min (${Math.round(idx * 100)}% of the busiest counted street)` : 'no footfall count nearby'}${blocking ? '; blocks wheelchair and stroller access' : ''}.`,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

export interface RankedItem {
  cluster: Cluster;
  rank: number;
  reason: string;
  action?: string;
}

export interface Ranking {
  source: 'claude' | 'rules';
  model?: string;
  summary: string;
  note?: string;
  items: RankedItem[];
}

function rulesRanking(clusters: Cluster[], note?: string): Ranking {
  return {
    source: 'rules',
    note,
    summary: 'Ranked by severity x recency x footfall (rule-based).',
    items: clusters.map((c, i) => ({ cluster: c, rank: i + 1, reason: c.reason })),
  };
}

/** Ask the server (Claude) to rank the clusters; fall back to the rule-based order. */
export async function rank(township: string, clusters: Cluster[]): Promise<Ranking> {
  if (clusters.length === 0) return rulesRanking([], 'No reports to rank yet.');
  const top = clusters.slice(0, 15);
  try {
    const r = await fetch('/api/ai/prioritize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        township,
        clusters: top.map((c) => ({
          id: c.id, street: c.street, reports: c.reportCount, problems: c.types, newestReportDaysAgo: c.newestAgeDays,
          severityScore: c.severity, footfallPer5Min: c.footfall, footfallIndex: c.footfallIdx,
        })),
      }),
    });
    const data = await r.json();
    if (!data.ok) {
      const why = { no_key: 'Claude is not configured (set ANTHROPIC_API_KEY in .env). Showing the rule-based ranking.', refused: 'Claude declined this request. Showing the rule-based ranking.' }[data.reason as string]
        ?? 'Claude returned no usable answer. Showing the rule-based ranking.';
      return rulesRanking(top, why);
    }
    const byId = new Map(top.map((c) => [c.id, c]));
    const items: RankedItem[] = [];
    for (const it of data.ranking as { id: string; rank: number; reason: string; suggestedAction?: string }[]) {
      const c = byId.get(it.id);
      if (c) { items.push({ cluster: c, rank: it.rank, reason: it.reason, action: it.suggestedAction }); byId.delete(it.id); }
    }
    for (const c of byId.values()) items.push({ cluster: c, rank: items.length + 1, reason: c.reason });
    items.sort((a, b) => a.rank - b.rank);
    return { source: 'claude', model: data.model, summary: data.summary ?? '', items };
  } catch {
    return rulesRanking(top, 'AI service unreachable. Showing the rule-based ranking.');
  }
}
