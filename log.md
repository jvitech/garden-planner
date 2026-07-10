---
type: log
project: garden-planner
---

# Change Log — Garden Planner

<!-- Newest first. One entry per meaningful change or decision.
     No migration code needed — app not in production; rewrite data directly. -->

## 2026-07-10 — Performance pass 6 (journal cache + targeted DOM updates + hover DOM-scan elimination)
- **JS** `Store.getLifecycleJournal()`: Added `_journalCache` (same lazy-cache pattern as `_bedsCache`/`_inventoryCache`) — previously every call deserialized the full journal from localStorage; now O(1) after first read; invalidated automatically when `saveLifecycleJournal()` is called; eliminates redundant JSON.parse on every hover (`showPlantInfo` → `lifecycleTimelineForInstance`), every inventory render (`seedGerminationStats` per seed), and every stats render
- **JS** `Inventory.adjustQty` / `setQty`: Replaced full `render()` call with targeted `_applyQtyToDom()` helper — patches only the input value, card stock class, and badge text/class in the existing card; avoids rebuilding the entire inventory grid (including per-seed journal reads) on every +/− button press
- **JS** `beds.js`: Added module-level `_instanceMetaByBed` Map (bedId → instanceMeta object); `bedBlockHtml()` now stores its `instanceMeta` into this map (including `originKey` for each origin cell) so post-render code can use it without re-walking bed cells
- **JS** `findOriginCell`: Added O(1) fast-path via `_instanceMetaByBed` cached `originKey`; falls back to full linear scan only when meta not yet built (before first render or after undo)
- **JS** `hoverInstanceCells` / `focusInstanceCells` / `focusSelectedInstances`: Replaced `querySelectorAll(.gcell[data-bed=...][data-instance=...])` DOM scans with `_markInstanceEls()` which uses `gcellEl()` O(1) ID lookups over the bounding box only; `querySelector` retained for the at-most-one overlay element; eliminates the explicit "DOM scans in hover callbacks" banned pattern

## 2026-06-23 — Scroll performance pass 5 (CDP-measured hover optimisation)
- **Method**: Node.js + Chrome DevTools Protocol (`perf-test.mjs`) running 1,655 real DOM cells
- **CDP baselines** (pass 4 state): hover ScriptDuration 6.25ms/event; renderCanvas(full) 67ms/call; renderCanvas({bedId}) 33ms/call; Layerize = 0
- **JS** `showPlantInfo`: added same-instance cache guard — when the mouse moves across multiple cells of the same plant instance, the info panel no longer re-renders (early return if `plantId + instanceId` unchanged); cache resets in `clearInstanceHover` when leaving the instance
- **JS** `showPlantInfo`: consolidated 3+ separate `Store.getBeds().find()` + `findOriginCell()` calls into one shared lookup (`_infobed`, `_infoOrigin`, `_infoOriginCell`) at the top of the function — previously each of the seed-assign, path-edit, row-details, and lifecycle sub-blocks did an independent full cell scan
- **CDP results after pass 5**: hover ScriptDuration 2.17ms/event (−65%); renderCanvas(bedId) 15.9ms/call; renderCanvas(full) 34ms/call; Layerize 0ms

## 2026-06-23 — Scroll performance pass 4 (Layerize + delegation)
- **Profiler revealed**: `Layerize` sub-task = 50% of all Rendering — compositor rebuilding layer trees on every scroll frame
- **Root cause**: `content-visibility: auto` on `.bed-block` triggers a full Layerize cycle each time a bed enters/exits the viewport; worse than the initial render cost it was saving
- **CSS** `.bed-block`: Removed `content-visibility: auto; contain-intrinsic-size: auto 300px` — eliminates Layerize overhead entirely
- **CSS** `.gcell`: Removed `transition: background .1s, box-shadow .1s` — eliminates animated hover repaint (Painting) on every cell enter/leave; instant feedback is correct UX for a tool app
- **CSS** Removed now-redundant `transition: none !important` suppression rules (no transition to suppress); kept `pointer-events: none` during scroll
- **JS** Event delegation: replaced ~350 chars of inline handlers per cell (`onclick`, `onmousedown`, `onmouseenter`, `onmouseleave`, `ondragover`, `ondrop`, `ondragstart`, `ondragend`) with a single set of listeners on `.bed-canvas-area`; cuts `bedBlockHtml` string length by ~315 KB per 900-cell bed, making every `renderCanvas` call significantly cheaper
- **JS** `clearInstanceFocus` / `focusSelectedInstances` / `focusInstanceCells`: Added `_focusedInstanceEls` cache — same O(n) pattern as hover cache; removes two `querySelectorAll` scans on every click
- **JS** `_isScrollingTimer`: Moved from DOM expando property to module-level variable

## 2026-06-23 — Scroll performance pass 3 (profiler-guided)
- **Root cause confirmed via profiler**: Rendering 2,784 ms + Painting 2,951 ms per session; Scripting only 17 ms — JS is not the bottleneck
- **CSS** `.bed-canvas-area.is-scrolling .bed-grid-wrap { pointer-events: none }` — eliminates per-frame hover hit-testing (the primary driver of the 2.7 s Rendering cost); browser skips `:hover` selector matching entirely while scrolling
- **JS + inventory.js + plant-icons.js**: Added `decoding="async"` to all `<img>` elements — offloads image decode to a background thread so it doesn't block the main thread paint; also added `loading="lazy"` to below-the-fold photos (journal, seed thumbnails) to address 3.12 s LCP

## 2026-06-23 — Scroll performance pass 2
- **CSS** `.bed-block`: Added `content-visibility: auto; contain-intrinsic-size: auto 300px` — browser skips rendering off-screen beds entirely during scroll
- **CSS** `.bed-grid-wrap`: Added `contain: layout paint` — isolates each grid's layout and repaint from the rest of the document
- **CSS** Added `.bed-canvas-area.is-scrolling .gcell { transition: none }` — suppresses background/box-shadow animation on cells that scroll under the pointer
- **JS** `cellLeave`: Removed dead `querySelectorAll('[data-bed]')` loop — `hl-good`/`hl-bad` classes are never set; the scan was pure overhead on every cell leave
- **JS** `clearInstanceHover` / `hoverInstanceCells`: Replaced DOM scans with a `_hoveredInstanceEls` cache array — cleanup is now O(n hovered cells) not O(DOM)
- **JS** Added capture-phase `scroll` listener on `.bed-canvas-area` to toggle `is-scrolling` class (150 ms debounce)

## 2026-06-17 — OKF docs added
- `index.md` created — project index, feature list, key constraints
- `log.md` created — this file
