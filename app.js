import {
  C, DEFAULTS, applyFilters, sortRows, summarize, toCSV,
} from './core.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(d));
const fmtInt = (v) => (v === null || v === undefined ? '—' : String(Math.round(v)));

let DICT = null;
let ROWS = [];
let FILTERS = { ...DEFAULTS };
let FILTERED = [];
let MAX_DATE = '';
let observer = null;

const PAGE_FIRST = 60;
const PAGE_STEP = 120;
const NUM_FIELDS = ['areaMin', 'areaMax', 'totalMin', 'totalMax', 'unitMin', 'unitMax',
  'builtMin', 'builtMax', 'negMin', 'negMax'];

/* ---------- 筛选状态 ⇄ URL ---------- */
function filtersToHash() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(FILTERS)) {
    if (k === 'limit') continue;
    if (Array.isArray(v)) { if (v.length) p.set(k, v.join('.')); }
    else if (v !== null && v !== '' && v !== false && v !== DEFAULTS[k]) p.set(k, String(v));
  }
  return p.toString();
}
function hashToFilters() {
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  const f = { ...DEFAULTS };
  for (const [k, v] of p.entries()) {
    if (!(k in DEFAULTS)) continue;
    if (Array.isArray(DEFAULTS[k])) f[k] = v ? v.split('.').map(Number) : [];
    else if (typeof DEFAULTS[k] === 'boolean') f[k] = v === 'true';
    else if (NUM_FIELDS.includes(k)) f[k] = v === '' ? null : Number(v);
    else f[k] = v;
  }
  return f;
}

/* ---------- 控件 ---------- */
function chipGroup(host, values, key, labels) {
  host.textContent = '';
  values.forEach((v, i) => {
    const cb = el('input');
    cb.type = 'checkbox';
    cb.value = String(v);
    if (FILTERS[key].includes(v)) cb.checked = true;
    cb.addEventListener('change', () => {
      const set = new Set(FILTERS[key]);
      if (cb.checked) set.add(v); else set.delete(v);
      FILTERS[key] = [...set];
      update();
    });
    const wrap = el('label', 'chip');
    wrap.append(cb, el('span', null, labels ? labels[i] : String(v)));
    host.append(wrap);
  });
}

function bindNumber(id, key) {
  const input = $(id);
  input.value = FILTERS[key] === null ? '' : FILTERS[key];
  input.addEventListener('input', () => {
    FILTERS[key] = input.value === '' ? null : Number(input.value);
    update();
  });
}
function bindDate(id, key) {
  const input = $(id);
  input.value = FILTERS[key] || '';
  input.addEventListener('change', () => { FILTERS[key] = input.value; update(); });
}

function initControls() {
  chipGroup($('#districts'), DICT.district.map((_, i) => i), 'districts', DICT.district);
  chipGroup($('#rooms'), [1, 2, 3, 4, 5, 6], 'rooms', ['1室', '2室', '3室', '4室', '5室', '6室+']);
  // 朝向按位掩码：东1 南2 西4 北8 东南16 西南32 东北64 西北128，0=未标注
  chipGroup($('#facings'), [0, 1, 2, 4, 8, 16, 32, 64, 128], 'facings',
    ['未标注', '东', '南', '西', '北', '东南', '西南', '东北', '西北']);

  const dl = $('#groupList');
  dl.textContent = '';
  DICT.area_group.forEach((g) => {
    if (!g) return;
    const o = el('option');
    o.value = g;
    dl.append(o);
  });
  const gInput = $('#groups');
  gInput.value = FILTERS.area_groups.map((i) => DICT.area_group[i]).join(' ');
  gInput.addEventListener('input', () => {
    const names = gInput.value.split(/[\s,，、]+/).filter(Boolean);
    FILTERS.area_groups = names.map((n) => DICT.area_group.findIndex((g) => g === n)).filter((i) => i >= 0);
    update();
  });

  const q = $('#q');
  q.value = FILTERS.q;
  q.addEventListener('input', () => { FILTERS.q = q.value.trim(); update(); });

  bindDate('#dateFrom', 'dateFrom'); bindDate('#dateTo', 'dateTo');
  bindNumber('#areaMin', 'areaMin'); bindNumber('#areaMax', 'areaMax');
  bindNumber('#totalMin', 'totalMin'); bindNumber('#totalMax', 'totalMax');
  bindNumber('#unitMin', 'unitMin'); bindNumber('#unitMax', 'unitMax');
  bindNumber('#builtMin', 'builtMin'); bindNumber('#builtMax', 'builtMax');
  bindNumber('#negMin', 'negMin'); bindNumber('#negMax', 'negMax');

  document.querySelectorAll('input[name=dedupe]').forEach((r) => {
    r.checked = r.value === FILTERS.dedupe;
    r.addEventListener('change', () => { if (r.checked) { FILTERS.dedupe = r.value; update(); } });
  });
  const dupOnly = $('#onlyDup');
  dupOnly.checked = FILTERS.onlyDupCandidates;
  dupOnly.addEventListener('change', () => { FILTERS.onlyDupCandidates = dupOnly.checked; update(); });

  const sortSel = $('#sort');
  sortSel.value = FILTERS.sort;
  sortSel.addEventListener('change', () => { FILTERS.sort = sortSel.value; update(); });
  const dirBtn = $('#dirBtn');
  dirBtn.textContent = FILTERS.dir === 'desc' ? '↓' : '↑';
  dirBtn.addEventListener('click', () => {
    FILTERS.dir = FILTERS.dir === 'desc' ? 'asc' : 'desc';
    dirBtn.textContent = FILTERS.dir === 'desc' ? '↓' : '↑';
    update();
  });

  $('#resetBtn').addEventListener('click', () => {
    FILTERS = { ...DEFAULTS };
    location.hash = '';
    initControls();
    update();
  });
  $('#moreBtn').addEventListener('click', loadMore);
  $('#filterBtn').addEventListener('click', () => openSheet(true));
  $('#closeSheet').addEventListener('click', () => openSheet(false));
  $('#applyBtn').addEventListener('click', () => openSheet(false));
  $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') openSheet(false); });
  $('#exportBtn').addEventListener('click', () => {
    // 导出「当前筛选的全部结果」，而不只是已加载的那些
    const all = sortRows(applyFilters(ROWS, { ...FILTERS, __dict: DICT }), FILTERS.sort, FILTERS.dir, DICT);
    const csv = '\uFEFF' + toCSV(all, DICT);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a');
    a.href = url;
    a.download = `深圳二手房成交_${all.length}条.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $('#shareBtn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#${filtersToHash()}`;
    try { await navigator.clipboard.writeText(url); $('#shareBtn').textContent = '已复制 ✓'; }
    catch { $('#shareBtn').textContent = url; }
    setTimeout(() => { $('#shareBtn').textContent = '复制筛选链接'; }, 1600);
  });
  $('#presetBox').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-preset]');
    if (b) applyPreset(b.dataset.preset);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') openSheet(false); });
}

function openSheet(open) {
  $('#sheet').classList.toggle('open', open);
  $('#filterBtn').setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
}

function activeFilterCount() {
  let n = 0;
  for (const k of ['districts', 'area_groups', 'rooms', 'facings']) if ((FILTERS[k] || []).length) n++;
  for (const k of [...NUM_FIELDS, 'dateFrom', 'dateTo']) if (FILTERS[k] !== null && FILTERS[k] !== '') n++;
  if (FILTERS.dedupe !== 'raw') n++;
  if (FILTERS.onlyDupCandidates) n++;
  return n;
}

function shiftDate(days) {
  const d = new Date(`${MAX_DATE}T00:00:00`);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function applyPreset(name) {
  const f = { ...DEFAULTS };
  if (name === 'recent30') f.dateFrom = shiftDate(30);
  if (name === 'recent90') f.dateFrom = shiftDate(90);
  if (name === 'recent180') f.dateFrom = shiftDate(180);
  if (name === 'nanshan') f.districts = [DICT.district.indexOf('南山区')];
  if (name === 'haggle10') f.negMax = -10;
  if (name === 'small') f.areaMax = 60;
  if (name === 'core90') { f.areaMin = 60; f.areaMax = 90; }
  if (name === 'bargain-hunt') { f.negMax = -15; f.totalMax = 1000; }
  FILTERS = f;
  location.hash = filtersToHash();
  initControls();
  document.querySelectorAll('#presetBox button').forEach((b) => b.classList.toggle('p', b.dataset.preset === name));
  update();
}

/* ---------- 展示 ---------- */
function renderStats(s) {
  const box = $('#stats');
  box.textContent = '';
  const items = [
    ['命中', `${s.count.toLocaleString()} 条`],
    ['中位单价', s.medianUnit === null ? '—' : `${fmt(s.medianUnit)} 万/㎡`],
    ['中位总价', s.medianTotal === null ? '—' : `${fmt(s.medianTotal, 0)} 万`],
    ['中位面积', s.medianArea === null ? '—' : `${fmt(s.medianArea, 1)} ㎡`],
    ['总价区间', `${fmt(s.minTotal, 0)}–${fmt(s.maxTotal, 0)} 万`],
    ['日期', `${(s.dateFrom || '—').slice(2)} ~ ${(s.dateTo || '—').slice(2)}`],
  ];
  for (const [k, v] of items) {
    const c = el('div', 'sumchip');
    c.append(el('div', 'k', k), el('div', 'v', v));
    box.append(c);
  }
}

function markOf(r) {
  const conf = DICT.dup_conf[r[C.dup_conf]];
  const n = r[C.dup_candidates];
  if (!conf && !n) return null;
  const s = el('span', 'mark', conf ? (conf === 'high' ? '重复' : '疑似重复') : '可能重复');
  s.title = conf
    ? `可能与其他记录为同一笔成交（置信度 ${conf}），可切换「去重口径」排除`
    : `另有 ${n} 条疑似同一笔成交的记录，但无法证实`;
  return s;
}

function card(r) {
  const a = el('article', 'card');
  a.dataset.unit = r[C.unit] === null ? '' : r[C.unit];
  a.dataset.community = DICT.community[r[C.community]] || '';
  const top = el('div', 'top');
  const name = el('div', 'name', DICT.community[r[C.community]] || '（未标注小区）');
  name.addEventListener('click', () => {
    FILTERS.q = DICT.community[r[C.community]] || '';
    $('#q').value = FILTERS.q;
    update();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  top.append(name);
  a.append(top);

  const meta = el('div', 'meta');
  const parts = [
    [DICT.district[r[C.district]], DICT.area_group[r[C.area_group]]].filter(Boolean).join(' · '),
    r[C.area] === null ? null : `${fmt(r[C.area], 1)} ㎡`,
    DICT.layout[r[C.layout]],
    DICT.facing[r[C.facing]],
    r[C.built_year] ? `${fmtInt(r[C.built_year])} 年建成` : null,
    r[C.date] || null,
  ].filter(Boolean);
  for (const p of parts) meta.append(el('span', null, p));
  a.append(meta);

  const price = el('div', 'price');
  const total = el('span', 'total', fmt(r[C.total], 0));
  total.append(el('small', null, '万'));
  price.append(total);
  if (r[C.unit] !== null) price.append(el('span', 'unit', `${fmt(r[C.unit])} 万/㎡`));
  const neg = r[C.neg];
  if (neg !== null && neg !== undefined) {
    price.append(el('span', neg <= -10 ? 'neg strong' : 'neg', `砍价 ${fmt(neg, 2)}%`));
  }
  a.append(price);

  const m = markOf(r);
  if (m) {
    const foot = el('div', 'foot');
    foot.append(el('span', null, ''), m);
    a.append(foot);
  }
  return a;
}

function render() {
  renderStats(summarize(FILTERED, DICT));
  const list = $('#list');
  list.textContent = '';
  const page = FILTERED.slice(0, FILTERS.limit);
  if (!FILTERED.length) {
    const box = el('div', 'empty');
    box.append(el('div', null, '没有符合条件的成交记录'));
    const btn = el('button', null, '清空筛选');
    btn.addEventListener('click', () => { FILTERS = { ...DEFAULTS }; initControls(); update(); });
    box.append(btn);
    list.append(box);
  } else {
    const frag = document.createDocumentFragment();
    for (const r of page) frag.append(card(r));
    list.append(frag);
  }
  $('#count').textContent = `命中 ${FILTERED.length.toLocaleString()} 条 · 已显示 ${Math.min(page.length, FILTERED.length)}`;
  $('#moreBtn').style.display = FILTERED.length > page.length ? '' : 'none';
  const n = activeFilterCount();
  const badge = $('#activeCount');
  badge.textContent = String(n);
  badge.classList.toggle('show', n > 0);
  $('#filterBtn').classList.toggle('on', n > 0);
}

function loadMore() {
  if (FILTERED.length <= FILTERS.limit) return;
  FILTERS.limit += PAGE_STEP;
  render();
}

function update() {
  FILTERED = sortRows(applyFilters(ROWS, { ...FILTERS, __dict: DICT }), FILTERS.sort, FILTERS.dir, DICT);
  FILTERS.limit = Math.max(FILTERS.limit, PAGE_FIRST);
  history.replaceState(null, '', `#${filtersToHash()}`);
  render();
}

function setupAutoLoad() {
  if (!('IntersectionObserver' in window)) return;
  observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '600px 0px' });
  observer.observe($('#moreBtn'));
}

async function boot() {
  const res = await fetch('data/deals.json');
  const doc = await res.json();
  DICT = doc.dict;
  ROWS = doc.rows;
  FILTERS = hashToFilters();
  FILTERS.limit = PAGE_FIRST;
  const dates = ROWS.map((r) => r[C.date]).filter(Boolean).sort();
  MAX_DATE = dates[dates.length - 1] || '';
  $('#meta').textContent = `${doc.count.toLocaleString()} 条成交 · ${DICT.community.filter(Boolean).length.toLocaleString()} 小区 · `
    + `${DICT.area_group.filter(Boolean).length} 片区 · ${dates[0]}~${MAX_DATE}`;
  initControls();
  update();
  setupAutoLoad();
}

boot().catch((e) => {
  $('#meta').textContent = `数据加载失败：${e.message}`;
});
