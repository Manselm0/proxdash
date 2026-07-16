// ── Time range button helpers ─────────────────────────────────────────────
function _histGetHours(prefix) {
  const range = el(prefix + '-hist-range');
  if (!range) return 168;
  const active = range.querySelector('.hist-btn.active');
  return _histHours[active?.textContent?.trim()] || 168;
}

const _chartCanvasMap = {
  'ov-net':'chart-ov-net',
  'px':'chart-proxmox', 'pxnet':'chart-pxnet-in',
};

function _chartShowSkeleton(id) {
  const c = el(id); if (!c) return;
  const wrap = c.parentNode;
  if (wrap.querySelector('.chart-sk')) return;
  const sk = document.createElement('div');
  sk.className = 'chart-sk skeleton';
  sk.style.cssText = 'position:absolute;inset:0;border-radius:6px;z-index:2;opacity:0;transition:opacity .15s ease';
  wrap.style.position = 'relative';
  wrap.appendChild(sk);
  requestAnimationFrame(() => { sk.style.opacity = '1'; });
}

function _chartHideSkeleton(id) {
  const c = el(id); if (!c) return;
  const sk = c.parentNode.querySelector('.chart-sk');
  if (!sk) return;
  sk.style.opacity = '0';
  setTimeout(() => sk.remove(), 200);
}

const _CAL_ICO='<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>';

function _histEnsureThumb(range) {
  if (!range.querySelector('.hist-thumb')) {
    const t = document.createElement('div');
    t.className = 'hist-thumb';
    t.style.cssText = 'width:0;height:calc(100% - 6px)';
    range.insertBefore(t, range.firstChild);
  }
}

function _histThumbUpdate(prefix) {
  const range = document.getElementById(prefix + '-hist-range');
  if (!range) return;
  _histEnsureThumb(range);
  const thumb = range.querySelector('.hist-thumb');
  if (!thumb) return;
  const active = range.querySelector('.hist-btn.active');
  if (!active) { thumb.style.width = '0'; return; }
  thumb.style.left = active.offsetLeft + 'px';
  thumb.style.width = active.offsetWidth + 'px';
}

// Coalesce the many per-render callers into one rAF-batched run, so the
// document-wide thumb pass happens at most once per frame instead of several
// times per WS tick.
let _histRaf = 0;
function _histSchedule() {
  if (_histRaf) return;
  _histRaf = requestAnimationFrame(function () { _histRaf = 0; _histInitAll(); });
}
function _histInitAll() {
  document.querySelectorAll('.hist-range').forEach(function(range) {
    _histEnsureThumb(range);
    range.querySelectorAll('.hist-btn').forEach(function(btn) {
      if (btn.textContent.trim() === 'Custom' && !btn.querySelector('svg')) {
        btn.innerHTML = _CAL_ICO + 'Custom';
      }
    });
    // Skip the thumb reposition for ranges on a hidden page — reading
    // offsetLeft/offsetWidth there forces layout for no benefit (the page's own
    // render re-schedules this when it becomes visible).
    if (range.offsetParent === null) return;
    _histThumbUpdate(range.id.replace('-hist-range', ''));
  });
}

function _histCustomOpen(prefix) {
  // Close other open popovers first
  document.querySelectorAll('.hist-pop.show').forEach(function(p) {
    if (p.id !== prefix + '-pop') p.classList.remove('show');
  });
  const range = document.getElementById(prefix + '-hist-range');
  if (!range) return;
  let pop = document.getElementById(prefix + '-pop');
  if (!pop) {
    const today = new Date(), fmt = function(d) { return d.toISOString().slice(0, 10); };
    const prior = new Date(+today - 30 * 86400000);
    pop = document.createElement('div');
    pop.className = 'hist-pop';
    pop.id = prefix + '-pop';
    pop.innerHTML =
      '<div><label class="hist-pop-label">From</label>'
      + '<input type="date" class="hist-date" id="' + prefix + '-from" value="' + fmt(prior) + '" onclick="this.showPicker&&this.showPicker()" onfocus="this.showPicker&&this.showPicker()"></div>'
      + '<div><label class="hist-pop-label">To</label>'
      + '<input type="date" class="hist-date" id="' + prefix + '-to" value="' + fmt(today) + '" onclick="this.showPicker&&this.showPicker()" onfocus="this.showPicker&&this.showPicker()"></div>'
      + '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:2px">'
      + '<button onclick="_histCustomClose()" style="font-size:11px;padding:5px 12px;border-radius:6px;border:1px solid var(--c-border);background:transparent;color:var(--c-muted);cursor:pointer;font-family:inherit">Cancel</button>'
      + '<button onclick="histCustomGo(\'' + prefix + '\');_histCustomClose()" class="hist-pop-apply" style="font-size:11px;padding:5px 12px;border-radius:6px;border:none;cursor:pointer;font-family:inherit;font-weight:600">Apply</button>'
      + '</div>';
    range.appendChild(pop);
  } else {
    // Update label to show current range if already applied
    const fi = document.getElementById(prefix + '-from');
    const ti = document.getElementById(prefix + '-to');
    if (fi && !fi.value) { const today=new Date(),prior=new Date(+today-30*86400000); fi.value=prior.toISOString().slice(0,10); }
    if (ti && !ti.value) { ti.value=new Date().toISOString().slice(0,10); }
  }
  pop.classList.toggle('show');
}

function _histCustomClose() {
  document.querySelectorAll('.hist-pop.show').forEach(function(p) { p.classList.remove('show'); });
}

document.addEventListener('click', function(e) {
  if (!e.target.closest('.hist-range')) _histCustomClose();
}, true);

// Init after first render tick
setTimeout(() => _histInitAll(), 100);

// Build a history-range pill row (sliding-thumb segmented control) for a chart
// prefix. Reused by the pages that surface a range picker (e.g. the Overview
// infra section). The active button is restored from _histRanges, defaulting to
// '7d'. opts.stopPropagation guards clicks inside clickable card headers.
function _histPillRow(prefix, items, opts) {
  items = items || ['1d','7d','30d','All'];
  opts = opts || {};
  const stored = _histRanges[prefix];
  const active = items.includes(stored) ? stored : '7d';
  const stopAttr = opts.stopPropagation ? ' onclick="event.stopPropagation()"' : '';
  const onClick = opts.onClick || `histClick(this,'${prefix}')`;
  return `<div class="hist-range" id="${prefix}-hist-range"${stopAttr}>${
    items.map(lbl => `<button class="hist-btn${lbl===active?' active':''}" onclick="${onClick}">${lbl}</button>`).join('')
  }</div>`;
}

function histClick(btn, prefix) {
  const range = el(prefix + '-hist-range');
  if (range) range.querySelectorAll('.hist-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _histThumbUpdate(prefix);
  const label = btn.textContent.trim().startsWith('Custom') ? 'Custom' : btn.textContent.trim();
  _histRanges[prefix] = label;
  if (label === 'Custom') {
    _histCustomOpen(prefix);
  } else {
    _histCustomClose();
    const cid = _chartCanvasMap[prefix];
    if (cid && !_charts[cid]) _chartShowSkeleton(cid);
    _histLoad(prefix, _histHours[label] || 168);
  }
}

function histCustomGo(prefix) {
  const from = el(prefix+'-from')?.value, to = el(prefix+'-to')?.value;
  if (!from || !to) return;
  const hrs = Math.max(1, Math.round((new Date(to+'T23:59:59') - new Date(from)) / 3600000));
  const cid = _chartCanvasMap[prefix];
  if (cid && !_charts[cid]) _chartShowSkeleton(cid);
  _histLoad(prefix, hrs);
}

function _histLoad(prefix, hrs) {
  // Overview: Cluster pill → utilization; Storage card and Network chart each
  // have their own range ('ov-stor' / 'ov-net').
  if (prefix==='ov-infra') loadOvResources(hrs);
  else if (prefix==='ov-net') loadOvNetwork(hrs);
  else if (prefix==='ov-stor') loadOvStorageForecast(hrs);
  else if (prefix==='px') loadPxHistory(hrs);
  else if (prefix==='pxnet') loadPxNetHistory(hrs);
  // Per-device storage cards: one prefix per card ('pxstor-<slug>').
  else if (prefix.indexOf('pxstor-')===0) loadPxStorHistory(hrs, prefix.slice(7));
  else if (prefix==='ceph') loadCephHistory(hrs);
}

// ids: optional canvas/legend overrides so other pages (the Overview's Cluster
// card) can reuse the exact per-node CPU|RAM treatment on their own canvases.
async function loadPxHistory(hrs, ids) {
  if (hrs === undefined) hrs = _histGetHours('px');
  const isCluster = !ids;   // the Compute page's Cluster charts (Overview passes its own ids)
  ids = ids || { cpu:'chart-proxmox', ram:'chart-proxmox-ram', cpuLeg:'px-cpu-legend', ramLeg:'px-ram-legend' };
  // Scope toggle (Compute page only): "All" shows every node's line; picking a
  // single node drills into that node's own line plus its guests. Same CPU +
  // RAM chart pair either way.
  const scope = (isCluster && window._pxScope && window._pxScope.scope) || 'all';
  if (isCluster && scope !== 'all') return _loadPxNodeDrilldown(hrs, ids, scope);
  try {
    const d = await _swrJSON(`/api/history/proxmox?hours=${hrs}`, () => loadPxHistory(hrs, ids));
    const wantCpu = ids.cpu && el(ids.cpu), wantRam = ids.ram && el(ids.ram),
          wantLoad = ids.load && el(ids.load);   // Overview: normalized load (load1 ÷ cores)
    if (!wantCpu && !wantRam && !wantLoad) return;
    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    const colors = [_acc,'#22C55E','#F59E0B','#EF4444','#A78BFA','#F472B6'];
    const bsec = _bucketSec(hrs);
    const cpuDs = [], ramDs = [], loadDs = [];
    // The Cluster scope filter also narrows the node lines (Overview is untouched).
    let nodeEntries = Object.entries(d.nodes);
    if (isCluster) {
      const q = ((window._pxScope && window._pxScope.search) || '').toLowerCase();
      if (q) nodeEntries = nodeEntries.filter(([node]) => node.toLowerCase().includes(q));
    }
    nodeEntries.forEach(([node, nd], i) => {
      const color = colors[i % colors.length];
      // Each node: [p10, p90, avg] — p10 index = i*3, p90 fills to it
      if (wantCpu) {
        const cpuB = _bucketStats(nd.labels, nd.cpu, bsec);
        cpuDs.push(..._dsBandHidden(node, cpuB, color), _dsAvgOnly(node, cpuB, color, { gradient: 'soft' }));
      }
      if (wantRam) {
        const ramB = _bucketStats(nd.labels, nd.mem, bsec);
        ramDs.push(..._dsBandHidden(node, ramB, color), _dsAvgOnly(node, ramB, color, { gradient: 'soft' }));
      }
      if (wantLoad) {
        const loadB = _bucketStats(nd.labels, nd.load || [], bsec);
        if (loadB.labels.length)
          loadDs.push(..._dsBandHidden(node, loadB, color), _dsAvgOnly(node, loadB, color, { gradient: 'soft' }));
      }
    });
    if (wantCpu) { _makeChart(ids.cpu, cpuDs, v => Math.round(v) + '%', hrs, { legendTarget: ids.cpuLeg }); _wireChartHover(ids.cpu); }
    if (wantRam) { _makeChart(ids.ram, ramDs, v => Math.round(v) + '%', hrs, { legendTarget: ids.ramLeg }); _wireChartHover(ids.ram); }
    if (wantLoad && loadDs.length) {
      _makeChart(ids.load, loadDs, v => v.toFixed(2) + '×', hrs, { legendTarget: ids.loadLeg, yMin: 0 });
      _wireChartHover(ids.load);
    }
  } catch(e) { console.warn('px history:', e); }
}

// Single-node drill-down for the Compute Cluster charts: the selected node's
// own CPU/RAM line (accent colour, so it always reads as "the node") plus its
// guests' lines (VMs + LXCs together, top consumers by current CPU) — so you
// can see what's pushing that node's usage up. One node-history fetch (same
// route the "All" scope uses) + one guest bulk fetch, same CPU + RAM chart
// pair either way. Colour order among guests is by VMID for stable per-guest
// colours as ranks move; the filter box searches guest name/vmid/tags.
async function _loadPxNodeDrilldown(hrs, ids, nodeName) {
  try {
    const wantCpu = ids.cpu && el(ids.cpu), wantRam = ids.ram && el(ids.ram);
    if (!wantCpu && !wantRam) return;
    const d = await _swrJSON(`/api/history/proxmox?hours=${hrs}`, () => loadPxHistory(hrs, ids));
    const nd = d.nodes && d.nodes[nodeName];
    const gd = await _swrJSON(`/api/history/entity_bulk?kind=guest&hours=${hrs}`, () => _loadPxNodeDrilldown(hrs, ids, nodeName));
    const px = window._pxLast || {};
    const ents = (gd && gd.entities) || {};
    const meta = {}; (px.vms || []).concat(px.lxcs || []).forEach(g => meta[String(g.vmid)] = g);
    let items = Object.entries(ents).filter(([eid]) => (meta[eid] || {}).node === nodeName).map(([eid, s]) => {
      const g = meta[eid] || {};
      return { id: eid, label: g.name || ('#' + eid), tags: g.tags || '',
        labels: s.labels || [], cpu: s.cpu || [], mem: s.mem || [] };
    });
    const q = ((window._pxScope && window._pxScope.search) || '').toLowerCase();
    if (q) items = items.filter(it => ((it.label || '') + ' ' + it.id + ' ' + (it.tags || '')).toLowerCase().includes(q));
    // Select top-N guests by current CPU, then order by VMID for stable colours.
    items.forEach(it => it.cur = it.cpu.length ? (it.cpu[it.cpu.length - 1] || 0) : 0);
    items.sort((a, b) => b.cur - a.cur);
    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    const guestColors = ['#22C55E','#F59E0B','#EF4444','#A78BFA','#F472B6','#38BDF8'];
    const top = items.slice(0, guestColors.length).sort((a, b) => Number(a.id) - Number(b.id));
    const bsec = _bucketSec(hrs);
    const empty = '<span style="font-size:11px;color:var(--c-muted)">No data for this node yet.</span>';
    const paint = (cid, leg, key) => {
      if (!(cid && el(cid))) return;
      const ds = [];
      if (nd) {
        const nb = _bucketStats(nd.labels, nd[key] || [], bsec);
        if (nb.labels.length) ds.push(..._dsBandHidden(nodeName, nb, _acc), _dsAvgOnly(nodeName, nb, _acc, { gradient: 'soft' }));
      }
      top.forEach((it, i) => {
        const b = _bucketStats(it.labels, it[key], bsec);
        if (b.labels.length) ds.push(..._dsBandHidden(it.label, b, guestColors[i % guestColors.length]), _dsAvgOnly(it.label, b, guestColors[i % guestColors.length], { gradient: 'soft' }));
      });
      if (!ds.length) { const ch = _charts[cid]; if (ch) { try { ch.destroy(); } catch(e){} delete _charts[cid]; } const L = el(leg); if (L) L.innerHTML = empty; return; }
      _makeChart(cid, ds, v => Math.round(v) + '%', hrs, { legendTarget: leg }); _wireChartHover(cid);
    };
    paint(ids.cpu, ids.cpuLeg, 'cpu');
    paint(ids.ram, ids.ramLeg, 'mem');
  } catch(e) { console.warn('px node drilldown:', e); }
}

// Overview Resources card: ONE combined cluster-utilization chart — every
// metric folded to a 0–100% scale so they share an axis honestly:
//   CPU / RAM   — average across nodes' percentages
//   Load        — normalized load (load1 ÷ cores) × 100, 100% = fully busy
//   Disk wait   — IO wait % (CPU time stalled on disk), the classic
//                 disk-pressure percentage — standard node RRD/status field
// (Network has its own Overview section; storage lives in the Storage card.)
async function loadOvResources(hrs) {
  if (hrs === undefined) hrs = _histGetHours('ov-infra');
  try {
    const dpx = await _swrJSON(`/api/history/proxmox?hours=${hrs}`, () => loadOvResources());
    if (!el('chart-ov-res')) return;
    const bsec = _bucketSec(hrs);
    // Concatenate every node's samples — the bucket average folds nodes
    // together (equal node weight).
    const cat = (pick) => {
      const L = [], V = [];
      Object.values((dpx||{}).nodes || {}).forEach(nd => {
        (nd.labels || []).forEach((t, i) => {
          const v = pick(nd, i);
          if (v != null && isFinite(v)) { L.push(t); V.push(v); }
        });
      });
      return _bucketStats(L, V, bsec);
    };
    const cpuB  = cat((nd, i) => nd.cpu[i]);
    const ramB  = cat((nd, i) => nd.mem[i]);

    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    // Standard soft-gradient average-line treatment (same as the Compute /
    // Network charts) — _dsAvgOnly consumes the bucketStats shape directly.
    const ds = [
      _dsAvgOnly('CPU', cpuB, _acc, { gradient: 'soft' }),
      _dsAvgOnly('RAM', ramB, '#22C55E', { gradient: 'soft' }),
    ].filter(d => d.data.length);
    if (!ds.length) return;
    _makeChart('chart-ov-res', ds, v => Math.round(v) + '%', hrs, { legendTarget: 'chart-ov-res-leg', yMin: 0 });
    _wireChartHover('chart-ov-res');
  } catch(e) { console.warn('ov resources:', e); }
}

// Overview Network section: cluster-wide throughput — every node's in/out
// summed per sample, charted as two lines with the standard treatment.
async function loadOvNetwork(hrs) {
  if (hrs === undefined) hrs = _histGetHours('ov-net');
  try {
    const d = await _swrJSON(`/api/history/proxmox_net?hours=${hrs}`, () => loadOvNetwork());
    if (!el('chart-ov-net')) return;
    const bsec = _bucketSec(hrs);
    const inAcc = {}, outAcc = {};
    Object.values((d||{}).nodes || {}).forEach(nd => (nd.labels || []).forEach((t, i) => {
      inAcc[t]  = (inAcc[t]  || 0) + (nd.in[i]  || 0);
      outAcc[t] = (outAcc[t] || 0) + (nd.out[i] || 0);
    }));
    const L = Object.keys(inAcc).map(Number).sort((a, b) => a - b);
    if (!L.length) return;
    const inB  = _bucketStats(L, L.map(t => inAcc[t]),  bsec);
    const outB = _bucketStats(L, L.map(t => outAcc[t]), bsec);
    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    const ds = [
      ..._dsBandHidden('In', inB, '#22C55E'), _dsAvgOnly('In', inB, '#22C55E', { gradient: 'soft' }),
      ..._dsBandHidden('Out', outB, _acc),    _dsAvgOnly('Out', outB, _acc,    { gradient: 'soft' }),
    ];
    _makeChart('chart-ov-net', ds, v => fmtBytes(v) + '/s', hrs, { legendTarget: 'chart-ov-net-leg' });
    _wireChartHover('chart-ov-net');
  } catch(e) { console.warn('ov network:', e); }
}

// Overview Storage card: cluster-wide capacity forecast — every store summed
// per bucket, painted with the same forecast treatment as the storage cards.
async function loadOvStorageForecast(hrs) {
  if (hrs === undefined) hrs = _histGetHours('ov-stor');
  try {
    const d = await _swrJSON(`/api/history/storage?hours=${hrs}`, () => loadOvStorageForecast(hrs));
    if (!el('chart-ov-storage')) return;
    const acc = {};   // ts -> [usedB, totalB]
    ((d && d.series) || []).forEach(s => {
      s.labels.forEach((t, i) => {
        const m = acc[t] = acc[t] || [0, 0];
        m[0] += s.disk[i] || 0; m[1] += s.maxdisk[i] || 0;
      });
    });
    const ts = Object.keys(acc).map(Number).sort((a, b) => a - b);
    if (!ts.length) return;
    const usedGB  = ts.map(t => acc[t][0] / 1073741824);
    const totalGB = acc[ts[ts.length-1]][1] / 1073741824;
    _renderStorageForecastChart('chart-ov-storage', 'Used', ts, usedGB, totalGB, hrs,
      { prefix: 'ov-stor', confPillId: 'ov-stor-conf' });
  } catch(e) { console.warn('ov storage forecast:', e); }
}

// Linear-fit forecast with prediction-interval stats. Returns slope, current,
// total, etaMs plus the residual-standard-error inputs needed to compute the
// variance band at any future x (sigma, xmean, sxx_centered, n, t0).
function _computeStorageForecast(labels, usedGB, totalGB) {
  if (!labels || labels.length < 4) return null;
  // Skip the first quarter of samples when fitting. Recent cleanups, migrations,
  // or pool rebalances often produce a step-down at the start of the window —
  // including it in the regression manufactures a steep declining slope that
  // projects to zero in days.
  const skip = Math.floor(usedGB.length / 4);
  const t0 = labels[skip] * 1000;
  let n=0, sx=0, sy=0, sxx=0, sxy=0;
  const xs = [], ys = [];
  for (let i = skip; i < usedGB.length; i++) {
    const y = usedGB[i]; if (y == null) continue;
    const x = (labels[i]*1000 - t0) / 86400000;
    n++; sx+=x; sy+=y; sxx+=x*x; sxy+=x*y;
    xs.push(x); ys.push(y);
  }
  if (n < 4) return null;
  const denom = (n*sxx - sx*sx);
  const slope = denom !== 0 ? (n*sxy - sx*sy) / denom : 0;
  const intercept = (sy - slope*sx) / n;
  // Coefficient of determination (R²) — drives confidence level a la Tracearr.
  let ssRes = 0, ssTot = 0;
  const ymean = sy / n;
  for (let i = 0; i < xs.length; i++) {
    const r = ys[i] - (intercept + slope*xs[i]);
    ssRes += r * r;
    ssTot += (ys[i] - ymean) ** 2;
  }
  const r2 = ssTot !== 0 ? 1 - ssRes / ssTot : 0;
  const current = usedGB[usedGB.length-1];
  const lastMs = labels[labels.length-1]*1000;
  const spanDays = (lastMs - t0) / 86400000;
  const base = { slope, intercept, current, total: totalGB||0, lastMs, t0, n, r2, spanDays };
  if (!totalGB || slope <= 0.05) return { ...base, etaMs: null };
  const daysLeft = Math.max(0, (totalGB - current) / slope);
  return { ...base, total: totalGB, etaMs: lastMs + daysLeft*86400000, daysLeft };
}

// Period mapping for the prediction window + sample granularity.
// Matches Tracearr's StoragePredictionChart: year → monthly samples, month →
// every 2 days, week/day → daily, all/custom → predictions disabled.
function _storagePeriod(hrs) {
  const h = hrs || 168;
  if (h <= 24)   return { period: 'day',   predictionDays: 1,   intervalDays: 1  };
  if (h <= 168)  return { period: 'week',  predictionDays: 7,   intervalDays: 1  };
  if (h <= 720)  return { period: 'month', predictionDays: 30,  intervalDays: 2  };
  if (h <= 8760) return { period: 'year',  predictionDays: 365, intervalDays: 30 };
  return                  { period: 'all',   predictionDays: 0,   intervalDays: 0  };
}

// Confidence classifier (bucket by R²). Returns null when there's not yet
// enough history to forecast — chart hides predictions entirely in that case.
// Min span lowered from Tracearr's 7 days to 3: the 7d range pill only yields
// ~5 effective days after _computeStorageForecast skips the first quarter, so a
// 7-day floor would hide forecasts on the 7d view entirely. 3 lets it show once
// there's a few days of data (n>=4 guard above still requires enough samples).
function _forecastConfidenceLevel(forecast) {
  if (!forecast) return null;
  if (forecast.spanDays < 3) return null;
  if (forecast.r2 >= 0.8) return 'high';
  if (forecast.r2 >= 0.5) return 'medium';
  return 'low';
}

// Tracearr's per-point prediction + variance cone (apps/web/.../StoragePredictionChart.tsx):
//   predicted = current + bytesPerDay × daysOut
//   margin    = predicted × marginPercent × (daysOut / predictionDays)
// where marginPercent is 0.1 / 0.25 / 0.5 for high / medium / low confidence.
// Returns the prediction line (anchored at "Now") and the band points
// (starting at i=1 — Tracearr's arearange does not include the anchor).
function _predictionPoints(forecast, hrs) {
  const empty = { line: [], band: [] };
  if (!forecast) return empty;
  const conf = _forecastConfidenceLevel(forecast);
  if (!conf) return empty;
  const { predictionDays, intervalDays } = _storagePeriod(hrs);
  if (predictionDays === 0) return empty;
  const marginPercent = conf === 'high' ? 0.1 : conf === 'medium' ? 0.25 : 0.5;
  // Full precision: rounding to 0.01 TB (10 GB) quantized the line into a
  // visible staircase on small, slow-growing pools (e.g. Ceph) — a computed
  // straight line should not be pre-rounded. Display formatting happens later.
  const fTB = g => g / 1000;
  const line = [{ x: forecast.lastMs, y: fTB(forecast.current), range: null }];
  const band = [];
  const numPoints = Math.ceil(predictionDays / intervalDays);
  for (let i = 1; i <= numPoints; i++) {
    const daysOut = Math.min(i * intervalDays, predictionDays);
    const predicted = forecast.current + forecast.slope * daysOut;
    const margin = Math.abs(predicted) * marginPercent * (daysOut / predictionDays);
    const lo = Math.max(0, predicted - margin);
    const hi = predicted + margin;
    const x = forecast.lastMs + daysOut * 86400000;
    const range = { lo: fTB(lo), hi: fTB(hi) };
    line.push({ x, y: fTB(Math.max(0, predicted)), range });
    band.push({ x, lo: fTB(lo), hi: fTB(hi) });
  }
  return { line, band };
}

// Format helper for byte rate (B/s … GB/s). Reused by the tooltip.
function _bpsFmt(v) {
  if (!v) return '0 B/s';
  const u = ['B/s','KB/s','MB/s','GB/s'];
  const i = Math.min(3, Math.floor(Math.log(v) / Math.log(1024)));
  return Math.round(v / Math.pow(1024, i)) + ' ' + u[i];
}

// Tracearr-style tooltip for two-series throughput: bold date at top, one
// "● Series: value" row per series with the bullet colored by the line color.
function _throughputTooltipHandler(ctx) {
  const tt = ctx.tooltip, chart = ctx.chart;
  let el = document.getElementById('thr-tt-' + chart.canvas.id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'thr-tt-' + chart.canvas.id;
    el.className = 'stor-tooltip';
    document.body.appendChild(el);
  }
  if (tt.opacity === 0) { el.style.opacity = '0'; return; }
  const dps = (tt.dataPoints || []).filter(dp => dp.parsed && dp.parsed.y != null && !dp.dataset._band);
  if (!dps.length) { el.style.opacity = '0'; return; }
  const ms = dps[0].parsed.x;
  const d = new Date(ms);
  const dateStr = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const lines = dps.map(dp => {
    const color = dp.dataset.borderColor;
    return '<div class="stor-tt-line"><span class="stor-tt-bullet" style="color:' + escAttr(color) + '">●</span>' + escText(dp.dataset.label) + ': ' + escText(_bpsFmt(dp.parsed.y)) + '</div>';
  }).join('');
  el.innerHTML = '<div class="stor-tt-title">' + escText(dateStr) + '</div>' + lines;
  el.style.opacity = '1';
  // Use the shared placer (centered above the point, edge-aware) instead of pinning
  // the card's corner to the caret, which put it in an off/overlapping spot.
  _placeTooltip(el, chart, tt);
}

// Shared throughput chart — Tracearr-style aesthetic. Two smoothed series
// (Read green / Write orange) with vertical gradient area fills, no
// auto-generated legend (inline legend lives in the panel header), and the
// shared bold-date + colored-bullet tooltip.
function _renderThroughputChart(id, labels, readBps, writeBps, hrs) {
  if (!el(id) || !labels) return;
  const bsec = _bucketSec(hrs);
  const readB  = _bucketStats(labels, readBps  || [], bsec);
  const writeB = _bucketStats(labels, writeBps || [], bsec);
  _makeChart(id, [
    ..._dsBandHidden('Read',  readB,  '#22C55E'),
    _dsAvgOnly('Read',  readB,  '#22C55E', { gradient: true }),
    ..._dsBandHidden('Write', writeB, '#F59E0B'),
    _dsAvgOnly('Write', writeB, '#F59E0B', { gradient: true }),
  ], _bpsFmt, hrs, {
    yAxisWidth: 70,
    noLegend: true,
    animationDuration: 220,
    tooltip: { enabled: false, mode: 'index', intersect: false, external: _throughputTooltipHandler },
  });
  _wireChartHover(id);
}

// Tracearr-style Storage Trend chart.
// One accent-colored series: solid + gradient-filled historical, dashed + diamond-marker
// prediction continuing in the same color. "Now" boundary drawn by the nowLine
// plugin with a rotated label. No capacity line — implied by y-axis max.
// opts: { prefix, confPillId } — when prefix is supplied, the Predictions
// toggle state at _predToggle[prefix] gates the dashed segment.
function _renderStorageForecastChart(id, label, labels, usedGB, totalGB, hrs, opts) {
  if (!el(id) || !labels || !labels.length) return;
  opts = opts || {};
  const lastTsMs = labels[labels.length-1] * 1000;
  const firstTsMs = labels[0] * 1000;
  const showPredictionsProp = opts.prefix ? (_predToggle[opts.prefix] !== false) : true;
  const forecast = _computeStorageForecast(labels, usedGB, totalGB);
  const conf = _forecastConfidenceLevel(forecast);
  const { line: predLine, band: predBand } =
    showPredictionsProp ? _predictionPoints(forecast, hrs) : { line: [], band: [] };
  const showingPredictions = predLine.length > 1;
  const usedTB = usedGB.map(g => g == null ? null : g / 1000);  // full precision; see fTB note — coarse rounding staircased small-pool (Ceph) lines
  // Line + area both derive from the runtime accent so the shading always
  // matches the line (a mismatched gradient under the accent line used to
  // read as a second, misaligned series).
  const ACCENT = (getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim()) || '#E57000';
  const ACCENT_RGB = (getComputedStyle(document.documentElement).getPropertyValue('--c-accent-rgb').trim()) || '229,112,0';
  // Historical area: vertical accent gradient 0.3 → 0.05 per Tracearr's stops.
  const gradientFill = ctx => {
    const c = ctx.chart, area = c.chartArea;
    if (!area) return 'rgba(' + ACCENT_RGB + ',.15)';
    const g = c.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, 'rgba(' + ACCENT_RGB + ',.30)');
    g.addColorStop(1, 'rgba(' + ACCENT_RGB + ',.05)');
    return g;
  };
  const historical = {
    label: 'Historical',
    data: _toPoints(labels, usedTB),
    borderColor: ACCENT,
    backgroundColor: gradientFill,
    pointBackgroundColor: ACCENT,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.4,
    fill: 'origin',
    spanGaps: true,
  };
  // Confidence band ≡ Highcharts arearange: two helper datasets, lower fills
  // toward upper. The band is anchored at "Now" (index 0, zero-width lo=hi=
  // current, range:null so the tooltip skips it) so every dataset shares the
  // same index→x mapping as the Prediction line. Without the anchor the band's
  // indices sit one left of the prediction series (which has its own anchor),
  // and index-mode hover highlights the prediction diamond one point left of
  // the cursor. Both kept present with empty data when predictions are off so
  // dataset count stays at 4 for in-place updates.
  const bandAnchor = (showingPredictions && predLine.length) ? predLine[0] : null;
  const upperPts = bandAnchor
    ? [{ x: bandAnchor.x, y: bandAnchor.y }].concat(predBand.map(p => ({ x: p.x, y: p.hi })))
    : predBand.map(p => ({ x: p.x, y: p.hi }));
  const lowerPts = bandAnchor
    ? [{ x: bandAnchor.x, y: bandAnchor.y, range: null }].concat(predBand.map(p => ({ x: p.x, y: p.lo, range: { lo: p.lo, hi: p.hi } })))
    : predBand.map(p => ({ x: p.x, y: p.lo, range: { lo: p.lo, hi: p.hi } }));
  const confUpper = {
    label: 'Confidence Upper',
    data: showingPredictions ? upperPts : [],
    borderColor: 'transparent', backgroundColor: 'transparent',
    borderWidth: 0,
    pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0,
    tension: 0, fill: false, spanGaps: true,
  };
  const confLower = {
    label: 'Confidence',
    data: showingPredictions ? lowerPts : [],
    borderColor: 'transparent',
    backgroundColor: 'rgba(' + ACCENT_RGB + ',0.15)',
    borderWidth: 0,
    pointRadius: 0, pointHoverRadius: 0, pointHitRadius: 0,
    tension: 0, fill: '-1', spanGaps: true,
  };
  // Prediction line: ShortDash (Highcharts) ≈ [4,2] in Chart.js. Markers are
  // Highcharts' default for series-index-1 → diamond (rectRot in Chart.js),
  // radius 4. Anchor at index 0 has range:null and no marker; subsequent
  // points draw the diamond.
  const prediction = {
    label: 'Prediction',
    data: showingPredictions ? predLine : [],
    borderColor: ACCENT,
    backgroundColor: 'transparent',
    borderDash: [4, 2],
    borderWidth: 2,
    pointStyle: 'rectRot',
    pointRadius: ctx => ctx.dataIndex === 0 ? 0 : 4,
    pointHoverRadius: 6,
    pointBackgroundColor: ACCENT,
    pointBorderColor: ACCENT,
    pointBorderWidth: 0,
    tension: 0,
    fill: false,
    spanGaps: true,
  };
  // Z-order: historical → confUpper (invisible) → confLower (band fill toward
  // upper) → prediction (dashed line + markers, hover state enlarges marker).
  const datasets = [historical, confUpper, confLower, prediction];
  // Confidence pill — three variants tied to predictions.confidence. Only
  // shown when predictions are on (matches Tracearr's Storage.tsx behavior).
  if (opts.confPillId) {
    const pill = el(opts.confPillId);
    if (pill) {
      pill.classList.remove('show', 'conf-high', 'conf-medium', 'conf-low');
      if (showPredictionsProp && conf) {
        pill.classList.add('show', 'conf-' + conf);
        pill.textContent = conf.charAt(0).toUpperCase() + conf.slice(1) + ' Confidence';
      }
    }
  }
  // X-axis: autofit ≡ Highcharts. With predictions on, span extends to the
  // last forecasted point. With predictions off (or no forecast), spans only
  // historical data — same recompact behavior Tracearr gets for free.
  const lastPredMs = showingPredictions ? predLine[predLine.length-1].x : lastTsMs;
  const xMin = firstTsMs;
  const xMax = showingPredictions ? lastPredMs : lastTsMs;
  const fmtStor = v => v >= 1 ? Math.round(v) + ' TB' : Math.round(v*1000) + ' GB';
  const yMax = totalGB ? parseFloat(((totalGB/1000) * 1.05).toFixed(2)) : undefined;
  _makeChart(id, datasets, fmtStor, hrs, {
    xMin, xMax, yAxisWidth: 70, yMin: 0, yMax,
    nowX: showingPredictions ? lastTsMs : undefined,
    noLegend: true,
    animationDuration: 220,
    tooltip: { enabled: false, mode: 'index', intersect: false, external: _storageTooltipHandler },
  });
}
