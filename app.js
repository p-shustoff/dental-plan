/* План лечения на снимке: логика страницы */
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (n) => (Number(n) || 0).toLocaleString('ru-RU');
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

const DEFAULT_NOTE = 'Стоимость предварительная и может измениться после дополнительного обследования.';
const SIZES = { s: 22, m: 28, l: 36 };
const CURRENCY = '₽'; // пока только рубли

/* ---------- state ---------- */
let S = {
  images: [], // {id, name, blob, url, w, h}
  active: null,
  rows: [],   // {id, imageId|null, tooth, x, y, lx, ly, work, price, comment}
  patient: '', date: today(), doctor: '', note: DEFAULT_NOTE,
  size: 'm', example: false,
};
let selected = null;
let placingRowId = null;
let undoSnap = null;

const EXAMPLE_PRICES = [
  ['Консультация и осмотр', 1000], ['Профессиональная гигиена', 5500], ['Пломба (композит)', 6500],
  ['Лечение каналов, 1 канал', 8000], ['Лечение каналов, 3 канала', 16000], ['Удаление зуба', 3500],
  ['Удаление зуба мудрости', 8000], ['Коронка металлокерамика', 18000], ['Коронка цирконий', 32000],
  ['Имплантат с коронкой', 75000],
];
let prices = [];
try { const raw = localStorage.getItem('dp.prices'); prices = raw ? JSON.parse(raw) : null; } catch (e) { prices = null; }
let pricesAreExample = false;
if (!Array.isArray(prices)) { prices = EXAMPLE_PRICES.map(([name, price]) => ({ id: uid(), name, price })); pricesAreExample = true; }
const savePrices = () => { try { localStorage.setItem('dp.prices', JSON.stringify(prices)); } catch (e) {} };

/* ---------- IndexedDB draft ---------- */
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('dental-plan', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function idbGet(k) { const db = await idb(); return new Promise((res, rej) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); }
async function idbSet(k, v) { const db = await idb(); return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = () => res(); t.onerror = () => rej(t.error); }); }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await idbSet('draft', {
        ...S, images: S.images.map(({ id, name, blob, w, h }) => ({ id, name, blob, w, h })),
      });
    } catch (e) { /* storage unavailable: work continues in memory */ }
  }, 350);
}

/* ---------- images ---------- */
function loadImg(url) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }); }
async function addImageBlob(blob, name) {
  if (S.example) clearExample(true);
  const url = URL.createObjectURL(blob);
  let im;
  try { im = await loadImg(url); } catch (e) { toast('Этот файл не открывается как изображение. Нужен PNG или JPG.'); return; }
  const img = { id: uid(), name: name || 'Снимок', blob, url, w: im.naturalWidth, h: im.naturalHeight };
  S.images.push(img); S.active = img.id;
  renderAll(); save();
}
async function handleFiles(files) {
  for (const f of files) {
    if (/dicom|\.dcm$/i.test(f.type + ' ' + f.name)) { toast('DICOM здесь не открывается. Сделайте скриншот нужного ракурса.'); continue; }
    if (!f.type.startsWith('image/')) { toast('Нужен файл изображения: PNG или JPG.'); continue; }
    await addImageBlob(f, f.name);
  }
}
$('fileIn').addEventListener('change', (e) => { handleFiles([...e.target.files]); e.target.value = ''; });
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); handleFiles(files); }
});
const stage = $('stage');
['dragenter', 'dragover'].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); stage.classList.add('drag'); }));
['dragleave', 'drop'].forEach((t) => stage.addEventListener(t, (e) => { e.preventDefault(); stage.classList.remove('drag'); }));
stage.addEventListener('drop', (e) => { const fs = [...(e.dataTransfer?.files || [])]; if (fs.length) handleFiles(fs); });

/* ---------- example (schematic panoramic) ---------- */
const UNIT = { 1: 0.78, 2: 0.7, 3: 0.82, 4: 0.86, 5: 0.86, 6: 1.2, 7: 1.15, 8: 1.05 };
function schematic() {
  const W = 1400, H = 720, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const bg = g.createRadialGradient(700, 380, 60, 700, 380, 820); bg.addColorStop(0, '#2e3536'); bg.addColorStop(1, '#090c0d');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // bone bands
  g.fillStyle = 'rgba(200,210,208,0.07)';
  g.beginPath(); g.ellipse(700, 250, 640, 170, 0, Math.PI, 0); g.fill();
  g.beginPath(); g.ellipse(700, 470, 620, 200, 0, 0, Math.PI); g.fill();
  const occ = (x) => 362 - 0.00021 * (x - 700) ** 2;
  const order = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
  const total = order.reduce((s, t) => s + UNIT[t % 10], 0);
  const left = 140, span = 1120, unit = span / total;
  const centers = {};
  function tooth(cx, w, upper, n, opts = {}) {
    const o = occ(cx), dir = upper ? -1 : 1;
    const crownH = n >= 6 ? 62 : n >= 4 ? 66 : 72, rootL = n >= 6 ? 112 : n === 3 ? 150 : 126;
    const yc0 = o + dir * 7, yc1 = yc0 + dir * crownH;
    const x0 = cx - w / 2 + 3, x1 = cx + w / 2 - 3;
    if (opts.missing) {
      g.strokeStyle = 'rgba(200,210,208,0.18)'; g.setLineDash([6, 6]); g.lineWidth = 2;
      g.beginPath(); g.moveTo(x0 + 6, yc1 + dir * 20); g.quadraticCurveTo(cx, yc1 + dir * (rootL * 0.8), x1 - 6, yc1 + dir * 20); g.stroke(); g.setLineDash([]);
      return { x: cx, y: (yc0 + yc1) / 2 };
    }
    // roots
    const roots = n >= 6 ? (upper ? 3 : 2) : 1;
    for (let r = 0; r < roots; r++) {
      const rx0 = x0 + (r * (x1 - x0)) / roots + 2, rx1 = x0 + ((r + 1) * (x1 - x0)) / roots - 2;
      const tip = (rx0 + rx1) / 2 + (r - (roots - 1) / 2) * 4;
      const grd = g.createLinearGradient(0, yc1, 0, yc1 + dir * rootL); grd.addColorStop(0, '#a9b2b1'); grd.addColorStop(1, '#6a7473');
      g.fillStyle = grd; g.beginPath(); g.moveTo(rx0, yc1); g.quadraticCurveTo(rx0 + 2, yc1 + dir * rootL * 0.7, tip, yc1 + dir * rootL); g.quadraticCurveTo(rx1 - 2, yc1 + dir * rootL * 0.7, rx1, yc1); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(40,46,46,0.9)'; g.lineWidth = 2; g.beginPath(); g.moveTo((rx0 + rx1) / 2, yc1); g.lineTo(tip, yc1 + dir * (rootL - 10)); g.stroke();
      if (opts.lesion && r === 0) { const lg = g.createRadialGradient(tip, yc1 + dir * (rootL + 6), 2, tip, yc1 + dir * (rootL + 6), 26); lg.addColorStop(0, 'rgba(5,8,8,0.95)'); lg.addColorStop(1, 'rgba(5,8,8,0)'); g.fillStyle = lg; g.beginPath(); g.arc(tip, yc1 + dir * (rootL + 6), 26, 0, Math.PI * 2); g.fill(); }
    }
    // crown
    const cg = g.createLinearGradient(0, yc0, 0, yc1); cg.addColorStop(0, '#e9eeed'); cg.addColorStop(1, '#bfc7c6');
    g.fillStyle = cg; g.beginPath(); g.roundRect(x0, Math.min(yc0, yc1), x1 - x0, crownH, 10); g.fill();
    g.fillStyle = 'rgba(60,68,68,0.55)'; g.beginPath(); g.roundRect(cx - w * 0.16, upper ? yc1 + 8 : yc1 - 26, w * 0.32, 18, 6); g.fill();
    if (opts.filling) { g.fillStyle = '#ffffff'; g.beginPath(); g.ellipse(cx + 4, (yc0 + yc1) / 2 + dir * -6, w * 0.26, 13, 0.2, 0, Math.PI * 2); g.fill(); }
    if (opts.caries) { g.fillStyle = 'rgba(30,36,36,0.85)'; g.beginPath(); g.ellipse(cx - w * 0.22, (yc0 + yc1) / 2 + dir * -4, 7, 10, 0, 0, Math.PI * 2); g.fill(); }
    return { x: cx, y: (yc0 + yc1) / 2 };
  }
  const special = { 16: { filling: true, caries: true }, 36: { lesion: true }, 46: { missing: true } };
  let x = left;
  for (const t of order) { const w = UNIT[t % 10] * unit; const p = tooth(x + w / 2, w, true, t % 10, special[t]); centers[t] = p; x += w; }
  const lower = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];
  x = left + 8;
  for (const t of lower) { const w = UNIT[t % 10] * unit * 0.985; const p = tooth(x + w / 2, w, false, t % 10, special[t]); centers[t] = p; x += w; }
  g.fillStyle = 'rgba(228,236,235,0.45)'; g.font = '600 18px "IBM Plex Mono", monospace'; g.fillText('СХЕМА · ПРИМЕР', 28, H - 26);
  g.fillText('R', 34, 360); g.fillText('L', W - 46, 360);
  const frac = {}; for (const k in centers) frac[k] = { x: centers[k].x / W, y: centers[k].y / H };
  return { canvas: c, frac };
}
async function loadExample() {
  const { canvas, frac } = schematic();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(blob);
  const img = { id: uid(), name: 'Схема (пример)', blob, url, w: canvas.width, h: canvas.height };
  const mk = (tooth, work, price, comment, onImage = true, dx = 0.03, dy = -0.11) => {
    const p = frac[tooth];
    return onImage ? { id: uid(), imageId: img.id, tooth: String(tooth), x: p.x, y: p.y, lx: p.x + dx, ly: clamp(p.y + dy, 0.04, 0.96), work, price, comment }
      : { id: uid(), imageId: null, tooth: String(tooth), x: 0, y: 0, lx: 0, ly: 0, work, price, comment };
  };
  S.images = [img]; S.active = img.id; S.example = true;
  S.rows = [
    mk(16, 'Пломба (композит)', 6500, 'Вторичный кариес под старой пломбой'),
    mk(36, 'Лечение каналов, 3 канала', 16000, 'Очаг у верхушки корня', true, 0.03, 0.15),
    mk(36, 'Коронка металлокерамика', 18000, 'После лечения каналов', false),
    mk(46, 'Имплантат с коронкой', 75000, 'Зуб отсутствует', true, -0.03, 0.15),
  ];
}
function clearExample(silent) {
  if (!silent) snapshot('Пример убран');
  S.images = S.images.filter((i) => !i.name.includes('(пример)'));
  S.rows = []; S.example = false; S.active = S.images[0]?.id || null; selected = null;
  renderAll(); save();
}
$('clearExample').addEventListener('click', () => clearExample(false));

/* ---------- undo ---------- */
function snapshot(msg) {
  undoSnap = { images: S.images.slice(), rows: S.rows.map((r) => ({ ...r })), active: S.active, example: S.example, patient: S.patient, doctor: S.doctor };
  toast(msg, true);
}
$('toastBtn').addEventListener('click', () => {
  if (!undoSnap) return;
  Object.assign(S, undoSnap); undoSnap = null; $('toast').hidden = true;
  renderAll(); save();
});
let toastTimer;
function toast(text, withUndo = false) {
  $('toastText').textContent = text; $('toastBtn').hidden = !withUndo; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; if (withUndo) undoSnap = null; }, withUndo ? 6000 : 4000);
}

/* ---------- rendering ---------- */
const inner = $('inner'), img = $('stageImg'), markersEl = $('markers'), leaders = $('leaders');
const activeImage = () => S.images.find((i) => i.id === S.active) || null;

function renderAll() {
  $('exampleBanner').hidden = !S.example;
  renderThumbs(); renderStage(); renderRows(); renderTotal();
  $('fPatient').value = S.patient; $('fDate').value = S.date; $('fDoctor').value = S.doctor; $('fNote').value = S.note;
  document.querySelectorAll('#sizeSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === S.size)));
}
function renderThumbs() {
  const box = $('thumbs');
  box.hidden = S.images.length === 0;
  box.replaceChildren();
  S.images.forEach((im, i) => {
    const b = document.createElement('div');
    b.className = 'thumb'; b.setAttribute('aria-current', String(im.id === S.active));
    b.innerHTML = `<button type="button" class="sel" style="all:unset;position:absolute;inset:0;cursor:pointer" aria-label="Открыть снимок ${i + 1}"></button><img alt=""><span class="num">${i + 1}</span><button type="button" class="rm" aria-label="Убрать снимок ${i + 1}">×</button>`;
    b.querySelector('img').src = im.url;
    b.querySelector('.sel').addEventListener('click', () => { S.active = im.id; placingRowId = null; renderStage(); renderThumbs(); save(); });
    b.querySelector('.rm').addEventListener('click', () => removeImage(im.id));
    box.appendChild(b);
  });
  const add = document.createElement('label');
  add.className = 'thumb-add'; add.htmlFor = 'fileIn'; add.title = 'Добавить снимок'; add.textContent = '+';
  add.style.display = 'flex'; add.style.alignItems = 'center'; add.style.justifyContent = 'center'; add.style.cursor = 'pointer';
  box.appendChild(add);
}
function removeImage(id) {
  snapshot('Снимок убран, строки остались в плане');
  S.rows = S.rows.map((r) => (r.imageId === id ? { ...r, imageId: null } : r));
  S.images = S.images.filter((i) => i.id !== id);
  if (S.active === id) S.active = S.images[0]?.id || null;
  S.example = S.example && S.images.some((i) => i.name.includes('(пример)'));
  renderAll(); save();
}
function renderStage() {
  const im = activeImage();
  $('emptyState').hidden = !!im; inner.hidden = !im;
  stage.classList.toggle('placing', !!placingRowId);
  if (!im) { markersEl.replaceChildren(); leaders.replaceChildren(); return; }
  if (img.getAttribute('src') !== im.url) img.src = im.url;
  inner.style.setProperty('--ms', SIZES[S.size] + 'px');
  markersEl.replaceChildren(); leaders.replaceChildren();
  const ns = 'http://www.w3.org/2000/svg';
  S.rows.filter((r) => r.imageId === im.id).forEach((r) => {
    for (const cls of ['halo', '']) {
      const ln = document.createElementNS(ns, 'line');
      if (cls) ln.setAttribute('class', cls);
      ln.dataset.id = r.id; leaders.appendChild(ln);
    }
    const dot = document.createElement('div'); dot.className = 'mk-dot'; dot.dataset.id = r.id; dot.title = 'Точка: перетащите';
    const badge = document.createElement('div'); badge.className = 'mk-badge'; badge.dataset.id = r.id; badge.tabIndex = 0;
    badge.setAttribute('role', 'button');
    markersEl.append(dot, badge);
    dot.addEventListener('pointerdown', (e) => startDrag(e, r.id, 'dot'));
    badge.addEventListener('pointerdown', (e) => startDrag(e, r.id, 'badge'));
    badge.addEventListener('keydown', (e) => markerKey(e, r.id));
    positionMarker(r);
  });
  highlight();
}
function positionMarker(r) {
  const dot = markersEl.querySelector(`.mk-dot[data-id="${r.id}"]`), badge = markersEl.querySelector(`.mk-badge[data-id="${r.id}"]`);
  if (!dot) return;
  dot.style.left = r.x * 100 + '%'; dot.style.top = r.y * 100 + '%';
  badge.style.left = r.lx * 100 + '%'; badge.style.top = r.ly * 100 + '%';
  badge.textContent = r.tooth || '•';
  badge.setAttribute('aria-label', `Метка зуба ${r.tooth || 'без номера'}`);
  leaders.querySelectorAll(`line[data-id="${r.id}"]`).forEach((ln) => {
    ln.setAttribute('x1', r.x * 100 + '%'); ln.setAttribute('y1', r.y * 100 + '%');
    ln.setAttribute('x2', r.lx * 100 + '%'); ln.setAttribute('y2', r.ly * 100 + '%');
  });
}
function highlight(hotId) {
  markersEl.querySelectorAll('.mk-dot, .mk-badge').forEach((el) => {
    el.classList.toggle('sel', el.dataset.id === selected);
    el.classList.toggle('hot', el.dataset.id === hotId);
  });
  document.querySelectorAll('.row').forEach((el) => el.classList.toggle('sel', el.dataset.id === selected));
}

/* ---------- rows ---------- */
const rowsEl = $('rows');
function renderRows() {
  rowsEl.replaceChildren();
  if (!S.rows.length) {
    const e = document.createElement('div'); e.className = 'rows-empty';
    e.textContent = S.images.length ? 'Кликните по снимку, чтобы отметить первый зуб.' : 'Загрузите снимок и отметьте на нём зубы. Строки появятся здесь.';
    rowsEl.appendChild(e); return;
  }
  const multi = S.images.length > 1;
  S.rows.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'row' + (r.imageId ? ' has-marker' : ''); el.dataset.id = r.id;
    const imgIdx = S.images.findIndex((i) => i.id === r.imageId);
    const markerAction = r.imageId
      ? `<button type="button" class="mini show">${multi ? 'сн. ' + (imgIdx + 1) : 'на снимке'}</button>`
      : (S.images.length ? `<button type="button" class="mini pin">${placingRowId === r.id ? 'кликните…' : 'отметить'}</button>` : '');
    el.innerHTML = `
      <div class="c-tooth"><input class="in tooth-in" maxlength="3" inputmode="numeric" aria-label="Номер зуба" placeholder="—">${markerAction}</div>
      <input class="in work" list="priceNames" placeholder="Работа" aria-label="Работа">
      <input class="in price" inputmode="numeric" placeholder="0" aria-label="Стоимость">
      <input class="in comment" placeholder="Комментарий" aria-label="Комментарий">
      <div class="act"><button type="button" class="ic del" aria-label="Удалить строку" title="Удалить строку">×</button><button type="button" class="ic same" aria-label="Ещё работа по этому зубу" title="Ещё работа по этому зубу">+</button></div>`;
    const tIn = el.querySelector('.tooth-in'), wIn = el.querySelector('.work'), pIn = el.querySelector('.price'), cIn = el.querySelector('.comment');
    tIn.value = r.tooth; wIn.value = r.work; pIn.value = r.price === '' || r.price == null ? '' : fmt(r.price); cIn.value = r.comment;
    tIn.addEventListener('input', () => { r.tooth = tIn.value.replace(/[^\dA-Za-zА-Яа-я]/g, ''); positionMarker(r); save(); });
    wIn.addEventListener('input', () => {
      r.work = wIn.value;
      const hit = prices.find((p) => p.name.toLowerCase() === r.work.trim().toLowerCase());
      if (hit && (r.price === '' || r.price == null || Number(r.price) === 0)) { r.price = hit.price; pIn.value = fmt(hit.price); renderTotal(); }
      save();
    });
    pIn.addEventListener('focus', () => { pIn.value = r.price === '' || r.price == null ? '' : String(r.price); });
    pIn.addEventListener('input', () => { const d = pIn.value.replace(/\D/g, ''); r.price = d === '' ? '' : Number(d); renderTotal(); save(); });
    pIn.addEventListener('blur', () => { pIn.value = r.price === '' || r.price == null ? '' : fmt(r.price); });
    cIn.addEventListener('input', () => { r.comment = cIn.value; save(); });
    el.addEventListener('pointerenter', () => highlight(r.id));
    el.addEventListener('pointerleave', () => highlight());
    el.addEventListener('focusin', () => { selected = r.id; highlight(); });
    el.querySelector('.del').addEventListener('click', () => deleteRow(r.id));
    el.querySelector('.same').addEventListener('click', () => {
      const nr = { id: uid(), imageId: null, tooth: r.tooth, x: 0, y: 0, lx: 0, ly: 0, work: '', price: '', comment: '' };
      S.rows.splice(S.rows.indexOf(r) + 1, 0, nr); renderRows(); focusRow(nr.id, '.work'); save();
    });
    el.querySelector('.show')?.addEventListener('click', () => revealMarker(r.id));
    el.querySelector('.pin')?.addEventListener('click', () => { placingRowId = placingRowId === r.id ? null : r.id; renderRows(); renderStage(); updateHint(); });
    rowsEl.appendChild(el);
  });
  highlight();
}
function focusRow(id, sel) { const el = rowsEl.querySelector(`.row[data-id="${id}"] ${sel}`); if (el) { el.focus({ preventScroll: true }); el.closest('.row').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }
function deleteRow(id) {
  snapshot('Строка удалена');
  S.rows = S.rows.filter((r) => r.id !== id);
  if (selected === id) selected = null;
  renderRows(); renderStage(); renderTotal(); save();
}
function revealMarker(id) {
  const r = S.rows.find((x) => x.id === id); if (!r || !r.imageId) return;
  if (S.active !== r.imageId) { S.active = r.imageId; renderThumbs(); renderStage(); }
  selected = id; highlight();
  const b = markersEl.querySelector(`.mk-badge[data-id="${id}"]`);
  if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); b.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}
function renderTotal() {
  const sum = S.rows.reduce((s, r) => s + (Number(r.price) || 0), 0);
  $('total').textContent = fmt(sum);
}
$('addRow').addEventListener('click', () => {
  const nr = { id: uid(), imageId: null, tooth: '', x: 0, y: 0, lx: 0, ly: 0, work: '', price: '', comment: '' };
  S.rows.push(nr); renderRows(); focusRow(nr.id, '.tooth-in'); save();
});
$('sortRows').addEventListener('click', () => {
  const key = (t) => { const n = parseInt(t, 10); return Number.isFinite(n) ? n : 999; };
  S.rows = S.rows.map((r, i) => ({ r, i })).sort((a, b) => key(a.r.tooth) - key(b.r.tooth) || a.i - b.i).map((x) => x.r);
  renderRows(); save();
});

/* ---------- markers: drag, select, keyboard ---------- */
function startDrag(e, id, part) {
  if (e.button !== 0) return;
  e.preventDefault(); e.stopPropagation(); closePicker();
  const r = S.rows.find((x) => x.id === id); if (!r) return;
  const el = e.currentTarget; el.setPointerCapture(e.pointerId);
  const rect = inner.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY; let moved = false;
  const grabDX = part === 'badge' ? r.lx - (sx - rect.left) / rect.width : r.x - (sx - rect.left) / rect.width;
  const grabDY = part === 'badge' ? r.ly - (sy - rect.top) / rect.height : r.y - (sy - rect.top) / rect.height;
  const move = (ev) => {
    if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
    moved = true;
    const fx = clamp((ev.clientX - rect.left) / rect.width + grabDX, 0, 1), fy = clamp((ev.clientY - rect.top) / rect.height + grabDY, 0, 1);
    if (part === 'dot') { const ox = r.lx - r.x, oy = r.ly - r.y; r.x = fx; r.y = fy; r.lx = clamp(fx + ox, 0, 1); r.ly = clamp(fy + oy, 0, 1); }
    else { r.lx = fx; r.ly = fy; }
    positionMarker(r);
  };
  const up = () => {
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    if (moved) save();
    selected = id; highlight();
    if (!moved) focusRow(id, '.work');
    else { const row = rowsEl.querySelector(`.row[data-id="${id}"]`); row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
}
function markerKey(e, id) {
  const r = S.rows.find((x) => x.id === id); if (!r) return;
  const step = e.shiftKey ? 0.02 : 0.005;
  const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (map[e.key]) { e.preventDefault(); r.lx = clamp(r.lx + map[e.key][0], 0, 1); r.ly = clamp(r.ly + map[e.key][1], 0, 1); positionMarker(r); save(); }
  else if (e.key === 'Enter') { e.preventDefault(); selected = id; highlight(); focusRow(id, '.work'); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); deleteRow(id); }
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closePicker(); if (placingRowId) { placingRowId = null; renderRows(); renderStage(); updateHint(); } if (!$('modal').hidden) $('modal').hidden = true; return; }
  const tag = (document.activeElement?.tagName || '').toLowerCase();
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !['input', 'textarea', 'select'].includes(tag)) {
    const r = S.rows.find((x) => x.id === selected);
    if (r && r.imageId) { e.preventDefault(); deleteRow(selected); }
  }
});

/* ---------- placing: click on image ---------- */
let pendingPoint = null;
img.addEventListener('click', (e) => {
  const rect = inner.getBoundingClientRect();
  const fx = clamp((e.clientX - rect.left) / rect.width, 0, 1), fy = clamp((e.clientY - rect.top) / rect.height, 0, 1);
  if (placingRowId) {
    const r = S.rows.find((x) => x.id === placingRowId);
    if (r) { Object.assign(r, { imageId: S.active, x: fx, y: fy, ...labelSpot(fx, fy, rect) }); selected = r.id; }
    placingRowId = null; renderStage(); renderRows(); updateHint(); save(); return;
  }
  pendingPoint = { x: fx, y: fy, rect };
  openPicker(e.clientX, e.clientY);
});
function labelSpot(fx, fy, rect) {
  const off = SIZES[S.size] * 1.15;
  const dx = (fx > 0.85 ? -off : off) / rect.width, dy = (fy < 0.12 ? off : -off) / rect.height;
  return { lx: clamp(fx + dx, 0, 1), ly: clamp(fy + dy, 0, 1) };
}
function addMarkerRow(tooth) {
  if (!pendingPoint) return;
  const { x, y, rect } = pendingPoint;
  const nr = { id: uid(), imageId: S.active, tooth, x, y, ...labelSpot(x, y, rect), work: '', price: '', comment: '' };
  S.rows.push(nr); selected = nr.id; pendingPoint = null;
  closePicker(); renderStage(); renderRows(); renderTotal(); save();
  focusRow(nr.id, '.work');
}

/* ---------- tooth picker ---------- */
const picker = $('picker');
let pkSet = 'perm';
const SETS = {
  perm: { up: [[18,17,16,15,14,13,12,11], [21,22,23,24,25,26,27,28]], low: [[48,47,46,45,44,43,42,41], [31,32,33,34,35,36,37,38]] },
  milk: { up: [[null,null,null,55,54,53,52,51], [61,62,63,64,65,null,null,null]], low: [[null,null,null,85,84,83,82,81], [71,72,73,74,75,null,null,null]] },
};
function renderPicker() {
  const used = new Set(S.rows.filter((r) => r.imageId === S.active).map((r) => r.tooth));
  const grid = $('pkGrid'); grid.replaceChildren();
  const set = SETS[pkSet];
  const cell = (n) => {
    if (n == null) { const s = document.createElement('span'); grid.appendChild(s); return; }
    const b = document.createElement('button'); b.type = 'button'; b.className = 't' + (used.has(String(n)) ? ' used' : ''); b.textContent = n;
    b.addEventListener('click', () => addMarkerRow(String(n))); grid.appendChild(b);
  };
  const line = (pair) => { pair[0].forEach(cell); const v = document.createElement('span'); v.className = 'vsep'; grid.appendChild(v); pair[1].forEach(cell); };
  line(set.up); const h = document.createElement('span'); h.className = 'hsep'; grid.appendChild(h); line(set.low);
  document.querySelectorAll('#pkSet button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.set === pkSet)));
}
function openPicker(cx, cy) {
  renderPicker(); picker.hidden = false; $('pkInput').value = '';
  const pw = picker.offsetWidth, ph = picker.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
  let left = clamp(cx + 14, 12, vw - pw - 12), top = cy + 14;
  if (top + ph > vh - 12) top = cy - ph - 14;
  picker.style.left = left + 'px'; picker.style.top = clamp(top, 12, Math.max(12, vh - ph - 12)) + 'px';
  if (matchMedia('(pointer: fine)').matches) $('pkInput').focus({ preventScroll: true });
}
function closePicker() { picker.hidden = true; }
$('pkClose').addEventListener('click', () => { pendingPoint = null; closePicker(); });
$('pkSet').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; pkSet = b.dataset.set; renderPicker(); });
$('pkForm').addEventListener('submit', (e) => { e.preventDefault(); const v = $('pkInput').value.trim(); if (v) addMarkerRow(v.replace(/\D/g, '') || v); });
$('pkNone').addEventListener('click', () => addMarkerRow(''));
document.addEventListener('pointerdown', (e) => {
  if (!picker.hidden && !picker.contains(e.target) && e.target !== img) { pendingPoint = null; closePicker(); }
});
window.addEventListener('resize', closePicker);

function updateHint() {
  const h = $('vhint');
  if (placingRowId) { h.innerHTML = '<span class="placing-note">Кликните по снимку, чтобы поставить метку для строки</span><span><kbd>Esc</kbd> отмена</span>'; }
  else h.innerHTML = '<span>Клик по снимку ставит метку зуба</span><span>Точку и цифру можно перетаскивать</span><span><kbd>Delete</kbd> удаляет выбранную метку</span>';
}

/* ---------- fields ---------- */
$('fPatient').addEventListener('input', (e) => { S.patient = e.target.value; save(); });
$('fDate').addEventListener('input', (e) => { S.date = e.target.value; save(); });
$('fDoctor').addEventListener('input', (e) => { S.doctor = e.target.value; save(); });
$('fNote').addEventListener('input', (e) => { S.note = e.target.value; save(); });
$('sizeSeg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.size = b.dataset.size; renderAll(); save(); });
$('newPlan').addEventListener('click', () => {
  snapshot('Начат новый план');
  S.images = []; S.rows = []; S.active = null; S.example = false; S.patient = ''; S.doctor = S.doctor; selected = null; placingRowId = null;
  renderAll(); save();
});

/* ---------- price list ---------- */
function renderPrices() {
  const box = $('plist'); box.replaceChildren();
  const note = document.createElement('div'); note.className = 'note';
  note.textContent = pricesAreExample
    ? 'Цены здесь для примера, замените своими. Когда в строке выбрана работа из прайса, цена подставится сама.'
    : 'Когда в строке выбрана работа из прайса, цена подставится сама. Прайс хранится только в этом браузере.';
  box.appendChild(note);
  prices.forEach((p) => {
    const r = document.createElement('div'); r.className = 'prow';
    r.innerHTML = '<input class="in pn" aria-label="Название работы"><input class="in pp" inputmode="numeric" aria-label="Цена"><button type="button" class="ic del" aria-label="Удалить из прайса">×</button>';
    const n = r.querySelector('.pn'), v = r.querySelector('.pp');
    n.value = p.name; v.value = fmt(p.price);
    n.addEventListener('input', () => { p.name = n.value; touchPrices(); });
    v.addEventListener('focus', () => { v.value = String(p.price || ''); });
    v.addEventListener('input', () => { p.price = Number(v.value.replace(/\D/g, '')) || 0; touchPrices(); });
    v.addEventListener('blur', () => { v.value = fmt(p.price); });
    r.querySelector('.del').addEventListener('click', () => { prices = prices.filter((x) => x !== p); touchPrices(); renderPrices(); });
    box.appendChild(r);
  });
  const add = document.createElement('button'); add.type = 'button'; add.className = 'btn small'; add.textContent = '+ Работа в прайс'; add.style.alignSelf = 'flex-start';
  add.addEventListener('click', () => { prices.push({ id: uid(), name: '', price: 0 }); touchPrices(); renderPrices(); box.querySelectorAll('.pn')[prices.length - 1]?.focus(); });
  box.appendChild(add);
  renderDatalist();
}
function touchPrices() { pricesAreExample = false; savePrices(); renderDatalist(); }
function renderDatalist() {
  const dl = $('priceNames'); dl.replaceChildren();
  prices.filter((p) => p.name.trim()).forEach((p) => { const o = document.createElement('option'); o.value = p.name; o.label = fmt(p.price) + ' ' + CURRENCY; dl.appendChild(o); });
}

/* ---------- sheet composition ----------
   One layout, two renderers: canvas (PNG, preview) and jsPDF (PDF with real, selectable text).
   Layout units are pixels of an A4 page 1240×1754 (150 dpi). */
const INK = '#14201F', MUTED = '#5E6D6C', LINE = '#D3DCDA', HEAD = '#EAF1EF', ZEBRA = '#F7FAF9', MARK = '#F4B41A', MARK_INK = '#1B1400';
const UI = '"Golos Text", "Segoe UI", system-ui, sans-serif', NUM = '"IBM Plex Mono", ui-monospace, monospace';
const PAGE_W = 1240, PAGE_H = 1754;
async function fontsReady() {
  try { await Promise.all([document.fonts.load(`400 20px "Golos Text"`), document.fonts.load(`600 20px "Golos Text"`), document.fonts.load(`500 20px "IBM Plex Mono"`), document.fonts.load(`600 20px "IBM Plex Mono"`)]); } catch (e) {}
}
function wrap(measure, text, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean); const lines = []; let cur = '';
  for (const w of words) {
    const t = cur ? cur + ' ' + w : w;
    if (measure(t) <= width) cur = t;
    else { if (cur) lines.push(cur); cur = w; while (measure(cur) > width && cur.length > 1) { let k = cur.length - 1; while (k > 1 && measure(cur.slice(0, k)) > width) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); } }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawMarker(ctx, px, py, lx, ly, label, r) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = r * 0.28; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(lx, ly); ctx.stroke();
  ctx.strokeStyle = MARK; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(lx, ly); ctx.stroke();
  ctx.fillStyle = MARK; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = r * 0.12;
  ctx.beginPath(); ctx.arc(px, py, r * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.font = `600 ${Math.round(r * 0.95)}px ${NUM}`;
  const tw = ctx.measureText(label).width, w = Math.max(r * 2, tw + r * 0.9);
  ctx.beginPath(); ctx.roundRect(lx - w / 2, ly - r, w, r * 2, r); ctx.fill(); ctx.stroke();
  ctx.fillStyle = MARK_INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, lx, ly + r * 0.06);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
/* The snapshot with its markers, drawn at 2× the size it takes on the page. */
async function snapshotCanvas(im, dw, dh) {
  const el = await loadImg(im.url), k = 2, c = document.createElement('canvas');
  c.width = Math.round(dw * k); c.height = Math.round(dh * k);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.save(); g.beginPath(); g.roundRect(0, 0, c.width, c.height, 10 * k); g.clip(); g.drawImage(el, 0, 0, c.width, c.height); g.restore();
  const base = 17 * k * (S.size === 's' ? 0.85 : S.size === 'l' ? 1.25 : 1);
  S.rows.filter((r) => r.imageId === im.id).forEach((r) => drawMarker(g, r.x * c.width, r.y * c.height, r.lx * c.width, r.ly * c.height, r.tooth || '•', base));
  return c;
}

function canvasRenderer(paged) {
  const pages = []; let ctx;
  return {
    paged,
    newPage() { const c = document.createElement('canvas'); c.width = PAGE_W; c.height = paged ? PAGE_H : 16000; ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); pages.push(c); },
    font(fam, weight, size) { ctx.font = `${weight} ${size}px ${fam === 'num' ? NUM : UI}`; },
    measure(t) { return ctx.measureText(t).width; },
    text(t, x, y, color, align = 'left') { ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(t, x, y); ctx.textAlign = 'left'; },
    rect(x, y, w, h, color) { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); },
    rrect(x, y, w, h, r, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill(); },
    image(c, x, y, w, h) { ctx.drawImage(c, x, y, w, h); },
    eachPage(fn) { pages.forEach((p, i) => { ctx = p.getContext('2d'); fn(i, pages.length); }); },
    result(lastY) {
      if (paged) return pages;
      const out = document.createElement('canvas'); out.width = PAGE_W; out.height = Math.ceil(lastY);
      out.getContext('2d').drawImage(pages[0], 0, 0); return [out];
    },
  };
}

function pdfRenderer() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const k = 595.28 / PAGE_W;
  const F = window.PDF_FONTS;
  [['ui', 'normal'], ['ui', 'bold'], ['num', 'normal'], ['num', 'bold']].forEach(([fam, style]) => {
    const file = `${fam}-${style}.ttf`; doc.addFileToVFS(file, F[`${fam}-${style}`]); doc.addFont(file, fam, style);
  });
  const clean = (t) => String(t).replace(/ /g, ' ');
  let first = true;
  doc.setProperties({ title: 'План лечения' + (S.patient ? ' — ' + S.patient : ''), creator: 'План лечения на снимке' });
  return {
    paged: true,
    newPage() { if (!first) doc.addPage(); first = false; },
    font(fam, weight, size) { doc.setFont(fam, weight >= 600 ? 'bold' : 'normal'); doc.setFontSize(size * k); },
    measure(t) { return doc.getTextWidth(clean(t)) / k; },
    text(t, x, y, color, align = 'left') { doc.setTextColor(color); doc.text(clean(t), x * k, y * k, { align, baseline: 'alphabetic' }); },
    rect(x, y, w, h, color) { doc.setFillColor(color); doc.rect(x * k, y * k, w * k, h * k, 'F'); },
    rrect(x, y, w, h, r, color) { doc.setFillColor(color); doc.roundedRect(x * k, y * k, w * k, h * k, r * k, r * k, 'F'); },
    image(c, x, y, w, h) { doc.addImage(c.toDataURL('image/jpeg', 0.9), 'JPEG', x * k, y * k, w * k, h * k, undefined, 'FAST'); },
    eachPage(fn) { const n = doc.getNumberOfPages(); for (let i = 0; i < n; i++) { doc.setPage(i + 1); fn(i, n); } },
    result() { return doc; },
  };
}

async function layout(R) {
  await fontsReady();
  const W = PAGE_W, H = PAGE_H, M = 84, CW = W - 2 * M;
  const bottom = R.paged ? H - M - 36 : Infinity;
  let y;
  const newPage = () => { R.newPage(); y = M; };
  newPage();
  // header
  R.font('ui', 600, 46); R.text('План лечения', M, y + 40, INK);
  if (S.date) { const [yy, mm, dd] = S.date.split('-'); R.font('num', 500, 24); R.text(`${dd}.${mm}.${yy}`, W - M, y + 38, MUTED, 'right'); }
  y += 72;
  for (const [k, v] of [['Пациент', S.patient], ['Врач', S.doctor]].filter((m) => m[1].trim())) {
    R.font('ui', 400, 25); R.text(k, M, y + 24, MUTED); R.text(v, M + 140, y + 24, INK); y += 38;
  }
  y += 10; R.rect(M, y, CW, 3, INK); y += 30;
  // snapshots
  for (let i = 0; i < S.images.length; i++) {
    const im = S.images[i];
    const maxH = R.paged ? 780 : 900, sc = Math.min(CW / im.w, maxH / im.h), dw = im.w * sc, dh = im.h * sc;
    const cap = S.images.length > 1 ? 34 : 0;
    let snap; try { snap = await snapshotCanvas(im, dw, dh); } catch (e) { continue; }
    if (y + cap + dh > bottom) newPage();
    if (cap) { R.font('ui', 500, 21); R.text(`Снимок ${i + 1}`, M, y + 22, MUTED); y += cap; }
    R.image(snap, M + (CW - dw) / 2, y, dw, dh);
    y += dh + 34;
  }
  // table
  const cols = [
    { w: 54, label: '№' }, { w: 86, label: 'Зуб' }, { w: 420, label: 'Работа' },
    { w: CW - 54 - 86 - 420 - 190, label: 'Комментарий' }, { w: 190, label: `Стоимость, ${CURRENCY}`, right: true },
  ];
  const header = () => {
    R.rect(M, y, CW, 50, HEAD); R.font('ui', 600, 20); let x = M;
    for (const col of cols) { if (col.right) R.text(col.label, x + col.w - 14, y + 32, MUTED, 'right'); else R.text(col.label, x + 14, y + 32, MUTED); x += col.w; }
    y += 50;
  };
  if (S.rows.length) {
    if (y + 50 + 60 > bottom) newPage();
    header();
    S.rows.forEach((r, i) => {
      R.font('ui', 400, 22); const wl = wrap((t) => R.measure(t), r.work || '—', cols[2].w - 28);
      R.font('ui', 400, 20); const cl = wrap((t) => R.measure(t), r.comment, cols[3].w - 28);
      const rh = Math.max(wl.length * 30, cl.length * 28, 30) + 24;
      if (y + rh > bottom) { newPage(); header(); }
      if (i % 2) R.rect(M, y, CW, rh, ZEBRA);
      R.rect(M, y + rh - 1, CW, 1, LINE);
      let x = M;
      R.font('num', 500, 20); R.text(String(i + 1), x + 14, y + 36, MUTED); x += cols[0].w;
      if (r.tooth) {
        R.font('num', 600, 20);
        if (r.imageId) { const tw = R.measure(r.tooth) + 20; R.rrect(x + 10, y + 14, tw, 30, 15, MARK); R.text(r.tooth, x + 20, y + 36, MARK_INK); }
        else R.text(r.tooth, x + 20, y + 36, INK);
      }
      x += cols[1].w;
      R.font('ui', 400, 22); wl.forEach((l, k) => R.text(l, x + 14, y + 36 + k * 30, INK)); x += cols[2].w;
      R.font('ui', 400, 20); cl.forEach((l, k) => R.text(l, x + 14, y + 35 + k * 28, MUTED)); x += cols[3].w;
      R.font('num', 500, 22); R.text(r.price === '' || r.price == null ? '—' : fmt(r.price), x + cols[4].w - 14, y + 36, INK, 'right');
      y += rh;
    });
    const sum = S.rows.reduce((s, r) => s + (Number(r.price) || 0), 0);
    if (y + 70 > bottom) newPage();
    y += 16; R.rect(M, y, CW, 2, INK); y += 46;
    R.font('ui', 600, 28); R.text('Итого', M + 14, y, INK);
    R.font('num', 600, 30); R.text(`${fmt(sum)} ${CURRENCY}`, W - M - 14, y, INK, 'right');
    y += 34;
  }
  if (S.note.trim()) {
    R.font('ui', 400, 20); y += 18;
    for (const para of S.note.split('\n')) for (const l of wrap((t) => R.measure(t), para, CW - 28)) { if (y + 30 > bottom) newPage(); R.text(l, M + 14, y + 22, MUTED); y += 30; }
  }
  if (R.paged) R.eachPage((i, n) => { R.font('ui', 400, 18); R.text(`стр. ${i + 1} из ${n}`, W - M, H - M / 2, MUTED, 'right'); });
  return R.result(y + M);
}

/* ---------- export ---------- */
const status = (t) => { $('status').textContent = t; };
function fileBase() {
  const name = (S.patient.trim() || 'пациент').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `План лечения — ${name} — ${S.date || today()}`;
}
function offer(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  status(`Сохранено: ${filename}`);
}
function needContent() { if (!S.images.length && !S.rows.length) { status('Сначала добавьте снимок или строки.'); return false; } return true; }
$('dlPdf').addEventListener('click', async () => {
  if (!needContent()) return;
  if (!window.jspdf?.jsPDF || !window.PDF_FONTS) { status('Не найдены файлы vendor/jspdf.umd.min.js или vendor/pdf-fonts.js. Положите папку vendor рядом с index.html.'); return; }
  status('Собираю PDF…');
  try { const doc = await layout(pdfRenderer()); offer(fileBase() + '.pdf', doc.output('blob')); }
  catch (e) { console.error(e); status('PDF не собрался. Попробуйте PNG и напишите, что пошло не так.'); }
});
$('dlPng').addEventListener('click', async () => {
  if (!needContent()) return;
  status('Собираю изображение…');
  const [c] = await layout(canvasRenderer(false));
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  offer(fileBase() + '.png', blob);
});
async function showPreview() {
  if (!needContent()) return;
  const pages = await layout(canvasRenderer(true));
  const body = $('modalBody'); body.replaceChildren();
  pages.forEach((p, i) => { const im = document.createElement('img'); im.alt = `Страница ${i + 1}`; im.src = p.toDataURL('image/png'); body.appendChild(im); });
  $('modal').hidden = false;
}
$('preview').addEventListener('click', showPreview);
$('modalClose').addEventListener('click', () => { $('modal').hidden = true; });
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').hidden = true; });

/* ---------- boot ---------- */
async function boot() {
  let draft = null;
  try { draft = await idbGet('draft'); } catch (e) {}
  if (draft && (draft.images?.length || draft.rows?.length || draft.patient)) {
    const images = (draft.images || []).filter((i) => i.blob).map((i) => ({ ...i, url: URL.createObjectURL(i.blob) }));
    S = { ...S, ...draft, images };
    delete S.currency;
    if (!S.images.some((i) => i.id === S.active)) S.active = S.images[0]?.id || null;
  } else {
    await loadExample();
  }
  renderAll(); renderPrices();
}
boot();
})();
