# SYAGmap

Accessible walking routes and crowdsourced footpath reports for any township.
Prototype for the SDP University Hackathon 2026, Theme 1 PEOPLE.

All data is SIMULATED in this prototype (pedestrian network, seed reports,
footfall, carpool, first-aid helpers). Only the routing logic and UI are real.

## Run
    npm install
    npm run dev

## Structure
- `src/config.ts` - township list (add any township here) and tunable weights
- `src/data/simulate.ts` - simulated pedestrian graph (swap for an OSM loader)
- `src/routing/` - profiles, cost model, weighted Dijkstra, trip metric
- `src/store/` - reports, carpool, first aid (localStorage, swappable for a DB)
- `src/main.ts` - map and UI
