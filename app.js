import {
  C, DEFAULTS, applyFilters, sortRows, summarize, trendByPeriod, toCSV, roomsOf,
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

const NUM_FIELDS = ['areaMin', 'areaMax', 'totalMin', 'totalMax', 'unitMin', 'unitMax',
  'builtMin', 'builtMax', 'negMin', 'negMax'];

/* ---------- 过滤器 ⇄ URL ---------- */
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

/* ---------- 过滤器控件 ---------- */
function chipGroup(host, values, key, labels) {
  host.textContent = '';
  values.forEach((v, i) => {
    const id = `${key}-${i}`;
    const wrap = el('label', 'chip');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.value = String(v);
    cb.id = id;
    if (FILTERS[key].includes(v)) cb.checked = true;
    cb.addEventListener('change', () => {
      const set = new Set(FILTERS[key]);
      if (cb.checked) set.add(v); else set.delete(v);
      FILTERS[key] = [...set];
      update();
    });
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
  chipGroup($('#sources'), DICT.source.map((_, i) => i), 'sources', DICT.source);
  chipGroup($('#rooms'), [1, 2, 3, 4, 5, 6], 'rooms', ['1室', '2室', '3室', '4室', '5室', '6室+']);
  // 朝向按位掩码筛选：东1 南2 西4 北8 东南16 西南32 东北64 西北128，0=未标注
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
    FILTERS.area_groups = names
      .map((n) => DICT.area_group.findIndex((g) => g === n))
      .filter((i) => i >= 0);
    update();
  });

  const q = $('#q');
  q.value = FILTERS.q;
  q.addEventListener('input', () => { FILTERS.q = q.value.trim(); update(); });

  bindDate('#dateFrom', 'dateFrom');
  bindDate('#dateTo', 'dateTo');
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
  dirBtn.textContent = FILTERS.dir === 'desc' ? '降序 ↓' : '升序 ↑';
  dirBtn.addEventListener('click', () => {
    FILTERS.dir = FILTERS.dir === 'desc' ? 'asc' : 'desc';
    dirBtn.textContent = FILTERS.dir === 'desc' ? '降序 ↓' : '升序 ↑';
    update();
  });

  $('#resetBtn').addEventListener('click', () => {
    FILTERS = { ...DEFAULTS };
    location.hash = '';
    initControls();
    update();
  });
  $('#moreBtn').addEventListener('click', () => { FILTERS.limit += 300; render(); });
  $('#exportBtn').addEventListener('click', () => {
    const csv = '\uFEFF' + toCSV(FILTERED, DICT);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = el('a');
    a.href = url;
    a.download = `深圳二手房成交_${FILTERED.length}条.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $('#shareBtn').addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#${filtersToHash()}`;
    try { await navigator.clipboard.writeText(url); $('#shareBtn').textContent = '已复制链接'; }
    catch { $('#shareBtn').textContent = url; }
    setTimeout(() => { $('#shareBtn').textContent = '复制筛选链接'; }, 1500);
  });
  $('#presetBox').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-preset]');
    if (!b) return;
    applyPreset(b.dataset.preset);
  });
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
  if (name === 'nanshan-weekly') f.sources = [DICT.source.indexOf('品房君周报')];
  if (name === 'haggle10') f.negMax = -10;
  if (name === 'small') f.areaMax = 60;
  if (name === 'core90') { f.areaMin = 60; f.areaMax = 90; }
  if (name === 'bargain-hunt') { f.negMax = -15; f.totalMax = 1000; }
  FILTERS = f;
  location.hash = filtersToHash();
  initControls();
  update();
}

/* ---------- 渲染 ---------- */
function renderStats(s) {
  const box = $('#stats');
  box.textContent = '';
  const items = [
    ['条数', `${s.count.toLocaleString()}`],
    ['中位单价', `${fmt(s.medianUnit)} 万/㎡`],
    ['均价(单价)', `${fmt(s.meanUnit)} 万/㎡`],
    ['中位面积', `${fmt(s.medianArea, 1)} ㎡`],
    ['中位总价', `${fmt(s.medianTotal, 1)} 万`],
    ['价格范围', `${fmt(s.minTotal, 0)}–${fmt(s.maxTotal, 0)} 万`],
    ['日期范围', `${s.dateFrom || '—'} ~ ${s.dateTo || '—'}`],
  ];
  for (const [k, v] of items) {
    const c = el('div', 'stat');
    c.append(el('div', 'stat-k', k), el('div', 'stat-v', v));
    box.append(c);
  }
  const src = el('div', 'stat');
  src.append(el('div', 'stat-k', '来源构成'),
    el('div', 'stat-v', Object.entries(s.bySource).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'));
  box.append(src);
}

function renderTrend() {
  const host = $('#trend');
  host.textContent = '';
  const t = trendByPeriod(FILTERED, DICT);
  const multiSource = new Set(FILTERED.map((r) => r[C.source])).size > 1;
  if (t.length < 2) { host.append(el('div', 'hint', '统计期不足 2 个，无法画走势')); return; }
  const w = host.clientWidth || 700, h = 90, pad = 6;
  const vals = t.map((p) => p.medianUnit).filter((v) => v !== null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(t.length - 1, 1);
  const y = (v) => h - pad - ((v - lo) / Math.max(hi - lo, 0.01)) * (h - pad * 2);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'spark');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', t.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.medianUnit).toFixed(1)}`).join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#2f81f7');
  path.setAttribute('stroke-width', '2');
  svg.append(path);
  t.forEach((p, i) => {
    const c = document.createElementNS(svg.namespaceURI, 'circle');
    c.setAttribute('cx', x(i)); c.setAttribute('cy', y(p.medianUnit)); c.setAttribute('r', 2.5);
    c.setAttribute('fill', '#2f81f7');
    const title = document.createElementNS(svg.namespaceURI, 'title');
    title.textContent = `${p.label}｜${p.count} 条｜中位单价 ${fmt(p.medianUnit)} 万/㎡`;
    c.append(title);
    svg.append(c);
  });
  host.append(svg);
  host.append(el('div', 'hint',
    `中位单价走势：${t[0].label} ${fmt(t[0].medianUnit)} → ${t[t.length - 1].label} ${fmt(t[t.length - 1].medianUnit)} 万/㎡`
    + (multiSource ? '　⚠️ 当前混选了多个来源，两源样本构成不同，走势仅供参考' : '')));
}

function cellMark(r) {
  const conf = DICT.dup_conf[r[C.dup_conf]];
  const n = r[C.dup_candidates];
  if (!conf && !n) return null;
  const span = el('span', 'mark', conf ? (conf === 'high' ? '重复' : '疑似重复') : '可能重复');
  span.title = conf
    ? `与另一来源的记录判为同一笔（置信度 ${conf}），可切换"去重口径"排除`
    : `另有 ${n} 条来自另一来源的候选记录，但 key 在来源内碰撞，无法证实是否同一笔`;
  return span;
}

function render() {
  renderStats(summarize(FILTERED, DICT));
  renderTrend();
  const tbody = $('#tbody');
  tbody.textContent = '';
  const page = FILTERED.slice(0, FILTERS.limit);
  const frag = document.createDocumentFragment();
  for (const r of page) {
    const tr = el('tr');
    tr.append(el('td', null, r[C.date] || '—'));
    const srcTd = el('td');
    srcTd.append(el('span', `badge ${r[C.source] === 0 ? 'b-a' : 'b-b'}`, DICT.source[r[C.source]]));
    tr.append(srcTd);
    tr.append(el('td', null, DICT.district[r[C.district]] || '—'));
    tr.append(el('td', null, DICT.area_group[r[C.area_group]] || '—'));
    const cTd = el('td');
    const a = el('a', 'link', DICT.community[r[C.community]] || '—');
    a.href = 'javascript:void(0)';
    a.addEventListener('click', () => {
      $('#q').value = DICT.community[r[C.community]];
      FILTERS.q = $('#q').value;
      update();
    });
    cTd.append(a);
    tr.append(cTd);
    tr.append(el('td', null, fmtInt(r[C.built_year])));
    tr.append(el('td', null, DICT.layout[r[C.layout]] || '—'));
    tr.append(el('td', 'num', fmt(r[C.area], 1)));
    tr.append(el('td', 'num', fmt(r[C.total], 0)));
    tr.append(el('td', 'num strong', fmt(r[C.unit])));
    const neg = r[C.neg];
    const negTd = el('td', 'num');
    if (neg !== null && neg !== undefined) {
      negTd.append(el('span', neg <= -10 ? 'neg strong' : 'neg', `${fmt(neg, 2)}%`));
    } else negTd.textContent = '—';
    tr.append(negTd);
    tr.append(el('td', null, DICT.facing[r[C.facing]] || '—'));
    const mTd = el('td');
    const m = cellMark(r);
    if (m) mTd.append(m);
    if (r[C.note] !== undefined && DICT.note[r[C.note]]) {
      const link = el('a', 'link src', '原笔记');
      link.href = DICT.note[r[C.note]].url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = `${DICT.note[r[C.note]].title}（${DICT.note[r[C.note]].author}）`;
      mTd.append(link);
    }
    tr.append(mTd);
    frag.append(tr);
  }
  tbody.append(frag);
  $('#count').textContent = `命中 ${FILTERED.length.toLocaleString()} 条，当前显示 ${page.length} 条`;
  $('#moreBtn').style.display = FILTERED.length > page.length ? '' : 'none';
}

function update() {
  FILTERED = sortRows(applyFilters(ROWS, { ...FILTERS, __dict: DICT }), FILTERS.sort, FILTERS.dir, DICT);
  history.replaceState(null, '', `#${filtersToHash()}`);
  render();
}

/* ---------- 启动 ---------- */
async function boot() {
  const res = await fetch('data/deals.json');
  const doc = await res.json();
  DICT = doc.dict;
  ROWS = doc.rows;
  window.__DATA__ = doc;
  FILTERS = hashToFilters();
  const dates = ROWS.map((r) => r[C.date]).filter(Boolean).sort();
  MAX_DATE = dates[dates.length - 1] || '';
  const dr = [dates[0], MAX_DATE];
  $('#meta').textContent = `数据 ${doc.count.toLocaleString()} 条 · ${DICT.community.length.toLocaleString()} 小区 · `
    + `${DICT.area_group.filter(Boolean).length} 片区 · ${DICT.period.length} 个统计期 · ${dr[0]}~${dr[1]} · 生成于 ${doc.generated}`;
  initControls();
  update();
  window.addEventListener('resize', renderTrend);
}

boot().catch((e) => {
  $('#meta').textContent = `数据加载失败：${e.message}（请确认 data/deals.json 已随站点一起部署）`;
});
