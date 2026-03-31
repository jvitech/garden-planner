/* js/beds.js — Bed planner page controller
   ================================================================ */
'use strict';

const Beds = (() => {

  // ── page state ────────────────────────────────────────────────
  let activeBedId  = null;
  let selectedPlantId = null;    // currently armed plant
  let selectedSeedId = null;     // currently selected seed packet for armed plant
  let selectedRotation = 0;      // 0 or 90 degrees for rectangular plants
  let undoStacks   = {};         // bedId → string[]
  let redoStacks   = {};         // bedId → string[]
  let previewEls   = [];         // currently highlighted footprint cells
  let hintEl       = null;       // floating placement hint
  let dragState    = null;       // current drag operation
  let paintState   = null;       // hold-left-click planting stroke
  let rowPlacementMode = false;  // when true, drag paint snaps to rowSpacing grid
  let ignoreNextClick = false;   // suppress click after drag-paint
  let lastClickedInstance = null; // { bedId, instanceId } — for lifecycle updates
  let lastClickedCell = null;    // { bedId, r, c } — grid position of last normal click (for shift+click range)
  let selectedLifecycleInstances = []; // [{ bedId, instanceId }] for multi-status updates
  let selectedJournalSeason = null;
  let selectedBedFilter = null;   // null = select first bed, 'all' = all beds
  let selectedJournalRange = 'day';
  let selectedJournalSearch = '';  // search filter for journal entries
  let selectedBedLibrarySeeded = false; // checkbox: only show plants with seed packets
  let selectedJournalEventId = null;
  let pickedJournalImageName = '';
  let pickedJournalPreviewUrl = '';
  let plotDrawMode = false;
  let plotAnchor = null; // { bedId, r, c }
  let plotPaint = null;  // { bedId, startR, startC, endR, endC, dragging, moved }
  let pathConfig = { color: '#c8a882', desc: '' }; // armed path tile config
  let selectedPlotZone = null; // { bedId, zoneId }
  let zoneMoveState = null; // { bedId, zoneId, mode, startR, startC, origMinR, origMinC, origMaxR, origMaxC, previewMinR, previewMinC, previewMaxR, previewMaxC, moved }
  let lastPointerClientX = null;
  let lastPointerClientY = null;
  let autoScrollRaf = null;
  let autoScrollVelY = 0;

  const JOURNAL_IMAGE_DIR = 'photos/journal';
  const SEED_IMAGE_DIR = 'photos/seeds';
  const JOURNAL_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];
  const SEED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  const CELL_SIZE  = 32;         // px per grid cell (visual size)
  const CELL_CM    = 10;         // 10×10 cm logical cell size
  const CELL_M     = CELL_CM / 100;
  const PATH_DEFAULT_CELLS = 1; // default click footprint for path tiles
  const MAX_CELLS  = 150;        // safety cap per axis (supports up to 15 m at 10 cm cells)

  // ── lifecycle constants ───────────────────────────────────────
  const LC_STATES = ['planned', 'direct_sow', 'tray_seeded', 'germinated', 'ready_to_transplant', 'hardened', 'transplanted', 'growing', 'harvested_once', 'harvested_continuous', 'gone_to_seed', 'failed_germination', 'failed_plant'];
  const LC_META = {
    planned:              { label:'Planned',              icon:'📋', color:'#9daab5' },
    direct_sow:           { label:'Direct sowing',        icon:'🌰', color:'#1f4e8c' },
    tray_seeded:          { label:'Seedling tray',        icon:'🪴', color:'#9ec5fe' },
    germinated:           { label:'Germinated',           icon:'🌱', color:'#2a9d8f' },
    ready_to_transplant:  { label:'Ready to transplant',  icon:'🏺', color:'#f4a261' },
    hardened:             { label:'Hardened off',         icon:'🌤️', color:'#e9c46a' },
    transplanted:         { label:'Transplanted',         icon:'🌿', color:'#52b788' },
    growing:              { label:'Growing',              icon:'🍃', color:'#43aa8b' },
    harvested_once:       { label:'Harvested (one-off)',  icon:'🧺', color:'#d4a017' },
    harvested_continuous: { label:'Harvesting continuous',icon:'✂️', color:'#d9a441' },
    gone_to_seed:         { label:'Gone to seed',         icon:'🌾', color:'#111111' },
    failed_germination:   { label:'Failed (germination)',  icon:'🌧️', color:'#d7263d' },
    failed_plant:         { label:'Failed (plant)',        icon:'✗',  color:'#9b1a2a' },
    // legacy — kept for rendering old data
    failed:               { label:'Failed',               icon:'✗',  color:'#d7263d' },
  };
  const LC_TIMELINE_ORDER = ['direct_sow', 'tray_seeded', 'germinated', 'ready_to_transplant', 'hardened', 'transplanted', 'growing', 'harvested_once', 'harvested_continuous', 'gone_to_seed', 'failed_germination', 'failed_plant'];

  // States restricted to seed tray beds only.
  const LC_TRAY_ONLY = new Set(['ready_to_transplant', 'hardened']);
  // States not shown in seed tray beds (end-of-life garden states).
  const LC_NORMAL_ONLY = new Set(['direct_sow', 'growing', 'harvested_once', 'harvested_continuous', 'gone_to_seed', 'failed_plant']);

  function isSeedTrayBed(bed) { return bed?.type === 'tray'; }
  function isPlotBed(bed)     { return bed?.type === 'plot'; }

  function lcStatesForBed(bed) {
    if (isSeedTrayBed(bed)) return LC_STATES.filter(s => !LC_NORMAL_ONLY.has(s));
    return LC_STATES.filter(s => !LC_TRAY_ONLY.has(s));
  }

  function seedsForPlant(plantId, includeZero = false) {
    return Store.getInventory().filter(s => s.plantId === plantId && (includeZero || (s.qty || 0) > 0));
  }

  function seedLabel(seed) {
    if (!seed) return 'Generic planting';
    const parts = [];
    if (seed.variety) parts.push(seed.variety);
    if (seed.seedTag) parts.push(`#${seed.seedTag}`);
    parts.push(`${seed.qty || 0} ${seed.unit || 'seeds'}`);
    return parts.join(' · ');
  }

  function journalImageUrl(filename) {
    return `${JOURNAL_IMAGE_DIR}/${encodeURIComponent(filename)}`;
  }

  function seedImageUrl(filename) {
    return `${SEED_IMAGE_DIR}/${encodeURIComponent(filename)}`;
  }

  function seedImageSources(seed) {
    const explicit = String(seed?.imageFilename || '').trim();
    if (explicit) return [seedImageUrl(explicit)];

    const tag = String(seed?.seedTag || '').trim();
    if (!tag) return [];
    return SEED_IMAGE_EXTS.map(ext => seedImageUrl(`${tag}.${ext}`));
  }

  function journalImageSources(event) {
    const explicit = String(event?.photoFilename || '').trim();
    if (!explicit) return [];
    if (explicit.includes('/')) return [explicit];
    // Try journal folder first, then seed folder to avoid common cross-folder mistakes.
    return [journalImageUrl(explicit), seedImageUrl(explicit)];
  }

  function renderJournalMedia(event, actionIcon, plantEmoji, label) {
    const sources = journalImageSources(event);
    if (!sources.length) {
      const big   = actionIcon  || '📋';
      const small = plantEmoji  || '';
      return `<div class="journal-media-fallback" style="position:relative">
        <span style="font-size:1.35rem;line-height:1">${big}</span>
        ${small ? `<span style="position:absolute;bottom:2px;right:3px;font-size:.65rem;line-height:1">${small}</span>` : ''}
      </div>`;
    }
    return `<img class="journal-media-img" src="${escAttr(sources[0])}" alt="${escAttr(label)}" data-src-list="${escAttr(sources.join('|'))}" data-src-index="0" onload="Beds.handleJournalImageLoad(this)" onerror="Beds.handleJournalImageError(this)" onclick="Beds.openJournalImage(event, this)">`;
  }

  function getJournalEventDateValue(event) {
    const raw = String(event?.eventDate || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const ts = String(event?.ts || '').trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(ts)) return ts.slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  }

  function formatJournalEventDate(event) {
    const value = getJournalEventDateValue(event);
    const dt = new Date(`${value}T12:00:00`);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleDateString();
  }

  function filterJournalItemsByRange(items, seasonYear) {
    if (selectedJournalRange === 'season') return items;
    const now = new Date();
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const seasonStart = new Date(Date.UTC(seasonYear, 0, 1));
    const baseDate = seasonYear === today.getUTCFullYear() ? today : null;
    const ref = baseDate || items.reduce((latest, item) => {
      const itemDate = new Date(`${getJournalEventDateValue(item)}T00:00:00Z`);
      if (Number.isNaN(itemDate.getTime())) return latest;
      return !latest || itemDate > latest ? itemDate : latest;
    }, null) || seasonStart;

    let daysBack = 1;
    if (selectedJournalRange === 'week') daysBack = 7;
    else if (selectedJournalRange === 'month') daysBack = 31;

    const cutoff = new Date(ref);
    cutoff.setUTCDate(cutoff.getUTCDate() - (daysBack - 1));
    return items.filter(item => {
      const itemDate = new Date(`${getJournalEventDateValue(item)}T00:00:00Z`);
      if (Number.isNaN(itemDate.getTime())) return false;
      return itemDate >= cutoff && itemDate <= ref;
    });
  }

  function parseYmdToUtc(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return null;
    const dt = new Date(`${ymd}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  function daysBetweenYmd(fromYmd, toYmd) {
    const from = parseYmdToUtc(fromYmd);
    const to = parseYmdToUtc(toYmd);
    if (!from || !to) return null;
    return Math.round((to - from) / 86400000);
  }

  function lifecycleTimelineForInstance(instanceId, bedId, plantId) {
    if (!instanceId || !bedId || !plantId) return [];
    const year = activeSeasonYear();
    const bed = Store.getBeds().find(b => b.id === bedId) || null;
    let instanceContextId = bedId;
    if (bed) {
      const originEntry = Object.entries(bed.cells || {}).find(([k, v]) => {
        const cell = normalizeCellValue(v, k);
        return cell?.origin && cell.instanceId === instanceId;
      });
      if (originEntry) {
        const [originKey, originVal] = originEntry;
        const ctx = contextFromOriginCell(bed, normalizeCellValue(originVal, originKey), originKey);
        instanceContextId = ctx.bedContextId || bedId;
      }
    }
    const events = Store.getLifecycleJournal()
      .filter(e => e.instanceId === instanceId && e.bedId === bedId && e.plantId === plantId && Number(e.seasonYear) === Number(year) && lifecycleContextId(e) === instanceContextId)
      .slice()
      .sort((a, b) => {
        const ad = getJournalEventDateValue(a);
        const bd = getJournalEventDateValue(b);
        if (ad !== bd) return ad < bd ? -1 : 1;
        return a.ts < b.ts ? -1 : 1;
      });

    const firstByState = {};
    events.forEach(e => {
      const state = e.toState;
      if (!state || !Object.prototype.hasOwnProperty.call(LC_META, state)) return;
      if (!firstByState[state]) {
        firstByState[state] = {
          state,
          date: getJournalEventDateValue(e),
          ts: e.ts,
        };
      }
    });

    return LC_TIMELINE_ORDER
      .filter(state => firstByState[state])
      .map(state => firstByState[state]);
  }

  // ── cell/footprint helpers ───────────────────────────────────
  function normalizeCellValue(val, key) {
    if (!val) return null;
    if (typeof val === 'string') {
      return { plantId: val, instanceId: key, origin: true, rotation: 0, lifecycle: 'planned' };
    }
    return {
      plantId: val.plantId,
      instanceId: val.instanceId || key,
      origin: val.origin !== false,
      rotation: val.rotation || 0,
      bedContextId: val.bedContextId || null,
      bedContextName: val.bedContextName || null,
      plotZoneId: val.plotZoneId || null,
      seedId: val.seedId || null,
      lifecycle: val.lifecycle || 'planned',
      rowBatchId: val.rowBatchId || null,
      rowBatchTotal: val.rowBatchTotal || 0,
      rowBlockMode: !!val.rowBlockMode,
      rowBlockRows: val.rowBlockRows || 0,
      rowBlockPerRow: val.rowBlockPerRow || 0,
      rowBlockTotal: val.rowBlockTotal || 0,
      blockRows: val.blockRows || 0,
      blockCols: val.blockCols || 0,
      pathColor: val.pathColor || null,
      pathDesc: val.pathDesc || null,
      transplantSourceBedId:      val.transplantSourceBedId      || null,
      transplantSourceInstanceId: val.transplantSourceInstanceId || null,
    };
  }

  // Returns how many plants of this type realistically fit in a single 10×10 cm cell.
  // Uses the plant's own footprint (spacing field, not rowSpacing).
  function densityPerCell(plant) {
    const raw = String(plant?.spacing || `${CELL_CM}×${CELL_CM}`);
    const nums = (raw.match(/\d+(?:[.,]\d+)?/g) || []).map(n => parseFloat(n.replace(',', '.')));
    const w = nums[0] || CELL_CM;
    const h = nums[1] || w;
    if (w >= CELL_CM || h >= CELL_CM) return 1;
    return Math.max(1, Math.floor(CELL_CM / w) * Math.floor(CELL_CM / h));
  }

  function parseFootprint(plant, rotation = 0) {
    const raw = String(plant?.spacing || `${CELL_CM}x${CELL_CM}`);
    const nums = (raw.match(/\d+(?:[.,]\d+)?/g) || []).map(n => parseFloat(n.replace(',', '.')));
    let widthCm  = nums[0] || CELL_CM;
    let heightCm = nums[1] || widthCm;
    if (rotation % 180 !== 0) {
      [widthCm, heightCm] = [heightCm, widthCm];
    }
    return {
      widthCm,
      heightCm,
      cols: Math.max(1, Math.ceil(widthCm / CELL_CM)),
      rows: Math.max(1, Math.ceil(heightCm / CELL_CM)),
    };
  }

  function rotationGroup(plant) {
    if (plant?.rotationDisabled)
      return { key: 'disabled', label: 'Disabled', full: 'Rotation tracking disabled', bg: '#f5f5f5', border: '#aaaaaa', color: '#555555' };
    const fam = plant?.family || '';
    if (fam === 'fabaceae')     return { key: 'legumes',       label: 'Legumes',         full: 'Legumes (Fabaceae)',                     bg: '#f5eeff', border: '#8b45c5', color: '#4a1a7a' };
    if (fam === 'brassicaceae') return { key: 'brassicas',     label: 'Brassicas',       full: 'Brassicas (Brassicaceae)',               bg: '#dff0ff', border: '#1a6fa8', color: '#0c3d6b' };
    if (fam === 'solanaceae')   return { key: 'solanaceae',   label: 'Solanaceae',      full: 'Potatoes & Fruiting Veg (Solanaceae)',  bg: '#ffe8e5', border: '#c0392b', color: '#7a1a10' };
    if (fam === 'apiaceae' || fam === 'allioideae')
                                return { key: 'roots-alliums', label: 'Roots & Alliums', full: 'Roots & Alliums (Apiaceae / Alliaceae)', bg: '#fff8db', border: '#c08a10', color: '#6b4a00' };
    return                             { key: 'other',         label: 'Other',           full: 'Other family',                           bg: '#e8f5e9', border: '#2d7a40', color: '#1b4a27' };
  }

  function isRotatable(plant) {
    if (!plant) return false;
    const base = parseFootprint(plant, 0);
    return base.cols !== base.rows || base.widthCm !== base.heightCm;
  }

  function getCenteredOrigin(bed, r, c, footprint) {
    const maxStartR = Math.max(0, bed.rows - footprint.rows);
    const maxStartC = Math.max(0, bed.cols - footprint.cols);
    const startR = Math.min(maxStartR, Math.max(0, r - Math.floor(footprint.rows / 2)));
    const startC = Math.min(maxStartC, Math.max(0, c - Math.floor(footprint.cols / 2)));
    return { startR, startC };
  }

  function countBedPlants(bed) {
    let count = 0;
    Object.entries(bed.cells).forEach(([k, v]) => {
      const cell = normalizeCellValue(v, k);
      if (cell?.origin && cell.plantId !== '__path__') {
        count += (cell.rowBlockTotal > 1 ? cell.rowBlockTotal : 1);
      }
    });
    return count;
  }

  function canPlaceFootprint(bed, startR, startC, footprint, ignoreInstanceId = null) {
    if (startR + footprint.rows > bed.rows || startC + footprint.cols > bed.cols) return false;
    for (let rr = startR; rr < startR + footprint.rows; rr++) {
      for (let cc = startC; cc < startC + footprint.cols; cc++) {
        const occupied = normalizeCellValue(bed.cells[`${rr},${cc}`], `${rr},${cc}`);
        // Never allow placing on path cells
        if (occupied?.plantId === '__path__') return false;
        if (occupied && occupied.instanceId !== ignoreInstanceId) return false;
      }
    }
    return true;
  }

  function placeFootprint(bed, r, c, plantId, footprint, rotation = 0, instanceId = `inst_${Date.now()}_${Math.random().toString(36).slice(2,7)}`, seedId = null, extraMeta = null) {
    for (let rr = r; rr < r + footprint.rows; rr++) {
      for (let cc = c; cc < c + footprint.cols; cc++) {
        const isOrigin = rr === r && cc === c;
        const cellVal = { plantId, instanceId, origin: isOrigin, rotation, ...(extraMeta || {}) };
        if (isOrigin) {
          cellVal.lifecycle = 'planned';
          cellVal.seedId = seedId || null;
        }
        bed.cells[`${rr},${cc}`] = cellVal;
      }
    }
    return instanceId;
  }

  function removePlantInstance(bed, r, c) {
    const clicked = normalizeCellValue(bed.cells[`${r},${c}`], `${r},${c}`);
    if (!clicked) return false;
    Object.entries(bed.cells).forEach(([k, v]) => {
      const cell = normalizeCellValue(v, k);
      if (cell?.instanceId === clicked.instanceId) delete bed.cells[k];
    });
    return true;
  }

  function clearPreview() {
    previewEls.forEach(el => el.classList.remove('preview-ok', 'preview-blocked', 'preview-origin', 'preview-anchor'));
    previewEls = [];
    if (hintEl) hintEl.style.display = 'none';
    syncPlotAnchorPreview();
  }

  function syncPlotAnchorPreview() {
    document.querySelectorAll('.gcell.preview-anchor').forEach(el => el.classList.remove('preview-anchor'));
    if (!plotDrawMode || !plotAnchor) return;
    const el = document.querySelector(`[data-bed="${plotAnchor.bedId}"][data-r="${plotAnchor.r}"][data-c="${plotAnchor.c}"]`);
    if (el) el.classList.add('preview-anchor');
  }

  function selectionRect(startR, startC, endR, endC) {
    return {
      minR: Math.min(startR, endR),
      maxR: Math.max(startR, endR),
      minC: Math.min(startC, endC),
      maxC: Math.max(startC, endC),
    };
  }

  function planRowSpacingCm(rowSpacingCm = 0) {
    const raw = Math.max(0, Number(rowSpacingCm) || 0);
    if (!raw) return 0;
    return Math.ceil(raw / CELL_CM) * CELL_CM;
  }

  function rowLayoutCounts(rowSpan, colSpan, fp, rowSpacingCm = 0) {
    const plannedCenterCm = planRowSpacingCm(rowSpacingCm);
    const centerStepCells = Math.max(1, Math.ceil(plannedCenterCm / CELL_CM));
    const rowStepCells = Math.max(fp.rows, centerStepCells);

    const fitWithStep = (span, size, step) => {
      if (span < size) return 0;
      return Math.floor((span - size) / Math.max(1, step)) + 1;
    };

    const rows = fitWithStep(rowSpan, fp.rows, rowStepCells);
    const perRow = fitWithStep(colSpan, fp.cols, fp.cols);
    return {
      rows,
      perRow,
      total: rows * perRow,
    };
  }

  function showRowSelectionPreview(bedId, startR, startC, endR, endC, plant, rotation) {
    clearPreview();
    const rect = selectionRect(startR, startC, endR, endC);
    for (let rr = rect.minR; rr <= rect.maxR; rr++) {
      for (let cc = rect.minC; cc <= rect.maxC; cc++) {
        const el = document.querySelector(`[data-bed="${bedId}"][data-r="${rr}"][data-c="${cc}"]`);
        if (!el) continue;
        el.classList.add('preview-ok');
        if (rr === rect.minR && cc === rect.minC) el.classList.add('preview-origin');
        previewEls.push(el);
      }
    }

    const hint = ensureHintEl();
    const anchor = document.querySelector(`[data-bed="${bedId}"][data-r="${rect.maxR}"][data-c="${rect.maxC}"]`);
    if (!anchor) return;
    const aRect = anchor.getBoundingClientRect();
    hint.classList.remove('bad');
    const rowSpan = rect.maxR - rect.minR + 1;
    const colSpan = rect.maxC - rect.minC + 1;
    if (plant._isPath) {
      if (rowSpan === 1 && colSpan === 1) {
        hint.textContent = `Path: ${PATH_DEFAULT_CELLS}×${PATH_DEFAULT_CELLS} cell default · drag for custom size`;
      } else {
        hint.textContent = `Path: ${colSpan}×${rowSpan} cells (${colSpan * CELL_CM}×${rowSpan * CELL_CM} cm)`;
      }
    } else {
      const fp = parseFootprint(plant, rotation);
      const layout = rowLayoutCounts(rowSpan, colSpan, fp, plant.rowSpacing || 0);
      hint.textContent = `Row mode: ${layout.rows} rows × ${layout.perRow} plants/row = ${layout.total} (max, before occupied cells)`;
    }
    hint.style.left = `${aRect.left + aRect.width}px`;
    hint.style.top = `${aRect.top}px`;
    hint.style.display = 'block';
  }

  function showPlotSelectionPreview(bedId, startR, startC, endR, endC) {
    clearPreview();
    const rect = selectionRect(startR, startC, endR, endC);
    for (let rr = rect.minR; rr <= rect.maxR; rr++) {
      for (let cc = rect.minC; cc <= rect.maxC; cc++) {
        const el = document.querySelector(`[data-bed="${bedId}"][data-r="${rr}"][data-c="${cc}"]`);
        if (!el) continue;
        el.classList.add('preview-ok');
        if (rr === rect.minR && cc === rect.minC) el.classList.add('preview-origin');
        if (rr === startR && cc === startC) el.classList.add('preview-anchor');
        previewEls.push(el);
      }
    }

    const anchor = document.querySelector(`[data-bed="${bedId}"][data-r="${rect.maxR}"][data-c="${rect.maxC}"]`);
    const hint = ensureHintEl();
    if (anchor) {
      const aRect = anchor.getBoundingClientRect();
      const cols = (rect.maxC - rect.minC + 1);
      const rows = (rect.maxR - rect.minR + 1);
      hint.classList.remove('bad');
      hint.textContent = `Plot zone: ${cols}×${rows} cells (${(cols * CELL_M).toFixed(2)}m × ${(rows * CELL_M).toFixed(2)}m)`;
      hint.style.left = `${aRect.left + aRect.width}px`;
      hint.style.top = `${aRect.top}px`;
      hint.style.display = 'block';
    }
  }

  function plotLayoutForBed(bed) {
    return Array.isArray(bed?.plotLayout) ? bed.plotLayout : [];
  }

  function zoneIdFor(item) {
    if (!item) return '';
    return item.id || item.bedId || `${item.minR}:${item.minC}:${item.maxR}:${item.maxC}`;
  }

  function activePlotZoneForBed(bedId) {
    if (!selectedPlotZone || selectedPlotZone.bedId !== bedId) return null;
    const bed = Store.getBeds().find(b => b.id === bedId);
    if (!bed) return null;
    return plotLayoutForBed(bed).find(item => zoneIdFor(item) === selectedPlotZone.zoneId) || null;
  }

  function zoneContainsCell(zone, r, c) {
    if (!zone) return true;
    return r >= zone.minR && r <= zone.maxR && c >= zone.minC && c <= zone.maxC;
  }

  function zoneContainsFootprint(zone, startR, startC, fp) {
    if (!zone) return true;
    const endR = startR + fp.rows - 1;
    const endC = startC + fp.cols - 1;
    return startR >= zone.minR && endR <= zone.maxR && startC >= zone.minC && endC <= zone.maxC;
  }

  function bedContextIdForZone(bedId, zone) {
    const zId = zoneIdFor(zone);
    return zId ? `${bedId}::${zId}` : bedId;
  }

  function bedContextNameForZone(bed, zone) {
    if (!zone) return bed?.name || 'Bed';
    const zoneName = (zone.name || 'Zone').trim() || 'Zone';
    return `${bed?.name || 'Bed'} · ${zoneName}`;
  }

  function parseContextZoneId(contextId, bedId) {
    if (!contextId || !bedId) return null;
    const prefix = `${bedId}::`;
    return contextId.startsWith(prefix) ? contextId.slice(prefix.length) : null;
  }

  function bedContextForCell(bed, r, c, preferredZone = null) {
    const zone = (preferredZone && zoneContainsCell(preferredZone, r, c))
      ? preferredZone
      : plotLayoutForBed(bed).find(item => zoneContainsCell(item, r, c)) || null;
    return {
      bedContextId: zone ? bedContextIdForZone(bed.id, zone) : bed.id,
      bedContextName: zone ? bedContextNameForZone(bed, zone) : bed.name,
      plotZoneId: zone ? zoneIdFor(zone) : null,
    };
  }

  function contextFromOriginCell(bed, originCell, key) {
    const explicitId = originCell?.bedContextId || null;
    const explicitName = originCell?.bedContextName || null;
    const explicitZone = originCell?.plotZoneId || null;
    if (explicitId || explicitName) {
      return {
        bedContextId: explicitId || bed.id,
        bedContextName: explicitName || bed.name,
        plotZoneId: explicitZone || parseContextZoneId(explicitId || '', bed.id),
      };
    }
    if (explicitZone) {
      const zone = plotLayoutForBed(bed).find(item => zoneIdFor(item) === explicitZone) || null;
      if (zone) {
        return {
          bedContextId: bedContextIdForZone(bed.id, zone),
          bedContextName: bedContextNameForZone(bed, zone),
          plotZoneId: explicitZone,
        };
      }
    }
    const parts = String(key || '').split(',').map(Number);
    if (parts.length === 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
      return bedContextForCell(bed, parts[0], parts[1], null);
    }
    return {
      bedContextId: bed.id,
      bedContextName: bed.name,
      plotZoneId: null,
    };
  }

  function lifecycleContextId(event) {
    return event?.bedContextId || event?.bedId || '';
  }

  function selectPlotZone(bedId, zoneId) {
    if (!bedId || !zoneId) return;
    if (selectedPlotZone?.bedId === bedId && selectedPlotZone?.zoneId === zoneId) {
      selectedPlotZone = null;
      renderCanvas();
      Toast.show('Zone selection cleared');
      return;
    }
    selectedPlotZone = { bedId, zoneId };
    renderCanvas();
    const bed = Store.getBeds().find(b => b.id === bedId);
    const zone = bed ? plotLayoutForBed(bed).find(item => zoneIdFor(item) === zoneId) : null;
    Toast.show(zone?.name ? `Selected zone: ${zone.name}` : 'Zone selected');
  }

  function clearPlotZone(bedId) {
    if (!selectedPlotZone || selectedPlotZone.bedId !== bedId) return;
    selectedPlotZone = null;
    renderCanvas();
    Toast.show('Zone selection cleared');
  }

  function zoneMouseDown(event, bedId, zoneId, mode) {
    if (event.button !== 0) return;
    event.preventDefault();
    const bed = Store.getBeds().find(b => b.id === bedId);
    if (!bed) return;
    const zone = plotLayoutForBed(bed).find(item => zoneIdFor(item) === zoneId);
    if (!zone) return;
    // Ensure the zone is selected (but don't toggle off during drag start)
    if (!selectedPlotZone || selectedPlotZone.bedId !== bedId || selectedPlotZone.zoneId !== zoneId) {
      selectedPlotZone = { bedId, zoneId };
    }
    const wrap = document.querySelector(`#bedblock-${bedId} .bed-grid-wrap`);
    const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
    const cellStep = CELL_SIZE + 2;
    const maxR = Math.min(bed.rows, MAX_CELLS) - 1;
    const maxC = Math.min(bed.cols, MAX_CELLS) - 1;
    let startR = zone.minR, startC = zone.minC;
    if (wrapRect) {
      const relX = event.clientX - wrapRect.left;
      const relY = event.clientY - wrapRect.top;
      startC = Math.max(0, Math.min(maxC, Math.floor((relX - 38) / cellStep)));
      startR = Math.max(0, Math.min(maxR, Math.floor((relY - 30) / cellStep)));
    }
    zoneMoveState = {
      bedId, zoneId, mode, startR, startC,
      origMinR: zone.minR, origMinC: zone.minC,
      origMaxR: zone.maxR, origMaxC: zone.maxC,
      previewMinR: zone.minR, previewMinC: zone.minC,
      previewMaxR: zone.maxR, previewMaxC: zone.maxC,
      moved: false,
    };
    renderCanvas();
  }

  function onZoneMoveMouse(event) {
    if (!zoneMoveState || !(event.buttons & 1)) { zoneMoveState = null; return; }
    const { bedId, zoneId, mode, startR, startC, origMinR, origMinC, origMaxR, origMaxC } = zoneMoveState;
    const wrap = document.querySelector(`#bedblock-${bedId} .bed-grid-wrap`);
    if (!wrap) return;
    const wrapRect = wrap.getBoundingClientRect();
    const bed = Store.getBeds().find(b => b.id === bedId);
    if (!bed) return;
    const maxR = Math.min(bed.rows, MAX_CELLS) - 1;
    const maxC = Math.min(bed.cols, MAX_CELLS) - 1;
    const cellStep = CELL_SIZE + 2;
    const relX = event.clientX - wrapRect.left;
    const relY = event.clientY - wrapRect.top;
    const curC = Math.max(0, Math.min(maxC, Math.floor((relX - 38) / cellStep)));
    const curR = Math.max(0, Math.min(maxR, Math.floor((relY - 30) / cellStep)));
    const dr = curR - startR;
    const dc = curC - startC;
    let newMinR = origMinR, newMinC = origMinC, newMaxR = origMaxR, newMaxC = origMaxC;
    if (mode === 'move') {
      const h = origMaxR - origMinR;
      const w = origMaxC - origMinC;
      newMinR = Math.max(0, Math.min(maxR - h, origMinR + dr));
      newMinC = Math.max(0, Math.min(maxC - w, origMinC + dc));
      newMaxR = newMinR + h;
      newMaxC = newMinC + w;
    } else if (mode === 'resize-tl') {
      newMinR = Math.max(0, Math.min(origMaxR, curR));
      newMinC = Math.max(0, Math.min(origMaxC, curC));
    } else if (mode === 'resize-tr') {
      newMinR = Math.max(0, Math.min(origMaxR, curR));
      newMaxC = Math.max(origMinC, Math.min(maxC, curC));
    } else if (mode === 'resize-bl') {
      newMinC = Math.max(0, Math.min(origMaxC, curC));
      newMaxR = Math.max(origMinR, Math.min(maxR, curR));
    } else if (mode === 'resize-br') {
      newMaxR = Math.max(origMinR, Math.min(maxR, curR));
      newMaxC = Math.max(origMinC, Math.min(maxC, curC));
    }
    if (newMinR === zoneMoveState.previewMinR && newMinC === zoneMoveState.previewMinC &&
        newMaxR === zoneMoveState.previewMaxR && newMaxC === zoneMoveState.previewMaxC) return;
    zoneMoveState.previewMinR = newMinR;
    zoneMoveState.previewMinC = newMinC;
    zoneMoveState.previewMaxR = newMaxR;
    zoneMoveState.previewMaxC = newMaxC;
    zoneMoveState.moved = true;
    // Update zone div position directly for smooth dragging
    const cs = CELL_SIZE;
    const wCells = newMaxC - newMinC + 1;
    const hCells = newMaxR - newMinR + 1;
    const zoneEl = document.getElementById(`plot-zone-${bedId}-${zoneId}`);
    if (zoneEl) {
      zoneEl.style.left   = `${10 + 28 + (newMinC * (cs + 2))}px`;
      zoneEl.style.top    = `${10 + 20 + (newMinR * (cs + 2))}px`;
      zoneEl.style.width  = `${(wCells * cs) + ((wCells - 1) * 2)}px`;
      zoneEl.style.height = `${(hCells * cs) + ((hCells - 1) * 2)}px`;
    }
  }

  function onZoneMoveEnd() {
    if (!zoneMoveState) return;
    const state = zoneMoveState;
    zoneMoveState = null;
    if (!state.moved) { renderCanvas(); return; }
    const { bedId, zoneId, previewMinR, previewMinC, previewMaxR, previewMaxC } = state;
    const beds = Store.getBeds();
    const bed = beds.find(b => b.id === bedId);
    if (!bed) return;
    const layout = plotLayoutForBed(bed);
    const zoneIdx = layout.findIndex(item => zoneIdFor(item) === zoneId);
    if (zoneIdx < 0) return;
    const newRect = { minR: previewMinR, minC: previewMinC, maxR: previewMaxR, maxC: previewMaxC };
    const others = layout.filter((_, i) => i !== zoneIdx);
    if (others.some(item => rectsOverlap(item, newRect))) {
      Toast.show('Cannot move/resize: overlaps another mapped bed');
      renderCanvas();
      return;
    }
    // Check for path overlap
    if (zoneOverlapsWithPaths(bed, newRect)) {
      Toast.show('Cannot move/resize: overlaps a path');
      renderCanvas();
      return;
    }
    pushUndo(bedId, bed);
    // Shift plants when moving (not when resizing)
    if (state.mode === 'move') {
      const dr = previewMinR - state.origMinR;
      const dc = previewMinC - state.origMinC;
      if (dr !== 0 || dc !== 0) {
        const { origMinR, origMinC, origMaxR, origMaxC } = state;
        const zoneCells = {};
        Object.entries(bed.cells).forEach(([key, val]) => {
          const [r, c] = key.split(',').map(Number);
          if (r >= origMinR && r <= origMaxR && c >= origMinC && c <= origMaxC) {
            zoneCells[key] = val;
            delete bed.cells[key];
          }
        });
        Object.entries(zoneCells).forEach(([key, val]) => {
          const [r, c] = key.split(',').map(Number);
          bed.cells[`${r + dr},${c + dc}`] = val;
        });
      }
    }
    const updated = [...layout];
    updated[zoneIdx] = { ...layout[zoneIdx], ...newRect };
    bed.plotLayout = updated;
    Store.updateBed(bed);
    renderBedList();
    renderCanvas();
    updateStats();
    Toast.show('Zone updated');
  }

  function rectsOverlap(a, b) {
    return !(a.maxR < b.minR || a.minR > b.maxR || a.maxC < b.minC || a.minC > b.maxC);
  }

  function zoneOverlapsWithPaths(bed, rect) {
    for (let r = rect.minR; r <= rect.maxR; r++) {
      for (let c = rect.minC; c <= rect.maxC; c++) {
        const cell = normalizeCellValue(bed.cells[`${r},${c}`], `${r},${c}`);
        if (cell?.plantId === '__path__') return true;
      }
    }
    return false;
  }

  function deleteZone(bedId, zoneId) {
    const beds = Store.getBeds();
    const bed = beds.find(b => b.id === bedId);
    if (!bed) return;
    const layout = plotLayoutForBed(bed);
    const zoneIdx = layout.findIndex(item => zoneIdFor(item) === zoneId);
    if (zoneIdx < 0) return;
    const zoneToDelete = layout[zoneIdx];
    if (!confirm(`Delete plot zone "${zoneToDelete.name || 'Zone'}"? Plants inside it will also be deleted.`)) return;
    pushUndo(bedId, bed);

    const instanceIdsToDelete = new Set();
    Object.entries(bed.cells).forEach(([key, value]) => {
      const cell = normalizeCellValue(value, key);
      if (!cell) return;
      const [r, c] = key.split(',').map(Number);
      if (!zoneContainsCell(zoneToDelete, r, c)) return;
      if (cell.instanceId) instanceIdsToDelete.add(cell.instanceId);
    });

    Object.entries(bed.cells).forEach(([key, value]) => {
      const cell = normalizeCellValue(value, key);
      if (!cell) return;
      const [r, c] = key.split(',').map(Number);
      if (cell.instanceId && instanceIdsToDelete.has(cell.instanceId)) {
        delete bed.cells[key];
        return;
      }
      if (zoneContainsCell(zoneToDelete, r, c)) delete bed.cells[key];
    });

    const updated = layout.filter((_, i) => i !== zoneIdx);
    bed.plotLayout = updated;
    if (selectedPlotZone?.zoneId === zoneId && selectedPlotZone?.bedId === bedId) {
      selectedPlotZone = null;
    }
    Store.updateBed(bed);
    renderBedList();
    renderCanvas();
    Toast.show('Zone and its plants deleted');
  }

  function togglePlotDraw(bedId) {
    if (!bedId) return;
    selectBed(bedId);
    if (selectedPlantId) disarm();
    const bed = Store.getBeds().find(b => b.id === bedId);
    ignoreNextClick = false;
    plotDrawMode = !plotDrawMode;
    plotAnchor = null;
    plotPaint = null;
    clearPreview();
    renderCanvas();
    if (plotDrawMode) Toast.show('Plot draw mode: click start corner, then opposite corner to create a mapped bed');
    else Toast.show('Plot draw mode off');
  }

  function startPlotZoneDraw(bedId) {
    if (!bedId) return;
    selectBed(bedId);
    if (selectedPlantId) disarm();
    ignoreNextClick = false;
    plotDrawMode = true;
    plotAnchor   = null;
    plotPaint    = null;
    clearPreview();
    renderCanvas();
    Toast.show('Click start corner, then opposite corner to add a sub-bed');
  }

  function createMappedBedFromRect(bedId, rect) {
    const beds = Store.getBeds();
    const parent = beds.find(b => b.id === bedId);
    if (!parent) return;

    const existing = plotLayoutForBed(parent);
    if (existing.some(item => rectsOverlap(item, rect))) {
      Toast.show('That rectangle overlaps an existing mapped bed');
      return;
    }

    const cols = (rect.maxC - rect.minC + 1);
    const rows = (rect.maxR - rect.minR + 1);
    if (cols < 1 || rows < 1) return;

    const defaultName = `${parent.name} zone ${existing.length + 1}`;
    const name = prompt('Name for this plot zone:', defaultName);
    if (name === null) return;
    const zoneId = `zone_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    parent.plotLayout = [
      ...existing,
      {
        id: zoneId,
        name: (name || defaultName).trim() || defaultName,
        minR: rect.minR,
        maxR: rect.maxR,
        minC: rect.minC,
        maxC: rect.maxC,
      },
    ];

    Store.updateBed(parent);
    selectedPlotZone = { bedId: parent.id, zoneId };
    // Plot-type beds stay in draw mode so the user can immediately add another zone.
    // Standard beds exit draw mode after zone creation.
    if (!isPlotBed(parent)) plotDrawMode = false;
    renderBedList();
    renderCanvas();
    updateStats();
    Toast.show(`Plot zone created: ${(name || defaultName).trim() || defaultName}`);
  }

  function placeRowSelection(paint) {
    if (!paint || !selectedPlantId) return null;
    const beds = Store.getBeds();
    const bed = beds.find(b => b.id === paint.bedId);
    const plant = PlantDB.get(selectedPlantId);
    if (!bed || !plant) return null;

    const rect = selectionRect(paint.startR, paint.startC, paint.endR, paint.endC);
    const zone = activePlotZoneForBed(paint.bedId);
    const isInfra = plant._isPath || plant.cat === 'infrastructure';

    // ── Path / infrastructure: place a single rect block ────────
    if (plant._isPath) {
      const isSingleCell = rect.minR === rect.maxR && rect.minC === rect.maxC;
      const useDefaultSize = isSingleCell && !paint.moved;
      const rows = useDefaultSize ? PATH_DEFAULT_CELLS : (rect.maxR - rect.minR + 1);
      const cols = useDefaultSize ? PATH_DEFAULT_CELLS : (rect.maxC - rect.minC + 1);
      const fp = { rows, cols, widthCm: cols * CELL_CM, heightCm: rows * CELL_CM };
      const origin = useDefaultSize
        ? getCenteredOrigin(bed, rect.minR, rect.minC, fp)
        : { startR: rect.minR, startC: rect.minC };
      if (!canPlaceFootprint(bed, origin.startR, origin.startC, fp)) {
        return { placed: 0, plannedRows: 0, plannedPerRow: 0, plannedTotal: 0, placedByRow: [] };
      }
      pushUndo(bed.id, bed);
      const context = bedContextForCell(bed, origin.startR, origin.startC, null);
      placeFootprint(bed, origin.startR, origin.startC, '__path__', fp, 0, undefined, null, {
        blockRows: rows, blockCols: cols,
        pathColor: pathConfig.color || null,
        pathDesc: pathConfig.desc || null,
        bedContextId: context.bedContextId,
        bedContextName: context.bedContextName,
        plotZoneId: context.plotZoneId,
      });
      Store.updateBed(bed);
      renderBedList();
      renderCanvas();
      updateStats();
      return { placed: 1, plannedRows: 1, plannedPerRow: 1, plannedTotal: 1, placedByRow: [{ rowIndex: 1, placed: 1 }] };
    }

    const fp = parseFootprint(plant, selectedRotation);
    if (!isInfra && zone && (!zoneContainsCell(zone, rect.minR, rect.minC) || !zoneContainsCell(zone, rect.maxR, rect.maxC))) {
      return {
        placed: 0,
        plannedRows: 0,
        plannedPerRow: 0,
        plannedTotal: 0,
        placedByRow: [],
      };
    }
    const rowSpan = rect.maxR - rect.minR + 1;
    const colSpan = rect.maxC - rect.minC + 1;
    const layout = rowLayoutCounts(rowSpan, colSpan, fp, plant.rowSpacing || 0);
    const plannedRows = layout.rows;
    const plannedPerRow = layout.perRow;
    const plannedTotal = layout.total;

    if (!plannedTotal) {
      return {
        placed: 0,
        plannedRows,
        plannedPerRow,
        plannedTotal,
        placedByRow: [],
      };
    }

    const blockFp = {
      rows: rowSpan,
      cols: colSpan,
      widthCm: colSpan * CELL_CM,
      heightCm: rowSpan * CELL_CM,
    };

    const mappedZones = plotLayoutForBed(bed);
    const contextZone2 = zone || mappedZones.find(item => zoneContainsFootprint(item, rect.minR, rect.minC, blockFp)) || null;
    if (!isInfra && mappedZones.length && !contextZone2) {
      return {
        placed: 0,
        plannedRows,
        plannedPerRow,
        plannedTotal,
        placedByRow: [],
      };
    }
    const contextZone = contextZone2;

    if (!canPlaceFootprint(bed, rect.minR, rect.minC, blockFp)) {
      return {
        placed: 0,
        plannedRows,
        plannedPerRow,
        plannedTotal,
        placedByRow: [],
      };
    }

    const inv = Store.getInventory();
    const chosenSeed = selectedSeedId ? inv.find(s => s.id === selectedSeedId && s.plantId === selectedPlantId) : null;
    pushUndo(bed.id, bed);

    const availableSeeds = (chosenSeed && (chosenSeed.qty || 0) > 0) ? (chosenSeed.qty || 0) : 0;
    const usedSeeds = Math.min(availableSeeds, plannedTotal);
    const placeSeedId = usedSeeds > 0 ? chosenSeed.id : null;
    const rowBatchId = `row_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const context = bedContextForCell(bed, rect.minR, rect.minC, contextZone);
    const instanceId = placeFootprint(
      bed,
      rect.minR,
      rect.minC,
      selectedPlantId,
      blockFp,
      selectedRotation,
      undefined,
      placeSeedId,
      {
        rowBatchId,
        rowBatchTotal: plannedTotal,
        rowBlockMode: true,
        rowBlockRows: plannedRows,
        rowBlockPerRow: plannedPerRow,
        rowBlockTotal: plannedTotal,
        blockRows: blockFp.rows,
        blockCols: blockFp.cols,
        bedContextId: context.bedContextId,
        bedContextName: context.bedContextName,
        plotZoneId: context.plotZoneId,
      }
    );

    if (selectedPlantId !== '__path__') {
      Store.addLifecycleEvent({
        seasonYear: activeSeasonYear(),
        bedId: bed.id,
        bedName: bed.name,
        bedContextId: context.bedContextId,
        bedContextName: context.bedContextName,
        instanceId,
        plantId: selectedPlantId,
        seedId: placeSeedId,
        fromState: null,
        toState: 'planned',
        action: 'row-block-placed',
        qty: plannedTotal,
      });
    }

    if (usedSeeds > 0) Store.adjustSeedQty(chosenSeed.id, -usedSeeds);
    Store.updateBed(bed);
    renderBedList();
    renderCanvas();
    renderBedJournal();
    updateArmedSeedToolbar();
    updateSelectedPanel();
    updateStats();

    const placedByRow = Array.from({ length: plannedRows }, (_, i) => ({ rowIndex: i + 1, placed: plannedPerRow }));
    return {
      placed: plannedTotal,
      plannedRows,
      plannedPerRow,
      plannedTotal,
      placedByRow,
    };
  }

  function clearInstanceFocus() {
    document.querySelectorAll('.gcell.instance-focus').forEach(el => el.classList.remove('instance-focus'));
  }

  function targetKey(target) {
    return `${target.bedId}::${target.instanceId}`;
  }

  function dedupeTargets(targets) {
    const map = new Map();
    targets.forEach(t => {
      if (!t?.bedId || !t?.instanceId) return;
      map.set(targetKey(t), { bedId: t.bedId, instanceId: t.instanceId });
    });
    return Array.from(map.values());
  }

  function getInstancesInRange(bedId, r1, c1, r2, c2) {
    // Get all unique instances that fall within rectangular region from (r1,c1) to (r2,c2)
    const beds = Store.getBeds();
    const bed = beds.find(b => b.id === bedId);
    if (!bed) return [];
    
    const minR = Math.min(r1, r2);
    const maxR = Math.max(r1, r2);
    const minC = Math.min(c1, c2);
    const maxC = Math.max(c1, c2);
    
    const found = new Map();
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const key = `${r},${c}`;
        const cell = normalizeCellValue(bed.cells[key], key);
        if (cell?.plantId && cell?.instanceId) {
          const iKey = `${bedId}::${cell.instanceId}`;
          found.set(iKey, { bedId, instanceId: cell.instanceId });
        }
      }
    }
    return Array.from(found.values());
  }

  function getLifecycleTargets() {
    if (selectedLifecycleInstances.length) return selectedLifecycleInstances;
    return lastClickedInstance ? [{ bedId: lastClickedInstance.bedId, instanceId: lastClickedInstance.instanceId }] : [];
  }

  function focusSelectedInstances() {
    clearInstanceFocus();
    selectedLifecycleInstances.forEach(t => {
      document.querySelectorAll(`.gcell[data-bed="${t.bedId}"][data-instance="${t.instanceId}"]`).forEach(el => {
        el.classList.add('instance-focus');
      });
    });
  }

  function clearInstanceHover() {
    document.querySelectorAll('.gcell.instance-hover').forEach(el => el.classList.remove('instance-hover'));
  }

  function focusInstanceCells(bedId, instanceId) {
    clearInstanceFocus();
    if (!bedId || !instanceId) return;
    document.querySelectorAll(`.gcell[data-bed="${bedId}"][data-instance="${instanceId}"]`).forEach(el => {
      el.classList.add('instance-focus');
    });
  }

  function hoverInstanceCells(bedId, instanceId) {
    clearInstanceHover();
    if (!bedId || !instanceId) return;
    document.querySelectorAll(`.gcell[data-bed="${bedId}"][data-instance="${instanceId}"]`).forEach(el => {
      el.classList.add('instance-hover');
    });
  }

  function updateRotationUi() {
    const label = document.getElementById('rotationLabel');
    if (label) label.textContent = `${selectedRotation}°`;
    const button = document.getElementById('rotate-selection-btn');
    if (!button) return;
    const activeBed = activeBedId ? Store.getBeds().find(b => b.id === activeBedId) : null;
    const plant = selectedPlantId ? PlantDB.get(selectedPlantId) : null;
    // Rotation is meaningless in seed trays (all plants are 1×1).
    const rotatable = !!(plant && isRotatable(plant) && !isSeedTrayBed(activeBed));
    button.disabled = !rotatable;
    button.title = rotatable
      ? 'Rotate rectangular footprint (R)'
      : (isSeedTrayBed(activeBed) ? 'Rotation not available in seed trays (all cells are 1×1)'
         : plant ? 'Rotation is only available for rectangular footprints' : 'Select a plant first');
  }

  function getPlacementPlan(bed, r, c, plantId, rotation = 0, ignoreInstanceId = null) {
    const plant = PlantDB.get(plantId);
    if (!plant) return null;
    const fp = parseFootprint(plant, rotation);
    const origin = getCenteredOrigin(bed, r, c, fp);
    const ok = canPlaceFootprint(bed, origin.startR, origin.startC, fp, ignoreInstanceId);
    return { plant, fp, origin, ok, rotation };
  }

  // For seed tray beds every plant is exactly 1×1. No centering offset needed.
  function getTrayPlacementPlan(bed, r, c, plantId, ignoreInstanceId = null) {
    const plant = PlantDB.get(plantId);
    if (!plant) return null;
    const fp = { widthCm: CELL_CM, heightCm: CELL_CM, cols: 1, rows: 1 };
    const ok = canPlaceFootprint(bed, r, c, fp, ignoreInstanceId);
    return { plant, fp, origin: { startR: r, startC: c }, ok, rotation: 0 };
  }

  function ensureHintEl() {
    if (hintEl) return hintEl;
    hintEl = document.createElement('div');
    hintEl.className = 'placement-hint';
    hintEl.style.display = 'none';
    document.body.appendChild(hintEl);
    return hintEl;
  }

  function updateHint(bedId, r, c, plant, fp, ok, rotation, mode = 'place') {
    const hint = ensureHintEl();
    const cellEl = document.querySelector(`[data-bed="${bedId}"][data-r="${r}"][data-c="${c}"]`);
    if (!cellEl) {
      hint.style.display = 'none';
      return;
    }
    const rect = cellEl.getBoundingClientRect();
    const rotLabel = rotation ? ` · ${rotation}°` : '';
    const prefix = mode === 'move' ? 'Move: ' : '';
    const rowSpHint = plant.rowSpacing ? ` · ${planRowSpacingCm(plant.rowSpacing)} cm row centers` : '';
    hint.textContent = `${prefix}${plant.emoji} ${plant.name} · ${fp.cols}×${fp.rows} cells (${fp.widthCm}×${fp.heightCm} cm${rowSpHint})${rotLabel}`;
    hint.classList.toggle('bad', !ok);
    hint.style.left = `${rect.left + rect.width}px`;
    hint.style.top = `${rect.top}px`;
    hint.style.display = 'block';
  }

  function showPlacementPreview(bedId, bed, r, c, plantId = selectedPlantId, rotation = selectedRotation, ignoreInstanceId = null, mode = 'place') {
    clearPreview();
    const plan = (plantId === '__path__')
      ? (() => {
          const fp = { rows: PATH_DEFAULT_CELLS, cols: PATH_DEFAULT_CELLS, widthCm: PATH_DEFAULT_CELLS * CELL_CM, heightCm: PATH_DEFAULT_CELLS * CELL_CM };
          const origin = getCenteredOrigin(bed, r, c, fp);
          const ok = canPlaceFootprint(bed, origin.startR, origin.startC, fp, ignoreInstanceId);
          return { plant: PlantDB.get('__path__'), fp, origin, ok, rotation: 0 };
        })()
      : isSeedTrayBed(bed)
          ? getTrayPlacementPlan(bed, r, c, plantId, ignoreInstanceId)
          : getPlacementPlan(bed, r, c, plantId, rotation, ignoreInstanceId);
    if (!plan) return;

    for (let rr = plan.origin.startR; rr < plan.origin.startR + plan.fp.rows; rr++) {
      for (let cc = plan.origin.startC; cc < plan.origin.startC + plan.fp.cols; cc++) {
        const el = document.querySelector(`[data-bed="${bedId}"][data-r="${rr}"][data-c="${cc}"]`);
        if (!el) continue;
        el.classList.add(plan.ok ? 'preview-ok' : 'preview-blocked');
        if (rr === plan.origin.startR && cc === plan.origin.startC) el.classList.add('preview-origin');
        previewEls.push(el);
      }
    }

    updateHint(bedId, r, c, plan.plant, plan.fp, plan.ok, rotation, mode);
  }

  // ── init ──────────────────────────────────────────────────────
  function init() {
    renderBedList();
    renderLibrary();
    renderCanvas();
    renderBedJournal();
    updateArmedSeedToolbar();
    updateStats();
    updateRotationUi();
  }

  // ── bed list (left sidebar) ───────────────────────────────────
  function renderBedList() {
    const beds = Store.getBeds();
    const el   = document.getElementById('bed-list');
    if (!beds.length) {
      el.innerHTML = '<div style="padding:14px;font-size:.78rem;color:var(--text-muted)">No beds yet.<br>Click <strong>+ New Bed</strong> to create one.</div>';
      activeBedId = null;
      return;
    }
    if (!activeBedId || !beds.find(b => b.id === activeBedId)) {
      activeBedId = beds[0].id;
    }

    el.innerHTML = beds.map(b => `
      <div class="bed-list-item ${b.id === activeBedId ? 'active' : ''}" onclick="Beds.selectBed('${b.id}')">
        <div class="bli-icon">🪴</div>
        <div style="flex:1;min-width:0">
          <div class="bli-name">${escHtml(b.name)}</div>
          <div class="bli-meta">${isSeedTrayBed(b) ? `🪴 ${b.cols}×${b.rows} cells` : isPlotBed(b) ? `🗺️ ${b.widthM}m × ${b.heightM}m · Plot` : `${b.widthM}m × ${b.heightM}m`} · ${countBedPlants(b)} plants</div>
        </div>
        <button class="btn btn-sm" title="Rename bed" onclick="event.stopPropagation();Beds.promptRenameBed('${b.id}')">✏️</button>
        <button class="btn btn-sm danger" title="Delete bed" onclick="event.stopPropagation();Beds.deleteBed('${b.id}')">🗑️</button>
      </div>`).join('');
  }

  function selectBed(id) {
    activeBedId = id;
    plotAnchor = null;
    clearPreview();
    if (selectedPlotZone?.bedId !== id) selectedPlotZone = null;
    selectedLifecycleInstances = selectedLifecycleInstances.filter(t => t.bedId === id);
    if (selectedLifecycleInstances.length) {
      lastClickedInstance = selectedLifecycleInstances[selectedLifecycleInstances.length - 1];
      lastClickedCell = null; // reset cell position when switching
    } else if (lastClickedInstance?.bedId !== id) {
      lastClickedInstance = null;
      lastClickedCell = null;
    } else {
      lastClickedCell = null; // reset cell position when switching
    }
    renderBedList();
    renderCanvas({ scrollToActive: true });
    renderBedJournal();
    updateStats();
  }

  function openBedJournal(id) {
    if (!id) return;
    selectBed(id);
    selectedBedFilter = id;
    switchTab('journal');
  }

  function openJournalAll() {
    selectedBedFilter = 'all';
    switchTab('journal');
  }

  // ── plant library (right-ish sidebar in bed page) ─────────────
  function renderLibrary() {
    const search  = (document.getElementById('bed-lib-search')?.value || '').toLowerCase();
    const catEl   = document.querySelector('#bed-lib-filters .ftab.active');
    const cat     = catEl?.dataset.cat ?? 'all';
    const seededCheckbox = document.getElementById('bed-lib-seeded-only');
    const showSeededOnly = seededCheckbox?.checked || selectedBedLibrarySeeded;
    
    // Get inventory plant IDs for seed filter
    const seedPlantIds = new Set();
    if (showSeededOnly) {
      Store.getInventory().forEach(seed => {
        if (seed.plantId) seedPlantIds.add(seed.plantId);
      });
    }
    
    const plants  = PlantDB.all().filter(p => {
      if (cat === 'custom' && !p._custom)  return false;
      if (cat !== 'all' && cat !== 'custom' && p.cat !== cat) return false;
      if (search && !p.name.toLowerCase().includes(search)) return false;
      if (showSeededOnly && !seedPlantIds.has(p.id)) return false;
      return true;
    });
    const el = document.getElementById('bed-plant-list');
    if (!plants.length) {
      el.innerHTML = '<div style="padding:12px;font-size:.78rem;color:var(--text-muted);text-align:center">No plants found.</div>';
      return;
    }
    el.innerHTML = plants.map(p => {
      const _fp2 = p._isPath ? null : parseFootprint(p, selectedPlantId === p.id ? selectedRotation : 0);
      const meta = p._isPath
        ? 'Walkway tile \u00b7 drag to paint \u00b7 pick colour'
        : `${p.spacing} cm${p.rowSpacing ? ` · +${planRowSpacingCm(p.rowSpacing)} cm rows` : ''} · ${_fp2.cols}×${_fp2.rows} · ${sunTxt(p.sun)}`;
      const badgeCat = p._isPath ? 'path' : (p._custom ? 'custom' : p.cat);
      return `
      <div class="plant-card ${selectedPlantId === p.id ? 'active' : ''} ${p._custom ? 'custom-marker' : ''} ${p._edited ? 'edited-marker' : ''}"
           onclick="Beds.armPlant('${p.id}')" title="${escAttr(p.notes||'')}">
        <div class="pc-emoji">${p.emoji}</div>
        <div class="pc-info">
          <div class="pc-name">${escHtml(p.name)}</div>
          <div class="pc-meta">${meta}</div>
        </div>
        <span class="plant-badge badge-${badgeCat}">${badgeCat}</span>
      </div>`;
    }).join('');
  }

  function armPlant(id) {
    if (plotDrawMode) {
      plotDrawMode = false;
      plotAnchor = null;
      clearPreview();
    }
    ignoreNextClick = false;
    selectedPlantId = (selectedPlantId === id) ? null : id;
    if (selectedPlantId) {
      rowPlacementMode = false;
      const plant = PlantDB.get(selectedPlantId);
      if (!isRotatable(plant)) selectedRotation = 0;
      const candidates = seedsForPlant(selectedPlantId, false);
      selectedSeedId = candidates[0]?.id || null;
    } else {
      selectedSeedId = null;
    }
    if (!selectedPlantId) clearPreview();
    renderLibrary();
    updateModePill();
    updateArmedSeedToolbar();
    updateSelectedPanel();
    updateRotationUi();
    renderCanvas();
  }

  function disarm() {
    ignoreNextClick = false;
    selectedPlantId = null;
    selectedSeedId = null;
    selectedRotation = 0;
    rowPlacementMode = false;
    lastClickedInstance = null;
    lastClickedCell = null;
    selectedLifecycleInstances = [];
    plotAnchor = null;
    plotPaint = null;
    plotDrawMode = false;
    clearInstanceFocus();
    clearPreview();
    renderLibrary();
    updateModePill();
    updateArmedSeedToolbar();
    updateSelectedPanel();
    updateRotationUi();
    renderCanvas();
  }

  function setArmedSeed(seedId) {
    if (!selectedPlantId) return;
    selectedSeedId = seedId || null;
    updateArmedSeedToolbar();
    updateSelectedPanel();
  }

  function setRowMode(enabled) {
    if (enabled) {
      const plant = selectedPlantId ? PlantDB.get(selectedPlantId) : null;
      if (plant && !plant._isPath && !(Number(plant.rowSpacing) > 0)) {
        Toast.show('Row mode requires a "Space between row centers" to be set on this plant. Set it via ✏️ Edit plant.');
        // Uncheck the checkbox without toggling mode on
        const cb = document.querySelector('#bed-info-selected-content input[type="checkbox"]');
        if (cb) cb.checked = false;
        return;
      }
    }
    rowPlacementMode = !!enabled;
    clearPreview();
    updateSelectedPanel();
  }

  function updateArmedSeedToolbar() {
    const wrap = document.getElementById('armed-seed-wrap');
    const sel = document.getElementById('armed-seed-select');
    const pathWrap = document.getElementById('armed-path-wrap');
    if (!wrap || !sel) return;
    const isPath = selectedPlantId === '__path__';
    if (!selectedPlantId) {
      wrap.style.display = 'none';
      sel.innerHTML = '';
      if (pathWrap) pathWrap.style.display = 'none';
      return;
    }
    if (isPath) {
      wrap.style.display = 'none';
      sel.innerHTML = '';
      if (pathWrap) {
        pathWrap.style.display = 'flex';
        const colEl = document.getElementById('path-config-color');
        const dEl = document.getElementById('path-config-desc');
        if (colEl) colEl.value = pathConfig.color;
        if (dEl) dEl.value = pathConfig.desc;
      }
      return;
    }
    if (pathWrap) pathWrap.style.display = 'none';
    const p = PlantDB.get(selectedPlantId);
    const inv = seedsForPlant(selectedPlantId, false);
    sel.innerHTML = ['<option value="">Generic (no packet)</option>', ...inv.map(s =>
      `<option value="${s.id}" ${selectedSeedId===s.id?'selected':''}>${escHtml(seedLabel(s))}</option>`
    )].join('');
    if (!selectedSeedId) sel.value = '';
    wrap.style.display = 'flex';
    wrap.title = p ? `Planting ${p.name}` : 'Seed packet';
  }

  function setPathConfig(field, value) {
    if (field === 'color') {
      pathConfig.color = value || '#c8a882';
    } else if (field === 'desc') {
      pathConfig.desc = String(value || '');
    }
    renderLibrary();
    renderCanvas();
  }

  function updateSelectedPathMeta(field, value) {
    if (!lastClickedInstance) return;
    const { bedId, instanceId } = lastClickedInstance;
    const beds = Store.getBeds();
    const bed = beds.find(b => b.id === bedId);
    if (!bed) return;

    let changed = false;
    Object.entries(bed.cells).forEach(([k, v]) => {
      const cell = normalizeCellValue(v, k);
      if (!cell || cell.instanceId !== instanceId || cell.plantId !== '__path__') return;
      const next = { ...cell };
      if (field === 'color') {
        const nextColor = value || '#c8a882';
        next.pathColor = nextColor;
        pathConfig.color = nextColor;
      } else if (field === 'desc') {
        const nextDesc = String(value || '').slice(0, 80);
        next.pathDesc = nextDesc || null;
        pathConfig.desc = nextDesc;
      } else {
        return;
      }
      bed.cells[k] = next;
      changed = true;
    });

    if (!changed) return;
    Store.updateBed(bed);
    renderLibrary();
    renderCanvas();
    const pathPlant = PlantDB.get('__path__');
    if (pathPlant) showPlantInfo(pathPlant, 0, instanceId, bedId);
  }

  function rotateSelection() {
    if (!selectedPlantId) {
      Toast.show('Select a plant first');
      return;
    }
    const plant = PlantDB.get(selectedPlantId);
    if (!isRotatable(plant)) {
      Toast.show('This plant has a square footprint');
      return;
    }
    selectedRotation = selectedRotation === 0 ? 90 : 0;
    updateRotationUi();
    updateModePill();
    updateSelectedPanel();
    renderLibrary();
  }

  function updateModePill() {
    const pill = document.getElementById('bed-mode-pill');
    if (!pill) return;
    if (selectedPlantId) {
      const p = PlantDB.get(selectedPlantId);
      pill.className = 'mode-pill placing';
      pill.textContent = `🌱 Placing: ${p?.name ?? selectedPlantId}${selectedRotation ? ` (${selectedRotation}°)` : ''}`;
      pill.title = 'Exit placement mode';
    } else if (lastClickedInstance) {
      const bed = Store.getBeds().find(b => b.id === lastClickedInstance.bedId);
      const origin = bed ? Object.values(bed.cells).find(v => v?.instanceId === lastClickedInstance.instanceId && v?.origin) : null;
      const p = origin ? PlantDB.get(origin.plantId) : null;
      pill.className = 'mode-pill selected';
      pill.textContent = p ? `${p.emoji} ${p.name}` : '🌱 Plant selected';
      pill.title = 'Click to deselect';
    } else {
      pill.className = 'mode-pill';
      pill.textContent = '👆 Nothing selected';
      pill.title = 'Click a plant in the bed to select it';
    }
  }

  // ── canvas (all beds stacked) ─────────────────────────────────
  function renderCanvas(opts = {}) {
    const scrollToActive = !!opts.scrollToActive;
    const beds    = Store.getBeds();
    const inner   = document.getElementById('bed-canvas-inner');
    if (!beds.length) {
      inner.innerHTML = `
        <div style="text-align:center;color:var(--text-muted);padding:60px 40px;font-size:.9rem">
          <div style="font-size:3rem;margin-bottom:12px">🪴</div>
          No beds yet. Click <strong>+ New Bed</strong> to create your first raised bed.
        </div>`;
      return;
    }
    inner.innerHTML = beds.map(b => bedBlockHtml(b)).join('');
    syncPlotAnchorPreview();
    if (selectedLifecycleInstances.length) focusSelectedInstances();
    else if (lastClickedInstance) focusInstanceCells(lastClickedInstance.bedId, lastClickedInstance.instanceId);
    if (scrollToActive) {
      const active = document.querySelector('.bed-block[data-id="' + activeBedId + '"]');
      if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  function placeArmedPlantAt(bedId, r, c, opts = {}) {
    if (!selectedPlantId) return false;
    const { skipUndo = false, silent = false } = opts;

    const beds = Store.getBeds();
    const bed  = beds.find(b => b.id === bedId);
    if (!bed) return false;

    // check seed availability (optional soft-warning)
    const inv = Store.getInventory();
    const chosenSeed = selectedSeedId ? inv.find(s => s.id === selectedSeedId && s.plantId === selectedPlantId) : null;
    const isPath = selectedPlantId === '__path__';
    const bedIsTray = isSeedTrayBed(bed);
    const plan = isPath
      ? (() => {
          const fp = { rows: PATH_DEFAULT_CELLS, cols: PATH_DEFAULT_CELLS, widthCm: PATH_DEFAULT_CELLS * CELL_CM, heightCm: PATH_DEFAULT_CELLS * CELL_CM };
          const origin = getCenteredOrigin(bed, r, c, fp);
          const ok = canPlaceFootprint(bed, origin.startR, origin.startC, fp);
          return { plant: PlantDB.get('__path__'), fp, origin, ok, rotation: 0 };
        })()
      : bedIsTray
          ? getTrayPlacementPlan(bed, r, c, selectedPlantId)
          : getPlacementPlan(bed, r, c, selectedPlantId, selectedRotation);
    const zone = bedIsTray ? null : activePlotZoneForBed(bedId);
    if (!plan) return false;

    if (!plan.ok) {
      if (!silent) Toast.show(`Not enough free space (${plan.fp.widthCm}×${plan.fp.heightCm} cm)`);
      return false;
    }
    const isInfra = plan.plant._isPath || plan.plant.cat === 'infrastructure';
    if (!bedIsTray) {
      const mappedZones = plotLayoutForBed(bed);
      const contextZone = zone || mappedZones.find(item => zoneContainsFootprint(item, plan.origin.startR, plan.origin.startC, plan.fp)) || null;
      if (!isInfra && mappedZones.length && !contextZone) {
        if (!silent) Toast.show('This plot uses mapped beds: place plants inside a mapped bed');
        return false;
      }
      if (!isInfra && !zoneContainsFootprint(contextZone, plan.origin.startR, plan.origin.startC, plan.fp)) {
        if (!silent) Toast.show('Selected zone active: place plants inside the highlighted zone');
        return false;
      }
    }

    if (!skipUndo) pushUndo(bedId, bed);

    // Crop rotation warning: skip for seed trays (rotation tracking is garden-side only)
    const plantBeingPlaced = PlantDB.get(selectedPlantId);
    if (!bedIsTray && plantBeingPlaced?.family && !plantBeingPlaced.rotationDisabled && !silent) {
      const currentYear = activeSeasonYear();
      for (let i = 1; i <= 3; i++) {
        const checkYear = currentYear - i;
        const families = Store.getFamiliesInBedYear(bedId, checkYear);
        if (families.has(plantBeingPlaced.family)) {
          Toast.show(`⚠️ Rotation: ${capFirst(plantBeingPlaced.family)} was in this bed in ${checkYear}!`);
          break;
        }
      }
    }

    const placeSeedId = (chosenSeed && (chosenSeed.qty || 0) > 0) ? chosenSeed.id : null;
    const effectiveZone = bedIsTray ? null : (zone || (plotLayoutForBed(bed).find(item => zoneContainsFootprint(item, plan.origin.startR, plan.origin.startC, plan.fp)) || null));
    const context = bedContextForCell(bed, plan.origin.startR, plan.origin.startC, effectiveZone);
    const pathMeta = isPath ? { pathColor: pathConfig.color || null, pathDesc: pathConfig.desc || null, blockRows: plan.fp.rows, blockCols: plan.fp.cols } : {};
    const instanceId = placeFootprint(
      bed,
      plan.origin.startR,
      plan.origin.startC,
      selectedPlantId,
      plan.fp,
      plan.rotation,
      undefined,
      placeSeedId,
      {
        bedContextId: context.bedContextId,
        bedContextName: context.bedContextName,
        plotZoneId: context.plotZoneId,
        ...pathMeta,
      }
    );

    if (selectedPlantId !== '__path__') {
      Store.addLifecycleEvent({
        seasonYear: activeSeasonYear(),
        bedId,
        bedName: bed.name,
        bedContextId: context.bedContextId,
        bedContextName: context.bedContextName,
        instanceId,
        plantId: selectedPlantId,
        seedId: placeSeedId,
        fromState: null,
        toState: 'planned',
        action: 'placed',
        qty: 1,
      });

      // deduct 1 seed from inventory if available
      if (placeSeedId) {
        Store.adjustSeedQty(placeSeedId, -1);
      } else if (selectedSeedId && chosenSeed && (chosenSeed.qty || 0) <= 0 && !silent) {
        Toast.show('Selected seed packet is out of stock, planted as generic');
      }
    }

    Store.updateBed(bed);
    clearPreview();
    renderBedList();
    renderCanvas();
    renderBedJournal();
    updateArmedSeedToolbar();
    updateSelectedPanel();
    updateStats();
    return true;
  }

  function cellMouseDown(event, bedId, r, c) {
    if (plotDrawMode) {
      if (event.button !== 0) return;
      event.preventDefault();
      plotPaint = {
        bedId,
        startR: r,
        startC: c,
        endR: r,
        endC: c,
        dragging: true,
        moved: false,
      };
      showPlotSelectionPreview(bedId, r, c, r, c);
      return;
    }

    if (!selectedPlantId) return;
    if (event.button !== 0) return;
    const zone = activePlotZoneForBed(bedId);
    const plant = PlantDB.get(selectedPlantId);
    const isInfra = plant?._isPath || plant?.cat === 'infrastructure';
    if (!isInfra && zone && !zoneContainsCell(zone, r, c)) {
      Toast.show('Selected zone active: draw/place inside the highlighted zone');
      return;
    }
    event.preventDefault();
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
    const useRowSelection = plant?._isPath || !!(rowPlacementMode && (plant?.rowSpacing || 0) > 0);

    if (useRowSelection) {
      paintState = {
        bedId,
        rowSelection: true,
        startR: r,
        startC: c,
        endR: r,
        endC: c,
        moved: false,
        hadPlacement: false,
      };
      showRowSelectionPreview(bedId, r, c, r, c, plant, selectedRotation);
      return;
    }
    if (plant?._isPath) {
      // Prevent single-click paint; path drag always uses rect-selection above
      // (but if somehow not row-selection, still place normally)
    }

    paintState = {
      bedId,
      rowSelection: false,
      placedKeys: new Set(),
      hadPlacement: false,
    };
    const didPlace = placeArmedPlantAt(bedId, r, c, { silent: true });
    if (didPlace) {
      paintState.hadPlacement = true;
      paintState.placedKeys.add(`${bedId}:${r},${c}`);
    }
  }

  function endPaint() {
    stopAutoScrollLoop();

    if (plotPaint?.dragging) {
      const drag = plotPaint;
      plotPaint = null;
      if (drag.moved) {
        const rect = selectionRect(drag.startR, drag.startC, drag.endR, drag.endC);
        plotAnchor = null;
        clearPreview();
        createMappedBedFromRect(drag.bedId, rect);
        ignoreNextClick = true;
      }
      return;
    }

    if (!paintState) return;
    if (paintState.rowSelection) {
      const result = placeRowSelection(paintState);
      const isPathPlant = selectedPlantId === '__path__';
      if (result?.placed > 0) {
        ignoreNextClick = true;
        if (isPathPlant) {
          Toast.show('Path placed');
        } else {
          const rowsWithPlants = result.placedByRow.filter(r => r.placed > 0).length;
          Toast.show(`Row mode: ${result.placed} placed · ${rowsWithPlants}/${result.plannedRows} rows used · target ${result.plannedPerRow}/row`);
        }
      } else {
        const plannedRows = result?.plannedRows || 0;
        const plannedPerRow = result?.plannedPerRow || 0;
        Toast.show(`No plant placed (selection plan: ${plannedRows} rows × ${plannedPerRow}/row)`);
      }
      clearPreview();
      paintState = null;
      lastPointerClientX = null;
      lastPointerClientY = null;
      return;
    }
    if (paintState.hadPlacement) ignoreNextClick = true;
    paintState = null;
    lastPointerClientX = null;
    lastPointerClientY = null;
  }

  function getBedCanvasAreaEl() {
    return document.querySelector('#page-beds .bed-canvas-area');
  }

  function stopAutoScrollLoop() {
    autoScrollVelY = 0;
    if (autoScrollRaf) {
      cancelAnimationFrame(autoScrollRaf);
      autoScrollRaf = null;
    }
  }

  function ensureAutoScrollLoop() {
    if (autoScrollRaf) return;
    const tick = () => {
      autoScrollRaf = null;
      if (!paintState?.rowSelection || !autoScrollVelY) return;
      const canvas = getBedCanvasAreaEl();
      if (!canvas) return;

      const prevScrollTop = canvas.scrollTop;
      canvas.scrollTop += autoScrollVelY;
      if (canvas.scrollTop !== prevScrollTop) {
        updateRowSelectionFromPointer(lastPointerClientX, lastPointerClientY);
      }

      if (paintState?.rowSelection && autoScrollVelY) {
        autoScrollRaf = requestAnimationFrame(tick);
      }
    };
    autoScrollRaf = requestAnimationFrame(tick);
  }

  function updateAutoScrollFromPointer(clientX, clientY) {
    if (!paintState?.rowSelection) {
      stopAutoScrollLoop();
      return;
    }
    const canvas = getBedCanvasAreaEl();
    if (!canvas || !Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      stopAutoScrollLoop();
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const edgePx = 44;
    const outsideTolerancePx = 140;
    const maxStep = 24;
    let nextVelY = 0;

    // Keep auto-scroll active when pointer slips slightly outside the canvas while dragging.
    const withinX = clientX >= (rect.left - outsideTolerancePx) && clientX <= (rect.right + outsideTolerancePx);
    if (withinX) {
      if (clientY <= rect.top + edgePx) {
        const dist = Math.min(edgePx + outsideTolerancePx, rect.top + edgePx - clientY);
        const intensity = Math.min(1, dist / edgePx);
        nextVelY = -Math.max(1, Math.ceil(maxStep * intensity));
      } else if (clientY >= rect.bottom - edgePx) {
        const dist = Math.min(edgePx + outsideTolerancePx, clientY - (rect.bottom - edgePx));
        const intensity = Math.min(1, dist / edgePx);
        nextVelY = Math.max(1, Math.ceil(maxStep * intensity));
      }
    }

    autoScrollVelY = nextVelY;
    if (autoScrollVelY) ensureAutoScrollLoop();
    else stopAutoScrollLoop();
  }

  function updateRowSelectionFromPointer(clientX, clientY) {
    if (!paintState?.rowSelection || !selectedPlantId) return;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;
    const el = document.elementFromPoint(clientX, clientY);
    const cellEl = el?.closest?.('.gcell');
    if (!cellEl) return;
    const bedId = cellEl.getAttribute('data-bed');
    if (!bedId || bedId !== paintState.bedId) return;
    const r = parseInt(cellEl.getAttribute('data-r') || '', 10);
    const c = parseInt(cellEl.getAttribute('data-c') || '', 10);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return;
    if (paintState.endR === r && paintState.endC === c) return;
    paintState.endR = r;
    paintState.endC = c;
    paintState.moved = paintState.moved || paintState.startR !== r || paintState.startC !== c;
    const plant = PlantDB.get(selectedPlantId);
    if (plant) showRowSelectionPreview(bedId, paintState.startR, paintState.startC, r, c, plant, selectedRotation);
  }

  function bedBlockHtml(bed) {
    const cols  = Math.min(bed.cols, MAX_CELLS);
    const rows  = Math.min(bed.rows, MAX_CELLS);
    const cs    = CELL_SIZE;
    const count = countBedPlants(bed);
    const invById = new Map(Store.getInventory().map(s => [s.id, s]));
    const bedById = new Map(Store.getBeds().map(b => [b.id, b]));
    const mapped = plotLayoutForBed(bed);
    const activeZone = activePlotZoneForBed(bed.id);

    const instanceMeta = {};
    Object.entries(bed.cells).forEach(([key, val]) => {
      const cell = normalizeCellValue(val, key);
      if (!cell) return;
      const [r, c] = key.split(',').map(Number);
      const existing = instanceMeta[cell.instanceId] || {
        minR: r, maxR: r, minC: c, maxC: c,
        seedId: null,
        lifecycle: 'planned',
      };
      existing.minR = Math.min(existing.minR, r);
      existing.maxR = Math.max(existing.maxR, r);
      existing.minC = Math.min(existing.minC, c);
      existing.maxC = Math.max(existing.maxC, c);
      if (cell.origin) existing.seedId = cell.seedId || null;
      if (cell.origin) existing.lifecycle = cell.lifecycle || 'planned';
      instanceMeta[cell.instanceId] = existing;
    });

    Object.values(instanceMeta).forEach(meta => {
      const seed = meta.seedId ? invById.get(meta.seedId) : null;
      meta.imageSources = seedImageSources(seed);
      meta.cols = (meta.maxC - meta.minC) + 1;
      meta.rows = (meta.maxR - meta.minR) + 1;
    });

    // col labels
    let colLabels = `<div class="bed-col-labels">`;
    const isTray = isSeedTrayBed(bed);
    const isPlot = isPlotBed(bed);
    for (let c = 0; c < cols; c++) {
      colLabels += `<div class="bed-col-lbl" style="width:${cs}px;height:20px">${isTray ? (c + 1) : `${((c + 1) * CELL_M).toFixed(2)}m`}</div>`;
    }
    colLabels += `</div>`;

    let rowsHtml = '';
    const pathLabelOverlays = [];
    for (let r = 0; r < rows; r++) {
      rowsHtml += `<div class="bed-row">
        <div class="bed-row-lbl">${isTray ? (r + 1) : `${((r + 1) * CELL_M).toFixed(2)}m`}</div>`;
      for (let c = 0; c < cols; c++) {
        const key    = `${r},${c}`;
        const cell   = normalizeCellValue(bed.cells[key], key);
        const plant  = cell ? PlantDB.get(cell.plantId) : null;
        const isOrigin = !!cell?.origin;
        const meta   = cell ? instanceMeta[cell.instanceId] : null;
        const hasSeedImage = false;
        const isPerimeterCell = !!(meta && (r === meta.minR || r === meta.maxR || c === meta.minC || c === meta.maxC));
        const occ    = plant ? ' occupied' : '';
        const catCls = plant ? ` cat-${plant._isPath ? 'path' : (plant.cat || 'other')}` : '';
        const rg = plant && !plant._isPath ? rotationGroup(plant) : null;
        const rotCls = rg ? ` rot-${rg.key}` : '';
        const lifecycle = meta?.lifecycle || cell?.lifecycle || 'planned';
        const lcMeta = LC_META[lifecycle] || LC_META.planned;
        const isMultiCellPlant = !!(meta && (meta.rows > 1 || meta.cols > 1));
        const showLifecycleStrip = !isMultiCellPlant || (!!meta && r === meta.maxR);
        const showDeleteButton = !!(plant && meta && r === meta.minR && c === meta.maxC);
        const pm     = selectedPlantId ? ' placing-mode' : '';
        const canPl  = !plant ? ' can-place' : '';
        const pathCls = plant?._isPath ? ' gcell-path' : '';
        const pathBg = plant?._isPath ? (cell?.pathColor || '#c8a882') : null;
        const pathColorStyle = pathBg ? `;background:${pathBg};border-color:${pathBg}` : '';
        const dragAttrs = (plant && isOrigin)
          ? `draggable="true" ondragstart="Beds.dragStart(event,'${bed.id}',${r},${c})" ondragend="Beds.dragEnd()"`
          : '';
        rowsHtml += `<div class="gcell${occ}${catCls}${rotCls}${pm}${canPl}${pathCls}"
          ${dragAttrs}
          style="width:${cs}px;height:${cs}px${pathColorStyle}"
          data-bed="${bed.id}" data-r="${r}" data-c="${c}"
          data-instance="${cell?.instanceId || ''}"
          onclick="Beds.cellClick(event,'${bed.id}',${r},${c})"
          onmousedown="Beds.cellMouseDown(event,'${bed.id}',${r},${c})"
          onmouseenter="Beds.cellEnter(event,'${bed.id}',${r},${c})"
          onmouseleave="Beds.cellLeave('${bed.id}')"
          ondragover="Beds.dragOver(event,'${bed.id}',${r},${c})"
          ondrop="Beds.drop(event,'${bed.id}',${r},${c})">`;
        if (plant && isOrigin) {
          if (plant._isPath) {
            const pathDesc = cell?.pathDesc || '';
            if (pathDesc) {
              const blockRows = Math.max(1, Number(cell?.blockRows) || 1);
              const blockCols = Math.max(1, Number(cell?.blockCols) || 1);
              const left = 10 + 28 + (c * (cs + 2));
              const top = 10 + 20 + (r * (cs + 2));
              const width = (blockCols * cs) + ((blockCols - 1) * 2);
              const height = (blockRows * cs) + ((blockRows - 1) * 2);
              const fontPx = Math.max(10, Math.min(26, Math.floor(Math.min(width, height) * 0.22)));
              pathLabelOverlays.push(`<div class="gcell-path-block-label" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;font-size:${fontPx}px" title="${escAttr(pathDesc)}">${escHtml(pathDesc)}</div>`);
            }
          } else {
            const fontSize = cs >= 56 ? '1.6rem' : (cs >= 40 ? '1.1rem' : '.9rem');
            const density = densityPerCell(plant);
            const dimensionLabel = cell.rowBlockMode && cell.rowBlockTotal > 1
              ? `<span class="gcell-dimension" style="font-size:.5rem;color:#666;display:block;margin-top:2px">${cell.blockCols * CELL_CM}×${cell.blockRows * CELL_CM}cm</span>`
              : '';
            rowsHtml += `<div class="gcell-inner">
              <div class="gcell-emoji" style="font-size:${fontSize}">${plant.emoji}</div>
                <div class="gcell-name" title="${escAttr(rg?.full || rg?.label || 'Crop rotation family')}">${escHtml(plant.name)}${density > 1 ? ` <span class="gcell-density">×${density}</span>` : ''}${dimensionLabel}</div>
              </div>
              `;
          }
        }
        if (showDeleteButton) {
          rowsHtml += `<button class="gcell-del" onclick="Beds.removePlant(event,'${bed.id}',${r},${c})">✕</button>`;
        }
        if (plant && !plant._isPath && showLifecycleStrip) {
          rowsHtml += `<div class="gcell-lc-strip" style="background:${lcMeta.color}" title="${lcMeta.label}"></div>`;
        }
        if (plant && !plant._isPath && !hasSeedImage && !isOrigin && isPerimeterCell) {
          rowsHtml += `<div class="gcell-edge-icon" aria-hidden="true">${plant.emoji}</div>`;
        }
        rowsHtml += `</div>`;
      }
      rowsHtml += `</div>`;
    }

    const mappedCountText = mapped.length ? `${mapped.length} mapped bed${mapped.length !== 1 ? 's' : ''}` : '';
    const pathLabelOverlayHtml = pathLabelOverlays.length
      ? `<div style="position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:3">${pathLabelOverlays.join('')}</div>`
      : '';
    const mappedOverlayHtml = mapped.length ? `<div style="position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:4">
      ${mapped.map(item => {
        const wCells = item.maxC - item.minC + 1;
        const hCells = item.maxR - item.minR + 1;
        const left = 10 + 28 + (item.minC * (cs + 2));
        const top = 10 + 20 + (item.minR * (cs + 2));
        const width = (wCells * cs) + ((wCells - 1) * 2);
        const height = (hCells * cs) + ((hCells - 1) * 2);
        const zId = zoneIdFor(item);
        const legacyBed = item.bedId ? bedById.get(item.bedId) : null;
        const label = item.name || legacyBed?.name || 'Plot zone';
        const active = activeZone && zoneIdFor(activeZone) === zId;
        const canInteract = !selectedPlantId && !plotDrawMode;
        const labelPtrEvents = (selectedPlantId || plotDrawMode) ? 'none' : 'auto';
        const moveHandle = (active && canInteract)
          ? `<div title="Drag to move zone" style="position:absolute;left:2px;top:2px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;background:#1d3557;border-radius:3px;cursor:grab;pointer-events:auto;user-select:none" onmousedown="event.stopPropagation();Beds.zoneMouseDown(event,'${bed.id}','${zId}','move')">⠿</div>`
          : '';
        const deleteHandle = (active && canInteract)
          ? `<div title="Delete zone" style="position:absolute;right:2px;top:2px;width:14px;height:14px;display:flex;align-items:center;justify-content:center;font-size:10px;color:#fff;background:#e63946;border-radius:3px;cursor:pointer;pointer-events:auto;user-select:none" onclick="event.stopPropagation();Beds.deleteZone('${bed.id}','${zId}')">✕</div>`
          : '';
        const resizeHandles = (active && canInteract)
          ? `<div title="Resize" style="position:absolute;top:-4px;left:-4px;width:10px;height:10px;background:#1d3557;border-radius:2px;cursor:nwse-resize;pointer-events:auto" onmousedown="event.stopPropagation();Beds.zoneMouseDown(event,'${bed.id}','${zId}','resize-tl')"></div><div title="Resize" style="position:absolute;top:-4px;right:-4px;width:10px;height:10px;background:#1d3557;border-radius:2px;cursor:nesw-resize;pointer-events:auto" onmousedown="event.stopPropagation();Beds.zoneMouseDown(event,'${bed.id}','${zId}','resize-tr')"></div><div title="Resize" style="position:absolute;bottom:-4px;left:-4px;width:10px;height:10px;background:#1d3557;border-radius:2px;cursor:nesw-resize;pointer-events:auto" onmousedown="event.stopPropagation();Beds.zoneMouseDown(event,'${bed.id}','${zId}','resize-bl')"></div><div title="Resize" style="position:absolute;bottom:-4px;right:-4px;width:10px;height:10px;background:#1d3557;border-radius:2px;cursor:nwse-resize;pointer-events:auto" onmousedown="event.stopPropagation();Beds.zoneMouseDown(event,'${bed.id}','${zId}','resize-br')"></div>`
          : '';
        return `<div id="plot-zone-${bed.id}-${zId}" style="position:absolute;left:${left}px;top:${top}px;width:${width}px;height:${height}px;border:${active ? 3 : 2}px dashed ${active ? '#1d3557' : '#3a86ff'};border-radius:6px;background:${active ? 'rgba(29,53,87,.14)' : 'rgba(58,134,255,.08)'}">
          <div onclick="event.stopPropagation();Beds.selectPlotZone('${bed.id}','${zId}')" style="position:absolute;left:2px;top:2px;max-width:calc(100% - ${active && canInteract ? 36 : 4}px);font-size:.58rem;font-weight:800;line-height:1.1;padding:1px 4px;border-radius:10px;background:rgba(255,255,255,.92);border:1px solid rgba(0,0,0,.1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;pointer-events:${labelPtrEvents};cursor:pointer">${escHtml(label)}</div>
          ${deleteHandle}${moveHandle}${resizeHandles}
        </div>`;
      }).join('')}
    </div>` : '';

    return `
<div class="bed-block${isTray ? ' seed-tray-block' : ''}${isPlot ? ' plot-bed-block' : ''}" data-id="${bed.id}" id="bedblock-${bed.id}" style="width:fit-content">
  <div class="bed-title-bar">
    <input value="${escAttr(bed.name)}" onchange="Beds.renameBed('${bed.id}',this.value)" spellcheck="false">
    <div class="bed-title-actions">
      <div class="bed-title-actions-left">
        ${isTray
          ? '<span class="tray-badge">🪴 Seed Tray</span>'
          : isPlot
            ? (plotDrawMode && activeBedId === bed.id
                ? `<button class="btn btn-sm btn-danger" onclick="Beds.togglePlotDraw('${bed.id}')" title="Exit zone drawing">✕ Done</button>`
                : `<button class="btn btn-sm" onclick="Beds.startPlotZoneDraw('${bed.id}')" title="Add a sub-bed zone">➕ Add bed</button>`)
            : ''}
        <button class="btn btn-sm" onclick="Beds.openBedJournal('${bed.id}')" title="Open this bed in Journal tab">📒 Journal</button>
        <button class="btn btn-sm" onclick="Beds.editBedSize('${bed.id}')" title="${isTray ? 'Resize tray' : 'Resize bed'}">⇔ Resize</button>
      </div>
      <div class="bed-title-actions-mid">
        <div class="bed-title-size" title="Bed size summary">
          ${isTray
            ? `<span class="bed-size-main">🪴 ${cols}×${rows} cells</span>`
            : `<span class="bed-size-main">📏 ${bed.widthM}m × ${bed.heightM}m</span>
               <span class="bed-size-chip">${cols}×${rows} cells @ ${CELL_CM}cm</span>`}
          <span class="bed-size-chip">${count} plants</span>
          ${!isTray && mappedCountText ? `<span class="bed-size-chip">${mappedCountText}</span>` : ''}
          ${!isTray && activeZone ? `<span class="bed-size-chip bed-size-chip-active">Editing: ${escHtml(activeZone.name || 'zone')}</span>` : ''}
        </div>
      </div>
      <div class="bed-title-actions-right">
        <button class="btn btn-sm danger" onclick="Beds.deleteBed('${bed.id}')" title="Delete bed">🗑️</button>
      </div>
    </div>
  </div>
  <div class="bed-grid-wrap" style="position:relative">
    ${colLabels}
    ${rowsHtml}
    ${pathLabelOverlayHtml}
    ${mappedOverlayHtml}
  </div>
</div>`;
  }

  // ── cell interactions ─────────────────────────────────────────
  function cellClick(event, bedId, r, c) {
    if (ignoreNextClick) {
      ignoreNextClick = false;
      return;
    }
    const beds = Store.getBeds();
    const bed  = beds.find(b => b.id === bedId);
    if (!bed) return;
    const zone = activePlotZoneForBed(bedId);

    if (plotDrawMode && bedId === activeBedId) {
      if (!plotAnchor || plotAnchor.bedId !== bedId) {
        plotAnchor = { bedId, r, c };
        showPlotSelectionPreview(bedId, r, c, r, c);
        Toast.show('Plot draw: now click opposite corner to create the mapped bed');
        return;
      }
      const rect = selectionRect(plotAnchor.r, plotAnchor.c, r, c);
      plotAnchor = null;
      clearPreview();
      createMappedBedFromRect(bedId, rect);
      return;
    }

    if (zone && !zoneContainsCell(zone, r, c)) {
      Toast.show('Selected zone active: click inside the highlighted zone');
      return;
    }

    if (selectedPlantId) {
      selectedLifecycleInstances = [];
      lastClickedInstance = null;
      lastClickedCell = null;
      clearInstanceFocus();
      placeArmedPlantAt(bedId, r, c);
    } else {
      // show info panel for occupied cell
      const key = `${r},${c}`;
      const cell = normalizeCellValue(bed.cells[key], key);
      const pid = cell?.plantId;
      if (pid) {
        const target = { bedId, instanceId: cell.instanceId };
        const isCtrlClick = !!(event?.ctrlKey || event?.metaKey);
        const isShiftClick = !!(event?.shiftKey);
        
        if (isCtrlClick) {
          // Ctrl+Click: toggle individual plant
          const existingIdx = selectedLifecycleInstances.findIndex(t => t.bedId === target.bedId && t.instanceId === target.instanceId);
          if (existingIdx >= 0) {
            selectedLifecycleInstances.splice(existingIdx, 1);
          } else {
            selectedLifecycleInstances = dedupeTargets([...selectedLifecycleInstances, target]);
          }
          if (!selectedLifecycleInstances.length) {
            lastClickedInstance = null;
            lastClickedCell = null;
            clearInstanceFocus();
            updateSelectedPanel();
            return;
          }
          lastClickedInstance = selectedLifecycleInstances[selectedLifecycleInstances.length - 1];
          lastClickedCell = { bedId, r, c };
          focusSelectedInstances();
        } else if (isShiftClick && lastClickedCell && lastClickedCell.bedId === bedId) {
          // Shift+Click: select all plants between anchor cell and current cell (rectangular range)
          const rangeInstances = getInstancesInRange(bedId, lastClickedCell.r, lastClickedCell.c, r, c);
          selectedLifecycleInstances = dedupeTargets([...selectedLifecycleInstances, ...rangeInstances]);
          lastClickedInstance = target;
          lastClickedCell = { bedId, r, c };
          focusSelectedInstances();
        } else {
          // Normal click: clear previous selection and select only this plant
          lastClickedInstance = target;
          lastClickedCell = { bedId, r, c };
          selectedLifecycleInstances = [target];
          focusSelectedInstances();
        }
        const infoTarget = lastClickedInstance;
        const infoBed = infoTarget ? beds.find(b => b.id === infoTarget.bedId) : null;
        const infoOrigin = infoBed
          ? Object.values(infoBed.cells).find(v => v?.instanceId === infoTarget.instanceId && v?.origin)
          : null;
        if (infoOrigin) {
          const infoPlant = PlantDB.get(infoOrigin.plantId);
          if (infoPlant) showPlantInfo(infoPlant, infoOrigin.rotation || 0, infoTarget.instanceId, infoTarget.bedId);
        } else {
          showPlantInfo(PlantDB.get(pid), cell.rotation || 0, cell.instanceId, bedId);
        }
        updateModePill();
      } else {
        selectedLifecycleInstances = [];
        lastClickedInstance = null;
        lastClickedCell = null;
        clearInstanceFocus();
        updateModePill();
      }
    }
  }

  function dragStart(event, bedId, r, c) {
    if (selectedPlantId) {
      event.preventDefault();
      return;
    }
    const bed = Store.getBeds().find(b => b.id === bedId);
    const cell = bed ? normalizeCellValue(bed.cells[`${r},${c}`], `${r},${c}`) : null;
    if (!bed || !cell?.origin) {
      event.preventDefault();
      return;
    }
    dragState = {
      sourceBedId: bedId,
      sourceR: r,
      sourceC: c,
      instanceId: cell.instanceId,
      plantId: cell.plantId,
      rotation: cell.rotation || 0,
      seedId: cell.seedId || null,
      blockRows: cell.blockRows || 0,
      blockCols: cell.blockCols || 0,
      pathColor: cell.pathColor || null,
      pathDesc: cell.pathDesc || null,
      rowBatchId: cell.rowBatchId || null,
      rowBatchTotal: cell.rowBatchTotal || 0,
      rowBlockMode: !!cell.rowBlockMode,
      rowBlockRows: cell.rowBlockRows || 0,
      rowBlockPerRow: cell.rowBlockPerRow || 0,
      rowBlockTotal: cell.rowBlockTotal || 0,
    };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', cell.instanceId);
    event.target.closest('.gcell')?.classList.add('drag-source');
    clearPreview();
  }

  function dragOver(event, bedId, r, c) {
    if (!dragState) return;
    event.preventDefault();
    const bed = Store.getBeds().find(b => b.id === bedId);
    if (!bed) return;
    const ignoreInstanceId = bedId === dragState.sourceBedId ? dragState.instanceId : null;
    showPlacementPreview(bedId, bed, r, c, dragState.plantId, dragState.rotation, ignoreInstanceId, 'move');
  }

  function drop(event, bedId, r, c) {
    if (!dragState) return;
    event.preventDefault();
    const beds = Store.getBeds();
    const targetBed = beds.find(b => b.id === bedId);
    const sourceBed = beds.find(b => b.id === dragState.sourceBedId);
    if (!targetBed || !sourceBed) {
      dragEnd();
      return;
    }

    const ignoreInstanceId = bedId === dragState.sourceBedId ? dragState.instanceId : null;
    const plan = (() => {
      if (dragState.blockRows > 0 && dragState.blockCols > 0) {
        const fp = {
          rows: dragState.blockRows,
          cols: dragState.blockCols,
          widthCm: dragState.blockCols * CELL_CM,
          heightCm: dragState.blockRows * CELL_CM,
        };
        const origin = getCenteredOrigin(targetBed, r, c, fp);
        const ok = canPlaceFootprint(targetBed, origin.startR, origin.startC, fp, ignoreInstanceId);
        return { fp, origin, ok };
      }
      return getPlacementPlan(targetBed, r, c, dragState.plantId, dragState.rotation, ignoreInstanceId);
    })();
    if (!plan?.ok) {
      Toast.show('Cannot move plant there');
      dragEnd();
      return;
    }

    pushUndo(sourceBed.id, sourceBed);
    if (targetBed.id !== sourceBed.id) pushUndo(targetBed.id, targetBed);
    removePlantInstance(sourceBed, dragState.sourceR, dragState.sourceC);
    placeFootprint(
      targetBed,
      plan.origin.startR,
      plan.origin.startC,
      dragState.plantId,
      plan.fp,
      dragState.rotation,
      dragState.instanceId,
      dragState.seedId || null,
      {
        blockRows: dragState.blockRows || 0,
        blockCols: dragState.blockCols || 0,
        pathColor: dragState.pathColor || null,
        pathDesc: dragState.pathDesc || null,
        rowBatchId: dragState.rowBatchId || null,
        rowBatchTotal: dragState.rowBatchTotal || 0,
        rowBlockMode: !!dragState.rowBlockMode,
        rowBlockRows: dragState.rowBlockRows || 0,
        rowBlockPerRow: dragState.rowBlockPerRow || 0,
        rowBlockTotal: dragState.rowBlockTotal || 0,
      }
    );
    Store.updateBed(sourceBed);
    if (targetBed.id !== sourceBed.id) Store.updateBed(targetBed); else Store.updateBed(targetBed);
    renderBedList();
    renderCanvas();
    renderBedJournal();
    updateStats();
    Toast.show('Plant moved');
    dragEnd();
  }

  function dragEnd() {
    document.querySelectorAll('.drag-source').forEach(el => el.classList.remove('drag-source'));
    clearPreview();
    dragState = null;
  }

  function removePlant(event, bedId, r, c) {
    event.stopPropagation();
    const zone = activePlotZoneForBed(bedId);
    if (zone && !zoneContainsCell(zone, r, c)) {
      Toast.show('Selected zone active: remove plants inside the highlighted zone');
      return;
    }
    const beds = Store.getBeds();
    const bed  = beds.find(b => b.id === bedId);
    const target = bed ? normalizeCellValue(bed.cells[`${r},${c}`], `${r},${c}`) : null;
    if (!bed || !target) return;
    pushUndo(bedId, bed);
    removePlantInstance(bed, r, c);
    selectedLifecycleInstances = selectedLifecycleInstances.filter(t => !(t.bedId === bedId && t.instanceId === target.instanceId));
    if (selectedLifecycleInstances.length) {
      lastClickedInstance = selectedLifecycleInstances[selectedLifecycleInstances.length - 1];
      lastClickedCell = null; // reset cell position when plant is deleted
      focusSelectedInstances();
    } else if (lastClickedInstance?.instanceId === target.instanceId && lastClickedInstance?.bedId === bedId) {
      lastClickedInstance = null;
      lastClickedCell = null;
      clearInstanceFocus();
    }
    Store.updateBed(bed);
    renderBedList();
    renderCanvas();
    renderBedJournal();
    updateStats();
  }

  function cellEnter(event, bedId, r, c) {
    if (Number.isFinite(event?.clientX)) lastPointerClientX = event.clientX;
    if (Number.isFinite(event?.clientY)) lastPointerClientY = event.clientY;
    updateAutoScrollFromPointer(lastPointerClientX, lastPointerClientY);
    const beds = Store.getBeds();
    const bed  = beds.find(b => b.id === bedId);
    if (!bed) return;

    if (plotDrawMode && plotPaint?.dragging && plotPaint.bedId === bedId && (event?.buttons & 1)) {
      if (plotPaint.endR !== r || plotPaint.endC !== c) {
        plotPaint.endR = r;
        plotPaint.endC = c;
        plotPaint.moved = true;
        showPlotSelectionPreview(bedId, plotPaint.startR, plotPaint.startC, r, c);
      }
      return;
    }

    if (paintState && selectedPlantId && paintState.bedId === bedId && (event?.buttons & 1)) {
      if (paintState.rowSelection) {
        paintState.endR = r;
        paintState.endC = c;
        paintState.moved = paintState.moved || paintState.startR !== r || paintState.startC !== c;
        const plant = PlantDB.get(selectedPlantId);
        if (plant) showRowSelectionPreview(bedId, paintState.startR, paintState.startC, paintState.endR, paintState.endC, plant, selectedRotation);
        return;
      }

      const key = `${bedId}:${r},${c}`;
      if (!paintState.placedKeys.has(key)) {
        const placed = placeArmedPlantAt(bedId, r, c, {
          silent: true,
          skipUndo: paintState.hadPlacement,
        });
        if (placed) {
          paintState.hadPlacement = true;
          paintState.placedKeys.add(key);
        }
      }
      return;
    }

    if (selectedPlantId) {
      showPlacementPreview(bedId, bed, r, c, selectedPlantId, selectedRotation);
      return;
    }

    const key = `${r},${c}`;
    const base = normalizeCellValue(bed.cells[key], key);
    const pid = base?.plantId;
    if (!pid) return;
    const plant = PlantDB.get(pid);
    if (!plant) return;

    hoverInstanceCells(bedId, base.instanceId);

    // Keep clicked selection pinned so hover does not hide lifecycle controls.
    if (lastClickedInstance) return;
    if (!selectedPlantId) showPlantInfo(plant, base?.rotation || 0);
  }

  function cellLeave(bedId) {
    document.querySelectorAll(`[data-bed="${bedId}"]`).forEach(el => {
      el.classList.remove('hl-good', 'hl-bad');
    });
    clearInstanceHover();
    clearPreview();
  }

  // ── info panel ────────────────────────────────────────────────
  function showPlantInfo(p, rotation = 0, instanceId = null, bedId = null) {
    const sec = document.getElementById('bed-info-detail');
    const el  = document.getElementById('bed-info-content');
    if (!p || !sec || !el) return;
    sec.style.display = 'block';
    const good = (p.good??[]).map(id => PlantDB.get(id)).filter(Boolean);
    const bad  = (p.bad ??[]).map(id => PlantDB.get(id)).filter(Boolean);

    // seed stock
    const inv   = Store.getInventory().filter(s => s.plantId === p.id);
    const stock = inv.reduce((a, s) => a + (s.qty||0), 0);
    const stockUnit = inv[0]?.unit ?? 'seeds';

    const fp = parseFootprint(p, rotation);
    // Spacing label: show plant footprint and row spacing separately when set
    const spacingNums = (String(p.spacing||'').match(/\d+(?:[.,]\d+)?/g)||[]).map(n=>parseFloat(n.replace(',','.')));
    const spW = spacingNums[0]||CELL_CM, spH = spacingNums[1]||spW;
    const rowSp = planRowSpacingCm(p.rowSpacing || 0);
    const spacingLabel = rowSp > 0
      ? `${spW}×${spH} cm plant · ${rowSp} cm between row centers`
      : (spW !== spH ? `↔ ${spW} cm · ↕ ${spH} cm` : `${spW} cm`);
    const density = densityPerCell(p);

    let seedAssignHtml = '';
    if (instanceId && bedId && !p._isPath) {
      const bed = Store.getBeds().find(b => b.id === bedId);
      let currentSeedId = null;
      if (bed) {
        const origin = Object.values(bed.cells).find(v => v?.instanceId === instanceId && v?.origin);
        currentSeedId = origin?.seedId || null;
      }
      const options = seedsForPlant(p.id, false);
      const optHtml = [`<option value="">Generic (no packet)</option>`, ...options.map(s =>
        `<option value="${s.id}" ${currentSeedId===s.id?'selected':''}>${escHtml(seedLabel(s))}</option>`
      )].join('');
      seedAssignHtml = `
      <div style="margin-bottom:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--surface2)">
        <div style="font-size:.62rem;font-weight:800;color:var(--text-muted);margin-bottom:5px">🏷 SEED PACKET</div>
        <select onchange="Beds.setInstanceSeed(this.value)">${optHtml}</select>
      </div>`;
    }

    let pathEditHtml = '';
    if (p._isPath) {
      const hasSelectedPathInstance = !!(instanceId && bedId);
      const bed = hasSelectedPathInstance ? Store.getBeds().find(b => b.id === bedId) : null;
      const origin = (bed && hasSelectedPathInstance)
        ? Object.values(bed.cells).find(v => v?.instanceId === instanceId && v?.origin)
        : null;
      const currentColor = origin?.pathColor || pathConfig.color || '#c8a882';
      const currentDesc = origin?.pathDesc || pathConfig.desc || '';
      const colorHandler = hasSelectedPathInstance
        ? `Beds.updateSelectedPathMeta('color',this.value)`
        : `Beds.setPathConfig('color',this.value)`;
      const descHandler = hasSelectedPathInstance
        ? `Beds.updateSelectedPathMeta('desc',this.value)`
        : `Beds.setPathConfig('desc',this.value)`;
      pathEditHtml = `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:.62rem;font-weight:800;color:var(--text-muted);margin-bottom:6px">🛤 PATH STYLE</div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
          <label style="font-size:.72rem;font-weight:700;min-width:46px">Color</label>
          <input type="color" value="${escAttr(currentColor)}" oninput="${colorHandler}">
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <label style="font-size:.72rem;font-weight:700;min-width:46px">Label</label>
          <input type="text" maxlength="80" value="${escAttr(currentDesc)}" placeholder="Path label" style="flex:1" onchange="${descHandler}">
        </div>
        ${hasSelectedPathInstance ? '' : '<div style="margin-top:6px;font-size:.68rem;color:var(--text-muted)">Tip: click an existing path block to edit only that one.</div>'}
      </div>`;
    }

    // Row details section (only when a specific instance is selected)
    let rowDetailsHtml = '';
    if (instanceId && bedId && !p._isPath) {
      const bed = Store.getBeds().find(b => b.id === bedId);
      if (bed) {
        const originCell = Object.entries(bed.cells)
          .map(([k, v]) => normalizeCellValue(v, k))
          .find(v => v?.instanceId === instanceId && v?.origin);
        if (originCell && (originCell.rowBlockMode || originCell.rowBatchTotal > 1)) {
          let rowDetailsContent = '';
          const totalPlants = originCell.rowBlockMode && originCell.rowBlockTotal > 1
            ? originCell.rowBlockTotal
            : (originCell.rowBatchTotal > 1 ? originCell.rowBatchTotal : 1);

          const totalWidth = originCell.blockCols * CELL_CM;
          const totalHeight = originCell.blockRows * CELL_CM;

          rowDetailsContent = `<div style="font-size:.72rem;margin-bottom:4px"><strong>📊 Plants:</strong> ${totalPlants}</div>`;

          if (originCell.rowBlockMode && originCell.rowBlockTotal > 1) {
            const plantShortCm = Math.max(CELL_CM, Math.min(fp.widthCm || CELL_CM, fp.heightCm || CELL_CM));
            const plantLongCm = Math.max(CELL_CM, Math.max(fp.widthCm || CELL_CM, fp.heightCm || CELL_CM));
            const rowGap = planRowSpacingCm(p.rowSpacing || 0);
            const requiredWidthCm = originCell.rowBlockPerRow * plantLongCm;
            const requiredHeightCm = (originCell.rowBlockRows * plantShortCm) + (Math.max(0, originCell.rowBlockRows - 1) * rowGap);
            const requiredCellsW = Math.max(1, Math.ceil(requiredWidthCm / CELL_CM));
            const requiredCellsH = Math.max(1, Math.ceil(requiredHeightCm / CELL_CM));
            const requiredAreaSqCm = Math.round(requiredWidthCm * requiredHeightCm);

            rowDetailsContent += `<div style="font-size:.72rem;margin-bottom:4px"><strong>📏 Space:</strong> ${requiredWidthCm}×${requiredHeightCm} cm</div>`;
            rowDetailsContent += `<div style="font-size:.72rem;margin-bottom:4px"><strong>📐 Area:</strong> ${requiredAreaSqCm} sq cm</div>`;
            rowDetailsContent += `<div style="font-size:.72rem;margin-bottom:4px"><strong>🔲 Cells needed:</strong> ${requiredCellsW}×${requiredCellsH} cells</div>`;
            rowDetailsContent += `<div style="font-size:.72rem">
              <strong>📋 Row Block:</strong> ${originCell.rowBlockRows} rows × ${originCell.rowBlockPerRow} plants/row
            </div>`;
            if (rowGap > 0) {
              rowDetailsContent += `<div style="font-size:.7rem;color:var(--text-muted);margin-top:2px">(row gap included: ${(originCell.rowBlockRows - 1)} × ${rowGap} cm)</div>`;
            }
          } else {
            const areaSqCm = Math.round(totalWidth * totalHeight);
            rowDetailsContent += `<div style="font-size:.72rem;margin-bottom:4px"><strong>📏 Space:</strong> ${totalWidth}×${totalHeight} cm</div>`;
            rowDetailsContent += `<div style="font-size:.72rem;margin-bottom:4px"><strong>📐 Area:</strong> ${areaSqCm} sq cm</div>`;
          }

          if (rowDetailsContent) {
            rowDetailsHtml = `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:.62rem;font-weight:800;color:var(--text-muted);margin-bottom:5px">📐 ROW DETAILS</div>
        ${rowDetailsContent}
      </div>`;
          }
        }
      }
    }

    // Lifecycle section (only when a specific instance is selected)
    let lcHtml = '';
    if (instanceId && bedId && !p._isPath) {
      const bed = Store.getBeds().find(b => b.id === bedId);
      let lifecycle = 'planned';
      let linkedSeed = null;
      if (bed) {
        const origin = Object.values(bed.cells).find(v => v?.instanceId === instanceId && v?.origin);
        lifecycle = origin?.lifecycle || 'planned';
        linkedSeed = origin?.seedId ? Store.getInventory().find(s => s.id === origin.seedId) : null;
      }
      const meta = LC_META[lifecycle] || LC_META.planned;
      const selectionCount = getLifecycleTargets().length;
      const timeline = lifecycleTimelineForInstance(instanceId, bedId, p.id);
      const started = timeline.find(t => t.state === 'direct_sow' || t.state === 'tray_seeded') || null;
      const germinated = timeline.find(t => t.state === 'germinated') || null;
      const expectedGermMin = Math.max(0, parseInt(linkedSeed?.germinationDaysMin ?? p?.germinationDaysMin, 10) || 0);
      const expectedGermMax = Math.max(expectedGermMin, parseInt(linkedSeed?.germinationDaysMax ?? p?.germinationDaysMax, 10) || expectedGermMin);
      const actualGermDays = started && germinated ? daysBetweenYmd(started.date, germinated.date) : null;
      const germinationHint = expectedGermMax > 0
        ? (actualGermDays === null
            ? `Expected germination: ${expectedGermMin === expectedGermMax ? `${expectedGermMin}d` : `${expectedGermMin}-${expectedGermMax}d`}`
            : `Expected: ${expectedGermMin === expectedGermMax ? `${expectedGermMin}d` : `${expectedGermMin}-${expectedGermMax}d`} · Actual: ${actualGermDays}d`)
        : (actualGermDays !== null ? `Actual germination: ${actualGermDays}d` : 'Set germination expectation in Plant or Seed details');
      const timelineHtml = timeline.length
        ? `<div style="margin-top:8px;border:1px solid var(--border);border-radius:8px;padding:6px;background:#fafcf7">
            <div style="font-size:.64rem;font-weight:800;color:var(--text-muted);margin-bottom:5px">⏱ PHASE DATES</div>
            ${timeline.map((step, idx) => {
              const m = LC_META[step.state] || { icon: '•', label: step.state };
              const prev = idx > 0 ? timeline[idx - 1] : null;
              const delta = prev ? daysBetweenYmd(prev.date, step.date) : null;
              return `<div style="display:flex;justify-content:space-between;gap:8px;font-size:.72rem;margin:2px 0">
                <span>${m.icon} ${escHtml(m.label)}</span>
                <span>${escHtml(new Date(`${step.date}T12:00:00`).toLocaleDateString())}${delta !== null ? ` · +${delta}d` : ''}</span>
              </div>`;
            }).join('')}
          </div>`
        : '<div style="font-size:.68rem;color:var(--text-muted);margin-top:6px">No growth phase dates recorded yet.</div>';

      lcHtml = `
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
        <div style="font-size:.62rem;font-weight:800;color:var(--text-muted);margin-bottom:5px">🌿 GROWTH STATUS</div>
        ${selectionCount > 1 ? `<div style="font-size:.68rem;color:var(--text-muted);margin-bottom:5px">Applying changes to <strong>${selectionCount}</strong> selected instances</div>` : ''}
        <div style="font-size:.72rem;margin-bottom:6px">Now: <strong style="color:${meta.color}">${meta.icon} ${meta.label}</strong></div>
        ${started ? `<div style="font-size:.72rem;margin-bottom:5px"><strong>Start date:</strong> ${escHtml(new Date(`${started.date}T12:00:00`).toLocaleDateString())} (${LC_META[started.state]?.label || started.state})</div>` : '<div style="font-size:.72rem;margin-bottom:5px;color:var(--text-muted)">Start date: not started yet (set Direct sowing or Seedling tray)</div>'}
        <div style="font-size:.68rem;color:var(--text-muted);margin-bottom:6px">${escHtml(germinationHint)}</div>
        <div style="display:flex;gap:6px;align-items:center;max-width:100%">
          <select id="lc-status-select" style="flex:1;min-width:0;font-size:.72rem" onchange="Beds.setLifecycle(this.value)">
            ${(() => {
              let states = lcStatesForBed(bedId ? Store.getBeds().find(b => b.id === bedId) : null);
              if (p.plantingMode === 'direct')    states = states.filter(s => s !== 'tray_seeded' && s !== 'transplanted');
              if (p.plantingMode === 'transplant') states = states.filter(s => s !== 'direct_sow');
              return states.map(s => {
                const m = LC_META[s];
                return `<option value="${s}" ${s===lifecycle?'selected':''}>${m.icon} ${m.label}</option>`;
              }).join('');
            })()}
          </select>
        </div>
        ${timelineHtml}
      </div>`;
    }

    // Planting mode — inline select, always shown for non-path plants
    let plantingModeHtml = '';
    if (!p._isPath) {
      plantingModeHtml = `
      <div style="margin-top:6px;margin-bottom:6px">
        <div style="font-size:.62rem;font-weight:800;color:var(--text-muted);margin-bottom:4px">🌱 PREFERRED METHOD</div>
        <select style="font-size:.75rem" onchange="Beds.setPlantingMode(this.value)">
          <option value=""         ${!p.plantingMode              ? 'selected' : ''}>Not specified</option>
          <option value="direct"   ${p.plantingMode === 'direct'   ? 'selected' : ''}>🌰 Direct sow</option>
          <option value="transplant" ${p.plantingMode === 'transplant' ? 'selected' : ''}>🏺 Transplant (start in tray)</option>
        </select>
      </div>`;
    }

    // Transplant source block (normal beds only, hidden when direct-sow mode)
    let transplantSourceHtml = '';
    if (instanceId && bedId && !p._isPath && p.plantingMode !== 'direct') {
      const currentBed = Store.getBeds().find(b => b.id === bedId);
      if (currentBed && !isSeedTrayBed(currentBed)) {
        const originCell = Object.values(currentBed.cells).find(v => v?.instanceId === instanceId && v?.origin);
        const linkedBedId  = originCell?.transplantSourceBedId      || '';
        const linkedInstId = originCell?.transplantSourceInstanceId || '';

        // Build candidate groups: keyed by trayId + seedId, counting ready plants
        const groupMap = new Map(); // key: `trayId::seedId` → { tray, seedId, seed, count }
        Store.getBeds().filter(b => isSeedTrayBed(b)).forEach(tray => {
          Object.entries(tray.cells).forEach(([k, v]) => {
            const cell = normalizeCellValue(v, k);
            if (!cell?.origin || cell.plantId !== p.id) return;
            if (!['ready_to_transplant', 'hardened'].includes(cell.lifecycle)) return;
            const sid = cell.seedId || '';
            const key = `${tray.id}::${sid}`;
            if (!groupMap.has(key)) {
              const seed = sid ? Store.getInventory().find(s => s.id === sid) : null;
              groupMap.set(key, { tray, seedId: sid, seed, count: 0 });
            }
            groupMap.get(key).count += 1;
          });
        });
        const candidates = [...groupMap.entries()].map(([key, g]) => {
          const parts = [];
          if (g.seed?.variety) parts.push(g.seed.variety);
          if (g.seed?.seedTag) parts.push(`#${g.seed.seedTag}`);
          const slbl = parts.length ? parts.join(' · ') : 'Generic';
          const plural = g.count === 1 ? 'plant' : 'plants';
          return { value: key, label: `${escHtml(g.tray.name)} — ${escHtml(slbl)} (${g.count} ${plural} ready)` };
        });

        const linkedLabel = linkedInstId
          ? (() => {
              const srcBed = Store.getBeds().find(b => b.id === linkedBedId);
              if (!srcBed) return 'Source tray deleted';
              const srcCell = Object.values(srcBed.cells).find(v => v?.instanceId === linkedInstId && v?.origin);
              const lc = srcCell ? (LC_META[srcCell.lifecycle] || {}) : {};
              return `${escHtml(srcBed.name)} · ${lc.icon || ''} ${lc.label || 'transplanted'}`;
            })()
          : '';

        transplantSourceHtml = `
        <div class="transplant-source-block">
          <div class="ts-header">🏺 Source from tray</div>
          ${linkedInstId
            ? `<div class="transplant-source-linked">✅ Linked: ${linkedLabel}</div>
               <button class="btn btn-secondary btn-sm" style="margin-top:6px;width:100%" onclick="Beds.unlinkTransplantSource()">Unlink</button>`
            : candidates.length
              ? `<select id="ts-source-select">
                   <option value="">— pick a tray seedling —</option>
                   ${candidates.map(c => `<option value="${c.value}">${c.label}</option>`).join('')}
                 </select>
                 <button class="btn btn-primary btn-sm" style="margin-top:4px;width:100%" onclick="Beds.linkTransplantSource()">Link &amp; remove from tray</button>`
              : `<div style="font-size:.7rem;color:var(--text-muted);padding:4px 0">No tray seedlings ready — advance tray plants to <em>Ready to transplant</em> or <em>Hardened off</em>.</div>`
          }
        </div>`;
      }
    }

    // Get seed image if instance has a seed assigned
    let seedImageHtml = '';
    if (instanceId && bedId) {
      const bed = Store.getBeds().find(b => b.id === bedId);
      if (bed) {
        const origin = Object.values(bed.cells).find(v => v?.instanceId === instanceId && v?.origin);
        if (origin?.seedId) {
          const seed = Store.getInventory().find(s => s.id === origin.seedId);
          if (seed) {
            const sources = seedImageSources(seed);
            if (sources.length) {
              seedImageHtml = `<div style="position:relative;width:120px;height:140px">
                <img src="${escAttr(sources[0])}" alt="${escAttr(seedLabel(seed))} packet" style="width:100%;height:100%;object-fit:cover;border-radius:4px;border:2px solid #ddd" data-src-list="${escAttr(sources.join('|'))}" data-src-index="0" onload="Beds.handlePlantSeedImageLoad(this)" onerror="Beds.handlePlantSeedImageError(this)" />
                <div style="display:none;position:absolute;top:0;left:0;width:100%;height:100%;border-radius:4px;border:2px solid #ddd;background:#f5f5f5;font-size:3rem;display:flex;align-items:center;justify-content:center;color:#999">${p.emoji}</div>
              </div>`;
            }
          }
        }
      }
    }

    el.innerHTML = `
      ${seedAssignHtml}
      ${(() => { const rg = rotationGroup(p); return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px;background:${rg.bg};border-radius:var(--radius);border:2px solid ${rg.border};margin-bottom:8px">
        <div style="font-size:2.2rem">${seedImageHtml ? '' : p.emoji}</div>
        ${seedImageHtml ? `<div style="flex-shrink:0">${seedImageHtml}</div>` : ''}
        <div style="flex:1">
          <div style="font-weight:800;font-size:.95rem">${escHtml(p.name)}</div>
          <div style="font-size:.7rem;color:var(--text-muted)">${p.cat} · ${fp.cols}×${fp.rows} cells${rotation ? `, ${rotation}°` : ''}</div>
        </div>
        <span style="font-size:.62rem;font-weight:800;padding:2px 7px;border-radius:10px;background:${rg.bg};border:1.5px solid ${rg.border};color:${rg.color};white-space:nowrap">♻️ ${escHtml(rg.label)}</span>
      </div>`;})()}
      ${(() => { const _rg = rotationGroup(p); return _rg.key === 'disabled'
        ? `<div style="margin-bottom:8px;padding:5px 8px;border-radius:var(--radius);background:#f5f5f5;border:1.5px solid #aaa;color:#777;font-size:.7rem">♻️ Crop rotation tracking <strong>disabled</strong> for this plant.</div>`
        : `<div style="margin-bottom:8px;padding:5px 8px;border-radius:var(--radius);background:${_rg.bg};border:1.5px solid ${_rg.border}">
            <div style="font-size:.6rem;font-weight:800;color:${_rg.color};text-transform:uppercase;letter-spacing:.04em;margin-bottom:2px">♻️ Crop rotation group</div>
            <div style="font-size:.75rem;font-weight:700;color:${_rg.color}">${escHtml(_rg.full)}</div>
            <div style="font-size:.65rem;color:${_rg.color};opacity:.75;margin-top:1px">Avoid planting in the same bed within 3 years of other ${escHtml(_rg.label.toLowerCase())}.</div>
           </div>`; })()}
      <div class="prop-grid">
        <div class="prop-item"><div class="prop-label">☀️ Sun</div><div class="prop-value">${capFirst(p.sun)}</div></div>
        <div class="prop-item"><div class="prop-label">💧 Water</div><div class="prop-value">${capFirst(p.water)}</div></div>
        <div class="prop-item"><div class="prop-label">📐 Spacing</div><div class="prop-value">${spacingLabel}</div></div>
        <div class="prop-item"><div class="prop-label">⏱️ Days</div><div class="prop-value">${p.daysToHarvest}</div></div>
        ${density > 1 ? `<div class="prop-item" style="grid-column:1/-1"><div class="prop-label">🔢 Density</div><div class="prop-value">×${density} plants per cell</div></div>` : ''}
        ${p.family ? `<div class="prop-item" style="grid-column:1/-1"><div class="prop-label">🌿 Family</div><div class="prop-value">${capFirst(p.family)}</div></div>` : ''}
      </div>
      ${stock > 0
        ? `<div style="margin-top:6px;font-size:.75rem;color:var(--primary-dark);font-weight:700">📦 Seed stock: ${stock} ${stockUnit}</div>`
        : `<div style="margin-top:6px;font-size:.75rem;color:var(--bad);font-weight:700">📦 No seeds in inventory</div>`}
      ${p.notes ? `<div style="margin-top:6px;font-size:.75rem;color:var(--text-muted);line-height:1.5">${escHtml(p.notes)}</div>` : ''}
      ${good.length ? `<div style="margin-top:8px"><div style="font-size:.62rem;font-weight:800;color:#2e7d32;margin-bottom:4px">✅ GOOD COMPANIONS</div>
        <div class="companion-list">${good.map(q=>`<span class="ctag ctag-good">${q.emoji} ${escHtml(q.name)}</span>`).join('')}</div></div>` : ''}
      ${bad.length  ? `<div style="margin-top:6px"><div style="font-size:.62rem;font-weight:800;color:#c62828;margin-bottom:4px">❌ AVOID</div>
        <div class="companion-list">${bad.map(q=>`<span class="ctag ctag-bad">${q.emoji} ${escHtml(q.name)}</span>`).join('')}</div></div>` : ''}
      ${pathEditHtml}
      ${lcHtml}
      ${rowDetailsHtml}
      ${plantingModeHtml}
      ${transplantSourceHtml}
      ${!p._isPath ? `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
        <button class="btn btn-secondary btn-sm" onclick="CustomPlants.openEdit('${p.id}')">✏️ Edit plant</button>
      </div>` : ''}
    `;
  }

  function updateSelectedPanel() {
    const sec  = document.getElementById('bed-info-selected');
    const el   = document.getElementById('bed-info-selected-content');
    if (!sec || !el) return;
    if (!selectedPlantId) {
      el.innerHTML = '<div class="no-select"><div style="font-size:2rem;margin-bottom:5px">👆</div>Click a plant to arm it, then click any cell to place it.</div>';
      if (!lastClickedInstance) {
        const detail = document.getElementById('bed-info-detail');
        if (detail) detail.style.display = 'none';
      }
      return;
    }
    const p = PlantDB.get(selectedPlantId);
    const inv = seedsForPlant(p.id, false);
    const stock = inv.reduce((a, s) => a + (s.qty||0), 0);
    const packetOptions = ['<option value="">Generic (no packet)</option>', ...inv.map(s =>
      `<option value="${s.id}" ${selectedSeedId===s.id?'selected':''}>${escHtml(seedLabel(s))}</option>`
    )].join('');
    const editPlantBtn = !p._isPath
      ? `<button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="CustomPlants.openEdit('${p.id}')">✏️ Edit plant</button>`
      : '';
    const rowModeHtml = !p._isPath ? `
      <div style="margin-top:6px;padding:6px;border:1px solid var(--border);border-radius:8px;background:#fafcf7">
        <label style="display:flex;align-items:center;gap:8px;font-size:.74rem;font-weight:700;cursor:pointer;color:var(--text)">
          <input type="checkbox" ${rowPlacementMode ? 'checked' : ''} onchange="Beds.setRowMode(this.checked)">
          Plant in rows mode
        </label>
        <div style="margin-top:4px;font-size:.68rem;color:var(--text-muted)">Drag a rectangle over cells; preview shows rows × plants per row based on plant footprint.${p.rowSpacing ? ` Row spacing: +${planRowSpacingCm(p.rowSpacing)} cm (rounded to 10 cm for planning).` : ''}</div>
      </div>` : '';
    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;background:#ddf4ea;border-radius:var(--radius);border:2px solid var(--primary-light)">
        <div style="font-size:2rem">${p.emoji}</div>
        <div style="flex:1">
          <div style="font-weight:800">${escHtml(p.name)}</div>
          <div style="font-size:.68rem;color:var(--text-muted)">${p.spacing} cm${p.rowSpacing ? ` · +${planRowSpacingCm(p.rowSpacing)} cm rows` : ''} (${parseFootprint(p, selectedRotation).cols}×${parseFootprint(p, selectedRotation).rows} cells${selectedRotation ? `, ${selectedRotation}°` : ''})</div>
        </div>
        <button class="btn btn-danger btn-sm" onclick="Beds.disarm()">✕</button>
      </div>
      <div style="margin-top:6px">
        <div style="font-size:.64rem;color:var(--text-muted);font-weight:800;margin-bottom:4px">Seed packet for next placement</div>
        <select onchange="Beds.setArmedSeed(this.value)">${packetOptions}</select>
      </div>
      <div style="margin-top:6px;font-size:.74rem;color:${stock>0?'var(--primary)':'var(--bad)'};font-weight:700">
        📦 ${stock > 0 ? `${stock} ${inv[0]?.unit??'seeds'} in stock — 1 deducted per placement` : 'No seeds in inventory (will still place)'}
      </div>
      ${rowModeHtml}
      ${editPlantBtn}`;

    // Keep Plant Details synced with currently armed plant.
    showPlantInfo(p, selectedRotation);
  }

  // ── stats panel ───────────────────────────────────────────────
  // ── lifecycle ─────────────────────────────────────────────────
  function setInstanceSeed(seedId) {
    const targets = getLifecycleTargets();
    if (!targets.length) return;
    
    const beds = Store.getBeds();
    let updateCount = 0;
    
    targets.forEach(({ bedId, instanceId }) => {
      const bed = beds.find(b => b.id === bedId);
      if (!bed) return;
      
      // Validate: check if all instances share the same plant
      const origin = Object.values(bed.cells).find(v => v?.instanceId === instanceId && v?.origin);
      if (!origin) return;
      
      const plant = PlantDB.get(origin.plantId);
      if (!plant) return;
      
      // Validate seed packet is compatible with plant
      if (seedId) {
        const seed = Store.getInventory().find(s => s.id === seedId);
        if (!seed || seed.plantId !== plant.id) {
          // Skip incompatible packet
          return;
        }
      }
      
      // Apply seed to all cells of this instance
      Object.entries(bed.cells).forEach(([k, v]) => {
        if (typeof v === 'object' && v?.instanceId === instanceId && v?.origin) {
          bed.cells[k] = { ...v, seedId: seedId || null };
        }
      });
      
      updateCount++;
      Store.updateBed(bed);
    });
    
    // Update display (show last clicked instance if available)
    if (lastClickedInstance) {
      const bed = beds.find(b => b.id === lastClickedInstance.bedId);
      if (bed) {
        const origin = Object.values(bed.cells).find(v => v?.instanceId === lastClickedInstance.instanceId && v?.origin);
        if (origin) {
          const plant = PlantDB.get(origin.plantId);
          showPlantInfo(plant, origin.rotation || 0, lastClickedInstance.instanceId, lastClickedInstance.bedId);
        }
      }
    }
    
    renderCanvas();
    renderBedJournal();
    const msg = targets.length > 1
      ? `Seed packet applied to ${updateCount} selected instance${updateCount !== 1 ? 's' : ''}`
      : (seedId ? 'Seed packet linked' : 'Using generic planting');
    Toast.show(msg);
  }

  function setPlantingMode(value) {
    if (!lastClickedInstance && !selectedPlantId) return;
    const plantId = lastClickedInstance
      ? (() => {
          const bed = Store.getBeds().find(b => b.id === lastClickedInstance.bedId);
          const origin = bed ? Object.values(bed.cells).find(v => v?.instanceId === lastClickedInstance.instanceId && v?.origin) : null;
          return origin?.plantId || selectedPlantId;
        })()
      : selectedPlantId;
    if (!plantId) return;
    const plant = PlantDB.get(plantId);
    if (!plant || plant._isPath) return;
    const mode = value || null;
    if (plant._custom) {
      Store.upsertCustomPlant({ ...plant, plantingMode: mode });
    } else {
      Store.upsertBuiltinPlantOverride(plantId, { plantingMode: mode });
    }
    // Re-render info panel with updated plant data
    const updated = PlantDB.get(plantId);
    if (updated) {
      const instanceId = lastClickedInstance?.instanceId || null;
      const bedId      = lastClickedInstance?.bedId      || null;
      showPlantInfo(updated, selectedRotation, instanceId, bedId);
    }
  }

  function linkTransplantSource() {
    if (!lastClickedInstance) return;
    const sel = document.getElementById('ts-source-select');
    if (!sel || !sel.value) { Toast.show('Select a tray seedling first'); return; }

    // Value format: `trayBedId::groupSeedId` (groupSeedId is '' for generic)
    const sepIdx = sel.value.indexOf('::');
    if (sepIdx === -1) return;
    const trayBedId      = sel.value.slice(0, sepIdx);
    const groupSeedId    = sel.value.slice(sepIdx + 2); // '' means generic

    const beds = Store.getBeds();
    const normalBed = beds.find(b => b.id === lastClickedInstance.bedId);
    const trayBed   = beds.find(b => b.id === trayBedId);
    if (!normalBed || !trayBed) return;

    // Find the first tray instance matching the selected group (tray + seedId)
    let normalPlantId = null;
    Object.entries(normalBed.cells).forEach(([, v]) => {
      if (typeof v === 'object' && v?.instanceId === lastClickedInstance.instanceId && v?.origin) {
        normalPlantId = v.plantId;
      }
    });
    if (!normalPlantId) return;

    let trayInstId = null;
    Object.entries(trayBed.cells).forEach(([, v]) => {
      if (trayInstId) return;
      const cell = typeof v === 'object' ? v : null;
      if (!cell?.origin || cell.plantId !== normalPlantId) return;
      if (!['ready_to_transplant', 'hardened'].includes(cell.lifecycle)) return;
      if ((cell.seedId || '') !== groupSeedId) return;
      trayInstId = cell.instanceId;
    });
    if (!trayInstId) { Toast.show('No matching tray seedling found'); return; }

    // Update normal-bed origin cell: store source refs, advance lifecycle to transplanted
    let normalSeedId  = null;
    let normalContext = { bedContextId: normalBed.id, bedContextName: normalBed.name };
    Object.entries(normalBed.cells).forEach(([k, v]) => {
      if (typeof v === 'object' && v?.instanceId === lastClickedInstance.instanceId && v?.origin) {
        normalSeedId  = v.seedId || null;
        normalContext = contextFromOriginCell(normalBed, normalizeCellValue(v, k), k);
        normalBed.cells[k] = {
          ...v,
          transplantSourceBedId:      trayBedId,
          transplantSourceInstanceId: trayInstId,
          lifecycle: 'transplanted',
        };
      }
    });

    // Remove all tray cells belonging to this instance (plant transplanted out)
    let trayPrevState = 'planned';
    let trayPlantId   = null;
    let traySeedId    = null;
    let trayContext   = { bedContextId: trayBed.id, bedContextName: trayBed.name };
    Object.entries(trayBed.cells).forEach(([k, v]) => {
      if (typeof v === 'object' && v?.instanceId === trayInstId) {
        if (v?.origin) {
          trayPrevState = v.lifecycle || 'planned';
          trayPlantId   = v.plantId;
          traySeedId    = v.seedId || null;
          trayContext   = contextFromOriginCell(trayBed, normalizeCellValue(v, k), k);
        }
        delete trayBed.cells[k];
      }
    });

    Store.updateBed(normalBed);
    Store.updateBed(trayBed);

    const season = activeSeasonYear();
    Store.addLifecycleEvent({
      seasonYear: season,
      bedId: lastClickedInstance.bedId,
      bedName: normalBed.name,
      bedContextId: normalContext.bedContextId,
      bedContextName: normalContext.bedContextName,
      instanceId: lastClickedInstance.instanceId,
      plantId: normalPlantId,
      seedId:  normalSeedId,
      fromState: 'planned',
      toState: 'transplanted',
      action: 'transplant-link',
      note: `Linked from tray: ${trayBed.name}`,
      qty: 1,
    });
    if (trayPlantId && trayPrevState !== 'transplanted') {
      Store.addLifecycleEvent({
        seasonYear: season,
        bedId: trayBedId,
        bedName: trayBed.name,
        bedContextId: trayContext.bedContextId,
        bedContextName: trayContext.bedContextName,
        instanceId: trayInstId,
        plantId: trayPlantId,
        seedId:  traySeedId,
        fromState: trayPrevState,
        toState: 'transplanted',
        action: 'transplant-link',
        note: `Transplanted to bed: ${normalBed.name}`,
        qty: 1,
      });
    }

    renderCanvas();
    renderBedJournal();
    const plant = PlantDB.get(normalPlantId);
    if (plant) showPlantInfo(plant, 0, lastClickedInstance.instanceId, lastClickedInstance.bedId);
    Toast.show('Linked — seedling removed from tray and marked transplanted');
  }

  function unlinkTransplantSource() {
    if (!lastClickedInstance) return;
    const beds = Store.getBeds();
    const normalBed = beds.find(b => b.id === lastClickedInstance.bedId);
    if (!normalBed) return;

    let plantId = null;
    Object.entries(normalBed.cells).forEach(([, v]) => {
      if (typeof v === 'object' && v?.instanceId === lastClickedInstance.instanceId && v?.origin) {
        plantId = v.plantId;
        delete v.transplantSourceBedId;
        delete v.transplantSourceInstanceId;
      }
    });
    if (!plantId) return;

    Store.updateBed(normalBed);
    renderCanvas();
    const plant = PlantDB.get(plantId);
    if (plant) showPlantInfo(plant, 0, lastClickedInstance.instanceId, lastClickedInstance.bedId);
    Toast.show('Tray link removed');
  }

  function setLifecycle(state) {
    const targets = getLifecycleTargets();
    if (!targets.length) return;
    const beds = Store.getBeds();
    // Guard: skip states that are invalid for the target bed type
    const firstBed = beds.find(b => b.id === targets[0]?.bedId);
    if (firstBed && !lcStatesForBed(firstBed).includes(state)) return;
    const touched = new Set();
    let changed = 0;

    targets.forEach(({ bedId, instanceId }) => {
      const bed = beds.find(b => b.id === bedId);
      if (!bed) return;
      let prevState = 'planned';
      let plantId = null;
      let seedId = null;
      let qty = 1;
      let context = { bedContextId: bed.id, bedContextName: bed.name };

      Object.entries(bed.cells).forEach(([k, v]) => {
        if (typeof v === 'object' && v?.instanceId === instanceId && v?.origin) {
          if (v?.plantId === '__path__') return;
          prevState = v.lifecycle || 'planned';
          plantId = v.plantId;
          seedId = v.seedId || null;
          qty = v.rowBlockTotal > 1 ? v.rowBlockTotal : 1;
          context = contextFromOriginCell(bed, normalizeCellValue(v, k), k);
          bed.cells[k] = { ...v, lifecycle: state };
        }
      });

      if (!plantId) return;
      touched.add(bed.id);
      if (prevState !== state) {
        Store.addLifecycleEvent({
          seasonYear: activeSeasonYear(),
          bedId,
          bedName: bed.name,
          bedContextId: context.bedContextId,
          bedContextName: context.bedContextName,
          instanceId,
          plantId,
          seedId,
          fromState: prevState,
          toState: state,
          action: 'status-change',
          note: '',
          qty,
        });
        changed += 1;
      }
    });

    touched.forEach(id => {
      const bed = beds.find(b => b.id === id);
      if (bed) Store.updateBed(bed);
    });

    renderCanvas();
    renderBedJournal();
    // Re-render info panel with updated state
    if (lastClickedInstance) {
      const bed = beds.find(b => b.id === lastClickedInstance.bedId);
      const origin = bed ? Object.values(bed.cells).find(v => v?.instanceId === lastClickedInstance.instanceId && v?.origin) : null;
      if (origin) {
        const plant = PlantDB.get(origin.plantId);
        if (plant) showPlantInfo(plant, origin.rotation || 0, lastClickedInstance.instanceId, lastClickedInstance.bedId);
      }
    }
    if (targets.length > 1) Toast.show(`Status set to ${LC_META[state]?.label || state} for ${targets.length} selections${changed !== targets.length ? ` (${changed} changed)` : ''}`);
    else Toast.show(`Status: ${LC_META[state]?.label || state}`);
  }

  function journalContextId(event) {
    return event?.bedContextId || event?.bedId || '';
  }

  function journalContextName(event, contexts) {
    const id = journalContextId(event);
    if (id && contexts.has(id)) return contexts.get(id).name;
    return event?.bedContextName || event?.bedName || 'Bed';
  }

  function buildJournalContexts(allBeds, allEvents) {
    const contexts = new Map();
    allBeds.forEach(bed => {
      contexts.set(bed.id, { id: bed.id, name: bed.name });
      plotLayoutForBed(bed).forEach(zone => {
        const id = bedContextIdForZone(bed.id, zone);
        contexts.set(id, { id, name: bedContextNameForZone(bed, zone) });
      });
    });
    allEvents.forEach(event => {
      const id = journalContextId(event);
      if (!id) return;
      if (!contexts.has(id)) {
        contexts.set(id, {
          id,
          name: event.bedContextName || event.bedName || id,
        });
      }
    });
    return contexts;
  }

  function journalContextFilterSet(filterId, contexts, allBeds) {
    if (!filterId || filterId === 'all') return null;
    if (!contexts.has(filterId)) return new Set([filterId]);
    if (filterId.includes('::')) return new Set([filterId]);
    const bed = allBeds.find(b => b.id === filterId);
    const hasZones = !!(bed && plotLayoutForBed(bed).length);
    if (!hasZones) return new Set([filterId]);
    const prefix = `${filterId}::`;
    const set = new Set();
    Array.from(contexts.keys()).forEach(id => {
      if (id.startsWith(prefix)) set.add(id);
    });
    if (!set.size) set.add(filterId);
    return set;
  }

  function renderBedJournal() {
    const el = document.getElementById('bed-journal-list');
    const seasonSel = document.getElementById('bed-journal-season');
    const bedFilterSel = document.getElementById('bed-journal-filter');
    const rangeSel = document.getElementById('bed-journal-range');
    if (!el) return;

    const allBeds = Store.getBeds();
    const allEvents = Store.getLifecycleJournal().filter(e => e?.plantId !== '__path__');
    const contexts = buildJournalContexts(allBeds, allEvents);
    const contextList = Array.from(contexts.values()).sort((a, b) => a.name.localeCompare(b.name));
    const filterSet = journalContextFilterSet(selectedBedFilter, contexts, allBeds);

    // Populate bed filter dropdown
    if (bedFilterSel) {
      const bedOptions = contextList.map(ctx => `<option value="${ctx.id}" ${selectedBedFilter === ctx.id ? 'selected' : ''}>${escHtml(ctx.name)}</option>`).join('');
      const allOption = `<option value="all" ${selectedBedFilter === 'all' ? 'selected' : ''}>All Beds</option>`;
      bedFilterSel.innerHTML = allOption + bedOptions;
    }

    // Determine which contexts to show
    let filteredContexts = [];
    if (selectedBedFilter === 'all') {
      filteredContexts = contextList;
    } else if (selectedBedFilter) {
      if (filterSet) filteredContexts = contextList.filter(ctx => filterSet.has(ctx.id));
    } else if (activeBedId) {
      const ctx = contexts.get(activeBedId);
      if (ctx) {
        filteredContexts = [ctx];
        selectedBedFilter = activeBedId;
        if (bedFilterSel) bedFilterSel.value = activeBedId;
      }
    }

    // If no contexts selected, show empty state
    if (!filteredContexts.length) {
      el.innerHTML = '<div class="journal-empty">No beds available. Create a bed from the Beds page to start.</div>';
      if (seasonSel) seasonSel.innerHTML = '';
      return;
    }

    // Get events for filtered contexts
    const filteredContextIds = new Set(filteredContexts.map(ctx => ctx.id));
    const eventsForBeds = allEvents.filter(e => filteredContextIds.has(journalContextId(e)));
    const years = [...new Set(eventsForBeds.map(e => e.seasonYear).filter(Boolean))].sort((a, b) => b - a);
    const defaultYear = activeSeasonYear();
    if (!selectedJournalSeason) selectedJournalSeason = defaultYear;
    if (!years.includes(defaultYear)) years.unshift(defaultYear);

    // Populate season dropdown
    if (seasonSel) {
      seasonSel.innerHTML = years.map(y => `<option value="${y}" ${y===selectedJournalSeason?'selected':''}>${y}</option>`).join('');
    }
    if (rangeSel) {
      rangeSel.value = selectedJournalRange;
    }

    const seasonYear = selectedJournalSeason;
    
    // Get items for filtered contexts and year
    const seasonItems = allEvents
      .filter(e => filteredContextIds.has(journalContextId(e)) && e.seasonYear === seasonYear)
      .sort((a, b) => {
        const aDate = getJournalEventDateValue(a);
        const bDate = getJournalEventDateValue(b);
        if (aDate !== bDate) return aDate < bDate ? 1 : -1;
        return a.ts < b.ts ? 1 : -1;
      });
    const items = filterJournalItemsByRange(seasonItems, seasonYear);
    
    // Apply search filter if specified
    let searchedItems = items;
    if (selectedJournalSearch) {
      const needle = selectedJournalSearch.toLowerCase();
      searchedItems = items.filter(e => {
        const plant = PlantDB.get(e.plantId);
        const seed = e.seedId ? Store.getInventory().find(s => s.id === e.seedId) : null;
        const to = LC_META[e.toState]?.label || e.toState || 'Updated';
        const from = e.fromState ? (LC_META[e.fromState]?.label || e.fromState) : null;
        const bedName = journalContextName(e, contexts);
        const searchable = [
          plant?.name || '',
          e.note || '',
          to,
          from || '',
          seed ? seedLabel(seed) : '',
          bedName
        ].join(' ').toLowerCase();
        return searchable.includes(needle);
      });
    }

    if (!searchedItems.length) {
      const selectedLabel = selectedBedFilter === 'all'
        ? 'All beds'
        : escHtml(contexts.get(selectedBedFilter)?.name || filteredContexts[0]?.name || 'Bed');
      const bedsText = selectedLabel;
      const rangeLabel = selectedJournalRange === 'day' ? 'the last day'
        : selectedJournalRange === 'week' ? 'the last 7 days'
        : selectedJournalRange === 'month' ? 'the last month'
        : `${seasonYear}`;
      const msgEnd = selectedJournalSearch ? `matching "${selectedJournalSearch}".` : 'for ' + rangeLabel + '.';
      el.innerHTML = `<div class="journal-empty"><strong>${bedsText}</strong><br>No growth events ${msgEnd}<br>Update plant statuses to start your log.</div>`;
      return;
    }

    // Show bed header only if viewing single bed
    const isMultiBed = selectedBedFilter === 'all';
    const head = isMultiBed 
      ? `<div style="font-size:.82rem;font-weight:800;margin:2px 0 10px">All Beds · ${seasonYear}</div>`
      : `<div style="font-size:.82rem;font-weight:800;margin:2px 0 10px">${escHtml(contexts.get(selectedBedFilter)?.name || filteredContexts[0]?.name || 'Bed')} · ${seasonYear}</div>`;

    el.innerHTML = head + searchedItems.map(e => {
      const plant = PlantDB.get(e.plantId);
      const seed = e.seedId ? Store.getInventory().find(s => s.id === e.seedId) : null;
      const to = LC_META[e.toState]?.label || e.toState || 'Updated';
      const from = e.fromState ? (LC_META[e.fromState]?.label || e.fromState) : null;
      const qty = Math.max(1, parseInt(e.qty, 10) || 1);
      const time = formatJournalEventDate(e);
      const seedTxt = seed ? ` · ${seedLabel(seed)}` : '';
      const qtyTxt = qty > 1
        ? (e.action === 'status-change' ? ` · ${qty} plants changed` : ` · ${qty} plants`)
        : '';
      const stateTxt = from ? `${from} → ${to}` : to;
      const plantName = plant?.name || e.plantId;
      const lcIcon = LC_META[e.toState]?.icon || '📋';
      const media = renderJournalMedia(e, lcIcon, plant?.emoji || '🌱', `${plantName} journal photo`);
      const bedName = isMultiBed ? ` · ${escHtml(journalContextName(e, contexts))}` : '';
      const note = (e.note || '').trim();
      return `<button class="journal-item journal-item-btn" onclick="Beds.openJournalEvent('${e.id}')">
        <div class="journal-item-row">
          <div class="journal-media">${media}</div>
          <div class="journal-item-copy">
            <div class="journal-item-time">${time}</div>
            <div class="journal-item-main">${plant?.emoji || '🌱'} ${escHtml(plantName)} · ${escHtml(stateTxt)}${escHtml(qtyTxt)}${escHtml(seedTxt)}${escHtml(bedName)}</div>
            ${note ? `<div class="journal-item-note" style="font-size:.72rem;color:var(--text-muted);margin-top:3px">💬 ${escHtml(note)}</div>` : ''}
          </div>
        </div>
      </button>`;
    }).join('');
  }

  function setJournalSeason(yearVal) {
    const year = parseInt(yearVal, 10);
    if (!year || Number.isNaN(year)) return;
    selectedJournalSeason = year;
    renderBedJournal();
  }

  function setJournalRange(rangeVal) {
    if (!['day', 'week', 'month', 'season'].includes(rangeVal)) return;
    selectedJournalRange = rangeVal;
    renderBedJournal();
  }

  function setJournalBedFilter(bedIdOrAll) {
    const contexts = buildJournalContexts(Store.getBeds(), Store.getLifecycleJournal());
    if (bedIdOrAll === 'all' || contexts.has(bedIdOrAll)) {
      selectedBedFilter = bedIdOrAll;
      renderBedJournal();
    }
  }

  function setJournalSearch(text) {
    selectedJournalSearch = (text || '').toLowerCase();
    renderBedJournal();
  }

  function setLibrarySeededOnly(checked) {
    selectedBedLibrarySeeded = !!checked;
    renderLibrary();
  }

  function openJournalEvent(eventId) {
    const event = Store.getLifecycleJournal().find(e => e.id === eventId);
    if (!event) return;
    selectedJournalEventId = event.id;
    if (event.bedId && event.bedId !== activeBedId) {
      selectBed(event.bedId);
    }
    const bed = Store.getBeds().find(b => b.id === (event.bedId || activeBedId));
    if (bed) {
      const originEntry = Object.entries(bed.cells).find(([k, v]) => {
        const cell = normalizeCellValue(v, k);
        return cell?.origin && cell.instanceId === event.instanceId;
      });

      if (originEntry) {
        const [k, v] = originEntry;
        const [r, c] = k.split(',').map(Number);
        const cell = normalizeCellValue(v, k);
        const plant = PlantDB.get(cell.plantId);
        if (plant) {
          lastClickedInstance = { bedId: bed.id, instanceId: cell.instanceId };
          lastClickedCell = { bedId: bed.id, r, c };
          selectedLifecycleInstances = [{ bedId: bed.id, instanceId: cell.instanceId }];
          showPlantInfo(plant, cell.rotation || 0, cell.instanceId, bed.id);
          const cellEl = document.querySelector(`[data-bed="${bed.id}"][data-r="${r}"][data-c="${c}"]`);
          if (cellEl) cellEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        }
      } else {
        Toast.show('Plant instance not currently in this bed');
      }
    }

    openJournalEventModal(event);
  }

  function handleJournalImageLoad(img) {
    img.style.display = 'block';
  }

  function handleCellImageLoad(img) {
    img.style.display = 'block';
  }

  function handleCellImageError(img) {
    const sources = (img.dataset.srcList || '').split('|').filter(Boolean);
    const currentIndex = parseInt(img.dataset.srcIndex || '0', 10);

    if (currentIndex + 1 < sources.length) {
      img.dataset.srcIndex = String(currentIndex + 1);
      img.src = sources[currentIndex + 1];
      return;
    }

    img.style.display = 'none';
    const media = img.closest('.gcell-media');
    if (media) media.style.display = 'none';
  }

  function handleJournalImageError(img) {
    const sources = (img.dataset.srcList || '').split('|').filter(Boolean);
    const currentIndex = parseInt(img.dataset.srcIndex || '0', 10);

    if (currentIndex + 1 < sources.length) {
      img.dataset.srcIndex = String(currentIndex + 1);
      img.src = sources[currentIndex + 1];
      return;
    }

    const siblingFallback = img.nextElementSibling;
    if (siblingFallback) {
      img.style.display = 'none';
      siblingFallback.style.display = 'flex';
      return;
    }

    const fallback = document.createElement('div');
    fallback.className = 'journal-media-fallback';
    fallback.textContent = '🌱';
    img.replaceWith(fallback);
  }

  function handlePlantSeedImageLoad(img) {
    img.style.display = 'block';
    const fallback = img.nextElementSibling;
    if (fallback) fallback.style.display = 'none';
  }

  function handlePlantSeedImageError(img) {
    const sources = (img.dataset.srcList || '').split('|').filter(Boolean);
    const currentIndex = parseInt(img.dataset.srcIndex || '0', 10);

    if (currentIndex + 1 < sources.length) {
      img.dataset.srcIndex = String(currentIndex + 1);
      img.src = sources[currentIndex + 1];
      return;
    }

    // All sources exhausted, show fallback emoji
    img.style.display = 'none';
    const fallback = img.nextElementSibling;
    if (fallback) fallback.style.display = 'flex';
  }

  function openJournalImage(evt, imgEl) {
    evt.stopPropagation();
    if (!imgEl || imgEl.style.display === 'none') return;
    window.GPImageLightbox?.open(imgEl.src, imgEl.alt || 'Journal image');
  }

  function revokePickedJournalPreview() {
    if (!pickedJournalPreviewUrl) return;
    URL.revokeObjectURL(pickedJournalPreviewUrl);
    pickedJournalPreviewUrl = '';
  }

  function renderJournalModalPreview(event) {
    const sources = journalImageSources(event);
    if (!sources.length) {
      return '<div class="seed-image-preview-empty">No journal photo attached yet.</div>';
    }
    return `<div class="seed-image-preview-frame">
      <img class="seed-image-preview-img" src="${escAttr(sources[0])}" alt="Journal photo preview" data-src-list="${escAttr(sources.join('|'))}" data-src-index="0" onload="Beds.handleJournalImageLoad(this)" onerror="Beds.handleJournalImageError(this)">
      <div class="seed-image-preview-empty" style="display:none">No journal photo attached yet.</div>
    </div>`;
  }

  function setJournalPreviewContent(html) {
    const el = document.getElementById('je-image-preview');
    if (el) el.innerHTML = html;
  }

  function syncJournalImageHint() {
    const hint = document.getElementById('je-image-path-hint');
    const filename = document.getElementById('je-photo-filename')?.value.trim() || '';
    if (!hint) return;
    if (filename) {
      hint.textContent = `Will load: ${JOURNAL_IMAGE_DIR}/${filename} (fallback: ${SEED_IMAGE_DIR}/${filename})`;
      return;
    }
    hint.textContent = 'No photo attached. Pick a file and use its filename.';
  }

  function openJournalEventModal(event) {
    const plant = PlantDB.get(event.plantId);
    const seed = event.seedId ? Store.getInventory().find(s => s.id === event.seedId) : null;
    const to = LC_META[event.toState]?.label || event.toState || 'Updated';
    const from = event.fromState ? (LC_META[event.fromState]?.label || event.fromState) : null;
    const stateTxt = from ? `${from} → ${to}` : to;
    const qty = Math.max(1, parseInt(event.qty, 10) || 1);
    const qtyTxt = qty > 1
      ? (event.action === 'status-change' ? ` · ${qty} plants changed status` : ` · ${qty} plants`)
      : '';
    const eventDate = getJournalEventDateValue(event);

    pickedJournalImageName = '';
    revokePickedJournalPreview();

    const body = document.getElementById('journal-event-body');
    if (!body) return;
    body.innerHTML = `
      <div class="form-row" style="font-size:.78rem;color:var(--text-muted)">
        <strong>${plant?.emoji || '🌱'} ${escHtml(plant?.name || event.plantId)}</strong><br>
        ${escHtml(formatJournalEventDate(event))} · ${escHtml(stateTxt)}${escHtml(qtyTxt)}${(event.bedContextName || event.bedName) ? ` · ${escHtml(event.bedContextName || event.bedName)}` : ''}${seed ? ` · ${escHtml(seedLabel(seed))}` : ''}
      </div>
      <div class="form-row">
        <label>Event date</label>
        <input id="je-event-date" type="date" value="${escAttr(eventDate)}">
        <div class="form-hint">Use the actual day this happened. You can log it later and still keep the correct date.</div>
      </div>
      <div class="form-row">
        <label>Comment / observation</label>
        <textarea id="je-note" placeholder="e.g. Wilting after heatwave, added shade cloth">${escHtml(event.note || '')}</textarea>
      </div>
      <div class="form-row">
        <label>Photo filename</label>
        <input id="je-photo-filename" type="text" placeholder="e.g. ${event.id}.jpg" value="${escAttr(event.photoFilename || '')}" oninput="Beds.syncJournalImageHint()">
        <div class="form-hint">Stored as metadata only. Prefer <strong>${JOURNAL_IMAGE_DIR}</strong>; <strong>${SEED_IMAGE_DIR}</strong> is also checked automatically.</div>
        <div class="form-hint" id="je-image-path-hint"></div>
      </div>
      <div class="form-row">
        <label>Preview local image (optional)</label>
        <input id="je-image-picker" type="file" accept="image/*" onchange="Beds.previewJournalImageFile(event)">
        <div class="seed-image-picker-row">
          <button type="button" class="btn btn-secondary btn-sm" onclick="Beds.usePickedJournalFilename()">Use picked filename</button>
          <span id="je-image-picked-name" class="form-hint">No local file picked.</span>
        </div>
        <div id="je-image-preview" class="seed-image-preview">${renderJournalModalPreview(event)}</div>
      </div>`;

    const saveBtn = document.getElementById('journal-event-save');
    const delBtn = document.getElementById('journal-event-delete');
    if (saveBtn) saveBtn.onclick = () => saveJournalEventChanges();
    if (delBtn) delBtn.onclick = () => deleteJournalEvent();

    syncJournalImageHint();
    Modal.open('journal-event-modal');
  }

  function closeJournalEventModal() {
    revokePickedJournalPreview();
    Modal.close('journal-event-modal');
  }

  function previewJournalImageFile(event) {
    const file = event.target.files?.[0];
    const nameEl = document.getElementById('je-image-picked-name');
    revokePickedJournalPreview();

    if (!file) {
      pickedJournalImageName = '';
      if (nameEl) nameEl.textContent = 'No local file picked.';
      const current = Store.getLifecycleJournal().find(e => e.id === selectedJournalEventId);
      setJournalPreviewContent(renderJournalModalPreview(current || {}));
      return;
    }

    pickedJournalImageName = file.name;
    pickedJournalPreviewUrl = URL.createObjectURL(file);
    if (nameEl) nameEl.textContent = file.name;
    const filenameInput = document.getElementById('je-photo-filename');
    if (filenameInput) {
      filenameInput.value = file.name;
      syncJournalImageHint();
    }
    setJournalPreviewContent(`<div class="seed-image-preview-frame"><img class="seed-image-preview-img" src="${pickedJournalPreviewUrl}" alt="Local journal image preview"></div>`);
  }

  function usePickedJournalFilename() {
    if (!pickedJournalImageName) {
      Toast.show('Pick a local image first');
      return;
    }
    const input = document.getElementById('je-photo-filename');
    if (!input) return;
    input.value = pickedJournalImageName;
    syncJournalImageHint();
    Toast.show(`Photo filename set to ${pickedJournalImageName}`);
  }

  function saveJournalEventChanges() {
    if (!selectedJournalEventId) return;
    const list = Store.getLifecycleJournal();
    const row = list.find(e => e.id === selectedJournalEventId);
    if (!row) return;
    const inputVal = (document.getElementById('je-photo-filename')?.value || '').trim();
    const noteVal = (document.getElementById('je-note')?.value || '').trim();
    const eventDateVal = (document.getElementById('je-event-date')?.value || '').trim();
    row.photoFilename = inputVal || pickedJournalImageName || '';
    row.note = noteVal;
    row.eventDate = /^\d{4}-\d{2}-\d{2}$/.test(eventDateVal) ? eventDateVal : getJournalEventDateValue(row);
    if (row.eventDate) {
      const year = parseInt(row.eventDate.slice(0, 4), 10);
      if (!Number.isNaN(year)) row.seasonYear = year;
    }
    if (row.seasonYear && selectedJournalSeason !== row.seasonYear) {
      selectedJournalSeason = row.seasonYear;
    }
    Store.saveLifecycleJournal(list);
    revokePickedJournalPreview();
    Modal.close('journal-event-modal');
    renderBedJournal();
    Toast.show('Journal event updated');
  }

  function deleteJournalEvent() {
    if (!selectedJournalEventId) return;
    const list = Store.getLifecycleJournal();
    const row = list.find(e => e.id === selectedJournalEventId);
    if (!row) return;
    const plant = PlantDB.get(row.plantId);
    if (!confirm(`Delete journal event for "${plant?.name || row.plantId}"?`)) return;
    const next = list.filter(e => e.id !== selectedJournalEventId);
    Store.saveLifecycleJournal(next);
    revokePickedJournalPreview();
    Modal.close('journal-event-modal');
    renderBedJournal();
    Toast.show('Journal event deleted');
  }

  function setJournalPhotoFilename(eventId, filename) {
    const list = Store.getLifecycleJournal();
    const row = list.find(e => e.id === eventId);
    if (!row) return;
    row.photoFilename = (filename || '').trim();
    Store.saveLifecycleJournal(list);
    renderBedJournal();
  }

  function updateStats() {
    const beds  = Store.getBeds();
    let total = 0;
    const vars  = new Set();
    let occupied = 0;
    beds.forEach(bed => {
      occupied += Object.keys(bed.cells).length;
      Object.entries(bed.cells).forEach(([k, v]) => {
        const cell = normalizeCellValue(v, k);
        if (cell?.origin && cell.plantId !== '__path__') {
          total += (cell.rowBlockTotal > 1 ? cell.rowBlockTotal : 1);
          vars.add(cell.plantId);
        }
      });
    });
    const area  = beds.reduce((a, b) => a + (b.widthM * b.heightM), 0);
    const free  = beds.reduce((a, b) => a + (b.cols * b.rows), 0) - occupied;

    setText('stat-plants',  total);
    setText('stat-vars',    vars.size);
    setText('stat-area',    area.toFixed(2) + ' m²');
    setText('stat-free',    free);
  }

  function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── bed CRUD ──────────────────────────────────────────────────
  function onBedTypeChange(type) {
    const isTray = type === 'tray';
    const isPlot = type === 'plot';
    document.getElementById('bm-meters-row').style.display  = isTray ? 'none' : '';
    document.getElementById('bm-tray-row').style.display    = isTray ? ''     : 'none';
    document.getElementById('bm-hint-meters').style.display = isTray ? 'none' : '';
    document.getElementById('bm-hint-tray').style.display   = isTray ? ''     : 'none';
    document.getElementById('bm-hint-plot').style.display   = isPlot ? ''     : 'none';
  }

  function openNewBedModal() {
    document.getElementById('bm-id').value        = '';
    document.getElementById('bm-name').value      = '';
    document.getElementById('bm-width').value     = '1.2';
    document.getElementById('bm-height').value    = '2.4';
    document.getElementById('bm-tray-cols').value = '12';
    document.getElementById('bm-tray-rows').value = '8';
    document.getElementById('bm-bed-type').value  = 'bed';
    onBedTypeChange('bed');
    document.getElementById('bm-title').textContent = '🌿 New Bed';
    Modal.open('bed-modal');
    document.getElementById('bed-modal-save').onclick = () => saveBedModal();
  }

  function editBedSize(id) {
    const bed  = Store.getBeds().find(b => b.id === id);
    if (!bed) return;
    const type = bed.type || 'bed';
    document.getElementById('bm-id').value        = bed.id;
    document.getElementById('bm-name').value      = bed.name;
    document.getElementById('bm-width').value     = bed.widthM;
    document.getElementById('bm-height').value    = bed.heightM;
    document.getElementById('bm-tray-cols').value = bed.cols;
    document.getElementById('bm-tray-rows').value = bed.rows;
    document.getElementById('bm-bed-type').value  = type;
    onBedTypeChange(type);
    document.getElementById('bm-title').textContent =
      type === 'tray' ? '⇔ Resize Seed Tray' :
      type === 'plot' ? '⇔ Resize Plot' :
                        '⇔ Resize Bed';
    Modal.open('bed-modal');
    document.getElementById('bed-modal-save').onclick = () => saveBedModal();
  }

  function saveBedModal() {
    const existId = document.getElementById('bm-id').value;
    const name    = document.getElementById('bm-name').value.trim() || 'My Bed';
    const bedType = document.getElementById('bm-bed-type').value; // 'bed' | 'plot' | 'tray'
    const isTray  = bedType === 'tray';

    if (isTray) {
      const cols = Math.min(MAX_CELLS, Math.max(1, parseInt(document.getElementById('bm-tray-cols').value, 10) || 12));
      const rows = Math.min(MAX_CELLS, Math.max(1, parseInt(document.getElementById('bm-tray-rows').value, 10) || 8));
      if (existId) {
        const beds = Store.getBeds();
        const bed  = beds.find(b => b.id === existId);
        if (!bed) return;
        Object.keys(bed.cells).forEach(k => {
          const [r, c] = k.split(',').map(Number);
          if (r >= rows || c >= cols) delete bed.cells[k];
        });
        bed.name = name;
        bed.type = 'tray';
        delete bed.isSeedTray;
        bed.cols = cols; bed.rows = rows;
        bed.widthM  = +(cols * CELL_M).toFixed(2);
        bed.heightM = +(rows * CELL_M).toFixed(2);
        Store.updateBed(bed);
        Toast.show('Seed tray updated');
      } else {
        const bed = Store.newSeedTrayBed(name, cols, rows);
        Store.updateBed(bed);
        activeBedId = bed.id;
        Toast.show('New seed tray created');
      }
    } else {
      const widthM  = Math.max(CELL_M, Math.min(15, parseFloat(document.getElementById('bm-width').value)  || 1.2));
      const heightM = Math.max(CELL_M, Math.min(15, parseFloat(document.getElementById('bm-height').value) || 2.4));
      if (existId) {
        const beds = Store.getBeds();
        const bed  = beds.find(b => b.id === existId);
        if (!bed) return;
        const newCols = Math.min(MAX_CELLS, Math.max(1, Math.round(widthM  / CELL_M)));
        const newRows = Math.min(MAX_CELLS, Math.max(1, Math.round(heightM / CELL_M)));
        Object.keys(bed.cells).forEach(k => {
          const [r, c] = k.split(',').map(Number);
          if (r >= newRows || c >= newCols) delete bed.cells[k];
        });
        const aliveOrigins = new Set();
        Object.entries(bed.cells).forEach(([k, v]) => {
          const cell = normalizeCellValue(v, k);
          if (cell?.origin) aliveOrigins.add(cell.instanceId);
        });
        Object.entries(bed.cells).forEach(([k, v]) => {
          const cell = normalizeCellValue(v, k);
          if (cell && !aliveOrigins.has(cell.instanceId)) delete bed.cells[k];
        });
        bed.name = name; bed.widthM = widthM; bed.heightM = heightM;
        bed.cols = newCols; bed.rows = newRows;
        bed.type = bedType;
        delete bed.isSeedTray;
        Store.updateBed(bed);
        Toast.show(bedType === 'plot' ? 'Plot updated' : 'Bed updated');
      } else {
        const bed = bedType === 'plot'
          ? Store.newPlotBed(name, widthM, heightM)
          : Store.newBed(name, widthM, heightM);
        Store.updateBed(bed);
        activeBedId = bed.id;
        Toast.show(bedType === 'plot' ? 'New plot created' : 'New bed created');
      }
    }
    Modal.close('bed-modal');
    renderBedList();
    renderCanvas({ scrollToActive: !existId });
    updateStats();
  }

  function renameBed(id, name) {
    const beds = Store.getBeds();
    const bed  = beds.find(b => b.id === id);
    if (!bed) return;
    bed.name = name || 'My Bed';
    Store.updateBed(bed);
    renderBedList();
  }

  function promptRenameBed(id) {
    const bed = Store.getBeds().find(b => b.id === id);
    if (!bed) return;
    const next = prompt('Rename bed', bed.name);
    if (next === null) return;
    renameBed(id, next.trim() || bed.name);
    Toast.show('Bed renamed');
  }

  function deleteBed(id) {
    const bed = Store.getBeds().find(b => b.id === id);
    if (!confirm(`Delete bed "${bed?.name}"? All plants in it will be lost.`)) return;

    const beds = Store.getBeds();
    // Remove deleted bed from any parent plot layout.
    beds.forEach(parent => {
      if (!Array.isArray(parent.plotLayout)) return;
      const next = parent.plotLayout.filter(item => item.bedId !== id);
      if (next.length !== parent.plotLayout.length) {
        parent.plotLayout = next;
        Store.updateBed(parent);
      }
    });

    // If deleting a plot bed, detach children metadata.
    if (Array.isArray(bed?.plotLayout) && bed.plotLayout.length) {
      const childIds = new Set(bed.plotLayout.map(item => item.bedId));
      beds.forEach(child => {
        if (!childIds.has(child.id)) return;
        if (child.plotParentId === id) delete child.plotParentId;
        if (child.plotRect) delete child.plotRect;
        Store.updateBed(child);
      });
    }

    Store.deleteBed(id);
    if (plotAnchor?.bedId === id) plotAnchor = null;
    if (activeBedId === id) activeBedId = Store.getBeds()[0]?.id ?? null;
    renderBedList();
    renderCanvas();
    updateStats();
    Toast.show('Bed deleted');
  }

  // ── undo / redo ───────────────────────────────────────────────
  function snapshotBedState(bed) {
    return JSON.stringify({
      cells: bed?.cells || {},
      plotLayout: Array.isArray(bed?.plotLayout) ? bed.plotLayout : [],
    });
  }

  function restoreBedState(bed, snapshot) {
    const parsed = JSON.parse(snapshot);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'cells')) {
      bed.cells = parsed.cells || {};
      bed.plotLayout = Array.isArray(parsed.plotLayout) ? parsed.plotLayout : [];
      return;
    }
    // Backward compatibility for snapshots created before plot layout was tracked.
    bed.cells = parsed || {};
    bed.plotLayout = Array.isArray(bed.plotLayout) ? bed.plotLayout : [];
  }

  function pushUndo(bedId, bed) {
    if (!undoStacks[bedId]) undoStacks[bedId] = [];
    undoStacks[bedId].push(snapshotBedState(bed));
    if (undoStacks[bedId].length > 80) undoStacks[bedId].shift();
    if (!redoStacks[bedId]) redoStacks[bedId] = [];
    redoStacks[bedId] = [];
  }

  function undo() {
    if (!activeBedId) return;
    const stack = undoStacks[activeBedId];
    if (!stack?.length) { Toast.show('Nothing to undo'); return; }
    const beds = Store.getBeds();
    const bed  = beds.find(b => b.id === activeBedId);
    if (!bed) return;
    if (!redoStacks[activeBedId]) redoStacks[activeBedId] = [];
    redoStacks[activeBedId].push(snapshotBedState(bed));
    restoreBedState(bed, stack.pop());
    Store.updateBed(bed);
    renderCanvas();
    updateStats();
    Toast.show('Undone');
  }

  function redo() {
    if (!activeBedId) return;
    const stack = redoStacks[activeBedId];
    if (!stack?.length) { Toast.show('Nothing to redo'); return; }
    const beds = Store.getBeds();
    const bed  = beds.find(b => b.id === activeBedId);
    if (!bed) return;
    if (!undoStacks[activeBedId]) undoStacks[activeBedId] = [];
    undoStacks[activeBedId].push(snapshotBedState(bed));
    restoreBedState(bed, stack.pop());
    Store.updateBed(bed);
    renderCanvas();
    updateStats();
    Toast.show('Redone');
  }

  // ── keyboard shortcuts ────────────────────────────────────────
  document.addEventListener('keydown', e => {
    // only active on bed page
    if (!document.getElementById('page-beds')?.classList.contains('active')) return;
    if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'Escape') { disarm(); return; }
    if (e.key === 'r' || e.key === 'R') { e.preventDefault(); rotateSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); return; }
  });

  document.addEventListener('mouseup', () => {
    onZoneMoveEnd();
    endPaint();
  });

  document.addEventListener('mousemove', event => {
    if (zoneMoveState) { onZoneMoveMouse(event); return; }
    if (!paintState?.rowSelection || !(event.buttons & 1)) return;
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
    updateAutoScrollFromPointer(event.clientX, event.clientY);
    updateRowSelectionFromPointer(event.clientX, event.clientY);
  });

  document.addEventListener('scroll', event => {
    if (!paintState?.rowSelection) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.classList.contains('bed-canvas-area')) return;
    updateRowSelectionFromPointer(lastPointerClientX, lastPointerClientY);
  }, true);

  document.addEventListener('wheel', () => {
    if (!paintState?.rowSelection) return;
    requestAnimationFrame(() => {
      updateAutoScrollFromPointer(lastPointerClientX, lastPointerClientY);
      updateRowSelectionFromPointer(lastPointerClientX, lastPointerClientY);
    });
  }, { passive: true });

  document.addEventListener('mouseleave', () => {
    stopAutoScrollLoop();
  });

  return {
    init, renderLibrary, renderCanvas, renderBedList,
    selectBed, openBedJournal, openJournalAll, armPlant, disarm, rotateSelection,
    cellClick, removePlant, cellEnter, cellLeave,
    cellMouseDown,
    dragStart, dragOver, drop, dragEnd,
    showPlantInfo, updateSelectedPanel, setRowMode,
    openNewBedModal, editBedSize, saveBedModal, renameBed, deleteBed, onBedTypeChange,
    setPlantingMode, linkTransplantSource, unlinkTransplantSource,
    togglePlotDraw, startPlotZoneDraw,
    selectPlotZone, clearPlotZone, deleteZone,
    zoneMouseDown,
    setPathConfig,
    updateSelectedPathMeta,
    promptRenameBed,
    undo, redo, updateStats,
    setLifecycle, setArmedSeed, setInstanceSeed, setJournalSeason, setJournalBedFilter, setJournalSearch, openJournalEvent,
    handleJournalImageLoad, handleJournalImageError, handleCellImageLoad, handleCellImageError, handlePlantSeedImageLoad, handlePlantSeedImageError, openJournalImage, setJournalPhotoFilename,
    previewJournalImageFile, usePickedJournalFilename, syncJournalImageHint,
    saveJournalEventChanges, deleteJournalEvent, closeJournalEventModal,
    renderBedJournal, setJournalRange, renderLibrary, setLibrarySeededOnly,
  };
})();
