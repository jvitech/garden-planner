/* js/inventory.js — Seed Inventory page controller
   ================================================================ */
'use strict';

const Inventory = (() => {

  let filterSearch = '';
  let filterStock  = 'all'; // 'all' | 'instock' | 'low' | 'none'
  let filterGermination = 'all'; // 'all' | 'good' | 'mixed' | 'poor' | 'nodata'
  let sortBy = 'name-asc';
  let pickedImageName = '';
  let pickedPreviewUrl = '';

  const SEED_IMAGE_DIR = 'photos/seeds';
  const SEED_IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

  function seedImageUrl(filename) {
    return `${SEED_IMAGE_DIR}/${encodeURIComponent(filename)}`;
  }

  function imageSourcesForSeed(seed) {
    const explicit = String(seed?.imageFilename || '').trim();
    if (explicit) return [seedImageUrl(explicit)];

    const tag = String(seed?.seedTag || '').trim();
    if (!tag) return [];
    return SEED_IMAGE_EXTS.map(ext => seedImageUrl(`${tag}.${ext}`));
  }

  function renderSeedMedia(seed, emoji, name) {
    const sources = imageSourcesForSeed(seed);
    const label = escAttr(`${name} seed image`);

    if (!sources.length) {
      return `<div class="seed-card-media seed-card-media-fallback" aria-label="${label}">${emoji}</div>`;
    }

    return `<div class="seed-card-media" aria-label="${label}">
      <img class="seed-card-thumb" src="${escAttr(sources[0])}" alt="${label}" decoding="async" loading="lazy" data-src-list="${escAttr(sources.join('|'))}" data-src-index="0" onload="Inventory.handleImageLoad(this)" onerror="Inventory.handleImageError(this)" onclick="Inventory.openImageLightbox(this)">
      <div class="seed-card-media-fallback" style="display:none">${emoji}</div>
    </div>`;
  }

  function renderModalImagePreview(seed) {
    const sources = imageSourcesForSeed(seed);
    if (!sources.length) {
      return '<div class="seed-image-preview-empty">No seed photo found yet.</div>';
    }

    return `<div class="seed-image-preview-frame">
      <img class="seed-image-preview-img" src="${escAttr(sources[0])}" alt="Seed photo preview" decoding="async" loading="lazy" data-src-list="${escAttr(sources.join('|'))}" data-src-index="0" onload="Inventory.handleImageLoad(this)" onerror="Inventory.handleImageError(this)">
      <div class="seed-image-preview-empty" style="display:none">No seed photo found yet.</div>
    </div>`;
  }

  function revokePickedPreview() {
    if (!pickedPreviewUrl) return;
    URL.revokeObjectURL(pickedPreviewUrl);
    pickedPreviewUrl = '';
  }

  function setPreviewContent(html) {
    const preview = document.getElementById('im-image-preview');
    if (preview) preview.innerHTML = html;
  }

  function syncImageHint() {
    const hint = document.getElementById('im-image-path-hint');
    const tag = document.getElementById('im-tag')?.value.trim() || '';
    const filename = document.getElementById('im-image-filename')?.value.trim() || '';
    if (!hint) return;

    if (filename) {
      hint.textContent = `Will load: ${SEED_IMAGE_DIR}/${filename}`;
      return;
    }
    if (tag) {
      hint.textContent = `Will auto-try: ${SEED_IMAGE_DIR}/${tag}.jpg, .jpeg, .png, .webp, .gif`;
      return;
    }
    hint.textContent = 'Add a seed tag to use the default photo filename lookup.';
  }

  function seedGerminationStats(seedId) {
    const year = activeSeasonYear();
    const events = Store.getLifecycleJournal().filter(event => event.seedId === seedId && Number(event.seasonYear) === Number(year));
    const sumQty = state => events
      .filter(event => event.toState === state)
      .reduce((sum, event) => sum + Math.max(1, Number(event.qty) || 1), 0);
    const directSow = sumQty('direct_sow');
    const traySeeded = sumQty('tray_seeded');
    const started = directSow + traySeeded;
    const germinated = sumQty('germinated');
    const rate = started ? Math.round((germinated / started) * 100) : null;
    return { started, germinated, rate, year };
  }

  function germinationBucket(rate) {
    if (rate === null || rate === undefined) return 'nodata';
    if (rate >= 75) return 'good';
    if (rate >= 50) return 'mixed';
    return 'poor';
  }

  function ratingStars(rating) {
    const value = Math.max(0, Math.min(5, parseInt(rating, 10) || 0));
    if (!value) return 'Not rated';
    return `${'★'.repeat(value)}${'☆'.repeat(5 - value)}`;
  }

  // ── render page ───────────────────────────────────────────────
  function render() {
    const seeds   = Store.getInventory();
    const plants  = PlantDB.all();
    const grid    = document.getElementById('inv-grid');
    const germStatsMap = new Map(seeds.map(seed => [seed.id, seedGerminationStats(seed.id)]));

    const filtered = seeds.filter(s => {
      const p = plants.find(x => x.id === s.plantId);
      const name = (p?.name ?? s.plantId).toLowerCase();
      const germStats = germStatsMap.get(s.id) || { rate: null };
      if (filterSearch && !name.includes(filterSearch) && !(s.variety||'').toLowerCase().includes(filterSearch) && !(s.seedTag||'').toLowerCase().includes(filterSearch)) return false;
      if (filterStock === 'instock' && s.qty <= 0) return false;
      if (filterStock === 'low'     && (s.qty > 10 || s.qty <= 0)) return false;
      if (filterStock === 'none'    && s.qty > 0) return false;
      if (filterStock === 'new'     && !s.sealed) return false;
      if (filterGermination !== 'all' && germinationBucket(germStats.rate) !== filterGermination) return false;
      return true;
    }).slice().sort((a, b) => {
      const aPlant = plants.find(x => x.id === a.plantId);
      const bPlant = plants.find(x => x.id === b.plantId);
      const aName = (aPlant?.name ?? a.plantId).toLowerCase();
      const bName = (bPlant?.name ?? b.plantId).toLowerCase();
      const aStats = germStatsMap.get(a.id) || { rate: null };
      const bStats = germStatsMap.get(b.id) || { rate: null };
      const aRating = parseInt(a.rating, 10) || 0;
      const bRating = parseInt(b.rating, 10) || 0;
      if (sortBy === 'germ-desc') return (bStats.rate ?? -1) - (aStats.rate ?? -1) || aName.localeCompare(bName);
      if (sortBy === 'germ-asc') return (aStats.rate ?? 101) - (bStats.rate ?? 101) || aName.localeCompare(bName);
      if (sortBy === 'rating-desc') return bRating - aRating || aName.localeCompare(bName);
      if (sortBy === 'rating-asc') return aRating - bRating || aName.localeCompare(bName);
      if (sortBy === 'qty-desc') return (b.qty || 0) - (a.qty || 0) || aName.localeCompare(bName);
      if (sortBy === 'tag-asc') return (a.seedTag || '').localeCompare(b.seedTag || '') || aName.localeCompare(bName);
      return aName.localeCompare(bName);
    });

    if (!filtered.length) {
      grid.innerHTML = `<div class="inv-empty">
        ${seeds.length ? '🔍 No seeds match your filter.' : '🌱 Your seed inventory is empty.<br><br>Click <strong>+ Add Seeds</strong> to get started.'}
      </div>`;
      return;
    }

    grid.innerHTML = filtered.map(s => cardHtml(s, plants, germStatsMap.get(s.id))).join('');
  }

  function cardHtml(s, plants, germStats = null) {
    const p       = plants.find(x => x.id === s.plantId);
    const emoji   = p?.emoji ?? '🌱';
    const name    = p?.name  ?? s.plantId;
    const qty     = s.qty ?? 0;
    const stockCls = qty <= 0 ? 'no-stock'  : qty <= 10 ? 'low-stock' : '';
    const badgeCls = qty <= 0 ? 'stock-none': qty <= 10 ? 'stock-low' : 'stock-ok';
    const badgeTxt = qty <= 0 ? 'Out of stock' : qty <= 10 ? 'Low stock' : 'In stock';

    const sealedBadge = s.sealed ? `<span class="stock-badge stock-sealed">📦 New</span>` : '';
    const expHtml  = expiryHtml(s.expiry);
    const plantGermMin = parseInt(p?.germinationDaysMin, 10);
    const plantGermMax = parseInt(p?.germinationDaysMax, 10);
    const seedGermMin = parseInt(s.germinationDaysMin, 10);
    const seedGermMax = parseInt(s.germinationDaysMax, 10);
    const germMin = Number.isFinite(seedGermMin) ? Math.max(0, seedGermMin) : (Number.isFinite(plantGermMin) ? Math.max(0, plantGermMin) : null);
    const germMaxRaw = Number.isFinite(seedGermMax) ? seedGermMax : (Number.isFinite(plantGermMax) ? plantGermMax : germMin);
    const germMax = germMaxRaw === null || germMaxRaw === undefined ? null : Math.max(germMin || 0, germMaxRaw);
    const germHtml = germMin !== null && germMax !== null
      ? `<div class="seed-expiry">🌱 Germination: ${germMin === germMax ? `${germMin}d` : `${germMin}-${germMax}d`}</div>`
      : '';
    const germRateCls = germStats.rate === null ? '' : (germStats.rate >= 75 ? '' : (germStats.rate >= 50 ? 'warn' : 'bad'));
    const germRateHtml = germStats.started
      ? `<div class="seed-expiry ${germRateCls}">🧪 Germination success: ${germStats.rate}% (${germStats.germinated}/${germStats.started}) · ${germStats.year}</div>`
      : `<div class="seed-expiry">🧪 Germination success: no starts logged yet · ${germStats.year}</div>`;
    const ratingHtml = `<div class="seed-rating" title="Your rating">${ratingStars(s.rating)}${parseInt(s.rating, 10) ? ` <span class="seed-rating-num">(${parseInt(s.rating, 10)}/5)</span>` : ''}</div>`;
    const mediaHtml = renderSeedMedia(s, emoji, name);

    return `
<div class="seed-card ${stockCls}${s.sealed ? ' sealed-packet' : ''}" data-id="${s.id}">
  <div class="seed-card-head">
    ${mediaHtml}
    <div class="seed-card-title">
      <div class="seed-card-name">${escHtml(name)}</div>
      ${s.seedTag  ? `<span class="seed-tag-badge">🏷 ${escHtml(s.seedTag)}</span>` : ''}
      ${s.variety  ? `<div class="seed-card-variety">${escHtml(s.variety)}</div>` : ''}
    </div>
    ${sealedBadge}
    <span class="stock-badge ${badgeCls}">${badgeTxt}</span>
  </div>
  <div class="seed-qty-row">
    <span class="seed-qty-label">Quantity (${escHtml(s.unit||'seeds')})</span>
    <div class="qty-ctrl">
      <button class="qty-btn" onclick="Inventory.adjustQty('${s.id}',-1)">−</button>
      <div class="qty-val"><input type="number" min="0" value="${qty}" onchange="Inventory.setQty('${s.id}',this.value)"></div>
      <button class="qty-btn" onclick="Inventory.adjustQty('${s.id}',+1)">+</button>
    </div>
  </div>
  ${expHtml}
  ${germHtml}
  ${germRateHtml}
  ${ratingHtml}
  ${s.notes ? `<div class="seed-notes">${escHtml(s.notes)}</div>` : ''}
  <div class="seed-actions">
    <button class="btn btn-secondary btn-sm" onclick="Inventory.cloneSeed('${s.id}')">📋 Copy</button>
    <button class="btn btn-secondary btn-sm" onclick="Inventory.openEdit('${s.id}')">✏️ Edit</button>
    <button class="btn btn-danger btn-sm"    onclick="Inventory.deleteSeed('${s.id}')">🗑️ Delete</button>
  </div>
</div>`;
  }

  function expiryHtml(expiry) {
    if (!expiry) return '';
    const d    = new Date(expiry);
    const now  = new Date();
    const days = Math.ceil((d - now) / 86400000);
    let cls = '', msg = '';
    if (days < 0)   { cls = 'bad';  msg = `Expired ${Math.abs(days)}d ago`; }
    else if (days < 60) { cls = 'warn'; msg = `Expires in ${days}d`; }
    else             { cls = '';    msg = `Expires ${d.toLocaleDateString()}`; }
    return `<div class="seed-expiry ${cls}">⏳ ${msg}</div>`;
  }

  // ── actions ───────────────────────────────────────────────────

  // Patches only the qty-dependent elements in an already-rendered card.
  // Avoids a full render() call (which rebuilds the entire grid + journal reads)
  // for a simple stock count change.
  function _applyQtyToDom(id, qty) {
    const card = document.querySelector(`.seed-card[data-id="${id}"]`);
    if (!card) return;
    const inp = card.querySelector('.qty-val input');
    if (inp) inp.value = qty;
    card.classList.toggle('no-stock',  qty <= 0);
    card.classList.toggle('low-stock', qty > 0 && qty <= 10);
    const badge = card.querySelector('.stock-badge:not(.stock-sealed)');
    if (badge) {
      badge.className = `stock-badge ${qty <= 0 ? 'stock-none' : qty <= 10 ? 'stock-low' : 'stock-ok'}`;
      badge.textContent = qty <= 0 ? 'Out of stock' : qty <= 10 ? 'Low stock' : 'In stock';
    }
  }

  function adjustQty(id, delta) {
    const newQty = Store.adjustSeedQty(id, delta);
    if (newQty !== undefined) _applyQtyToDom(id, newQty);
  }

  function setQty(id, val) {
    const list = Store.getInventory();
    const seed = list.find(s => s.id === id);
    if (!seed) return;
    const newQty = Math.max(0, parseInt(val, 10) || 0);
    seed.qty = newQty;
    Store.saveInventory(list);
    _applyQtyToDom(id, newQty);
  }

  function deleteSeed(id) {
    const list = Store.getInventory();
    const seed = list.find(s => s.id === id);
    if (!seed) return;
    const p = PlantDB.get(seed.plantId);
    if (!confirm(`Delete seed entry for "${p?.name ?? seed.plantId}"?`)) return;
    Store.deleteSeed(id);
    render();
    Toast.show('Seed entry deleted');
  }

  // ── add / edit modal ──────────────────────────────────────────
  function openNew() {
    openModal(null);
  }

  // Opens a blank new-seed form with the plant dropdown pre-selected.
  // Uses the same auto-generated seed tag as the regular "Add Seeds" path.
  function openNewForPlant(plantId) {
    openModal(null);
    const sel = document.getElementById('im-plant');
    if (sel && plantId) sel.value = plantId;
  }

  function openEdit(id) {
    openModal(Store.getInventory().find(s => s.id === id));
  }

  function nextSeedTag() {
    const now    = new Date();
    const prefix = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
    const used   = new Set(Store.getInventory().map(s => s.seedTag));
    for (let i = 1; i <= 99; i++) {
      const tag = `${prefix}-${String(i).padStart(2, '0')}`;
      if (!used.has(tag)) return tag;
    }
    return prefix + '-??';
  }

  function openModal(existing) {
    const plants = PlantDB.all();
    const opts   = plants.map(p => `<option value="${p.id}" ${existing?.plantId === p.id ? 'selected' : ''}>${p.emoji} ${escHtml(p.name)}</option>`).join('');

    pickedImageName = '';
    revokePickedPreview();

    document.getElementById('inv-modal-body').innerHTML = `
      <div class="form-row">
        <label>Plant *</label>
        <select id="im-plant">${opts}</select>
      </div>
      <div class="form-row">
        <label>Seed Tag / ID</label>
        <input id="im-tag" type="text" placeholder="e.g. 2604-00" value="${escAttr(existing?.seedTag || (!existing ? nextSeedTag() : ''))}" oninput="Inventory.syncImageHint()">
        <div class="form-hint">Your reference code for this seed packet (printed on the packet label).</div>
      </div>
      <div class="form-row">
        <label>Photo filename override</label>
        <input id="im-image-filename" type="text" placeholder="Optional, e.g. roma-2026.jpg" value="${escAttr(existing?.imageFilename||'')}" oninput="Inventory.syncImageHint()">
        <div class="form-hint">Seed photos are loaded from <strong>${SEED_IMAGE_DIR}</strong>. Leave blank to auto-match the seed tag.</div>
        <div class="form-hint" id="im-image-path-hint"></div>
      </div>
      <div class="form-row">
        <label>Preview local image (optional)</label>
        <input id="im-image-picker" type="file" accept="image/*" onchange="Inventory.previewImageFile(event)">
        <div class="form-hint">Preview only. The app does not copy the file for you. Put the final image inside <strong>${SEED_IMAGE_DIR}</strong>.</div>
        <div class="seed-image-picker-row">
          <button type="button" class="btn btn-secondary btn-sm" onclick="Inventory.usePickedFilename()">Use picked filename</button>
          <span id="im-image-picked-name" class="form-hint">No local file picked.</span>
        </div>
        <div id="im-image-preview" class="seed-image-preview">${renderModalImagePreview(existing)}</div>
      </div>
      <div class="form-row">
        <label>Variety / Label</label>
        <input id="im-variety" type="text" placeholder="e.g. Roma, Brandywine…" value="${escAttr(existing?.variety||'')}">
      </div>
      <div class="form-row">
        <label>Packet status</label>
        <select id="im-sealed">
          <option value="0" ${!existing?.sealed ? 'selected' : ''}>Opened / in use</option>
          <option value="1" ${existing?.sealed  ? 'selected' : ''}>New — sealed packet</option>
        </select>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Quantity *</label>
          <input id="im-qty" type="number" min="0" value="${existing?.qty ?? (!existing ? 100 : 0)}">
        </div>
        <div class="form-row">
          <label>Unit</label>
          <select id="im-unit">
            <option value="seeds" ${existing?.unit==='seeds'||!existing?'selected':''}>seeds</option>
            <option value="g"     ${existing?.unit==='g'    ?'selected':''}>g (grams)</option>
            <option value="ml"    ${existing?.unit==='ml'   ?'selected':''}>ml</option>
            <option value="packets" ${existing?.unit==='packets'?'selected':''}>packets</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <label>Expiry date</label>
        <input id="im-expiry" type="date" value="${escAttr(existing?.expiry||'')}">
        <div class="form-hint">Leave blank if unknown.</div>
      </div>
      <div class="form-row-inline">
        <div class="form-row">
          <label>Germination (min days)</label>
          <input id="im-germ-min" type="number" min="0" step="1" value="${existing?.germinationDaysMin ?? ''}">
        </div>
        <div class="form-row">
          <label>Germination (max days)</label>
          <input id="im-germ-max" type="number" min="0" step="1" value="${existing?.germinationDaysMax ?? ''}">
        </div>
        <div class="form-row">
          <label>My rating</label>
          <select id="im-rating">
            <option value="0" ${(parseInt(existing?.rating, 10) || 0) === 0 ? 'selected' : ''}>Not rated</option>
            <option value="1" ${(parseInt(existing?.rating, 10) || 0) === 1 ? 'selected' : ''}>1 ★</option>
            <option value="2" ${(parseInt(existing?.rating, 10) || 0) === 2 ? 'selected' : ''}>2 ★★</option>
            <option value="3" ${(parseInt(existing?.rating, 10) || 0) === 3 ? 'selected' : ''}>3 ★★★</option>
            <option value="4" ${(parseInt(existing?.rating, 10) || 0) === 4 ? 'selected' : ''}>4 ★★★★</option>
            <option value="5" ${(parseInt(existing?.rating, 10) || 0) === 5 ? 'selected' : ''}>5 ★★★★★</option>
          </select>
        </div>
      </div>
      <div class="form-row">
        <label>Notes</label>
        <textarea id="im-notes" placeholder="Source, purchase year, germination rate…">${escHtml(existing?.notes||'')}</textarea>
      </div>
      <input type="hidden" id="im-id" value="${existing?.id||''}">
    `;
    Modal.open('inv-modal');
    syncImageHint();
    document.getElementById('inv-modal-save').onclick = () => saveModal();
  }

  function saveModal() {
    const plantId = document.getElementById('im-plant').value;
    const qty     = parseInt(document.getElementById('im-qty').value, 10) || 0;
    const unit    = document.getElementById('im-unit').value;
    const variety = document.getElementById('im-variety').value.trim();
    const expiry  = document.getElementById('im-expiry').value;
    const notes   = document.getElementById('im-notes').value.trim();
    const imageFilename = document.getElementById('im-image-filename').value.trim();
    const germinationDaysMinRaw = parseInt(document.getElementById('im-germ-min').value, 10);
    const germinationDaysMaxRaw = parseInt(document.getElementById('im-germ-max').value, 10);
    const germinationDaysMin = Number.isFinite(germinationDaysMinRaw) ? Math.max(0, germinationDaysMinRaw) : null;
    const germinationDaysMax = Number.isFinite(germinationDaysMaxRaw)
      ? Math.max(germinationDaysMin || 0, germinationDaysMaxRaw)
      : (germinationDaysMin !== null ? germinationDaysMin : null);
    const rating = Math.max(0, Math.min(5, parseInt(document.getElementById('im-rating').value, 10) || 0));
    const sealed = document.getElementById('im-sealed').value === '1';
    const existId = document.getElementById('im-id').value;

    if (!plantId) { alert('Please select a plant.'); return; }
    if (sealed && qty === 0) { alert('A sealed packet cannot have 0 seeds. Either set a quantity or mark it as Opened.'); return; }

    const seedTag = document.getElementById('im-tag').value.trim();
    if (seedTag) {
      const duplicate = Store.getInventory().find(s => s.seedTag === seedTag && s.id !== existId);
      if (duplicate) { alert(`Seed tag "${seedTag}" is already used by another packet. Please choose a unique ID.`); return; }
    }

    const seed = {
      id:      existId || (`seed_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`),
      plantId,
      seedTag,
      imageFilename,
      germinationDaysMin,
      germinationDaysMax,
      rating,
      qty, unit, variety, expiry, notes, sealed,
    };
    Store.upsertSeed(seed);
    Modal.close('inv-modal');
    revokePickedPreview();
    render();
    Toast.show(existId ? 'Seed entry updated' : 'Seeds added to inventory');
  }

  // ── filter / search ───────────────────────────────────────────
  function onSearch(val) {
    filterSearch = val.toLowerCase();
    render();
  }

  function onFilter(val, btn) {
    filterStock = ['all', 'instock', 'low', 'none', 'new'].includes(val) ? val : 'all';
    document.querySelectorAll('#inv-filter-tabs .ftab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    render();
  }

  function onGerminationFilter(val) {
    filterGermination = ['all', 'good', 'mixed', 'poor', 'nodata'].includes(val) ? val : 'all';
    render();
  }

  function onSortChange(val) {
    sortBy = ['name-asc', 'tag-asc', 'germ-desc', 'germ-asc', 'rating-desc', 'rating-asc', 'qty-desc'].includes(val) ? val : 'name-asc';
    render();
  }

  function cloneSeed(id) {
    const seed = Store.getInventory().find(s => s.id === id);
    if (!seed) return;
    openModal({ ...seed, id: '' });
  }

  function handleImageLoad(img) {
    img.style.display = 'block';
    const fallback = img.nextElementSibling;
    if (fallback) fallback.style.display = 'none';
  }

  function handleImageError(img) {
    const sources = (img.dataset.srcList || '').split('|').filter(Boolean);
    const currentIndex = parseInt(img.dataset.srcIndex || '0', 10);

    if (currentIndex + 1 < sources.length) {
      img.dataset.srcIndex = String(currentIndex + 1);
      img.src = sources[currentIndex + 1];
      return;
    }

    img.style.display = 'none';
    const fallback = img.nextElementSibling;
    if (fallback) fallback.style.display = 'flex';
  }

  function previewImageFile(event) {
    const file = event.target.files?.[0];
    const nameEl = document.getElementById('im-image-picked-name');
    revokePickedPreview();

    if (!file) {
      pickedImageName = '';
      if (nameEl) nameEl.textContent = 'No local file picked.';
      setPreviewContent(renderModalImagePreview({
        seedTag: document.getElementById('im-tag')?.value.trim(),
        imageFilename: document.getElementById('im-image-filename')?.value.trim(),
      }));
      return;
    }

    pickedImageName = file.name;
    pickedPreviewUrl = URL.createObjectURL(file);
    if (nameEl) nameEl.textContent = file.name;
    setPreviewContent(`<div class="seed-image-preview-frame"><img class="seed-image-preview-img" src="${pickedPreviewUrl}" alt="Local seed photo preview"></div>`);
  }

  function usePickedFilename() {
    if (!pickedImageName) {
      Toast.show('Pick a local image first');
      return;
    }
    const input = document.getElementById('im-image-filename');
    if (!input) return;
    input.value = pickedImageName;
    syncImageHint();
    Toast.show(`Photo filename set to ${pickedImageName}`);
  }

  function openImageLightbox(imgEl) {
    if (!imgEl || imgEl.style.display === 'none') return;
    window.GPImageLightbox?.open(imgEl.src, imgEl.alt || 'Seed image');
  }

  return {
    render, adjustQty, setQty, deleteSeed, openNew, openNewForPlant, openEdit, openModal, onSearch, onFilter, onGerminationFilter, onSortChange, cloneSeed,
    handleImageLoad, handleImageError, previewImageFile, usePickedFilename, syncImageHint, openImageLightbox,
  };
})();
