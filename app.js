import { store } from './store.js';
import { makeCommand } from './commands.js';

// ──────────────────────────── DOM helpers ────────────────────────────

const root = document.getElementById('view');

function clone(id) {
  const tpl = document.getElementById(id);
  return tpl.content.firstElementChild.cloneNode(true);
}
function slot(node, name) {
  return node.querySelector(`[data-slot="${name}"]`);
}
function setText(node, name, text) {
  const el = slot(node, name);
  if (el) el.textContent = text ?? '';
}
function setAttr(node, name, attr, value) {
  const el = slot(node, name);
  if (el) el.setAttribute(attr, value);
}
function show(node, name, on) {
  const el = slot(node, name);
  if (el) el.hidden = !on;
}

// ──────────────────────────── App state (non-undoable) ────────────────────────────

let view = 'today';
let editingId = null;
const drafts = new Map();

const DAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const DAY_FULL = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
// Display order: Monday first, Sunday last (Spanish calendar). Values are JS-Date day indices.
const DAY_ORDER_MON_FIRST = [1, 2, 3, 4, 5, 6, 0];
const monIndex = (d) => (d + 6) % 7;
const MONTH = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const SHAPES = [
  { key: 'redondo',    label: 'redondo' },
  { key: 'ovalado',    label: 'ovalado' },
  { key: 'capsula',    label: 'cápsula' },
  { key: 'comprimido', label: 'comprimido' },
  { key: 'rombo',      label: 'rombo' },
  { key: 'triangulo',  label: 'triángulo' },
  { key: 'gota',       label: 'gota' },
  { key: 'cuadrado',   label: 'cuadrado' },
];

const COLORS = [
  { key: 'blanco',   label: 'blanco',   hex: '#FFFFFF' },
  { key: 'amarillo', label: 'amarillo', hex: '#E8C45A' },
  { key: 'naranja',  label: 'naranja',  hex: '#D6843A' },
  { key: 'rojo',     label: 'rojo',     hex: '#B83A35' },
  { key: 'rosa',     label: 'rosa',     hex: '#D8949C' },
  { key: 'morado',   label: 'morado',   hex: '#7A4F8C' },
  { key: 'azul',     label: 'azul',     hex: '#3F6FA0' },
  { key: 'verde',    label: 'verde',    hex: '#5C8A5E' },
  { key: 'marron',   label: 'marrón',   hex: '#7C5938' },
  { key: 'oscuro',   label: 'oscuro',   hex: '#3A2D24' },
];

const DEFAULT_SHAPE = 'comprimido';
const DEFAULT_COLOR = 'blanco';

const colorHex = (key) => (COLORS.find((c) => c.key === key) || COLORS[0]).hex;

const COMMAND_LABELS = {
  ADD_MEDICATION:    'pastilla añadida',
  UPDATE_MEDICATION: 'pastilla editada',
  REMOVE_MEDICATION: 'pastilla eliminada',
  LOG_DOSE:          'dosis marcada',
  UNLOG_DOSE:        'dosis desmarcada',
};

function newId() {
  return (crypto.randomUUID && crypto.randomUUID())
    || `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fordYear(d = new Date()) {
  return d.getFullYear() - 1908;
}

function isMedicationActiveOn(med, key) {
  if (med.archivedAt) return false;
  if (med.startDate && key < med.startDate) return false;
  if (med.endDate && key > med.endDate) return false;
  return true;
}

function fmtDateShort(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  return `${d.getDate()} ${MONTH[d.getMonth()].slice(0, 3)} ${d.getFullYear()}`;
}

function dosesForDay(state, date) {
  const key = dateKey(date);
  const dow = date.getDay();
  const slots = [];
  for (const med of state.medications) {
    if (!isMedicationActiveOn(med, key)) continue;
    if (!med.daysOfWeek?.includes(dow)) continue;
    for (const time of med.times || []) {
      slots.push({
        medicationId: med.id,
        medication: med,
        time,
        scheduledFor: `${key}T${time}`,
      });
    }
  }
  slots.sort((a, b) =>
    a.time.localeCompare(b.time) || a.medication.name.localeCompare(b.medication.name)
  );
  return slots;
}

function logFor(state, scheduledFor, medicationId) {
  return state.doseLogs.find(
    (l) => l.scheduledFor === scheduledFor && l.medicationId === medicationId
  );
}

function blankMedication() {
  return {
    id: newId(),
    name: '',
    principle: '',
    shape: DEFAULT_SHAPE,
    color: DEFAULT_COLOR,
    onDemand: false,
    times: ['08:00'],
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    note: '',
    startDate: null,
    endDate: null,
    startedAt: null,
    archivedAt: null,
    createdAt: Date.now(),
  };
}

// ──────────────────────────── Pill SVG factory ────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function buildPillSvg(shape, color) {
  const fill = colorHex(color);
  const stroke = '#1B1410';
  const svg = svgEl('svg', {
    viewBox: '0 0 32 20',
    'aria-hidden': 'true',
    class: 'pill-svg',
  });

  switch (shape) {
    case 'redondo': {
      svg.appendChild(svgEl('circle', { cx: 16, cy: 10, r: 7.5, fill, stroke, 'stroke-width': 0.8 }));
      break;
    }
    case 'ovalado': {
      svg.appendChild(svgEl('ellipse', { cx: 16, cy: 10, rx: 12, ry: 6, fill, stroke, 'stroke-width': 0.8 }));
      break;
    }
    case 'capsula': {
      const g = svgEl('g');
      g.appendChild(svgEl('rect', { x: 3, y: 4, width: 26, height: 12, rx: 6, ry: 6, fill, stroke, 'stroke-width': 0.8 }));
      g.appendChild(svgEl('rect', { x: 3, y: 4, width: 13, height: 12, fill: '#F6EFD8', stroke: 'none' }));
      g.appendChild(svgEl('rect', { x: 3, y: 4, width: 26, height: 12, rx: 6, ry: 6, fill: 'none', stroke, 'stroke-width': 0.8 }));
      g.appendChild(svgEl('line', { x1: 16, y1: 4, x2: 16, y2: 16, stroke, 'stroke-width': 0.6 }));
      svg.appendChild(g);
      break;
    }
    case 'comprimido': {
      const g = svgEl('g');
      g.appendChild(svgEl('circle', { cx: 16, cy: 10, r: 7.5, fill, stroke, 'stroke-width': 0.8 }));
      g.appendChild(svgEl('line', { x1: 9, y1: 10, x2: 23, y2: 10, stroke, 'stroke-width': 0.6 }));
      svg.appendChild(g);
      break;
    }
    case 'rombo': {
      svg.appendChild(svgEl('polygon', {
        points: '16,2 26,10 16,18 6,10',
        fill, stroke, 'stroke-width': 0.8,
      }));
      break;
    }
    case 'triangulo': {
      svg.appendChild(svgEl('polygon', {
        points: '16,3 27,17 5,17',
        fill, stroke, 'stroke-width': 0.8,
        'stroke-linejoin': 'round',
      }));
      break;
    }
    case 'gota': {
      svg.appendChild(svgEl('ellipse', { cx: 16, cy: 10, rx: 6, ry: 8, fill, stroke, 'stroke-width': 0.8 }));
      break;
    }
    case 'cuadrado': {
      svg.appendChild(svgEl('rect', { x: 6, y: 2, width: 20, height: 16, rx: 2, ry: 2, fill, stroke, 'stroke-width': 0.8 }));
      break;
    }
    default: {
      svg.appendChild(svgEl('circle', { cx: 16, cy: 10, r: 7.5, fill, stroke, 'stroke-width': 0.8 }));
    }
  }
  return svg;
}

function draftFor(id, init) {
  if (init && !drafts.has(id)) drafts.set(id, structuredClone(init));
  return drafts.get(id);
}
function clearDraft(id) { drafts.delete(id); }

// ──────────────────────────── Builders ────────────────────────────

function buildPacket(state) {
  const node = clone('tpl-packet');
  const d = new Date();
  const slots = dosesForDay(state, d);
  const todayK = dateKey(d);
  const taken = state.doseLogs.filter(
    (l) => l.scheduledFor?.startsWith(todayK) && l.status === 'taken' && !l.onDemand
  ).length;
  setText(node, 'count-taken', String(taken));
  setText(node, 'count-total', String(slots.length));
  if (!store.canUndo()) slot(node, 'undo')?.setAttribute('disabled', '');
  if (!store.canRedo()) slot(node, 'redo')?.setAttribute('disabled', '');
  return node;
}

function buildNav() {
  const node = clone('tpl-nav');
  const t = slot(node, 'btn-today');
  if (view === 'today') t.classList.add('is-active');
  return node;
}

function buildToday(state) {
  const slots = dosesForDay(state, new Date());
  if (slots.length === 0) return clone('tpl-today-empty');
  const node = clone('tpl-today');
  const groups = [];
  for (const s of slots) {
    const last = groups[groups.length - 1];
    if (last && last.time === s.time) last.items.push(s);
    else groups.push({ time: s.time, items: [s] });
  }
  const schedule = slot(node, 'schedule');
  groups.forEach((g, gi) => {
    const block = clone('tpl-time-block');
    block.style.setProperty('--delay', `${gi * 60}ms`);
    setText(block, 'hour', g.time);
    const doses = slot(block, 'doses');
    for (const s of g.items) doses.appendChild(buildDose(state, s));
    schedule.appendChild(block);
  });
  return node;
}

function buildDose(state, s) {
  const node = clone('tpl-dose');
  const log = logFor(state, s.scheduledFor, s.medicationId);
  const isTaken = log?.status === 'taken';
  if (isTaken) node.classList.add('is-taken');

  const color = s.medication.color || DEFAULT_COLOR;
  node.style.setProperty('--row-color', `var(--pill-${color})`);

  const check = slot(node, 'check');
  check.dataset.medicationId = s.medicationId;
  check.dataset.scheduledFor = s.scheduledFor;
  check.setAttribute('aria-pressed', String(isTaken));
  check.setAttribute(
    'aria-label',
    isTaken ? 'Marcar como no tomada' : 'Marcar como tomada'
  );

  slot(node, 'pill').replaceChildren(buildPillSvg(s.medication.shape || DEFAULT_SHAPE, color));

  setText(node, 'name', s.medication.name);
  if (s.medication.principle) {
    setText(node, 'active', s.medication.principle);
    show(node, 'active', true);
  }
  if (s.medication.note) {
    setText(node, 'note', s.medication.note);
    show(node, 'note', true);
  }
  return node;
}


function buildManage(state) {
  const node = clone('tpl-manage');
  const list = slot(node, 'list');
  const meds = [...state.medications]
    .filter((m) => !m.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (meds.length === 0) {
    list.replaceWith(clone('tpl-manage-empty'));
    return node;
  }
  meds.forEach((m, i) => list.appendChild(buildMedRow(m, i)));
  return node;
}

function buildMedRow(m, i) {
  const node = clone('tpl-med-row');
  node.style.setProperty('--delay', `${i * 40}ms`);
  const color = m.color || DEFAULT_COLOR;
  node.style.setProperty('--row-color', `var(--pill-${color})`);
  const main = slot(node, 'main');
  main.dataset.id = m.id;
  slot(node, 'pill').replaceChildren(buildPillSvg(m.shape || DEFAULT_SHAPE, color));
  setText(node, 'name', m.name || '(sin nombre)');
  if (m.principle) {
    setText(node, 'active', m.principle);
    show(node, 'active', true);
  }
  if (m.onDemand) {
    setText(node, 'times', 'puntual · si lo necesito');
    setText(node, 'days', '');
  } else {
    setText(node, 'times', (m.times || []).join(' · '));
    setText(
      node,
      'days',
      m.daysOfWeek?.length === 7
        ? 'todos los días'
        : (m.daysOfWeek || [])
            .slice()
            .sort((a, b) => monIndex(a) - monIndex(b))
            .map((d) => DAY_SHORT[d])
            .join(' · ')
    );
  }
  if (m.note) {
    setText(node, 'note', m.note);
    show(node, 'note', true);
  }
  return node;
}

function buildArchive(state) {
  const node = clone('tpl-archive');
  const list = slot(node, 'list');
  const meds = [...state.medications]
    .filter((m) => m.archivedAt)
    .sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  if (meds.length === 0) {
    list.replaceWith(clone('tpl-archive-empty'));
    return node;
  }
  meds.forEach((m, i) => list.appendChild(buildArchiveRow(m, i)));
  return node;
}

function buildArchiveRow(m, i) {
  const node = clone('tpl-archive-row');
  node.style.setProperty('--delay', `${i * 40}ms`);
  const color = m.color || DEFAULT_COLOR;
  node.style.setProperty('--row-color', `var(--pill-${color})`);
  const main = slot(node, 'main');
  main.dataset.id = m.id;
  slot(node, 'pill').replaceChildren(buildPillSvg(m.shape || DEFAULT_SHAPE, color));
  setText(node, 'name', m.name || '(sin nombre)');
  if (m.principle) {
    setText(node, 'active', m.principle);
    show(node, 'active', true);
  }
  const since = fmtDateShort(m.startedAt);
  const until = fmtDateShort(m.archivedAt);
  let range;
  if (since && until) range = `${since} → ${until}`;
  else if (until) range = `archivado el ${until}`;
  else range = '';
  setText(node, 'range', range);
  return node;
}

function buildEdit(state) {
  const node = clone('tpl-edit');
  const existing = state.medications.find((m) => m.id === editingId);
  const isNew = !existing;
  const initial = existing || blankMedication();
  if (isNew && !drafts.has(editingId)) {
    initial.id = editingId;
    drafts.set(editingId, structuredClone(initial));
  } else if (!drafts.has(editingId)) {
    drafts.set(editingId, structuredClone(initial));
  }
  const d = draftFor(editingId);

  setText(node, 'title', isNew ? 'Nuevo medicamento' : 'Editar medicamento');
  const form = slot(node, 'form');
  form.dataset.formId = editingId;
  form.dataset.isNew = String(isNew);

  slot(node, 'name').value = d.name || '';
  slot(node, 'principle').value = d.principle || '';
  slot(node, 'note').value = d.note || '';
  slot(node, 'startDate').value = d.startDate || '';
  slot(node, 'endDate').value = d.endDate || '';
  if (d.startDate || d.endDate) slot(node, 'course').open = true;

  const onDemandInput = slot(node, 'onDemand');
  onDemandInput.checked = !!d.onDemand;
  // When on-demand, hide times + days fields.
  show(node, 'times-block', !d.onDemand);
  show(node, 'days-block', !d.onDemand);

  // Shapes
  const shapesWrap = slot(node, 'shapes');
  const currentShape = d.shape || DEFAULT_SHAPE;
  SHAPES.forEach((shape) => {
    const chip = clone('tpl-shape-chip');
    const on = currentShape === shape.key;
    if (on) chip.classList.add('is-on');
    const radio = slot(chip, 'radio');
    radio.value = shape.key;
    radio.checked = on;
    slot(chip, 'icon').replaceChildren(buildPillSvg(shape.key, d.color || DEFAULT_COLOR));
    setText(chip, 'label', shape.label);
    shapesWrap.appendChild(chip);
  });

  // Colors
  const colorsWrap = slot(node, 'colors');
  const currentColor = d.color || DEFAULT_COLOR;
  COLORS.forEach((c) => {
    const chip = clone('tpl-color-chip');
    const on = currentColor === c.key;
    if (on) chip.classList.add('is-on');
    const radio = slot(chip, 'radio');
    radio.value = c.key;
    radio.checked = on;
    slot(chip, 'swatch').style.background = c.hex;
    setText(chip, 'label', c.label);
    colorsWrap.appendChild(chip);
  });

  const timesList = slot(node, 'times');
  d.times.forEach((t, i) => {
    const row = clone('tpl-time-row');
    const input = slot(row, 'input');
    input.value = t;
    input.dataset.timeIndex = String(i);
    slot(row, 'remove').dataset.index = String(i);
    timesList.appendChild(row);
  });

  const daysWrap = slot(node, 'days');
  DAY_ORDER_MON_FIRST.forEach((idx) => {
    const chip = clone('tpl-day-chip');
    const on = d.daysOfWeek.includes(idx);
    if (on) chip.classList.add('is-on');
    const cb = slot(chip, 'checkbox');
    cb.value = String(idx);
    cb.checked = on;
    setText(chip, 'label', DAY_SHORT[idx]);
    daysWrap.appendChild(chip);
  });

  if (!isNew) {
    show(node, 'delete', true);
    if (d.archivedAt) show(node, 'unarchive', true);
    else show(node, 'archive', true);
  }
  return node;
}

let drawerOpen = false;

function buildDrawer(state) {
  const frag = document.createDocumentFragment();

  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.dataset.action = 'close-drawer';
  if (drawerOpen) backdrop.classList.add('is-on');
  frag.appendChild(backdrop);

  const node = clone('tpl-drawer');
  if (drawerOpen) node.classList.add('is-open');
  const active = state.medications
    .filter((m) => !m.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
  const archived = state.medications.filter((m) => m.archivedAt);

  const todayK = dateKey();
  const ondemandToday = state.doseLogs.filter(
    (l) => l.onDemand && l.scheduledFor?.startsWith(todayK)
  );
  setText(
    node,
    'sub',
    active.length === 0
      ? 'sin medicamentos'
      : `${active.length} medicamento${active.length === 1 ? '' : 's'}`
  );

  const list = slot(node, 'list');
  active.forEach((m) => list.appendChild(buildDrawerRow(m, ondemandToday)));

  if (archived.length > 0) {
    show(node, 'archive-link', true);
    setText(node, 'archive-count', `(${archived.length})`);
  }
  frag.appendChild(node);
  return frag;
}

function buildDrawerRow(med, ondemandToday) {
  const node = clone('tpl-drawer-row');
  const color = med.color || DEFAULT_COLOR;
  node.style.setProperty('--row-color', `var(--pill-${color})`);
  slot(node, 'pill').replaceChildren(buildPillSvg(med.shape || DEFAULT_SHAPE, color));
  setText(node, 'name', med.name || '(sin nombre)');
  if (med.principle) {
    setText(node, 'active', med.principle);
    show(node, 'active', true);
  }
  if (med.note) {
    setText(node, 'note', med.note);
    show(node, 'note', true);
  }
  slot(node, 'open').dataset.id = med.id;
  const take = slot(node, 'take');
  take.dataset.medicationId = med.id;
  const taken = ondemandToday.filter((l) => l.medicationId === med.id).length;
  if (taken > 0) {
    setText(node, 'badge', `${taken}×`);
    show(node, 'badge', true);
  }
  return node;
}

// ──────────────────────────── Render ────────────────────────────

let prevRenderedView = null;
function render() {
  const s = store.state;
  // Suppress page-load animations on same-view re-renders (dose toggles, edits, etc.)
  // so the hero doesn't fade-in every time state changes.
  root.classList.toggle('no-anim', prevRenderedView === view);
  prevRenderedView = view;
  const frag = document.createDocumentFragment();
  frag.appendChild(buildPacket(s));
  if (view !== 'edit') frag.appendChild(buildNav());

  const body = document.createElement('div');
  body.className = 'body';
  body.dataset.view = view;
  if (view === 'today') body.appendChild(buildToday(s));
  else if (view === 'archive') body.appendChild(buildArchive(s));
  else if (view === 'edit') body.appendChild(buildEdit(s));
  else body.appendChild(buildToday(s));
  frag.appendChild(body);

  // Bottom drawer is only shown on the Today view.
  if (view === 'today') {
    body.classList.add('body--with-drawer');
    frag.appendChild(buildDrawer(s));
  }

  root.replaceChildren(frag);
}

// ──────────────────────────── Handlers ────────────────────────────

function onClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'view-today') { view = 'today'; render(); return; }
  if (action === 'view-archive') { view = 'archive'; render(); return; }
  if (action === 'new-medication') {
    editingId = newId();
    view = 'edit';
    render();
    return;
  }
  if (action === 'edit-medication') {
    editingId = btn.dataset.id;
    view = 'edit';
    render();
    return;
  }
  if (action === 'back-manage') {
    if (editingId) clearDraft(editingId);
    const wasArchived = editingId && store.state.medications.find((m) => m.id === editingId)?.archivedAt;
    editingId = null;
    view = wasArchived ? 'archive' : 'today';
    render();
    return;
  }
  if (action === 'toggle-dose') {
    handleToggleDose(btn.dataset.medicationId, btn.dataset.scheduledFor);
    return;
  }
  if (action === 'add-time') { handleAddTime(); return; }
  if (action === 'remove-time') { handleRemoveTime(Number(btn.dataset.index)); return; }
  if (action === 'save-medication') { handleSaveMedication(); return; }
  if (action === 'delete-medication') { handleDeleteMedication(); return; }
  if (action === 'archive-medication') { handleArchiveMedication(); return; }
  if (action === 'unarchive-medication') { handleUnarchiveMedication(); return; }
  if (action === 'toggle-drawer') {
    drawerOpen = !drawerOpen;
    document.querySelector('.drawer')?.classList.toggle('is-open', drawerOpen);
    document.querySelector('.drawer-backdrop')?.classList.toggle('is-on', drawerOpen);
    return;
  }
  if (action === 'close-drawer') {
    drawerOpen = false;
    document.querySelector('.drawer')?.classList.remove('is-open');
    document.querySelector('.drawer-backdrop')?.classList.remove('is-on');
    return;
  }
  if (action === 'take-ondemand') {
    handleTakeOnDemand(btn.dataset.medicationId);
    return;
  }
  if (action === 'undo') { doUndo(); return; }
  if (action === 'redo') { doRedo(); return; }
}

function onInput(e) {
  const form = e.target.closest('form[data-form-id]');
  if (!form) return;
  const id = form.dataset.formId;
  const d = draftFor(id);
  if (!d) return;
  const t = e.target;
  if (t.name === 'name') d.name = t.value;
  else if (t.name === 'principle') d.principle = t.value;
  else if (t.name === 'note') d.note = t.value;
  else if (t.name === 'startDate') d.startDate = t.value || null;
  else if (t.name === 'endDate') d.endDate = t.value || null;
  else if (t.dataset.timeIndex !== undefined) {
    d.times[Number(t.dataset.timeIndex)] = t.value;
  }
}

function onChange(e) {
  const form = e.target.closest('form[data-form-id]');
  if (!form) return;
  const id = form.dataset.formId;
  const d = draftFor(id);
  if (!d) return;
  const t = e.target;
  if (t.name === 'dow') {
    const val = Number(t.value);
    if (t.checked) {
      if (!d.daysOfWeek.includes(val)) d.daysOfWeek = [...d.daysOfWeek, val].sort((a, b) => a - b);
    } else {
      d.daysOfWeek = d.daysOfWeek.filter((x) => x !== val);
    }
    const chip = t.closest('.day-chip');
    if (chip) chip.classList.toggle('is-on', t.checked);
  } else if (t.name === 'shape') {
    d.shape = t.value;
    render();
  } else if (t.name === 'color') {
    d.color = t.value;
    render();
  } else if (t.name === 'onDemand') {
    d.onDemand = !!t.checked;
    render();
  }
}

function handleAddTime() {
  const d = draftFor(editingId);
  if (!d) return;
  d.times = [...d.times, '08:00'];
  render();
}

function handleRemoveTime(idx) {
  const d = draftFor(editingId);
  if (!d) return;
  d.times = d.times.filter((_, i) => i !== idx);
  if (d.times.length === 0) d.times = ['08:00'];
  render();
}

function handleSaveMedication() {
  const d = draftFor(editingId);
  if (!d) return;
  if (!d.name?.trim()) { flash('Falta el nombre del medicamento.'); return; }
  if (!d.onDemand) {
    if (!d.times || d.times.length === 0) { flash('Añade al menos una hora.'); return; }
    if (!d.daysOfWeek || d.daysOfWeek.length === 0) { flash('Selecciona al menos un día.'); return; }
  }
  const existing = store.state.medications.find((m) => m.id === editingId);
  const next = {
    ...d,
    name: d.name.trim(),
    principle: (d.principle || '').trim(),
    shape: d.shape || DEFAULT_SHAPE,
    color: d.color || DEFAULT_COLOR,
    onDemand: !!d.onDemand,
    times: d.onDemand ? [] : [...new Set(d.times)].sort(),
    daysOfWeek: d.onDemand ? [] : [...new Set(d.daysOfWeek)].sort((a, b) => a - b),
    note: (d.note || '').trim(),
    startDate: d.startDate || null,
    endDate: d.endDate || null,
    startedAt: d.startedAt ?? existing?.startedAt ?? Date.now(),
    archivedAt: d.archivedAt ?? existing?.archivedAt ?? null,
  };
  if (existing) {
    store.dispatch(makeCommand('UPDATE_MEDICATION', { from: existing, to: next }));
    flash('Pastilla editada');
  } else {
    store.dispatch(makeCommand('ADD_MEDICATION', { from: null, to: next }));
    flash('Pastilla añadida');
  }
  clearDraft(editingId);
  const wasArchived = next.archivedAt;
  editingId = null;
  view = wasArchived ? 'archive' : 'today';
  render();
}

function handleDeleteMedication() {
  const existing = store.state.medications.find((m) => m.id === editingId);
  if (!existing) return;
  if (!confirm(`¿Eliminar "${existing.name}" para siempre? Si querés conservar el historial, usá Archivar.`)) return;
  store.dispatch(makeCommand('REMOVE_MEDICATION', { from: existing, to: null }));
  flash('Pastilla eliminada');
  clearDraft(editingId);
  const wasArchived = existing.archivedAt;
  editingId = null;
  view = wasArchived ? 'archive' : 'today';
  render();
}

function handleArchiveMedication() {
  const existing = store.state.medications.find((m) => m.id === editingId);
  if (!existing) return;
  const next = { ...existing, archivedAt: Date.now() };
  store.dispatch(makeCommand('UPDATE_MEDICATION', { from: existing, to: next }));
  flash('Pastilla archivada');
  clearDraft(editingId);
  editingId = null;
  view = 'archive';
  render();
}

function handleUnarchiveMedication() {
  const existing = store.state.medications.find((m) => m.id === editingId);
  if (!existing) return;
  const next = { ...existing, archivedAt: null };
  store.dispatch(makeCommand('UPDATE_MEDICATION', { from: existing, to: next }));
  flash('Pastilla reactivada');
  clearDraft(editingId);
  editingId = null;
  view = 'today';
  render();
}

function handleToggleDose(medicationId, scheduledFor) {
  const existing = logFor(store.state, scheduledFor, medicationId);
  if (existing) {
    store.dispatch(makeCommand('UNLOG_DOSE', { from: existing, to: null }));
  } else {
    const log = {
      id: newId(),
      medicationId,
      scheduledFor,
      takenAt: Date.now(),
      status: 'taken',
    };
    store.dispatch(makeCommand('LOG_DOSE', { from: null, to: log }));
  }
}

function handleTakeOnDemand(medicationId) {
  const now = new Date();
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  // Synthetic scheduledFor with @ondemand suffix so it stays unique per tap.
  const scheduledFor = `${dateKey(now)}T${time}@ondemand:${newId()}`;
  const log = {
    id: newId(),
    medicationId,
    scheduledFor,
    takenAt: Date.now(),
    status: 'taken',
    onDemand: true,
  };
  store.dispatch(makeCommand('LOG_DOSE', { from: null, to: log }));
  flash('Registrado.');
}

let flashHost = null;
let flashTimer = 0;
function flash(msg) {
  if (!flashHost) {
    flashHost = clone('tpl-flash');
    document.body.appendChild(flashHost);
  }
  flashHost.textContent = msg;
  flashHost.classList.add('is-on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => flashHost.classList.remove('is-on'), 2200);
}

function isEditableTarget(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function onKeyDown(e) {
  const meta = e.metaKey || e.ctrlKey;
  if (!meta) return;
  if (e.key === 'z' || e.key === 'Z') {
    if (isEditableTarget(e)) return;
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
  } else if (e.key === 'y' || e.key === 'Y') {
    if (isEditableTarget(e)) return;
    e.preventDefault();
    doRedo();
  }
}

function doUndo() {
  const cmd = store.undo();
  if (cmd) flash(`Deshecho · ${COMMAND_LABELS[cmd.type] || 'acción'}`);
}

function doRedo() {
  const cmd = store.redo();
  if (cmd) flash(`Rehecho · ${COMMAND_LABELS[cmd.type] || 'acción'}`);
}

const start = async () => {
  await store.ready;
  store.subscribe(render);
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  window.addEventListener('keydown', onKeyDown);
  render();
};

start();
