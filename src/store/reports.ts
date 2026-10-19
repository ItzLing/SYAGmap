import type { Graph, Report, ReportType } from '../types';
import { load, save, uid } from './storage';
import { mulberry32 } from '../data/simulate';

const HOUR = 3_600_000;

/** A few SIMULATED reports so the demo shows reports changing routes. */
export function seedReports(g: Graph, seed: number): Report[] {
  const rnd = mulberry32(seed + 1000);
  const types: ReportType[] = ['blocked', 'open_drain', 'broken_pavement', 'pole', 'no_ramp'];
  const out: Report[] = [];
  for (let i = 0; i < 8; i++) {
    const n = g.nodes[Math.floor(rnd() * g.nodes.length)];
    out.push({
      id: 'sim-' + i,
      pos: n.pos,
      type: types[i % types.length],
      note: 'Simulated report',
      createdAt: Date.now() - Math.floor(rnd() * 5 * 24) * HOUR,
      source: 'user',
      simulated: true,
    });
  }
  return out;
}

export class ReportStore {
  private key: string;
  private seeded: Report[];
  private mine: Report[];

  constructor(townshipId: string, g: Graph, seed: number) {
    this.key = `syagmap:${townshipId}:reports`;
    this.seeded = seedReports(g, seed);
    this.mine = load<Report[]>(this.key, []);
  }

  all(): Report[] {
    return [...this.seeded, ...this.mine];
  }

  add(r: Omit<Report, 'id' | 'createdAt' | 'source'>): Report {
    const full: Report = { ...r, id: uid(), createdAt: Date.now(), source: 'user' };
    this.mine.push(full);
    save(this.key, this.mine);
    return full;
  }

  clearMine(): void {
    this.mine = [];
    save(this.key, this.mine);
  }

  countMine(): number {
    return this.mine.length;
  }
}
