# Garden Planner Guide

Garden Planner is an offline-first planner that runs entirely in your browser.
Your data stays local unless you export or back it up.

Use the in-app Help button to open this exact file at any time.
That keeps one single guide source of truth: this GUIDE.md.

## Quick Start

1. Open index.html in a modern browser.
2. Create one or more beds in Beds.
3. Arm a plant from the library and place it in cells.
4. Add seed packets in Seeds and link packets while planting.
5. Update lifecycle phases from Plant Details as plants progress.
6. Open Settings to set garden info and backup behavior.

## Main Areas

- Beds: Layout, placement, lifecycle updates, and plant details.
- Seeds: Packet inventory, germination quality, sorting/filtering, rating.
- My Plants: Create custom plants and edit built-in defaults.
- Calendar: Seasonal sowing and harvest windows at half-month resolution.
- Stats: Outcome and germination analytics, including expected-vs-actual timing.
- Journal: Timeline of lifecycle events with date filters and season filter.

## Beds Workflow

### Place and manage plants

1. Select a bed in the left panel.
2. Search/filter plant library and click a plant to arm it.
3. Optionally select a seed packet for the armed plant.
4. Click grid cells to place.
5. Drag existing placements to move.
6. Use R to rotate rectangular footprints.
7. Use Ctrl+Z / Ctrl+Y for undo/redo.

### Lifecycle phases

Each plant instance can move through these phases:

- planned
- direct_sow
- tray_seeded
- germinated
- transplanted
- growing
- harvested_once
- harvested_continuous
- gone_to_seed
- failed

Plant Details shows phase dates and day deltas so you can track timing.
Start date is based on first direct sow or tray seeding event.

## Seeds Workflow

Each seed packet can store:

- plant
- seed tag
- variety
- quantity and unit
- expiry date
- expected germination range (min/max days)
- packet rating
- notes

Seeds page supports:

- search
- stock filters
- germination quality filter
- sorting by germination success, rating, and quantity

Germination success is based on started to germinated outcomes linked to the packet.

## My Plants Workflow

- Add custom plants.
- Edit custom plants.
- Edit built-in plants (overrides only).
- Export plants (custom + edited built-ins).
- Import plants from shared files.

Plant definitions include expected germination range and spacing rules.

### Half-month date notation

Sowing and harvest dates use half-month decimals for early/late precision:

| Value | Meaning        |
|-------|----------------|
| 1     | Early January  |
| 1.5   | Late January   |
| 2     | Early February |
| 2.5   | Late February  |
| 3     | Early March    |
| 3.5   | Late March     |
| 4     | Early April    |
| 4.5   | Late April     |
| 5     | Early May      |
| 5.5   | Late May       |
| 6     | Early June     |
| 6.5   | Late June      |

The pattern continues through 12 (early December) and 12.5 (late December).

Enter values as comma-separated numbers or ranges:
- `3` — both halves of March (early and late)
- `3.1` — early March only (any decimal n.1–n.4 means early half of month n)
- `3.5` — late March only (any decimal n.5–n.9 means late half of month n)
- `3-6` — all half-months from early March through late June (displayed back as `3-6.5`)
- `3-4, 9-10` — spring and autumn windows
- `3.5-6` — late March through late June

A whole number as a range endpoint automatically includes both halves of that month,
so `3-6` and `3-6.5` produce identical results.

### Plant fields

- **Sow indoors** — half-months to start seeds under cover or in trays. Leave blank for direct-sow-only plants (e.g. Carrot, Garlic).
- **Sow / plant outdoors** — half-months to direct-sow or transplant outdoors.
- **Harvest months** — half-months when the crop is ready to pick.
- **Dormant months** — whole months when a perennial is dormant (integers only).

## Calendar

The calendar shows sowing and harvest windows for all plants across the year.
Each month is split into two columns — ▲ early (1st–15th) and ▼ late (16th–end).

Color bars per cell:
- **Purple** — sow indoors / under cover
- **Green** — sow or plant outdoors
- **Amber** — harvest window

Bars in frost months (outside your last-frost / first-frost window) are shown faded.
**LF** and **FF** markers indicate your last and first frost months from Settings.

## Stats Workflow

Stats includes:

- seasonal snapshots
- bed-level and plant-level outcomes
- seed packet germination success
- harvest success
- germination coverage
- expected-vs-actual germination speed flags (faster/slower/within expected)

Use season filters and comparison mode to compare years.

## Journal Workflow

Journal tracks lifecycle transitions with timestamps.
Use filters for:

- bed
- range (last day, last 7 days, last month, season)
- season

You can open events to add notes/photos or delete entries.

## Multi-Garden Profiles

Settings includes profile controls:

- create profile
- switch profile
- delete non-active profile

Each profile has its own data snapshot (beds, inventory, settings, history).
Header shows the active garden name.

## Backups and Restore

There are two backup paths:

1. Manual JSON backup/restore from the header (download/upload).
2. Folder-based backups in Settings (browser support required).

Folder-based backups support:

- choose/disconnect backup folder
- backup now
- startup offer to restore latest backup
- backup history with load/delete actions
- retention strategy that protects daily, weekly, and monthly points

### Backup frequency setting

In Settings, set Auto-backup frequency (minutes).
Default is 60 minutes, minimum is 5 minutes.
The app marks data as dirty on changes and writes backup on interval when needed.

## Settings

Settings includes:

- garden name
- location
- growing zone
- last frost and first frost
- backup rotation count
- auto-backup frequency in minutes

## Keyboard Shortcuts

- Escape: disarm selected plant
- R: rotate armed rectangular plant
- Ctrl+Z: undo
- Ctrl+Y: redo

## Data Storage

- App state is stored in browser localStorage.
- Backup folder handle (if used) is stored in browser IndexedDB.
- Built-in plant catalog is in js/data.js.

## Keep This Guide Updated

When features change, update this GUIDE.md file.
The in-app Help button reads this file directly, so users always see the latest guide.
