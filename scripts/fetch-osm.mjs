// Builds a real pedestrian graph for each township from OpenStreetMap (Overpass API).
// Usage: node scripts/fetch-osm.mjs [townshipId ...]
// Output: public/data/townships/<id>.json  (ODbL: (c) OpenStreetMap contributors)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const townships = JSON.parse(readFileSync('src/townships.json', 'utf8'));
const only = process.argv.slice(2);
const ENDPOINT = 'https://overpass-api.de/api/interpreter';

const WALK_HW = new Set(['footway', 'path', 'pedestrian', 'steps', 'living_street', 'residential', 'service',
  'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link',
  'cycleway', 'track', 'trunk', 'trunk_link']);
const ROAD_HW = new Set(['living_street', 'residential', 'service', 'unclassified', 'tertiary', 'tertiary_link',
  'secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link', 'track']);
const PATH_HW = new Set(['footway', 'path', 'pedestrian', 'cycleway', 'steps']);

const M_LAT = 111320;
const dist = (a, b) => {
  const k = M_LAT * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
  return Math.hypot((a[0] - b[0]) * k, (a[1] - b[1]) * M_LAT);
};
const polyLen = (g) => g.reduce((s, p, i) => (i ? s + dist(g[i - 1], p) : 0), 0);

function allowed(t) {
  if (!WALK_HW.has(t.highway)) return false;
  if (t.foot === 'no' || t.access === 'no' || t.access === 'private') {
    if (t.foot !== 'yes' && t.foot !== 'designated') return false;
  }
  if (t.highway === 'service' && (t.service === 'driveway' || t.service === 'parking_aisle')) return false;
  if ((t.highway === 'trunk' || t.highway === 'trunk_link') && t.foot !== 'yes') return false;
  return true;
}

function surfaceOf(t) {
  const sm = t.smoothness;
  if (['very_bad', 'horrible', 'very_horrible', 'impassable'].includes(sm)) return 'broken';
  if (sm === 'bad' || sm === 'intermediate') return 'rough';
  const s = t.surface;
  if (!s) return 'good';
  if (['asphalt', 'concrete', 'paved', 'paving_stones', 'concrete:plates', 'concrete:lanes', 'sett', 'bricks', 'metal', 'wood'].includes(s)) return 'good';
  if (['compacted', 'fine_gravel', 'gravel', 'ground', 'dirt', 'earth', 'grass', 'sand', 'unpaved', 'mud', 'pebblestone', 'cobblestone', 'unhewn_cobblestone'].includes(s)) return 'rough';
  return 'good';
}

function inclineOf(t) {
  const m = /^(-?\d+(\.\d+)?)\s*%?$/.exec(t.incline ?? '');
  return m ? Math.abs(parseFloat(m[1])) : 0;
}

const hasSidewalk = (t) =>
  ['sidewalk', 'sidewalk:left', 'sidewalk:right', 'sidewalk:both'].some((k) => t[k] && !['no', 'none'].includes(t[k]));

async function overpass(q) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': 'SYAGmap-hackathon/0.1 (student prototype)',
      },
      body: 'data=' + encodeURIComponent(q),
    });
    if (r.ok) return r.json();
    console.warn(`  Overpass HTTP ${r.status}, retry ${attempt}`);
    await new Promise((res) => setTimeout(res, 5000 * attempt));
  }
  throw new Error('Overpass failed');
}

async function build(tw) {
  const dLat = tw.radiusM / M_LAT;
  const dLng = tw.radiusM / (M_LAT * Math.cos((tw.center[1] * Math.PI) / 180));
  const bbox = [tw.center[1] - dLat, tw.center[0] - dLng, tw.center[1] + dLat, tw.center[0] + dLng];
  const q = `[out:json][timeout:90];(way["highway"](${bbox.join(',')}););(._;>;);out body;`;
  console.log(`${tw.id}: querying Overpass...`);
  const data = await overpass(q);

  const nodeById = new Map();
  const ways = [];
  for (const el of data.elements) {
    if (el.type === 'node') nodeById.set(el.id, el);
    else if (el.type === 'way' && allowed(el.tags ?? {})) ways.push(el);
  }

  const use = new Map();
  for (const w of ways) for (const n of w.nodes) use.set(n, (use.get(n) ?? 0) + 1);

  const nodes = [];
  const idxOf = new Map();
  const nid = (osmId) => {
    if (!idxOf.has(osmId)) {
      const n = nodeById.get(osmId);
      idxOf.set(osmId, nodes.length);
      nodes.push([+n.lon.toFixed(6), +n.lat.toFixed(6)]);
    }
    return idxOf.get(osmId);
  };

  const edges = [];
  let kerbNodes = 0;
  for (const w of ways) {
    const t = w.tags;
    let seg = [w.nodes[0]];
    let part = 0;
    const flush = () => {
      if (seg.length < 2) return;
      const geom = seg.map((id) => {
        const n = nodeById.get(id);
        return [+n.lon.toFixed(6), +n.lat.toFixed(6)];
      });
      const endTags = [nodeById.get(seg[0])?.tags ?? {}, nodeById.get(seg[seg.length - 1])?.tags ?? {}];
      const isCrossing = t.footway === 'crossing' || t.cycleway === 'crossing' || (t.highway === 'footway' && t.crossing);
      const isBridgeWalk = t.bridge && PATH_HW.has(t.highway) && t.highway !== 'steps';
      const kind = isCrossing ? 'crossing' : isBridgeWalk ? 'skybridge' : 'footpath';
      const tactile = t.tactile_paving === 'yes' || endTags.some((x) => x.tactile_paving === 'yes');
      const kerbs = endTags.map((x) => x.kerb).filter(Boolean);
      if (kerbs.length) kerbNodes++;
      const wd = parseFloat(t.width);
      edges.push({
        k: `w${w.id}-${part++}`,
        a: nid(seg[0]),
        b: nid(seg[seg.length - 1]),
        g: geom,
        len: +polyLen(geom).toFixed(1),
        kind,
        hw: t.highway,
        name: t.name ?? t['name:en'] ?? null,
        surface: surfaceOf(t),
        slope: inclineOf(t),
        steps: t.highway === 'steps',
        ramp: !kerbs.includes('raised'),
        tactile,
        narrow: Number.isFinite(wd) && wd < 1.2 && PATH_HW.has(t.highway),
        exposed: ROAD_HW.has(t.highway) && !hasSidewalk(t),
        covered: t.covered === 'yes' || t.tunnel === 'building_passage',
      });
      seg = [seg[seg.length - 1]];
    };
    for (let i = 1; i < w.nodes.length; i++) {
      seg.push(w.nodes[i]);
      if (use.get(w.nodes[i]) > 1 && i < w.nodes.length - 1) flush();
    }
    flush();
  }

  const stats = {
    edges: edges.length,
    nodes: nodes.length,
    roadEdges: edges.filter((e) => ROAD_HW.has(e.hw)).length,
    footpathEdges: edges.filter((e) => PATH_HW.has(e.hw) && e.kind === 'footpath').length,
    crossings: edges.filter((e) => e.kind === 'crossing').length,
    skybridges: edges.filter((e) => e.kind === 'skybridge').length,
    stepsEdges: edges.filter((e) => e.steps).length,
    tactileEdges: edges.filter((e) => e.tactile).length,
    roadsWithSidewalkTag: edges.filter((e) => ROAD_HW.has(e.hw) && !e.exposed).length,
    namedEdges: edges.filter((e) => e.name).length,
    roughOrBroken: edges.filter((e) => e.surface !== 'good').length,
    withIncline: edges.filter((e) => e.slope > 0).length,
    kerbTaggedEdges: kerbNodes,
  };
  const out = {
    township: tw.id,
    fetchedAt: new Date().toISOString(),
    source: 'OpenStreetMap contributors via Overpass API (ODbL)',
    bbox,
    stats,
    nodes,
    edges,
  };
  mkdirSync('public/data/townships', { recursive: true });
  writeFileSync(`public/data/townships/${tw.id}.json`, JSON.stringify(out));
  console.log(`  ${tw.id}:`, JSON.stringify(stats));
}

for (const tw of townships) {
  if (only.length && !only.includes(tw.id)) continue;
  await build(tw);
  await new Promise((r) => setTimeout(r, 3000));
}
