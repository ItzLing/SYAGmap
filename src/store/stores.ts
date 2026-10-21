import type { Graph, LngLat, Place, Report, ReportType } from '../types';
import { HELP_TTL_HOURS } from '../config';
import { Col, localGet, localSet, type Doc } from './db';
import { hashString, mulberry32 } from '../data/rng';
import { distM, pointAlong, projectOnPoly } from '../geo';
import { snapToGraph } from '../routing/engine';

const HOUR = 3_600_000;

/** Readable place name from the street network (offline; no geocoder needed). */
export function placeName(g: Graph, pos: LngLat): string {
  let best: { name: string; d: number } | null = null;
  for (const e of g.edges) {
    if (!e.name) continue;
    const d = projectOnPoly(pos, e.geom).distM;
    if (!best || d < best.d) best = { name: e.name, d };
  }
  if (best && best.d < 250) return best.d < 25 ? best.name : `Near ${best.name}`;
  return `${pos[1].toFixed(5)}, ${pos[0].toFixed(5)}`;
}

function randomOnStreet(g: Graph, rnd: () => number, named = false): LngLat {
  const pool = named ? g.edges.filter((e) => e.name) : g.edges;
  const e = pool[Math.floor(rnd() * pool.length)] ?? g.edges[0];
  return pointAlong(e.geom, rnd() * e.lengthM);
}

/* ------------------------------------------------------------------ reports */

export type StoredReport = Report & { township: string };

export class ReportStore {
  private col: Col<StoredReport>;
  private seeded: StoredReport[] = [];
  private mine: StoredReport[] = [];

  constructor(private township: string) {
    this.col = new Col<StoredReport>('reports', township);
  }

  async load(g: Graph) {
    const rnd = mulberry32(hashString(this.township) + 1000);
    const types: ReportType[] = ['blocked', 'open_drain', 'broken_pavement', 'pole', 'no_ramp'];
    // SIMULATED starter reports on real streets, so the demo has something to show.
    this.seeded = Array.from({ length: 10 }, (_, i) => ({
      id: 'sim-' + i, township: this.township, pos: randomOnStreet(g, rnd, true), type: types[i % types.length],
      note: 'Simulated report', createdAt: Date.now() - Math.floor(rnd() * 5 * 24) * HOUR, source: 'user' as const, simulated: true,
    }));
    this.mine = await this.col.list();
  }

  all(): StoredReport[] {
    return [...this.seeded, ...this.mine];
  }

  async add(r: { pos: LngLat; type: ReportType; note: string }) {
    const doc = await this.col.add({ ...r, source: 'user' });
    this.mine.push(doc);
    return doc;
  }

  async clearMine() {
    const old = this.mine;
    this.mine = [];
    await Promise.all(old.map((d) => this.col.remove(d.id)));
  }

  countMine() {
    return this.mine.length;
  }
}

/* ------------------------------------------------- observations (heatmap) */

export type Slot = 'morning' | 'midday' | 'evening';
export const SLOT_LABEL: Record<Slot, string> = { morning: 'Morning 6-10', midday: 'Midday 10-16', evening: 'Evening 16-21' };

export interface Observation extends Doc {
  pos: LngLat;
  /** people counted walking past in 5 minutes */
  count: number;
  slot: Slot;
  observer: string;
  simulated?: boolean;
}

export class ObservationStore {
  private col: Col<Observation>;
  private seeded: Observation[] = [];
  private real: Observation[] = [];
  private snapCache = new Map<string, number>();

  constructor(private township: string) {
    this.col = new Col<Observation>('observations', township);
  }

  async load(g: Graph) {
    const rnd = mulberry32(hashString(this.township) + 5000);
    // SIMULATED township-observer counts at locations on real streets.
    const slots: Slot[] = ['morning', 'midday', 'evening'];
    const slotMul: Record<Slot, number> = { morning: 0.8, midday: 0.6, evening: 1 };
    const weighted = g.edges.filter((e) => e.kind !== 'footpath' || !e.exposed || rnd() < 0.3);
    this.seeded = [];
    for (let i = 0; i < 60; i++) {
      const e = weighted[Math.floor(rnd() * weighted.length)];
      const pos = pointAlong(e.geom, rnd() * e.lengthM);
      const base = (e.kind === 'footpath' && !e.exposed ? 40 : 15) * (0.4 + rnd());
      for (const slot of slots) {
        this.seeded.push({
          id: `sim-${i}-${slot}`, township: this.township, createdAt: Date.now() - rnd() * 14 * 24 * HOUR, pos,
          count: Math.round(base * slotMul[slot] * (0.7 + rnd() * 0.6)), slot, observer: 'Simulated observer', simulated: true,
        });
      }
    }
    this.real = await this.col.list();
    this.snapCache.clear();
  }

  all(includeSim: boolean) {
    return includeSim ? [...this.seeded, ...this.real] : [...this.real];
  }

  counts() {
    return { real: this.real.length, simulated: this.seeded.length };
  }

  async add(o: { pos: LngLat; count: number; slot: Slot; observer: string }) {
    const doc = await this.col.add(o);
    this.real.push(doc);
    return doc;
  }

  private edgeOf(g: Graph, o: Observation): number {
    let id = this.snapCache.get(o.id);
    if (id === undefined) {
      id = snapToGraph(g, o.pos)?.edgeId ?? -1;
      this.snapCache.set(o.id, id);
    }
    return id;
  }

  /** Average people-per-5-minutes counted on each street segment. */
  footfall(g: Graph, includeSim: boolean, slot: Slot | 'all' = 'all'): Map<number, number> {
    const sum = new Map<number, { s: number; n: number }>();
    for (const o of this.all(includeSim)) {
      if (slot !== 'all' && o.slot !== slot) continue;
      const id = this.edgeOf(g, o);
      if (id < 0) continue;
      const cur = sum.get(id) ?? { s: 0, n: 0 };
      cur.s += o.count;
      cur.n += 1;
      sum.set(id, cur);
    }
    const out = new Map<number, number>();
    for (const [id, v] of sum) out.set(id, v.s / v.n);
    return out;
  }

  /** Heat points placed along the real street geometry of each counted segment. */
  heat(g: Graph, includeSim: boolean, slot: Slot | 'all'): GeoJSON.FeatureCollection {
    const ff = this.footfall(g, includeSim, slot);
    const max = Math.max(1, ...ff.values());
    const features: GeoJSON.Feature[] = [];
    for (const [id, v] of ff) {
      const e = g.edges[id];
      const steps = Math.max(1, Math.round(e.lengthM / 12));
      for (let i = 0; i <= steps; i++) {
        features.push({
          type: 'Feature', properties: { w: v / max },
          geometry: { type: 'Point', coordinates: pointAlong(e.geom, (e.lengthM * i) / steps) },
        });
      }
    }
    return { type: 'FeatureCollection', features };
  }
}

/* ------------------------------------------------------------------ carpool */

export interface CarpoolMessage { who: string; text: string; at: number }
export interface Carpool extends Doc {
  start: Place;
  end: Place;
  seats: number;
  users: string[];
  messages: CarpoolMessage[];
  simulated?: boolean;
}

export class CarpoolStore {
  private col: Col<Carpool>;
  private seeded: Carpool[] = [];
  private mine: Carpool[] = [];

  constructor(private township: string) {
    this.col = new Col<Carpool>('carpools', township);
  }

  async load(g: Graph) {
    const rnd = mulberry32(hashString(this.township) + 7000);
    const mk = (i: number, who: string, seats: number, msg: string): Carpool => {
      const s = randomOnStreet(g, rnd, true), e = randomOnStreet(g, rnd, true);
      return {
        id: 'sim-c' + i, township: this.township, createdAt: Date.now(), simulated: true, seats, users: [who],
        start: { pos: s, name: placeName(g, s) }, end: { pos: e, name: placeName(g, e) },
        messages: [{ who, text: msg, at: Date.now() - HOUR }],
      };
    };
    this.seeded = [mk(1, 'Aisyah', 3, 'Leaving 8:15am'), mk(2, 'Mr Tan', 2, 'Going to the clinic, 10am')];
    this.mine = await this.col.list();
  }

  all(): Carpool[] {
    return [...this.mine, ...this.seeded];
  }

  private find(id: string) {
    return this.all().find((c) => c.id === id);
  }

  async create(start: Place, end: Place, seats: number, owner: string) {
    const doc = await this.col.add({ start, end, seats, users: [owner], messages: [] });
    this.mine.unshift(doc);
  }

  async join(id: string, user: string) {
    const c = this.find(id);
    if (!c || c.users.includes(user) || c.users.length >= c.seats + 1) return;
    c.users.push(user);
    if (!c.simulated) await this.col.patch(id, { users: c.users });
  }

  async say(id: string, who: string, text: string) {
    const c = this.find(id);
    if (!c || !text.trim()) return;
    c.messages.push({ who, text: text.trim(), at: Date.now() });
    if (!c.simulated) await this.col.patch(id, { messages: c.messages });
  }
}

/* ---------------------------------------------------- first aid / helpers */

export interface Responder { name: string; skill: string; pos: LngLat; at: number }
export interface HelpRequest extends Doc {
  pos: LngLat;
  place: string;
  note: string;
  requester: string;
  responders: Responder[];
  /** helpers notified when the request was raised (simulated notification) */
  notified: number;
  simulated?: boolean;
}
export interface Helper { id: string; name: string; skill: string; pos: LngLat; simulated: true }

const ME_KEY = 'syagmap:helper-me';
export interface MeHelper { registered: boolean; available: boolean; skill: string }

export class FirstAidStore {
  private col: Col<HelpRequest>;
  helpers: Helper[] = [];
  requests: HelpRequest[] = [];
  me: MeHelper = localGet<MeHelper>(ME_KEY, { registered: false, available: false, skill: 'First-aid trained' });

  constructor(private township: string) {
    this.col = new Col<HelpRequest>('helpRequests', township);
  }

  async load(g: Graph) {
    const rnd = mulberry32(hashString(this.township) + 9000);
    const pick = () => randomOnStreet(g, rnd);
    const names: [string, string][] = [['Nurse Lim', 'Nurse'], ['Farid', 'First-aid certified'], ['Dr Kaur', 'Doctor'], ['Hana', 'CPR trained']];
    this.helpers = names.map(([name, skill], i) => ({ id: 'h' + i, name, skill, pos: pick(), simulated: true as const }));
    const seed = (id: string, note: string, hoursAgo: number, notified: number): HelpRequest => {
      const pos = pick();
      return {
        id, township: this.township, pos, place: placeName(g, pos), note, requester: 'Resident', notified, simulated: true,
        createdAt: Date.now() - hoursAgo * HOUR, responders: [],
      };
    };
    const r1 = seed('sim-r1', 'Elderly resident fell near the park', 2, 3);
    r1.responders.push({ name: 'Nurse Lim', skill: 'Nurse', pos: this.helpers[0].pos, at: Date.now() - 1.8 * HOUR });
    this.requests = [r1, seed('sim-r2', 'Sprained ankle (expires soon)', 11.5, 2), seed('sim-r3', 'Old request (already expired)', 13, 2), ...(await this.col.list())];
    this.prune();
  }

  /** Remove requests older than the TTL. The server also prunes (JSON "TTL index"). */
  prune(now = Date.now()): number {
    const before = this.requests.length;
    this.requests = this.requests.filter((r) => now - r.createdAt < HELP_TTL_HOURS * HOUR);
    return before - this.requests.length;
  }

  remainingMs(r: HelpRequest, now = Date.now()) {
    return r.createdAt + HELP_TTL_HOURS * HOUR - now;
  }

  setMe(patch: Partial<MeHelper>) {
    this.me = { ...this.me, ...patch };
    if (!this.me.registered) this.me.available = false;
    localSet(ME_KEY, this.me);
  }

  /** Helpers (simulated ones + you, if available) within range of a point. */
  nearbyHelpers(pos: LngLat, myPos: LngLat | null, rangeM = 700): number {
    const sim = this.helpers.filter((h) => distM(h.pos, pos) < rangeM).length;
    const me = this.me.registered && this.me.available && myPos && distM(myPos, pos) < rangeM ? 1 : 0;
    return sim + me;
  }

  async request(g: Graph, pos: LngLat, note: string, myPos: LngLat | null) {
    const doc = await this.col.add({
      pos, place: placeName(g, pos), note: note.trim() || 'Help needed', requester: 'You', responders: [],
      notified: this.nearbyHelpers(pos, myPos),
    });
    this.requests.unshift(doc);
    return doc;
  }

  /** The current user offers to help: records their name, skill and current location. */
  async offerHelp(id: string, myPos: LngLat) {
    const r = this.requests.find((x) => x.id === id);
    if (!r || r.responders.some((x) => x.name === 'You')) return;
    r.responders.push({ name: 'You', skill: this.me.skill, pos: myPos, at: Date.now() });
    if (!r.simulated) await this.col.patch(id, { responders: r.responders });
  }
}
