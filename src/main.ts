import './style.css';
import * as maplibregl from 'maplibre-gl';
import { TOWNSHIPS, MAP_STYLE, HELP_TTL_HOURS, type TownshipConfig } from './config';
import type { Graph, LngLat, ProfileId, ReportType } from './types';
import { generateGraph } from './data/simulate';
import { PROFILES, PROFILE_ORDER } from './routing/profiles';
import {
  computeRoutes, runBatch, nearestNode, REPORT_LABEL, reportInfluence,
  type RouteResult, type BatchResult,
} from './routing/engine';
import { ReportStore } from './store/reports';
import { CarpoolStore, FirstAidStore, simulateActivity } from './store/roadmap';

type Tab = 'route' | 'report' | 'roadmap';
type Pick = null | 'start' | 'end' | 'report' | 'help';

/** Walking speed assumptions (km/h) used only for the time estimate. UNVERIFIED. */
const SPEED_KMH: Record<ProfileId, number> = { walking: 4.8, wheelchair: 3.6, elderly: 3.0, stroller: 3.6, visual: 3.0 };

const REPORT_COLOR: Record<ReportType, string> = {
  blocked: '#dc2626', broken_pavement: '#ea580c', open_drain: '#2563eb', pole: '#7c3aed', no_ramp: '#0d9488', other: '#475569',
};

const S = {
  cfg: TOWNSHIPS[0] as TownshipConfig,
  graph: null as unknown as Graph,
  reports: null as unknown as ReportStore,
  carpool: null as unknown as CarpoolStore,
  aid: null as unknown as FirstAidStore,
  profile: 'wheelchair' as ProfileId,
  tab: 'route' as Tab,
  start: null as number | null,
  end: null as number | null,
  pick: null as Pick,
  reportType: 'blocked' as ReportType,
  reportNote: '',
  helpNote: '',
  result: null as RouteResult | null,
  batch: null as BatchResult | null,
  showHeat: false,
  toast: '',
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/* ------------------------------------------------------------------ layout */

const app = document.getElementById('app')!;
app.innerHTML = `
  <aside id="side" class="order-2 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-slate-200 bg-white md:order-1 md:w-[26rem] md:flex-none md:border-r md:border-t-0"></aside>
  <main class="relative order-1 h-[46dvh] md:order-2 md:h-auto md:flex-1">
    <div id="map" class="h-full w-full"></div>
    <div id="banner" class="pointer-events-none absolute left-3 top-3 max-w-[80%] rounded-lg bg-white/95 px-3 py-2 text-xs shadow"></div>
  </main>`;
const side = document.getElementById('side')!;
const banner = document.getElementById('banner')!;

maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);
const map = new maplibregl.Map({
  container: 'map',
  style: MAP_STYLE,
  center: S.cfg.center,
  zoom: S.cfg.zoom,
  attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
const startMarker = new maplibregl.Marker({ color: '#16a34a' });
const endMarker = new maplibregl.Marker({ color: '#0f172a' });

/* ------------------------------------------------------------ data loading */

function loadTownship(id: string) {
  S.cfg = TOWNSHIPS.find((t) => t.id === id) ?? TOWNSHIPS[0];
  S.graph = generateGraph(S.cfg);
  S.reports = new ReportStore(S.cfg.id, S.graph, S.cfg.seed);
  S.carpool = new CarpoolStore(S.cfg.id);
  S.aid = new FirstAidStore(S.cfg.id, S.graph, S.cfg.seed);
  S.start = S.end = null;
  S.result = null;
  S.batch = null;
  S.pick = null;
  startMarker.remove();
  endMarker.remove();
  if (map.getSource('network')) {
    map.jumpTo({ center: S.cfg.center, zoom: S.cfg.zoom });
    refreshMap();
  }
  render();
}

/* --------------------------------------------------------------- map layers */

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (coords: LngLat[], props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
const pt = (c: LngLat, props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
const setData = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);

function initLayers() {
  const empty = fc([]);
  for (const id of ['network', 'shortest', 'syag', 'barriers', 'reports', 'heat', 'helpers', 'requests']) {
    map.addSource(id, { type: 'geojson', data: empty });
  }
  map.addLayer({
    id: 'network', type: 'line', source: 'network',
    paint: {
      'line-width': 2,
      'line-opacity': 0.7,
      'line-color': ['match', ['get', 'kind'], 'crossing', '#f59e0b', 'skybridge', '#7c3aed', '#94a3b8'],
    },
  });
  map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' },
    paint: { 'heatmap-weight': ['get', 'w'], 'heatmap-radius': 28, 'heatmap-opacity': 0.75 } });
  map.addLayer({ id: 'shortest', type: 'line', source: 'shortest',
    paint: { 'line-width': 4, 'line-color': '#475569', 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'syag-casing', type: 'line', source: 'syag', paint: { 'line-width': 9, 'line-color': '#fff' } });
  map.addLayer({ id: 'syag', type: 'line', source: 'syag', paint: { 'line-width': 6, 'line-color': '#b91c1c' } });
  map.addLayer({ id: 'barriers', type: 'circle', source: 'barriers',
    paint: { 'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'reports', type: 'circle', source: 'reports',
    paint: {
      'circle-radius': ['case', ['get', 'sim'], 6, 8],
      'circle-color': ['get', 'color'],
      'circle-opacity': ['get', 'opacity'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fff',
    } });
  map.addLayer({ id: 'helpers', type: 'circle', source: 'helpers', layout: { visibility: 'none' },
    paint: { 'circle-radius': 7, 'circle-color': '#16a34a', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'requests', type: 'circle', source: 'requests', layout: { visibility: 'none' },
    paint: { 'circle-radius': 9, 'circle-color': '#e11d48', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
}

function refreshMap() {
  if (!map.getSource('network')) return;
  const g = S.graph;
  setData('network', fc(g.edges.map((e) => line([g.nodes[e.a].pos, g.nodes[e.b].pos], { kind: e.kind }))));
  const now = Date.now();
  setData('reports', fc(S.reports.all().map((r) =>
    pt(r.pos, {
      id: r.id, type: r.type, note: r.note, sim: !!r.simulated, color: REPORT_COLOR[r.type],
      opacity: Math.max(0.25, Math.min(1, reportInfluence(r, now) + 0.15)),
    }))));
  setData('heat', simulateActivity(g, S.cfg.seed));

  const coords = (ids: number[]) => ids.map((i) => g.nodes[i].pos);
  setData('shortest', fc(S.result?.shortest ? [line(coords(S.result.shortest.path.nodeIds))] : []));
  setData('syag', fc(S.result?.syag ? [line(coords(S.result.syag.path.nodeIds))] : []));
  setData('barriers', fc((S.result?.syag?.barrierEdges ?? []).map((b) => {
    const e = g.edges[b.edgeId];
    const a = g.nodes[e.a].pos, c = g.nodes[e.b].pos;
    return pt([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], { labels: b.labels.join(', ') });
  })));

  const onRoadmap = S.tab === 'roadmap';
  map.setLayoutProperty('heat', 'visibility', onRoadmap && S.showHeat ? 'visible' : 'none');
  map.setLayoutProperty('helpers', 'visibility', onRoadmap ? 'visible' : 'none');
  map.setLayoutProperty('requests', 'visibility', onRoadmap ? 'visible' : 'none');
  setData('helpers', fc(S.aid.helpers.map((h) => pt(h.pos, { name: h.name }))));
  setData('requests', fc(S.aid.requests.map((r) => pt(r.pos, { note: r.note }))));

  if (S.start !== null) startMarker.setLngLat(g.nodes[S.start].pos).addTo(map); else startMarker.remove();
  if (S.end !== null) endMarker.setLngLat(g.nodes[S.end].pos).addTo(map); else endMarker.remove();
  renderBanner();
}

function renderBanner() {
  const hints: Record<NonNullable<Pick>, string> = {
    start: 'Click the map to set the START',
    end: 'Click the map to set the DESTINATION',
    report: `Click the map where the problem is (${REPORT_LABEL[S.reportType]})`,
    help: 'Click the map where help is needed',
  };
  banner.textContent = S.pick ? hints[S.pick] : S.tab === 'route' && (S.start === null || S.end === null)
    ? 'Click the map to set start, then destination' : '';
  banner.classList.toggle('hidden', !banner.textContent);
}

/* ----------------------------------------------------------------- routing */

function recompute(fit = true) {
  S.batch = null;
  if (S.start === null || S.end === null || S.start === S.end) {
    S.result = null;
  } else {
    S.result = computeRoutes(S.graph, S.profile, S.start, S.end, S.reports.all());
  }
  render();
  refreshMap();
  const ids = S.result?.syag?.path.nodeIds;
  if (fit && ids?.length) {
    const b = new maplibregl.LngLatBounds();
    ids.forEach((i) => b.extend(S.graph.nodes[i].pos));
    map.fitBounds(b, { padding: 70, maxZoom: 17.5, duration: 600 });
  }
}

/* ------------------------------------------------------------- panels (UI) */

function render() {
  const tabBtn = (t: Tab, label: string) =>
    `<button role="tab" aria-selected="${S.tab === t}" data-a="tab:${t}" class="flex-1 border-b-2 px-3 py-2.5 text-sm font-semibold ${S.tab === t ? 'border-red-700 text-red-700' : 'border-transparent text-slate-500 hover:text-slate-900'}">${label}</button>`;
  side.innerHTML = `
    <header class="border-b border-slate-200 px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <h1 class="text-lg font-extrabold tracking-tight text-red-700">SYAGmap</h1>
        <span class="sim-tag" title="Network, reports and activity are simulated for this prototype">Simulated data</span>
      </div>
      <p class="text-xs text-slate-500">Walking that works for everyone</p>
      <label class="mt-2 block text-xs font-medium text-slate-600">Township
        <select data-bind="township" class="field mt-1">
          ${TOWNSHIPS.map((t) => `<option value="${t.id}" ${t.id === S.cfg.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
      </label>
    </header>
    <div role="tablist" class="flex border-b border-slate-200">${tabBtn('route', 'Route')}${tabBtn('report', 'Report')}${tabBtn('roadmap', 'Roadmap')}</div>
    <div class="flex-1 space-y-4 p-4">${S.tab === 'route' ? routePanel() : S.tab === 'report' ? reportPanel() : roadmapPanel()}</div>
    ${S.toast ? `<div role="status" class="sticky bottom-0 bg-slate-900 px-4 py-2 text-sm text-white">${esc(S.toast)}</div>` : ''}`;
}

function routePanel(): string {
  const p = PROFILES[S.profile];
  const chips = PROFILE_ORDER.map((id) =>
    `<button class="chip" aria-pressed="${S.profile === id}" data-a="profile:${id}">${PROFILES[id].label}</button>`).join('')
    + `<button class="chip cursor-not-allowed opacity-50" disabled title="Roadmap: needs the road network">Driving (roadmap)</button>`;

  const st = (k: 'start' | 'end', label: string, n: number | null) =>
    `<button class="btn flex-1 ${S.pick === k ? 'ring-2 ring-red-600' : ''}" data-a="pick:${k}">${label}${n === null ? '' : ' ✓'}</button>`;

  let result = `<p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Pick a start and a destination to compare the shortest route with a route that suits <b>${p.label.toLowerCase()}</b> travel.</p>`;
  const r = S.result;
  if (r?.syag) {
    const s = r.syag;
    const mins = Math.max(1, Math.round((s.lengthM / 1000 / SPEED_KMH[S.profile]) * 60));
    const sb = r.shortest?.barrierEdges.length ?? 0;
    const barriers = s.barrierEdges.length;
    const list = s.barrierEdges.length
      ? `<ul class="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-700">${s.barrierEdges.map((b) => `<li>${esc(b.labels.join(', '))}</li>`).join('')}</ul>` : '';
    result = `
      <section class="rounded-lg border border-slate-200 p-3" aria-live="polite">
        <div class="flex items-baseline justify-between">
          <h3 class="text-sm font-bold">SYAGmap route</h3>
          <span class="text-xs text-slate-500">${Math.round(s.lengthM)} m · ~${mins} min <span title="Speed assumption, unverified">(est.)</span></span>
        </div>
        <p class="mt-1 text-sm font-semibold ${barriers === 0 ? 'text-emerald-700' : 'text-amber-700'}">
          ${barriers === 0 ? '✔ No known barriers on this route' : `⚠ ${barriers} barrier${barriers > 1 ? 's' : ''} on this route`}
        </p>
        ${s.relaxed ? '<p class="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-900">No barrier-free route exists right now. This is the least-bad option.</p>' : ''}
        ${list}
        <div class="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600">
          <b>Shortest route</b> (dashed grey): ${r.shortest ? Math.round(r.shortest.lengthM) : '-'} m, <b class="${sb ? 'text-red-700' : ''}">${sb} barrier${sb === 1 ? '' : 's'}</b> for ${p.label.toLowerCase()}.
        </div>
      </section>`;
  } else if (S.start !== null && S.end !== null) {
    result = '<p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Choose two different points.</p>';
  }

  const b = S.batch;
  const metric = b
    ? `<div class="mt-2 text-sm">
         <div class="flex justify-between"><span>Shortest route</span><b>${pct(b.shortestBarrierFree, b.trips)}%</b></div>
         <div class="flex justify-between"><span>SYAGmap route</span><b class="text-emerald-700">${pct(b.syagBarrierFree, b.trips)}%</b></div>
         <p class="mt-1 text-xs text-slate-500">${b.trips} random trips for ${p.label.toLowerCase()} · ${pct(b.noAccessibleRoute, b.trips)}% had no barrier-free route at all.</p>
       </div>` : '';

  return `
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Who is travelling?</h2>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Travel profile">${chips}</div>
      <p class="mt-2 text-xs text-slate-500">${esc(p.hint)}</p></div>
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Trip</h2>
      <div class="flex gap-2">${st('start', 'Set start', S.start)}${st('end', 'Set destination', S.end)}</div>
      <div class="mt-2 flex gap-2">
        <button class="btn flex-1" data-a="locate">Use my location</button>
        <button class="btn" data-a="swap">Swap</button>
        <button class="btn" data-a="clear">Clear</button>
      </div></div>
    ${result}
    <section class="rounded-lg border border-slate-200 p-3">
      <div class="flex items-center justify-between"><h3 class="text-sm font-bold">Test metric: barrier-free trips</h3><span class="sim-tag">Simulated</span></div>
      <p class="text-xs text-slate-500">Share of random trips with zero known barriers.</p>
      ${metric}
      <button class="btn mt-2 w-full" data-a="batch">Run 300 simulated trips</button>
    </section>
    <p class="text-xs text-slate-500">Map legend: <span class="font-semibold text-amber-600">orange</span> crossing, <span class="font-semibold text-violet-600">purple</span> sky bridge (lift/ramp), grey footpath.</p>`;
}

function reportPanel(): string {
  const types = (Object.keys(REPORT_LABEL) as ReportType[]).map((t) =>
    `<option value="${t}" ${t === S.reportType ? 'selected' : ''}>${REPORT_LABEL[t]}</option>`).join('');
  const all = S.reports.all();
  const now = Date.now();
  const rows = [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6).map((r) => {
    const infl = reportInfluence(r, now);
    return `<li class="flex items-start gap-2 text-xs"><span class="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background:${REPORT_COLOR[r.type]}"></span>
      <span><b>${REPORT_LABEL[r.type]}</b>${r.simulated ? ' <span class="sim-tag">sim</span>' : ''}<br><span class="text-slate-500">${new Date(r.createdAt).toLocaleString()} · influence ${(infl * 100).toFixed(0)}%</span></span></li>`;
  }).join('');
  return `
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Report a problem</h2>
      <label class="block text-xs font-medium text-slate-600">Problem
        <select data-bind="reportType" class="field mt-1">${types}</select></label>
      <label class="mt-2 block text-xs font-medium text-slate-600">Note (optional)
        <input data-bind="reportNote" value="${esc(S.reportNote)}" maxlength="120" class="field mt-1" placeholder="e.g. car parked on the footpath"></label>
      <button class="btn-primary mt-3 w-full ${S.pick === 'report' ? 'ring-2 ring-red-300' : ''}" data-a="pick:report">${S.pick === 'report' ? 'Now click the map…' : 'Place report on map'}</button>
      <p class="mt-2 text-xs text-slate-500">Each report stores <b>location, problem, date/time</b>. Reports raise the cost of that stretch for everyone's routes and fade over time unless re-reported.</p></div>
    <div><h3 class="mb-2 text-sm font-bold">Latest reports (${all.length})</h3><ul class="space-y-2">${rows}</ul>
      <button class="btn mt-3 w-full" data-a="clearReports" ${S.reports.countMine() ? '' : 'disabled'}>Clear my reports (${S.reports.countMine()})</button></div>`;
}

function fmtRemaining(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left`;
}

function roadmapPanel(): string {
  const cp = S.carpool.all().map((c) => `
    <li class="rounded-lg border border-slate-200 p-2 text-sm">
      <div class="flex items-center justify-between"><b>${esc(c.start)} → ${esc(c.end)}</b>${c.simulated ? '<span class="sim-tag">sim</span>' : ''}</div>
      <div class="text-xs text-slate-500">${c.users.length}/${c.seats + 1} riders · ${esc(c.users.join(', '))}</div>
      <div class="mt-1 max-h-20 overflow-y-auto text-xs">${c.messages.map((m) => `<div><b>${esc(m.who)}:</b> ${esc(m.text)}</div>`).join('') || '<i class="text-slate-400">No messages</i>'}</div>
      <div class="mt-1 flex gap-1"><input id="msg-${c.id}" class="field !py-1" maxlength="100" placeholder="Message" aria-label="Chat message">
        <button class="btn !py-1" data-a="say:${c.id}">Send</button><button class="btn !py-1" data-a="join:${c.id}">Join</button></div>
    </li>`).join('');

  const reqs = S.aid.requests.map((r) => `
    <li class="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs">
      <b>${esc(r.note)}</b>${r.simulated ? ' <span class="sim-tag">sim</span>' : ''}<br>
      ${r.notified} helper${r.notified === 1 ? '' : 's'} notified · <span data-expiry="${r.id}" class="font-semibold">${fmtRemaining(S.aid.remainingMs(r))}</span></li>`).join('');

  return `
    <details open class="rounded-lg border border-slate-200 p-3">
      <summary class="cursor-pointer text-sm font-bold">Pedestrian-activity heatmap <span class="sim-tag">Simulated</span></summary>
      <p class="mt-2 text-xs text-slate-500">Where people walk most, to prioritise repairs. Uses simulated footfall here; the real version would aggregate anonymous trips.</p>
      <button class="btn mt-2 w-full" aria-pressed="${S.showHeat}" data-a="heat">${S.showHeat ? 'Hide heatmap' : 'Show heatmap on map'}</button>
    </details>
    <details open class="rounded-lg border border-slate-200 p-3">
      <summary class="cursor-pointer text-sm font-bold">Carpool <span class="sim-tag">Simulated</span></summary>
      <ul class="mt-2 space-y-2">${cp}</ul>
      <form data-form="carpool" class="mt-2 grid grid-cols-2 gap-1">
        <input name="start" required class="field" placeholder="Start" aria-label="Start">
        <input name="end" required class="field" placeholder="End" aria-label="End">
        <input name="seats" type="number" min="1" max="6" value="3" class="field" aria-label="Seats">
        <button class="btn" type="submit">Offer a ride</button>
      </form>
    </details>
    <details open class="rounded-lg border border-slate-200 p-3">
      <summary class="cursor-pointer text-sm font-bold">First Aid helpers <span class="sim-tag">Simulated</span></summary>
      <p class="mt-2 text-xs text-slate-500">Green dots = registered helpers, red = open requests. Requests expire after ${HELP_TTL_HOURS} hours. No real notifications are sent.</p>
      <button class="btn mt-2 w-full" aria-pressed="${S.aid.isHelper}" data-a="helper">${S.aid.isHelper ? '✔ I am a registered helper (tap to leave)' : 'Register as a helper'}</button>
      <input data-bind="helpNote" value="${esc(S.helpNote)}" maxlength="100" class="field mt-2" placeholder="What happened? (optional)" aria-label="Help request note">
      <button class="btn-primary mt-2 w-full ${S.pick === 'help' ? 'ring-2 ring-red-300' : ''}" data-a="pick:help">${S.pick === 'help' ? 'Now click the map…' : 'Request help'}</button>
      <ul class="mt-3 space-y-2">${reqs || '<li class="text-xs text-slate-400">No open requests</li>'}</ul>
    </details>`;
}

/* ------------------------------------------------------------ interactions */

function flash(msg: string) {
  S.toast = msg;
  render();
  setTimeout(() => { if (S.toast === msg) { S.toast = ''; render(); } }, 2800);
}

function setPoint(p: LngLat, which: 'start' | 'end') {
  const n = nearestNode(S.graph, p);
  if (which === 'start') S.start = n; else S.end = n;
}

side.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const [a, arg] = el.dataset.a!.split(':');
  switch (a) {
    case 'tab': S.tab = arg as Tab; S.pick = null; render(); refreshMap(); break;
    case 'profile': S.profile = arg as ProfileId; recompute(false); break;
    case 'pick': S.pick = S.pick === arg ? null : (arg as Pick); render(); renderBanner(); break;
    case 'swap': [S.start, S.end] = [S.end, S.start]; recompute(false); break;
    case 'clear': S.start = S.end = null; recompute(false); break;
    case 'locate':
      navigator.geolocation?.getCurrentPosition(
        (pos) => { setPoint([pos.coords.longitude, pos.coords.latitude], 'start'); recompute(); },
        () => flash('Location permission denied or unavailable'),
      );
      break;
    case 'batch': S.batch = runBatch(S.graph, S.profile, S.reports.all()); render(); break;
    case 'clearReports': S.reports.clearMine(); recompute(false); break;
    case 'heat': S.showHeat = !S.showHeat; render(); refreshMap(); break;
    case 'helper': S.aid.setHelper(!S.aid.isHelper); flash(S.aid.isHelper ? 'Registered as a helper (simulated)' : 'Left the helper network'); break;
    case 'join': S.carpool.join(arg, 'You'); render(); break;
    case 'say': {
      const input = document.getElementById('msg-' + arg) as HTMLInputElement | null;
      if (input) S.carpool.say(arg, 'You', input.value);
      render();
      break;
    }
  }
});

side.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.dataset.bind === 'reportNote') S.reportNote = el.value;
  if (el.dataset.bind === 'helpNote') S.helpNote = el.value;
});

side.addEventListener('change', (ev) => {
  const el = ev.target as HTMLSelectElement;
  if (el.dataset.bind === 'reportType') { S.reportType = el.value as ReportType; renderBanner(); }
  if (el.dataset.bind === 'township') loadTownship(el.value);
});

side.addEventListener('submit', (ev) => {
  const f = ev.target as HTMLFormElement;
  if (f.dataset.form !== 'carpool') return;
  ev.preventDefault();
  const d = new FormData(f);
  S.carpool.create(String(d.get('start')), String(d.get('end')), Number(d.get('seats')) || 1, 'You');
  render();
});

map.on('click', (e) => {
  const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
  if (!S.pick) {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['reports', 'requests', 'helpers'] })[0];
    if (hit) {
      const pr = hit.properties as Record<string, string>;
      const title = hit.layer.id === 'reports' ? REPORT_LABEL[pr.type as ReportType] : hit.layer.id === 'helpers' ? `Helper: ${pr.name}` : `Help request: ${pr.note}`;
      new maplibregl.Popup({ closeButton: false }).setLngLat(p).setHTML(`<b>${esc(title)}</b>${pr.note && hit.layer.id === 'reports' ? `<br>${esc(pr.note)}` : ''}`).addTo(map);
      return;
    }
  }
  const mode = S.pick ?? (S.tab === 'route' ? (S.start === null ? 'start' : 'end') : null);
  if (!mode) return;
  if (mode === 'start' || mode === 'end') {
    setPoint(p, mode);
    S.pick = mode === 'start' && S.end === null ? 'end' : null;
    recompute();
  } else if (mode === 'report') {
    S.reports.add({ pos: p, type: S.reportType, note: S.reportNote });
    S.pick = null;
    recompute(false);
    flash('Report saved. Routes now avoid this spot.');
  } else if (mode === 'help') {
    const r = S.aid.request(p, S.helpNote);
    S.pick = null;
    S.helpNote = '';
    refreshMap();
    flash(`Help request sent (simulated). ${r.notified} nearby helper${r.notified === 1 ? '' : 's'} notified.`);
  }
});

/** Expire help requests after 12h and keep countdowns fresh. */
setInterval(() => {
  const removed = S.aid.prune();
  if (removed) { render(); refreshMap(); return; }
  document.querySelectorAll<HTMLElement>('[data-expiry]').forEach((el) => {
    const r = S.aid.requests.find((x) => x.id === el.dataset.expiry);
    if (r) el.textContent = fmtRemaining(S.aid.remainingMs(r));
  });
}, 30_000);

map.on('load', () => {
  initLayers();
  refreshMap();
});

loadTownship(S.cfg.id);
