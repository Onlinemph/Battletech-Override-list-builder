const PAGE_SIZE = 48;

const state = {
  library: {},
  roster: [],
  activeCategory: null,
  nextId: 1,
  blobUrls: new Set(),
  search: '',
  page: 0,
  groups: [],        // [{ id, name, type }] — type: 'lance' | 'star'
  activeGroupId: null,
  bvIndex: {},       // normalized unit name -> base BV
};

// Official BV2 skill multiplier table (TechManual p.315), indexed
// [gunnery][piloting], both 0–8. Verified against MegaMek's unit tests
// (4/5 → 1.00, 3/4 → 1.32, 5/6 → 0.86, 0/0 → 2.42).
const BV_SKILL_MULT = [
  [2.42, 2.31, 2.21, 2.10, 1.93, 1.75, 1.68, 1.59, 1.50],
  [2.21, 2.11, 2.02, 1.92, 1.76, 1.60, 1.54, 1.46, 1.38],
  [1.93, 1.85, 1.76, 1.68, 1.54, 1.40, 1.35, 1.28, 1.21],
  [1.66, 1.58, 1.51, 1.44, 1.32, 1.20, 1.16, 1.10, 1.04],
  [1.38, 1.32, 1.26, 1.20, 1.10, 1.00, 0.95, 0.90, 0.85],
  [1.31, 1.19, 1.13, 1.08, 0.99, 0.90, 0.86, 0.81, 0.77],
  [1.24, 1.12, 1.07, 1.02, 0.94, 0.85, 0.81, 0.77, 0.72],
  [1.17, 1.06, 1.01, 0.96, 0.88, 0.80, 0.76, 0.72, 0.68],
  [1.10, 0.99, 0.95, 0.90, 0.83, 0.75, 0.71, 0.68, 0.64],
];

function bvSkillMultiplier(gunnery, piloting) {
  const g = Math.max(0, Math.min(8, gunnery | 0));
  const p = Math.max(0, Math.min(8, piloting | 0));
  return BV_SKILL_MULT[g][p];
}

// Skill-adjusted BV for a roster entry, or null if no base BV is set.
function entryAdjustedBV(entry) {
  if (entry.baseBV == null) return null;
  return Math.round(entry.baseBV * bvSkillMultiplier(entry.gunnery, entry.piloting));
}

function normalizeUnitName(s) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Look up base BV by name. Tries the full name, then drops leading tokens
// one at a time so collection prefixes (e.g. "BTD Atlas AS7-D") still match.
function lookupBV(name) {
  const tokens = name.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const bv = state.bvIndex[normalizeUnitName(tokens.slice(i).join(''))];
    if (bv != null) return bv;
  }
  return null;
}

// Merge a { name: bv } map into the lookup index (normalizing keys).
function mergeBVData(data) {
  for (const [name, bv] of Object.entries(data)) {
    if (name.startsWith('_')) continue;          // skip _comment etc.
    const n = parseInt(bv, 10);
    if (!isNaN(n)) state.bvIndex[normalizeUnitName(name)] = n;
  }
}

let groupIdCounter = 1;
let dragSrcId = null;

function makeBlobUrl(blob) {
  const url = URL.createObjectURL(blob);
  state.blobUrls.add(url);
  return url;
}

function revokeBlobUrls() {
  for (const url of state.blobUrls) URL.revokeObjectURL(url);
  state.blobUrls.clear();
}

const VALID_EXT = /\.(png|jpg|jpeg|webp)$/i;

// ── Utilities ──────────────────────────────────────────────────────────────

function nameFromFile(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

function categoryFromPath(relPath) {
  const parts = relPath.split('/');
  return parts.length > 2 ? parts[1] : 'Uncategorized';
}

function categoryFromZipPath(relPath) {
  const parts = relPath.split('/').filter((p) => p.length > 0);
  if (parts.length === 1) return 'Uncategorized';
  if (parts.length === 2) return parts[0];
  return parts[1]; // 3+ levels: skip root folder (e.g. "images/")
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── Library loading ──────────────────────────────────────────────────────────

// Sort each category, select the first as active, and refresh the UI.
// Shared by every loader (manifest, local folder, zip).
function finalizeLibrary() {
  for (const cat of Object.keys(state.library)) {
    state.library[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  const cats = Object.keys(state.library).sort();
  state.activeCategory = cats[0] || null;
  hideStatusMsg();
  renderCategories();
  renderGrid();

  if (state.roster.length === 0 && state.groups.length === 0) {
    autoRestore();
  } else {
    // Re-resolve any entries whose image src is missing (e.g. after page reload)
    let changed = false;
    for (const entry of state.roster) {
      if (!entry.src) {
        const src = resolveEntrySrc(entry);
        if (src) { entry.src = src; changed = true; }
      }
    }
    if (changed) renderRoster();
  }
}

async function init() {
  showLoadingMsg('Loading image library…');
  try {
    const resp = await fetch('manifest.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const manifest = await resp.json();
    if (typeof manifest !== 'object' || manifest === null || Object.keys(manifest).length === 0) {
      showNoImages();
    } else {
      loadFromManifest(manifest);
    }
  } catch (e) {
    // Network error or missing file — show "no images" instructions
    showNoImages();
  }
}

function loadFromManifest(manifest) {
  state.library = {};
  for (const [cat, files] of Object.entries(manifest)) {
    if (!Array.isArray(files) || files.length === 0) continue;
    state.library[cat] = files
      .filter((f) => VALID_EXT.test(f))
      .map((f) => ({
        name: nameFromFile(f),
        src: `images/${cat}/${f}`,
      }));
  }
  finalizeLibrary();
}

// ── Local folder fallback ──────────────────────────────────────────────────

function loadLocalLibrary(files) {
  revokeBlobUrls();
  state.library = {};

  for (const file of files) {
    if (!VALID_EXT.test(file.name)) continue;
    const cat = categoryFromPath(file.webkitRelativePath);
    if (!state.library[cat]) state.library[cat] = [];
    state.library[cat].push({
      name: nameFromFile(file.name),
      src: makeBlobUrl(file),
    });
  }

  finalizeLibrary();
}

// ── Zip loader ─────────────────────────────────────────────────────────────

async function loadZip(file) {
  revokeBlobUrls();
  showLoadingMsg(`Extracting ${file.name}…`);
  try {
    const zip = await JSZip.loadAsync(file);
    state.library = {};
    const tasks = [];

    zip.forEach((relPath, entry) => {
      if (entry.dir || !VALID_EXT.test(relPath)) return;
      const parts = relPath.split('/').filter((p) => p.length > 0);
      const filename = parts[parts.length - 1];
      const cat = categoryFromZipPath(relPath);
      if (!state.library[cat]) state.library[cat] = [];

      tasks.push(
        entry.async('blob').then((blob) => {
          state.library[cat].push({
            name: nameFromFile(filename),
            src: makeBlobUrl(blob),
          });
        })
      );
    });

    await Promise.all(tasks);
    finalizeLibrary();
  } catch (err) {
    hideStatusMsg();
    alert('Failed to load zip: ' + err.message);
  }
}

// ── Status / message helpers ───────────────────────────────────────────────

function showLoadingMsg(text) {
  const el = document.getElementById('status-msg');
  el.className = 'loading-msg';
  el.textContent = text;
  el.style.display = 'block';

  const empty = document.getElementById('empty-library');
  empty.style.display = 'none';

  const noImg = document.getElementById('no-images-msg');
  if (noImg) noImg.style.display = 'none';
}

function hideStatusMsg() {
  const el = document.getElementById('status-msg');
  el.style.display = 'none';
}

function showNoImages() {
  hideStatusMsg();
  const grid = document.getElementById('mech-grid');
  grid.innerHTML = '';
  const empty = document.getElementById('empty-library');
  empty.style.display = 'none';

  const noImg = document.getElementById('no-images-msg');
  if (noImg) noImg.style.display = 'block';

  if (state.roster.length === 0 && state.groups.length === 0) {
    autoRestore();
  }
}

// ── Render ─────────────────────────────────────────────────────────────────

function renderCategories() {
  const list = document.getElementById('category-list');
  list.innerHTML = '';
  const cats = Object.keys(state.library).sort();
  cats.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn' + (cat === state.activeCategory ? ' active' : '');
    btn.textContent = cat;
    btn.addEventListener('click', () => {
      state.activeCategory = cat;
      state.page = 0;
      state.search = '';
      document.getElementById('search-input').value = '';
      renderCategories();
      renderGrid();
    });
    list.appendChild(btn);
  });
}

function filteredMechs() {
  const all = state.library[state.activeCategory] || [];
  const term = state.search.trim().toLowerCase();
  return term ? all.filter((m) => m.name.toLowerCase().includes(term)) : all;
}

function renderGrid() {
  const grid = document.getElementById('mech-grid');
  const empty = document.getElementById('empty-library');
  const pagination = document.getElementById('pagination');
  grid.innerHTML = '';

  if (Object.keys(state.library).length === 0) {
    empty.style.display = 'block';
    pagination.style.display = 'none';
    return;
  }
  empty.style.display = 'none';

  const mechs = filteredMechs();
  const totalPages = Math.max(1, Math.ceil(mechs.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages - 1);

  const start = state.page * PAGE_SIZE;
  const slice = mechs.slice(start, start + PAGE_SIZE);

  slice.forEach((mech) => {
    const thumb = document.createElement('div');
    thumb.className = 'mech-thumb';

    const img = document.createElement('img');
    img.src = mech.src;
    img.alt = mech.name;
    img.loading = 'lazy';

    const label = document.createElement('div');
    label.className = 'mech-thumb-name';
    label.textContent = mech.name;

    thumb.appendChild(img);
    thumb.appendChild(label);
    thumb.addEventListener('click', () => addToRoster(mech, state.activeCategory));
    grid.appendChild(thumb);
  });

  // Pagination controls
  if (totalPages <= 1) {
    pagination.style.display = 'none';
  } else {
    pagination.style.display = 'flex';
    document.getElementById('page-info').textContent =
      `${state.page + 1} / ${totalPages}  (${mechs.length} mechs)`;
    document.getElementById('page-prev').disabled = state.page === 0;
    document.getElementById('page-next').disabled = state.page >= totalPages - 1;
  }

  // Scroll grid back to top when page changes
  grid.parentElement.scrollTop = 0;
}

// ── Roster ─────────────────────────────────────────────────────────────────

function addToRoster(mech, category) {
  const entry = {
    id: state.nextId++,
    name: mech.name,
    category: category,
    src: mech.src,
    pilotName: '',
    gunnery: 4,
    piloting: 5,
    groupId: state.activeGroupId,
    baseBV: lookupBV(mech.name),
    bvManual: false,
  };
  state.roster.push(entry);
  renderRoster();
}

function removeFromRoster(id) {
  state.roster = state.roster.filter((e) => e.id !== id);
  renderRoster();
}

function createGroup(type) {
  const count = state.groups.filter(g => g.type === type).length;
  const lanceNames = ['Alpha','Bravo','Charlie','Delta','Echo','Foxtrot'];
  const starNames  = ['Alpha','Bravo','Charlie','Delta','Epsilon','Zeta'];
  const prefix = (type === 'lance' ? lanceNames : starNames)[count] ?? `${count + 1}`;
  const group = { id: groupIdCounter++, name: prefix + (type === 'lance' ? ' Lance' : ' Star'), type };
  state.groups.push(group);
  state.activeGroupId = group.id;
  renderRoster();
}

function deleteGroup(id) {
  state.groups = state.groups.filter(g => g.id !== id);
  state.roster = state.roster.filter(e => e.groupId !== id);
  if (state.activeGroupId === id) state.activeGroupId = state.groups.at(-1)?.id ?? null;
  renderRoster();
}

function groupAdjustedTotal(groupId) {
  return state.roster
    .filter((e) => e.groupId === groupId)
    .reduce((sum, e) => sum + (entryAdjustedBV(e) || 0), 0);
}

// Refresh the grand-total and per-group BV readouts in place (no full re-render).
function updateTotals() {
  const grand = state.roster.reduce((sum, e) => sum + (entryAdjustedBV(e) || 0), 0);
  document.getElementById('roster-bv-total').textContent = 'BV ' + grand.toLocaleString();
  state.groups.forEach((g) => {
    const el = document.querySelector(`.group-bv[data-group-id="${g.id}"]`);
    if (el) el.textContent = 'BV ' + groupAdjustedTotal(g.id).toLocaleString();
  });
}

function renderRoster() {
  const list  = document.getElementById('roster-list');
  const empty = document.getElementById('empty-roster');
  const count = document.getElementById('roster-count');

  count.textContent = state.roster.length + ' mech' + (state.roster.length !== 1 ? 's' : '');

  // Remove only dynamic children — leave #empty-roster in the DOM
  list.querySelectorAll('.group-section, .ungrouped-cards').forEach(el => el.remove());

  if (state.roster.length === 0 && state.groups.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Render each group section
  state.groups.forEach(group => {
    const mechs = state.roster.filter(e => e.groupId === group.id);
    list.appendChild(buildGroupSection(group, mechs));
  });

  // Render ungrouped mechs
  const ungrouped = state.roster.filter(e => !e.groupId);
  if (ungrouped.length > 0) {
    const div = document.createElement('div');
    div.className = 'ungrouped-cards';
    ungrouped.forEach(entry => div.appendChild(buildCard(entry)));
    list.appendChild(div);
  }

  // Ungroup drop zone — only shown when groups exist
  if (state.groups.length > 0) {
    const zone = document.createElement('div');
    zone.className = 'ungroup-zone';
    zone.textContent = 'Drop here to ungroup';
    zone.addEventListener('dragover', (e) => {
      if (!dragSrcId) return;
      e.preventDefault();
      zone.classList.add('active');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('active'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('active');
      if (!dragSrcId) return;
      moveEntry(dragSrcId, null, false, null);
      dragSrcId = null;
      renderRoster();
    });
    list.appendChild(zone);
  }

  updateTotals();
  autoSave();
}

function buildGroupSection(group, mechs) {
  const isActive = group.id === state.activeGroupId;

  const section = document.createElement('div');
  section.className = 'group-section' + (isActive ? ' active' : '');
  section.dataset.id = group.id;

  const header = document.createElement('div');
  header.className = 'group-header';
  header.title = 'Click to make active — new mechs go here';
  header.addEventListener('click', e => {
    if (e.target.closest('.group-delete')) return;
    state.activeGroupId = group.id;
    renderRoster();
  });
  header.addEventListener('dragover', (e) => {
    if (!dragSrcId) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    section.classList.add('drag-over-group');
  });
  header.addEventListener('dragleave', (e) => {
    if (!header.contains(e.relatedTarget)) section.classList.remove('drag-over-group');
  });
  header.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragSrcId) return;
    section.classList.remove('drag-over-group');
    moveEntry(dragSrcId, null, false, group.id);
    dragSrcId = null;
    renderRoster();
  });

  const badge = document.createElement('span');
  badge.className = 'group-type-badge ' + group.type;
  badge.textContent = group.type.toUpperCase();

  const nameInput = document.createElement('input');
  nameInput.className = 'group-name-input';
  nameInput.value = group.name;
  nameInput.addEventListener('click', e => e.stopPropagation());
  nameInput.addEventListener('input', e => { group.name = e.target.value; });

  const countSpan = document.createElement('span');
  countSpan.className = 'group-count';
  countSpan.textContent = mechs.length;

  const bvSpan = document.createElement('span');
  bvSpan.className = 'group-bv';
  bvSpan.dataset.groupId = group.id;
  bvSpan.title = 'Skill-adjusted BV for this group';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'group-delete';
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Delete group and its mechs';
  deleteBtn.addEventListener('click', () => deleteGroup(group.id));

  header.append(badge, nameInput, countSpan, bvSpan, deleteBtn);

  const cards = document.createElement('div');
  cards.className = 'group-cards';
  mechs.forEach(entry => cards.appendChild(buildCard(entry)));

  section.append(header, cards);
  return section;
}

function buildCard(entry) {
  const card = document.createElement('div');
  card.className = 'roster-card';
  card.dataset.id = entry.id;

  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    dragSrcId = entry.id;
    e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => card.classList.add('drag-source'));
  });
  card.addEventListener('dragend', () => {
    clearDropIndicators();
    document.querySelectorAll('.drag-source').forEach(el => el.classList.remove('drag-source'));
    dragSrcId = null;
  });
  card.addEventListener('dragover', (e) => {
    if (!dragSrcId || dragSrcId === entry.id) return;
    e.preventDefault();
    e.stopPropagation();
    clearDropIndicators();
    const mid = card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2;
    card.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
  });
  card.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragSrcId || dragSrcId === entry.id) return;
    const rect = card.getBoundingClientRect();
    const targetEntry = state.roster.find(en => en.id === entry.id);
    moveEntry(dragSrcId, entry.id, e.clientY < rect.top + rect.height / 2, targetEntry?.groupId ?? null);
    dragSrcId = null;
    renderRoster();
  });

  const header = document.createElement('div');
  header.className = 'card-header';

  const mechName = document.createElement('div');
  mechName.className = 'card-mech-name';
  mechName.textContent = entry.name;

  const removeBtn = document.createElement('button');
  removeBtn.className = 'card-remove';
  removeBtn.textContent = '×';
  removeBtn.title = 'Remove';
  removeBtn.addEventListener('click', () => removeFromRoster(entry.id));

  header.appendChild(mechName);
  header.appendChild(removeBtn);

  const imgWrap = document.createElement('div');
  imgWrap.className = 'card-image';
  const img = document.createElement('img');
  img.src = entry.src;
  img.alt = entry.name;
  imgWrap.appendChild(img);

  const info = document.createElement('div');
  info.className = 'card-info';

  const pilotField = document.createElement('div');
  pilotField.className = 'card-field';
  const pilotLabel = document.createElement('label');
  pilotLabel.textContent = 'Pilot';
  const pilotInput = document.createElement('input');
  pilotInput.type = 'text';
  pilotInput.placeholder = 'Pilot name';
  pilotInput.value = entry.pilotName;
  pilotInput.addEventListener('input', (e) => { entry.pilotName = e.target.value; });
  pilotField.appendChild(pilotLabel);
  pilotField.appendChild(pilotInput);

  // BV row: editable base BV + computed skill-adjusted BV
  const bvRow = document.createElement('div');
  bvRow.className = 'card-bv';

  const bvLabel = document.createElement('label');
  bvLabel.textContent = 'BV';

  const bvInput = document.createElement('input');
  bvInput.type = 'number';
  bvInput.min = 0;
  bvInput.placeholder = '—';
  bvInput.title = 'Base Battle Value';
  if (entry.baseBV != null) bvInput.value = entry.baseBV;

  const adjustedSpan = document.createElement('span');
  adjustedSpan.className = 'card-bv-adjusted';

  const refreshBV = () => {
    const adj = entryAdjustedBV(entry);
    adjustedSpan.textContent = adj != null ? '= ' + adj.toLocaleString() : '';
    updateTotals();
  };

  bvInput.addEventListener('input', (e) => {
    const v = parseInt(e.target.value, 10);
    entry.baseBV = isNaN(v) ? null : v;
    entry.bvManual = true;
    refreshBV();
  });

  bvRow.append(bvLabel, bvInput, adjustedSpan);
  refreshBV();

  const skillsRow = document.createElement('div');
  skillsRow.className = 'card-skills';

  skillsRow.appendChild(makeSkillPair('GUN', entry, 'gunnery', refreshBV));
  skillsRow.appendChild(makeSkillPair('PIL', entry, 'piloting', refreshBV));

  const catTag = document.createElement('div');
  catTag.className = 'card-category';
  catTag.textContent = entry.category;

  info.appendChild(pilotField);
  info.appendChild(skillsRow);
  info.appendChild(bvRow);
  info.appendChild(catTag);

  card.appendChild(header);
  card.appendChild(imgWrap);
  card.appendChild(info);

  return card;
}

function makeSkillPair(labelText, entry, key, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'skill-pair';

  const lbl = document.createElement('label');
  lbl.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'number';
  input.min = 0;
  input.max = 8;
  input.value = entry[key];
  input.addEventListener('input', (e) => {
    let v = parseInt(e.target.value, 10);
    if (isNaN(v)) v = 0;
    v = Math.max(0, Math.min(8, v));
    entry[key] = v;
    e.target.value = v;
    if (onChange) onChange();
  });

  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return wrap;
}

// ── Drag and drop ────────────────────────────────────────────────────────

function clearDropIndicators() {
  document.querySelectorAll('.drag-over-top, .drag-over-bottom, .drag-over-group')
    .forEach(el => el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-group'));
}

function moveEntry(draggedId, targetId, insertBefore, newGroupId) {
  const idx = state.roster.findIndex(e => e.id === draggedId);
  if (idx === -1) return;
  const [dragged] = state.roster.splice(idx, 1);
  dragged.groupId = newGroupId;
  if (targetId == null) { state.roster.push(dragged); return; }
  let tIdx = state.roster.findIndex(e => e.id === targetId);
  if (tIdx === -1) { state.roster.push(dragged); return; }
  state.roster.splice(insertBefore ? tIdx : tIdx + 1, 0, dragged);
}

// ── Roster Save / Load ────────────────────────────────────────────────────

function serializeRoster() {
  return {
    version: 1,
    groups: state.groups.map(g => ({ id: g.id, name: g.name, type: g.type })),
    roster: state.roster.map(e => ({
      id: e.id,
      name: e.name,
      category: e.category,
      pilotName: e.pilotName,
      gunnery: e.gunnery,
      piloting: e.piloting,
      groupId: e.groupId,
      baseBV: e.baseBV,
      bvManual: e.bvManual,
    })),
  };
}

function saveRoster() {
  if (state.roster.length === 0 && state.groups.length === 0) {
    alert('Roster is empty — nothing to save.');
    return;
  }
  const blob = new Blob([JSON.stringify(serializeRoster(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'battletech-roster.json';
  a.click();
  URL.revokeObjectURL(url);
}

// Try to find the image source for a roster entry in the current library.
function resolveEntrySrc(entry) {
  const candidates = entry.category
    ? [state.library[entry.category], ...Object.values(state.library).filter(c => c !== state.library[entry.category])]
    : Object.values(state.library);
  for (const items of candidates) {
    if (!items) continue;
    const match = items.find(m => m.name === entry.name);
    if (match) return match.src;
  }
  return '';
}

function restoreRoster(data) {
  if (!data || data.version !== 1) return false;
  const idMap = {};
  state.groups = (data.groups || []).map(g => {
    const newId = groupIdCounter++;
    idMap[g.id] = newId;
    return { id: newId, name: g.name, type: g.type };
  });
  state.activeGroupId = state.groups.at(-1)?.id ?? null;
  state.roster = (data.roster || []).map(e => ({
    id: state.nextId++,
    name: e.name,
    category: e.category,
    src: resolveEntrySrc(e),
    pilotName: e.pilotName || '',
    gunnery: e.gunnery ?? 4,
    piloting: e.piloting ?? 5,
    groupId: e.groupId != null ? (idMap[e.groupId] ?? null) : null,
    baseBV: e.baseBV ?? null,
    bvManual: e.bvManual ?? false,
  }));
  renderRoster();
  return true;
}

async function loadRosterFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!restoreRoster(data)) {
      alert('Unrecognised roster file format.');
      return;
    }
    const missing = state.roster.filter(e => !e.src).length;
    if (missing > 0) {
      alert(`Roster loaded. ${missing} image${missing !== 1 ? 's' : ''} not found in the current library — load the image library to restore them.`);
    }
  } catch (err) {
    alert('Failed to load roster: ' + err.message);
  }
}

function autoSave() {
  const save = () => {
    try { localStorage.setItem('btRosterSave', JSON.stringify(serializeRoster())); } catch (e) {}
  };
  typeof requestIdleCallback !== 'undefined' ? requestIdleCallback(save) : setTimeout(save, 0);
}

function autoRestore() {
  try {
    const raw = localStorage.getItem('btRosterSave');
    if (!raw) return;
    const data = JSON.parse(raw);
    if ((data.roster || []).length > 0 || (data.groups || []).length > 0) {
      restoreRoster(data);
    }
  } catch (e) {}
}

// ── PDF Export ─────────────────────────────────────────────────────────────

function addSummaryPage(doc) {
  const PW = 792, PH = 612, M = 36;
  const ROW_H = 13;
  const PAGE_BOTTOM = PH - M;
  const C = { unit: M + 4, pilot: M + 290, gun: M + 460, pil: M + 510, bvBase: M + 625, bvAdj: PW - M };
  const grand = state.roster.reduce((s, e) => s + (entryAdjustedBV(e) || 0), 0);

  doc.addPage();

  function drawPageBg() {
    doc.setFillColor(26, 26, 26);
    doc.rect(0, 0, PW, PH, 'F');
  }

  function drawColHeaders() {
    doc.setFillColor(35, 28, 10);
    doc.rect(M, y, PW - 2 * M, ROW_H, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 105, 50);
    doc.text('UNIT', C.unit, y + 9);
    doc.text('PILOT', C.pilot, y + 9);
    doc.text('GUN', C.gun, y + 9, { align: 'center' });
    doc.text('PIL', C.pil, y + 9, { align: 'center' });
    doc.text('BASE BV', C.bvBase, y + 9, { align: 'right' });
    doc.text('ADJ BV', C.bvAdj, y + 9, { align: 'right' });
    y += ROW_H;
    doc.setDrawColor(60, 48, 20);
    doc.setLineWidth(0.3);
    doc.line(M, y, PW - M, y);
    y += 3;
  }

  drawPageBg();
  let y = M;

  // Title row
  doc.setFont('courier', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(201, 168, 76);
  doc.text('FORCE SUMMARY', M, y + 12);
  doc.setFontSize(10);
  doc.setTextColor(140, 120, 70);
  doc.text(`${state.roster.length} UNIT${state.roster.length !== 1 ? 'S' : ''}  ·  TOTAL BV ${grand.toLocaleString()}`, PW - M, y + 12, { align: 'right' });
  doc.setDrawColor(80, 65, 30);
  doc.setLineWidth(0.5);
  doc.line(M, y + 18, PW - M, y + 18);
  y += 30;

  drawColHeaders();

  let rowIdx = 0;

  function checkPageBreak(neededH) {
    if (y + neededH > PAGE_BOTTOM) {
      doc.addPage();
      drawPageBg();
      y = M;
      drawColHeaders();
      rowIdx = 0;
    }
  }

  function drawMechRow(entry) {
    checkPageBreak(ROW_H);
    if (rowIdx % 2 === 0) {
      doc.setFillColor(32, 32, 32);
      doc.rect(M, y, PW - 2 * M, ROW_H, 'F');
    }
    doc.setFont('courier', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(210, 200, 175);
    const uName = entry.name.length > 32 ? entry.name.substring(0, 31) + '…' : entry.name;
    doc.text(uName.toUpperCase(), C.unit, y + 9);
    doc.setTextColor(160, 150, 130);
    const pilot = (entry.pilotName || '—').substring(0, 22);
    doc.text(pilot, C.pilot, y + 9);
    doc.setFont('courier', 'bold');
    doc.setTextColor(201, 168, 76);
    doc.text(String(entry.gunnery), C.gun, y + 9, { align: 'center' });
    doc.text(String(entry.piloting), C.pil, y + 9, { align: 'center' });
    doc.setFont('courier', 'normal');
    doc.setTextColor(160, 150, 130);
    doc.text(entry.baseBV != null ? entry.baseBV.toLocaleString() : '—', C.bvBase, y + 9, { align: 'right' });
    doc.setFont('courier', 'bold');
    doc.setTextColor(201, 168, 76);
    const adj = entryAdjustedBV(entry);
    doc.text(adj != null ? adj.toLocaleString() : '—', C.bvAdj, y + 9, { align: 'right' });
    y += ROW_H;
    rowIdx++;
  }

  for (const group of state.groups) {
    const mechs = state.roster.filter(e => e.groupId === group.id);
    if (mechs.length === 0) continue;

    checkPageBreak(ROW_H * 2 + 4);
    const isLance = group.type === 'lance';
    doc.setFillColor(isLance ? 28 : 32, isLance ? 38 : 22, isLance ? 12 : 8);
    doc.rect(M, y, PW - 2 * M, ROW_H, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    if (isLance) doc.setTextColor(154, 191, 85);
    else doc.setTextColor(201, 168, 76);
    doc.text(group.name.toUpperCase(), C.unit, y + 9);
    y += ROW_H;
    rowIdx = 0;

    mechs.forEach(drawMechRow);

    checkPageBreak(ROW_H + 4);
    doc.setFillColor(38, 30, 10);
    doc.rect(M, y, PW - 2 * M, ROW_H, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 105, 50);
    doc.text(group.name.toUpperCase() + '  SUBTOTAL', C.pilot, y + 9);
    doc.setTextColor(201, 168, 76);
    doc.text(groupAdjustedTotal(group.id).toLocaleString(), C.bvAdj, y + 9, { align: 'right' });
    y += ROW_H + 4;
    rowIdx = 0;
  }

  const ungrouped = state.roster.filter(e => !e.groupId);
  if (ungrouped.length > 0) {
    checkPageBreak(ROW_H * 2);
    doc.setFillColor(32, 32, 32);
    doc.rect(M, y, PW - 2 * M, ROW_H, 'F');
    doc.setFont('courier', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(150, 140, 120);
    doc.text('UNGROUPED', C.unit, y + 9);
    y += ROW_H;
    rowIdx = 0;
    ungrouped.forEach(drawMechRow);
    y += 4;
  }

  // Grand total
  checkPageBreak(ROW_H + 8);
  doc.setFillColor(45, 35, 12);
  doc.rect(M, y, PW - 2 * M, ROW_H + 4, 'F');
  doc.setDrawColor(100, 80, 40);
  doc.setLineWidth(0.5);
  doc.line(M, y, PW - M, y);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(201, 168, 76);
  doc.text('GRAND TOTAL', C.pilot, y + ROW_H * 0.72 + 2);
  doc.text(grand.toLocaleString(), C.bvAdj, y + ROW_H * 0.72 + 2, { align: 'right' });
}

async function renderCardCanvas(entry) {
  // Canvas sized at ~1.4:1 to match Override card proportions
  const CANVAS_W = 1200;
  const CANVAS_H = 857;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#e8e4dc';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // Draw image contained within canvas
  const img = await loadImage(entry.src);
  let ix = 0, iy = 0, iw = CANVAS_W, ih = CANVAS_H;
  if (img) {
    const scale = Math.min(CANVAS_W / img.naturalWidth, CANVAS_H / img.naturalHeight);
    iw = img.naturalWidth * scale;
    ih = img.naturalHeight * scale;
    ix = (CANVAS_W - iw) / 2;
    iy = (CANVAS_H - ih) / 2;
    ctx.drawImage(img, ix, iy, iw, ih);
  }

  // Overlay GUN and PIL numbers in the stat boxes.
  // Positions are calibrated for the standard BattleTech Override card layout
  // (Gunnery/Piloting boxes sit in the top-right of the card).
  const boxW  = iw * 0.054;
  const boxH  = ih * 0.065;
  const boxY  = iy + ih * 0.050;
  const gunX  = ix + iw * 0.555;
  const pilX  = ix + iw * 0.643;

  function drawStatBox(x, y, value) {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeRect(x, y, boxW, boxH);
    ctx.fillStyle = '#000';
    ctx.font = `bold ${Math.round(boxH * 0.68)}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x + boxW / 2, y + boxH / 2 + 1);
  }

  drawStatBox(gunX, boxY, entry.gunnery);
  drawStatBox(pilX, boxY, entry.piloting);

  // Pilot name just below the stat boxes
  if (entry.pilotName) {
    const fontSize   = Math.round(ih * 0.038);
    const nameY      = boxY + boxH + ih * 0.010;
    const nameCenterX = (gunX + pilX + boxW) / 2;
    ctx.font = `bold ${fontSize}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const tw = ctx.measureText(entry.pilotName).width;
    ctx.fillStyle = 'rgba(10,8,4,0.70)';
    ctx.fillRect(nameCenterX - tw / 2 - 6, nameY - 2, tw + 12, fontSize + 6);
    ctx.fillStyle = '#fff';
    ctx.fillText(entry.pilotName, nameCenterX, nameY);
  }

  // Adjusted BV — top-left of image
  const adjBV = entryAdjustedBV(entry);
  if (adjBV != null) {
    const bvText = 'BV ' + adjBV.toLocaleString();
    const bvSize = Math.round(ih * 0.040);
    ctx.font = `bold ${bvSize}px "Courier New", monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const bw = ctx.measureText(bvText).width;
    const bx = ix + iw * 0.02;
    const by = iy + ih * 0.02;
    ctx.fillStyle = 'rgba(10,8,4,0.78)';
    ctx.fillRect(bx - 5, by - 3, bw + 10, bvSize + 8);
    ctx.fillStyle = '#c9a84c';
    ctx.fillText(bvText, bx, by);
  }

  // Group label — bottom-left of image
  const group = state.groups.find(g => g.id === entry.groupId);
  if (group) {
    const labelText  = group.name.toUpperCase();
    const labelSize  = Math.round(ih * 0.038);
    ctx.font = `bold ${labelSize}px "Courier New", monospace`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'bottom';
    const lw = ctx.measureText(labelText).width;
    const lx = ix + iw * 0.02;
    const ly = iy + ih * 0.97;
    ctx.fillStyle = group.type === 'lance' ? 'rgba(35,50,15,0.82)' : 'rgba(55,40,8,0.82)';
    ctx.fillRect(lx - 5, ly - labelSize - 3, lw + 10, labelSize + 8);
    ctx.fillStyle = group.type === 'lance' ? '#9abf55' : '#c9a84c';
    ctx.fillText(labelText, lx, ly);
  }

  return canvas;
}

async function exportPDF() {
  if (state.roster.length === 0) {
    alert('Roster is empty — add some mechs first.');
    return;
  }

  const btn = document.getElementById('export-btn');
  btn.disabled = true;
  btn.textContent = 'Generating PDF…';

  try {
    const ordered = [
      ...state.groups.flatMap(g => state.roster.filter(e => e.groupId === g.id)),
      ...state.roster.filter(e => !e.groupId),
    ];
    const canvases = await Promise.all(ordered.map(renderCardCanvas));

    const { jsPDF } = window.jspdf;
    // Landscape letter, 2×2 grid — each slot is ~368×278pt (1.32:1),
    // closely matching Override card proportions. 4 cards per page.
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'landscape' });

    const PAGE_W = 792;
    const PAGE_H = 612;
    const MARGIN = 24;
    const GAP = 8;
    const COLS = 2;
    const ROWS = 2;
    const CARD_W = (PAGE_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
    const CARD_H = (PAGE_H - MARGIN * 2 - GAP * (ROWS - 1)) / ROWS;

    canvases.forEach((canvas, idx) => {
      const pos = idx % (COLS * ROWS);
      if (pos === 0 && idx > 0) doc.addPage();
      const col = pos % COLS;
      const row = Math.floor(pos / COLS);
      const x = MARGIN + col * (CARD_W + GAP);
      const y = MARGIN + row * (CARD_H + GAP);
      doc.addImage(canvas, 'PNG', x, y, CARD_W, CARD_H, '', 'FAST');
    });

    addSummaryPage(doc);
    doc.save('battletech-roster.pdf');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export PDF';
  }
}

// ── Battle Value data ────────────────────────────────────────────────────────

async function loadBVData() {
  try {
    const resp = await fetch('bv-data.json');
    if (resp.ok) mergeBVData(await resp.json());
  } catch (e) {
    // No bundled table — that's fine; user can import one or enter BV manually.
  }
}

// Accepts a { name: bv } JSON object or CSV with a name column and a BV column.
function parseBVTable(text, filename) {
  text = text.trim();
  if (filename.toLowerCase().endsWith('.json') || text.startsWith('{')) {
    return JSON.parse(text);
  }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const idx = line.lastIndexOf(',');        // BV is the last comma-separated field
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim().replace(/^"|"$/g, '');
    const bv = parseInt(line.slice(idx + 1).trim(), 10);
    if (name && !isNaN(bv)) out[name] = bv;
  }
  return out;
}

async function loadBVTable(file) {
  try {
    const text = await file.text();
    const before = Object.keys(state.bvIndex).length;
    mergeBVData(parseBVTable(text, file.name));
    const added = Object.keys(state.bvIndex).length - before;

    // Re-attempt lookup for entries the user hasn't manually overridden.
    let matched = 0;
    for (const entry of state.roster) {
      if (entry.bvManual) continue;
      const bv = lookupBV(entry.name);
      if (bv != null) { entry.baseBV = bv; matched++; }
    }
    renderRoster();
    alert(`BV table loaded: ${added} entries. Matched ${matched} roster mech${matched !== 1 ? 's' : ''}.`);
  } catch (err) {
    alert('Failed to load BV table: ' + err.message);
  }
}

// ── Event listeners ────────────────────────────────────────────────────────

document.getElementById('search-input').addEventListener('input', (e) => {
  state.search = e.target.value;
  state.page = 0;
  renderGrid();
});

document.getElementById('page-prev').addEventListener('click', () => {
  if (state.page > 0) { state.page--; renderGrid(); }
});

document.getElementById('page-next').addEventListener('click', () => {
  state.page++;
  renderGrid();
});

document.getElementById('zip-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadZip(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('folder-input').addEventListener('change', (e) => {
  loadLocalLibrary(Array.from(e.target.files));
  e.target.value = '';
});

document.getElementById('bv-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadBVTable(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('export-btn').addEventListener('click', exportPDF);
document.getElementById('save-roster-btn').addEventListener('click', saveRoster);
document.getElementById('roster-input').addEventListener('change', (e) => {
  if (e.target.files[0]) loadRosterFile(e.target.files[0]);
  e.target.value = '';
});

document.getElementById('new-lance-btn').addEventListener('click', () => createGroup('lance'));
document.getElementById('new-star-btn').addEventListener('click', () => createGroup('star'));

// ── Boot ───────────────────────────────────────────────────────────────────

renderRoster();
loadBVData();
init();
