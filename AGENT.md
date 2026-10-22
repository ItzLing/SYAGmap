# AGENT.md - SYAGmap progress notes

Last updated: 2026-10-22. Read this first when picking the project up.

## What this is
- SYAGmap: accessible walking routes + crowdsourced footpath reports for **any** SDP township.
- Entry for the Sime Darby Property University Hackathon 2026, "Township of Tomorrow", Theme 1 PEOPLE. Team SYAG (lead: Ling).
- Judges score six dimensions together: Relevant, Impactful (measurable), Innovative, Feasible, Scalable, Evidence-based.
- Organiser guidance: find ONE meaningful problem, do not redesign a township, validate with residents, Observe -> Identify -> Understand -> Create -> Build.

## Decisions already made (do not reopen)
- Township-agnostic. Elmina is only a demo area. No township-specific hardcoding.
- Own app on an OpenStreetMap-based map. Not a Google Maps add-on.
- Real-time traffic lights: problem statement only, NOT in the app.
- Core (working): accessible routing per profile, crowdsourced condition reports `<location, problem, datetime>`.
- Roadmap features, visible in the app: heatmap, carpool, first-aid helpers (requests expire after 12 h).
- Database: NoSQL, local JSON files.
- Assumed asset owners: SDP and JKR/local council (UNCONFIRMED).
- Resident interviews are planned for later, not done yet.

## Working style the user wants
- Small steps, short point-form answers. User writes their own prose; check it, do not hand over finished drafts.
- Mark anything uncertain. Never invent statistics. Cite sources.
- Ask before changing scope (especially the three roadmap features).
- Commit and push only when asked. The checkout may be on branch `ling`; `main` is what gets pushed (`git push origin ling:main` if needed).

## Task tracker (from the original brief)
| # | Task | Status |
|---|---|---|
| 1 | Brief summary + questions for organiser | Done |
| 2 | Score vs six dimensions, competitor research | Done (scores below) |
| 3 | Split: core / roadmap-in-app / roadmap slide + ONE Test metric | Not written up. Built in practice; Test metric = barrier-free trip rate. Needs user approval |
| 4 | OSM coverage check + walk-audit plan | Partly: coverage stats exist (below). Walk-audit plan not written |
| 5 | Tech comparison (map lib, algorithm, DB) | Not done. Chose MapLibre, weighted Dijkstra, local JSON DB for speed |
| 6 | Resident validation plan (survey, 5-10 interviews, observation checklist) | Not started |
| 7 | Prototype, then pitch structure mapped to six dimensions | Prototype in progress (see below). Pitch not started |

Honest scores from Task 2 (1-5, before the prototype): Relevant 4, Impactful 2.5, Innovative 2.5, Feasible 3.5, Scalable 4, Evidence-based 1.5. Weakest: Evidence-based (no resident validation yet) and Impactful (no measured baseline).

## What is built (prototype, pushed to `main`)
Stack: Vite + TypeScript + Tailwind v4 + MapLibre GL 6, OpenFreeMap tiles. Node 24.

- **Real streets**: `scripts/fetch-osm.mjs` downloads a pedestrian graph from Overpass into `public/data/townships/<id>.json`. Routing snaps start/end to the nearest point on real street geometry (multi-source Dijkstra, positive costs).
- **Profiles**: walking, wheelchair, elderly, stroller, visually impaired (`src/routing/profiles.ts`). Driving chip is disabled (roadmap).
- **Route tab**: SYAGmap route vs shortest route, barrier counts, streets used, share of route on roads with no mapped footpath, simulated-trips Test metric.
- **Report tab**: place report -> confirm -> saved; influence decays (7-day half-life); reports add cost to a street.
- **Heatmap tab**: built from township-observer counts (5-minute counts in 3 time slots) snapped to real streets. Seed counts are simulated and flagged; observers can log real counts.
- **Report Heatmap tab**: separate from the original pedestrian Heatmap. Equal-weight reports from the past 30 days blend into hotter spots where more reports overlap. Includes an independent simulated-report toggle, totals, empty state, and map-click counts by problem type within 50 m. Counts are submissions, not unique people. Priorities ranking is unchanged.
- **Carpool tab**: ride containers; click one to see A/B on the map; offer a ride by picking start/end on the map.
- **First Aid tab**: register as helper, availability, request help (confirm step), open requests with 12 h countdown, click a request to see requester / responders / your location, "I can help".
- **Priorities tab**: clusters reports by street, scores with footfall, asks Claude to rank (server side). Falls back to rule-based ranking without an API key.
- **Admin tab** (no login): draw new paths, edit segment attributes, remove segments, undo edits. Edits are stored in the DB and re-applied on top of the OSM download.
- Each tab shows only its own map layers (problems, helpers and requests never appear together).
- Simulated user location: draggable blue "You" dot (or real GPS button).
- Location picks use a confirm bar before saving.

## Data and honesty notes (important for the pitch)
- Street network: real OSM. Everything else is partly simulated and tagged "sim" in the UI: seed reports, seed observer counts, seed carpools/helpers/requests.
- OSM accessibility tagging is almost absent in the three demo areas (Overpass download, 2026-10-21): tactile paving 0, steps 0-1, kerb tags 0, incline 0, sidewalk tags on roads 0. This is a real finding: it is the gap reports + admin tagging fill. Per-area stats are in each JSON file under `stats`.
- Because roads have no sidewalk tags, all roads count as "exposed" (shared with traffic). This is a routing penalty, not a counted barrier.
- Walking-speed figures are assumptions, unverified.
- Township centre coordinates come from Nominatim lookups (Elmina = Elmina Lakeside Mall). Approximate.
- Barrier-free rates shown by the Test metric are simulation output, NOT evidence.
- Competitor facts (Google Maps wheelchair routes, AccessMap, Project Sidewalk, Wheelmap, Waze, MyJalan) are in the Task 2 answer with sources. Not verified: whether Google's step-free walking works in Malaysian townships; whether any Malaysian pedestrian-routing app exists (search the app stores before claiming "first").

## Code map
- `src/townships.json` - township list. Add one, then `npm run fetch-osm <id>`.
- `src/config.ts` - map style, TTL, decay half-life, source weights.
- `src/data/graphLoader.ts` - load raw OSM graph + apply admin edits. `src/data/rng.ts` - seeded PRNG.
- `src/routing/` - `engine.ts` (cost model, snapping, routes, trip metric), `dijkstra.ts`, `profiles.ts`, `priorities.ts` (clustering + AI/rules ranking).
- `src/store/db.ts` - client for the JSON DB (localStorage fallback). `src/store/stores.ts` - reports, observations, carpool, first aid.
- `src/state.ts`, `src/ui/panels.ts`, `src/ui/markers.ts`, `src/main.ts` - UI and map.
- `server/api.mjs` - JSON "NoSQL" API mounted in Vite (`/api/db/:collection`), 12 h TTL on help requests. `server/ai.mjs` - Claude call (`claude-opus-5-5`, effort low, JSON parsed from text).
- `data/db/*.json` - runtime database (git-ignored). `.env` - `ANTHROPIC_API_KEY` (git-ignored; see `.env.example`).
- `scripts/copy-maplibre.mjs` - copies MapLibre worker files to `public/maplibre` on install (Vite's dev transform breaks the worker otherwise).

Run: `npm install`, `npm run dev`, open http://localhost:5173. Check: `npm run typecheck`, `npm run build`.

## Recent fixes (2026-10-22, after user testing)
- Added a separate Report Heatmap without changing the original pedestrian Heatmap or Priorities scoring. Verified the 30-day cutoff, equal weights, simulated-report filtering, empty state, and nearby counts with focused checks. Browser-checked report hotspots, popup problem totals, the independent demo toggle, and the original pedestrian time filter. Production build passes.
- Carpool A-B line and first-aid helper/you-to-patient lines now follow real streets (`legBetween` in `src/routing/engine.ts`); distances shown are by road (carpool) or by street (first aid). Points snap to the largest connected street component, so they never land on an isolated fragment.
- Reports now always snap onto the nearest street when placed (rejected if over 150 m from any street); the snap tolerance for routing and ranking is 80 m. Before, a report placed away from a street was silently ignored by the ranking.
- Priorities: shows every problem spot (AI ranks the top 15, the rest follow), tags spots that include your own report, auto-refreshes the rule-based ranking when reports or counts change, marks an AI ranking as stale, and has a "Close ranking" button.
- `vite.config.ts` had lost the `jsonApi()` plugin in the "(update) Update config" commit, which made the app run offline (no JSON DB, no AI endpoint). The plugin is back; host `127.0.0.1` and port 3000 from that commit are kept. Keep the plugin in any future config edits.
- Limits: the street network is only the ~1.2 km square downloaded per township, so long detours can appear near its edge (raise `radiusM` in `src/townships.json` and re-run `npm run fetch-osm`). One-way streets are not modelled.

## Known gaps
- Untested in a browser: see the list below.
- No login/roles: Admin and observer tools are open (prototype).
- Admin-drawn paths connect only at existing junctions within 20 m, not to the middle of a segment.
- Admin removal of an admin-drawn path removes the whole drawn path.
- Slope data does not exist (no elevation source); slope only comes from OSM tags or admin edits.
- Computer-vision input and driving mode: not built.
- Mobile layout: not checked. Tab strip scrolls horizontally.
- JSON DB is single-process and unsuitable for production (fine for the demo).
- Dev server only: the `/api` backend is a Vite middleware. A static deploy falls back to localStorage.

## Untested (verify next)
1. Admin tab: draw a path, edit segment attributes, remove a segment, undo edits, and check routes change.
2. Heatmap tab: log a real observer count (pick spot -> confirm -> save) and check the heatmap updates.
3. Carpool tab: pick start and end on the map, confirm, offer the ride, join and chat.
4. Live Claude ranking: set `ANTHROPIC_API_KEY` in `.env`, restart, run Priorities. Only the rule-based fallback has been run.
5. First Aid: "I can help" flow (register + available + offer) and the focus view with responders.
6. Report placement with the confirm step, and rerouting after it, on the real street network.
7. Bukit Jelutong and Putra Heights townships (only Elmina was checked).
8. Mobile layout and the offline (no-API) fallback.

## Suggested next steps
1. Walk through the untested list above and fix what breaks.
2. Task 4: write up OSM coverage numbers and a one-route walk-audit plan (be honest that a non-SDP route is a proxy).
3. Task 5: short tech comparison to justify the choices already made.
4. Task 3: confirm the core / roadmap split and the single Test metric with the user.
5. Task 6: resident validation plan (survey, 5-10 interviews, observation checklist; elderly, PWD, parents with strollers, shift workers).
6. Pitch structure mapped to the six dimensions, including the roadmap slide, the simulated-data disclosure, and the traffic-light line in the problem statement.
