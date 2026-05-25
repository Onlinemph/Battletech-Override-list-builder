const PAGE_SIZE = 48;

const state = {
  library: {},
  roster: [],
  activeCategory: null,
  nextId: 1,
  blobUrls: new Set(),
  search: '',
  page: 0,
};

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

function mimeFromFilename(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/png';
}

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// ── Manifest / init ────────────────────────────────────────────────────────

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
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const cats = Object.keys(state.library).sort();
  state.activeCategory = cats[0] || null;
  hideStatusMsg();
  renderCategories();
  renderGrid();
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

  for (const cat of Object.keys(state.library)) {
    state.library[cat].sort((a, b) => a.name.localeCompare(b.name));
  }
  const cats = Object.keys(state.library).sort();
  state.activeCategory = cats[0] || null;
  hideStatusMsg();
  renderCategories();
  renderGrid();
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

    for (const cat of Object.keys(state.library)) {
      state.library[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    const cats = Object.keys(state.library).sort();
    state.activeCategory = cats[0] || null;
    hideStatusMsg();
    renderCategories();
    renderGrid();
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
  };
  state.roster.push(entry);
  renderRoster();
}

function removeFromRoster(id) {
  state.roster = state.roster.filter((e) => e.id !== id);
  renderRoster();
}

function renderRoster() {
  const list = document.getElementById('roster-list');
  const empty = document.getElementById('empty-roster');
  const count = document.getElementById('roster-count');

  count.textContent = state.roster.length + ' mech' + (state.roster.length !== 1 ? 's' : '');

  const existing = {};
  list.querySelectorAll('.roster-card').forEach((el) => {
    existing[el.dataset.id] = el;
  });

  const currentIds = new Set(state.roster.map((e) => String(e.id)));

  Object.keys(existing).forEach((id) => {
    if (!currentIds.has(id)) existing[id].remove();
  });

  if (state.roster.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  state.roster.forEach((entry) => {
    if (existing[entry.id]) return;
    const card = buildCard(entry);
    list.appendChild(card);
  });
}

function buildCard(entry) {
  const card = document.createElement('div');
  card.className = 'roster-card';
  card.dataset.id = entry.id;

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

  const skillsRow = document.createElement('div');
  skillsRow.className = 'card-skills';

  skillsRow.appendChild(makeSkillPair('GUN', entry, 'gunnery'));
  skillsRow.appendChild(makeSkillPair('PIL', entry, 'piloting'));

  const catTag = document.createElement('div');
  catTag.className = 'card-category';
  catTag.textContent = entry.category;

  info.appendChild(pilotField);
  info.appendChild(skillsRow);
  info.appendChild(catTag);

  card.appendChild(header);
  card.appendChild(imgWrap);
  card.appendChild(info);

  return card;
}

function makeSkillPair(labelText, entry, key) {
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
  });

  wrap.appendChild(lbl);
  wrap.appendChild(input);
  return wrap;
}

// ── PDF Export ─────────────────────────────────────────────────────────────

async function renderCardCanvas(entry) {
  const W = 600;
  const H = 800;
  const INFO_H = 180;
  const IMG_H = H - INFO_H;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#120e06';
  ctx.fillRect(0, 0, W, H);

  // Mech image — fit within image area maintaining aspect ratio
  const img = await loadImage(entry.src);
  if (img) {
    const scale = Math.min(W / img.width, IMG_H / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (IMG_H - dh) / 2, dw, dh);
  }

  // Gradient fade into info bar
  const grad = ctx.createLinearGradient(0, IMG_H - 100, 0, IMG_H);
  grad.addColorStop(0, 'rgba(18,14,6,0)');
  grad.addColorStop(1, 'rgba(18,14,6,1)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, IMG_H - 100, W, 100);

  // Info bar
  ctx.fillStyle = '#120e06';
  ctx.fillRect(0, IMG_H, W, INFO_H);

  // Gold separator line
  ctx.strokeStyle = '#8a6e28';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, IMG_H + 1);
  ctx.lineTo(W - 20, IMG_H + 1);
  ctx.stroke();

  // Mech name
  ctx.fillStyle = '#c9a84c';
  ctx.font = 'bold 34px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(entry.name.toUpperCase(), W / 2, IMG_H + 50);

  // Pilot name
  ctx.fillStyle = '#d4c9a8';
  ctx.font = '26px "Courier New", monospace';
  ctx.fillText(entry.pilotName || '—', W / 2, IMG_H + 90);

  // Skills
  ctx.font = 'bold 30px "Courier New", monospace';
  ctx.fillStyle = '#c9a84c';
  ctx.textAlign = 'left';
  ctx.fillText('GUN: ' + entry.gunnery, 40, IMG_H + 145);
  ctx.textAlign = 'right';
  ctx.fillText('PIL: ' + entry.piloting, W - 40, IMG_H + 145);

  // Border
  ctx.strokeStyle = '#8a6e28';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, W - 4, H - 4);

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
    // Render all cards in parallel
    const canvases = await Promise.all(state.roster.map(renderCardCanvas));

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });

    const PAGE_W = 612;
    const PAGE_H = 792;
    const MARGIN = 30;
    const GAP = 10;
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

    doc.save('battletech-roster.pdf');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export PDF';
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

document.getElementById('export-btn').addEventListener('click', exportPDF);

// ── Boot ───────────────────────────────────────────────────────────────────

renderRoster();
init();
