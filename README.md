<div align="center">

# 🗺️ SYAGmap

### Better Maps, True Accessibility

**Maps guide cars. SYAGmap guides people on foot.**

*Sime Darby Property University Hackathon 2026 · Theme 1: People (Mobility, Accessibility, Safety)*

[![Live Demo](https://img.shields.io/badge/Live%20Demo-syagmap.vercel.app-000000?style=for-the-badge&logo=vercel&logoColor=white)](https://syagmap.vercel.app/)

![Status](https://img.shields.io/badge/status-working%20prototype-16a34a)
![Maps](https://img.shields.io/badge/maps-OpenStreetMap-7ebc6f)
![Frontend](https://img.shields.io/badge/frontend-Vite%20%2B%20TypeScript-646cff)
![AI](https://img.shields.io/badge/AI-Claude-c8102e)

👉👉👉 **[Click me to experience SYAGmap](https://syagmap.vercel.app/)** 👈👈👈

</div>

---

## 💡 What is SYAGmap?

Normal maps show roads. They don't show the **steps, steep slopes, missing kerb ramps and blocked paths** that decide whether someone can actually walk somewhere.

SYAGmap maps the **walking layer** of a township. It finds routes that suit each person, lets residents report problems, and tells township management **what to fix first**.

## 📑 What's Next
| Extensibility | Description |
|---|---|
|Driving Mode|Real-time traffic lights display|
||Traffic-based computation of red & green light duration |
|Database|Firebase, MongoDB|
|PWA|Support mobile app |

## ✨ Features

| | Feature | What it does |
|---|---|---|
| 🧭 | **Accessible Routing** | Pick Walking, Wheelchair, Elderly, Stroller or Visually impaired. Get the route that fits, with barrier warnings. |
| 📣 | **Report a Problem** | One tap to report a blocked path, broken pavement, open drain, pole or missing ramp. Saved as `<location, problem, datetime>`. |
| 🔥 | **Footfall Heatmap** | See where people walk most, by morning, midday and evening. |
| 🌡️ | **Report Heatmap** | See problem hotspots from the last 30 days. |
| 🤖 | **AI Priorities** | Claude ranks which problems to fix first. Falls back to rule-based ranking if no API key is set. |
| 🚗 | **Carpool** | Offer or join rides with start, end, riders and a chat box. |
| 🚑 | **First Aid Network** | Register as a helper. Ask for help and nearby helpers are notified. Requests auto-delete after **12 hours**. |
| 🛠️ | **Admin Tools** | Override or hardcode details of any path segment. |

## 🧠 How it works

```
OpenStreetMap  →  Walking graph  →  Profile weights  →  Report influence  →  Dijkstra  →  Your route
(real streets)    (slope, steps,    (wheelchair ≠       (users 1.0,          (lowest      + barrier
                   kerb ramp...)     stroller ≠ ...)     vision 0.4,          cost path)   warnings
                                                         fades over 7 days)
```

**Routing:** every street segment gets a cost based on slope, steps, kerb ramps, tactile paving, surface and width. Each profile weighs these differently. Wheelchair routes **block** steps and slopes above 6%, while elderly routes just avoid them. Sky bridges and covered paths get a smaller cost.

**Reports:** a report's influence is `source weight × 0.5^(age in days ÷ 7)`. Resident reports count fully (1.0), computer-vision reports count less (0.4), and old reports fade away so the map stays honest.

**Fix priority:** `severity × recency × (1 + 2 × footfall)`, boosted if the problem blocks wheelchairs. Claude then ranks the spots and suggests an action for each.

## 🏘️ Demo areas

Real street data for three Sime Darby Property townships (about 600 m radius each):

- Elmina
- Bukit Jelutong
- Putra Heights

> ⚠️ **Note:** reports, footfall counts, carpools and helpers are **partly simulated** in this prototype. The app labels this clearly.

## 🚀 Getting started

**Requirements:** Node.js 18 or newer.

```bash
# 1. Install dependencies
npm install

# 2. (Optional) Enable AI priorities
echo "ANTHROPIC_API_KEY=your_key_here" > .env

# 3. Run the app
npm run dev
```

Open the local address shown in your terminal. Without an API key everything still works, and the AI ranking switches to the rule-based version.

### ➕ Add a new township

1. Add an entry to `src/townships.json` (id, name, centre, radius, zoom).
2. Download its street network:
   ```bash
   npm run fetch-osm <township-id>
   ```
3. Done. Nothing else in the app is area-specific.

## 🧱 Tech stack

- **Frontend:** Vite, TypeScript, MapLibre GL
- **Map data:** OpenStreetMap, tiles from OpenFreeMap
- **Routing:** custom Dijkstra on a pedestrian graph
- **Backend:** small Node API with a JSON file store (easy to swap for MongoDB or similar)
- **AI:** Anthropic Claude for fix prioritisation
- **Database:** 

## 📁 Project structure

```
public/data/townships/   Real street data per township
scripts/fetch-osm.mjs    Downloads street data from OpenStreetMap
server/                  API routes and the AI prioritiser
src/routing/             Dijkstra, user profiles, routing engine, priorities
src/store/               Reports, carpools, first aid, observations
src/ui/                  Panels and map markers
src/config.ts            Settings (12h help expiry, 7-day report decay...)
```

## 🔒 Privacy

Only **aggregated, anonymous data** (street name, problem types, counts, footfall) is sent to the AI. No personal data is shared.

## 🛣️ Roadmap

1. **Pilot:** one township, with admins verifying path data on site.
2. **Expand:** all three townships with real reports, plus computer vision from street imagery.
3. **Scale:** all Sime Darby townships, an open API, and partnerships with councils and accessibility groups.

## 👥 Team SYAG

From Monash University Malaysia

| Name | Role | Email | Contact | 
|---|---|---|---|
| Lee Jun Ming | Team Leader | myleejm23@gmail.com | +6019-3402828 | 
| Darren Chiau Yan Pei | Member | Darrenchiauyanpei@gmail.com | +6011-10832124|
| Dickson Lim Seng Yang | Member |itz.dickson1304@gmail.com|+6012-9995551 |
| Lo Yi Fan | Member | maybeenoch@gmail.com | +6013-7995668 |
| Tan Jun Qi | Member | tcolt035@gmail.com | +6013-7699111 | 
---

## Additional URLs
|What's in Here|Link|
|---|---|
|Live Prototype|https://syagmap.vercel.app/|
|GitHub|https://github.com/ItzLing/SYAGmap|
|Presentation Video|https://youtu.be/8jg-aptmTi8|
|Pitch Deck|https://drive.google.com/file/d/1g1OKxFOkm0q_8uhgVW8kQOSZwKOyGL1i/view?usp=sharing|
|Demo Video|https://youtu.be/F5IyuNSAtPU|
|Extensible Idea Proposal|https://drive.google.com/file/d/1_8tCLx8oEMpqpIjDDvkqdKkkEaXPPi25/view?usp=sharing|
---

<div align="center">
<br>
<b>SYAGmap</b>

*Better Maps, True Accessibility* 💛
</div>
<br>

---