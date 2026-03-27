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
- Calendar: Seasonal sow/transplant/harvest windows.
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
