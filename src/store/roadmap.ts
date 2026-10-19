import type { Graph, LngLat } from '../types';
import { HELP_TTL_HOURS } from '../config';
import { load, save, uid } from './storage';
import { mulberry32 } from '../data/simulate';
import { distM } from '../geo';

const HOUR = 3_600_000;

/* ---------- Pedestrian-activity heatmap (SIMULATED) ---------- */

export function simulateActivity(g: Graph, seed: number): GeoJSON.FeatureCollection {
  const rnd = mulberry32(seed + 5000);
  const features: GeoJSON.Feature[] = [];
  for (const e of g.edges) {
    // busier near the middle, and on sky bridges / crossings
    const a = g.nodes[e.a].pos, b = g.nodes[e.b].pos;
    const boost = e.kind === 'footpath' ? 1 : 4;
    const n = Math.floor(rnd() * 4 * boost);
    for (let i = 0; i < n; i++) {
      const t = rnd();
      features.push({
        type: 'Feature',
        properties: { w: 0.3 + rnd() },
        geometry: { type: 'Point', coordinates: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/* ---------- Carpool (SIMULATED) ---------- */

export interface CarpoolMessage { who: string; text: string; at: number }
export interface Carpool {
  id: string;
  start: string;
  end: string;
  seats: number;
  users: string[];
  messages: CarpoolMessage[];
  simulated?: boolean;
}

export class CarpoolStore {
  private key: string;
  private list: Carpool[];

  constructor(townshipId: string) {
    this.key = `syagmap:${townshipId}:carpool`;
    this.list = load<Carpool[]>(this.key, [
      { id: 'c1', start: 'Residential block A', end: 'Mall', seats: 3, users: ['Aisyah'], messages: [{ who: 'Aisyah', text: 'Leaving 8:15am', at: Date.now() - HOUR }], simulated: true },
      { id: 'c2', start: 'Park entrance', end: 'Clinic', seats: 2, users: ['Mr Tan'], messages: [], simulated: true },
    ]);
  }
  all() { return this.list; }
  persist() { save(this.key, this.list); }
  create(start: string, end: string, seats: number, owner: string) {
    this.list.unshift({ id: uid(), start, end, seats, users: [owner], messages: [] });
    this.persist();
  }
  join(id: string, user: string) {
    const c = this.list.find((x) => x.id === id);
    if (c && !c.users.includes(user) && c.users.length < c.seats + 1) { c.users.push(user); this.persist(); }
  }
  say(id: string, who: string, text: string) {
    const c = this.list.find((x) => x.id === id);
    if (c && text.trim()) { c.messages.push({ who, text: text.trim(), at: Date.now() }); this.persist(); }
  }
}

/* ---------- First Aid helper network (SIMULATED notifications) ---------- */

export interface Helper { id: string; name: string; skill: string; pos: LngLat; simulated?: boolean }
export interface HelpRequest { id: string; pos: LngLat; note: string; createdAt: number; notified: number; simulated?: boolean }

export class FirstAidStore {
  private reqKey: string;
  private meKey: string;
  helpers: Helper[];
  requests: HelpRequest[];
  isHelper: boolean;

  constructor(townshipId: string, g: Graph, seed: number) {
    this.reqKey = `syagmap:${townshipId}:helpreq`;
    this.meKey = `syagmap:${townshipId}:ishelper`;
    const rnd = mulberry32(seed + 9000);
    const pick = () => g.nodes[Math.floor(rnd() * g.nodes.length)].pos;
    this.helpers = [
      { id: 'h1', name: 'Nurse Lim', skill: 'Nurse', pos: pick(), simulated: true },
      { id: 'h2', name: 'Farid', skill: 'First-aid certified', pos: pick(), simulated: true },
      { id: 'h3', name: 'Dr Kaur', skill: 'Doctor', pos: pick(), simulated: true },
      { id: 'h4', name: 'Hana', skill: 'CPR trained', pos: pick(), simulated: true },
    ];
    const seeded: HelpRequest[] = [
      { id: 'r1', pos: pick(), note: 'Elderly resident fell near the park (simulated)', createdAt: Date.now() - 2 * HOUR, notified: 3, simulated: true },
      { id: 'r2', pos: pick(), note: 'Sprained ankle (simulated, will expire soon)', createdAt: Date.now() - 11.5 * HOUR, notified: 2, simulated: true },
      { id: 'r3', pos: pick(), note: 'Old request (simulated, already expired)', createdAt: Date.now() - 13 * HOUR, notified: 2, simulated: true },
    ];
    this.requests = [...seeded, ...load<HelpRequest[]>(this.reqKey, [])];
    this.isHelper = load<boolean>(this.meKey, false);
    this.prune();
  }

  /** Remove requests older than the TTL. A real backend would use a DB TTL index. */
  prune(now = Date.now()): number {
    const before = this.requests.length;
    this.requests = this.requests.filter((r) => now - r.createdAt < HELP_TTL_HOURS * HOUR);
    this.persist();
    return before - this.requests.length;
  }

  private persist() {
    save(this.reqKey, this.requests.filter((r) => !r.simulated));
  }

  setHelper(v: boolean) {
    this.isHelper = v;
    save(this.meKey, v);
  }

  request(pos: LngLat, note: string): HelpRequest {
    const notified = this.helpers.filter((h) => distM(h.pos, pos) < 600).length;
    const r: HelpRequest = { id: uid(), pos, note: note || 'Help needed', createdAt: Date.now(), notified };
    this.requests.unshift(r);
    this.persist();
    return r;
  }

  remainingMs(r: HelpRequest, now = Date.now()): number {
    return r.createdAt + HELP_TTL_HOURS * HOUR - now;
  }
}
