import './style.css';
import * as maplibregl from 'maplibre-gl';
import { TOWNSHIPS, MAP_STYLE } from './config';
import type { EdgeAttrs, LngLat, ProfileId, ReportType } from './types';
import { buildGraph, fetchRawGraph, type GraphEdit } from './data/graphLoader';
import { computeRoutes, indexReports, runBatch, snapToGraph, REPORT_LABEL, reportInfluence } from './routing/engine';
import { buildClusters, rank } from './routing/priorities';
import { Col, localGet, localSet, type Doc } from './store/db';
import {
  CarpoolStore, FirstAidStore, ObservationStore, ReportStore, placeName, type Slot,
} from './store/stores';
import { S, type PickKind, type Tab } from './state';
import { MarkerSet, pinEl } from './ui/markers';
import { REPORT_COLOR, esc, fmtRemaining, renderSide } from './ui/panels';

// MapLibre 6 runs in a module worker; serve it untouched from /public (see scripts/copy-maplibre.mjs).
maplibregl.setWorkerUrl(`${import.meta.env.BASE_URL}maplibre/maplibre-gl-worker.mjs`);

/* ------------------------------------------------------------------ layout */

const app = document.getElementById('app')!;
app.innerHTML = `
  <aside id="side" class="order-2 flex min-h-0 flex-1 flex-col overflow-y-auto border-t border-slate-200 bg-white md:order-1 md:w-[26rem] md:flex-none md:border-r md:border-t-0"></aside>
  <main class="relative order-1 h-[46dvh] md:order-2 md:h-auto md:flex-1">
    <div id="map" class="h-full w-full"></div>
    <div id="banner" class="pointer-events-none absolute left-3 top-3 hidden max-w-[80%] rounded-lg bg-white/95 px-3 py-2 text-xs shadow"></div>
    <div id="confirm" class="absolute bottom-6 left-1/2 hidden w-[min(92%,26rem)] -translate-x-1/2 rounded-xl bg-white p-3 shadow-lg ring-1 ring-slate-300"></div>
  </main>`;
const side = document.getElementById('side')!;
const banner = document.getElementById('banner')!;
const confirmBar = document.getElementById('confirm')!;

const map = new maplibregl.Map({
  container: 'map', style: MAP_STYLE, center: S.cfg.center, zoom: S.cfg.zoom, attributionControl: { compact: true },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
const dyn = new MarkerSet(map);
let meMarker: maplibregl.Marker | null = null;
let mapReady = false;
let dataReady = false;
let popup: maplibregl.Popup | null = null;

/* ------------------------------------------------------------------ helpers */

const fc = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });
const line = (coords: LngLat[], props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords } });
const pt = (c: LngLat, props: GeoJSON.GeoJsonProperties = {}): GeoJSON.Feature => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: c } });
const setData = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data);
const setVis = (ids: string[], on: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));

function fitTo(points: LngLat[], maxZoom = 17.5) {
  if (!points.length) return;
  const b = new maplibregl.LngLatBounds();
  points.forEach((p) => b.extend(p));
  map.fitBounds(b, { padding: 80, maxZoom, duration: 600 });
}

function flash(msg: string) {
  S.toast = msg;
  render();
  setTimeout(() => { if (S.toast === msg) { S.toast = ''; render(); } }, 3200);
}

function render() {
  side.innerHTML = renderSide();
}

/* ------------------------------------------------------------- map layers */

function initLayers() {
  for (const id of ['network', 'shortest', 'syag', 'barriers', 'reports', 'heat', 'helpers', 'requests', 'links', 'draw', 'drawPts']) {
    map.addSource(id, { type: 'geojson', data: fc([]) });
  }
  map.addLayer({ id: 'network', type: 'line', source: 'network', paint: {
    'line-width': 2, 'line-opacity': 0.5,
    'line-color': ['case', ['==', ['get', 'sel'], 1], '#dc2626', ['==', ['get', 'custom'], 1], '#16a34a',
      ['match', ['get', 'kind'], 'crossing', '#f59e0b', 'skybridge', '#7c3aed', '#64748b']],
  } });
  map.addLayer({ id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' }, paint: {
    'heatmap-weight': ['get', 'w'], 'heatmap-radius': 26, 'heatmap-intensity': 1.1, 'heatmap-opacity': 0.8,
  } });
  map.addLayer({ id: 'shortest', type: 'line', source: 'shortest', layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-width': 4, 'line-color': '#475569', 'line-dasharray': [2, 2] } });
  map.addLayer({ id: 'syag-casing', type: 'line', source: 'syag', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 9, 'line-color': '#fff' } });
  map.addLayer({ id: 'syag', type: 'line', source: 'syag', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': 6, 'line-color': '#b91c1c' } });
  map.addLayer({ id: 'barriers', type: 'circle', source: 'barriers', paint: {
    'circle-radius': 6, 'circle-color': '#f59e0b', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'reports', type: 'circle', source: 'reports', paint: {
    'circle-radius': ['case', ['get', 'sim'], 6, 8], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'opacity'],
    'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'links', type: 'line', source: 'links', layout: { visibility: 'none' },
    paint: { 'line-width': 3, 'line-color': ['get', 'color'], 'line-dasharray': [2, 1.5] } });
  map.addLayer({ id: 'helpers', type: 'circle', source: 'helpers', layout: { visibility: 'none' }, paint: {
    'circle-radius': 7, 'circle-color': '#16a34a', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'requests', type: 'circle', source: 'requests', layout: { visibility: 'none' }, paint: {
    'circle-radius': 9, 'circle-color': '#e11d48', 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } });
  map.addLayer({ id: 'draw', type: 'line', source: 'draw', paint: { 'line-width': 4, 'line-color': '#16a34a', 'line-dasharray': [1, 1] } });
  map.addLayer({ id: 'drawPts', type: 'circle', source: 'drawPts', paint: {
    'circle-radius': 5, 'circle-color': '#16a34a', 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } });
}

/** Rebuild everything on the map for the current tab and selection. */
function refreshMap() {
  if (!mapReady || !dataReady) return;
  const g = S.graph;
  const t = S.tab;
  const now = Date.now();
  dyn.clear();

  // Layers: each tab shows only its own things (problems, helpers and requests never mix).
  setVis(['network'], t === 'route' || t === 'admin');
  setVis(['shortest', 'syag-casing', 'syag', 'barriers'], t === 'route');
  setVis(['reports'], t === 'route' || t === 'report' || t === 'priority');
  setVis(['heat'], t === 'heat');
  setVis(['helpers', 'requests'], t === 'aid');
  setVis(['links'], t === 'aid' || t === 'carpool');
  setVis(['draw', 'drawPts'], t === 'admin');
  if (map.getLayer('network')) {
    map.setPaintProperty('network', 'line-width', t === 'admin' ? 3.5 : 2);
    map.setPaintProperty('network', 'line-opacity', t === 'admin' ? 0.9 : 0.4);
  }
  meMarker?.getElement().style.setProperty('display', t === 'route' || t === 'carpool' || t === 'aid' ? 'flex' : 'none');

  if (t === 'route' || t === 'admin') {
    setData('network', fc(g.edges.map((e) => line(e.geom, { kind: e.kind, custom: e.custom ? 1 : 0, sel: e.id === S.admin.selectedEdge ? 1 : 0 }))));
  }
  if (t === 'route') {
    setData('shortest', fc(S.result?.shortest ? [line(S.result.shortest.coords)] : []));
    setData('syag', fc(S.result?.syag ? [line(S.result.syag.coords)] : []));
    setData('barriers', fc((S.result?.syag?.barrierEdges ?? []).map((b) => pt(b.at, { labels: b.labels.join(', ') }))));
    if (S.start) dyn.add(S.start.pos, pinEl('A', '#16a34a'));
    if (S.end) dyn.add(S.end.pos, pinEl('B', '#0f172a'));
  }
  if (t === 'route' || t === 'report' || t === 'priority') {
    setData('reports', fc(S.reports.all().map((r) => pt(r.pos, {
      id: r.id, type: r.type, note: r.note, sim: !!r.simulated, color: REPORT_COLOR[r.type],
      opacity: Math.max(0.25, Math.min(1, reportInfluence(r, now) + 0.15)),
    }))));
  }
  if (t === 'heat') setData('heat', S.obs.heat(g, S.heatIncludeSim, S.heatSlot));

  if (t === 'carpool') {
    const c = S.carpool.all().find((x) => x.id === S.selCarpool);
    setData('links', fc(c ? [line([c.start.pos, c.end.pos], { color: '#2563eb' })] : []));
    if (c) {
      dyn.add(c.start.pos, pinEl('A', '#16a34a', 32, true));
      dyn.add(c.end.pos, pinEl('B', '#0f172a', 32, true));
    }
    if (S.cpDraft.start) dyn.add(S.cpDraft.start.pos, pinEl('A', '#16a34a'));
    if (S.cpDraft.end) dyn.add(S.cpDraft.end.pos, pinEl('B', '#0f172a'));
  }

  if (t === 'aid') {
    const sel = S.aid.requests.find((r) => r.id === S.selHelp);
    if (sel) {
      // Focus view: where help is needed, who is coming, and where you are.
      setData('helpers', fc([]));
      setData('requests', fc([]));
      setData('links', fc(sel.responders.map((x) => line([x.pos, sel.pos], { color: '#16a34a' }))));
      dyn.add(sel.pos, pinEl('!', '#e11d48', 34, true));
      sel.responders.forEach((x, i) => dyn.add(x.pos, pinEl(String(i + 1), '#16a34a', 30)));
    } else {
      const mine = S.aid.me.registered && S.aid.me.available;
      setData('links', fc([]));
      setData('helpers', fc(S.aid.helpers.map((h) => pt(h.pos, { name: h.name, skill: h.skill }))));
      setData('requests', fc(S.aid.requests.map((r) => pt(r.pos, { note: r.note, place: r.place }))));
      if (mine) { /* your own dot is the blue marker */ }
    }
  }

  if (t === 'priority' && S.ranking) {
    S.ranking.items.slice(0, 10).forEach((it) => dyn.add(it.cluster.pos, pinEl(String(it.rank), '#b91c1c', 30, true)));
  }

  if (t === 'admin') {
    setData('draw', fc(S.admin.drawPts.length > 1 ? [line(S.admin.drawPts)] : []));
    setData('drawPts', fc(S.admin.drawPts.map((p) => pt(p))));
  }

  if (S.pending) dyn.add(S.pending.pos, pinEl('?', '#f59e0b', 32, true));
  renderBanner();
  renderConfirm();
}

const PICK_HINT: Record<PickKind, string> = {
  start: 'Click the map to set the START', end: 'Click the map to set the DESTINATION',
  report: 'Click where the problem is', help: 'Click where help is needed',
  carpoolStart: 'Click the ride START', carpoolEnd: 'Click the ride END', obs: 'Click the street spot you counted at',
  adminDraw: 'Click along the new path', adminSeg: 'Click a street segment',
};

function renderBanner() {
  const text = S.pending ? 'Drag or click again to adjust, then confirm' : S.pick ? PICK_HINT[S.pick]
    : S.tab === 'route' && (!S.start || !S.end) ? 'Click the map to set start, then destination' : '';
  banner.textContent = text;
  banner.classList.toggle('hidden', !text);
}

function pendingText(): string {
  const p = S.pending!;
  const where = esc(placeName(S.graph, p.pos));
  switch (p.kind) {
    case 'report': return `Report <b>${REPORT_LABEL[S.reportType]}</b> at <b>${where}</b>?`;
    case 'help': return `Request <b>first-aid help</b> at <b>${where}</b>? Nearby helpers will be notified.`;
    case 'carpoolStart': return `Set the ride <b>start</b> to <b>${where}</b>?`;
    case 'carpoolEnd': return `Set the ride <b>end</b> to <b>${where}</b>?`;
    case 'obs': return `Log a pedestrian count at <b>${where}</b>?`;
    default: return `Use <b>${where}</b>?`;
  }
}

function renderConfirm() {
  if (!S.pending) { confirmBar.classList.add('hidden'); return; }
  confirmBar.classList.remove('hidden');
  confirmBar.innerHTML = `<p class="text-sm">${pendingText()}</p>
    <div class="mt-2 grid grid-cols-2 gap-2"><button class="btn-primary" data-a="confirm">Confirm</button><button class="btn" data-a="cancelPick">Cancel</button></div>`;
}

/* ------------------------------------------------------------------ routing */

function resnap() {
  if (S.start) S.start = snapToGraph(S.graph, S.start.pos);
  if (S.end) S.end = snapToGraph(S.graph, S.end.pos);
}

function recompute(fit = true) {
  S.batch = null;
  if (S.start && S.end) {
    S.result = computeRoutes(S.graph, S.profile, S.start, S.end, indexReports(S.graph, S.reports.all(), Date.now()));
  } else S.result = null;
  render();
  refreshMap();
  if (fit && S.result?.syag) fitTo(S.result.syag.coords);
}

function setRoutePoint(p: LngLat, which: 'start' | 'end') {
  const s = snapToGraph(S.graph, p);
  if (!s || s.distM > 150) { flash('That point is too far from any street in the loaded area.'); return false; }
  if (which === 'start') S.start = s; else S.end = s;
  return true;
}

/* -------------------------------------------------------------- data loading */

const editsCol = (township: string) => new Col<GraphEdit & Doc>('graphEdits', township);
let edits: Col<GraphEdit & Doc> = editsCol(S.cfg.id);

function rebuildGraph() {
  S.graph = buildGraph(S.raw!, S.edits);
  S.admin.selectedEdge = null;
  resnap();
}

async function loadTownship(id: string) {
  S.cfg = TOWNSHIPS.find((t) => t.id === id) ?? TOWNSHIPS[0];
  S.loading = true; S.loadError = ''; dataReady = false;
  S.start = S.end = null; S.result = S.ranking = null; S.batch = null;
  S.pick = S.pending = null; S.selCarpool = S.selHelp = null;
  S.admin.drawPts = []; S.admin.selectedEdge = null;
  S.cpDraft = { start: null, end: null, seats: 3 }; S.obsDraft.pos = null;
  render();
  try {
    edits = editsCol(S.cfg.id);
    const [raw, list] = await Promise.all([fetchRawGraph(S.cfg.id), edits.list()]);
    S.raw = raw; S.edits = list;
    S.graph = buildGraph(raw, list);
    S.reports = new ReportStore(S.cfg.id);
    S.obs = new ObservationStore(S.cfg.id);
    S.carpool = new CarpoolStore(S.cfg.id);
    S.aid = new FirstAidStore(S.cfg.id);
    await Promise.all([S.reports.load(S.graph), S.obs.load(S.graph), S.carpool.load(S.graph), S.aid.load(S.graph)]);
    const saved = localGet<LngLat | null>(`syagmap:me:${S.cfg.id}`, null);
    S.me = saved ?? snapToGraph(S.graph, S.cfg.center)?.pos ?? S.cfg.center;
    S.loading = false;
    dataReady = true;
    map.jumpTo({ center: S.cfg.center, zoom: S.cfg.zoom });
    placeMe();
  } catch (e) {
    S.loading = false;
    S.loadError = e instanceof Error ? e.message : String(e);
  }
  render();
  refreshMap();
}

function placeMe() {
  if (!meMarker) {
    const el = pinEl('You', '#2563eb', 36, true);
    el.style.cursor = 'grab';
    meMarker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(S.me).addTo(map);
    meMarker.on('dragend', () => {
      const ll = meMarker!.getLngLat();
      S.me = [ll.lng, ll.lat];
      localSet(`syagmap:me:${S.cfg.id}`, S.me);
      render();
      refreshMap();
    });
  } else meMarker.setLngLat(S.me);
}

/* --------------------------------------------------------------- map events */

map.on('load', () => {
  initLayers();
  mapReady = true;
  refreshMap();
});

function showPopup(p: LngLat, html: string) {
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: false }).setLngLat(p).setHTML(html).addTo(map);
}

/** Points picked on the map snap to the street when one is close, so locations are real. */
function snappedPos(p: LngLat, withinM: number): LngLat {
  const s = snapToGraph(S.graph, p);
  return s && s.distM <= withinM ? s.pos : p;
}

map.on('click', (e) => {
  if (!dataReady) return;
  const p: LngLat = [e.lngLat.lng, e.lngLat.lat];

  if (S.pick === 'adminDraw') {
    S.admin.drawPts.push(p);
    render(); refreshMap();
    return;
  }
  if (S.pick === 'adminSeg') {
    const s = snapToGraph(S.graph, p);
    if (!s || s.distM > 30) { flash('No street segment close to that click.'); return; }
    const edge = S.graph.edges[s.edgeId];
    S.admin.selectedEdge = s.edgeId;
    S.admin.segAttrs = {
      kind: edge.kind, surface: edge.surface, slopePct: edge.slopePct, steps: edge.steps, kerbRamp: edge.kerbRamp,
      tactile: edge.tactile, narrow: edge.narrow, name: edge.name ?? '',
    };
    S.pick = null;
    render(); refreshMap();
    return;
  }

  if (S.pick === 'start' || S.pick === 'end') {
    const which = S.pick;
    if (setRoutePoint(p, which)) { S.pick = which === 'start' && !S.end ? 'end' : null; recompute(); }
    return;
  }
  if (S.pick) {
    const snapM = S.pick === 'help' ? 0 : S.pick === 'obs' ? 60 : 50;
    if (S.pick === 'obs' && (snapToGraph(S.graph, p)?.distM ?? 999) > 60) { flash('Pick a spot on a street, where people walk.'); return; }
    S.pending = { kind: S.pick, pos: snapM ? snappedPos(p, snapM) : p };
    refreshMap();
    return;
  }

  // No pick active: popups on features, or quick start/end on the Route tab.
  const layers = S.tab === 'aid' ? ['requests', 'helpers'] : S.tab === 'route' || S.tab === 'report' || S.tab === 'priority' ? ['reports'] : [];
  const hit = layers.length ? map.queryRenderedFeatures(e.point, { layers })[0] : undefined;
  if (hit) {
    const pr = hit.properties as Record<string, string>;
    const html = hit.layer.id === 'reports' ? `<b>${esc(REPORT_LABEL[pr.type as ReportType])}</b>${pr.note ? `<br>${esc(pr.note)}` : ''}`
      : hit.layer.id === 'helpers' ? `<b>Helper: ${esc(pr.name)}</b><br>${esc(pr.skill)}` : `<b>${esc(pr.note)}</b><br>${esc(pr.place)}`;
    showPopup(p, html);
    return;
  }
  if (S.tab === 'route') {
    const which = !S.start ? 'start' : 'end';
    if (setRoutePoint(p, which)) recompute();
  }
});

/* ------------------------------------------------------------- confirm flow */

async function confirmPending() {
  const p = S.pending;
  if (!p) return;
  S.pending = null; S.pick = null;
  switch (p.kind) {
    case 'report':
      await S.reports.add({ pos: p.pos, type: S.reportType, note: S.reportNote });
      S.reportNote = '';
      recompute(false);
      flash('Report saved. Routes now avoid this spot.');
      return;
    case 'help': {
      const r = await S.aid.request(S.graph, p.pos, S.helpNote, S.me);
      S.helpNote = ''; S.selHelp = r.id;
      render(); refreshMap(); fitTo([r.pos, S.me]);
      flash(`Help request sent (simulated). ${r.notified} nearby helper${r.notified === 1 ? '' : 's'} notified.`);
      return;
    }
    case 'carpoolStart': S.cpDraft.start = { pos: p.pos, name: placeName(S.graph, p.pos) }; break;
    case 'carpoolEnd': S.cpDraft.end = { pos: p.pos, name: placeName(S.graph, p.pos) }; break;
    case 'obs': S.obsDraft.pos = { pos: p.pos, name: placeName(S.graph, p.pos) }; break;
  }
  render(); refreshMap();
}

function cancelPick() {
  S.pending = null; S.pick = null;
  render(); refreshMap();
}

/* ------------------------------------------------------------- admin actions */

async function addEdit(doc: object): Promise<GraphEdit & Doc> {
  const saved = await (edits as unknown as Col<Doc>).add(doc as never);
  return saved as GraphEdit & Doc;
}

async function afterEdit(msg: string) {
  rebuildGraph();
  S.pick = null;
  recompute(false);
  flash(msg);
}

function attrsOf(a: typeof S.admin.attrs): EdgeAttrs {
  return { kind: a.kind, surface: a.surface, slopePct: a.slopePct, steps: a.steps, kerbRamp: a.kerbRamp, tactile: a.tactile, narrow: a.narrow };
}

async function adminSave() {
  if (S.admin.drawPts.length < 2) return;
  const doc = await addEdit({ kind: 'add', coords: S.admin.drawPts, attrs: attrsOf(S.admin.attrs), name: S.admin.attrs.name || undefined });
  S.edits.push(doc);
  S.admin.drawPts = [];
  await afterEdit('Path added to the street network.');
}

async function adminSaveAttrs() {
  const edge = S.admin.selectedEdge !== null ? S.graph.edges[S.admin.selectedEdge] : null;
  if (!edge) return;
  const attrs = attrsOf(S.admin.segAttrs);
  if (edge.custom) {
    const id = edge.key.split('-')[1];
    const add = S.edits.find((e) => e.id === id && e.kind === 'add');
    if (add && add.kind === 'add') { add.attrs = attrs; await edits.patch(id, { attrs } as never); }
  } else {
    const doc = await addEdit({ kind: 'attr', key: edge.key, attrs });
    S.edits.push(doc);
  }
  await afterEdit('Segment attributes saved.');
}

async function adminRemove() {
  const edge = S.admin.selectedEdge !== null ? S.graph.edges[S.admin.selectedEdge] : null;
  if (!edge) return;
  if (edge.custom) {
    const id = edge.key.split('-')[1];
    await edits.remove(id);
    S.edits = S.edits.filter((e) => e.id !== id);
    await afterEdit('Admin path removed.');
  } else {
    const doc = await addEdit({ kind: 'remove', key: edge.key });
    S.edits.push(doc);
    await afterEdit('Segment removed from the network (undo it in the edit list).');
  }
}

/* ------------------------------------------------------------- side events */

side.addEventListener('click', async (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]');
  if (!el || (el as HTMLButtonElement).disabled) return;
  const idx = el.dataset.a!.indexOf(':');
  const a = idx < 0 ? el.dataset.a! : el.dataset.a!.slice(0, idx);
  const arg = idx < 0 ? '' : el.dataset.a!.slice(idx + 1);
  switch (a) {
    case 'tab': S.tab = arg as Tab; S.pick = S.pending = null; popup?.remove(); render(); refreshMap(); break;
    case 'profile': S.profile = arg as ProfileId; recompute(false); break;
    case 'pick': S.pick = S.pick === arg ? null : (arg as PickKind); S.pending = null; render(); refreshMap(); break;
    case 'confirm': await confirmPending(); break;
    case 'cancelPick': cancelPick(); break;
    case 'swap': [S.start, S.end] = [S.end, S.start]; recompute(false); break;
    case 'clear': S.start = S.end = null; recompute(false); break;
    case 'fromMe': S.start = snapToGraph(S.graph, S.me); recompute(); break;
    case 'realGps':
      navigator.geolocation?.getCurrentPosition(
        (pos) => {
          S.me = [pos.coords.longitude, pos.coords.latitude];
          localSet(`syagmap:me:${S.cfg.id}`, S.me);
          meMarker?.setLngLat(S.me);
          map.easeTo({ center: S.me });
          render(); refreshMap();
        },
        () => flash('Location permission denied or unavailable.'),
      );
      break;
    case 'batch': S.batch = runBatch(S.graph, S.profile, S.reports.all()); render(); break;
    case 'clearReports': await S.reports.clearMine(); recompute(false); break;

    case 'slot': S.heatSlot = arg as Slot | 'all'; render(); refreshMap(); break;
    case 'obsSubmit':
      if (S.obsDraft.pos) {
        await S.obs.add({ pos: S.obsDraft.pos.pos, count: S.obsDraft.count, slot: S.obsDraft.slot, observer: 'Township observer' });
        S.obsDraft.pos = null;
        render(); refreshMap();
        flash('Count saved. The heatmap now includes it.');
      }
      break;

    case 'selCp':
      S.selCarpool = S.selCarpool === arg ? null : arg;
      render(); refreshMap();
      { const c = S.carpool.all().find((x) => x.id === S.selCarpool); if (c) fitTo([c.start.pos, c.end.pos], 16.5); }
      break;
    case 'join': await S.carpool.join(arg, 'You'); render(); break;
    case 'say': {
      const input = document.getElementById('msg-' + arg) as HTMLInputElement | null;
      if (input) await S.carpool.say(arg, 'You', input.value);
      render();
      break;
    }
    case 'cpCreate':
      if (S.cpDraft.start && S.cpDraft.end) {
        await S.carpool.create(S.cpDraft.start, S.cpDraft.end, S.cpDraft.seats, 'You');
        S.cpDraft = { start: null, end: null, seats: 3 };
        S.selCarpool = S.carpool.all()[0]?.id ?? null;
        render(); refreshMap();
        flash('Ride offered.');
      }
      break;

    case 'selHelp': {
      S.selHelp = S.selHelp === arg ? null : arg;
      render(); refreshMap();
      const r = S.aid.requests.find((x) => x.id === S.selHelp);
      if (r) fitTo([r.pos, S.me, ...r.responders.map((x) => x.pos)], 16.5);
      break;
    }
    case 'offerHelp':
      await S.aid.offerHelp(arg, S.me);
      render(); refreshMap();
      flash('Thank you! Your location is shared with the person who needs help.');
      break;
    case 'helpHere': S.pick = 'help'; S.pending = { kind: 'help', pos: S.me }; render(); refreshMap(); break;

    case 'rank': {
      S.ranking_loading = true; render();
      const clusters = buildClusters(S.graph, S.reports.all(), S.obs.footfall(S.graph, true));
      S.ranking = await rank(S.cfg.name, clusters);
      S.ranking_loading = false;
      render(); refreshMap();
      fitTo(S.ranking.items.slice(0, 10).map((i) => i.cluster.pos), 16.5);
      break;
    }
    case 'focusPri': {
      const it = S.ranking?.items.find((i) => i.cluster.id === arg);
      if (it) { map.flyTo({ center: it.cluster.pos, zoom: 17.5 }); showPopup(it.cluster.pos, `<b>#${it.rank} ${esc(it.cluster.street)}</b><br>${esc(it.reason)}`); }
      break;
    }

    case 'adminSave': await adminSave(); break;
    case 'adminUndoPt': S.admin.drawPts.pop(); render(); refreshMap(); break;
    case 'adminCancel': S.pick = null; S.admin.drawPts = []; S.admin.selectedEdge = null; render(); refreshMap(); break;
    case 'adminSaveAttrs': await adminSaveAttrs(); break;
    case 'adminRemove': await adminRemove(); break;
    case 'delEdit': {
      await edits.remove(arg);
      S.edits = S.edits.filter((e) => e.id !== arg);
      await afterEdit('Edit undone.');
      break;
    }
  }
});

side.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  const b = el.dataset.bind;
  if (!b) return;
  if (b === 'reportNote') S.reportNote = el.value;
  else if (b === 'helpNote') S.helpNote = el.value;
  else if (b === 'obsCount') S.obsDraft.count = Math.max(0, Number(el.value) || 0);
  else if (b === 'cpSeats') S.cpDraft.seats = Math.min(6, Math.max(1, Number(el.value) || 1));
  else if (b.startsWith('adm:') && el.type !== 'checkbox' && el.tagName !== 'SELECT') setAdminAttr(b, el);
});

function setAdminAttr(bind: string, el: HTMLInputElement | HTMLSelectElement) {
  const [, scope, field] = bind.split(':');
  const target = (scope === 'new' ? S.admin.attrs : S.admin.segAttrs) as Record<string, unknown>;
  if (el instanceof HTMLInputElement && el.type === 'checkbox') target[field] = el.checked;
  else if (field === 'slopePct') target[field] = Math.max(0, Number(el.value) || 0);
  else target[field] = el.value;
}

side.addEventListener('change', (ev) => {
  const el = ev.target as HTMLInputElement & HTMLSelectElement;
  const b = el.dataset.bind;
  if (!b) return;
  if (b === 'township') void loadTownship(el.value);
  else if (b === 'reportType') { S.reportType = el.value as ReportType; renderBanner(); }
  else if (b === 'heatSim') { S.heatIncludeSim = el.checked; refreshMap(); }
  else if (b === 'obsSlot') S.obsDraft.slot = el.value as Slot;
  else if (b === 'helperReg') { S.aid.setMe({ registered: el.checked }); render(); refreshMap(); }
  else if (b === 'helperAvail') { S.aid.setMe({ available: el.checked }); render(); refreshMap(); }
  else if (b.startsWith('adm:')) setAdminAttr(b, el);
});

/** Expire help requests after 12h and keep countdowns fresh. */
setInterval(() => {
  if (!dataReady) return;
  if (S.aid.prune()) { render(); refreshMap(); return; }
  document.querySelectorAll<HTMLElement>('[data-expiry]').forEach((el) => {
    const r = S.aid.requests.find((x) => x.id === el.dataset.expiry);
    if (r) el.textContent = fmtRemaining(S.aid.remainingMs(r));
  });
}, 30_000);

confirmBar.addEventListener('click', async (ev) => {
  const a = (ev.target as HTMLElement).closest<HTMLElement>('[data-a]')?.dataset.a;
  if (a === 'confirm') await confirmPending();
  else if (a === 'cancelPick') cancelPick();
});

void loadTownship(S.cfg.id);
