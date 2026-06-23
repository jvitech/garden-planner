---
title: Garden Planner
type: project-index
status: active
updated: 2026-06-23
---

# Garden Planner — Project Index

Offline-first browser garden planning application. No build step, no backend — runs directly from `index.html`. Data stored in browser localStorage only.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Application entry point |
| `css/app.css` | All application styles |
| `js/app.js` | Top-level UI: navigation, modals, archive flow |
| `js/store.js` | Central state management + localStorage persistence |
| `js/beds.js` | Bed grid, plant placement, lifecycle, succession |
| `js/data.js` | Built-in plant database |
| `js/inventory.js` | Seed packet inventory |
| `js/planning.js` | Succession planning logic |
| `js/plant-icons.js` | Plant icon and visual rendering |
| `GUIDE.md` | In-app help reference (~225 lines) |
| `Types-Gallery of types.csv` | Plant type reference data |
| `log.md` | Change log |

## Tech Stack

- **Frontend:** Vanilla JS (ES6+), HTML5, CSS3 — no framework, no build tool
- **Storage:** Browser localStorage only (offline, ~5–10 MB limit)
- **Architecture:** Module-based JS with central state in `store.js`
- **Hosting:** Static files — any web server or `file://` direct open

## Features

- Bed/plot grid design
- Plant library (built-in + custom)
- Lifecycle tracking (planned → harvested, date-logged)
- Succession planting (auto-activate next plant when current ends)
- Seasonal month view with sowing/harvest windows
- Seed inventory with germination tracking
- Crop rotation (colour-coded groups)
- Timeline journal with filtering
- Germination & outcome analytics
- Archive season (reset layout, preserve history + perennials)
- Multi-profile support (multiple gardens)
- Manual backup/restore + folder-based auto-backup with retention

## Key Constraint

> **Not in production.** No real users. Skip backward-compatibility migrations — rewrite data structures directly. See [[feedback-no-migration-garden-planner]].
