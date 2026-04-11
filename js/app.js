/* js/app.js — Root controller: tab routing, shared utils,
                PlantDB merge, Custom Plants page, Calendar, Export
   ================================================================ */
'use strict';

// ================================================================
// PLANT DB — merged view (built-ins + custom)
// ================================================================
const PlantDB = (() => {
  const DEFAULT_GERM_BY_CAT = {
    vegetable: [5, 14],
    herb: [7, 18],
    fruit: [5, 14],
    flower: [5, 14],
  };

  function normalizeGermination(minRaw, maxRaw, fallbackMin = 5, fallbackMax = 14) {
    const minVal = parseInt(minRaw, 10);
    const maxVal = parseInt(maxRaw, 10);
    const min = Number.isFinite(minVal) ? Math.max(0, minVal) : fallbackMin;
    const max = Number.isFinite(maxVal) ? Math.max(min, maxVal) : Math.max(min, fallbackMax);
    return { min, max };
  }

  function withGerminationDefaults(plant) {
    if (!plant) return plant;
    if (plant._isPath || plant.id === '__path__') {
      return { ...plant, germinationDaysMin: 0, germinationDaysMax: 0 };
    }
    const [fbMin, fbMax] = DEFAULT_GERM_BY_CAT[plant.cat] || [5, 14];
    const g = normalizeGermination(plant.germinationDaysMin, plant.germinationDaysMax, fbMin, fbMax);
    return { ...plant, germinationDaysMin: g.min, germinationDaysMax: g.max };
  }

  function builtinBase(id) {
    return BUILTIN_PLANTS.find(p => p.id === id) ?? null;
  }

  let _cache = null;
  if (typeof window !== 'undefined') {
    window.addEventListener('gp:data-changed', () => { _cache = null; });
  }

  function all() {
    if (_cache) return _cache;
    const overrides = Store.getBuiltinPlantOverrides();
    const builtins = BUILTIN_PLANTS.map(p => {
      const ov = overrides[p.id];
      const merged = ov ? { ...p, ...ov, _builtin: true, _edited: true } : { ...p, _builtin: true };
      return withGerminationDefaults(merged);
    });
    const custom = Store.getCustomPlants().map(p => withGerminationDefaults({ ...p, _custom: true }));
    _cache = [...builtins, ...custom];
    return _cache;
  }
  function get(id) {
    return all().find(p => p.id === id) ?? null;
  }
  function isBuiltin(id) {
    return !!builtinBase(id);
  }
  function hasBuiltinOverride(id) {
    const map = Store.getBuiltinPlantOverrides();
    return Object.prototype.hasOwnProperty.call(map, id);
  }
  function ensureGerminationDataInStorage() {
    const [defMin, defMax] = [5, 14];

    const custom = Store.getCustomPlants();
    let customChanged = false;
    const updatedCustom = custom.map(p => {
      if (!p || p._isPath || p.id === '__path__') return p;
      const [fbMin, fbMax] = DEFAULT_GERM_BY_CAT[p.cat] || [defMin, defMax];
      const g = normalizeGermination(p.germinationDaysMin, p.germinationDaysMax, fbMin, fbMax);
      if (p.germinationDaysMin === g.min && p.germinationDaysMax === g.max) return p;
      customChanged = true;
      return { ...p, germinationDaysMin: g.min, germinationDaysMax: g.max };
    });
    if (customChanged) Store.saveCustomPlants(updatedCustom);

    const overrides = Store.getBuiltinPlantOverrides();
    let ovChanged = false;
    const nextOverrides = { ...overrides };
    Object.entries(overrides).forEach(([id, ov]) => {
      if (!ov || typeof ov !== 'object') return;
      const base = builtinBase(id) || {};
      const cat = ov.cat || base.cat;
      const [fbMin, fbMax] = DEFAULT_GERM_BY_CAT[cat] || [defMin, defMax];
      const g = normalizeGermination(ov.germinationDaysMin ?? base.germinationDaysMin, ov.germinationDaysMax ?? base.germinationDaysMax, fbMin, fbMax);
      if (ov.germinationDaysMin === g.min && ov.germinationDaysMax === g.max) return;
      ovChanged = true;
      nextOverrides[id] = { ...ov, germinationDaysMin: g.min, germinationDaysMax: g.max };
    });
    if (ovChanged) Store.saveBuiltinPlantOverrides(nextOverrides);
  }

  return { all, get, builtinBase, isBuiltin, hasBuiltinOverride, ensureGerminationDataInStorage };
})();

// ================================================================
// SHARED HELPERS
// ================================================================
function escHtml(str)  { return String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function escAttr(str)  { return escHtml(str); }

// ── All known families grouped for the crop-rotation select ──
const FAMILY_OPTIONS = [
  { group: '🟣 Legumes (Fabaceae)',                  families: [{ val:'fabaceae',      label:'Fabaceae — Legumes (beans, peas)' }] },
  { group: '🔵 Brassicas (Brassicaceae)',             families: [{ val:'brassicaceae',  label:'Brassicaceae — Brassicas (kale, cabbage, radish)' }] },
  { group: '🔴 Potatoes & Fruiting Veg (Solanaceae)', families: [{ val:'solanaceae',    label:'Solanaceae — Potatoes & fruiting veg' }] },
  { group: '🟡 Roots & Alliums',                      families: [{ val:'apiaceae',      label:'Apiaceae — Carrots, parsley, fennel' },
                                                                  { val:'allioideae',   label:'Alliaceae/Allioideae — Onions, garlic, leek' }] },
  { group: '🟢 Other families',                       families: [{ val:'cucurbitaceae', label:'Cucurbitaceae — Cucumbers, squash' },
                                                                  { val:'amaranthaceae',label:'Amaranthaceae — Beets, spinach' },
                                                                  { val:'poaceae',      label:'Poaceae — Corn, grasses' },
                                                                  { val:'lamiaceae',    label:'Lamiaceae — Mint family herbs' },
                                                                  { val:'asteraceae',   label:'Asteraceae — Lettuce, daisies' },
                                                                  { val:'asparagaceae', label:'Asparagaceae — Asparagus' },
                                                                  { val:'rosaceae',     label:'Rosaceae — Strawberries' },
                                                                  { val:'boraginaceae', label:'Boraginaceae — Borage' },
                                                                  { val:'tropaeolaceae',label:'Tropaeolaceae — Nasturtium' }] },
];

function familySelectHtml(id, selectedVal, rotationDisabled) {
  const disabledOpt = `<option value="__disabled__" ${rotationDisabled ? 'selected' : ''}>⛔ Disabled (no rotation tracking)</option>`;
  const blankOpt = `<option value="" ${!rotationDisabled && !selectedVal ? 'selected' : ''}>— not set —</option>`;
  const groups = FAMILY_OPTIONS.map(g => {
    const opts = g.families.map(f =>
      `<option value="${f.val}" ${!rotationDisabled && selectedVal === f.val ? 'selected' : ''}>${escHtml(f.label)}</option>`
    ).join('');
    return `<optgroup label="${escAttr(g.group)}">${opts}</optgroup>`;
  }).join('');
  return `<select id="${id}">${disabledOpt}${blankOpt}${groups}</select>`;
}
function capFirst(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }
function sunTxt(s)     { return s === 'full' ? '☀️ Full' : s === 'partial' ? '⛅ Part' : '🌥️ Shade'; }
function cellPlantId(cell) { return typeof cell === 'string' ? cell : (cell?.plantId ?? null); }
function cellIsOrigin(cell) { return typeof cell === 'string' ? true : !!cell?.origin; }
function fmtShortDate(val) {
  if (!val) return 'not set';
  const d = new Date(val + 'T12:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function monthNumber(val) {
  if (!val) return null;
  return new Date(val + 'T12:00:00').getMonth() + 1;
}
function inOutdoorWindow(month, settings) {
  const lf = monthNumber(settings.lastFrost);
  const ff = monthNumber(settings.firstFrost);
  if (!lf || !ff) return true;
  return month >= lf && month <= ff;
}

// ── Seasonal stage computation ───────────────────────────────────────────────
const SEASONAL_STAGE_META = {
  perennial:     { label: 'Perennial (active)',   icon: '♾️',  color: '#d8f3dc', stripColor: '#52b788' },
  sowing:        { label: 'Sowing time',          icon: '🌰',  color: '#fff8e1', stripColor: '#c08a10' },
  transplanting: { label: 'Transplant time',      icon: '🌱',  color: '#e3f2fd', stripColor: '#1a6fa8' },
  growing:       { label: 'Growing',              icon: '🌿',  color: '#ccf5d8', stripColor: '#43aa8b' },
  harvesting:    { label: 'Harvest time',         icon: '🌾',  color: '#e8f5e9', stripColor: '#2d7a40' },
  dormant:       { label: 'Dormant / out of season', icon: '💤', color: '#eeeeee', stripColor: '#9daab5' },
};

/**
 * Returns the seasonal stage of a plant for a given 1-based month.
 * For perennials, checks plant.dormant array; otherwise active year-round.
 * For annuals, deduces 'growing' by pairing each sow/tr month with its next
 * harvest month — handles multi-window plants (e.g. carrot) correctly.
 * @param {object} plant - full plant object from PlantDB
 * @param {number} month - 1–12
 * @returns {'perennial'|'sowing'|'transplanting'|'growing'|'harvesting'|'dormant'}
 */
function getSeasonalStage(plant, month) {
  if (!plant || plant._isPath) return 'dormant';
  if (plant.perennial) {
    const dormant = plant.dormant ?? [];
    return dormant.includes(month) ? 'dormant' : 'perennial';
  }
  const sow  = plant.sow  ?? [];
  const tr   = plant.tr   ?? [];
  const harv = plant.harv ?? [];
  if (harv.includes(month))  return 'harvesting';
  if (tr.includes(month))    return 'transplanting';
  if (sow.includes(month))   return 'sowing';

  // Deduce 'growing': for each sow/tr month s, find the next harvest month h
  // after s. If the current month falls in the gap (s, h), it's growing.
  // Handles wrap-around (e.g. garlic: sow Oct→ harv Jun) only when no harvest
  // exists in the same year after s.
  const sowTr = [...new Set([...sow, ...tr])];
  if (sowTr.length === 0 || harv.length === 0) return 'dormant';

  const harvSorted = [...harv].sort((a, b) => a - b);

  for (const s of sowTr) {
    // Harvest months that come after s in the same calendar year
    const nextHarv = harvSorted.find(h => h > s);
    if (nextHarv !== undefined) {
      if (month > s && month < nextHarv) return 'growing';
    } else {
      // No harvest later in the year — wrap-around season (e.g. garlic)
      // Growing = after s through end of year, OR from Jan up to first harv
      const wrapHarv = harvSorted[0];
      if (month > s || month < wrapHarv) return 'growing';
    }
  }
  return 'dormant';
}

function activeSeasonYear() {
  const settings = Store.getSettings();
  const fromDates = [settings.lastFrost, settings.firstFrost]
    .filter(Boolean)
    .map(v => new Date(v + 'T12:00:00').getFullYear())
    .find(y => Number.isFinite(y));
  return fromDates || new Date().getFullYear();
}

const Toast = (() => {
  let timer;
  function show(msg, duration = 2600) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('show'), duration);
  }
  return { show };
})();

const Modal = (() => {
  function open(id)  { document.getElementById(id)?.classList.add('open'); }
  function close(id) { document.getElementById(id)?.classList.remove('open'); }
  return { open, close };
})();

const HelpUI = (() => {
  const HELP_HTML = `
    <h3 style="margin:0 0 4px">🌱 Garden Planner — User Guide</h3>
    <p style="margin:0 0 10px;color:var(--text-muted);font-size:.78rem">Offline-first planner for beds, seeds, lifecycle tracking, and seasonal planning.</p>
    <p style="margin:0 0 14px;padding:8px 10px;background:#fff3cd;border:1px solid #f5c800;border-radius:6px;font-size:.78rem">
      ⚠️ <strong>All data is stored in your browser's localStorage.</strong> It is tied to this specific browser and browser profile.
      If you switch to a different browser, a different browser profile, clear site data, or use a private/incognito window,
      your gardens will not be there. <strong>Always use Backup to export your data regularly.</strong>
      See <strong>💾 Backup &amp; Restore</strong> below to set up automatic backups.
    </p>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">⚡ Quick Start</h4>
    <ol style="margin:0 0 14px 18px;padding:0">
      <li>Create a <strong>Bed</strong> using the + buttons at the top of the Beds tab.</li>
      <li>Click a plant in the library panel to <strong>arm</strong> it (it appears in the Armed Plant panel).</li>
      <li>Click any empty cell in a bed to <strong>place</strong> the plant.</li>
      <li>Click a placed plant to open <strong>Plant Details</strong> and track its lifecycle.</li>
      <li>Add seed packets in the <strong>Seeds</strong> tab and link them to placements for inventory deduction.</li>
    </ol>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">🛏️ Bed Types</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li><strong>Bed</strong> — standard raised bed or in-ground patch.</li>
      <li><strong>Plot</strong> — large area divided into named sub-zones. Use ➕ Add bed to draw zones, then select a zone before planting.</li>
      <li><strong>Seed Tray</strong> — tracks seedlings before transplanting. Each cell holds exactly one plant regardless of its normal footprint size. Link tray plants to bed plants via the <em>Source from tray</em> section in Plant Details.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">🌿 Placing Plants</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Click a plant in the library to arm it, then click a cell to place it.</li>
      <li>Hold <strong>R</strong> or use the rotate button to rotate a plant's footprint before placing.</li>
      <li>Enable <strong>Plant in rows mode</strong> in the Armed Plant panel, then drag a rectangle to fill a block with evenly spaced rows.</li>
      <li>Hold the mouse button and drag to <strong>paint</strong> multiple cells.</li>
      <li>Drag an existing plant to <strong>move</strong> it. Ctrl+drag copies it.</li>
      <li>Click the ✕ on a cell (top-right corner on hover) to remove a plant.</li>
      <li>Press <strong>Escape</strong> to disarm without placing.</li>
      <li><strong>Ctrl+Z</strong> / <strong>Ctrl+Y</strong> to undo / redo.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">📅 Seasonal View</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Use the <strong>📅 View</strong> month selector in the toolbar (or ‹ › arrows) to switch to a monthly view.</li>
      <li>Plants with <strong>Seasonal mode ON</strong> (toggle in the Armed Plant panel before placing) show a coloured stage strip and tint:
        <ul style="margin:4px 0 0 16px">
          <li>🌰 Sowing — 🌱 Transplanting — 🌿 Growing — 🌾 Harvesting</li>
          <li>💤 Dormant (perennial, in ground, shown dimmed)</li>
          <li>Ghost / empty appearance = annual not present this month (free for succession)</li>
        </ul>
      </li>
      <li><strong>Perennial plants</strong> always show seasonal stages without needing seasonal mode toggled.</li>
      <li>Seasonal stage dates come from the plant definition. Edit a plant to change its sow/harvest months — all beds update automatically.</li>
      <li>The <strong>Plant Details</strong> panel shows the current seasonal stage with an <em>OFF</em> badge when seasonal mode is disabled for that instance.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">🔄 Succession Planting</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>When a seasonal annual is absent (ghost cell), you can place a different plant over it — it is stored as a <strong>succession plant</strong>.</li>
      <li>The succession plant shows normally; a tiny ghost emoji in the corner reminds you of the out-of-season primary plant underneath.</li>
      <li>A dashed orange outline marks succession cells.</li>
      <li>Clicking the ✕ on a succession cell removes the succession plant, leaving the primary untouched.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">🔍 Plant Details Panel</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li><strong>Hover</strong> over a placed plant to preview its details without selecting it.</li>
      <li><strong>Click</strong> a plant to select it and access lifecycle controls.</li>
      <li><strong>Ctrl+click</strong> to add or remove individual plants from the selection. <strong>Shift+click</strong> to select a rectangular range of plants.</li>
      <li>With multiple plants selected, the Growth Status section shows the count and lets you update all lifecycles in one action.</li>
      <li>Click the red <strong>🗑️ Delete N selected plants</strong> button (bottom of Growth Status) to remove all selected plants at once — a confirmation prompt appears before anything is deleted.</li>
      <li>Shows: lifecycle badge, crop rotation group, seasonal stage (current month), growth status, seed packet, companions, and row details.</li>
      <li>Click <strong>✏️ Edit plant</strong> (top of the panel) to modify the plant definition globally.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">🌱 Lifecycle Phases</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>📋 Planned → 🌰 Direct sow / 🪴 Seedling tray → 🌱 Germinated → 🏺 Ready to transplant → 🌤️ Hardened off → 🌿 Transplanted → 🍃 Growing → 🧺 Harvested → ✂️ Harvesting continuous → 🌾 Gone to seed / ✗ Failed</li>
      <li>Phase dates are recorded in the <strong>Phase Dates</strong> timeline in Plant Details.</li>
      <li>Link a tray seedling to a bed plant via the <strong>Source from tray</strong> section to track transplanting.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">♻️ Crop Rotation</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Each plant family has a colour: purple = Legumes, blue = Brassicas, red = Solanaceae, yellow = Apiaceae/Alliaceae.</li>
      <li>A warning appears if you place a plant in a bed that had the same family within the last 3 years.</li>
      <li>To disable rotation tracking for a plant, set the <strong>Crop rotation family</strong> dropdown to <em>⛔ Disabled</em> in the plant editor.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">🗺️ Plot Beds & Zones</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Click <strong>➕ Add bed</strong> on a Plot bed to draw a named sub-zone by clicking two opposite corners.</li>
      <li>Click a zone label to <strong>select</strong> it (yellow border). You must have a zone selected before planting in a plot.</li>
      <li>Drag the ⠿ handle beside the zone label to move the zone. Drag the corner handles to resize.</li>
      <li>The zone label floats above the zone border for easy identification.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">📚 Plant Library Filters</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Filter by category: All, 🥦 Vegetable, 🌿 Herb, 🍓 Fruit, 🌸 Flower, 🛤️ Infrastructure, ✏️ Custom.</li>
      <li><strong>🌱 Sow</strong> — shows only plants you can sow or transplant in the currently selected view month.</li>
      <li><strong>♾️ Perennial</strong> — shows perennial plants only.</li>
      <li>Tick <strong>Only with seed packets</strong> to filter to plants you have seeds for.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">🌿 Plant Lifecycle Types</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>🌱 <strong>Annual</strong> — completes in one season. Supported in seasonal mode.</li>
      <li>🌿 <strong>Biennial</strong> — takes two years (e.g. parsley, carrot, onion, cabbage, coriander). Planned like an annual for bed layout but useful to note for seed collection.</li>
      <li>♾️ <strong>Perennial</strong> — lives multiple years. Always shows seasonal stages; set dormant months in the plant editor.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">📋 Planning</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Open the <strong>📋 Planning</strong> tab to see a smart to-do list built from your current bed layout and today's date.</li>
      <li>Tasks are generated automatically — no manual entry needed. The planner looks at every placed plant, its current lifecycle state, the seasonal stage for this month, and your seed inventory.</li>
      <li><strong>Urgency groups:</strong>
        <ul style="margin:4px 0 0 16px">
          <li>⚠ <strong>Overdue</strong> — action was needed in a previous month (e.g. a tray that should have been started).</li>
          <li>🌱 <strong>Do Now</strong> — action is due this month.</li>
          <li>⏰ <strong>Coming Up</strong> — action is needed next month — good time to prepare.</li>
          <li>📅 <strong>Upcoming</strong> — action is on the horizon but not urgent yet.</li>
        </ul>
      </li>
      <li>Cards are grouped by <strong>plant type</strong>. If you have 30 carrots planned across multiple beds, they appear as one card — <em>Carrot ×30</em> — with a single action button that updates all of them at once.</li>
      <li><strong>Task types:</strong>
        <ul style="margin:4px 0 0 16px">
          <li>🛒 <strong>Buy Seeds</strong> — a planned plant has no seed packet in inventory. Go to the Seeds tab to add one.</li>
          <li>🌰 <strong>Direct Sow</strong> — plant seeds directly in the bed; it's sowing time.</li>
          <li>🪴 <strong>Start Tray</strong> — start seeds in a seed tray for later transplanting. Shown when the plant's preferred method is <em>Transplant</em> and it's sowing/indoor-start time.</li>
          <li>🌱 <strong>Check Germination</strong> — seeds were sown or trayed; check if they have sprouted. Urgency increases based on the plant's expected germination window.</li>
          <li>🌿 <strong>Transplant</strong> — seedlings are ready; move them from tray to bed.</li>
          <li>💧 <strong>Maintain</strong> — plant is actively growing; water, check for pests, add compost as needed.</li>
          <li>🧺 <strong>Harvest</strong> — it's harvest time for this crop.</li>
          <li>⏰ <strong>Prep Harvest</strong> — harvest is next month; prepare tools, containers, or storage.</li>
        </ul>
      </li>
      <li>The planting method (direct sow vs. tray start) comes from the <strong>Preferred planting method</strong> field in the plant editor. If not set, direct sow is assumed. Plants with <em>tr: none</em> (e.g. Carrot, Garlic) are always direct sow regardless of the setting.</li>
      <li>Click <strong>✓ [action]</strong> on a card to advance all matching plants to the next lifecycle state in one click. A journal event is recorded for each plant updated.</li>
      <li>Use the <strong>bed filter</strong> dropdown to focus the planning list on a single bed.</li>
      <li>Click <strong>↺ Refresh</strong> to regenerate tasks after making changes in other tabs.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">📊 Stats</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Open the <strong>Stats</strong> tab to see a summary of your garden across all beds and seed packets.</li>
      <li><strong>Bed summary table</strong> — one row per bed showing: area (m²), total cells, occupied cells, number of distinct plants, variety count, families, and a success rate (harvested vs. total placed).</li>
      <li><strong>Plant performance</strong> — per-plant rows listing how many were placed, germinated, harvested, or failed across all beds. Useful for spotting which varieties thrive or struggle in your conditions.</li>
      <li><strong>Seed performance</strong> — per-seed-packet stats including germination rate (%), germination speed (average days), harvest success rate, and counts of started / direct sow / tray seeded / transplanted / harvested / failed. Packets with no events yet show <em>n/a</em>.</li>
      <li><strong>Season comparison</strong> — pick a second season year to compare metrics side-by-side. Arrows (↑ / ↓) highlight improvements or regressions.</li>
      <li>Use the <strong>Bed filter</strong> and <strong>Season filter</strong> dropdowns at the top to narrow the view to a specific bed or year. A text search box filters plant and seed rows by name.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">📒 Journal</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Open the Journal from the <strong>📒 Journal</strong> button on any bed header, or switch to the Journal tab.</li>
      <li>Shows a <strong>chronological event timeline</strong> for lifecycle transitions — every time you move a plant through a lifecycle phase (e.g. Planned → Germinated → Harvested) an event is recorded with its date.</li>
      <li>Filter by <strong>Bed</strong> (dropdown) and <strong>Season year</strong> to focus on one bed or one growing season at a time.</li>
      <li>Use the <strong>Date range</strong> pickers to narrow events to a specific window — handy at the end of a season to review what happened in a particular month.</li>
      <li>The <strong>Search</strong> box filters events by plant name or notes so you can quickly find all entries for a specific crop.</li>
      <li>Events can have an optional <strong>photo attachment</strong> (stored as a URL or data URI) — tap the camera icon on an event to add or view a photo.</li>
      <li>Journal data is included in Backup exports and can be reviewed across seasons for pattern recognition and planning.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">💾 Backup &amp; Restore</h4>
    <ul style="margin:0 0 14px 18px;padding:0">
      <li>Use <strong>Backup / Restore</strong> in the header for manual JSON export/import. This is the safest way to preserve your data across browsers or devices.</li>
      <li>Connect a backup folder in <strong>Settings</strong> for automatic periodic backups with configurable retention rules (daily, weekly, monthly points).</li>
      <li>Create and switch between multiple <strong>garden profiles</strong> in Settings — useful for separate gardens or planning seasons. The active profile name appears in the header. Note that switching profiles does not move your data; each profile is independent within the same browser.</li>
    </ul>

    <h4 style="margin:0 0 6px;color:var(--primary-dark)">⌨️ Keyboard Shortcuts</h4>
    <ul style="margin:0 0 6px 18px;padding:0">
      <li><strong>Escape</strong> — disarm plant / cancel placement.</li>
      <li><strong>R</strong> — rotate plant footprint (when armed).</li>
      <li><strong>Ctrl+Z</strong> — undo last bed change.</li>
      <li><strong>Ctrl+Y</strong> — redo.</li>
    </ul>
  `;

  function loadGuide() {
    const body = document.getElementById('help-guide-body');
    const stamp = document.getElementById('help-guide-updated');
    if (!body) return;
    body.innerHTML = HELP_HTML;
    if (stamp) stamp.textContent = `Built-in help refreshed at ${new Date().toLocaleTimeString()}`;
  }

  function open() {
    Modal.open('help-modal');
    loadGuide();
  }

  function reload() {
    loadGuide();
  }

  return { open, reload };
})();

const GPImageLightbox = (() => {
  let overlay = null;

  function ensure() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'image-lightbox';
    overlay.innerHTML = `
      <div class="image-lightbox-backdrop" onclick="GPImageLightbox.close()"></div>
      <div class="image-lightbox-dialog">
        <button class="image-lightbox-close" onclick="GPImageLightbox.close()" aria-label="Close image preview">✕</button>
        <img id="image-lightbox-img" class="image-lightbox-img" alt="Image preview">
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function open(src, alt = 'Image preview') {
    if (!src) return;
    const el = ensure();
    const img = el.querySelector('#image-lightbox-img');
    if (!img) return;
    img.src = src;
    img.alt = alt;
    el.classList.add('open');
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('open');
  }

  return { open, close };
})();

window.GPImageLightbox = GPImageLightbox;

const BackupFS = (() => {
  const DB_NAME = 'garden_planner_fs';
  const STORE_NAME = 'handles';
  const HANDLE_KEY = 'backup-directory';

  function supported() {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window && 'indexedDB' in window;
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function saveDirectoryHandle(handle) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }

  async function loadDirectoryHandle() {
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const req = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  }

  async function clearDirectoryHandle() {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  }

  return { supported, saveDirectoryHandle, loadDirectoryHandle, clearDirectoryHandle };
})();

const GardenBackups = (() => {
  let autoBackupDirty = false;
  let autoBackupLoopId = null;
  let autoBackupLastAt = 0;
  let suppressAutoBackup = false;

  function slugifyName(name) {
    return String(name || 'garden')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'garden';
  }

  function activeGardenName() {
    const settings = Store.getSettings();
    return settings.gardenName || settings.locationName || 'My Garden';
  }

  function buildBackupFilename(isoString = new Date().toISOString()) {
    const stamp = isoString.replace(/[:.]/g, '-');
    return `${slugifyName(activeGardenName())}-backup-${stamp}.json`;
  }

  function isoWeekKey(dateValue) {
    const d = new Date(Date.UTC(dateValue.getUTCFullYear(), dateValue.getUTCMonth(), dateValue.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  async function getDirectoryHandle() {
    if (!BackupFS.supported()) return null;
    const handle = await BackupFS.loadDirectoryHandle();
    if (!handle) return null;
    const permission = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'denied');
    return permission === 'granted' ? handle : null;
  }

  async function chooseDirectory() {
    if (!BackupFS.supported()) {
      alert('This browser does not support persistent backup folders. Use Backup/Restore manually or a Chromium-based browser.');
      return null;
    }
    const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
    const permission = await handle.requestPermission({ mode: 'readwrite' });
    if (permission !== 'granted') return null;
    await BackupFS.saveDirectoryHandle(handle);
    const settings = { ...Store.getSettings(), backupDirectoryLabel: handle.name || '' };
    Store.saveSettings(settings);
    return handle;
  }

  async function clearDirectory() {
    await BackupFS.clearDirectoryHandle();
    const settings = { ...Store.getSettings(), backupDirectoryLabel: '' };
    Store.saveSettings(settings);
  }

  async function listBackups() {
    const handle = await getDirectoryHandle();
    if (!handle) return [];
    const backups = [];
    for await (const entry of handle.values()) {
      if (!entry || entry.kind !== 'file' || !entry.name.toLowerCase().endsWith('.json')) continue;
      if (!entry.name.includes('-backup-')) continue;
      try {
        const file = await entry.getFile();
        const text = await file.text();
        const data = JSON.parse(text);
        const exportedAt = data.exportedAt || file.lastModifiedDate?.toISOString?.() || new Date(file.lastModified).toISOString();
        backups.push({
          name: entry.name,
          json: text,
          exportedAt,
          lastModified: file.lastModified,
          gardenName: data.gardenName || data.settings?.gardenName || data.settings?.locationName || 'Garden',
        });
      } catch {
        // Ignore invalid files in backup directory.
      }
    }
    return backups.sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)));
  }

  async function enforceRotation(directoryHandle) {
    const retention = Math.max(1, parseInt(Store.getSettings().backupRetention, 10) || 10);
    const gardenSlug = slugifyName(activeGardenName());
    const files = [];
    for await (const entry of directoryHandle.values()) {
      if (!entry || entry.kind !== 'file' || !entry.name.startsWith(`${gardenSlug}-backup-`) || !entry.name.endsWith('.json')) continue;
      try {
        const file = await entry.getFile();
        files.push({ name: entry.name, lastModified: file.lastModified });
      } catch {
        // ignore unreadable entry
      }
    }
    files.sort((a, b) => b.lastModified - a.lastModified);

    const protectedNames = new Set();
    const daySeen = new Set();
    const weekSeen = new Set();
    const monthSeen = new Set();
    files.forEach(item => {
      const dt = new Date(item.lastModified);
      const dayKey = dt.toISOString().slice(0, 10);
      const weekKey = isoWeekKey(dt);
      const monthKey = dt.toISOString().slice(0, 7);
      if (!daySeen.has(dayKey)) {
        daySeen.add(dayKey);
        protectedNames.add(item.name);
      }
      if (!weekSeen.has(weekKey)) {
        weekSeen.add(weekKey);
        protectedNames.add(item.name);
      }
      if (!monthSeen.has(monthKey)) {
        monthSeen.add(monthKey);
        protectedNames.add(item.name);
      }
    });

    const nonProtected = files.filter(item => !protectedNames.has(item.name));
    const toDelete = nonProtected.slice(retention);
    await Promise.all(toDelete.map(item => directoryHandle.removeEntry(item.name).catch(() => {})));
  }

  async function writeBackup(reason = 'auto') {
    const handle = await getDirectoryHandle();
    if (!handle) return false;
    const json = Store.exportAll();
    const fileHandle = await handle.getFileHandle(buildBackupFilename(), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(json);
    await writable.close();
    await enforceRotation(handle);
    autoBackupDirty = false;
    autoBackupLastAt = Date.now();
    if (reason === 'manual') Toast.show(`Backup saved for ${activeGardenName()}`);
    return true;
  }

  function autoBackupIntervalMs() {
    const settings = Store.getSettings();
    const mins = Math.max(5, parseInt(settings.backupIntervalMinutes, 10) || 60);
    return mins * 60 * 1000;
  }

  function markDirty() {
    if (suppressAutoBackup) return;
    autoBackupDirty = true;
  }

  function startAutoBackupLoop() {
    if (autoBackupLoopId) clearInterval(autoBackupLoopId);
    autoBackupLoopId = setInterval(() => {
      if (suppressAutoBackup || !autoBackupDirty) return;
      const elapsed = Date.now() - autoBackupLastAt;
      if (elapsed < autoBackupIntervalMs()) return;
      writeBackup('auto').catch(() => {});
    }, 60 * 1000);
  }

  function scheduleAutoBackup() {
    markDirty();
  }

  async function restoreBackupByName(name) {
    const backups = await listBackups();
    const backup = backups.find(b => b.name === name);
    if (!backup) throw new Error('Backup not found');
    suppressAutoBackup = true;
    Store.importAll(backup.json);
    suppressAutoBackup = false;
    location.reload();
  }

  async function deleteBackupByName(name) {
    const handle = await getDirectoryHandle();
    if (!handle) return false;
    await handle.removeEntry(name);
    return true;
  }

  async function maybeOfferRestoreOnStartup() {
    if (sessionStorage.getItem('gp-startup-restore-checked') === '1') return;
    sessionStorage.setItem('gp-startup-restore-checked', '1');
    const backups = await listBackups();
    if (!backups.length) return;
    const groups = new Map();
    backups.forEach(backup => {
      if (!groups.has(backup.gardenName)) groups.set(backup.gardenName, []);
      groups.get(backup.gardenName).push(backup);
    });
    if (groups.size === 1) {
      const [gardenName, items] = Array.from(groups.entries())[0];
      const latest = items[0];
      const ok = window.confirm(`Found a backup for "${gardenName}" from ${new Date(latest.exportedAt).toLocaleString()}. Load it?`);
      if (!ok) return;
      suppressAutoBackup = true;
      Store.importAll(latest.json);
      suppressAutoBackup = false;
      location.reload();
      return;
    }
    const ordered = Array.from(groups.entries()).map(([gardenName, items]) => ({ gardenName, latest: items[0] }));
    const selection = window.prompt(
      `Found backups for multiple gardens. Enter the number to load the latest backup:\n${ordered.map((entry, idx) => `${idx + 1}. ${entry.gardenName} — ${new Date(entry.latest.exportedAt).toLocaleString()}`).join('\n')}`,
      '1'
    );
    const index = Math.max(1, Math.min(ordered.length, parseInt(selection, 10) || 0)) - 1;
    if (!ordered[index]) return;
    suppressAutoBackup = true;
    Store.importAll(ordered[index].latest.json);
    suppressAutoBackup = false;
    location.reload();
  }

  function supported() {
    return BackupFS.supported();
  }

  function suppressDuring(fn) {
    suppressAutoBackup = true;
    try { return fn(); }
    finally { suppressAutoBackup = false; }
  }

  return {
    supported,
    chooseDirectory,
    clearDirectory,
    getDirectoryHandle,
    listBackups,
    writeBackup,
    restoreBackupByName,
    deleteBackupByName,
    scheduleAutoBackup,
    startAutoBackupLoop,
    markDirty,
    maybeOfferRestoreOnStartup,
    suppressDuring,
  };
})();

const GardenProfiles = (() => {
  const KEY_REGISTRY = 'gp2_garden_profiles_v1';
  const KEY_ACTIVE = 'gp2_active_garden_v1';
  const KEY_PREFIX = 'gp2_garden_snapshot_';

  function list() {
    const raw = localStorage.getItem(KEY_REGISTRY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  }

  function saveList(arr) {
    localStorage.setItem(KEY_REGISTRY, JSON.stringify(arr));
  }

  function activeId() {
    return localStorage.getItem(KEY_ACTIVE) || null;
  }

  function setActiveId(id) {
    localStorage.setItem(KEY_ACTIVE, id);
  }

  function snapshotKey(id) {
    return `${KEY_PREFIX}${id}`;
  }

  function updateHeaderLabel() {
    const el = document.getElementById('header-garden-name');
    if (!el) return;
    const settings = Store.getSettings();
    const name = settings.gardenName || settings.locationName || 'My Garden';
    el.textContent = `Garden: ${name}`;
  }

  function captureCurrentToActive() {
    const settings = Store.getSettings();
    const name = settings.gardenName || settings.locationName || 'My Garden';
    let profiles = list();
    let id = activeId();
    if (!id) {
      id = `g_${Date.now()}`;
      setActiveId(id);
      profiles.push({ id, name, updatedAt: new Date().toISOString() });
    }
    const idx = profiles.findIndex(p => p.id === id);
    if (idx >= 0) profiles[idx] = { ...profiles[idx], name, updatedAt: new Date().toISOString() };
    else profiles.push({ id, name, updatedAt: new Date().toISOString() });
    saveList(profiles);
    localStorage.setItem(snapshotKey(id), Store.exportAll());
    updateHeaderLabel();
  }

  function emptyGardenSnapshot(name) {
    return JSON.stringify({
      version: 5,
      gardenName: name,
      beds: [],
      customPlants: [],
      builtins: {},
      inventory: [],
      settings: { ...Store.getSettings(), gardenName: name },
      bedHistory: [],
      lifecycleJournal: [],
      exportedAt: new Date().toISOString(),
    });
  }

  function ensureInitialized() {
    let profiles = list();
    let id = activeId();
    if (!profiles.length) {
      const currentName = Store.getSettings().gardenName || Store.getSettings().locationName || 'My Garden';
      id = `g_${Date.now()}`;
      profiles = [{ id, name: currentName, updatedAt: new Date().toISOString() }];
      saveList(profiles);
      setActiveId(id);
      localStorage.setItem(snapshotKey(id), Store.exportAll());
    }
    if (!id || !profiles.find(p => p.id === id)) {
      id = profiles[0].id;
      setActiveId(id);
    }
    updateHeaderLabel();
  }

  function create(name) {
    captureCurrentToActive();
    const profileName = String(name || '').trim() || `Garden ${list().length + 1}`;
    const id = `g_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const profiles = list();
    profiles.push({ id, name: profileName, updatedAt: new Date().toISOString() });
    saveList(profiles);
    localStorage.setItem(snapshotKey(id), emptyGardenSnapshot(profileName));
    setActiveId(id);
    Store.importAll(localStorage.getItem(snapshotKey(id)));
    location.reload();
  }

  function switchTo(id) {
    if (!id) return;
    captureCurrentToActive();
    const json = localStorage.getItem(snapshotKey(id));
    if (!json) return;
    setActiveId(id);
    Store.importAll(json);
    location.reload();
  }

  function remove(id) {
    const profiles = list();
    if (profiles.length <= 1) throw new Error('At least one garden profile must remain');
    if (id === activeId()) throw new Error('Load another garden before deleting the current one');
    const next = profiles.filter(p => p.id !== id);
    saveList(next);
    localStorage.removeItem(snapshotKey(id));
  }

  return {
    list,
    activeId,
    ensureInitialized,
    captureCurrentToActive,
    create,
    switchTo,
    remove,
    updateHeaderLabel,
  };
})();

const SettingsUI = (() => {
  async function open() {
    const settings = Store.getSettings();
    document.getElementById('st-garden-name').value = settings.gardenName || '';
    document.getElementById('st-location').value = settings.locationName || '';
    document.getElementById('st-zone').value = settings.growingZone || '';
    document.getElementById('st-last-frost').value = settings.lastFrost || '';
    document.getElementById('st-first-frost').value = settings.firstFrost || '';
    document.getElementById('st-backup-retention').value = settings.backupRetention || 10;
    document.getElementById('st-backup-interval').value = settings.backupIntervalMinutes || 60;
    const switchSel = document.getElementById('st-garden-switch');
    const profiles = GardenProfiles.list();
    const active = GardenProfiles.activeId();
    switchSel.innerHTML = profiles.map(p => `<option value="${p.id}" ${p.id === active ? 'selected' : ''}>${escHtml(p.name)}${p.id === active ? ' (current)' : ''}</option>`).join('');
    const backupLabel = document.getElementById('st-backup-folder-label');
    if (backupLabel) {
      const handle = await GardenBackups.getDirectoryHandle();
      backupLabel.textContent = handle ? `Connected folder: ${handle.name}` : (settings.backupDirectoryLabel ? `Folder saved: ${settings.backupDirectoryLabel} (permission needed)` : 'No backup folder selected yet');
    }
    const support = document.getElementById('st-backup-support');
    if (support) support.textContent = GardenBackups.supported()
      ? 'Browser backup folder support is available. Choose a folder once and the app can auto-backup there.'
      : 'This browser cannot persist a backup folder handle. Manual Backup/Restore still works.';
    await refreshBackupHistory();
    Modal.open('settings-modal');
  }

  function save() {
    const settings = {
      ...Store.getSettings(),
      gardenName: document.getElementById('st-garden-name').value.trim() || 'My Garden',
      locationName: document.getElementById('st-location').value.trim(),
      growingZone: document.getElementById('st-zone').value.trim(),
      lastFrost: document.getElementById('st-last-frost').value,
      firstFrost: document.getElementById('st-first-frost').value,
      backupRetention: Math.max(1, parseInt(document.getElementById('st-backup-retention').value, 10) || 10),
      backupIntervalMinutes: Math.max(5, parseInt(document.getElementById('st-backup-interval').value, 10) || 60),
    };
    Store.saveSettings(settings);
    GardenProfiles.captureCurrentToActive();
    GardenProfiles.updateHeaderLabel();
    Modal.close('settings-modal');
    GardenBackups.scheduleAutoBackup();
    GardenBackups.startAutoBackupLoop();
    if (document.getElementById('page-calendar')?.classList.contains('active')) {
      CalendarView.render();
    }
    Toast.show('Season settings saved');
  }

  async function refreshBackupHistory() {
    const holder = document.getElementById('st-backup-history');
    if (!holder) return;
    const backups = await GardenBackups.listBackups();
    if (!backups.length) {
      holder.innerHTML = '<div style="font-size:.74rem;color:var(--text-muted)">No backups found in selected folder.</div>';
      return;
    }
    holder.innerHTML = backups.slice(0, 50).map(b => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:0">
        <div style="font-size:.74rem;font-weight:700">${escHtml(b.gardenName)}</div>
        <div style="font-size:.68rem;color:var(--text-muted)">${escHtml(new Date(b.exportedAt).toLocaleString())} · ${escHtml(b.name)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-secondary btn-sm" type="button" onclick="SettingsUI.restoreBackup('${escAttr(b.name)}')">Load</button>
        <button class="btn btn-danger btn-sm" type="button" onclick="SettingsUI.deleteBackup('${escAttr(b.name)}')">Delete</button>
      </div>
    </div>`).join('');
  }

  async function restoreBackup(name) {
    if (!confirm(`Load backup ${name}? Current unsaved state will be replaced.`)) return;
    await GardenBackups.restoreBackupByName(name);
  }

  async function deleteBackup(name) {
    if (!confirm(`Delete backup ${name}?`)) return;
    await GardenBackups.deleteBackupByName(name);
    await refreshBackupHistory();
    Toast.show('Backup deleted');
  }

  async function pickBackupFolder() {
    try {
      const handle = await GardenBackups.chooseDirectory();
      const label = document.getElementById('st-backup-folder-label');
      if (label && handle) label.textContent = `Connected folder: ${handle.name}`;
      if (handle) Toast.show(`Backup folder connected: ${handle.name}`);
      updateBackupAlert().catch(() => {});
    } catch (err) {
      alert(`Unable to pick backup folder: ${err.message}`);
    }
  }

  async function clearBackupFolder() {
    await GardenBackups.clearDirectory();
    const label = document.getElementById('st-backup-folder-label');
    if (label) label.textContent = 'No backup folder selected yet';
    Toast.show('Backup folder disconnected');
    updateBackupAlert().catch(() => {});
  }

  async function saveBackupNow() {
    const ok = await GardenBackups.writeBackup('manual');
    if (!ok) {
      alert('No writable backup folder is connected yet. Open Settings and choose a backup folder first.');
      return;
    }
    await refreshBackupHistory();
  }

  function loadSelectedGarden() {
    const id = document.getElementById('st-garden-switch').value;
    GardenProfiles.switchTo(id);
  }

  function createGardenProfile() {
    const name = prompt('Name of the new garden profile:');
    if (name === null) return;
    GardenProfiles.create(name);
  }

  function deleteSelectedGarden() {
    const sel = document.getElementById('st-garden-switch');
    const id = sel?.value;
    if (!id) return;
    const label = sel.options[sel.selectedIndex]?.textContent || id;
    if (!confirm(`Delete garden profile "${label}"?`)) return;
    try {
      GardenProfiles.remove(id);
      open();
      Toast.show('Garden profile deleted');
    } catch (err) {
      alert(err.message);
    }
  }

  return {
    open,
    save,
    pickBackupFolder,
    clearBackupFolder,
    saveBackupNow,
    refreshBackupHistory,
    restoreBackup,
    deleteBackup,
    loadSelectedGarden,
    createGardenProfile,
    deleteSelectedGarden,
  };
})();


// ── Backup alert badge ────────────────────────────────────────────
async function updateBackupAlert() {
  const btn = document.getElementById('backup-alert-btn');
  if (!btn) return;
  if (!GardenBackups.supported()) { btn.style.display = 'none'; return; }
  const handle = await GardenBackups.getDirectoryHandle();
  btn.style.display = handle ? 'none' : '';
}

// ================================================================
// TAB ROUTING
// ================================================================
const TABS = ['beds', 'inventory', 'plants', 'calendar', 'stats', 'planning', 'journal'];

function switchTab(name) {
  TABS.forEach(t => {
    document.getElementById(`tab-${t}`)?.classList.toggle('active',    t === name);
    document.getElementById(`page-${t}`)?.classList.toggle('active',   t === name);
  });
  if (name === 'beds')      Beds.init();
  if (name === 'inventory') Inventory.render();
  if (name === 'plants')    CustomPlants.render();
  if (name === 'calendar')  CalendarView.render();
  if (name === 'stats')     StatsView.render();
  if (name === 'planning')  PlanningView.render();
  if (name === 'journal')   Beds.renderBedJournal();
}

// ================================================================
// CUSTOM PLANTS PAGE
// ================================================================
const CustomPlants = (() => {
  const CATS = ['vegetable','herb','fruit','flower'];
  let filterText = '';
  let sourceFilter = 'all';

  function familyLabel(fam) {
    if (!fam) return '—';
    for (const group of FAMILY_OPTIONS) {
      const hit = group.families.find(f => f.val === fam);
      if (hit) return hit.label;
    }
    return fam;
  }

  function render() {
    const allPlants = PlantDB.all().slice().sort((a, b) => a.name.localeCompare(b.name));
    const list = allPlants.filter(p => {
      const sourceOk = sourceFilter === 'all'
        ? true
        : (sourceFilter === 'custom' ? !!p._custom : !p._custom);
      const txt = filterText;
      const textOk = !txt || [
        p.name,
        p.cat,
        p.family,
        p.spacing,
        p.daysToHarvest,
      ].map(v => String(v || '').toLowerCase()).some(v => v.includes(txt));
      return sourceOk && textOk;
    });
    
    // Build map of unique seed packets per plant
    const inventory = Store.getInventory();
    const uniqueSeedPacksByPlant = new Map();
    list.forEach(p => {
      const packSet = new Set();
      inventory.forEach(seed => {
        if (seed.plantId === p.id) {
          const packKey = (seed.seedTag || '').toLowerCase() || `entry:${seed.id}`;
          packSet.add(packKey);
        }
      });
      uniqueSeedPacksByPlant.set(p.id, packSet.size);
    });
    
    const grid = document.getElementById('custom-plants-grid');
    renderCopySelect();
    const searchEl = document.getElementById('cp-filter-input');
    if (searchEl && searchEl.value !== filterText) searchEl.value = filterText;
    const sourceEl = document.getElementById('cp-type-filter');
    if (sourceEl && sourceEl.value !== sourceFilter) sourceEl.value = sourceFilter;
    if (!list.length) {
      grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px;font-size:.88rem">
        <div style="font-size:3rem;margin-bottom:10px">🌱</div>
        ${allPlants.length ? 'No plants match your filter.' : 'No plants found.'}
      </div>`;
      return;
    }
    const rows = list.map(p => {
      const sourceLabel = p._custom ? 'Custom' : (PlantDB.hasBuiltinOverride(p.id) ? 'Built-in (edited)' : 'Built-in');
      const rowSpacing = (Number(p.rowSpacing) || 0) > 0 ? `${Number(p.rowSpacing)} cm` : '—';
      const spacing = p.spacing ? `${p.spacing} cm` : '—';
      const companions = `${(p.good || []).length} good / ${(p.bad || []).length} bad`;
      const seedCount = uniqueSeedPacksByPlant.get(p.id) || 0;
      const deleteBtn = p._custom
        ? `<button class="btn btn-danger btn-sm" onclick="CustomPlants.deleteP('${p.id}')">Delete</button>`
        : '';
      return `<tr>
        <td><span class="plants-row-name">${p.emoji || '🌱'} ${escHtml(p.name)}</span></td>
        <td>${sourceLabel}</td>
        <td>${capFirst(p.cat || 'other')}</td>
        <td>${escHtml(spacing)}</td>
        <td>${escHtml(rowSpacing)}</td>
        <td>${capFirst(p.sun || '—')}</td>
        <td>${capFirst(p.water || '—')}</td>
        <td>${capFirst(p.height || '—')}</td>
        <td>${escHtml(p.daysToHarvest || '—')}</td>
        <td title="${escAttr(familyLabel(p.family || ''))}">${escHtml(familyLabel(p.family || ''))}</td>
        <td>${companions}</td>
        <td style="text-align:center;font-weight:700">${seedCount}</td>
        <td class="plants-table-actions">
          <button class="btn btn-secondary btn-sm" onclick="CustomPlants.openEdit('${p.id}')">Edit</button>
          <button class="btn btn-secondary btn-sm" onclick="CustomPlants.cloneP('${p.id}')">Copy</button>
          <button class="btn btn-primary btn-sm" onclick="Inventory.openNewForPlant('${p.id}')" title="Create seed packet for this plant">seed+</button>
          ${deleteBtn}
        </td>
      </tr>`;
    }).join('');

    grid.innerHTML = `<div class="plants-table-wrap">
      <table class="plants-table">
        <thead>
          <tr>
            <th>Plant</th>
            <th>Type</th>
            <th>Category</th>
            <th>Plant size</th>
            <th>Row spacing</th>
            <th>Sun</th>
            <th>Water</th>
            <th>Height</th>
            <th>Harvest</th>
            <th>Family</th>
            <th>Companions</th>
            <th>Seed packs</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
  }

  function renderCopySelect() {
    const sel = document.getElementById('cp-src-select');
    if (!sel) return;
    const plants = PlantDB.all().slice().sort((a, b) => a.name.localeCompare(b.name));
    sel.innerHTML = '<option value="">— pick a plant to copy —</option>' +
      plants.map(p => `<option value="${p.id}">${p.emoji} ${escHtml(p.name)}${p._custom ? ' (custom)' : ''}</option>`).join('');
  }

  function openNew()     { openModal(null); }
  function openEdit(id)  {
    const plant = PlantDB.get(id);
    if (!plant) return;
    if (plant._custom) {
      openModal(Store.getCustomPlants().find(p => p.id === id));
      return;
    }
    BuiltinPlants.openEdit(id);
  }

  function openModal(existing) {
    const allPlants = PlantDB.all();
    const multiOpts = () => allPlants.map(p =>
      `<option value="${p.id}">${p.emoji} ${escHtml(p.name)}</option>`).join('');

    // build good/bad multi-selects
    document.getElementById('cp-modal-body').innerHTML = `
      <div class="form-row-inline">
        <div class="form-row" style="flex:.15">
          <label>Icon</label>
          <input id="cp-emoji" type="text" maxlength="4" value="${existing?.emoji||'🌱'}" style="font-size:1.5rem;text-align:center">
        </div>
        <div class="form-row" style="flex:1">
          <label>Plant name *</label>
          <input id="cp-name"  type="text" placeholder="e.g. Borlotti Bean" value="${escAttr(existing?.name||'')}">
        </div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Category</label>
          <select id="cp-cat">
            ${CATS.map(c=>`<option value="${c}" ${existing?.cat===c?'selected':''}>${capFirst(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label>Plant spacing (cm×cm)</label>
          <input id="cp-spacing" type="text" placeholder="e.g. 30×30" value="${escAttr(existing?.spacing||'30×30')}">
          <div class="form-hint">Size of one plant's footprint on the grid.</div>
        </div>
        <div class="form-row">
          <label>Row spacing (cm)</label>
          <input id="cp-row-spacing" type="number" min="0" step="1" placeholder="0" value="${existing?.rowSpacing || ''}">
          <div class="form-hint">Extra gap between rows beyond the plant footprint (0 = rows touch). For garlic: 25, carrot: 15, potato: 70.</div>
        </div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Sun</label>
          <select id="cp-sun">
            <option value="full"    ${existing?.sun==='full'   ||!existing?'selected':''}>Full sun</option>
            <option value="partial" ${existing?.sun==='partial'?'selected':''}>Partial</option>
            <option value="shade"   ${existing?.sun==='shade'  ?'selected':''}>Shade</option>
          </select>
        </div>
        <div class="form-row">
          <label>Water</label>
          <select id="cp-water">
            <option value="low"    ${existing?.water==='low'   ?'selected':''}>Low</option>
            <option value="medium" ${existing?.water==='medium'||!existing?'selected':''}>Medium</option>
            <option value="high"   ${existing?.water==='high'  ?'selected':''}>High</option>
          </select>
        </div>
        <div class="form-row">
          <label>Height</label>
          <select id="cp-height">
            <option value="low"    ${existing?.height==='low'?'selected':''}>Low</option>
            <option value="medium" ${existing?.height==='medium'||!existing?'selected':''}>Medium</option>
            <option value="tall"   ${existing?.height==='tall'?'selected':''}>Tall</option>
            <option value="vine"   ${existing?.height==='vine'?'selected':''}>Vine</option>
          </select>
        </div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Days to harvest</label>
          <input id="cp-days" type="text" placeholder="e.g. 60–80" value="${escAttr(existing?.daysToHarvest||'')}">
        </div>
        <div class="form-row">
          <label>Germination (min days)</label>
          <input id="cp-germ-min" type="number" min="0" step="1" value="${existing?.germinationDaysMin ?? ''}">
        </div>
        <div class="form-row">
          <label>Germination (max days)</label>
          <input id="cp-germ-max" type="number" min="0" step="1" value="${existing?.germinationDaysMax ?? ''}">
        </div>
      </div>
      <div class="form-row">
        <label>Preferred planting method</label>
        <select id="cp-planting-mode">
          <option value="">Not specified</option>
          <option value="direct"    ${existing?.plantingMode==='direct'    ?'selected':''}>Direct sow</option>
          <option value="transplant"${existing?.plantingMode==='transplant'?'selected':''}>Transplant (start in tray)</option>
        </select>
        <div class="form-hint">Hint shown in plant details. Does not enforce anything.</div>
      </div>
      <div class="form-row">
        <label>Plant lifecycle</label>
        <select id="cp-lifecycle" onchange="document.getElementById('cp-dormant-row').style.display=this.value==='perennial'?'':'none'">
          <option value="annual"    ${!existing?.perennial && !existing?.biennial ? 'selected' : ''}>🌱 Annual</option>
          <option value="biennial"  ${existing?.biennial  ? 'selected' : ''}>🌿 Biennial (2 years — treated as annual for planning)</option>
          <option value="perennial" ${existing?.perennial ? 'selected' : ''}>♾️ Perennial (lives multiple years)</option>
        </select>
        <div class="form-hint">Perennials show as always-active in seasonal view except during dormant months. Biennials complete their cycle over two years but are planned like annuals.</div>
      </div>
      <div class="form-row" id="cp-dormant-row" style="display:${existing?.perennial ? '' : 'none'}">
        <label>Dormant months (comma-separated, 1=Jan)</label>
        <input id="cp-dormant" type="text" placeholder="e.g. 11,12,1,2" value="${(existing?.dormant??[]).join(',')}">
        <div class="form-hint">Months when the plant is dormant. Leave empty for year-round activity.</div>
      </div>
      <div class="form-row">
        <label>Sow months (comma-separated, 1=Jan)</label>
        <input id="cp-sow" type="text" placeholder="e.g. 3,4,5" value="${(existing?.sow??[]).join(',')}">
      </div>
      <div class="form-row">
        <label>Transplant months</label>
        <input id="cp-tr" type="text" placeholder="e.g. 5,6" value="${(existing?.tr??[]).join(',')}">
      </div>
      <div class="form-row">
        <label>Harvest months</label>
        <input id="cp-harv" type="text" placeholder="e.g. 7,8,9" value="${(existing?.harv??[]).join(',')}">
      </div>
      <div class="form-row">
        <label>Good companions (hold Ctrl to multi-select)</label>
        <select id="cp-good" multiple size="4">${multiOpts()}</select>
      </div>
      <div class="form-row">
        <label>Bad companions</label>
        <select id="cp-bad" multiple size="4">${multiOpts()}</select>
      </div>
      <div class="form-row">
        <label>Crop rotation family</label>
        ${familySelectHtml('cp-family', existing?.family || '', existing?.rotationDisabled || false)}
        <div class="form-hint">Sets the colored chip on the cell and the 3-year rotation warning. Choose "Disabled" to skip rotation tracking.</div>
      </div>
      <div class="form-row">
        <label>Growing notes</label>
        <textarea id="cp-notes">${escHtml(existing?.notes||'')}</textarea>
      </div>
      <input type="hidden" id="cp-id" value="${existing?.id||''}">
    `;

    // pre-select companions
    const preselect = (elId, ids) => {
      const sel = document.getElementById(elId);
      if (!sel || !ids?.length) return;
      [...sel.options].forEach(o => { o.selected = ids.includes(o.value); });
    };
    preselect('cp-good', existing?.good);
    preselect('cp-bad',  existing?.bad);

    Modal.open('cp-modal');
    document.getElementById('cp-modal-save').onclick = () => saveModal();
  }

  function saveModal() {
    const name = document.getElementById('cp-name').value.trim();
    if (!name) { alert('Plant name is required.'); return; }

    const parseMon = id => {
      const val = document.getElementById(id)?.value.trim();
      if (!val) return [];
      return val.split(',').map(v => parseInt(v.trim(), 10)).filter(n => n >= 1 && n <= 12);
    };
    const getMulti = id => {
      const sel = document.getElementById(id);
      return sel ? [...sel.options].filter(o => o.selected).map(o => o.value) : [];
    };

    const existId = document.getElementById('cp-id').value;
    const germinationDaysMinRaw = parseInt(document.getElementById('cp-germ-min').value, 10);
    const germinationDaysMaxRaw = parseInt(document.getElementById('cp-germ-max').value, 10);
    const germinationDaysMin = Number.isFinite(germinationDaysMinRaw) ? Math.max(0, germinationDaysMinRaw) : null;
    const germinationDaysMax = Number.isFinite(germinationDaysMaxRaw)
      ? Math.max(germinationDaysMin || 0, germinationDaysMaxRaw)
      : (germinationDaysMin !== null ? germinationDaysMin : null);
    const plant = {
      id:           existId || ('custom_' + Date.now()),
      name,
      emoji:        document.getElementById('cp-emoji').value.trim() || '🌱',
      cat:          document.getElementById('cp-cat').value,
      spacing:      document.getElementById('cp-spacing').value.trim() || '30×30',
      rowSpacing:   parseInt(document.getElementById('cp-row-spacing').value, 10) || 0,
      sun:          document.getElementById('cp-sun').value,
      water:        document.getElementById('cp-water').value,
      height:       document.getElementById('cp-height').value,
      daysToHarvest:document.getElementById('cp-days').value.trim() || '?',
      germinationDaysMin,
      germinationDaysMax,
      perennial:    document.getElementById('cp-lifecycle').value === 'perennial',
      biennial:     document.getElementById('cp-lifecycle').value === 'biennial',
      dormant:      parseMon('cp-dormant'),
      sow:          parseMon('cp-sow'),
      tr:           parseMon('cp-tr'),
      harv:         parseMon('cp-harv'),
      good:         getMulti('cp-good'),
      bad:          getMulti('cp-bad'),
      notes:        document.getElementById('cp-notes').value.trim(),
      family:       (document.getElementById('cp-family').value === '__disabled__' ? null : document.getElementById('cp-family').value) || null,
      rotationDisabled: document.getElementById('cp-family').value === '__disabled__',
      plantingMode: document.getElementById('cp-planting-mode').value || null,
    };

    Store.upsertCustomPlant(plant);
    Modal.close('cp-modal');
    render();
    Toast.show(existId ? `"${name}" updated` : `"${name}" added to library`);
  }

  function deleteP(id) {
    const p = Store.getCustomPlants().find(x => x.id === id);
    if (!confirm(`Delete custom plant "${p?.name}"? It will be removed from all beds.`)) return;
    Store.deleteCustomPlant(id);
    render();
    Toast.show('Plant deleted');
  }

  function cloneP(id) { cloneFromAny(id); }

  function cloneFromAny(id) {
    const src = PlantDB.get(id);
    if (!src) return;
    const cloned = {
      id: '',
      name: src.name + ' (copy)',
      emoji: src.emoji || '🌱',
      cat: src.cat || 'vegetable',
      spacing: src.spacing || '30×30',
      rowSpacing: src.rowSpacing || 0,
      cellsNeeded: src.cellsNeeded ?? 1,
      sun: src.sun || 'full',
      water: src.water || 'medium',
      height: src.height || 'medium',
      daysToHarvest: src.daysToHarvest || '',
      germinationDaysMin: src.germinationDaysMin ?? null,
      germinationDaysMax: src.germinationDaysMax ?? null,
      perennial: src.perennial || false,
      biennial:  src.biennial  || false,
      dormant: [...(src.dormant ?? [])],
      sow:  [...(src.sow  ?? [])],
      tr:   src.tr ? [...src.tr] : [],
      harv: [...(src.harv ?? [])],
      good: [...(src.good ?? [])],
      bad:  [...(src.bad  ?? [])],
      notes: src.notes || '',
      family: src.family || null,
      rotationDisabled: src.rotationDisabled || false,
      plantingMode: src.plantingMode || null,
    };
    openModal(cloned);
  }

  function copyFromSelected() {
    const sel = document.getElementById('cp-src-select');
    if (!sel?.value) { Toast.show('Select a plant to copy first'); return; }
    cloneFromAny(sel.value);
  }

  function setFilter(val) {
    filterText = String(val || '').toLowerCase().trim();
    render();
  }

  function setSourceFilter(val) {
    sourceFilter = ['all', 'builtin', 'custom'].includes(val) ? val : 'all';
    render();
  }

  return {
    render,
    openNew,
    openEdit,
    openModal,
    saveModal,
    deleteP,
    cloneP,
    cloneFromAny,
    copyFromSelected,
    setFilter,
    setSourceFilter,
  };
})();

// ================================================================
// CALENDAR VIEW
// ================================================================
const CalendarView = (() => {
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function render() {
    const beds   = Store.getBeds();
    const settings = Store.getSettings();
    const placed = [];
    beds.forEach(bed => {
      Object.values(bed.cells).forEach(cell => {
        if (!cellIsOrigin(cell)) return;
        const pid = cellPlantId(cell);
        if (pid) placed.push(pid);
      });
    });
    const uniquePlaced = [...new Set(placed)];
    const plants = uniquePlaced.map(id => PlantDB.get(id)).filter(Boolean);
    const el     = document.getElementById('cal-table-wrap');

    if (!plants.length) {
      el.innerHTML = `${settingsSummary(settings)}<div style="text-align:center;color:var(--text-muted);padding:60px;font-size:.9rem">
        <div style="font-size:3rem;margin-bottom:12px">📅</div>
        Place some plants in your beds first to see the planting calendar.
      </div>`;
      return;
    }

    let h = `<table class="cal-table"><thead><tr><th>Plant</th>`;
    MONTHS.forEach((m, idx) => {
      const month = idx + 1;
      const tags = [];
      if (month === monthNumber(settings.lastFrost)) tags.push('LF');
      if (month === monthNumber(settings.firstFrost)) tags.push('FF');
      const klass = tags.length ? ' class="cal-frost-col"' : '';
      h += `<th${klass}>${m}${tags.length ? `<span class="cal-frost-tag">${tags.join('/')}</span>` : ''}</th>`;
    });
    h += `</tr></thead><tbody>`;
    plants.forEach(p => {
      h += `<tr><td>${p.emoji} ${escHtml(p.name)}</td>`;
      for (let m = 1; m <= 12; m++) {
        const sow  = (p.sow  ?? []).includes(m);
        const tr   = (p.tr   ?? []).includes(m);
        const harv = (p.harv ?? []).includes(m);
        let bg = 'transparent', sym = '', title = '';
        if (harv) { bg = '#e8f5e9'; sym = '🌾'; title = 'Harvest'; }
        if (tr)   { bg = '#e3f2fd'; sym = '🌱'; title = 'Transplant'; }
        if (sow)  { bg = '#fff8e1'; sym = '🌰'; title = 'Sow'; }
        const outdoor = inOutdoorWindow(m, settings);
        const frostClass = outdoor ? '' : ' class="cal-outside-season"';
        h += `<td${frostClass} style="background:${bg}" title="${title}${title && !outdoor ? ' · ' : ''}${!outdoor ? 'Outside main frost-free window' : ''}">${sym}</td>`;
      }
      h += `</tr>`;
    });
    h += `</tbody></table>
    <div class="cal-legend">
      <span>🌰 Direct sow</span>
      <span>🌱 Transplant</span>
      <span>🌾 Harvest</span>
      <span><strong>LF</strong> Last frost month</span>
      <span><strong>FF</strong> First frost month</span>
    </div>`;
    el.innerHTML = settingsSummary(settings) + h;
  }

  function settingsSummary(settings) {
    const location = settings.locationName ? `${escHtml(settings.locationName)}${settings.growingZone ? ` · Zone ${escHtml(settings.growingZone)}` : ''}` : (settings.growingZone ? `Zone ${escHtml(settings.growingZone)}` : 'No location set');
    return `<div class="season-summary">
      <div class="season-card"><div class="season-label">Location</div><div class="season-value">${location}</div></div>
      <div class="season-card"><div class="season-label">Last frost</div><div class="season-value">${fmtShortDate(settings.lastFrost)}</div></div>
      <div class="season-card"><div class="season-label">First frost</div><div class="season-value">${fmtShortDate(settings.firstFrost)}</div></div>
      <div class="season-card"><div class="season-label">Main outdoor window</div><div class="season-value">${fmtShortDate(settings.lastFrost)} to ${fmtShortDate(settings.firstFrost)}</div></div>
    </div>`;
  }

  return { render };
})();

// ================================================================
// BUILT-IN PLANT EDITOR (overrides)
// ================================================================
const BuiltinPlants = (() => {
  function openEdit(id) {
    const current = PlantDB.get(id);
    const base = PlantDB.builtinBase(id);
    if (!current || !base) {
      Toast.show('Built-in plant not found');
      return;
    }

    const allPlants = PlantDB.all();
    const optHtml = allPlants.map(p => `<option value="${p.id}">${p.emoji} ${escHtml(p.name)}</option>`).join('');
    const toCsv = arr => (arr || []).join(',');

    document.getElementById('bp-modal-body').innerHTML = `
      <div class="form-row-inline">
        <div class="form-row" style="flex:.15">
          <label>Icon</label>
          <input id="bp-emoji" type="text" maxlength="4" value="${escAttr(current.emoji || '🌱')}" style="font-size:1.5rem;text-align:center">
        </div>
        <div class="form-row" style="flex:1">
          <label>Plant name *</label>
          <input id="bp-name" type="text" value="${escAttr(current.name || '')}">
        </div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Category</label>
          <select id="bp-cat">
            ${['vegetable','herb','fruit','flower'].map(c => `<option value="${c}" ${current.cat===c?'selected':''}>${capFirst(c)}</option>`).join('')}
          </select>
        </div>
        <div class="form-row">
          <label>Plant spacing (cm×cm)</label>
          <input id="bp-spacing" type="text" value="${escAttr(current.spacing || '10×10')}">
          <div class="form-hint">Size of one plant's footprint on the grid.</div>
        </div>
        <div class="form-row">
          <label>Row spacing (cm)</label>
          <input id="bp-row-spacing" type="number" min="0" step="1" placeholder="0" value="${current.rowSpacing || ''}">
          <div class="form-hint">Extra gap between rows beyond the plant footprint (0 = rows touch).</div>
        </div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Sun</label>
          <select id="bp-sun">
            <option value="full" ${current.sun==='full'?'selected':''}>Full sun</option>
            <option value="partial" ${current.sun==='partial'?'selected':''}>Partial</option>
            <option value="shade" ${current.sun==='shade'?'selected':''}>Shade</option>
          </select>
        </div>
        <div class="form-row">
          <label>Water</label>
          <select id="bp-water">
            <option value="low" ${current.water==='low'?'selected':''}>Low</option>
            <option value="medium" ${current.water==='medium'?'selected':''}>Medium</option>
            <option value="high" ${current.water==='high'?'selected':''}>High</option>
          </select>
        </div>
        <div class="form-row">
          <label>Height</label>
          <select id="bp-height">
            <option value="low" ${current.height==='low'?'selected':''}>Low</option>
            <option value="medium" ${current.height==='medium'?'selected':''}>Medium</option>
            <option value="tall" ${current.height==='tall'?'selected':''}>Tall</option>
            <option value="vine" ${current.height==='vine'?'selected':''}>Vine</option>
          </select>
        </div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Days to harvest</label>
          <input id="bp-days" type="text" value="${escAttr(current.daysToHarvest || '')}">
        </div>
        <div class="form-row">
          <label>Germination (min days)</label>
          <input id="bp-germ-min" type="number" min="0" step="1" value="${current.germinationDaysMin ?? ''}">
        </div>
        <div class="form-row">
          <label>Germination (max days)</label>
          <input id="bp-germ-max" type="number" min="0" step="1" value="${current.germinationDaysMax ?? ''}">
        </div>
      </div>
      <div class="form-row">
        <label>Crop rotation family</label>
        ${familySelectHtml('bp-family', current.family || '', current.rotationDisabled || false)}
        <div class="form-hint">Sets the colored chip on the cell and the 3-year rotation warning. Choose "Disabled" to skip rotation tracking.</div>
      </div>
      <div class="form-row">
        <label>Preferred planting method</label>
        <select id="bp-planting-mode">
          <option value="">Not specified</option>
          <option value="direct"    ${current.plantingMode==='direct'    ?'selected':''}>Direct sow</option>
          <option value="transplant"${current.plantingMode==='transplant'?'selected':''}>Transplant (start in tray)</option>
        </select>
        <div class="form-hint">Hint shown in plant details. Does not enforce anything.</div>
      </div>
      <div class="form-row">
        <label>Plant lifecycle</label>
        <select id="bp-lifecycle" onchange="document.getElementById('bp-dormant-row').style.display=this.value==='perennial'?'':'none'">
          <option value="annual"    ${!current.perennial && !current.biennial ? 'selected' : ''}>🌱 Annual</option>
          <option value="biennial"  ${current.biennial  ? 'selected' : ''}>🌿 Biennial (2 years — treated as annual for planning)</option>
          <option value="perennial" ${current.perennial ? 'selected' : ''}>♾️ Perennial (lives multiple years)</option>
        </select>
        <div class="form-hint">Perennials show as always-active in seasonal view except during dormant months. Biennials complete their cycle over two years but are planned like annuals.</div>
      </div>
      <div class="form-row" id="bp-dormant-row" style="display:${current.perennial ? '' : 'none'}">
        <label>Dormant months (comma-separated, 1=Jan)</label>
        <input id="bp-dormant" type="text" placeholder="e.g. 11,12,1,2" value="${escAttr(toCsv(current.dormant))}">
        <div class="form-hint">Months when the plant is dormant. Leave empty for year-round activity.</div>
      </div>
      <div class="form-row"><label>Sow months</label><input id="bp-sow" type="text" value="${escAttr(toCsv(current.sow))}" placeholder="e.g. 3,4,5"></div>
      <div class="form-row"><label>Transplant months</label><input id="bp-tr" type="text" value="${escAttr(toCsv(current.tr))}" placeholder="e.g. 5,6"></div>
      <div class="form-row"><label>Harvest months</label><input id="bp-harv" type="text" value="${escAttr(toCsv(current.harv))}" placeholder="e.g. 7,8,9"></div>
      <div class="form-row"><label>Good companions</label><select id="bp-good" multiple size="4">${optHtml}</select></div>
      <div class="form-row"><label>Bad companions</label><select id="bp-bad" multiple size="4">${optHtml}</select></div>
      <div class="form-row"><label>Growing notes</label><textarea id="bp-notes">${escHtml(current.notes || '')}</textarea></div>
      <input type="hidden" id="bp-id" value="${current.id}">
    `;

    const preselect = (elId, ids) => {
      const sel = document.getElementById(elId);
      if (!sel || !ids?.length) return;
      [...sel.options].forEach(o => { o.selected = ids.includes(o.value); });
    };
    preselect('bp-good', current.good);
    preselect('bp-bad', current.bad);

    document.getElementById('bp-modal-save').onclick = save;
    document.getElementById('bp-modal-reset').onclick = reset;
    Modal.open('bp-modal');

    function parseMon(id) {
      const val = document.getElementById(id)?.value.trim();
      if (!val) return [];
      return val.split(',').map(v => parseInt(v.trim(), 10)).filter(n => n >= 1 && n <= 12);
    }

    function getMulti(id) {
      const sel = document.getElementById(id);
      return sel ? [...sel.options].filter(o => o.selected).map(o => o.value) : [];
    }

    function save() {
      const plantId = document.getElementById('bp-id').value;
      const name = document.getElementById('bp-name').value.trim();
      const germinationDaysMinRaw = parseInt(document.getElementById('bp-germ-min').value, 10);
      const germinationDaysMaxRaw = parseInt(document.getElementById('bp-germ-max').value, 10);
      const germinationDaysMin = Number.isFinite(germinationDaysMinRaw) ? Math.max(0, germinationDaysMinRaw) : null;
      const germinationDaysMax = Number.isFinite(germinationDaysMaxRaw)
        ? Math.max(germinationDaysMin || 0, germinationDaysMaxRaw)
        : (germinationDaysMin !== null ? germinationDaysMin : null);
      if (!name) {
        alert('Plant name is required.');
        return;
      }
      Store.upsertBuiltinPlantOverride(plantId, {
        name,
        emoji: document.getElementById('bp-emoji').value.trim() || '🌱',
        cat: document.getElementById('bp-cat').value,
        spacing: document.getElementById('bp-spacing').value.trim() || '10×10',
        rowSpacing: parseInt(document.getElementById('bp-row-spacing').value, 10) || 0,
        sun: document.getElementById('bp-sun').value,
        water: document.getElementById('bp-water').value,
        height: document.getElementById('bp-height').value,
        daysToHarvest: document.getElementById('bp-days').value.trim() || '?',
        germinationDaysMin,
        germinationDaysMax,
        family: (document.getElementById('bp-family').value === '__disabled__' ? null : document.getElementById('bp-family').value) || null,
        rotationDisabled: document.getElementById('bp-family').value === '__disabled__',
        plantingMode: document.getElementById('bp-planting-mode').value || null,
        perennial: document.getElementById('bp-lifecycle').value === 'perennial',
        biennial:  document.getElementById('bp-lifecycle').value === 'biennial',
        dormant: parseMon('bp-dormant'),
        sow: parseMon('bp-sow'),
        tr: parseMon('bp-tr'),
        harv: parseMon('bp-harv'),
        good: getMulti('bp-good'),
        bad: getMulti('bp-bad'),
        notes: document.getElementById('bp-notes').value.trim(),
      });
      Modal.close('bp-modal');
      Beds.renderLibrary();
      Beds.renderCanvas();
      Inventory.render();
      CustomPlants.render();
      Toast.show('Built-in plant updated');
    }

    function reset() {
      const plantId = document.getElementById('bp-id').value;
      if (!confirm('Reset this built-in plant to default values?')) return;
      Store.deleteBuiltinPlantOverride(plantId);
      Modal.close('bp-modal');
      Beds.renderLibrary();
      Beds.renderCanvas();
      Inventory.render();
      CustomPlants.render();
      Toast.show('Built-in plant reset to defaults');
    }
  }

  return { openEdit };
})();

// ================================================================
// STATISTICS VIEW
// ================================================================
const StatsView = (() => {
  let filterText     = '';
  let seedFilterText = '';
  let bedFilter      = 'all';
  let seasonFilter   = 'current';
  let compareYear    = '';
  let compareEnabled = false;
  let bedSortKey      = 'plants';
  let bedSortDir      = 'desc';
  let bedCompareLeft  = '';
  let bedCompareRight = '';

  const LC_LABEL = {
    planned: 'Planned',
    direct_sow: 'Direct sowing',
    tray_seeded: 'Seedling tray',
    germinated: 'Germinated',
    transplanted: 'Transplanted',
    growing: 'Growing',
    harvested_once: 'Harvested (one-off)',
    harvested_continuous: 'Harvesting continuous',
    gone_to_seed: 'Gone to seed',
    failed: 'Failed',
  };

  function safeQty(value) {
    return Math.max(1, Number(value) || 1);
  }

  function eventBedContextId(event) {
    return event?.bedContextId || event?.bedId || '';
  }

  function eventBedContextName(event, contextMap) {
    const id = eventBedContextId(event);
    if (id && contextMap.has(id)) return contextMap.get(id).name;
    return event?.bedContextName || event?.bedName || id || 'Bed';
  }

  function zoneIdForPlotItem(item) {
    return item?.id || item?.bedId || `${item?.minR}:${item?.minC}:${item?.maxR}:${item?.maxC}`;
  }

  function bedContextIdForZone(bedId, zoneId) {
    return `${bedId}::${zoneId}`;
  }

  function zoneContainsCell(zone, r, c) {
    if (!zone) return false;
    return r >= zone.minR && r <= zone.maxR && c >= zone.minC && c <= zone.maxC;
  }

  function parseCellContext(bed, cell, key) {
    const explicitId = cell?.bedContextId || null;
    const explicitName = cell?.bedContextName || null;
    if (explicitId || explicitName) {
      return {
        id: explicitId || bed.id,
        name: explicitName || bed.name,
      };
    }
    const [r, c] = String(key || '').split(',').map(Number);
    if (Number.isFinite(r) && Number.isFinite(c)) {
      const zone = (Array.isArray(bed.plotLayout) ? bed.plotLayout : []).find(item => zoneContainsCell(item, r, c)) || null;
      if (zone) {
        const zId = zoneIdForPlotItem(zone);
        const zName = (zone.name || 'Zone').trim() || 'Zone';
        return {
          id: bedContextIdForZone(bed.id, zId),
          name: `${bed.name} · ${zName}`,
        };
      }
    }
    return { id: bed.id, name: bed.name };
  }

  function buildBedContexts(beds, events = []) {
    const map = new Map();
    beds.forEach(bed => {
      map.set(bed.id, {
        id: bed.id,
        name: bed.name,
        areaM2: (bed.widthM || 0) * (bed.heightM || 0),
        totalCells: (bed.cols || 0) * (bed.rows || 0),
      });
      (Array.isArray(bed.plotLayout) ? bed.plotLayout : []).forEach(zone => {
        const zoneId = zoneIdForPlotItem(zone);
        const ctxId = bedContextIdForZone(bed.id, zoneId);
        const rows = Math.max(0, (zone.maxR - zone.minR + 1));
        const cols = Math.max(0, (zone.maxC - zone.minC + 1));
        const totalCells = rows * cols;
        map.set(ctxId, {
          id: ctxId,
          name: `${bed.name} · ${(zone.name || 'Zone').trim() || 'Zone'}`,
          areaM2: totalCells * 0.01,
          totalCells,
        });
      });
    });
    events.forEach(event => {
      const id = eventBedContextId(event);
      if (!id || map.has(id)) return;
      map.set(id, {
        id,
        name: event.bedContextName || event.bedName || id,
        areaM2: 0,
        totalCells: 0,
      });
    });
    return map;
  }

  function bedByIdMap(beds) {
    const map = new Map();
    beds.forEach(b => map.set(b.id, b));
    return map;
  }

  function contextFilterSet(filterId, bedContexts, bedsById) {
    if (!filterId || filterId === 'all') return null;
    if (!bedContexts.has(filterId)) return new Set([filterId]);
    if (filterId.includes('::')) return new Set([filterId]);
    const bed = bedsById.get(filterId);
    const hasZones = !!(bed && Array.isArray(bed.plotLayout) && bed.plotLayout.length);
    const out = new Set();
    if (hasZones) {
      const prefix = `${filterId}::`;
      Array.from(bedContexts.keys()).forEach(id => {
        if (id.startsWith(prefix)) out.add(id);
      });
      if (!out.size) out.add(filterId);
      return out;
    }
    out.add(filterId);
    return out;
  }

  function isContextInFilter(contextId, filterSet) {
    if (!filterSet) return true;
    return filterSet.has(contextId);
  }

  function deltaHtml(currentValue, previousValue) {
    if (previousValue === null || previousValue === undefined || currentValue === null || currentValue === undefined) return '';
    const diff = currentValue - previousValue;
    const cls = diff > 0 ? 'positive' : diff < 0 ? 'negative' : 'neutral';
    const prefix = diff > 0 ? '+' : '';
    return ` <span class="stats-delta ${cls}">(${prefix}${diff})</span>`;
  }

  function metricHtml(value, previousValue = null, suffix = '') {
    if (value === null || value === undefined) return 'n/a';
    return `${value}${suffix}${deltaHtml(value, previousValue)}`;
  }

  function buildCurrentSnapshot(scopedBeds, filterSet = null) {
    const varieties = new Set();
    const families = new Set();
    let plants = 0;
    let harvested = 0;
    let failed = 0;
    let totalArea = 0;
    let totalCells = 0;
    let occupiedCells = 0;

    const contextMap = buildBedContexts(scopedBeds, []);
    const agg = new Map();

    function ensureContext(ctxId, fallbackName = 'Bed') {
      const base = contextMap.get(ctxId) || { id: ctxId, name: fallbackName, areaM2: 0, totalCells: 0 };
      if (!agg.has(ctxId)) {
        agg.set(ctxId, {
          id: ctxId,
          name: base.name || fallbackName,
          areaM2: Number(base.areaM2) || 0,
          totalCells: Number(base.totalCells) || 0,
          occupiedCells: 0,
          plants: 0,
          harvested: 0,
          failed: 0,
          varieties: new Set(),
          families: new Set(),
        });
      }
      return agg.get(ctxId);
    }

    scopedBeds.forEach(bed => {
      Object.entries(bed.cells || {}).forEach(([key, rawCell]) => {
        const cell = (typeof rawCell === 'string')
          ? { plantId: rawCell, instanceId: key, origin: true, lifecycle: 'planned' }
          : rawCell;
        const context = parseCellContext(bed, cell, key);
        if (!isContextInFilter(context.id, filterSet)) return;
        const row = ensureContext(context.id, context.name);
        row.occupiedCells += 1;
        if (!cellIsOrigin(cell)) return;
        const pid = cellPlantId(cell);
        if (!pid || pid === '__path__') return;
        const qty = typeof cell === 'string' ? 1 : Math.max(1, cell?.rowBlockTotal || 1);
        const plant = PlantDB.get(pid);
        const state = typeof cell === 'string' ? 'planned' : (cell.lifecycle || 'planned');

        row.plants += qty;
        row.varieties.add(pid);
        if (plant?.family) row.families.add(plant.family);
        if (state === 'harvested_once' || state === 'harvested_continuous') row.harvested += qty;
        if (state === 'failed') row.failed += qty;
      });
    });

    contextMap.forEach((ctx, id) => {
      if (!isContextInFilter(id, filterSet)) return;
      ensureContext(id, ctx.name || 'Bed');
    });

    const bedRows = Array.from(agg.values()).map(row => {
      const resolved = row.harvested + row.failed;
      totalArea += row.areaM2;
      totalCells += row.totalCells;
      occupiedCells += row.occupiedCells;
      plants += row.plants;
      row.varieties.forEach(v => varieties.add(v));
      row.families.forEach(f => families.add(f));
      harvested += row.harvested;
      failed += row.failed;
      return {
        id: row.id,
        name: row.name,
        areaM2: row.areaM2,
        totalCells: row.totalCells,
        occupiedCells: row.occupiedCells,
        freeCells: Math.max(0, row.totalCells - row.occupiedCells),
        plants: row.plants,
        varieties: row.varieties.size,
        families: row.families.size,
        harvested: row.harvested,
        failed: row.failed,
        rate: resolved ? Math.round((row.harvested / resolved) * 100) : null,
      };
    }).sort((a, b) => b.plants - a.plants || a.name.localeCompare(b.name));

    return {
      beds: bedRows.length,
      areaM2: totalArea,
      totalCells,
      occupiedCells,
      freeCells: Math.max(0, totalCells - occupiedCells),
      plants,
      varieties: varieties.size,
      families: families.size,
      harvested,
      failed,
      rate: harvested + failed ? Math.round((harvested / (harvested + failed)) * 100) : null,
      bedRows,
    };
  }

  function buildArchivedSnapshot(historyEntries) {
    const varieties = new Set();
    const families = new Set();
    let plants = 0;
    let harvested = 0;
    let failed = 0;
    let totalArea = 0;
    let totalCells = 0;
    let occupiedCells = 0;

    const bedRows = historyEntries.map(entry => {
      const plantCounts = entry.plantCounts || {};
      const familyCounts = entry.familyCounts || {};
      const lifecycleCounts = entry.lifecycleCounts || {};
      Object.keys(plantCounts).forEach(pid => varieties.add(pid));
      Object.keys(familyCounts).forEach(fam => families.add(fam));
      const bedPlants = Object.values(plantCounts).reduce((sum, count) => sum + count, 0);
      const bedHarvested = (lifecycleCounts.harvested_once || 0) + (lifecycleCounts.harvested_continuous || 0);
      const bedFailed = (lifecycleCounts.failed || 0) + (lifecycleCounts.failed_germination || 0) + (lifecycleCounts.failed_plant || 0);
      const bedAreaM2 = Number(entry.areaM2) || ((Number(entry.widthM) || 0) * (Number(entry.heightM) || 0));
      const bedTotalCells = Number(entry.totalCells) || ((Number(entry.rows) || 0) * (Number(entry.cols) || 0));
      const bedOccupiedCells = Number(entry.occupiedCells) || 0;
      const bedFreeCells = Number(entry.freeCells);
      plants += bedPlants;
      harvested += bedHarvested;
      failed += bedFailed;
      totalArea += bedAreaM2;
      totalCells += bedTotalCells;
      occupiedCells += bedOccupiedCells;
      const resolved = bedHarvested + bedFailed;
      return {
        id: entry.bedId,
        name: entry.bedName,
        areaM2: bedAreaM2,
        totalCells: bedTotalCells,
        occupiedCells: bedOccupiedCells,
        freeCells: Number.isFinite(bedFreeCells) ? bedFreeCells : Math.max(0, bedTotalCells - bedOccupiedCells),
        plants: bedPlants,
        varieties: Object.keys(plantCounts).length,
        families: Object.keys(familyCounts).length,
        harvested: bedHarvested,
        failed: bedFailed,
        rate: resolved ? Math.round((bedHarvested / resolved) * 100) : null,
      };
    }).sort((a, b) => b.plants - a.plants || a.name.localeCompare(b.name));

    return {
      beds: historyEntries.length,
      areaM2: totalArea,
      totalCells,
      occupiedCells,
      freeCells: Math.max(0, totalCells - occupiedCells),
      plants,
      varieties: varieties.size,
      families: families.size,
      harvested,
      failed,
      rate: harvested + failed ? Math.round((harvested / (harvested + failed)) * 100) : null,
      bedRows,
    };
  }

  function buildPlantRows(seasonEvents, scopedBeds, includeCurrentBaseline, filterSet = null) {
    const byPlant = {};
    const ensure = pid => {
      if (!byPlant[pid]) byPlant[pid] = {
        planned: 0,
        direct_sow: 0,
        tray_seeded: 0,
        germinated: 0,
        transplanted: 0,
        growing: 0,
        harvested_once: 0,
        harvested_continuous: 0,
        gone_to_seed: 0,
        failed: 0,
      };
      return byPlant[pid];
    };

    seasonEvents.forEach(event => {
      const rec = ensure(event.plantId);
      if (event.toState && Object.prototype.hasOwnProperty.call(rec, event.toState)) {
        rec[event.toState] += safeQty(event.qty);
      }
    });

    if (includeCurrentBaseline) {
      scopedBeds.forEach(bed => {
        Object.entries(bed.cells || {}).forEach(([key, rawCell]) => {
          const cell = typeof rawCell === 'string'
            ? { plantId: rawCell, instanceId: key, origin: true, lifecycle: 'planned' }
            : rawCell;
          const ctx = parseCellContext(bed, cell, key);
          if (!isContextInFilter(ctx.id, filterSet)) return;
          if (!cellIsOrigin(cell)) return;
          const pid = cellPlantId(cell);
          if (!pid || pid === '__path__') return;
          const state = typeof cell === 'string' ? 'planned' : (cell.lifecycle || 'planned');
          const qty = typeof cell === 'string' ? 1 : Math.max(1, cell?.rowBlockTotal || 1);
          const rec = ensure(pid);
          if (Object.prototype.hasOwnProperty.call(rec, state)) rec[state] += qty;
        });
      });
    }

    return Object.entries(byPlant)
      .map(([pid, rec]) => {
        const plant = PlantDB.get(pid);
        const harvested = rec.harvested_once + rec.harvested_continuous;
        const resolved = harvested + rec.failed;
        return {
          pid,
          name: plant?.name || pid,
          emoji: plant?.emoji || '🌱',
          ...rec,
          harvested,
          rate: resolved ? Math.round((harvested / resolved) * 100) : null,
          resolved,
        };
      })
      .sort((a, b) => (b.resolved - a.resolved) || a.name.localeCompare(b.name));
  }

  function buildSeedStats(seed, seasonEvents, contextMap) {
    const seedEvents = seasonEvents.filter(event => event.seedId === seed.id).sort((a, b) => (a.ts < b.ts ? 1 : -1));
    const sumQty = state => seedEvents.filter(event => event.toState === state).reduce((sum, event) => sum + safeQty(event.qty), 0);
    const directSow = sumQty('direct_sow');
    const traySeeded = sumQty('tray_seeded');
    const started = directSow + traySeeded;
    const germinated = sumQty('germinated');
    const harvestedOnce = sumQty('harvested_once');
    const harvestedContinuous = sumQty('harvested_continuous');
    const harvested = harvestedOnce + harvestedContinuous;
    const failedGermination = sumQty('failed_germination');
    const failedPlant = sumQty('failed_plant');
    const failed = sumQty('failed') + failedGermination + failedPlant; // legacy + new
    const transplanted = sumQty('transplanted');
    const resolved = harvested + failedPlant + sumQty('failed');
    const harvestRate = resolved ? Math.round((harvested / resolved) * 100) : null;
    // germination rate: germinated vs (started + failed_germination)
    const germinationRate = started ? Math.round((germinated / (started + failedGermination)) * 100) : null;
    const starts = seedEvents
      .filter(event => event.toState === 'direct_sow' || event.toState === 'tray_seeded')
      .slice()
      .sort((a, b) => (a.ts < b.ts ? -1 : 1));
    const firstStart = starts[0] || null;
    const firstGermination = seedEvents
      .filter(event => event.toState === 'germinated')
      .slice()
      .sort((a, b) => (a.ts < b.ts ? -1 : 1))[0] || null;
    let germinationDays = null;
    if (firstStart && firstGermination) {
      const startDay = String(firstStart.eventDate || firstStart.ts || '').slice(0, 10);
      const germDay = String(firstGermination.eventDate || firstGermination.ts || '').slice(0, 10);
      const a = new Date(`${startDay}T00:00:00Z`);
      const b = new Date(`${germDay}T00:00:00Z`);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) {
        germinationDays = Math.round((b - a) / 86400000);
      }
    }
    const bedsUsed = [...new Set(seedEvents.map(event => eventBedContextId(event)).filter(Boolean))]
      .map(ctxId => contextMap.get(ctxId)?.name || ctxId);
    return {
      seedEvents,
      harvested,
      harvestedOnce,
      harvestedContinuous,
      failed,
      directSow,
      traySeeded,
      started,
      germinated,
      transplanted,
      germinationDays,
      germinationRate,
      harvestRate,
      bedsUsed,
    };
  }

  function setFilter(val) {
    filterText = String(val || '').toLowerCase().trim();
    render();
    // Restore focus after full re-render so typing isn't interrupted
    const inp = document.getElementById('stats-plant-filter');
    if (inp) { inp.focus(); inp.setSelectionRange(val.length, val.length); }
  }

  function setSeedFilter(val) {
    seedFilterText = String(val || '').toLowerCase().trim();
    render();
    const inp = document.getElementById('stats-seed-filter');
    if (inp) { inp.focus(); inp.setSelectionRange(val.length, val.length); }
  }

  function setBedFilter(val) {
    bedFilter = val || 'all';
    render();
    const inp = document.getElementById('stats-plant-filter');
    if (inp) { inp.focus(); }
  }

  function setBedSort(key) {
    if (bedSortKey === key) bedSortDir = bedSortDir === 'asc' ? 'desc' : 'asc';
    else {
      bedSortKey = key;
      bedSortDir = key === 'name' ? 'asc' : 'desc';
    }
    render();
  }

  function setBedCompareLeft(val) {
    bedCompareLeft = val || '';
    render();
  }

  function setBedCompareRight(val) {
    bedCompareRight = val || '';
    render();
  }

  function setSeasonFilter(val) {
    seasonFilter = val || 'current';
    if (String(compareYear) === String(val)) {
      compareYear = '';
      compareEnabled = false;
    }
    render();
  }

  function setCompareYear(val) {
    compareYear = val || '';
    if (!compareYear) compareEnabled = false;
    render();
  }

  function toggleCompare() {
    if (!compareYear) {
      Toast.show('Select a season to compare first');
      return;
    }
    compareEnabled = !compareEnabled;
    render();
  }

  function render() {
    const wrap = document.getElementById('stats-wrap');
    if (!wrap) return;

    const beds    = Store.getBeds();
    const history = Store.getBedHistory();
    const events  = Store.getLifecycleJournal();
    const seeds   = Store.getInventory();
    const bedsById = bedByIdMap(beds);
    const bedContexts = buildBedContexts(beds, events);
    const contextList = Array.from(bedContexts.values()).sort((a, b) => a.name.localeCompare(b.name));
    if (bedFilter !== 'all' && !bedContexts.has(bedFilter)) bedFilter = 'all';
    const scopedBeds = beds;
    const selectedFilterSet = contextFilterSet(bedFilter, bedContexts, bedsById);
    const currentYear = activeSeasonYear();
    const archivedYears = [...new Set([
      ...history.map(entry => Number(entry.year)),
      ...events.map(event => Number(event.seasonYear)).filter(Boolean),
    ])].filter(year => year !== currentYear).sort((a, b) => b - a);
    const allYears = ['current', ...archivedYears.map(String)];
    if (seasonFilter !== 'current' && !allYears.includes(String(seasonFilter))) {
      seasonFilter = 'current';
    }
    const seasonYear = seasonFilter === 'current' ? currentYear : parseInt(seasonFilter, 10);
    const seasonEvents = events.filter(event => Number(event.seasonYear) === seasonYear && isContextInFilter(eventBedContextId(event), selectedFilterSet));
    const seasonHistoryEntries = history.filter(entry => Number(entry.year) === seasonYear && (bedFilter === 'all' || entry.bedId === bedFilter));
    const compareYears = allYears.filter(year => String(year) !== String(seasonFilter));
    if (compareYear && !compareYears.includes(String(compareYear))) {
      compareYear = '';
      compareEnabled = false;
    }
    const compareActive = compareEnabled && compareYear;
    const compareSeasonYear = compareActive && compareYear !== 'current' ? parseInt(compareYear, 10) : currentYear;
    const compareEvents = compareActive
      ? events.filter(event => Number(event.seasonYear) === compareSeasonYear && isContextInFilter(eventBedContextId(event), selectedFilterSet))
      : [];
    const compareHistoryEntries = compareActive
      ? history.filter(entry => Number(entry.year) === compareSeasonYear && (bedFilter === 'all' || entry.bedId === bedFilter))
      : [];

    const bedFilterOptions = [`<option value="all" ${bedFilter==='all'?'selected':''}>All beds</option>`,
      ...contextList.map(ctx => `<option value="${ctx.id}" ${bedFilter===ctx.id?'selected':''}>${escHtml(ctx.name)}</option>`)
    ].join('');

    const snapshot = seasonFilter === 'current'
      ? buildCurrentSnapshot(scopedBeds, selectedFilterSet)
      : buildArchivedSnapshot(seasonHistoryEntries);
    const compareSnapshot = compareActive
      ? (compareYear === 'current' ? buildCurrentSnapshot(scopedBeds, selectedFilterSet) : buildArchivedSnapshot(compareHistoryEntries))
      : null;

    const rows = buildPlantRows(seasonEvents, scopedBeds, seasonFilter === 'current', selectedFilterSet);
    const compareRows = compareActive ? buildPlantRows(compareEvents, scopedBeds, compareYear === 'current', selectedFilterSet) : [];
    const compareBedMap = new Map((compareSnapshot?.bedRows || []).map(row => [row.id || row.name, row]));

    // Plant details section follows the global Filters scope.
    const plantSectionRows = rows;
    const comparePlantSectionRows = compareActive
      ? (() => {
          return compareRows;
        })()
      : [];
    const comparePlantSectionMap = new Map(comparePlantSectionRows.map(row => [row.pid, row]));
    const plantSectionFilteredRows = filterText
      ? plantSectionRows.filter(r => r.name.toLowerCase().includes(filterText) || r.pid.toLowerCase().includes(filterText))
      : plantSectionRows;

    const totalEvents = seasonEvents.length;

    // ── Seed performance ─────────────────────────────────────────
    const seedsInScope = bedFilter === 'all'
      ? seeds
      : seeds.filter(s => seasonEvents.some(e => e.seedId === s.id));
    const filteredSeeds = seedFilterText
      ? seedsInScope.filter(s => {
          const p = PlantDB.get(s.plantId);
          return (p?.name||'').toLowerCase().includes(seedFilterText)
              || (s.variety||'').toLowerCase().includes(seedFilterText)
              || (s.seedTag||'').toLowerCase().includes(seedFilterText);
        })
      : seedsInScope;

    // ── Germination data coverage ───────────────────────────────
    const allPlantsForCoverage = PlantDB.all().filter(p => !p._isPath && p.id !== '__path__');
    const hasPlantGerm = plant => {
      const min = parseInt(plant?.germinationDaysMin, 10);
      const max = parseInt(plant?.germinationDaysMax, 10);
      return Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max >= min;
    };
    const plantCoverageTotal = allPlantsForCoverage.length;
    const plantCoverageExpected = allPlantsForCoverage.filter(hasPlantGerm).length;
    const plantCoverageMissing = Math.max(0, plantCoverageTotal - plantCoverageExpected);

    const hasSeedOverride = seed => {
      const min = parseInt(seed?.germinationDaysMin, 10);
      const max = parseInt(seed?.germinationDaysMax, 10);
      return Number.isFinite(min) || Number.isFinite(max);
    };
    const seedCoverageTotal = seeds.length;
    const seedCoverageOverrides = seeds.filter(hasSeedOverride).length;
    const seedCoverageInherited = seeds.filter(seed => !hasSeedOverride(seed) && hasPlantGerm(PlantDB.get(seed.plantId))).length;
    const seedCoverageMissing = Math.max(0, seedCoverageTotal - seedCoverageOverrides - seedCoverageInherited);

    const compareSeedStatsMap = compareActive
      ? new Map(seeds.map(seed => [seed.id, buildSeedStats(seed, compareEvents, bedContexts)]))
      : new Map();

    const seedCardsHtml = filteredSeeds.length
      ? filteredSeeds.map(seed => {
          const p = PlantDB.get(seed.plantId);
          const stats = buildSeedStats(seed, seasonEvents, bedContexts);
          const compareStats = compareSeedStatsMap.get(seed.id) || null;
          const expectedGermMin = Math.max(0, parseInt(seed.germinationDaysMin ?? p?.germinationDaysMin, 10) || 0);
          const expectedGermMax = Math.max(expectedGermMin, parseInt(seed.germinationDaysMax ?? p?.germinationDaysMax, 10) || expectedGermMin);
          const germinationSpeedHtml = (() => {
            if (stats.germinationDays === null || expectedGermMax <= 0) return '';
            if (stats.germinationDays < expectedGermMin) {
              return `<div class="stats-seed-beds">⚡ Germinated ${expectedGermMin - stats.germinationDays}d faster than expected</div>`;
            }
            if (stats.germinationDays > expectedGermMax) {
              return `<div class="stats-seed-beds">🐢 Germinated ${stats.germinationDays - expectedGermMax}d slower than expected</div>`;
            }
            return `<div class="stats-seed-beds">✅ Germinated within expected range</div>`;
          })();
          const evtHtml = stats.seedEvents.slice(0, 20).map(e => {
            const bedName = eventBedContextName(e, bedContexts);
            const to   = LC_LABEL[e.toState]   || e.toState   || '';
            const from = e.fromState ? (LC_LABEL[e.fromState] || e.fromState) : null;
            return `<div class="stats-seed-event">
              <span class="stats-seed-event-time">${new Date(e.ts).toLocaleDateString()}</span>
              <span>${from ? `${from} → ${to}` : to}</span>
              ${bedName ? `<span class="stats-seed-event-bed">· ${escHtml(bedName)}</span>` : ''}
            </div>`;
          }).join('');
          return `<div class="stats-seed-card">
            <div class="stats-seed-head">
              <span style="font-size:1.3rem;line-height:1">${p?.emoji||'🌱'}</span>
              <div style="flex:1;min-width:0">
                <strong>${escHtml(p?.name||seed.plantId)}</strong>${seed.variety ? ` <em style="color:var(--text-muted);font-size:.8rem">${escHtml(seed.variety)}</em>` : ''}
                ${seed.seedTag ? `<span class="seed-tag-badge" style="margin-left:4px">🏷 ${escHtml(seed.seedTag)}</span>` : ''}
              </div>
              ${stats.germinationRate !== null ? `<span class="stats-seed-rate">🌱 ${metricHtml(stats.germinationRate, compareStats?.germinationRate, '%')}</span>` : '<span class="stats-seed-rate" style="background:#eef3f7;color:#607080">n/a</span>'}
            </div>
            ${stats.bedsUsed.length ? `<div class="stats-seed-beds">🪴 ${stats.bedsUsed.map(escHtml).join(' · ')}</div>` : ''}
            <div class="stats-seed-beds">🌱 Germination: ${expectedGermMax > 0 ? `${expectedGermMin === expectedGermMax ? `${expectedGermMin}d` : `${expectedGermMin}-${expectedGermMax}d`} expected` : 'no expected range set'}${stats.germinationDays !== null ? ` · ${stats.germinationDays}d actual` : ''}</div>
            ${germinationSpeedHtml}
            <div class="stats-seed-counts">
              ${stats.started ? `<span style="font-weight:700">${metricHtml(stats.started, compareStats?.started)} started</span>` : ''}
              ${stats.directSow ? `<span>${metricHtml(stats.directSow, compareStats?.directSow)} direct sow</span>` : ''}
              ${stats.traySeeded ? `<span>${metricHtml(stats.traySeeded, compareStats?.traySeeded)} tray seeded</span>` : ''}
              ${stats.germinated ? `<span style="font-weight:700;color:var(--primary-dark)">${metricHtml(stats.germinated, compareStats?.germinated)} germinated</span>` : ''}
              ${stats.transplanted ? `<span>${metricHtml(stats.transplanted, compareStats?.transplanted)} transplanted</span>` : ''}
              ${stats.harvestRate !== null ? `<span>${metricHtml(stats.harvestRate, compareStats?.harvestRate, '%')} harvest success</span>` : ''}
              ${stats.harvested ? `<span style="color:var(--primary-dark);font-weight:700">${metricHtml(stats.harvested, compareStats?.harvested)} harvested</span>` : ''}
              ${stats.failed ? `<span style="color:var(--bad);font-weight:700">${metricHtml(stats.failed, compareStats?.failed)} failed</span>` : ''}
              ${!stats.seedEvents.length ? `<em style="color:var(--text-muted)">No events recorded yet</em>` : ''}
            </div>
            ${stats.seedEvents.length ? `<details class="stats-seed-history">
              <summary>${stats.seedEvents.length} event${stats.seedEvents.length > 1 ? 's' : ''}</summary>
              <div class="stats-seed-events">${evtHtml}</div>
            </details>` : ''}
          </div>`;
        }).join('')
      : `<div class="stats-empty">No seeds match that filter.</div>`;

    const bedRows = snapshot.bedRows;
    const filteredBedRows = bedRows;
    const bedCompareCandidates = filteredBedRows.slice().sort((a, b) => a.name.localeCompare(b.name));
    if (!bedCompareCandidates.find(b => b.id === bedCompareLeft)) bedCompareLeft = bedCompareCandidates[0]?.id || '';
    if (!bedCompareCandidates.find(b => b.id === bedCompareRight)) bedCompareRight = bedCompareCandidates[1]?.id || bedCompareCandidates[0]?.id || '';
    if (bedCompareRight === bedCompareLeft && bedCompareCandidates.length > 1) {
      bedCompareRight = bedCompareCandidates.find(b => b.id !== bedCompareLeft)?.id || bedCompareRight;
    }
    const leftBed = bedCompareCandidates.find(b => b.id === bedCompareLeft) || null;
    const rightBed = bedCompareCandidates.find(b => b.id === bedCompareRight) || null;
    const bedCompareOptions = bedCompareCandidates.map(b => `<option value="${b.id}" ${b.id === bedCompareLeft ? 'selected' : ''}>${escHtml(b.name)}</option>`).join('');
    const bedCompareOptionsRight = bedCompareCandidates.map(b => `<option value="${b.id}" ${b.id === bedCompareRight ? 'selected' : ''}>${escHtml(b.name)}</option>`).join('');
    const bedCompareRows = [
      { label: 'Area', left: leftBed ? Number(leftBed.areaM2 || 0).toFixed(2) : null, right: rightBed ? Number(rightBed.areaM2 || 0).toFixed(2) : null, suffix: ' m²' },
      { label: 'Total cells', left: leftBed?.totalCells ?? null, right: rightBed?.totalCells ?? null, suffix: '' },
      { label: 'Occupied cells', left: leftBed?.occupiedCells ?? null, right: rightBed?.occupiedCells ?? null, suffix: '' },
      { label: 'Free cells', left: leftBed?.freeCells ?? null, right: rightBed?.freeCells ?? null, suffix: '' },
      { label: 'Plants', left: leftBed?.plants ?? null, right: rightBed?.plants ?? null, suffix: '' },
      { label: 'Varieties', left: leftBed?.varieties ?? null, right: rightBed?.varieties ?? null, suffix: '' },
      { label: 'Families', left: leftBed?.families ?? null, right: rightBed?.families ?? null, suffix: '' },
      { label: 'Harvested', left: leftBed?.harvested ?? null, right: rightBed?.harvested ?? null, suffix: '' },
      { label: 'Failed', left: leftBed?.failed ?? null, right: rightBed?.failed ?? null, suffix: '' },
      { label: 'Success', left: leftBed?.rate ?? null, right: rightBed?.rate ?? null, suffix: '%' },
    ];
    const seasonOptions = allYears.map(year => year === 'current'
      ? `<option value="current" ${seasonFilter==='current' ? 'selected' : ''}>Current season (${currentYear})</option>`
      : `<option value="${year}" ${String(seasonFilter)===String(year) ? 'selected' : ''}>Season ${year}</option>`
    ).join('');
    const compareOptions = [`<option value="" ${!compareYear ? 'selected' : ''}>No comparison</option>`,
      ...compareYears.map(year => year === 'current'
        ? `<option value="current" ${String(compareYear)==='current' ? 'selected' : ''}>Current season (${currentYear})</option>`
        : `<option value="${year}" ${String(compareYear)===String(year) ? 'selected' : ''}>Season ${year}</option>`)
    ].join('');
    const seasonLabel = seasonFilter === 'current' ? `Current season (${currentYear})` : `Season ${seasonYear}`;
    const compareLabel = compareActive
      ? `Comparing ${seasonLabel} to ${compareYear === 'current' ? `Current season (${currentYear})` : `Season ${compareSeasonYear}`}`
      : 'Comparison off';

    wrap.innerHTML = `
      <div class="stats-block">
        <h3>Filters</h3>
        <div class="stats-filter-row">
          <select style="max-width:220px" onchange="StatsView.setBedFilter(this.value)">${bedFilterOptions}</select>
          <select style="max-width:220px" onchange="StatsView.setSeasonFilter(this.value)">${seasonOptions}</select>
          <select style="max-width:220px" onchange="StatsView.setCompareYear(this.value)">${compareOptions}</select>
          <button class="btn btn-secondary" onclick="StatsView.toggleCompare()">${compareActive ? 'Hide Compare' : 'Compare'}</button>
          <span>${bedFilter==='all' ? 'All beds' : escHtml((bedContexts.get(bedFilter)?.name || 'Selected bed'))} · ${seasonLabel} · ${compareLabel}</span>
        </div>
      </div>

      <div class="stats-block">
        <h3>🪴 Season Snapshot</h3>
        <div class="stats-summary-grid">
          <div class="stats-card"><div class="stats-card-label">Beds</div><div class="stats-card-value">${metricHtml(snapshot.beds, compareSnapshot?.beds)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Area</div><div class="stats-card-value">${metricHtml(Number(snapshot.areaM2 || 0).toFixed(2), compareSnapshot ? Number(compareSnapshot.areaM2 || 0).toFixed(2) : null, ' m²')}</div></div>
          <div class="stats-card"><div class="stats-card-label">Total cells</div><div class="stats-card-value">${metricHtml(snapshot.totalCells, compareSnapshot?.totalCells)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Occupied cells</div><div class="stats-card-value">${metricHtml(snapshot.occupiedCells, compareSnapshot?.occupiedCells)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Free cells</div><div class="stats-card-value">${metricHtml(snapshot.freeCells, compareSnapshot?.freeCells)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Plants</div><div class="stats-card-value">${metricHtml(snapshot.plants, compareSnapshot?.plants)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Varieties</div><div class="stats-card-value">${metricHtml(snapshot.varieties, compareSnapshot?.varieties)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Families</div><div class="stats-card-value">${metricHtml(snapshot.families, compareSnapshot?.families)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Harvested</div><div class="stats-card-value">${metricHtml(snapshot.harvested, compareSnapshot?.harvested)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Failed</div><div class="stats-card-value">${metricHtml(snapshot.failed, compareSnapshot?.failed)}</div></div>
          <div class="stats-card"><div class="stats-card-label">Success</div><div class="stats-card-value">${metricHtml(snapshot.rate, compareSnapshot?.rate, '%')}</div></div>
          <div class="stats-card"><div class="stats-card-label">Lifecycle events</div><div class="stats-card-value">${metricHtml(totalEvents, compareActive ? compareEvents.length : null)}</div></div>
        </div>
      </div>

      <div class="stats-block">
        <h3>Bed Summary</h3>
        ${filteredBedRows.length ? `
        <table class="stats-table">
          <thead>
            <tr>
              <th class="stats-sortable" onclick="StatsView.setBedSort('name')">Bed</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('areaM2')">Area</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('totalCells')">Cells</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('occupiedCells')">Occupied</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('freeCells')">Free</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('plants')">Plants</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('varieties')">Varieties</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('families')">Families</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('harvested')">Harvested</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('failed')">Failed</th>
              <th class="stats-sortable" onclick="StatsView.setBedSort('rate')">Success</th>
            </tr>
          </thead>
          <tbody>
            ${filteredBedRows
              .slice()
              .sort((a, b) => {
                const av = a[bedSortKey] ?? 0;
                const bv = b[bedSortKey] ?? 0;
                if (bedSortKey === 'name') return bedSortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
                if (av === bv) return a.name.localeCompare(b.name);
                return bedSortDir === 'asc' ? av - bv : bv - av;
              })
              .map(r => {
              const prev = compareBedMap.get(r.id || r.name);
              return `<tr>
              <td>${escHtml(r.name)}</td>
              <td>${metricHtml(Number(r.areaM2 || 0).toFixed(2), prev ? Number(prev.areaM2 || 0).toFixed(2) : null, ' m²')}</td>
              <td>${metricHtml(r.totalCells, prev?.totalCells)}</td>
              <td>${metricHtml(r.occupiedCells, prev?.occupiedCells)}</td>
              <td>${metricHtml(r.freeCells, prev?.freeCells)}</td>
              <td>${metricHtml(r.plants, prev?.plants)}</td>
              <td>${metricHtml(r.varieties, prev?.varieties)}</td>
              <td>${metricHtml(r.families, prev?.families)}</td>
              <td>${metricHtml(r.harvested, prev?.harvested)}</td>
              <td>${metricHtml(r.failed, prev?.failed)}</td>
              <td>${metricHtml(r.rate, prev?.rate, '%')}</td>
            </tr>`;
            }).join('')}
          </tbody>
        </table>` : `<div class="stats-empty">No lifecycle events recorded yet for these beds.</div>`}
      </div>

      <div class="stats-block">
        <h3>Bed vs Bed</h3>
        ${bedCompareCandidates.length < 2 ? `<div class="stats-empty">Need at least two beds in this filter/season to compare.</div>` : `
        <div class="stats-filter-row">
          <select style="max-width:220px" onchange="StatsView.setBedCompareLeft(this.value)">${bedCompareOptions}</select>
          <span>vs</span>
          <select style="max-width:220px" onchange="StatsView.setBedCompareRight(this.value)">${bedCompareOptionsRight}</select>
          <span>${seasonLabel}</span>
        </div>
        <table class="stats-table">
          <thead>
            <tr><th>Metric</th><th>${escHtml(leftBed?.name || 'Bed A')}</th><th>${escHtml(rightBed?.name || 'Bed B')}</th></tr>
          </thead>
          <tbody>
            ${bedCompareRows.map(row => `<tr>
              <td>${row.label}</td>
              <td>${row.left === null ? 'n/a' : `${row.left}${row.suffix}`}</td>
              <td>${row.right === null ? 'n/a' : `${row.right}${row.suffix}${deltaHtml(Number(row.right), Number(row.left))}`}</td>
            </tr>`).join('')}
          </tbody>
        </table>`}
      </div>

      <div class="stats-block">
        <h3>Plant details</h3>
        <div class="stats-filter-row">
          <input id="stats-plant-filter" class="search-input" style="max-width:220px" placeholder="Filter plant stats (e.g. tomato)" value="${escAttr(filterText)}" oninput="StatsView.setFilter(this.value)">
          <span>${plantSectionFilteredRows.length} / ${plantSectionRows.length} plants</span>
        </div>
        ${plantSectionFilteredRows.length ? `
        <table class="stats-table">
          <thead>
            <tr><th>Plant</th><th>Planned</th><th>Direct</th><th>Tray</th><th>Germinated</th><th>Transplanted</th><th>Growing</th><th>Harvested</th><th>Gone to seed</th><th>Failed</th><th>Success</th></tr>
          </thead>
          <tbody>
            ${plantSectionFilteredRows.map(r => {
              const prev = comparePlantSectionMap.get(r.pid);
              return `<tr>
              <td>${r.emoji} ${escHtml(r.name)}</td>
              <td>${metricHtml(r.planned, prev?.planned)}</td>
              <td>${metricHtml(r.direct_sow, prev?.direct_sow)}</td>
              <td>${metricHtml(r.tray_seeded, prev?.tray_seeded)}</td>
              <td>${metricHtml(r.germinated, prev?.germinated)}</td>
              <td>${metricHtml(r.transplanted, prev?.transplanted)}</td>
              <td>${metricHtml(r.growing, prev?.growing)}</td>
              <td>${metricHtml(r.harvested, prev?.harvested)}</td>
              <td>${metricHtml(r.gone_to_seed, prev?.gone_to_seed)}</td>
              <td>${metricHtml(r.failed, prev?.failed)}</td>
              <td>${metricHtml(r.rate, prev?.rate, '%')}</td>
            </tr>`;
            }).join('')}
          </tbody>
        </table>` : `<div class="stats-empty">No plants match that filter.</div>`}
      </div>

      <div class="stats-block">
        <h3>🌱 Seed Performance</h3>
        <div class="stats-filter-row">
          <input id="stats-seed-filter" class="search-input" style="max-width:260px" placeholder="Search by plant, variety or tag…" value="${escAttr(seedFilterText)}" oninput="StatsView.setSeedFilter(this.value)">
          <span>${filteredSeeds.length} / ${seedsInScope.length} seeds</span>
        </div>
        ${seeds.length
          ? (seedsInScope.length
              ? seedCardsHtml
              : `<div class="stats-empty">No seed events for this bed filter in ${seasonLabel.toLowerCase()}.</div>`)
          : `<div class="stats-empty">No seed inventory yet. Add seeds in the Seeds tab to track performance.</div>`}
      </div>

      <div class="stats-block">
        <h3>🧪 Germination Coverage</h3>
        <div class="stats-summary-grid">
          <div class="stats-card"><div class="stats-card-label">Plants with expected range</div><div class="stats-card-value">${plantCoverageExpected}/${plantCoverageTotal}</div></div>
          <div class="stats-card"><div class="stats-card-label">Plants missing range</div><div class="stats-card-value">${plantCoverageMissing}</div></div>
          <div class="stats-card"><div class="stats-card-label">Seeds with packet override</div><div class="stats-card-value">${seedCoverageOverrides}/${seedCoverageTotal}</div></div>
          <div class="stats-card"><div class="stats-card-label">Seeds using plant default</div><div class="stats-card-value">${seedCoverageInherited}</div></div>
          <div class="stats-card"><div class="stats-card-label">Seeds missing any range</div><div class="stats-card-value">${seedCoverageMissing}</div></div>
        </div>
        <div style="margin-top:8px;font-size:.74rem;color:var(--text-muted)">
          Packet override = germination days set directly on the seed packet entry. Plant default = inherited from the plant profile.
        </div>
      </div>

      <div class="stats-block">
        <h3>Archived Seasons</h3>
        ${allYears.filter(year => year !== currentYear).length
          ? `<div class="stats-years">${allYears.filter(year => year !== currentYear).map(y => `<span class="stats-year-chip">${y}</span>`).join('')}</div>`
          : `<div class="stats-empty">No archived seasons yet. Use Archive Season to track long-term rotations and outcomes.</div>`}
        ${(bedFilter === 'all' ? history : history.filter(h => h.bedId === bedFilter)).length ? `
        <table class="stats-table" style="margin-top:10px">
          <thead>
            <tr><th>Year</th><th>Bed</th><th>Plants</th><th>Varieties</th><th>Families</th><th>Harvested</th><th>Failed</th><th>Success</th></tr>
          </thead>
          <tbody>
            ${(bedFilter === 'all' ? history : history.filter(h => h.bedId === bedFilter))
              .map(entry => {
                const plantCounts = entry.plantCounts || {};
                const familyCounts = entry.familyCounts || {};
                const lifecycle = entry.lifecycleCounts || {};
                const harvestedCount = (lifecycle.harvested_once || 0) + (lifecycle.harvested_continuous || 0);
                const failedCount = lifecycle.failed || 0;
                const resolved = harvestedCount + failedCount;
                return `<tr>
              <td>${entry.year}</td>
              <td>${escHtml(entry.bedName)}</td>
              <td>${Object.values(plantCounts).reduce((sum, count) => sum + count, 0)}</td>
              <td>${Object.keys(plantCounts).length}</td>
              <td>${Object.keys(familyCounts).length}</td>
              <td>${harvestedCount}</td>
              <td>${failedCount}</td>
              <td>${resolved ? `${Math.round((harvestedCount / resolved) * 100)}%` : 'n/a'}</td>
            </tr>`;
            }).join('')}
          </tbody>
        </table>` : ''}
      </div>
    `;
  }

  return {
    render,
    setFilter,
    setSeedFilter,
    setBedFilter,
    setBedSort,
    setBedCompareLeft,
    setBedCompareRight,
    setSeasonFilter,
    setCompareYear,
    toggleCompare,
  };
})();

// ================================================================
// EXPORT / IMPORT
// ================================================================
function exportBackup(filename = null, successMessage = 'Backup downloaded') {
  const settings = Store.getSettings();
  const gardenSlug = String(settings.gardenName || settings.locationName || 'garden')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'garden';
  const json = Store.exportAll();
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename || `${gardenSlug}-backup-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  Toast.show(successMessage);
}

function importBackup() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        GardenBackups.suppressDuring(() => Store.importAll(e.target.result));
        Toast.show('Backup restored! Reloading…');
        setTimeout(() => location.reload(), 1200);
      } catch(err) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function exportPlants() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    customPlants: Store.getCustomPlants(),
    builtins: Store.getBuiltinPlantOverrides(),
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `garden-plants-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  const customCount = data.customPlants.length;
  const builtinCount = Object.keys(data.builtins).length;
  Toast.show(`Plants exported (${customCount} custom, ${builtinCount} edited built-in)`);
}

function importPlants() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = () => {
    const file = inp.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data || data.version !== 1 || !Array.isArray(data.customPlants)) {
          throw new Error('Not a valid plants export file (expected version 1)');
        }
        // Merge custom plants (add new, update existing by id)
        const existing = Store.getCustomPlants();
        const existingById = new Map(existing.map(p => [p.id, p]));
        let added = 0, updated = 0;
        (data.customPlants || []).forEach(p => {
          if (!p.id || !p.name) return;
          if (existingById.has(p.id)) updated++; else added++;
          Store.upsertCustomPlant(p);
        });
        // Merge builtin overrides
        const builtins = data.builtins || {};
        let builtinCount = 0;
        Object.entries(builtins).forEach(([plantId, override]) => {
          if (plantId && override && typeof override === 'object') {
            Store.upsertBuiltinPlantOverride(plantId, override);
            builtinCount++;
          }
        });
        CustomPlants.render();
        Beds.renderLibrary();
        Beds.renderCanvas();
        Toast.show(`Plants imported: ${added} new, ${updated} updated, ${builtinCount} built-in edits merged`);
      } catch(err) {
        alert('Import failed: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  inp.click();
}

function exportTextPlan() {
  const beds = Store.getBeds();
  if (!beds.length) { Toast.show('No beds to export'); return; }

  let txt = `GARDEN PLAN — exported ${new Date().toLocaleDateString()}\n`;
  txt += '='.repeat(60) + '\n\n';

  beds.forEach(bed => {
    txt += `BED: ${bed.name}  (${bed.widthM}m × ${bed.heightM}m)\n`;
    txt += '-'.repeat(40) + '\n';
    const counts = {};
    Object.values(bed.cells).forEach(cell => {
      if (!cellIsOrigin(cell)) return;
      const id = cellPlantId(cell);
      if (!id) return;
      counts[id] = (counts[id] || 0) + 1;
    });
    if (!Object.keys(counts).length) { txt += '  (empty)\n'; }
    else {
      Object.entries(counts).sort().forEach(([id, n]) => {
        const p = PlantDB.get(id);
        txt += `  • ${p?.name ?? id}  ×${n}  (${p?.spacing||'?'} cm${p?.rowSpacing ? ` +${p.rowSpacing} cm rows` : ''}, ${p?.daysToHarvest||'?'} days)\n`;
      });
    }
    // companion warnings
    const placed = [...new Set(Object.values(bed.cells).filter(cellIsOrigin).map(cellPlantId).filter(Boolean))];
    const warns = [];
    placed.forEach(a => {
      const pa = PlantDB.get(a); if (!pa) return;
      placed.forEach(b => {
        if (a >= b) return;
        const pb = PlantDB.get(b); if (!pb) return;
        if ((pa.bad??[]).includes(b)) warns.push(`  ⚠️  ${pa.name} × ${pb.name}`);
      });
    });
    if (warns.length) { txt += '\n  Companion warnings:\n' + warns.join('\n') + '\n'; }
    txt += '\n';
  });

  // inventory
  txt += 'SEED INVENTORY\n' + '='.repeat(60) + '\n';
  const inv = Store.getInventory();
  if (!inv.length) { txt += '  (empty)\n'; }
  else {
    inv.forEach(s => {
      const p = PlantDB.get(s.plantId);
      const tag = s.seedTag ? `  [${s.seedTag}]` : '';
      const variety = s.variety ? ` – ${s.variety}` : '';
      txt += `  • ${p?.name ?? s.plantId}${variety}${tag}  : ${s.qty} ${s.unit}${s.expiry ? '  exp.' + s.expiry : ''}\n`;
    });
  }

  const blob = new Blob([txt], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `garden-plan-${new Date().toISOString().slice(0,10)}.txt`;
  a.click(); URL.revokeObjectURL(url);
  Toast.show('Plan exported as text');
}

function printBeds() {
  switchTab('beds');
  document.body.classList.add('print-beds');
  window.print();
}

window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-beds');
});

window.addEventListener('gp:data-changed', event => {
  const key = event.detail?.key;
  if (key === 'settings') return;
  GardenBackups.scheduleAutoBackup();
});

// ================================================================
// CROP ROTATION — archive current season
// ================================================================
function archiveSeason() {
  const defaultYear = new Date().getFullYear();
  const input = prompt(`Archive planting for year:\n(Saves which botanical families are in each bed for future rotation warnings.)`, defaultYear);
  if (input === null) return;
  const year = parseInt(input, 10);
  if (!year || isNaN(year) || year < 2000 || year > 2100) {
    alert('Please enter a valid year (e.g. 2026).');
    return;
  }
  exportBackup(`archive-season-${year}-pre-archive.json`, `Pre-archive backup for ${year} downloaded`);
  const newEntries = Store.archiveSeason(year, id => PlantDB.get(id));
  if (!newEntries.length) {
    Toast.show(`No plants in beds to archive for ${year}`);
    return;
  }
  Toast.show(`Season ${year} archived (${newEntries.length} bed${newEntries.length !== 1 ? 's' : ''})`);
}

// ================================================================
// BOOT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  PlantDB.ensureGerminationDataInStorage();
  GardenProfiles.ensureInitialized();
  GardenBackups.startAutoBackupLoop();
  await GardenBackups.maybeOfferRestoreOnStartup().catch(() => {});
  updateBackupAlert().catch(() => {});
  switchTab('beds');
});
