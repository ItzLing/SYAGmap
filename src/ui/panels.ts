import { S, type Tab } from '../state';
import { HELP_TTL_HOURS, TOWNSHIPS } from '../config';
import { PROFILES, PROFILE_ORDER } from '../routing/profiles';
import { REPORT_LABEL, reportInfluence } from '../routing/engine';
import type { ReportType } from '../types';
import { SLOT_LABEL, type Slot } from '../store/stores';
import { dbOffline } from '../store/db';
import { distM } from '../geo';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

/** Walking speed assumptions (km/h) used only for the time estimate. UNVERIFIED. */
const SPEED_KMH = { walking: 4.8, wheelchair: 3.6, elderly: 3.0, stroller: 3.6, visual: 3.0 } as const;

export const REPORT_COLOR: Record<ReportType, string> = {
  blocked: '#dc2626', broken_pavement: '#ea580c', open_drain: '#2563eb', pole: '#7c3aed', no_ramp: '#0d9488', other: '#475569',
};

export const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
export function fmtRemaining(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m left`;
}
const ago = (t: number) => {
  const h = (Date.now() - t) / 3_600_000;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min ago` : h < 48 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} d ago`;
};

const simTag = '<span class="sim-tag">Simulated</span>';
const smallSim = '<span class="sim-tag">sim</span>';

function pickButton(label: string, active: boolean, a: string, primary = false) {
  return `<button class="${primary ? 'btn-primary' : 'btn'} w-full ${active ? 'ring-2 ring-red-400' : ''}" data-a="${a}">${active ? 'Now click the map…' : label}</button>`;
}

/* ------------------------------------------------------------------ route */

function routePanel(): string {
  const p = PROFILES[S.profile];
  const chips = PROFILE_ORDER.map((id) =>
    `<button class="chip" aria-pressed="${S.profile === id}" data-a="profile:${id}">${PROFILES[id].label}</button>`).join('')
    + '<button class="chip cursor-not-allowed opacity-50" disabled title="Roadmap: needs the road network">Driving (roadmap)</button>';

  const st = (k: 'start' | 'end', label: string, set: boolean) =>
    `<button class="btn flex-1 ${S.pick === k ? 'ring-2 ring-red-400' : ''}" data-a="pick:${k}">${S.pick === k ? 'Click the map…' : label}${set ? ' ✓' : ''}</button>`;

  let result = `<p class="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Pick a start and a destination. The map snaps both to real streets and compares the shortest route with one that suits <b>${p.label.toLowerCase()}</b> travel.</p>`;
  const r = S.result;
  if (r?.syag) {
    const s = r.syag;
    const mins = Math.max(1, Math.round((s.lengthM / 1000 / SPEED_KMH[S.profile]) * 60));
    const sb = r.shortest?.barrierEdges.length ?? 0;
    const barriers = s.barrierEdges.length;
    const list = barriers
      ? `<ul class="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-700">${s.barrierEdges.map((b) => `<li>${esc(b.labels.join(', '))}</li>`).join('')}</ul>` : '';
    result = `
      <section class="rounded-lg border border-slate-200 p-3" aria-live="polite">
        <div class="flex items-baseline justify-between">
          <h3 class="text-sm font-bold">SYAGmap route</h3>
          <span class="text-xs text-slate-500">${fmtDist(s.lengthM)} · ~${mins} min <span title="Speed assumption, unverified">(est.)</span></span>
        </div>
        <p class="mt-1 text-sm font-semibold ${barriers === 0 ? 'text-emerald-700' : 'text-amber-700'}">
          ${barriers === 0 ? '✔ No known barriers on this route' : `⚠ ${barriers} known barrier${barriers > 1 ? 's' : ''} on this route`}
        </p>
        ${s.streets.length ? `<p class="mt-1 text-xs text-slate-600">Via ${esc(s.streets.slice(0, 5).join(' → '))}${s.streets.length > 5 ? ' …' : ''}</p>` : ''}
        ${s.exposedShare > 0.05 ? `<p class="mt-1 text-xs text-slate-600">${Math.round(s.exposedShare * 100)}% of this route is on roads with no mapped footpath.</p>` : ''}
        ${s.relaxed ? '<p class="mt-1 rounded bg-amber-50 p-2 text-xs text-amber-900">No barrier-free route exists right now. This is the least-bad option.</p>' : ''}
        ${list}
        <div class="mt-3 border-t border-slate-200 pt-2 text-xs text-slate-600">
          <b>Shortest route</b> (dashed grey): ${r.shortest ? fmtDist(r.shortest.lengthM) : '-'}, <b class="${sb ? 'text-red-700' : ''}">${sb} known barrier${sb === 1 ? '' : 's'}</b> for ${p.label.toLowerCase()}.
        </div>
      </section>`;
  } else if (S.start && S.end) {
    result = '<p class="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">No walking route found between these points in the loaded area.</p>';
  }

  const b = S.batch;
  const metric = b
    ? `<div class="mt-2 text-sm">
         <div class="flex justify-between"><span>Shortest route</span><b>${pct(b.shortestBarrierFree, b.trips)}%</b></div>
         <div class="flex justify-between"><span>SYAGmap route</span><b class="text-emerald-700">${pct(b.syagBarrierFree, b.trips)}%</b></div>
         <p class="mt-1 text-xs text-slate-500">${b.trips} random trips for ${p.label.toLowerCase()} · ${pct(b.noAccessibleRoute, b.trips)}% had no barrier-free route at all.</p>
       </div>` : '';

  const st2 = S.graph.meta.stats;
  return `
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Who is travelling?</h2>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Travel profile">${chips}</div>
      <p class="mt-2 text-xs text-slate-500">${esc(p.hint)}</p></div>
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Trip</h2>
      <div class="flex gap-2">${st('start', 'Set start', !!S.start)}${st('end', 'Set destination', !!S.end)}</div>
      <div class="mt-2 flex gap-2">
        <button class="btn flex-1" data-a="fromMe">Start from my location</button>
        <button class="btn" data-a="swap">Swap</button>
        <button class="btn" data-a="clear">Clear</button>
      </div>
      <p class="mt-1 text-xs text-slate-500">Your location is simulated: drag the blue <b>You</b> dot, or <button class="underline" data-a="realGps">use real GPS</button>.</p></div>
    ${result}
    <section class="rounded-lg border border-slate-200 p-3">
      <div class="flex items-center justify-between"><h3 class="text-sm font-bold">Test metric: barrier-free trips</h3>${simTag}</div>
      <p class="text-xs text-slate-500">Share of random trips with zero known barriers.</p>
      ${metric}
      <button class="btn mt-2 w-full" data-a="batch">Run 200 simulated trips</button>
    </section>
    <p class="text-xs text-slate-500">Street data: ${esc(S.graph.meta.source)} (${st2.edges} segments).
      OSM has few accessibility tags here (tactile paving: ${st2.tactileEdges}, steps: ${st2.stepsEdges}, kerb tags: ${st2.kerbTaggedEdges}),
      so reports and the Admin tab fill the gap.</p>`;
}

/* ----------------------------------------------------------------- report */

function reportPanel(): string {
  const types = (Object.keys(REPORT_LABEL) as ReportType[]).map((t) =>
    `<option value="${t}" ${t === S.reportType ? 'selected' : ''}>${REPORT_LABEL[t]}</option>`).join('');
  const all = S.reports.all();
  const now = Date.now();
  const rows = [...all].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6).map((r) => {
    const infl = reportInfluence(r, now);
    return `<li class="flex items-start gap-2 text-xs"><span class="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full" style="background:${REPORT_COLOR[r.type]}"></span>
      <span><b>${REPORT_LABEL[r.type]}</b>${r.simulated ? ` ${smallSim}` : ''}<br><span class="text-slate-500">${new Date(r.createdAt).toLocaleString()} · influence ${(infl * 100).toFixed(0)}%</span></span></li>`;
  }).join('');
  return `
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Report a problem</h2>
      <label class="block text-xs font-medium text-slate-600">Problem
        <select data-bind="reportType" class="field mt-1">${types}</select></label>
      <label class="mt-2 block text-xs font-medium text-slate-600">Note (optional)
        <input data-bind="reportNote" value="${esc(S.reportNote)}" maxlength="120" class="field mt-1" placeholder="e.g. car parked on the footpath"></label>
      <div class="mt-3">${pickButton('Place report on map', S.pick === 'report', 'pick:report', true)}</div>
      <p class="mt-2 text-xs text-slate-500">Each report stores <b>location, problem, date/time</b>. Reports raise the cost of that street for everyone's routes and fade over time unless re-reported.</p></div>
    <div><h3 class="mb-2 text-sm font-bold">Latest reports (${all.length})</h3><ul class="space-y-2">${rows}</ul>
      <button class="btn mt-3 w-full" data-a="clearReports" ${S.reports.countMine() ? '' : 'disabled'}>Clear my reports (${S.reports.countMine()})</button></div>`;
}

/* ---------------------------------------------------------------- heatmap */

function heatPanel(): string {
  const slots: (Slot | 'all')[] = ['all', 'morning', 'midday', 'evening'];
  const chips = slots.map((s) =>
    `<button class="chip" aria-pressed="${S.heatSlot === s}" data-a="slot:${s}">${s === 'all' ? 'All day' : SLOT_LABEL[s]}</button>`).join('');
  const c = S.obs.counts();
  const d = S.obsDraft;
  return `
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Pedestrian activity</h2>
      <div class="flex flex-wrap gap-2" role="group" aria-label="Time of day">${chips}</div>
      <label class="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" data-bind="heatSim" ${S.heatIncludeSim ? 'checked' : ''}> Include simulated counts</label>
      <div class="mt-2 h-2 rounded" style="background:linear-gradient(90deg,#2b83ba,#abdda4,#ffffbf,#fdae61,#d7191c)"></div>
      <div class="flex justify-between text-[10px] text-slate-500"><span>fewer people</span><span>more people</span></div></div>
    <section class="rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
      <h3 class="text-sm font-bold">Where does this data come from?</h3>
      <ul class="mt-1 list-disc space-y-1 pl-5">
        <li><b>Township observers</b> (security, community staff, volunteers) count how many people walk past a spot in 5 minutes, in three time slots. Each count is snapped to the real street it was taken on.</li>
        <li>Real counts logged here: <b>${c.real}</b>. Simulated counts: <b>${c.simulated}</b> ${simTag}</li>
        <li>Roadmap: anonymous, opt-in trip logs from app users would add to this (not built).</li>
      </ul></section>
    <section class="rounded-lg border border-slate-200 p-3">
      <h3 class="text-sm font-bold">Log a count (township observer)</h3>
      <div class="mt-2">${pickButton(d.pos ? '✓ Location set (tap to change)' : '1. Pick the spot on the map', S.pick === 'obs', 'pick:obs')}</div>
      ${d.pos ? `<p class="mt-1 text-xs text-slate-600">${esc(d.pos.name)}</p>` : ''}
      <div class="mt-2 grid grid-cols-2 gap-2">
        <label class="text-xs font-medium text-slate-600">Time slot
          <select data-bind="obsSlot" class="field mt-1">${(Object.keys(SLOT_LABEL) as Slot[]).map((s) => `<option value="${s}" ${d.slot === s ? 'selected' : ''}>${SLOT_LABEL[s]}</option>`).join('')}</select></label>
        <label class="text-xs font-medium text-slate-600">People in 5 min
          <input type="number" min="0" max="999" data-bind="obsCount" value="${d.count}" class="field mt-1"></label>
      </div>
      <button class="btn-primary mt-3 w-full" data-a="obsSubmit" ${d.pos ? '' : 'disabled'}>2. Save count</button>
    </section>`;
}

/* ---------------------------------------------------------------- carpool */

function placeLine(label: string, color: string, name: string) {
  return `<div class="flex items-center gap-2 text-xs"><span class="inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style="background:${color}">${label}</span>${esc(name)}</div>`;
}

function carpoolPanel(): string {
  const list = S.carpool.all().map((c) => {
    const sel = S.selCarpool === c.id;
    const full = c.users.length >= c.seats + 1;
    return `
    <li class="rounded-lg border ${sel ? 'border-red-600 ring-1 ring-red-600' : 'border-slate-200'} p-2 text-sm">
      <button class="block w-full text-left" data-a="selCp:${c.id}" aria-expanded="${sel}">
        <div class="flex items-center justify-between"><b>${esc(c.start.name)} → ${esc(c.end.name)}</b>${c.simulated ? smallSim : ''}</div>
        <div class="text-xs text-slate-500">${c.users.length}/${c.seats + 1} riders · ${esc(c.users.join(', '))}</div>
      </button>
      ${sel ? `
        <div class="mt-2 space-y-1 border-t border-slate-200 pt-2">
          ${placeLine('A', '#16a34a', c.start.name)}${placeLine('B', '#0f172a', c.end.name)}
          <p class="text-xs text-slate-500">Distance A to B: ${fmtDist(distM(c.start.pos, c.end.pos))} (straight line). Shown on the map.</p>
          <div class="max-h-24 overflow-y-auto text-xs">${c.messages.map((m) => `<div><b>${esc(m.who)}:</b> ${esc(m.text)}</div>`).join('') || '<i class="text-slate-400">No messages yet</i>'}</div>
          <div class="flex gap-1"><input id="msg-${c.id}" class="field !py-1" maxlength="100" placeholder="Message" aria-label="Chat message">
            <button class="btn !py-1" data-a="say:${c.id}">Send</button>
            <button class="btn !py-1" data-a="join:${c.id}" ${full || c.users.includes('You') ? 'disabled' : ''}>${c.users.includes('You') ? 'Joined' : full ? 'Full' : 'Join'}</button></div>
        </div>` : ''}
    </li>`;
  }).join('');

  const d = S.cpDraft;
  const slot = (label: string, kind: 'carpoolStart' | 'carpoolEnd', p: typeof d.start, color: string, tag: string) => `
    <div class="flex items-center gap-2">
      <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white" style="background:${color}">${tag}</span>
      <div class="min-w-0 flex-1"><button class="btn w-full truncate ${S.pick === kind ? 'ring-2 ring-red-400' : ''}" data-a="pick:${kind}">${S.pick === kind ? 'Click the map…' : p ? esc(p.name) : label}</button></div>
    </div>`;
  return `
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Rides near you ${simTag}</h2>
      <ul class="space-y-2">${list}</ul>
      <p class="mt-2 text-xs text-slate-500">Tap a ride to see its start and end on the map.</p></div>
    <section class="rounded-lg border border-slate-200 p-3">
      <h3 class="text-sm font-bold">Offer a ride</h3>
      <div class="mt-2 space-y-2">
        ${slot('Pick start on map', 'carpoolStart', d.start, '#16a34a', 'A')}
        ${slot('Pick end on map', 'carpoolEnd', d.end, '#0f172a', 'B')}
        <label class="block text-xs font-medium text-slate-600">Free seats
          <input type="number" min="1" max="6" data-bind="cpSeats" value="${d.seats}" class="field mt-1"></label>
        <button class="btn-primary w-full" data-a="cpCreate" ${d.start && d.end ? '' : 'disabled'}>Offer this ride</button>
      </div></section>`;
}

/* -------------------------------------------------------------- first aid */

function aidPanel(): string {
  const me = S.aid.me;
  const now = Date.now();
  const reqs = S.aid.requests.map((r) => {
    const sel = S.selHelp === r.id;
    const dMe = distM(S.me, r.pos);
    const could = me.registered && me.available && !r.responders.some((x) => x.name === 'You') && r.requester !== 'You';
    return `
    <li class="rounded-lg border ${sel ? 'border-rose-600 ring-1 ring-rose-600' : 'border-rose-200'} bg-rose-50 p-2 text-xs">
      <button class="block w-full text-left" data-a="selHelp:${r.id}" aria-expanded="${sel}">
        <div class="flex items-center justify-between"><b class="text-sm">${esc(r.note)}</b>${r.simulated ? smallSim : ''}</div>
        <div class="text-slate-600">${esc(r.place)} · ${ago(r.createdAt)} · <span data-expiry="${r.id}" class="font-semibold">${fmtRemaining(S.aid.remainingMs(r, now))}</span></div>
        <div class="${r.responders.length ? 'font-semibold text-emerald-700' : 'text-slate-500'}">${r.responders.length ? `✔ ${r.responders.length} helper${r.responders.length > 1 ? 's' : ''} on the way` : `${r.notified} helper${r.notified === 1 ? '' : 's'} notified, none on the way yet`}</div>
      </button>
      ${sel ? `
        <div class="mt-2 space-y-1 border-t border-rose-200 pt-2">
          ${placeLine('!', '#e11d48', `Help needed: ${r.place}`)}
          ${placeLine('Y', '#2563eb', `You: ${fmtDist(dMe)} away (simulated location)`)}
          ${r.responders.map((x, i) => placeLine(String(i + 1), '#16a34a', `${x.name} (${x.skill}): ${fmtDist(distM(x.pos, r.pos))} from the patient`)).join('')}
          ${could ? `<button class="btn-primary mt-1 w-full" data-a="offerHelp:${r.id}">I can help (share my location)</button>`
            : !me.registered ? '<p class="text-slate-500">Register as a helper to offer help.</p>' : !me.available ? '<p class="text-slate-500">Set yourself available to offer help.</p>' : ''}
        </div>` : ''}
    </li>`;
  }).join('');

  return `
    <section class="rounded-lg border border-slate-200 p-3">
      <h3 class="text-sm font-bold">I am a first-aid helper ${simTag}</h3>
      <div class="mt-2 space-y-2">
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" data-bind="helperReg" ${me.registered ? 'checked' : ''}> Registered helper</label>
        <label class="flex items-center gap-2 text-sm ${me.registered ? '' : 'opacity-50'}"><input type="checkbox" data-bind="helperAvail" ${me.available ? 'checked' : ''} ${me.registered ? '' : 'disabled'}> Available now</label>
        <p class="text-xs text-slate-500">Your location is simulated: drag the blue <b>You</b> dot on the map.</p>
      </div></section>
    <section class="rounded-lg border border-slate-200 p-3">
      <h3 class="text-sm font-bold">Need help?</h3>
      <input data-bind="helpNote" value="${esc(S.helpNote)}" maxlength="100" class="field mt-2" placeholder="What happened? (optional)" aria-label="Help request note">
      <div class="mt-2 grid grid-cols-2 gap-2">
        ${pickButton('Pick location', S.pick === 'help', 'pick:help', true)}
        <button class="btn" data-a="helpHere">At my location</button>
      </div>
      <p class="mt-1 text-xs text-slate-500">You will be asked to confirm the location before anything is sent. Requests expire after ${HELP_TTL_HOURS} hours.</p></section>
    <div><h3 class="mb-2 text-sm font-bold">Open requests (${S.aid.requests.length})</h3>
      <ul class="space-y-2">${reqs || '<li class="text-xs text-slate-400">No open requests</li>'}</ul>
      <p class="mt-2 text-xs text-slate-500">Tap a request to see where help is needed, who is coming, and where you are. Green dots are available helpers.</p></div>`;
}

/* --------------------------------------------------------------- priority */

function priorityPanel(): string {
  const rk = S.ranking;
  const items = rk ? rk.items.map((it) => `
    <li class="rounded-lg border border-slate-200 p-2 text-xs">
      <button class="block w-full text-left" data-a="focusPri:${it.cluster.id}">
        <div class="flex items-center gap-2"><span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-700 text-xs font-bold text-white">${it.rank}</span>
          <b class="text-sm">${esc(it.cluster.street)}</b><span class="ml-auto text-slate-500">${it.cluster.reportCount} report${it.cluster.reportCount > 1 ? 's' : ''}</span></div>
        <p class="mt-1 text-slate-700">${esc(it.reason)}</p>
        ${it.action ? `<p class="mt-1 font-semibold text-slate-800">Suggested: ${esc(it.action)}</p>` : ''}
      </button></li>`).join('') : '';
  return `
    <div><h2 class="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">What should we fix first?</h2>
      <p class="text-xs text-slate-600">Combines user reports (severity, how recent, how many) with township-observer footfall, then asks Claude to rank the problem spots. Only street names, problem types and counts are sent, never personal data.</p>
      <button class="btn-primary mt-3 w-full" data-a="rank" ${S.ranking_loading ? 'disabled' : ''}>${S.ranking_loading ? 'Ranking…' : rk ? 'Re-rank' : 'Rank problems'}</button></div>
    ${rk ? `
      <section class="rounded-lg bg-slate-50 p-3 text-xs">
        <div class="mb-1"><span class="rounded px-1.5 py-0.5 font-bold ${rk.source === 'claude' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}">${rk.source === 'claude' ? `AI: ${esc(rk.model ?? 'Claude')}` : 'Rule-based'}</span></div>
        ${rk.note ? `<p class="mb-1 text-amber-800">${esc(rk.note)}</p>` : ''}
        <p>${esc(rk.summary)}</p></section>
      <ol class="space-y-2">${items || '<li class="text-xs text-slate-400">No reports to rank yet.</li>'}</ol>` : ''}`;
}

/* ------------------------------------------------------------------ admin */

function attrForm(scope: 'new' | 'seg', a: typeof S.admin.attrs, withName: boolean) {
  const k = (f: string) => `data-bind="adm:${scope}:${f}"`;
  return `
    <div class="mt-2 grid grid-cols-2 gap-2 text-xs">
      ${withName ? `<label class="col-span-2 font-medium text-slate-600">Name<input ${k('name')} value="${esc(a.name)}" class="field mt-1" placeholder="Street or path name"></label>` : ''}
      <label class="font-medium text-slate-600">Type<select ${k('kind')} class="field mt-1">
        ${['footpath', 'crossing', 'skybridge'].map((x) => `<option ${a.kind === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="font-medium text-slate-600">Surface<select ${k('surface')} class="field mt-1">
        ${['good', 'rough', 'broken'].map((x) => `<option ${a.surface === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="font-medium text-slate-600">Slope %<input type="number" min="0" max="30" ${k('slopePct')} value="${a.slopePct}" class="field mt-1"></label>
      <div class="space-y-1 pt-5">
        <label class="flex items-center gap-1"><input type="checkbox" ${k('steps')} ${a.steps ? 'checked' : ''}> Has steps</label>
        <label class="flex items-center gap-1"><input type="checkbox" ${k('tactile')} ${a.tactile ? 'checked' : ''}> Tactile paving</label>
        <label class="flex items-center gap-1"><input type="checkbox" ${k('kerbRamp')} ${a.kerbRamp ? 'checked' : ''}> Kerb ramp</label>
        <label class="flex items-center gap-1"><input type="checkbox" ${k('narrow')} ${a.narrow ? 'checked' : ''}> Narrow</label>
      </div>
    </div>`;
}

function adminPanel(): string {
  const st = S.graph.meta.stats;
  const drawing = S.pick === 'adminDraw';
  const selecting = S.pick === 'adminSeg';
  const sel = S.admin.selectedEdge !== null ? S.graph.edges[S.admin.selectedEdge] : null;
  const edits = S.edits.map((e) => `
    <li class="flex items-center justify-between gap-2 text-xs"><span>${e.kind === 'add' ? `Added path (${e.coords.length} points)` : e.kind === 'remove' ? `Removed ${esc(e.key)}` : `Attributes on ${esc(e.key)}`}</span>
      <button class="btn !px-2 !py-0.5 text-xs" data-a="delEdit:${e.id}">Undo</button></li>`).join('');
  return `
    <div class="rounded-lg bg-amber-50 p-3 text-xs text-amber-900"><b>Admin tools</b> (prototype, no login). Use these when OpenStreetMap is wrong or missing: add a real path, remove one that does not exist, or tag steps, ramps and tactile paving. Edits are saved in the JSON database and re-applied on top of the OSM download.</div>
    <section class="rounded-lg border border-slate-200 p-3 text-xs text-slate-700">
      <h3 class="text-sm font-bold">Street data</h3>
      <p>${esc(S.graph.meta.source)}<br>Downloaded ${new Date(S.graph.meta.fetchedAt).toLocaleDateString()} · ${st.edges} segments (${st.roadEdges} road, ${st.footpathEdges} footpath), ${st.crossings} crossings, ${st.skybridges} bridges.</p>
      <p class="mt-1">Mapped accessibility tags: tactile ${st.tactileEdges}, steps ${st.stepsEdges}, kerb ${st.kerbTaggedEdges}. <b>Very sparse</b>, which is the gap SYAGmap fills.</p>
      <p class="mt-1">Refresh from OSM: run <code>npm run fetch-osm ${esc(S.cfg.id)}</code></p></section>
    <section class="rounded-lg border border-slate-200 p-3">
      <h3 class="text-sm font-bold">Draw a new path</h3>
      ${drawing ? `
        <p class="mt-1 text-xs text-slate-600">Click along the path. Points within 20 m of an existing junction connect to it. <b>${S.admin.drawPts.length}</b> point(s).</p>
        ${attrForm('new', S.admin.attrs, true)}
        <div class="mt-2 grid grid-cols-3 gap-2"><button class="btn-primary" data-a="adminSave" ${S.admin.drawPts.length < 2 ? 'disabled' : ''}>Save</button>
          <button class="btn" data-a="adminUndoPt" ${S.admin.drawPts.length ? '' : 'disabled'}>Undo pt</button><button class="btn" data-a="adminCancel">Cancel</button></div>`
        : '<button class="btn mt-2 w-full" data-a="pick:adminDraw">Start drawing</button>'}
    </section>
    <section class="rounded-lg border border-slate-200 p-3">
      <h3 class="text-sm font-bold">Edit or remove a segment</h3>
      ${selecting && !sel ? '<p class="mt-1 text-xs text-slate-600">Click a street segment on the map.</p>' : ''}
      ${sel ? `
        <p class="mt-1 text-xs text-slate-600"><b>${esc(sel.name ?? '(unnamed)')}</b> · ${esc(sel.hw)} · ${fmtDist(sel.lengthM)}${sel.custom ? ' · admin path' : ''}</p>
        ${attrForm('seg', S.admin.segAttrs, false)}
        <div class="mt-2 grid grid-cols-3 gap-2"><button class="btn-primary" data-a="adminSaveAttrs">Save</button>
          <button class="btn" data-a="adminRemove">Remove</button><button class="btn" data-a="adminCancel">Close</button></div>`
        : (!selecting ? '<button class="btn mt-2 w-full" data-a="pick:adminSeg">Select a segment</button>' : '')}
    </section>
    <div><h3 class="mb-2 text-sm font-bold">Admin edits (${S.edits.length})</h3><ul class="space-y-1">${edits || '<li class="text-xs text-slate-400">None yet</li>'}</ul></div>`;
}

/* ------------------------------------------------------------------- shell */

const TABS: [Tab, string][] = [
  ['route', 'Route'], ['report', 'Report'], ['heat', 'Heatmap'], ['carpool', 'Carpool'], ['aid', 'First Aid'], ['priority', 'Priorities'], ['admin', 'Admin'],
];

export function renderSide(): string {
  const tab = (t: Tab, label: string) =>
    `<button role="tab" aria-selected="${S.tab === t}" data-a="tab:${t}" class="shrink-0 border-b-2 px-3 py-2.5 text-sm font-semibold ${S.tab === t ? 'border-red-700 text-red-700' : 'border-transparent text-slate-500 hover:text-slate-900'}">${label}</button>`;
  let body = '';
  if (S.loading) body = '<p class="text-sm text-slate-500">Loading street data…</p>';
  else if (S.loadError) body = `<p class="rounded-lg bg-red-50 p-3 text-sm text-red-800">${esc(S.loadError)}</p>`;
  else {
    body = { route: routePanel, report: reportPanel, heat: heatPanel, carpool: carpoolPanel, aid: aidPanel, priority: priorityPanel, admin: adminPanel }[S.tab]();
  }
  return `
    <header class="border-b border-slate-200 px-4 py-3">
      <div class="flex items-center justify-between gap-2">
        <h1 class="text-lg font-extrabold tracking-tight text-red-700">SYAGmap</h1>
        <span class="sim-tag" title="Reports, counts, carpools and helpers are partly simulated in this prototype">Partly simulated</span>
      </div>
      <p class="text-xs text-slate-500">Walking that works for everyone${dbOffline ? ' · <b class="text-amber-700">offline: saving in this browser only</b>' : ''}</p>
      <label class="mt-2 block text-xs font-medium text-slate-600">Township
        <select data-bind="township" class="field mt-1">
          ${TOWNSHIPS.map((t) => `<option value="${t.id}" ${t.id === S.cfg.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select></label>
    </header>
    <div role="tablist" class="flex overflow-x-auto border-b border-slate-200">${TABS.map(([t, l]) => tab(t, l)).join('')}</div>
    <div class="flex-1 space-y-4 p-4">${body}</div>
    ${S.toast ? `<div role="status" class="sticky bottom-0 bg-slate-900 px-4 py-2 text-sm text-white">${esc(S.toast)}</div>` : ''}`;
}
