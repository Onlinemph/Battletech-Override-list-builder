const state = {
  library: {},
  roster: [],
  activeCategory: null,
  nextId: 1,
};

const VALID_EXT = /\.(png|jpg|jpeg|webp)$/i;

function nameFromFile(filename) {
  return filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
}

function categoryFromPath(relPath) {
  const parts = relPath.split('/');
  return parts.length > 2 ? parts[1] : 'Uncategorized';
}

function loadLibrary(files) {
  state.library = {};
  const readers = [];

  for (const file of files) {
    if (!VALID_EXT.test(file.name)) continue;
    const cat = categoryFromPath(file.webkitRelativePath);
    if (!state.library[cat]) state.library[cat] = [];

    const p = new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        state.library[cat].push({
          name: nameFromFile(file.name),
          dataUrl: e.target.result,
        });
        resolve();
      };
      reader.readAsDataURL(file);
    });
    readers.push(p);
  }

  Promise.all(readers).then(() => {
    for (const cat of Object.keys(state.library)) {
      state.library[cat].sort((a, b) => a.name.localeCompare(b.name));
    }
    const cats = Object.keys(state.library).sort();
    state.activeCategory = cats[0] || null;
    renderCategories();
    renderGrid();
  });
}

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
      renderCategories();
      renderGrid();
    });
    list.appendChild(btn);
  });
}

function renderGrid() {
  const grid = document.getElementById('mech-grid');
  const empty = document.getElementById('empty-library');
  grid.innerHTML = '';

  const cats = Object.keys(state.library);
  if (cats.length === 0) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const mechs = state.library[state.activeCategory] || [];
  mechs.forEach((mech) => {
    const thumb = document.createElement('div');
    thumb.className = 'mech-thumb';

    const img = document.createElement('img');
    img.src = mech.dataUrl;
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
}

function addToRoster(mech, category) {
  const entry = {
    id: state.nextId++,
    name: mech.name,
    category: category,
    dataUrl: mech.dataUrl,
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
  img.src = entry.dataUrl;
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

function exportPDF() {
  if (state.roster.length === 0) {
    alert('Roster is empty — add some mechs first.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait' });

  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 36;
  const GAP = 6;
  const COLS = 3;
  const ROWS = 3;

  const CARD_W = (PAGE_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
  const CARD_H = (PAGE_H - MARGIN * 2 - GAP * (ROWS - 1)) / ROWS;

  const HEADER_H = 22;
  const INFO_H = 54;
  const IMG_H = CARD_H - HEADER_H - INFO_H;

  const BROWN = [59, 34, 8];
  const GOLD_TEXT = [201, 168, 76];
  const TAN_BG = [212, 201, 168];
  const BORDER_COLOR = [90, 73, 40];
  const DARK_INFO = [30, 30, 30];
  const TAN_TEXT = [168, 159, 130];
  const DIM_TEXT = [120, 110, 90];

  state.roster.forEach((entry, idx) => {
    const page = Math.floor(idx / (COLS * ROWS));
    const pos = idx % (COLS * ROWS);
    const col = pos % COLS;
    const row = Math.floor(pos / COLS);

    if (pos === 0 && idx > 0) doc.addPage();

    const x = MARGIN + col * (CARD_W + GAP);
    const y = MARGIN + row * (CARD_H + GAP);

    doc.setFillColor(...TAN_BG);
    doc.roundedRect(x, y, CARD_W, CARD_H, 4, 4, 'F');

    doc.setDrawColor(...BORDER_COLOR);
    doc.setLineWidth(1);
    doc.roundedRect(x, y, CARD_W, CARD_H, 4, 4, 'S');

    doc.setFillColor(...BROWN);
    doc.roundedRect(x, y, CARD_W, HEADER_H, 4, 4, 'F');
    doc.setFillColor(...BROWN);
    doc.rect(x, y + HEADER_H - 4, CARD_W, 4, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GOLD_TEXT);
    const mechLabel = entry.name.toUpperCase();
    const labelW = doc.getTextWidth(mechLabel);
    const maxW = CARD_W - 10;
    if (labelW > maxW) {
      doc.setFontSize(7);
    }
    doc.text(mechLabel, x + CARD_W / 2, y + HEADER_H - 7, { align: 'center' });
    doc.setFontSize(9);

    try {
      const fmt = entry.dataUrl.split(';')[0].split('/')[1].toUpperCase();
      const safeFormat = ['PNG', 'JPEG', 'JPG', 'WEBP'].includes(fmt) ? fmt : 'PNG';
      doc.addImage(entry.dataUrl, safeFormat, x + 2, y + HEADER_H, CARD_W - 4, IMG_H, undefined, 'FAST');
    } catch (e) {
      doc.setFillColor(30, 30, 30);
      doc.rect(x + 2, y + HEADER_H, CARD_W - 4, IMG_H, 'F');
    }

    const infoY = y + HEADER_H + IMG_H;
    doc.setFillColor(...DARK_INFO);
    doc.rect(x, infoY, CARD_W, INFO_H, 'F');
    doc.setFillColor(...BORDER_COLOR);
    doc.rect(x, infoY, CARD_W, 1, 'F');

    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...TAN_TEXT);
    const pilotDisplay = entry.pilotName || '—';
    doc.text('PILOT: ' + pilotDisplay, x + 6, infoY + 13);

    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GOLD_TEXT);
    doc.text('GUN: ' + entry.gunnery, x + 6, infoY + 28);
    doc.text('PIL: ' + entry.piloting, x + CARD_W / 2 + 2, infoY + 28);

    doc.setFont('courier', 'italic');
    doc.setFontSize(7);
    doc.setTextColor(...DIM_TEXT);
    doc.text(entry.category, x + CARD_W - 6, infoY + INFO_H - 7, { align: 'right' });
  });

  doc.save('battletech-roster.pdf');
}

document.getElementById('folder-input').addEventListener('change', (e) => {
  loadLibrary(Array.from(e.target.files));
  e.target.value = '';
});

document.getElementById('export-btn').addEventListener('click', exportPDF);

renderRoster();
