
// ── Global ────────────────────────────────────────────────────────────────
// ── Helpers ───────────────────────────────────────────────────────────────
function fmtBytes(b, d=1) {
  if (!b || b===0) return '0 B';
  const k=1024, u=['B','KB','MB','GB','TB','PB'];
  const i=Math.floor(Math.log(b)/Math.log(k));
  return (b/Math.pow(k,i)).toFixed(d)+' '+u[i];
}
function fmtUptime(s) {
  if (!s) return '—';
  const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  if(d>0) return `${d}d ${h}h`; if(h>0) return `${h}h ${m}m`; return `${m}m`;
}
function timeAgo(ms) {
  if (!ms) return '—';
  const diff=Date.now()-ms, mins=Math.floor(diff/60000), hrs=Math.floor(mins/60), days=Math.floor(hrs/24);
  if(days>0) return `${days}d ago`; if(hrs>0) return `${hrs}h ago`; if(mins>0) return `${mins}m ago`; return 'just now';
}
function barCls(pct) { return pct<60?'bar-green':pct<80?'bar-yellow':'bar-red'; }
function barHex(pct)  { return pct<60?'#22C55E':pct<80?'#F59E0B':'#EF4444'; }
function sdot(status) {
  const ok=status==='running'||status==='online'||status===true;
  const off=status==='stopped'||status===false;
  const cls=ok?'sdot-green dot-live':off?'sdot-grey':'sdot-red';
  return `<span class="sdot ${cls} flex-shrink-0"></span>`;
}
function el(id) { return document.getElementById(id); }
function setInner(id,html) { const e=el(id); if(e) e.innerHTML=html; }

// Context-specific HTML helpers. Keep text, attribute and URL handling
// separate so API/config values cannot change the markup context they land in.
// `esc` remains as the conservative compatibility alias used by older renderers.
function escText(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escAttr(v) {
  return escText(v).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function safeHttpUrl(v) {
  const raw = String(v == null ? '' : v).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
  } catch(e) { return ''; }
}
function esc(v) { return escAttr(v); }

// ── Generic client-side table sorting ───────────────────────────────────────
// Sort state per table key survives the WS re-renders (the table's render fn
// reads it). A table: (1) toggles via _sortSet on a header click, (2) orders
// rows via _sortApply(key, rows, keyFn), (3) draws headers via _sortTh.
window._sortState = window._sortState || {};
function _sortSet(tbl, key, defDir, render) {
  const s = window._sortState[tbl] || (window._sortState[tbl] = { k: key, d: defDir });
  if (s.k === key) s.d = -s.d; else { s.k = key; s.d = defDir; }
  if (typeof render === 'function') render();
}
function _sortApply(tbl, rows, keyFn) {
  const s = window._sortState[tbl]; if (!s) return rows;
  return rows.slice().sort((a, b) => { const av = keyFn(a, s.k), bv = keyFn(b, s.k); return (av < bv ? -1 : av > bv ? 1 : 0) * s.d; });
}
// A clickable, caret-annotated header cell. `onclick` is the call string, e.g. "_netSort('node')".
function _sortTh(tbl, key, label, onclick, align, extra) {
  const s = window._sortState[tbl] || {}; const on = s.k === key;
  const car = on ? (s.d < 0 ? ' ▾' : ' ▴') : '';
  return '<th onclick="' + onclick + '" style="cursor:pointer;user-select:none;white-space:nowrap;text-align:' + (align || 'left')
    + ';color:' + (on ? 'var(--c-text)' : 'var(--c-muted)') + ';' + (extra || '') + '">' + label + car + '</th>';
}
function sRow(lbl, val) {
  return `<div class="stat-mini"><span class="stat-mini-lbl">${lbl}</span><span class="stat-mini-val">${val}</span></div>`;
}
// `card-stub` marks a compact placeholder card (disabled/offline) so flex/grid
// containers that stretch real cards to full height for offline/disabled service cards
// can opt the stub out of the stretch instead of ballooning it into a void.
function offlineCard(title, err) {
  return `<div class="hd-card card-stub p-4"><div class="flex justify-between items-center mb-2"><span class="font-medium text-sm">${escText(title)}</span><span class="badge badge-down">DOWN</span></div><div class="text-xs" style="color:#EF4444">${escText(err||'Offline')}</div></div>`;
}

// ── History (sparklines) ──────────────────────────────────────────────────
const _ov={cpu:[],ram:[],wan_rx:[],wan_tx:[],dl:[],nodes:{},MAX:40};
// ── SVG helpers ───────────────────────────────────────────────────────────
// ── Icon registry (Lucide paths) ─────────────────────────────────────────
const _IC={
  server:'<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
  cpu:'<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>',
  monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
  layers:'<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  database:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  'share-2':'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  archive:'<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  gauge:'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  'hard-drive':'<line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/>',
  play:'<polygon points="5 3 19 12 5 21 5 3"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  'cloud-download':'<polyline points="8 17 12 21 16 17"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.88 18.09A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.29"/>',
  wifi:'<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  network:'<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="5" y1="16" x2="12" y2="12"/><line x1="19" y1="16" x2="12" y2="12"/>',
  activity:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  list:'<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  video:'<path d="M23 7 16 12 23 17z"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
  calendar:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  'layout-grid':'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  moon:'<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun:'<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  'log-out':'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  'refresh-cw':'<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-.06-5.79"/>',
  'alert-circle':'<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  film:'<rect x="2" y="2" width="20" height="20" rx="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  tv:'<rect x="2" y="7" width="20" height="15" rx="2" ry="2"/><polyline points="17 2 12 7 7 2"/>',
  'check-circle':'<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  'x-circle':'<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  check:'<polyline points="20 6 9 17 4 12"/>',
  clock:'<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  loader:'<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>',
  'pie-chart':'<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  music:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
  zap:'<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  battery:'<rect x="1" y="6" width="18" height="12" rx="2"/><line x1="23" y1="11" x2="23" y2="13"/>',
  'battery-charging':'<path d="M5 18H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.19M15 6h2a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3.19"/><line x1="23" y1="11" x2="23" y2="13"/><polyline points="11 6 7 12 13 12 9 18"/>',
  grid:'<path d="M9 2v6M15 2v6M9 16v6M15 16v6M2 9h6M16 9h6M2 15h6M16 15h6"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  speaker:'<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><line x1="12" y1="6" x2="12.01" y2="6"/>',
  pause:'<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
  'skip-back':'<polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>',
  'skip-forward':'<polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>',
  eye:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':'<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
  x:'<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  'trash-2':'<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
};
function svg(name,size=16){const p=_IC[name]||'';return`<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;}

// Deterministic per-user avatar color (HSL) — gives every user a distinct circle even without a thumb
const _AV_PALETTE = ['#6366F1','#8B5CF6','#EC4899','#F59E0B','#10B981','#0EA5E9','#EF4444','#14B8A6','#A855F7','#F97316'];
// opts (all optional, defaults preserve the classic look): font — text px
// (default scales with size); track — unfilled-arc color (default
// var(--c-bar-bg), which can vanish on var(--c-hover) surfaces — pass
// var(--c-border) there so the full gauge ring stays visible).
// Dark-background KPI stat tile (used by the overview + time-range summaries).
function _statTile(value, label, color) {
  return `<div class="text-center p-2 rounded" style="background:var(--c-bg)">`
    + `<div class="font-semibold text-sm hd-num"${color ? ` style="color:${color}"` : ''}>${value}</div>`
    + `<div class="text-xs" style="color:var(--c-muted)">${label}</div></div>`;
}

function _donut(pct,size,color,opts) {
  opts = opts || {};
  const r=size*.38,cx=size/2,cy=size/2,sw=Math.round(size*.13);
  const arcLen=0.75*2*Math.PI*r;
  const toR=d=>d*Math.PI/180;
  const sx=(cx+r*Math.cos(toR(135))).toFixed(2),sy=(cy+r*Math.sin(toR(135))).toFixed(2);
  const ex=(cx+r*Math.cos(toR(45))).toFixed(2), ey=(cy+r*Math.sin(toR(45))).toFixed(2);
  const d=`M ${sx},${sy} A ${r.toFixed(2)},${r.toFixed(2)} 0 1,1 ${ex},${ey}`;
  const offset=(arcLen*(1-Math.min(Math.max(pct,0),100)/100)).toFixed(1);
  const font=opts.font||Math.round(size*.22);
  const track=opts.track||'var(--c-bar-bg)';
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <path d="${d}" fill="none" stroke="${track}" stroke-width="${sw}" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"
      stroke-dasharray="${arcLen.toFixed(1)} 9999" stroke-dashoffset="${offset}"/>
    <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      style="fill:var(--c-text);font-size:${font}px;font-weight:600;font-family:Inter,monospace">${pct}%</text>
  </svg>`;
}
// ── SWR JSON cache ──────────────────────────────────────────────────────────
// Stale-while-revalidate, à la TanStack Query. Page loaders fetch through this
// instead of fetch() so revisiting a page paints the last result instantly and
// only hits the network when the cache is older than one poll tick. A
// background refetch repaints (via the redraw thunk) when fresh data differs.
const _SWR_TTL = 9000;          // ms — treat cache as fresh within one poll interval
const _swrCache = new Map();    // url -> { data, ts }
const _swrInflight = new Map(); // url -> Promise<boolean changed>
function _swrHas(url){ return _swrCache.has(url); }
function _swrRevalidate(url){
  if(_swrInflight.has(url)) return _swrInflight.get(url);
  const p = fetch(url)
    .then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(data => {
      const prev = _swrCache.get(url);
      const changed = !prev || JSON.stringify(prev.data) !== JSON.stringify(data);
      _swrCache.set(url, { data, ts: Date.now() });
      _swrInflight.delete(url);
      return changed;
    })
    .catch(e => { _swrInflight.delete(url); throw e; });
  _swrInflight.set(url, p);
  return p;
}
// Returns cached data immediately when present; otherwise awaits the fetch.
// When the cache is stale it refetches in the background and calls redraw() if
// the payload changed, so the caller can repaint with fresh data.
async function _swrJSON(url, redraw){
  const c = _swrCache.get(url);
  if(c){
    if(Date.now() - c.ts >= _SWR_TTL){
      _swrRevalidate(url).then(changed => { if(changed && redraw) redraw(); }).catch(()=>{});
    }
    return c.data;
  }
  await _swrRevalidate(url);
  return _swrCache.get(url).data;
}
