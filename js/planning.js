/* js/planning.js — Planning tab: task engine + PlanningView
   ================================================================ */
'use strict';

// ── Top-level helpers (no DOM dependency) ───────────────────────

function _planNormCell(val, key) {
  if (!val) return null;
  if (typeof val === 'string') {
    return { plantId: val, instanceId: key, origin: true, lifecycle: 'planned' };
  }
  return val;
}

function _planHasSeeds(plantId, inventory) {
  return inventory.some(s => s.plantId === plantId && (s.qty || 0) > 0);
}

function _planHasTraySource(plantId, beds) {
  return beds.some(b => {
    if (b.type !== 'tray') return false;
    return Object.entries(b.cells || {}).some(([k, arr]) => {
      if (!Array.isArray(arr)) return false;
      return arr.some(raw => {
        const c = _planNormCell(raw, k);
        return c?.origin && c?.plantId === plantId &&
          ['tray_seeded', 'germinated', 'ready_to_transplant', 'hardened'].includes(c?.lifecycle || 'planned');
      });
    });
  });
}

function _planGetSeedStartDate(instanceId, bedId, plantId) {
  const journal = Store.getLifecycleJournal();
  const year = activeSeasonYear();
  const entry = journal.find(e =>
    e.instanceId === instanceId && e.bedId === bedId &&
    e.plantId === plantId && e.seasonYear === year &&
    (e.toState === 'direct_sow' || e.toState === 'tray_seeded')
  );
  return entry?.eventDate || null;
}

function _planDaysSince(ymdString, today) {
  if (!ymdString) return null;
  const d = new Date(ymdString + 'T12:00:00');
  return Math.round((today - d) / 86400000);
}

function _planGermUrgency(instanceId, bedId, plantId, plant, today) {
  const startDate = _planGetSeedStartDate(instanceId, bedId, plantId);
  const days = _planDaysSince(startDate, today);
  if (days === null) return 'upcoming';
  const minDays = parseInt(plant?.germinationDaysMin, 10) || 5;
  const maxDays = parseInt(plant?.germinationDaysMax, 10) || 14;
  if (days > maxDays * 1.5) return 'overdue';
  if (days >= maxDays)      return 'now';
  if (days >= minDays)      return 'soon';
  return 'upcoming';
}

function _planGermDaysMsg(instanceId, bedId, plantId, today) {
  const startDate = _planGetSeedStartDate(instanceId, bedId, plantId);
  const days = _planDaysSince(startDate, today);
  return days !== null ? ` — seeded ${days} day${days !== 1 ? 's' : ''} ago` : '';
}

function _planNextHalfStage(plant, half) {
  const next = half === 12.5 ? 1 : half + 0.5;
  return getSeasonalStage(plant, next);
}

// Returns 'direct' or 'transplant' based on explicit plantingMode,
// falling back to 'direct' when not specified.
// Plants with sowIndoor:null have no indoor start — always direct.
function _planEffectiveMethod(plant) {
  if (!plant.sowIndoor || plant.sowIndoor.length === 0) return 'direct';
  if (plant.plantingMode === 'transplant') return 'transplant';
  return 'direct'; // default (covers 'direct', null, or unset)
}

// ── Task type metadata ───────────────────────────────────────────
const PLAN_TYPE_META = {
  buy_seeds:         { badge: '🛒 Buy Seeds',    badgeClass: 'planning-badge--buy',   actionLabel: 'Buy Seeds'             },
  start_tray:        { badge: '🪴 Start Tray',   badgeClass: 'planning-badge--tray',  actionLabel: 'Mark as tray seeded'   },
  direct_sow:        { badge: '🌰 Direct Sow',   badgeClass: 'planning-badge--sow',   actionLabel: 'Mark as direct sown'   },
  check_germination: { badge: '🌱 Germination',  badgeClass: 'planning-badge--germ',  actionLabel: 'Mark as germinated'    },
  transplant:        { badge: '🌿 Transplant',   badgeClass: 'planning-badge--trans', actionLabel: 'Mark as transplanted'  },
  water_compost_pest:{ badge: '💧 Maintain',     badgeClass: 'planning-badge--maint', actionLabel: 'Noted'                 },
  harvest:           { badge: '🧺 Harvest',      badgeClass: 'planning-badge--harv',  actionLabel: 'Mark as harvested'     },
  prepare_harvest:   { badge: '⏰ Prep Harvest', badgeClass: 'planning-badge--prep',  actionLabel: 'Noted'                 },
};

// lifecycle state each task type advances to
const PLAN_TYPE_NEXT_LC = {
  start_tray:        'tray_seeded',
  direct_sow:        'direct_sow',
  check_germination: 'germinated',
  transplant:        'transplanted',
  harvest:           'harvested_once',
};

const PLAN_URGENCY_META = {
  overdue:  { label: '⚠ Overdue',    cls: 'planning-urg--overdue',  hdrCls: 'planning-hdr--overdue'  },
  now:      { label: '🌱 Do Now',     cls: 'planning-urg--now',      hdrCls: 'planning-hdr--now'      },
  soon:     { label: '⏰ Coming Up',  cls: 'planning-urg--soon',     hdrCls: 'planning-hdr--soon'     },
  upcoming: { label: '📅 Upcoming',  cls: 'planning-urg--upcoming', hdrCls: 'planning-hdr--upcoming' },
};
const PLAN_URGENCY_ORDER = ['overdue', 'now', 'soon', 'upcoming'];

// ================================================================
// TASK ENGINE
// ================================================================
/**
 * Pure function — no DOM side-effects.
 * Returns an array of task objects, one per plant instance per action type.
 */
function generatePlanningTasks(beds, inventory, settings, today) {
  const m = today.getMonth() + 1;
  const todayHalf = today.getDate() <= 15 ? m : m + 0.5;
  const tasks = [];
  const buySeedsSeen = new Set(); // emit buy_seeds only once per plantId

  function makeId(bedId, instanceId, type) {
    return `task_${bedId}_${instanceId}_${type}`;
  }

  function push(t) { tasks.push(t); }

  beds.forEach(bed => {
    const isTray = bed.type === 'tray';
    const seenInstances = new Set();

    Object.entries(bed.cells || {}).forEach(([k, arr]) => {
      if (!Array.isArray(arr)) return;
      arr.forEach(raw => {
        const cell = _planNormCell(raw, k);
        if (!cell || !cell.origin) return;
        const { plantId, instanceId, lifecycle: lc = 'planned' } = cell;
        if (!plantId || plantId === '__path__') return;

        if (seenInstances.has(instanceId)) return;
        seenInstances.add(instanceId);

        const plant = PlantDB.get(plantId);
        if (!plant || plant._isPath) return;

        const stage  = getSeasonalStage(plant, todayHalf);
        const hasSeed = _planHasSeeds(plantId, inventory);
        const hasTray = _planHasTraySource(plantId, beds);

        if (['gone_to_seed', 'failed_germination', 'failed_plant'].includes(lc)) return;

        const base = {
          bedId:      bed.id,
          bedName:    bed.name,
          instanceId,
          plantId,
          plantName:  plant.name,
          plantEmoji: plant.emoji || '🌱',
          seedId:     cell.seedId || null,
        };

        // ── buy_seeds — one per plantId, does NOT suppress other tasks ──
        if (lc === 'planned' && !hasSeed && !buySeedsSeen.has(plantId)) {
          const canDo = (plant.sowIndoor?.length || 0) + (plant.sowOutdoor?.length || 0) > 0;
          if (canDo) {
            buySeedsSeen.add(plantId);
            push({
              ...base,
              id: makeId(bed.id, instanceId, 'buy_seeds'),
              type: 'buy_seeds',
              urgency: 'now',
              nextLifecycle: null,
            });
            // Fall through — also generate sow/transplant tasks for this instance
          }
        }

        // ── planned ────────────────────────────────────────────────
        if (lc === 'planned') {
          const method       = _planEffectiveMethod(plant);
          const canDirectSow  = method === 'direct'     && (plant.sowOutdoor?.length || 0) > 0;
          const canTransplant = method === 'transplant' && (plant.sowIndoor?.length  || 0) > 0;
          if (!canDirectSow && !canTransplant) return;

          const nextStage = _planNextHalfStage(plant, todayHalf);

          if (stage === 'sowing_indoor') {
            if (canDirectSow)
              push({ ...base, id: makeId(bed.id, instanceId, 'direct_sow'),
                type: 'direct_sow', urgency: 'now', nextLifecycle: 'direct_sow' });
            if (canTransplant && !hasTray)
              push({ ...base, id: makeId(bed.id, instanceId, 'start_tray'),
                type: 'start_tray', urgency: 'now', nextLifecycle: 'tray_seeded' });

          } else if (stage === 'sowing_outdoor') {
            if (hasTray)
              push({ ...base, id: makeId(bed.id, instanceId, 'transplant'),
                type: 'transplant', urgency: 'now', nextLifecycle: 'transplanted' });
            else if (canTransplant)
              push({ ...base, id: makeId(bed.id, instanceId, 'start_tray'),
                type: 'start_tray', urgency: 'overdue', nextLifecycle: 'tray_seeded' });

          } else if (stage === 'harvesting') {
            const sowType = canDirectSow ? 'direct_sow' : 'start_tray';
            const sowNext = canDirectSow ? 'direct_sow' : 'tray_seeded';
            push({ ...base, id: makeId(bed.id, instanceId, 'overdue_sow'),
              type: sowType, urgency: 'overdue', nextLifecycle: sowNext });

          } else if (nextStage === 'sowing_indoor' || nextStage === 'sowing_outdoor') {
            const sowType = canDirectSow ? 'direct_sow' : 'start_tray';
            const sowNext = canDirectSow ? 'direct_sow' : 'tray_seeded';
            push({ ...base, id: makeId(bed.id, instanceId, 'upcoming_sow'),
              type: sowType, urgency: 'soon', nextLifecycle: sowNext });
          }
          return;
        }

        // ── direct_sow / tray_seeded → check germination ───────────
        if (lc === 'direct_sow' || lc === 'tray_seeded') {
          const urgency = _planGermUrgency(instanceId, bed.id, plantId, plant, today);
          push({ ...base, id: makeId(bed.id, instanceId, 'check_germ'),
            type: 'check_germination', urgency, nextLifecycle: 'germinated' });
          return;
        }

        // ── germinated / ready_to_transplant / hardened ────────────
        if (['germinated', 'ready_to_transplant', 'hardened'].includes(lc)) {
          if (isTray)
            push({ ...base, id: makeId(bed.id, instanceId, 'maintain_tray'),
              type: 'water_compost_pest', urgency: 'now', nextLifecycle: null });
          else
            push({ ...base, id: makeId(bed.id, instanceId, 'transplant'),
              type: 'transplant',
              urgency: (stage === 'sowing_outdoor' || stage === 'growing') ? 'now' : 'soon',
              nextLifecycle: 'transplanted' });
          return;
        }

        // ── transplanted / growing ─────────────────────────────────
        if (lc === 'transplanted' || lc === 'growing') {
          if (stage === 'harvesting')
            push({ ...base, id: makeId(bed.id, instanceId, 'harvest'),
              type: 'harvest', urgency: 'now', nextLifecycle: 'harvested_once' });
          else if (_planNextHalfStage(plant, todayHalf) === 'harvesting')
            push({ ...base, id: makeId(bed.id, instanceId, 'prep_harv'),
              type: 'prepare_harvest', urgency: 'soon', nextLifecycle: null });
          else if (stage === 'growing' || stage === 'perennial' || stage === 'sowing_outdoor')
            push({ ...base, id: makeId(bed.id, instanceId, 'maintain'),
              type: 'water_compost_pest', urgency: 'upcoming', nextLifecycle: null });
          return;
        }

        // ── harvested_once / harvested_continuous ──────────────────
        if ((lc === 'harvested_once' || lc === 'harvested_continuous') && stage === 'harvesting') {
          push({ ...base, id: makeId(bed.id, instanceId, 'harvest_cont'),
            type: 'harvest', urgency: 'now',
            nextLifecycle: lc === 'harvested_continuous' ? null : 'harvested_continuous' });
        }
      });
    });
  });

  return tasks;
}

// ================================================================
// PLANNING VIEW
// ================================================================
const PlanningView = (() => {
  let bedFilter = 'all';

  // ── render ─────────────────────────────────────────────────────
  function render() {
    const wrap = document.getElementById('planning-wrap');
    if (!wrap) return;

    const beds      = Store.getBeds();
    const inventory = Store.getInventory();
    const settings  = Store.getSettings();
    const today     = new Date();

    const dateLabel = document.getElementById('planning-date-label');
    if (dateLabel) {
      dateLabel.textContent = today.toLocaleDateString(undefined,
        { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    _renderBedFilter(beds);

    let tasks = generatePlanningTasks(beds, inventory, settings, today);
    if (bedFilter !== 'all') tasks = tasks.filter(t => t.bedId === bedFilter);

    // Count unique plants (by plantId) with tasks
    const uniquePlants = new Set(tasks.map(t => t.plantId)).size;
    const countLabel = document.getElementById('planning-task-count');
    if (countLabel) {
      countLabel.textContent = uniquePlants
        ? `${uniquePlants} plant type${uniquePlants !== 1 ? 's' : ''} need attention`
        : 'No tasks';
    }

    if (!tasks.length) {
      wrap.innerHTML = `<div class="planning-empty">
        <div style="font-size:2.5rem;margin-bottom:10px">🌿</div>
        <strong>All caught up!</strong>
        <div style="margin-top:6px;color:var(--text-muted);font-size:.78rem">
          No actions required right now. Check back as the season progresses.
        </div>
      </div>`;
      return;
    }

    // Group by urgency
    const groups = {};
    PLAN_URGENCY_ORDER.forEach(u => { groups[u] = []; });
    tasks.forEach(t => { (groups[t.urgency] || groups['upcoming']).push(t); });

    wrap.innerHTML = PLAN_URGENCY_ORDER
      .filter(u => groups[u].length)
      .map(u => _renderGroup(u, groups[u]))
      .join('');
  }

  function _renderBedFilter(beds) {
    const sel = document.getElementById('planning-bed-filter');
    if (!sel) return;
    const current = sel.value || bedFilter;
    sel.innerHTML = `<option value="all">All beds</option>` +
      beds.map(b => `<option value="${b.id}" ${b.id === current ? 'selected' : ''}>${escHtml(b.name)}</option>`).join('');
    sel.value = current;
  }

  // ── render urgency group — cards grouped by plantId ────────────
  function _renderGroup(urgency, tasks) {
    const um = PLAN_URGENCY_META[urgency];

    // Group tasks by plantId
    const plantMap = new Map();
    tasks.forEach(t => {
      if (!plantMap.has(t.plantId)) {
        plantMap.set(t.plantId, {
          plantId:    t.plantId,
          plantName:  t.plantName,
          plantEmoji: t.plantEmoji,
          tasks:      [],
        });
      }
      plantMap.get(t.plantId).tasks.push(t);
    });

    const plantCount = plantMap.size;
    return `<div class="planning-group">
      <div class="planning-group-hdr ${um.hdrCls}">
        ${um.label} &nbsp;·&nbsp; ${plantCount} plant type${plantCount !== 1 ? 's' : ''}
      </div>
      <div class="planning-card-grid">
        ${[...plantMap.values()].map(g => _renderPlantCard(g, urgency)).join('')}
      </div>
    </div>`;
  }

  // ── render one card per plant type per urgency bucket ──────────
  function _renderPlantCard(group, urgency) {
    const um = PLAN_URGENCY_META[urgency] || PLAN_URGENCY_META.upcoming;

    // Unique instance count across all tasks in this group
    const instanceIds = new Set(group.tasks.map(t => t.instanceId));
    const count = instanceIds.size;

    // Unique beds
    const bedMap = new Map();
    group.tasks.forEach(t => bedMap.set(t.bedId, t.bedName));
    const bedLabel = bedMap.size === 1
      ? [...bedMap.values()][0]
      : `${bedMap.size} beds`;

    // Unique task types — one entry per type (first task wins for metadata)
    const typeMap = new Map();
    group.tasks.forEach(t => {
      if (!typeMap.has(t.type)) typeMap.set(t.type, t);
    });

    // Count instances per action type (for button labels)
    const typeCount = {};
    group.tasks.forEach(t => {
      typeCount[t.type] = (typeCount[t.type] || 0) + 1;
    });

    // Type badge chips
    const badgeHtml = [...typeMap.keys()].map(type => {
      const tm = PLAN_TYPE_META[type] || { badge: type, badgeClass: '' };
      return `<span class="planning-type-badge ${tm.badgeClass}">${tm.badge}</span>`;
    }).join('');

    // Action buttons — one per type that has a lifecycle advance
    const actionBtns = [...typeMap.values()]
      .filter(t => t.nextLifecycle)
      .map(t => {
        const tm = PLAN_TYPE_META[t.type] || {};
        const n  = typeCount[t.type] || 1;
        const label = tm.actionLabel || t.type;
        const safeId  = escHtml(group.plantId);
        const safeType = escHtml(t.type);
        return `<button class="btn btn-sm btn-primary"
          onclick="PlanningView.markDoneByPlantType('${safeId}','${safeType}')">
          ✓ ${escHtml(label)}${n > 1 ? ` (${n})` : ''}
        </button>`;
      }).join('');

    // Buy-seeds shortcut
    const hasBuy = typeMap.has('buy_seeds');
    const buyBtn = hasBuy
      ? `<button class="btn btn-sm btn-secondary" onclick="switchTab('inventory')">📦 Buy Seeds</button>`
      : '';

    // View bed(s) button
    const firstBedId = [...bedMap.keys()][0];
    const viewBtn = bedMap.size === 1
      ? `<button class="btn btn-sm btn-ghost" onclick="PlanningView.navigateToBed('${escHtml(firstBedId)}')">🪴 View Bed</button>`
      : `<button class="btn btn-sm btn-ghost" onclick="switchTab('beds')">🪴 View Beds</button>`;

    return `<div class="planning-card ${um.cls}">
      <div class="planning-card-plant">
        <span class="planning-card-emoji">${plantIconHtml(PlantDB.get(group.plantId), 24)}</span>
        <div class="planning-card-names">
          <strong>${escHtml(group.plantName)} <span class="planning-count">×${count}</span></strong>
          <span class="planning-card-bed">${escHtml(bedLabel)}</span>
        </div>
        <div class="planning-badges">${badgeHtml}</div>
      </div>
      <div class="planning-card-actions">
        ${actionBtns}${buyBtn}${viewBtn}
      </div>
    </div>`;
  }

  // ── mark done — advance all instances of a plantId+type ────────
  function markDoneByPlantType(plantId, taskType) {
    const beds      = Store.getBeds();
    const inventory = Store.getInventory();
    const settings  = Store.getSettings();
    const today     = new Date();

    let targets = generatePlanningTasks(beds, inventory, settings, today)
      .filter(t => t.plantId === plantId && t.type === taskType && t.nextLifecycle);

    if (bedFilter !== 'all') targets = targets.filter(t => t.bedId === bedFilter);
    if (!targets.length) { render(); return; }

    // Re-fetch beds fresh for mutation
    const allBeds = Store.getBeds();
    let changed = 0;

    targets.forEach(task => {
      const bed = allBeds.find(b => b.id === task.bedId);
      if (!bed) return;

      let fromState = 'planned';
      let found = false;

      Object.entries(bed.cells || {}).forEach(([k, arr]) => {
        if (!Array.isArray(arr)) return;
        for (let i = 0; i < arr.length; i++) {
          const c = _planNormCell(arr[i], k);
          if (!c || !c.origin || c.instanceId !== task.instanceId) continue;
          fromState = c.lifecycle || 'planned';
          arr[i] = { ...c, lifecycle: task.nextLifecycle };
          found = true;
        }
      });

      if (!found) return;
      Store.updateBed(bed);

      if (fromState !== task.nextLifecycle) {
        Store.addLifecycleEvent({
          seasonYear:     activeSeasonYear(),
          bedId:          bed.id,
          bedName:        bed.name,
          bedContextId:   bed.id,
          bedContextName: bed.name,
          instanceId:     task.instanceId,
          plantId:        task.plantId,
          seedId:         task.seedId,
          fromState,
          toState:        task.nextLifecycle,
          action:         'planning-task',
          note:           '',
          qty:            1,
        });
      }
      changed++;
    });

    const plant = PlantDB.get(plantId);
    const tm    = PLAN_TYPE_META[taskType];
    Toast.show(`${plant?.name || plantId}: ${tm?.actionLabel || taskType}${changed > 1 ? ` (${changed})` : ''}`);
    render();
  }

  // ── navigate to bed ────────────────────────────────────────────
  function navigateToBed(bedId) {
    switchTab('beds');
    Beds.selectBed(bedId);
  }

  // ── bed filter ─────────────────────────────────────────────────
  function setBedFilter(val) {
    bedFilter = val || 'all';
    render();
  }

  return { render, setBedFilter, markDoneByPlantType, navigateToBed };
})();
