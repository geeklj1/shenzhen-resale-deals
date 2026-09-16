/**
 * 纯逻辑层：不依赖 DOM，可直接在 Node 里跑测试。
 * 数据为字典编码的行数组，列顺序见 C（与 build_web.py 的 COLUMNS 必须一致）。
 */

export const C = {
  date: 0, district: 1, area_group: 2, community: 3, built_year: 4, layout: 5,
  area: 6, total: 7, unit: 8, neg: 9, facing: 10, source: 11, period: 12,
  note: 13, dup_conf: 14, dup_candidates: 15, loose_merged: 16,
};

export const COLUMN_LABELS = [
  '成交日期', '行政区', '片区', '小区', '建成年份', '户型', '面积(㎡)',
  '总价(万)', '单价(万/㎡)', '谈价率(%)', '朝向', '来源', '统计期', '来源笔记',
  '去重口径', '重复候选', '宽松合并',
];

/** 从户型里取房数：行舟 "3室" → 3；品房君 "3-2-1-2" → 3。 */
export function roomsOf(layout) {
  if (!layout) return null;
  const m = String(layout).match(/^\s*(\d+)/);
  return m ? Number(m[1]) : null;
}

export const DEFAULTS = {
  q: '', districts: [], area_groups: [], rooms: [], facings: [],
  dateFrom: '', dateTo: '',
  areaMin: null, areaMax: null, totalMin: null, totalMax: null,
  unitMin: null, unitMax: null, builtMin: null, builtMax: null,
  negMin: null, negMax: null,
  dedupe: 'raw', onlyDupCandidates: false,
  sort: 'date', dir: 'desc', limit: 200,
};

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function passes(r, f, dict, roomCache) {
  if (f.dedupe === 'strict' && r[C.dup_conf] === 1) return false;
  if (f.dedupe === 'loose' && r[C.loose_merged] === 1) return false;
  if (f.onlyDupCandidates && !(r[C.dup_candidates] > 0)) return false;
  if (f.districts.length && !f.districts.includes(r[C.district])) return false;
  if (f.area_groups.length && !f.area_groups.includes(r[C.area_group])) return false;
  if (f.sources && f.sources.length && !f.sources.includes(r[C.source])) return false;
  if (f.facings.length) {   // facings 存的是方位位掩码（0=未标注），组合朝向按位命中
    const m = (dict.facing_mask && dict.facing_mask[r[C.facing]]) || 0;
    const orBits = f.facings.reduce((a, b) => a | b, 0);
    const wantUnlabeled = f.facings.includes(0);
    if (!((orBits && (m & orBits)) || (wantUnlabeled && m === 0))) return false;
  }
  if (f.rooms.length) {
    const rm = roomCache.get(r[C.layout]);
    if (rm === null || !f.rooms.includes(rm)) return false;
  }
  const date = r[C.date];
  if (f.dateFrom && (!date || date < f.dateFrom)) return false;
  if (f.dateTo && (!date || date > f.dateTo)) return false;
  const area = r[C.area], total = r[C.total], unit = r[C.unit], built = r[C.built_year], neg = r[C.neg];
  // 注意：JS 里 null <= 500 为 true，数值区间必须显式排除空值，否则缺数据的行会被算进来
  const inRange = (v, lo, hi) => (lo === null && hi === null) ? true
    : (v === null || v === undefined) ? false
      : (lo === null || v >= lo) && (hi === null || v <= hi);
  if (!inRange(area, f.areaMin, f.areaMax)) return false;
  if (!inRange(total, f.totalMin, f.totalMax)) return false;
  if (!inRange(unit, f.unitMin, f.unitMax)) return false;
  if (!inRange(built, f.builtMin, f.builtMax)) return false;
  if (f.negMin !== null && !(neg !== null && neg >= f.negMin)) return false;
  if (f.negMax !== null && !(neg !== null && neg <= f.negMax)) return false;
  if (f.q) {
    const hay = `${dict.community[r[C.community]] || ''} ${dict.area_group[r[C.area_group]] || ''} ${dict.district[r[C.district]] || ''}`;
    if (!hay.toLowerCase().includes(f.q.toLowerCase())) return false;
  }
  return true;
}

export function applyFilters(rows, f) {
  const dict = f.__dict;
  const roomCache = new Map();
  const out = [];
  for (const r of rows) {
    if (!roomCache.has(r[C.layout])) roomCache.set(r[C.layout], roomsOf(dict.layout[r[C.layout]]));
    if (passes(r, f, dict, roomCache)) out.push(r);
  }
  return out;
}

function cmp(a, b, key, dict) {
  const idx = C[key];
  if (key === 'date') return (a[0] || '').localeCompare(b[0] || '');
  if (key === 'community' || key === 'district' || key === 'area_group' || key === 'layout'
      || key === 'facing' || key === 'source' || key === 'period') {
    const ta = dict[key === 'period' ? 'period' : key];
    const va = key === 'period' ? (ta[a[idx]] ? ta[a[idx]].start || '' : '') : (ta[a[idx]] || '');
    const vb = key === 'period' ? (ta[b[idx]] ? ta[b[idx]].start || '' : '') : (ta[b[idx]] || '');
    return String(va).localeCompare(String(vb), 'zh');
  }
  const av = a[idx], bv = b[idx];
  return (av === null ? -Infinity : av) - (bv === null ? -Infinity : bv);
}

export function sortRows(rows, key, dir, dict) {
  const out = rows.slice();
  out.sort((a, b) => {
    const c = cmp(a, b, key, dict);
    return dir === 'asc' ? c : -c;
  });
  return out;
}

export function median(values) {
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function extent(values, fn) {
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return v.length ? fn(...v) : null;
}

export function mean(values) {
  const v = values.filter((x) => x !== null && x !== undefined && !Number.isNaN(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function summarize(rows, dict) {
  if (!rows.length) {
    return { count: 0, medianUnit: null, meanUnit: null, medianArea: null, minArea: null, maxArea: null,
      medianTotal: null, minTotal: null, maxTotal: null, dateFrom: null, dateTo: null,
      byDistrict: {} };
  }
  const units = rows.map((r) => r[C.unit]);
  const areas = rows.map((r) => r[C.area]);
  const totals = rows.map((r) => r[C.total]);
  const dates = rows.map((r) => r[C.date]).filter(Boolean).sort();
  const byDistrict = {};
  for (const r of rows) {
    const d = dict.district[r[C.district]] || '-';
    byDistrict[d] = (byDistrict[d] || 0) + 1;
  }
  return {
    count: rows.length,
    medianUnit: median(units), meanUnit: mean(units),
    medianArea: median(areas), minArea: extent(areas, Math.min), maxArea: extent(areas, Math.max),
    medianTotal: median(totals), minTotal: extent(totals, Math.min), maxTotal: extent(totals, Math.max),
    dateFrom: dates[0] || null, dateTo: dates[dates.length - 1] || null,
    byDistrict,
  };
}

const CSV_HEAD = ['成交日期', '统计期', '行政区', '片区', '小区', '建成年份', '户型',
  '面积(㎡)', '总价(万)', '单价(万/㎡)', '谈价率(%)', '朝向', '重复标记'];

export function toCSV(rows, dict) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_HEAD.join(',')];
  for (const r of rows) {
    const conf = dict.dup_conf[r[C.dup_conf]];
    const mark = [conf ? `疑似同一笔重复(${conf})` : '', r[C.dup_candidates] > 0 ? `可能重复x${r[C.dup_candidates]}` : '']
      .filter(Boolean).join('/');
    lines.push([
      r[C.date], dict.period[r[C.period]] ? dict.period[r[C.period]].label : '',
      dict.district[r[C.district]], dict.area_group[r[C.area_group]], dict.community[r[C.community]],
      r[C.built_year], dict.layout[r[C.layout]], r[C.area], r[C.total], r[C.unit], r[C.neg],
      dict.facing[r[C.facing]], mark,
    ].map(esc).join(','));
  }
  return lines.join('\n');
}
