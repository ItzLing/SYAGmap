# SYAGmap

Accessible walking routes and crowdsourced footpath reports for any township.
Prototype for the SDP University Hackathon 2026, Theme 1 PEOPLE.

Street network: real, from OpenStreetMap (run `npm run fetch-osm`). Reports, observer
counts, carpools and helpers are partly SIMULATED seed data, marked in the UI.

## Run
    npm install
    npm run dev

## Optional: AI ranking
Copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without it the Priorities tab uses a rule-based ranking.

## Database
Local JSON files in `data/db/` (git-ignored), served by `server/api.mjs`. Help requests expire after 12 h.

## Structure
- `src/config.ts` - township list (add any township here) and tunable weights
- `src/data/simulate.ts` - simulated pedestrian graph (swap for an OSM loader)
- `src/routing/` - profiles, cost model, weighted Dijkstra, trip metric
- `src/store/` - reports, carpool, first aid (localStorage, swappable for a DB)
- `src/main.ts` - map and UI
