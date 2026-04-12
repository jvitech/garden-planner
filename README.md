# Garden Planner

An offline-first garden planning app that runs entirely in the browser — no server, no account, no dependencies to install.

## Features

- **Bed layout** — design raised beds, in-ground plots, and seed trays on a grid
- **Plant library** — built-in plant database with custom plant support
- **Lifecycle tracking** — move plants through phases from planned to harvested, with date logging
- **Succession planting** — stack multiple plants per cell; the next plant activates automatically when the current one ends
- **Seasonal month view** — visualise which plants are active, dormant, or out of season for any given month
- **Seed inventory** — track packets, germination rates, and link packets to placed plants
- **Crop rotation** — colour-coded rotation groups with per-season history
- **Journal** — full timeline of lifecycle events, filterable by date and season
- **Stats** — germination and outcome analytics, expected vs actual timing
- **Archive season** — archive a completed season to rotation history, reset the layout for the next year while keeping perennials

## Getting Started

1. Clone or download the repository.
2. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).
3. No build step, no server required.

## Data Storage

All data is stored in `localStorage` in your browser. Nothing is sent to any server.

Use **Settings → Export backup** regularly to save a JSON snapshot of your data. The **Archive Season** function automatically downloads a backup before making any changes.

To move data between browsers or devices, export a backup and import it via Settings.

## Project Structure

```
index.html          Main entry point
css/app.css         All styles
js/
  app.js            Top-level UI, navigation, modals, archive season
  beds.js           Bed grid rendering, plant placement, lifecycle, succession
  store.js          State management, localStorage persistence
  data.js           Built-in plant database
  inventory.js      Seed packet inventory
  stats.js          Analytics views
  calendar.js       Seasonal calendar
GUIDE.md            In-app help guide (also accessible via the Help button)
```

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
