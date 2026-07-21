// ── History charts ────────────────────────────────────────────────────────
const _charts = {};
let _ovChartTs = 0; // timestamp of last overview chart fetch
// Bumped once per page navigation (in showPage). A chart re-runs its intro
// sweep when it's rebuilt under a newer epoch than it last revealed at, so
// every visit to a page animates — while same-epoch rebuilds (the ~10s WS
// tick refreshes) stay still. WS ticks call render() directly, never showPage,
// so they never bump this. (Declared up near currentPage so the boot-time
// showPage() doesn't hit a Temporal Dead Zone — see the note there.)
// Per-chart intro-sweep state: id -> { epoch, t0, done }. Lets a sweep that
// gets interrupted by a mid-flight rebuild (a WS tick landing during the ~1.1s
// animation) RESUME from its original start time on the new chart instance
// instead of restarting or snapping — so every page's animation stays smooth.
const _revealState = {};

// Hide chart tooltips on scroll. Two cases this covers:
//  • Touch: Chart.js doesn't fire hover-out when the user scrolls away from a
//    chart they just tapped, so the external tooltip lingers.
//  • Desktop: wheel-scrolling while the cursor sits over a chart fires no
//    mousemove, so the external tooltip freezes on screen as the chart scrolls
//    out from under it. Moving the mouse re-shows it correctly.
// capture:true so scrolls inside nested scrollers (#pages-root has overflow:
// auto) are caught — scroll events don't bubble.
let _ttDismissRaf = 0;
const _dismissChartTooltips = () => {
  document.querySelectorAll('.stor-tooltip').forEach(t => { t.style.opacity = '0'; });
  Object.values(_charts).forEach(ch => {
    try {
      if (ch && ch.tooltip) {
        ch.tooltip.setActiveElements([], { x: 0, y: 0 });
        ch.setActiveElements([]);
        ch.update('none');
      }
    } catch {}
  });
};
window.addEventListener('scroll', () => {
  if (_ttDismissRaf) return;
  _ttDismissRaf = requestAnimationFrame(() => { _ttDismissRaf = 0; _dismissChartTooltips(); });
}, { passive: true, capture: true });
const _isDark = () => document.documentElement.classList.contains('dark');
const _histHours = { '1d':24, '7d':168, '30d':720, '1y':8760, 'All':99999 };
// Remembers the active range label per history-pill prefix (keyed by prefix,
// e.g. 'ov-infra'). Read by _histPillRow to mark the active button on rebuild.
const _histRanges = {};

function _chartDefaults() {
  const dark = _isDark();
  Chart.defaults.color = dark ? '#A1A1AA' : '#71717A';
  Chart.defaults.borderColor = dark ? '#27272A' : '#E4E4E7';
}

// Vertical "Now" divider with rotated label. Activated per-chart by setting
// options.plugins.nowLine = { x: <ms timestamp> }.
const _nowLinePlugin = {
  id: 'nowLine',
  afterDatasetsDraw(chart) {
    const opts = chart.options.plugins && chart.options.plugins.nowLine;
    if (!opts || opts.x == null) return;
    const { ctx, chartArea, scales } = chart;
    if (!scales.x) return;
    const px = scales.x.getPixelForValue(opts.x);
    if (px < chartArea.left - 0.5 || px > chartArea.right + 0.5) return;
    const dark = _isDark();
    ctx.save();
    ctx.strokeStyle = dark ? 'rgba(255,255,255,.32)' : 'rgba(0,0,0,.28)';
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, chartArea.top);
    ctx.lineTo(px, chartArea.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.5)';
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('Now', px, chartArea.top + 4);
    ctx.restore();
  }
};
if (typeof Chart !== 'undefined' && Chart.register) Chart.register(_nowLinePlugin);

// Left-to-right "draw on" intro reveal. Clips the dataset layer to a window that
// widens from the left edge so the line + fill sweep in horizontally instead of
// rising from the bottom. Driven by chart.$lr (0→1); axes/grid draw unclipped.
const _revealLRPlugin = {
  id: 'revealLR',
  beforeDatasetsDraw(chart) {
    const p = chart.$lr;
    if (p == null || p >= 1) return;
    const a = chart.chartArea; if (!a) return;
    const c = chart.ctx;
    c.save(); c.beginPath();
    c.rect(a.left - 1, a.top, (a.right - a.left + 2) * p, a.bottom - a.top);
    c.clip();
    chart.$lrClipped = true;
  },
  afterDatasetsDraw(chart) {
    if (chart.$lrClipped) { chart.ctx.restore(); chart.$lrClipped = false; }
  },
};
if (typeof Chart !== 'undefined' && Chart.register) Chart.register(_revealLRPlugin);
const _REVEAL_MS = 1100;
// Per-chart reveal overrides — opt in by canvas id. `ms` lengthens the sweep;
// `pow` is the ease-out exponent (higher = slower, gentler finish near the end).
const _revealOpts = {};
// Run the LR reveal once on a freshly built chart. Built-in animation must be
// off (we drive draws ourselves). The synchronous first draw clips to 0 so
// there's no flash of the full chart before the sweep starts.
// Drive the LR sweep on `chart`. `t0` is the sweep's start time (shared via
// _revealState so an interrupted-then-rebuilt sweep resumes at the right
// progress rather than restarting); defaults to now for one-off callers. When
// `id` is given, _revealState[id].done is flipped true once the sweep lands.
function _revealChart(chart, id, t0) {
  if (!chart) return;
  const markDone = () => { if (id && _revealState[id]) _revealState[id].done = true; };
  // Reduced-motion: no sweep, count it immediately done.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { markDone(); return; }
  if (t0 == null) t0 = performance.now();
  const o = _revealOpts[id] || {};
  const ms = o.ms || _REVEAL_MS;
  const pw = o.pow || 3;  // ease-out exponent; higher = slower near the finish
  const step = () => {
    if (chart._revealCancelled || !chart.ctx || !chart.canvas || !chart.canvas.isConnected) return;  // cancelled/destroyed/detached
    const raw = Math.min(1, (performance.now() - t0) / ms);
    chart.$lr = 1 - Math.pow(1 - raw, pw);  // ease-out (pw=3 cubic by default)
    try { chart.draw(); } catch { return; }
    if (raw < 1) requestAnimationFrame(step);
    else { chart.$lr = 1; markDone(); }
  };
  // Seed the clip from elapsed time so a resumed sweep picks up where it left
  // off (no flash back to 0); a fresh sweep (t0≈now) seeds at ~0 as before.
  const raw0 = Math.min(1, (performance.now() - t0) / ms);
  chart.$lr = 1 - Math.pow(1 - raw0, pw);
  try { chart.draw(); } catch { return; }
  requestAnimationFrame(step);
}

// Decide + run the intro sweep for chart `id`. `existed` = a prior instance was
// present before this (re)build. A first paint or a fresh navigation (newer
// _navEpoch than the chart last revealed at) starts a new sweep so every visit
// animates; a same-nav rebuild that interrupts an unfinished sweep (the ~10s WS
// tick landing mid-animation) RESUMES it from the same start time so it stays
// smooth; a same-nav rebuild after the sweep finished stays still.
let _revealVisN = 0, _revealVisT = 0;
function _maybeReveal(chart, id, existed) {
  if (!chart) return;
  const st = _revealState[id];
  // Play the intro sweep only the FIRST time a chart is built this session
  // (revisits stay still — replaying on every nav was the original jank). On a
  // page that builds many charts at once can also gate + stagger
  // so they don't all sweep in the same frame:
  //   • charts outside the viewport appear instantly with no sweep — you can't
  //     see them animate anyway, and they'd be static by the time you scroll to
  //     them — which caps concurrent sweeps to the 2-4 charts actually on screen;
  //   • those visible ones are staggered ~90ms apart for a smooth cascade.
  // Only a first sweep interrupted mid-flight (e.g. a WS tick rebuilt the chart)
  // resumes.
  if (!st) {
    _revealState[id] = { epoch: _navEpoch, t0: performance.now(), done: false };
    const cv = chart.canvas, r = cv ? cv.getBoundingClientRect() : null;
    const vh = window.innerHeight || 800;
    const inView = r && r.width > 0 && r.top < vh && r.bottom > 0;
    if (!inView) { _revealState[id].done = true; return; }   // off-screen → no sweep
    const now = performance.now();
    if (now - _revealVisT > 350) _revealVisN = 0;            // a new build-burst
    _revealVisT = now;
    const delay = _revealVisN * 90; _revealVisN++;
    const t0 = _revealState[id].t0 = now + delay;
    if (delay > 0) {
      chart.$lr = 0; try { chart.draw(); } catch {}          // hide until its turn (no flash)
      setTimeout(() => {
        const s = _revealState[id];
        if (!s || chart._revealCancelled || !chart.canvas || !chart.canvas.isConnected) return;
        // If you've navigated away before this chart's turn, its page is now
        // display:none (offsetParent null) — skip the sweep so leftover staggered
        // draws don't pile onto the page you're actually looking at.
        if (chart.canvas.offsetParent === null) { s.done = true; chart.$lr = 1; return; }
        _revealChart(chart, id, s.t0);
      }, delay);
    } else {
      _revealChart(chart, id, t0);
    }
  } else if (!st.done) {
    _revealChart(chart, id, st.t0);  // resume an interrupted first sweep
  }
}

// Position an external tooltip card beside the caret: prefer the right side,
// flip left if it would overflow the chart's right edge, clamp inside the chart,
// then ALWAYS clamp to the visible viewport. The viewport clamp matters on
// phones: a card wider than the (narrow) chart would otherwise spill past the
// screen edge, widen the document, and make mobile browsers zoom the whole page
// out — which is exactly what happened on the Storage charts.
function _placeTooltip(el, chart, tt) {
  // The tooltip is position:fixed, so everything here is in VIEWPORT coords —
  // getBoundingClientRect is already viewport-relative; do NOT add page offsets.
  const rect = chart.canvas.getBoundingClientRect();
  const tw = el.offsetWidth, th = el.offsetHeight, gap = 14;
  const chartL = rect.left, chartR = rect.left + rect.width;
  const chartT = rect.top,  chartB = rect.top + rect.height;
  const caretX = chartL + tt.caretX, caretY = chartT + tt.caretY;
  let left = caretX + gap;
  if (left + tw > chartR) left = caretX - gap - tw;   // would overflow right → flip left
  left = Math.max(chartL, Math.min(left, chartR - tw));
  let top = caretY - th / 2;
  top = Math.max(chartT, Math.min(top, chartB - th));
  // Clamp to the visible viewport so the card can't spill off-screen (which on a
  // phone would widen the page and zoom it out).
  const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
  left = Math.max(4, Math.min(left, vw - tw - 4));
  top  = Math.max(4, Math.min(top,  vh - th - 4));
  el.style.left = left + 'px';
  el.style.top = top + 'px';
}

// Standard external tooltip factory used by every chart that goes through
// _makeChart. Returns a Chart.js external handler that renders a Tracearr-
// style card: bold date/time title, one "● Series: value" row per series
// with the bullet colored to the line color. Datasets can opt into a
// per-series formatter via `tooltipFormat` for mixed-unit charts; otherwise it
// falls back to the chart-wide yFmt.
function _stdTooltipHandler(yFmt, tOpts) {
  return function (ctx) {
    const tt = ctx.tooltip, chart = ctx.chart;
    let el = document.getElementById('std-tt-' + chart.canvas.id);
    if (!el) {
      el = document.createElement('div');
      el.id = 'std-tt-' + chart.canvas.id;
      el.className = 'stor-tooltip';
      document.body.appendChild(el);
    }
    if (tt.opacity === 0) { el.style.opacity = '0'; return; }
    const dps = (tt.dataPoints || []).filter(dp =>
      dp.parsed && dp.parsed.y != null && !dp.dataset._band);
    if (!dps.length) { el.style.opacity = '0'; return; }
    const ms = dps[0].parsed.x;
    const d = new Date(ms);
    const dateStr = (tOpts && tOpts.dayOnly)
      ? d.toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric' })
      : d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' });
    const fmt = v => yFmt ? yFmt(v) : String(v);
    const lines = dps.map(dp => {
      const color = dp.dataset.borderColor;
      const dsFmt = dp.dataset.tooltipFormat;
      const val = dsFmt ? dsFmt(dp.parsed.y) : fmt(dp.parsed.y);
      return '<div class="stor-tt-line"><span class="stor-tt-bullet" style="color:' + escAttr(color) + '">●</span>' + escText(dp.dataset.label) + ': ' + escText(val) + '</div>';
    }).join('');
    el.innerHTML = '<div class="stor-tt-title">' + escText(dateStr) + '</div>' + lines;
    el.style.opacity = '1';
    _placeTooltip(el, chart, tt);
  };
}

// External tooltip for storage charts — Tracearr-style bulleted card with
// bold date, Prediction value, and confidence Range row.
function _storageTooltipHandler(ctx) {
  const tt = ctx.tooltip, chart = ctx.chart;
  let el = document.getElementById('stor-tt-' + chart.canvas.id);
  if (!el) {
    el = document.createElement('div');
    el.id = 'stor-tt-' + chart.canvas.id;
    el.className = 'stor-tooltip';
    document.body.appendChild(el);
  }
  if (tt.opacity === 0) { el.style.opacity = '0'; return; }
  const dpAll = (tt.dataPoints || []).filter(dp => dp.parsed && dp.parsed.y != null);
  // Confidence Upper is purely the band ceiling — never a tooltip row.
  // Prediction anchor (range:null) duplicates the historical value at Now.
  const dps = dpAll.filter(dp => {
    const lbl = dp.dataset.label;
    if (lbl === 'Confidence Upper') return false;
    if (lbl === 'Prediction' && (!dp.raw || !dp.raw.range)) return false;
    return true;
  });
  if (!dps.length) { el.style.opacity = '0'; return; }
  const ms = dps[0].parsed.x;
  const dateStr = new Date(ms).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
  const fmt = v => v >= 1 ? v.toFixed(1) + ' TB' : Math.round(v*1000) + ' GB';
  // Per Tracearr's formatter: one bulleted line per series, "Range: lo - hi"
  // for the arearange entry. Order rows historical → prediction → range so
  // the lo/hi from the Confidence dataset ends up beneath its sibling
  // prediction row.
  const order = { 'Historical': 0, 'Prediction': 1, 'Confidence': 2 };
  dps.sort((a, b) => (order[a.dataset.label] ?? 99) - (order[b.dataset.label] ?? 99));
  const lines = dps.map(dp => {
    const lbl = dp.dataset.label;
    if (lbl === 'Confidence') {
      const r = dp.raw && dp.raw.range;
      if (!r) return '';
      return '<div class="stor-tt-line"><span class="stor-tt-bullet">●</span>Range: ' + fmt(r.lo) + ' - ' + fmt(r.hi) + '</div>';
    }
    return '<div class="stor-tt-line"><span class="stor-tt-bullet">●</span>' + escText(lbl) + ': ' + escText(fmt(dp.parsed.y)) + '</div>';
  }).filter(Boolean).join('');
  el.innerHTML = '<div class="stor-tt-title">' + escText(dateStr) + '</div>' + lines;
  el.style.opacity = '1';
  _placeTooltip(el, chart, tt);
}

function _xAxisConfig(hrs) {
  if (!hrs || hrs <= 48)  return { unit: 'hour',  displayFormats: { hour: 'HH:mm', minute: 'HH:mm' } };
  if (hrs <= 8760)        return { unit: 'day',   displayFormats: { day: 'MMM d' } };
  return                         { unit: 'month', displayFormats: { month: 'MMM yy' } };
}

function _makeChart(id, datasets, yFmt, hrs, opts) {
  const canvas = el(id); if (!canvas) return;
  _chartDefaults();
  const xCfg = { ..._xAxisConfig(hrs), ...((opts && opts.xTime) || {}) };
  const stacked = !!(opts && opts.stacked);
  // Decide whether to play the intro sweep. Replay it on a real navigation so
  // every visit to a page animates, but stay still for the periodic WS-tick
  // refreshes (storage/ceph rebuild their charts every ~10s) — otherwise the
  // graph looks like it's glitching/redrawing itself. The signal is _navEpoch,
  // bumped only by showPage: reveal when this is a first paint, when the chart
  // was last revealed under an older nav (re-visit), or when a prior sweep was
  // aborted mid-flight (storage rebuilds the chart twice on the same nav).
  const _prev = _charts[id];
  const _isRefresh = !!_prev;

  // Fast path — a periodic data-refresh tick with the SAME range (hrs) and
  // dataset shape: mutate the existing chart's datasets + sliding x-window and
  // update('none'), instead of a full destroy+rebuild every ~10s (which
  // re-parses scales/controllers). Falls through to the rebuild below whenever
  // the range or dataset count/axis changes — that's the case the cached
  // scale-options bug (see note further down) actually affected.
  if (_prev && _prev.canvas === canvas && _prev.options && _prev.options.scales
      && _prev._hrs === hrs && _prev._stacked === stacked
      && _prev._yAxisWidth === ((opts && opts.yAxisWidth) || undefined)
      && _prev.data.datasets.length === datasets.length) {
    _prev.data.datasets = datasets;
    const sx = _prev.options.scales.x, sy = _prev.options.scales.y;
    sx.min = (opts && opts.xMin != null) ? opts.xMin : undefined;
    sx.max = (opts && opts.xMax != null) ? opts.xMax : undefined;
    if (opts && opts.xTime) Object.assign(sx.time, opts.xTime);
    sx.ticks.maxTicksLimit = (opts && opts.xMaxTicks) || 8;
    if (opts && opts.xTickValues) {
      sx.afterBuildTicks = (s) => { s.ticks = opts.xTickValues.map(value => ({ value })); };
    }
    sy.min = (opts && opts.yMin != null) ? opts.yMin : undefined;
    sy.max = (opts && opts.yMax != null) ? opts.yMax : undefined;
    sy.ticks.maxTicksLimit = (opts && opts.yMaxTicks) || 6;
    _prev.options.plugins.nowLine = (opts && opts.nowX != null) ? { x: opts.nowX } : false;
    _prev.update('none');
    _chartHideSkeleton(id);
    return;
  }
  // This call always destroys+rebuilds the chart below. Stop any sweep still
  // running on the outgoing instance so its requestAnimationFrame loop doesn't
  // keep drawing onto the canvas the new chart now owns (overlapping sweeps =
  // the stutter we saw). _maybeReveal (after the build) decides whether the new
  // instance starts/resumes a sweep.
  if (_prev) _prev._revealCancelled = true;

  // Orphan-guard: canvas element was replaced (overview innerHTML rerenders every WS tick).
  // Destroy the stale chart so we rebuild onto the live canvas.
  if (_charts[id] && _charts[id].canvas !== canvas) {
    _charts[id].destroy(); delete _charts[id];
    document.querySelectorAll(`.hd-legend[data-for="${id}"]`).forEach(n => n.remove());
  }

  // Always rebuild. The in-place update path mutated scales.x.time via
  // Object.assign, but Chart.js v4 caches parsed scale options and didn't
  // pick up the new unit/displayFormats — switching ranges left the X axis
  // stuck on the previous date format. Animation durations are short enough
  // (220ms on storage charts, 500ms elsewhere) that the rebuild feels smooth.
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
  document.querySelectorAll(`.hd-legend[data-for="${id}"]`).forEach(n => n.remove());

  _charts[id] = new Chart(canvas, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: false,  // intro handled by _revealChart (LR sweep); refreshes stay still
      interaction: { mode: 'index', intersect: false },
      plugins: {
        decimation: { enabled: true, algorithm: 'lttb', samples: 600 },
        legend: { display: false },
        tooltip: (opts && opts.tooltip) || { enabled: false, mode: 'index', intersect: false, external: _stdTooltipHandler(yFmt) },
        nowLine: (opts && opts.nowX != null) ? { x: opts.nowX } : false,
      },
      scales: {
        x: { type: 'time', time: xCfg, stacked,
             ...(opts && opts.xMin != null ? { min: opts.xMin } : {}),
             ...(opts && opts.xMax != null ? { max: opts.xMax } : {}),
             ...((opts && opts.xTickValues) ? { afterBuildTicks: (s) => { s.ticks = opts.xTickValues.map(value => ({ value })); } } : {}),
             ticks: { maxTicksLimit: (opts && opts.xMaxTicks) || 8, font: { size: 10 },
               // Keep time labels horizontal and let autoSkip thin them when the
               // chart is narrow (square window / sidebar open) — rotated or
               // touching x labels read as cramped. Dense when wide, sparse when not.
               maxRotation: 0, autoSkip: true, autoSkipPadding: 40,
               ...((opts && opts.xTick) ? { callback: opts.xTick } : {}) } },
        y: { beginAtZero: true, stacked,
             ...(opts && opts.yMin != null ? { min: opts.yMin } : {}),
             ...(opts && opts.yMax != null ? { max: opts.yMax } : {}),
             ticks: { maxTicksLimit: (opts && opts.yMaxTicks) || 6, font: { size: 10 },
             callback: v => yFmt ? yFmt(v) : v },
             ...(opts && opts.yAxisWidth ? { afterFit: (s) => { s.width = opts.yAxisWidth; } } : {}) }
      }
    }
  });
  // Markers the fast path checks to decide update-in-place vs rebuild.
  _charts[id]._hrs = hrs;
  _charts[id]._stacked = stacked;
  _charts[id]._yAxisWidth = (opts && opts.yAxisWidth) || undefined;

  // Custom HTML legend — every real series gets an indicator (incl. single-series
  // charts, so every graph shows what its line represents). Charts that should
  // stay legend-free pass opts.noLegend (sparklines, mini drawer charts).
  // Skip helper datasets (e.g. variance band bounds) that have invisible
  // borders — they're rendering aids, not entries the user should see.
  const legendable = datasets.filter(ds => !ds._band && ds.borderColor && ds.borderColor !== 'transparent');
  if (legendable.length >= 1 && !(opts && opts.noLegend)) {
    const leg = document.createElement('div');
    leg.className = 'hd-legend';
    leg.setAttribute('data-for', id);
    leg.innerHTML = legendable.map(ds =>
      `<span class="hd-legend-item">` +
      `<span class="hd-legend-line" style="background:${escAttr(ds.borderColor)}"></span>` +
      `${escText(ds.label)}</span>`
    ).join('');
    // legendTarget: render the legend inline in a header slot (e.g. next to the
    // sub-hdr title) instead of as its own row above the canvas — frees vertical
    // space so the chart sits higher.
    const legTgt = (opts && opts.legendTarget) ? el(opts.legendTarget) : null;
    if (legTgt) { leg.classList.add('hd-legend-inline'); legTgt.appendChild(leg); }
    else {
      // Place the legend ABOVE the fixed-height chart box (not inside it). Every
      // canvas lives in a `position:relative;height:Npx` box; inserting the legend
      // inside it ate top space and pushed the canvas — and its x-axis date labels
      // — past the bottom of the widget. (The data-for cleanup above removes the
      // prior legend, so re-renders don't duplicate it.)
      const box = canvas.parentNode;
      (box.parentNode || box).insertBefore(leg, box.parentNode ? box : canvas);
    }
  }
  _chartHideSkeleton(id);
  // Dense rolling mini-charts can opt out: a clipped first frame reads as an
  // unfinished/loading graph when the chart is rebuilt as samples arrive.
  if (!(opts && opts.noReveal)) {
    _maybeReveal(_charts[id], id, _isRefresh);  // sweep on first paint / re-visit; resume if a tick interrupted it
  }
}

function _toPoints(labels, vals) {
  return labels.map((ts, i) => ({ x: ts * 1000, y: vals[i] }));
}

// Vertical gradient helper: line color at `topAlpha` opacity at the top of the
// chart area → `bottomAlpha` at the bottom. Scriptable so it re-resolves on
// resize. Default top alpha 0.15 — low enough that 3+ overlapping series
// (e.g. Proxmox with N nodes) don't pile into muddy fills.
// Parse any CSS color we feed to a canvas gradient into {r,g,b}. Handles hex
// (#rrggbb), rgb()/rgba(), and hsl()/hsla() — the accent token resolves to an
// hsl() string at runtime, and chart literals are hex, so both must work.
function _colorRGB(color) {
  const c = (color || '').trim();
  if (c[0] === '#') { const h = c.replace('#',''); return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) }; }
  const m = c.match(/-?\d+(\.\d+)?/g) || [];
  if (/^hsl/i.test(c)) {
    const h = +m[0], s = (+m[1])/100, l = (+m[2])/100;
    const k = n => (n + h/30) % 12, a = s*Math.min(l,1-l), f = n => l - a*Math.max(-1, Math.min(k(n)-3, 9-k(n), 1));
    return { r: Math.round(255*f(0)), g: Math.round(255*f(8)), b: Math.round(255*f(4)) };
  }
  return { r: +m[0]||0, g: +m[1]||0, b: +m[2]||0 };
}

function _chartGradient(color, topAlpha, bottomAlpha) {
  const aTop = topAlpha != null ? topAlpha : 0.15;
  const aBot = bottomAlpha != null ? bottomAlpha : 0;
  return ctx => {
    const c = ctx.chart, area = c.chartArea;
    if (!area) return 'rgba(0,0,0,0)';
    const { r, g, b } = _colorRGB(color);
    const grad = c.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    grad.addColorStop(0, `rgba(${r},${g},${b},${aTop})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},${aBot})`);
    return grad;
  };
}

// Adaptive bucket size for raw time-series. Target ~150–300 points on screen
// across the range, so dense raw samples don't render as a spike-forest.
function _bucketSec(hrs) {
  if (!hrs || hrs <= 24)  return 300;     // 1d  → 5-min
  if (hrs <= 168)         return 3600;    // 7d  → 1-hour
  if (hrs <= 720)         return 21600;   // 30d → 6-hour
  return 86400;                            // All → 1-day
}

// Bucket raw (labels, vals) into fixed-width windows; emit avg + p25/p75 per
// bucket. p25/p75 (interquartile range) gives a tighter band than p10/p90 —
// avoids the band spanning to zero on sparse series (e.g. overnight bandwidth).
function _bucketStats(labels, vals, bucketSec) {
  const buckets = new Map();
  for (let i = 0; i < labels.length; i++) {
    const v = vals[i];
    if (v == null || !Number.isFinite(v)) continue;
    const k = Math.floor(labels[i] / bucketSec);
    let s = buckets.get(k);
    if (!s) { s = { sum: 0, n: 0, vals: [] }; buckets.set(k, s); }
    s.vals.push(v); s.sum += v; s.n += 1;
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const out = { labels: [], avg: [], lo: [], hi: [] };
  for (const k of keys) {
    const s = buckets.get(k);
    const sorted = [...s.vals].sort((a, b) => a - b);
    const pct = p => {
      const idx = p / 100 * (sorted.length - 1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    out.labels.push(k * bucketSec + Math.floor(bucketSec / 2));
    out.avg.push(s.sum / s.n);
    out.lo.push(pct(25));
    out.hi.push(pct(75));
  }
  return out;
}

// Avg line only — the clean default. 1.5px stroke at 0.85 alpha.
// extra: optional props spread onto the dataset (e.g. { yAxisID, tooltipFormat }).
// extra.gradient: vertical fill under the line.
//   true   → strong storage-style 0.30 → 0.03 (use for ≤2 series)
//   'soft' → muted 0.15 → 0 (use for N-series; tuned so overlapping fills
//            don't pile into muddy color blobs)
// extra.gradient is consumed locally, not spread onto the dataset.
function _dsAvgOnly(label, bucketed, color, extra) {
  const { r, g, b } = _colorRGB(color);
  let restExtra = extra, gradMode = null;
  if (extra && 'gradient' in extra) {
    const { gradient, ...rest } = extra;
    gradMode = gradient === 'soft' ? 'soft' : (gradient ? 'strong' : null);
    restExtra = rest;
  }
  const bg = gradMode === 'strong' ? _chartGradient(color, 0.30, 0.03)
           : gradMode === 'soft'   ? _chartGradient(color, 0.15, 0)
           : 'transparent';
  return { label, data: _toPoints(bucketed.labels, bucketed.avg),
    borderColor: `rgba(${r},${g},${b},0.85)`,
    backgroundColor: bg,
    pointBackgroundColor: color, borderWidth: 1.5,
    pointRadius: 0, pointHoverRadius: 4,
    tension: 0.4, fill: gradMode ? 'origin' : false, spanGaps: true, _bandFor: label,
    ...(restExtra || {}) };
}

// Two hidden band datasets (p25/p75 interquartile range). Revealed on hover
// or Range toggle. Both use fill:false — Chart.js's filler plugin fires even
// on hidden datasets, causing phantom shading. Bands render as thin faint
// guide lines instead, which is reliable and avoids the fill system entirely.
// extra: optional props spread onto both datasets (e.g. { yAxisID }).
function _dsBandHidden(label, bucketed, color, extra) {
  const hex = color.replace('#','');
  const r = parseInt(hex.slice(0,2),16);
  const g = parseInt(hex.slice(2,4),16);
  const b = parseInt(hex.slice(4,6),16);
  const lineColor = `rgba(${r},${g},${b},0.30)`;
  const L = bucketed.labels;
  const base = {
    borderColor: lineColor, backgroundColor: 'transparent',
    pointRadius: 0, pointHoverRadius: 0, tension: 0.4,
    fill: false, spanGaps: true, hidden: true, _band: true, _bandFor: label,
    ...(extra || {})
  };
  return [
    { ...base, label: label + '_lo', data: _toPoints(L, bucketed.lo) },
    { ...base, label: label + '_hi', data: _toPoints(L, bucketed.hi) },
  ];
}

// ── Chart range-band toggle (explicit user opt-in, no hover behavior) ────
// Hover used to reveal a single series' band, but it caused the chart to
// resize as the Y-axis re-scaled to include the band values and added a
// stray faint line that read as a glitch. Bands now only appear via the
// explicit "Range" toggle in the chart header.
const _chartBandState = {};

function _toggleChartRange(canvasId, btn) {
  _chartBandState[canvasId] = !_chartBandState[canvasId];
  btn.classList.toggle('active', !!_chartBandState[canvasId]);
  const chart = _charts[canvasId];
  if (!chart) return;
  chart.data.datasets.forEach(ds => { if (ds._band) ds.hidden = !_chartBandState[canvasId]; });
  chart.update('none');
}

function _wireChartHover(canvasId) {
  const canvas = el(canvasId);
  if (!canvas) return;
  const chart = _charts[canvasId];
  if (!chart || !chart.data.datasets.some(ds => ds._band)) return;

  // Re-apply toggle state after chart rebuild (e.g. range button switch)
  const showRange = !!_chartBandState[canvasId];
  if (showRange) {
    chart.data.datasets.forEach(ds => { if (ds._band) ds.hidden = false; });
    chart.update('none');
  }

  // Auto-inject Range toggle button into the nearest sec-hdr
  const wrap = canvas.parentNode;
  const btnId = canvasId + '-range-btn';
  if (!el(btnId) && wrap) {
    const hdr = wrap.previousElementSibling;
    if (hdr && hdr.classList.contains('sec-hdr')) {
      const btn = document.createElement('button');
      btn.id = btnId;
      btn.className = 'chart-range-toggle';
      if (showRange) btn.classList.add('active');
      btn.textContent = 'Range';
      btn.addEventListener('click', () => _toggleChartRange(canvasId, btn));
      hdr.appendChild(btn);
    }
  } else if (el(btnId)) {
    el(btnId).classList.toggle('active', showRange);
  }
}

// Standard line-series factory. Smooth (tension 0.4), 2-px stroke, vertical
// gradient area fill, no static markers, hover marker radius 4. Callers may
// override any property via spread, e.g. { ..._ds(...), fill: false }.
function _ds(label, data, color) {
  return { label, data,
    borderColor: color,
    backgroundColor: _chartGradient(color),
    pointBackgroundColor: color,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
    tension: 0.4,
    fill: true,
    spanGaps: true,
  };
}
