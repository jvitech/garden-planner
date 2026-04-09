/* js/store.js — Centralised localStorage state manager
   ================================================================ */
'use strict';

const Store = (() => {
  const KEYS = {
    beds:         'gp2_beds',
    customPlants: 'gp2_custom_plants',
    builtins:     'gp2_builtin_overrides',
    inventory:    'gp2_inventory',
    settings:     'gp2_settings',
    bedHistory:   'gp2_bed_history',
    lifecycleJournal: 'gp2_lifecycle_journal',
  };

  function defaultSettings() {
    return {
      cellPx: 64,
      gardenName: 'My Garden',
      locationName: '',
      growingZone: '',
      lastFrost: '2026-04-15',
      firstFrost: '2026-10-20',
      backupRetention: 10,
      backupIntervalMinutes: 60,
      backupDirectoryLabel: '',
    };
  }

  // ── helpers ──────────────────────────────────────────────────
  function load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
    catch { return fallback; }
  }
  function save(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('gp:data-changed', { detail: { key } }));
    }
  }

  // ── beds ─────────────────────────────────────────────────────
  // Bed shape: { id, name, widthM, heightM, cols, rows,
  //              cells: { "r,c": { plantId, instanceId, origin, rotation, lifecycle? } } }
  function getBeds() { return load(KEYS.beds, []); }
  function saveBeds(beds) { save(KEYS.beds, beds); }

  function newBed(name, widthM, heightM) {
    // Each grid cell = 10 cm × 10 cm = 0.1 m
    const cols = Math.max(1, Math.round(widthM  / 0.1));
    const rows = Math.max(1, Math.round(heightM / 0.1));
    return {
      id:               'bed_' + Date.now(),
      name:             name || 'New Bed',
      type:             'bed',
      widthM:           +widthM,
      heightM:          +heightM,
      cols, rows,
      cells:            {},
      successionCells:  {},
    };
  }

  function newPlotBed(name, widthM, heightM) {
    const cols = Math.max(1, Math.round(widthM  / 0.1));
    const rows = Math.max(1, Math.round(heightM / 0.1));
    return {
      id:               'bed_' + Date.now(),
      name:             name || 'New Plot',
      type:             'plot',
      widthM:           +widthM,
      heightM:          +heightM,
      cols, rows,
      cells:            {},
      successionCells:  {},
    };
  }

  function newSeedTrayBed(name, cols, rows) {
    const safeCols = Math.max(1, Math.round(cols));
    const safeRows = Math.max(1, Math.round(rows));
    return {
      id:               'bed_' + Date.now(),
      name:             name || 'New Tray',
      type:             'tray',
      widthM:           +(safeCols * 0.1).toFixed(2),
      heightM:          +(safeRows * 0.1).toFixed(2),
      cols:             safeCols,
      rows:             safeRows,
      cells:            {},
      successionCells:  {},
    };
  }

  function updateBed(bed) {
    const beds = getBeds();
    const idx  = beds.findIndex(b => b.id === bed.id);
    if (idx >= 0) beds[idx] = bed; else beds.push(bed);
    saveBeds(beds);
  }

  function deleteBed(id) {
    saveBeds(getBeds().filter(b => b.id !== id));
  }

  // ── custom plants ─────────────────────────────────────────────
  function getCustomPlants() { return load(KEYS.customPlants, []); }
  function saveCustomPlants(list) { save(KEYS.customPlants, list); }

  function upsertCustomPlant(plant) {
    const list = getCustomPlants();
    const idx  = list.findIndex(p => p.id === plant.id);
    if (idx >= 0) list[idx] = plant; else list.push(plant);
    saveCustomPlants(list);
  }

  function deleteCustomPlant(id) {
    saveCustomPlants(getCustomPlants().filter(p => p.id !== id));
    // also remove from all beds
    const beds = getBeds();
    beds.forEach(bed => {
      Object.keys(bed.cells).forEach(k => {
        const cell = bed.cells[k];
        const plantId = typeof cell === 'string' ? cell : cell?.plantId;
        if (plantId === id) delete bed.cells[k];
      });
    });
    saveBeds(beds);
    // and from inventory
    const inv = getInventory();
    saveInventory(inv.filter(s => s.plantId !== id));
  }

  // ── built-in plant overrides ──────────────────────────────────
  // Override map: { [plantId]: partialPlantObject }
  function getBuiltinPlantOverrides() { return load(KEYS.builtins, {}); }
  function saveBuiltinPlantOverrides(map) { save(KEYS.builtins, map || {}); }

  function upsertBuiltinPlantOverride(plantId, override) {
    const map = getBuiltinPlantOverrides();
    map[plantId] = { ...(map[plantId] || {}), ...override };
    saveBuiltinPlantOverrides(map);
  }

  function deleteBuiltinPlantOverride(plantId) {
    const map = getBuiltinPlantOverrides();
    delete map[plantId];
    saveBuiltinPlantOverrides(map);
  }

  // ── seed inventory ────────────────────────────────────────────
  // Seed entry: {
  //   id, plantId, seedTag, variety, qty, unit ('seeds'|'g'|'ml'|'packets'),
  //   expiry (YYYY-MM-DD), notes,
  //   germinationDaysMin, germinationDaysMax
  // }
  function getInventory() { return load(KEYS.inventory, []); }
  function saveInventory(list) { save(KEYS.inventory, list); }

  function upsertSeed(seed) {
    const list = getInventory();
    const idx  = list.findIndex(s => s.id === seed.id);
    if (idx >= 0) list[idx] = seed; else list.push(seed);
    saveInventory(list);
  }

  function deleteSeed(id) {
    saveInventory(getInventory().filter(s => s.id !== id));
  }

  function adjustSeedQty(id, delta) {
    const list = getInventory();
    const seed = list.find(s => s.id === id);
    if (!seed) return;
    seed.qty = Math.max(0, (seed.qty || 0) + delta);
    saveInventory(list);
    return seed.qty;
  }

  // ── lifecycle journal (event log) ────────────────────────────
  // Event: {
  //   id, ts, seasonYear, bedId, bedName, instanceId, plantId, seedId,
  //   fromState, toState, action
  // }
  function getLifecycleJournal() { return load(KEYS.lifecycleJournal, []); }
  function saveLifecycleJournal(list) { save(KEYS.lifecycleJournal, list); }

  function addLifecycleEvent(event) {
    const list = getLifecycleJournal();
    const nowIso = new Date().toISOString();
    list.push({
      id: `lc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      ts: nowIso,
      eventDate: nowIso.slice(0, 10),
      ...event,
    });
    saveLifecycleJournal(list);
  }

  function getLifecycleEventsForBedYear(bedId, seasonYear) {
    return getLifecycleJournal()
      .filter(e => e.bedId === bedId && e.seasonYear === seasonYear)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }

  // ── bed planting history (crop rotation) ─────────────────────
  // Entry: {
  //   bedId, bedName, year,
  //   widthM, heightM, rows, cols, totalCells, occupiedCells, freeCells, areaM2,
  //   familyCounts: { familyName: count },
  //   plantCounts: { plantId: count },
  //   lifecycleCounts: { planned|direct_sow|tray_seeded|germinated|transplanted|growing|harvested_once|harvested_continuous|gone_to_seed|failed: count }
  // }
  function getBedHistory() { return load(KEYS.bedHistory, []); }
  function saveBedHistory(h) { save(KEYS.bedHistory, h); }

  // Archive current season: records which botanical families are in each bed.
  // plantLookup: (plantId) => plant object  (caller supplies PlantDB.get)
  function archiveSeason(year, plantLookup) {
    const beds = getBeds();
    const prev = getBedHistory().filter(h => h.year !== year);
    const newEntries = [];
    beds.forEach(bed => {
      const familyCounts = {};
      const plantCounts = {};
      const lifecycleCounts = {
        planned: 0,
        direct_sow: 0,
        tray_seeded: 0,
        germinated: 0,
        ready_to_transplant: 0,
        hardened: 0,
        transplanted: 0,
        growing: 0,
        harvested_once: 0,
        harvested_continuous: 0,
        gone_to_seed: 0,
        failed_germination: 0,
        failed_plant: 0,
        failed: 0,
      };
      const occupiedCells = Object.keys(bed.cells || {}).length;
      const totalCells = (bed.cols || 0) * (bed.rows || 0);
      const freeCells = Math.max(0, totalCells - occupiedCells);
      const areaM2 = (bed.widthM || 0) * (bed.heightM || 0);
      Object.values(bed.cells).forEach(cell => {
        const isOrigin = typeof cell === 'string' ? true : !!cell?.origin;
        if (!isOrigin) return;
        const pid = typeof cell === 'string' ? cell : cell?.plantId;
        if (!pid) return;
        plantCounts[pid] = (plantCounts[pid] || 0) + 1;
        const lifecycle = typeof cell === 'string' ? 'planned' : (cell?.lifecycle || 'planned');
        if (Object.prototype.hasOwnProperty.call(lifecycleCounts, lifecycle)) {
          lifecycleCounts[lifecycle] += 1;
        }
        const plant = plantLookup(pid);
        if (plant?.family) {
          familyCounts[plant.family] = (familyCounts[plant.family] || 0) + 1;
        }
      });
      newEntries.push({
        bedId: bed.id,
        bedName: bed.name,
        year,
        widthM: bed.widthM || 0,
        heightM: bed.heightM || 0,
        rows: bed.rows || 0,
        cols: bed.cols || 0,
        totalCells,
        occupiedCells,
        freeCells,
        areaM2,
        familyCounts,
        plantCounts,
        lifecycleCounts,
      });
    });
    saveBedHistory([...prev, ...newEntries]);
    return newEntries;
  }

  // Returns a Set of family names planted in a given bed in a given year.
  function getFamiliesInBedYear(bedId, year) {
    const entries = getBedHistory().filter(h => h.bedId === bedId && h.year === year);
    const families = new Set();
    entries.forEach(h => Object.keys(h.familyCounts || {}).forEach(f => families.add(f)));
    return families;
  }

  // Returns all history entries for a bed, newest year first.
  function getBedHistoryForBed(bedId) {
    return getBedHistory()
      .filter(h => h.bedId === bedId)
      .sort((a, b) => b.year - a.year);
  }

  // ── settings ──────────────────────────────────────────────────
  function getSettings() {
    return { ...defaultSettings(), ...load(KEYS.settings, {}) };
  }
  function saveSettings(s) { save(KEYS.settings, s); }

  // ── export / import all data ──────────────────────────────────
  function exportAll() {
    return JSON.stringify({
      version: 5,
      gardenName: getSettings().gardenName || '',
      beds:         getBeds(),
      customPlants: getCustomPlants(),
      builtins:     getBuiltinPlantOverrides(),
      inventory:    getInventory(),
      settings:     getSettings(),
      bedHistory:   getBedHistory(),
      lifecycleJournal: getLifecycleJournal(),
      exportedAt:   new Date().toISOString(),
    }, null, 2);
  }

  function importAll(jsonString) {
    const data = JSON.parse(jsonString);
    if (!data || ![2, 3, 4, 5].includes(data.version)) throw new Error('Incompatible backup file (expected v2-v5)');
    saveBeds(data.beds         ?? []);
    saveCustomPlants(data.customPlants ?? []);
    saveBuiltinPlantOverrides(data.builtins ?? {});
    saveInventory(data.inventory      ?? []);
    saveSettings(data.settings        ?? {});
    saveBedHistory(data.bedHistory     ?? []);
    saveLifecycleJournal(data.lifecycleJournal ?? []);
  }

  return {
    getBeds, saveBeds, newBed, newPlotBed, newSeedTrayBed, updateBed, deleteBed,
    getCustomPlants, saveCustomPlants, upsertCustomPlant, deleteCustomPlant,
    getBuiltinPlantOverrides, saveBuiltinPlantOverrides, upsertBuiltinPlantOverride, deleteBuiltinPlantOverride,
    getInventory, saveInventory, upsertSeed, deleteSeed, adjustSeedQty,
    getLifecycleJournal, saveLifecycleJournal, addLifecycleEvent, getLifecycleEventsForBedYear,
    getSettings, saveSettings,
    getBedHistory, saveBedHistory, archiveSeason, getFamiliesInBedYear, getBedHistoryForBed,
    exportAll, importAll,
  };
})();
