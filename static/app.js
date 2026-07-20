
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
// ── Page router ───────────────────────────────────────────────────────────
const PAGES=['overview','proxmox','storage','network','backups','topology','health','security','tools','tars','settings'];
const PAGE_LABELS={overview:'Overview',proxmox:'Compute',storage:'Storage',network:'Network',backups:'Backups',topology:'Topology',health:'Health',security:'Security',tools:'Tools',tars:'Assistant',settings:'Settings'};
// URL slug per page — children of a sidebar dropdown nest under the parent slug.
const PAGE_SLUGS={overview:'/overview',proxmox:'/compute',storage:'/storage',network:'/network',backups:'/backups',topology:'/topology',health:'/health',security:'/security',tools:'/tools',tars:'/assistant',settings:'/settings'};
const SLUG_TO_PAGE=Object.fromEntries(Object.entries(PAGE_SLUGS).map(([k,v])=>[v,k]));
let currentPage='overview';
// Navigation epoch — bumped by showPage() so charts replay their intro sweep on
// each visit. MUST be declared here, before the boot IIFE calls showPage(): it
// was previously declared far below, so on a deep-link refresh showPage() hit a
// `let` Temporal Dead Zone on the first `_navEpoch++`, threw before setting
// currentPage, and the next WS tick stamped the tab title from the stale default
// ('overview') — every page's title flipped to "Overview | ProxDash" on refresh.
let _navEpoch = 0;
// Lazy page loader: each page lives in /static/pages/<name>.html and is fetched once on first visit.
// Base title = the part after "<Page> | " (the server may serve the shell with
// the page already in the title on a deep link); plain "ProxDash" has no
// separator and is kept as-is.
let _pageBaseTitle = (document.title || 'Proxdash').replace(/^.*\s\|\s/, '');
let _firstNav = true;
const _pagesLoaded = new Set();
const _pagesLoading = new Map();
// Some page-init functions are defined in a LATER <script> block than the boot
// IIFE that first calls showPage(). On a deep-link refresh the init can fire
// before its function exists (ReferenceError). This retries until it's defined.
// Recreate the favicon <link> with the current logo URL. Setting the same href
// is a no-op to the browser, so a fresh node is what forces the refetch that
// overwrites a stale per-URL favicon-database entry.
function _reassertFavicon(){
  try {
    var u;
    try { u = localStorage.getItem('hd-logo') || ''; } catch(e){ u = ''; }
    if(!u) u = (typeof _defaultLogoUrl === 'function') ? _defaultLogoUrl() : '/api/logo?theme=dark';
    var l = document.createElement('link');
    l.rel = 'icon'; l.href = u;
    var old = document.querySelector('link[rel="icon"]');
    if(old) old.replaceWith(l); else document.head.appendChild(l);
  } catch(e){}
}

function _deferInit(fnName, arg){
  const run=()=>{ const f=window[fnName]; if(typeof f==='function'){ try{f(arg);}catch(e){console.error(e);} } else setTimeout(run,30); };
  setTimeout(run,0);
}
// CSRF double-submit token: read the (non-HttpOnly) hd_csrf cookie the server
// sets, to echo in the X-CSRF-Token header on state-changing POSTs.
function _csrf(){ const m=document.cookie.match(/(?:^|;\s*)hd_csrf=([^;]+)/); return m?decodeURIComponent(m[1]):''; }
async function _loadPage(name) {
  if(_pagesLoaded.has(name)) return;
  if(_pagesLoading.has(name)) return _pagesLoading.get(name);
  const host = el('pages-host');
  if(!host) return;
  const p = (async () => {
    try {
      // no-cache → always revalidate with the server so an edited fragment is
      // never served stale from the browser cache (caused the topology header to
      // intermittently render an old cached version).
      const r = await fetch('/static/pages/' + name + '.html', {cache:'no-cache'});
      if(!r.ok) throw new Error('HTTP ' + r.status);
      const html = await r.text();
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      // Drop the loading placeholder (if one was shown for an instant switch)
      // before inserting the real fragment, so we don't end up with two
      // #page-<name> elements.
      const _ph = el('page-' + name);
      if (_ph) _ph.remove();
      while(wrap.firstChild) host.appendChild(wrap.firstChild);
      // A fragment may ship with `active` baked in (or be loaded by the
      // background prefetch while another page is showing). Mark active only when
      // it's the page the user is currently on — otherwise it renders stacked.
      const node = el('page-' + name);
      if (node) node.classList.toggle('active', name === currentPage);
      _pagesLoaded.add(name);
    } catch(e) {
      console.error('Failed to load page', name, e);
    } finally {
      _pagesLoading.delete(name);
    }
  })();
  _pagesLoading.set(name, p);
  return p;
}
function _setPageTitle(name){
  document.title = (PAGE_LABELS[name] || name) + ' | ' + _pageBaseTitle;
}
function _animReduce() { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
// Show the mobile top-bar's bottom divider only once content scrolls under it.
function _mobileHdrSync() {
  const hdr = el('mobile-hdr'); if (!hdr) return;
  // Mobile scrolls the document; desktop scrolls #pages-root (bar hidden there).
  const y = window.scrollY || window.pageYOffset || (el('pages-root') ? el('pages-root').scrollTop : 0);
  hdr.classList.toggle('scrolled', y > 2);
  // Publish the bar's real rendered height (includes the safe-area top padding)
  // so full-bleed pages can pin themselves directly below it.
  if (hdr.offsetParent !== null) {
    const h = Math.round(hdr.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty('--mob-hdr-h', h + 'px');
  }
}
// Keep the browser chrome (iOS Safari status bar / Android toolbar) in sync with
// the active theme. theme-color meta is static black for the dark default; flip
// it to white in light mode so the status bar doesn't read black over a white page.
function _syncThemeColor() {
  const dark = document.documentElement.classList.contains('dark');
  const m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute('content', dark ? '#000000' : '#ffffff');
}
// Mobile uses document scroll + a sticky header now, so content flows naturally
// after the bar — no measured top-padding needed. Clear any stale inline value.
function _syncMobilePad() {
  const pr = el('pages-root'); if (pr) pr.style.removeProperty('padding-top');
}
// Staggered entrance for a page's top-level blocks on navigation. Gated to
// nav (called from showPage), skips reduced-motion and the Backups page (its
// 1139-row table makes the
// forced offsetParent reflow + tween cost ~330ms — not worth the eye-candy on a
// data-dense page), and runs only if GSAP is present.
function _animPageEnter(name) {
  if (_animReduce() || name === 'backups' || !window.gsap) return;
  const root = el('page-' + name); if (!root) return;
  const kids = [...root.children].filter(c => c.offsetParent !== null);
  if (kids.length) {
    gsap.killTweensOf(kids);
    // Snappier than the old .34/.045 stagger: shorter duration and a CAPPED total
    // stagger (amount) so pages with many sections still settle quickly instead of
    // scaling stagger time with child count.
    gsap.fromTo(kids, { opacity: 0, y: 12 },
      { opacity: 1, y: 0, duration: .5, stagger: { amount: .3 }, ease: 'power2.out', clearProps: 'transform,opacity', overwrite: true });
  }
  _animNumbersIn(root);
}
// Roll pure-number "hero" values (header meta + section badges) up to their
// rendered value once on entrance. Skips anything that isn't a clean number
// (IPs, "32/35", text) and lands exactly on the original string.
// Roll one element's pure-number text up from 0 to its rendered value. Returns
// true if it animated (clean positive number), false if skipped (IPs, "32/35",
// unit-suffixed, text, zero) — callers use the return to know whether it fired.
function _animCountEl(eln) {
  const raw = eln.textContent.trim();
  const m = raw.match(/^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(\s*%?)$/);
  if (!m) return false;
  const target = parseFloat(raw.replace(/,/g, ''));
  if (!isFinite(target) || target <= 0) return false;
  const decimals = m[2] ? m[2].length : 0, hasComma = raw.includes(','), suffix = m[3] || '';
  const o = { v: 0 };
  gsap.to(o, {
    v: target, duration: .9, ease: 'power2.out',
    onUpdate: () => {
      let s = decimals ? o.v.toFixed(decimals) : String(Math.round(o.v));
      if (hasComma) s = Number(s).toLocaleString();
      eln.textContent = s + suffix;
    },
    onComplete: () => { eln.textContent = raw; },
  });
  return true;
}
function _animNumbersIn(root) {
  if (_animReduce() || !window.gsap) return;
  root.querySelectorAll('.page-hdr-meta-item b, .sec-hdr-badge').forEach(_animCountEl);
}
// Stat-tile numbers populate on a WS render AFTER _animPageEnter fired, so roll
// them up from a post-render sweep (called each tick from render()). Gated on
// _navEpoch: fires once per page visit, and only once the tiles actually hold
// numbers (retries on later ticks if the first render hadn't filled them yet).
const _numIntroEpoch = {};
function _introNums(page) {
  if (_animReduce() || !window.gsap || !page) return;
  if (_numIntroEpoch[page] === _navEpoch) return;
  const root = el('page-' + page); if (!root) return;
  const els = root.querySelectorAll('.hd-num, .stat-tile-val');
  if (!els.length) { _numIntroEpoch[page] = _navEpoch; return; }  // no stat tiles on this page
  let any = false;
  els.forEach(eln => { if (_animCountEl(eln)) any = true; });
  if (any) _numIntroEpoch[page] = _navEpoch;  // fired; else retry next tick once values land
}
// Card-grid stagger, sparkline draw-on, and heatmap cell stagger — each fires the
// first time its targets populate on a page, then ONCE per session (not per visit
// like the count-up: resetting opacity/scale on revisit would flicker against the
// block-fade). Retries on later ticks until the data lands. Reduced-motion + GSAP gated.
const _gridDone = {}, _sparkDone = {}, _heatDone = {};
function _introGrids(page) {
  if (_animReduce() || !window.gsap || !page || _gridDone[page]) return;
  const root = el('page-' + page); if (!root) return;
  const grids = [...root.querySelectorAll('[id$="-grid"]')];
  if (!grids.length) { _gridDone[page] = 1; return; }
  let any = false;
  grids.forEach(g => {
    const cards = [...g.children].filter(c => c.nodeType === 1 && c.offsetParent !== null);
    if (!cards.length) return;
    any = true;
    gsap.killTweensOf(cards);
    gsap.fromTo(cards, { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: .45, stagger: { amount: Math.min(.5, cards.length * .04) }, ease: 'power2.out', clearProps: 'transform,opacity', overwrite: true });
  });
  if (any) _gridDone[page] = 1;
}
function _introSparks(page) {
  if (_animReduce() || !window.gsap || !page || _sparkDone[page]) return;
  const root = el('page-' + page); if (!root) return;
  const paths = [...root.querySelectorAll('path.hd-spark')];
  if (!paths.length) { _sparkDone[page] = 1; return; }
  let any = false;
  paths.forEach(p => {
    let len; try { len = p.getTotalLength(); } catch (e) { return; }
    if (!len) return;
    any = true;
    p.style.strokeDasharray = len; p.style.strokeDashoffset = len;
    gsap.to(p, { strokeDashoffset: 0, duration: .8, ease: 'power2.out', clearProps: 'strokeDasharray,strokeDashoffset' });
  });
  if (any) _sparkDone[page] = 1;
}
function _introHeat(page) {
  if (_animReduce() || !window.gsap || !page || _heatDone[page]) return;
  const root = el('page-' + page); if (!root) return;
  const cells = [...root.querySelectorAll('.hm-cell')].filter(c => c.offsetParent !== null);
  if (!cells.length) { _heatDone[page] = 1; return; }
  _heatDone[page] = 1;
  gsap.killTweensOf(cells);
  gsap.fromTo(cells, { opacity: 0, scale: .6 },
    { opacity: 1, scale: 1, duration: .4, stagger: { amount: .5 }, ease: 'power2.out', clearProps: 'transform,opacity', overwrite: true });
}
// One post-render entrance sweep for the active page (called each WS tick).
function _introReveal(page) {
  _introNums(page);
  _introGrids(page);
  _introSparks(page);
  _introHeat(page);
}

// Funny loading lines (Sonarr/Radarr-style) shown while a page fragment is still
// fetching — keeps navigation feeling instant even on a flaky connection.
const _LOADING_QUIPS = [
  "It's probably DNS…",
  "Bribing the hypervisor…",
  "Asking the NAS nicely…",
  "Reticulating splines…",
  "Counting the containers…",
  "Tailing the logs for clues…",
  "Negotiating with Ceph…",
  "Waking the drives from sleep…",
  "Warming up the GPUs…",
  "Untangling the VLANs…",
  "Consulting the Proxmox oracle…",
  "Defragmenting the vibes…",
  "Pinging the void…",
  "Convincing the cron jobs to hurry…",
  "Routing packets the scenic way…",
  "Herding the LXCs…",
  "Re-seating the photons…",
  "Blaming whoever touched it last…",
  "Checking if it's plugged in…",
  "Summoning the cluster gods…",
  "Spinning up the hamster wheel…",
  "Have you tried turning it off and on again?",
];
function _pageLoadingHTML(){
  const q = _LOADING_QUIPS[Math.floor(Math.random()*_LOADING_QUIPS.length)];
  return `<div class="hd-page-loading"><div class="orb-scene"><span class="planet"></span><span class="spin"><span class="sat"></span></span></div><div class="quip">${q}</div></div>`;
}
// Make sure a #page-<name> element exists right now — a loading placeholder if
// the real fragment hasn't been fetched yet — so the page can switch instantly.
function _ensurePagePlaceholder(name){
  if(el('page-'+name)) return;
  const host=el('pages-host'); if(!host) return;
  const d=document.createElement('div');
  d.id='page-'+name; d.className='page'; d.dataset.ph='1';
  d.innerHTML=_pageLoadingHTML();
  host.appendChild(d);
}
// A freshly-shown page should start at the top. Mobile scrolls the document;
// desktop scrolls #pages-root — reset both (the inactive one is a no-op). Without
// this, switching pages carried your old scroll offset onto the next page: you'd
// "start halfway down", and on a shorter page that left blank space scrolled into
// below its content.
function _scrollPageTop(){
  window.scrollTo(0,0);
  const pr=el('pages-root'); if(pr) pr.scrollTop=0;
}
function _activatePages(name){
  PAGES.forEach(p=>{
    const e=el('page-'+p); if(e) e.classList.toggle('active',p===name);
    const n=el('nav-'+p); if(n){
      const wasActive=n.getAttribute('data-active')==='true';
      n.setAttribute('data-active',p===name?'true':'false');
      if(p===name){
        n.setAttribute('aria-current','page');
        // The second _activatePages() after a lazy fragment load must not replay
        // the motion. Only animate the edge from inactive -> active.
        if(!wasActive && typeof _navIconPlay==='function') _navIconPlay(n);
      } else n.removeAttribute('aria-current');
    }
  });
}

async function showPage(name, opts) {
  opts = opts || {};
  _navEpoch++;  // mark a fresh navigation so this page's charts replay their intro sweep
  const _prevPage = currentPage;  // enter/leave transition checks below need the OLD page
  // Commit the target page + title NOW, before the awaited _loadPage and any
  // render() below. render()'s meta step sets document.title from currentPage,
  // so if a WS tick lands during the load with currentPage still stale, the tab
  // title (and anything else keyed off currentPage) flips to the old page.
  currentPage=name; localStorage.setItem('hd-page',name);
  _setPageTitle(name);
  // Set the mobile top-bar title here, synchronously — NOT after the await below.
  // If it sits after `await _loadPage`, a slow/failed load (or a throw in one of
  // the hooks in between) leaves it stuck on the shell's default "Overview" even
  // though the page content rendered fine. Keep it in lockstep with the tab title.
  { const _mpt=el('mobile-page-title'); if(_mpt) _mpt.textContent=PAGE_LABELS[name]||name; }
  // URL sync: replace on first call (so /, /overview, /<anything> all settle cleanly),
  // push on subsequent user-driven nav, skip when invoked from popstate.
  const targetPath = PAGE_SLUGS[name] || ('/' + name);
  if(!opts.fromPopstate){
    if(_firstNav){
      history.replaceState({page:name}, '', targetPath);
      _firstNav = false;
    } else if(location.pathname !== targetPath){
      history.pushState({page:name}, '', targetPath);
    }
  }
  // Re-assert the favicon after every URL change: browsers key their favicon
  // database PER URL, so a pushState to e.g. /storage can resurrect an ancient
  // icon remembered for that path. Recreating the <link> forces a lookup of the
  // current art (and overwrites the stale per-URL memory for good).
  _reassertFavicon();
  // Switch to the page IMMEDIATELY so navigation never stalls on a slow/dead
  // connection: if the fragment isn't loaded yet, a loading placeholder shows now
  // and _loadPage swaps in the real content when it arrives.
  _ensurePagePlaceholder(name);
  _activatePages(name);
  _scrollPageTop();                // land at the top of the new page, not the old offset
  // Paint the active-nav highlight + loading placeholder BEFORE the (often heavy)
  // fragment load + render. Otherwise the synchronous render coalesces with the
  // class change into a single late paint, so the button only "looks pressed" once
  // the page is ready. A 2-frame yield lets the press register instantly; the page
  // then fills a beat later. (Skipped for popstate so back/forward stays snappy.)
  if(!opts.fromPopstate){
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    if(currentPage!==name) return; // user tapped another nav during the yield
  }
  await _loadPage(name);
  if(currentPage!==name) return;   // user navigated away during a slow load
  _activatePages(name);            // re-activate the now-swapped-in real node
  _scrollPageTop();                // real fragment changes height — keep us pinned to top
  // Paint the just-loaded page from the cached snapshot right away; otherwise
  // its live tiles stay blank until the next WS tick (up to poll_interval s).
  if(window._lastData) render(window._lastData);
  if(name==='health'&&_prevPage!=='health'){ loadHealthHeatmap(); }
  // Topology fullbleed: remove padding + suppress outer scroll so the view
  // reaches every edge (no card border / page gutter).
  const pr=el('pages-root');
  const isMob=window.innerWidth<768;
  const fullBleed=(name==='topology');
  if(pr){pr.style.padding=fullBleed?'0':(isMob?'16px':'24px');pr.style.overflow=fullBleed?'hidden':'auto';pr.style.position=(name==='topology')?'relative':'';}
  sidebarClose();
  if(name==='proxmox') { setTimeout(()=>{loadPxHistory(); if(typeof _cmpInit==='function')_cmpInit();},0); }
  if(name==='tars') setTimeout(()=>{ if(typeof _tarsPageShow==='function') _tarsPageShow(); },0);
  if(name==='overview')      { setTimeout(()=>{loadOvResources(_histGetHours('ov-infra'));if(typeof _loadPbsDetail==='function')_loadPbsDetail();},0); }
  if(name==='topology')      _deferInit('_topoInit');
  if(name==='storage')       _deferInit('_storageInit');
  if(name==='network')       { _deferInit('_networkInit'); setTimeout(()=>{ if(typeof loadPxNetHistory==='function' && el('chart-pxnet-in')) loadPxNetHistory(); },0); }
  if(name==='tools')         _deferInit('initToolsPage');
  if(name==='settings')      setTimeout(()=>loadSettingsPage(),0);
  // render(_lastData) above already painted the table from cache; _loadPbsDetail
  // re-renders once when fresh snapshot detail lands. The extra synchronous
  // renderBackups() here was a third full build per nav (~450ms wasted).
  if(name==='backups')       setTimeout(()=>{_loadPbsDetail();},0);
  _histSchedule();
  // Entrance animation once per page per session (like _staggerInPage below):
  // first visit fades/staggers in; revisits paint instantly instead of replaying
  // the ~0.8s sweep on every navigation, which is the page-switch lag.
  if (!_enteredPages.has(name)) { _enteredPages.add(name); _animPageEnter(name); }
  _mobileHdrSync();
  _syncMobilePad();
  // Cascade the page's card grids in the first time it's shown this session
  // (cards are already painted by background renders, so animate-on-view rather
  // than on-populate — which would play hidden during prefetch). rAF lets a
  // first-load render tick populate empty grids before we stagger.
  if (!_staggeredPages.has(name)) { _staggeredPages.add(name); requestAnimationFrame(() => _staggerInPage(name)); }
}

// First-appearance stagger for card grids (Emil): grids share an `id$="-grid"`
// convention. Each child fades+rises in with a short, capped per-item delay.
// Once per page per session (guarded by _staggeredPages) so flipping between
// pages doesn't re-cascade, and skipped entirely under reduced-motion.
const _staggeredPages = new Set();
const _enteredPages = new Set();   // pages whose entrance animation has played this session
function _staggerInPage(name) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const page = el('page-' + name); if (!page) return;
  page.querySelectorAll('[id$="-grid"]').forEach(grid => {
    const kids = grid.children;
    if (kids.length < 2) return;            // nothing to cascade
    for (let i = 0; i < kids.length; i++) {
      kids[i].style.animationDelay = Math.min(i * 35, 280) + 'ms';
      kids[i].classList.add('stagger-in');
    }
  });
}

// ── Auto-reload on a new deploy ───────────────────────────────────────────────
// The SPA fetches each page fragment once per session (_pagesLoaded) and never
// re-fetches it on in-app navigation — so after a deploy, an open tab keeps
// rendering the old HTML until a full page reload clears that memory cache.
// build.sh stamps this bundle with window.__BUILD__ and writes the same hash to
// /static/version.txt. When a deploy changes the source, the served version.txt
// no longer matches the running tab's __BUILD__, so we reload once to pick it up.
async function _checkBuildVersion(){
  if (window._vReloading || !window.__BUILD__) return;
  try {
    const r = await fetch('/static/version.txt', { cache: 'no-cache' });
    if (!r.ok) return;
    const server = (await r.text()).trim();
    if (!server || server === window.__BUILD__) return;
    // Loop guard: never reload twice for the same server version. If __BUILD__
    // still doesn't match after a reload (e.g. a stamping bug), stop trying.
    if (sessionStorage.getItem('_vReloadedFor') === server) return;
    sessionStorage.setItem('_vReloadedFor', server);
    window._vReloading = true;
    location.reload();
  } catch (e) { /* offline / transient — retry on the next tick */ }
}
// Check when the tab regains focus (the common "I just deployed, switching back"
// moment) and on a slow poll so a tab left open also catches up. No-ops unless
// the version actually changed, so steady-state use never reloads.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') _checkBuildVersion(); });
setInterval(_checkBuildVersion, 60000);
// ── Nodes ─────────────────────────────────────────────────────────────────
// Host → _entityCard options (stable .key so _renderEntityGrid can patch values
// in place). Shared by the Compute page grid and the Overview's Nodes carousel —
// nodes carry an extra Disk bar and a "cores" subtitle vs VM/LXC cards.
function _nodeCardOpts(n, webUrl) {
  if (n.status !== 'online') {
    return { key: 'node:' + n.node, name: n.node, stateLabel: 'Offline', color: '#6B7280', dim: true,
      onClick: 'showGuestDrawer(this)',
      data: { kind: 'node', node: n.node, status: n.status, web_url: webUrl || '' } };
  }
  const cpu=(n.cpu||0)*100;
  const bars=[{ label:'CPU', pct:cpu, valueHtml:cpu.toFixed(1)+'%', color:barHex(cpu), mono:true }];
  if (n.maxmem) { const mem=n.mem/n.maxmem*100;
    bars.push({ label:'RAM', pct:mem, valueHtml:`${fmtBytes(n.mem)} <span style="color:var(--c-dim);font-weight:400">/ ${fmtBytes(n.maxmem)}</span>`, color:barHex(mem) }); }
  if (n.maxdisk) { const disk=n.disk/n.maxdisk*100;
    bars.push({ label:'Disk', pct:disk, valueHtml:disk.toFixed(1)+'%', color:barHex(disk) }); }
  return {
    key: 'node:' + n.node,
    name: n.node,
    subtitle: n.maxcpu ? `${n.maxcpu} cores` : '',
    stateLabel: 'Online', color: '#22C55E',
    bars,
    footerL: n.uptime ? `up ${fmtUptime(n.uptime)}` : '',
    footerR: n.ip ? esc(n.ip) : '',
    onClick: 'showGuestDrawer(this)',
    data: { kind: 'node', node: n.node, status: n.status, ip: n.ip, cpu: n.cpu, maxcpu: n.maxcpu,
      mem: n.mem, maxmem: n.maxmem, disk: n.disk, maxdisk: n.maxdisk, uptime: n.uptime, web_url: webUrl || '' },
  };
}

function renderNodes(nodes, webUrl) {
  nodes = nodes || [];
  const online=nodes.filter(n=>n.status==='online'), offline=nodes.filter(n=>n.status!=='online');
  _renderEntityGrid('nodes-grid', online.concat(offline).map(n => _nodeCardOpts(n, webUrl)), '<div class="text-xs" style="color:#EF4444">No node data</div>');
  // Compute page header meta + section badge
  const _mn=el('meta-nodes');  if(_mn) _mn.textContent = online.length + (offline.length?`/${nodes.length}`:'');
  const _bn=el('badge-nodes'); if(_bn) _bn.textContent = String(nodes.length);
}

// ── VMs & LXCs ────────────────────────────────────────────────────────────
// ── Generic entity card ─────────────────────────────────────────────────────
// One card shell for any VM, LXC or node: name + state pill, subtitle, optional
// metric bars and meta rows. Every section collapses when its data is absent.
//   o = { name, subtitle, stateLabel, color, dim,
//         bars:[{label,pct,valueHtml,color,mono}], meta:[html…], onClick }
// Bar fill = a subtle left-to-right gradient of the bar's own color (the 8-digit
// hex tail is alpha). Used by both the builder and the live patcher so the
// gradient survives in-place updates.
function _barFill(hex) { return `linear-gradient(90deg,${hex},${hex}99)`; }
// Map a state hex to a shared .badge variant (semantic pill colors already match
// the green/amber/red/grey hexes every call site passes).
function _badgeVariant(c) {
  return c === '#22C55E' ? 'up' : (c === '#F59E0B' || c === '#FBBF24') ? 'warn'
    : c === '#EF4444' ? 'down' : 'neutral';
}
// Sub-elements carry stable hooks (.ec-pill, .ec-brow[data-bar], .ec-bf,
// .ec-meta, .ec-footL/.ec-footR) so _entityCardUpdate() can patch live values in
// place instead of the grid being rebuilt every tick (see _renderEntityGrid).
// Two-zone layout: a body (name + subtitle + status badge + resource bars) over
// an optional accent-tinted footer strip. No icon, no left border.
function _entityCard(o) {
  const sc = o.color || '#6B7280';
  const pill = o.stateLabel
    ? `<span class="ec-pill badge badge-${_badgeVariant(sc)}" style="flex-shrink:0">${esc(o.stateLabel)}</span>`
    : '';
  const sub = o.subtitle
    ? `<div style="font-size:11px;color:var(--c-muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.subtitle)}</div>`
    : '';
  const bars = (o.bars || []).filter(Boolean);
  const barsHtml = bars.length
    ? '<div style="margin-top:11px;display:flex;flex-direction:column;gap:7px">' + bars.map(b => {
        const w = Math.min(Math.max(b.pct || 0, 0), 100).toFixed(1);
        return `<div class="ec-brow" data-bar="${esc(b.label)}" style="display:flex;align-items:center;gap:8px">` +
          `<span style="font-size:11px;color:var(--c-muted);width:34px;flex-shrink:0">${esc(b.label)}</span>` +
          `<div class="ec-bar" data-barfill="${esc(b.label)}" style="flex:1;height:5px;border-radius:9999px;background:var(--c-bar-bg);overflow:hidden"><div class="ec-bf" style="height:100%;border-radius:9999px;width:${w}%;background:${_barFill(b.color)};transition:width .5s ease"></div></div>` +
          `<span class="ec-bv" style="font-size:11px;color:${b.color};font-weight:700${b.mono ? ';font-family:monospace' : ''};flex-shrink:0;text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums">${b.valueHtml}</span></div>`;
      }).join('') + '</div>'
    : '';
  const metaHtml = `<div class="ec-meta">${(o.meta || []).join('')}</div>`;
  const body =
    `<div style="padding:14px 16px;flex:1">` +
    `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">` +
    `<div style="min-width:0;flex:1">` +
    `<div style="font-size:13px;font-weight:700;color:var(--c-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.name)}</div>` +
    `${sub}</div>${pill}</div>${barsHtml}${metaHtml}${o.extra || ''}</div>`;
  const footer = (o.footerL || o.footerR)
    ? `<div class="ec-foot" style="background:rgba(var(--c-accent-rgb),.04);border-top:1px solid var(--c-border);padding:7px 16px;display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--c-muted)"><span class="ec-footL" style="display:inline-flex;align-items:center;gap:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">${o.footerIcon || ''}${o.footerL || ''}</span><span class="ec-footR" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0">${o.footerR || ''}</span></div>`
    : '';
  const inner = body + footer;
  // Flex column + flex:1 body: grid rows stretch cards to equal height, and
  // without this a short card (e.g. Tracearr/Huntarr on Automation) leaves its
  // accent footer floating mid-card instead of pinned to the bottom edge.
  const style = `border-radius:12px;overflow:hidden;position:relative;display:flex;flex-direction:column;${o.dim ? 'opacity:.55;' : ''}${(o.href || o.onClick) ? 'cursor:pointer;' : ''}`;
  // href → anchor (e.g. node links to Proxmox UI, service "open ↗"); else onClick div; else plain.
  if (o.href) return `<a class="hd-card card-hover" href="${o.href}" target="_blank" rel="noopener" style="${style}text-decoration:none;color:inherit">${inner}</a>`;
  const click = o.onClick ? ` onclick="${o.onClick}"` : '';
  const dataAttr = o.data ? ` data-entity="${_storAttr(o.data)}"` : '';
  const keyAttr = o.key ? ` data-key="${esc(o.key)}"` : '';
  return `<div class="hd-card${o.onClick ? ' card-hover' : ''}"${click}${dataAttr}${keyAttr} style="${style}">${inner}</div>`;
}

// Patch a card's live values in place (pill text, each bar's value+fill, meta,
// footer). Only called when the card's shape (_egShape) is unchanged, so the
// structure is guaranteed identical — we just refresh the numbers.
function _entityCardUpdate(card, o) {
  const pill = card.querySelector('.ec-pill');
  if (pill && o.stateLabel != null) pill.textContent = o.stateLabel;
  (o.bars || []).filter(Boolean).forEach(b => {
    const v = card.querySelector(`.ec-brow[data-bar="${b.label}"] .ec-bv`);
    if (v) { v.innerHTML = b.valueHtml; v.style.color = b.color; }
    const f = card.querySelector(`.ec-bar[data-barfill="${b.label}"] .ec-bf`);
    if (f) { f.style.width = Math.min(Math.max(b.pct || 0, 0), 100).toFixed(1) + '%'; f.style.background = _barFill(b.color); }
  });
  const meta = card.querySelector('.ec-meta');
  if (meta) meta.innerHTML = (o.meta || []).join('');
  const footL = card.querySelector('.ec-footL');
  if (footL) footL.innerHTML = (o.footerIcon || '') + (o.footerL || '');
  const footR = card.querySelector('.ec-footR');
  if (footR) footR.innerHTML = o.footerR || '';
}

// Structural signature: anything that changes the card's DOM *shape* (not just
// its numbers). If two renders share keys + shapes in order, we patch in place;
// otherwise we rebuild the grid. Footer presence is included so a strip that
// appears/disappears forces a rebuild (the patcher assumes the element exists).
function _egShape(o) {
  return (o.stateLabel || '') + '|' + (o.color || '') + '|' + (o.dim ? 1 : 0) + '|'
    + ((o.bars || []).filter(Boolean).map(b => b.label).join(',')) + '|'
    + ((o.meta && o.meta.length) ? 1 : 0) + '|' + (o.href ? 'h' : o.onClick ? 'c' : '')
    + '|' + (o.extra ? 'x' : '') + '|' + ((o.footerL || o.footerR) ? 'f' : '');
}
const _egCache = {};
// Briefly pulse a card whose shape changed (e.g. a guest started/stopped) so a
// real state change catches the eye. Reduced-motion is handled by the global CSS.
function _egFlash(card) {
  if (!card || _animReduce()) return;
  card.classList.remove('ec-flash'); void card.offsetWidth; card.classList.add('ec-flash');
  setTimeout(() => card.classList.remove('ec-flash'), 1000);
}
// items: array of _entityCard option objects, each with a stable .key. Patches
// values in place when the set/order/shape is unchanged; full rebuild otherwise.
function _renderEntityGrid(gridId, items, emptyHtml) {
  const host = el(gridId); if (!host) return;
  if (!items.length) { setInner(gridId, emptyHtml || ''); _egCache[gridId] = null; return; }
  const keys = items.map(o => o.key), shapes = items.map(_egShape);
  const prev = _egCache[gridId];
  const byKey = {}; keys.forEach((k, i) => { byKey[k] = shapes[i]; });
  // Keys present before whose shape changed this render = a real state change.
  const changed = prev ? keys.filter(k => prev.byKey && prev.byKey[k] != null && prev.byKey[k] !== byKey[k]) : [];
  const canPatch = prev && prev.keys.length === keys.length && host.children.length === keys.length
    && prev.keys.every((k, i) => k === keys[i]) && prev.shapes.every((s, i) => s === shapes[i]);
  if (canPatch) {
    for (let i = 0; i < items.length; i++) _entityCardUpdate(host.children[i], items[i]);
  } else {
    setInner(gridId, items.map(_entityCard).join(''));
    changed.forEach(k => { try { _egFlash(host.querySelector(`[data-key="${(window.CSS && CSS.escape) ? CSS.escape(k) : k}"]`)); } catch (e) {} });
  }
  _egCache[gridId] = { keys, shapes, byKey };
}

function renderVmLxc(vms,lxcs) {
  // VM/LXC is the clean 1:1 entity-card case: status, name, node/VMID subtitle,
  // CPU + RAM bars, uptime.
  function opts(item) {
    const r = item.status === 'running';
    const paused = item.status === 'paused';
    const sc = r ? '#22C55E' : paused ? '#F59E0B' : '#6B7280';
    const bars = [];
    if (r) {
      const cpuPct = (item.cpu || 0) * 100;
      bars.push({ label: 'CPU', pct: cpuPct, valueHtml: cpuPct.toFixed(1) + '%', color: barHex(cpuPct), mono: true });
      if (item.maxmem) {
        const memPct = item.mem / item.maxmem * 100;
        bars.push({ label: 'RAM', pct: memPct,
          valueHtml: `${fmtBytes(item.mem)} <span style="color:var(--c-dim);font-weight:400">/ ${fmtBytes(item.maxmem)}</span>`,
          color: barHex(memPct) });
      }
      // Disk bar, same as the host/node cards. LXCs report real usage; VMs only
      // report it with the guest agent, so only show it when there's actual data
      // (avoids a wall of misleading 0.0% bars on agent-less VMs).
      if (item.maxdisk && item.disk) {
        const diskPct = item.disk / item.maxdisk * 100;
        bars.push({ label: 'Disk', pct: diskPct,
          valueHtml: `${fmtBytes(item.disk)} <span style="color:var(--c-dim);font-weight:400">/ ${fmtBytes(item.maxdisk)}</span>`,
          color: barHex(diskPct) });
      }
    }
    return {
      key: 'g:' + item.vmid,
      name: item.name || ('VM ' + item.vmid),
      subtitle: `${item.node} · #${item.vmid}`,
      stateLabel: r ? 'Running' : paused ? 'Paused' : 'Stopped',
      color: sc, bars, dim: !r,
      footerL: (r && item.uptime) ? `up ${fmtUptime(item.uptime)}` : '',
      footerR: (r && item.ip) ? esc(item.ip) : '',
      onClick: 'showGuestDrawer(this)',
      data: {
        vmid: item.vmid, name: item.name, node: item.node, type: item.type, ip: item.ip || '',
        status: item.status, cpu: item.cpu, maxcpu: item.maxcpu,
        mem: item.mem, maxmem: item.maxmem, disk: item.disk, maxdisk: item.maxdisk,
        diskread: item.diskread, diskwrite: item.diskwrite,
        netin: item.netin, netout: item.netout, uptime: item.uptime,
        template: item.template, tags: item.tags, pool: item.pool,
        hastate: item.hastate, lock: item.lock, web_url: window._pxWebUrl || '',
      },
    };
  }
  _renderEntityGrid('vms-grid', vms.map(opts), '<div class="text-xs" style="color:var(--c-muted)">No VMs</div>');
  _renderEntityGrid('lxcs-grid', lxcs.map(opts), '<div class="text-xs" style="color:var(--c-muted)">No LXCs</div>');
  // Compute page header meta + section badges
  const vmsRun  = vms.filter(v=>v.status==='running').length;
  const lxcsRun = lxcs.filter(v=>v.status==='running').length;
  const _mv=el('meta-vms');   if(_mv) _mv.textContent = `${vmsRun}/${vms.length}`;
  const _ml=el('meta-lxcs');  if(_ml) _ml.textContent = `${lxcsRun}/${lxcs.length}`;
  const _bv=el('badge-vms');  if(_bv) _bv.textContent = String(vms.length);
  const _bl=el('badge-lxcs'); if(_bl) _bl.textContent = String(lxcs.length);
}

// ── Storage ───────────────────────────────────────────────────────────────
function renderStorage(storage) {
  if(!storage||!storage.length){
    setInner('storage-grid','<div class="text-xs" style="color:var(--c-muted)">No storage</div>');
    const _bs0=el('badge-storage'); if(_bs0) _bs0.textContent='0';
    return;
  }
  const seen=new Set();
  const u=storage.filter(s=>{if(!s.maxdisk||seen.has(s.storage))return false;seen.add(s.storage);return true;});
  const _bs=el('badge-storage'); if(_bs) _bs.textContent = String(u.length);
  setInner('storage-grid',u.map(s=>{
    const pct=(s.disk/s.maxdisk*100).toFixed(1);
    return `<div class="hd-card card-hover p-4">
      <div class="flex justify-between items-center mb-3">
        <span class="font-medium text-sm">${esc(s.storage)}</span>
        <span class="badge ${s.status==='available'?'badge-up':'badge-down'}">${s.status||'?'}</span>
      </div>
      <div class="flex justify-between text-xs mb-1.5"><span style="color:var(--c-muted)">Used</span><span>${fmtBytes(s.disk)} / ${fmtBytes(s.maxdisk)}</span></div>
      <div class="bar"><div class="bar-fill ${barCls(pct)}" style="--bf:${Math.min(pct,100)}%"></div></div>
      <div class="text-xs mt-1.5" style="color:var(--c-muted)">${pct}% · ${s.plugintype||s.type||''}</div>
    </div>`;
  }).join('')||'<div class="text-xs" style="color:var(--c-muted)">No volumes</div>');
}
// ── Storage page ──────────────────────────────────────────────────────────
// A full cluster-wide storage view built entirely from the live WS snapshot:
//   • data.proxmox.storage → per-store cards (volume-card polish),
//     deduped by name and grouped Shared first / Local second.
//   • data.ceph            → the Ceph section (pools + OSD grid + health badge
//     + capacity/throughput history charts), ported from the earlier renderCeph.
// No external NAS integration; all data comes from Proxmox/Ceph/PBS.
// The distinct name (renderStoragePage) avoids clashing with renderStorage(),
// which renders the Compute page's storage section.

// Fold the per-node storage rows into one record per storage name, trusting the
// Proxmox API's `shared` flag (the old ">1 node ⇒ shared" heuristic mislabelled
// `local`/`local-lvm`, which exist on every node but are separate filesystems).
// Shared stores report identical usage on every node → take the max; local
// stores differ per node → SUM across nodes so the device totals are honest.
function _storageAgg(storage){
  var map = {};
  (storage||[]).forEach(function(s){
    if(!s.storage || !s.maxdisk) return;
    var m = map[s.storage] || (map[s.storage] = {
      name:s.storage, shared:!!s.shared, nodes:new Set(),
      _maxDisk:0, _maxCap:0, _sumDisk:0, _sumCap:0,
      type:(s.plugintype||s.type||''),
      content:new Set(), status:s.status||''
    });
    if(s.node) m.nodes.add(s.node);
    if(s.shared) m.shared = true;
    m._maxDisk = Math.max(m._maxDisk, s.disk||0);
    m._maxCap  = Math.max(m._maxCap,  s.maxdisk||0);
    m._sumDisk += (s.disk||0);
    m._sumCap  += (s.maxdisk||0);
    if(s.content) String(s.content).split(',').forEach(function(c){ c=c.trim(); if(c) m.content.add(c); });
    if(s.status) m.status = s.status;
  });
  return Object.keys(map).map(function(k){
    var m = map[k];
    m.disk    = m.shared ? m._maxDisk : m._sumDisk;
    m.maxdisk = m.shared ? m._maxCap  : m._sumCap;
    return m;
  });
}

// ── Per-storage cards — every store gets the full Ceph widget ────────────────
// One card per storage, each a complete clone of renderCeph's anatomy: header
// row (icon · name · muted meta · Predictions + range pills · status badge),
// TWO chart columns (usage-% history on the left — one line per node for local
// stores — and the capacity forecast with confidence pill on the right, the
// same _renderStorageForecastChart Ceph uses), and a bottom NODES cell grid
// (like Ceph's OSDS cells) — every cell clickable → the storage drawer. Built
// ONLY from the generic Proxmox API snapshot, so it renders for any Proxmox
// environment. Shells (canvases + pills) rebuild only on structural change;
// live ticks rewrite just header meta / badge / cells.
function _storSlug(name){ return String(name).replace(/[^a-zA-Z0-9_-]/g,'_'); }

// ONE drive tile for the whole app — the detail pane's DRIVES cells and the
// Drive Health section render the exact same .stor-cell anatomy: header
// (icon · dev · TYPE · status dot), size, sub line (node or what it backs),
// model, and a "life tank" wear bar (or temp/state for OSDs). d = { dev, type,
// model, size, health, wear, temp?, state?, sub, ok, payload, title }.
function _driveCellHtml(d){
  var isSsd = /SSD|NVME/i.test(d.type);
  var c = d.ok ? '#22C55E' : '#EF4444';
  var icon = isSsd
    ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="13" y2="13"/><circle cx="17" cy="16" r="1"/></svg>'
    : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="9"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="3" x2="12" y2="6"/></svg>';
  var wearC = d.wear==null ? '' : d.wear < 20 ? '#EF4444' : d.wear < 40 ? '#F59E0B' : '#22C55E';
  var tempHtml = d.temp!=null ? '<b style="color:'+(d.temp>50?'#EF4444':d.temp>42?'#F59E0B':'var(--c-text)')+'">'+d.temp+'°C</b>' : '';
  var foot = '<div style="display:flex;gap:6px;font-size:9.5px;color:var(--c-dim);margin-top:4px;overflow:hidden;white-space:nowrap">'
    + '<span>'+esc(d.health||'—')+'</span>'
    + (tempHtml ? '<span>· '+tempHtml+'</span>' : '')
    + (d.state ? '<span>· '+esc(d.state)+'</span>' : '')
  + '</div>';
  // % life as the standard _donut gauge, top-right: larger arc, 10px text,
  // and a visible track (var(--c-border) — --c-bar-bg vanishes on the
  // --c-hover cell surface). Labeled LIFE; wear-less drives get a quiet dash.
  var gauge = '<div style="align-self:flex-start;flex-shrink:0;display:flex;flex-direction:column;align-items:center;gap:1px">'
    + (d.wear != null
      ? _donut(d.wear, 60, wearC, { font: 10, track: 'var(--c-bg)' })
      : '<div style="width:60px;height:60px;display:flex;align-items:center;justify-content:center;color:var(--c-dim);font-size:12px" title="This drive does not report wear over SMART">—</div>')
    + '<span style="font-size:8.5px;font-weight:700;letter-spacing:.07em;color:var(--c-dim);text-transform:uppercase;margin-top:-4px">Life</span>'
  + '</div>';
  return '<div title="'+esc(d.title||d.model)+'" data-stor="'+d.payload+'" onclick="showStorDrawer(this)" class="stor-cell" style="background:var(--c-hover);border:1px solid var(--c-border);border-radius:8px;padding:12px 14px;min-width:0;display:flex;align-items:flex-start;gap:10px;cursor:pointer">'
    + '<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px">'
      + '<div style="display:flex;align-items:center;gap:6px">'
        + '<span style="display:inline-flex;align-items:center;gap:6px;color:var(--c-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;min-width:0">'
          + icon + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.dev)+'</span></span>'
        + '<span class="stor-dot" style="width:8px;height:8px;background:'+c+';box-shadow:0 0 5px '+c+'80" title="'+esc(d.health||'unknown')+'"></span></div>'
      + '<div style="font-size:13px;font-weight:600;color:var(--c-text)">'+fmtBytes(d.size)
        + ' <span style="color:var(--c-muted);font-weight:400;font-size:10px">'+esc(d.type)+'</span></div>'
      + '<div style="font-size:10px;color:var(--c-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.sub||'')+'</div>'
      + '<div style="font-size:10px;color:var(--c-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.model)+'</div>'
      + foot
    + '</div>'
    + gauge
  + '</div>';
}

// Detail pane — the full Ceph-anatomy body for the SELECTED store: header row
// (name · meta · range pills · badge), THROUGHPUT + STORAGE forecast charts,
// CONTENT | DRIVES | NODES cells. Same element ids as the old per-store cards
// so the per-tick updater and chart loaders work unchanged.
function _storDetailShell(s){
  var slug = _storSlug(s.name);
  return '<div class="stor-card-hdr" style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
      + svg('database',14)
      + '<span class="font-medium text-sm" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.name)
        + ' <span style="color:var(--c-muted);font-size:11px" id="stordev-meta-'+slug+'"></span></span>'
      + _storPillRow('pxstor-'+slug)
      + '<span id="stordev-badge-'+slug+'"></span>'
    + '</div>'
    + '<div class="syn-nas-row" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:16px;align-items:start">'
      + '<div style="min-width:0">'
        + '<div class="stor-hdr">'
          + '<span class="stor-hdr-label">Throughput</span>'
          + '<span class="stor-hdr-spacer"></span>'
          + '<span class="stor-legend">'
            + '<span class="stor-leg"><span class="stor-leg-line" style="background:#22C55E"></span>Read</span>'
            + '<span class="stor-leg"><span class="stor-leg-line" style="background:#F59E0B"></span>Write</span>'
          + '</span>'
        + '</div>'
        + '<div id="chart-stor-'+slug+'-io-wrap" style="position:relative;height:200px">'
          + '<canvas id="chart-stor-'+slug+'-io"></canvas>'
          + '<div id="chart-stor-'+slug+'-io-empty" style="display:none;align-items:center;justify-content:center;position:absolute;inset:0;color:var(--c-dim);font-size:12px;text-align:center;padding:0 16px">No guest I/O — no VM or container disks live on this store.</div>'
        + '</div>'
      + '</div>'
      + '<div style="min-width:0;overflow:hidden">'
        + '<div class="stor-hdr">'
          + '<span class="stor-hdr-label">Storage</span>'
          + '<span class="stor-conf-pill" id="stordev-conf-'+slug+'">High Confidence</span>'
          + '<span class="stor-hdr-spacer"></span>'
          + '<span class="stor-legend">'
            + '<span class="stor-leg"><span class="stor-leg-line"></span>Historical</span>'
            + '<span class="stor-leg"><span class="stor-leg-line dashed"></span><span class="stor-leg-dia"></span>Prediction</span>'
          + '</span>'
        + '</div>'
        + '<div style="position:relative;height:200px"><canvas id="chart-stor-'+slug+'-cap"></canvas></div>'
      + '</div>'
    + '</div>';
  // The old CONTENT | DRIVES | NODES bottom grid was removed: those are now
  // covered page-wide by Largest Volumes, Drive Health and Capacity Outlook
  // (and per-store depth via the drawers). The inspector keeps only what's
  // unique to it — the throughput + capacity-forecast charts. Reachability
  // survives as a header-meta stat.
}

// Store selector — the settings-page sliding-thumb pill control, scaled up:
// one pill per store (lane icon · name · live used-%). Pills are rebuilt only
// when the store LIST changes; selection and per-tick values are applied by
// class/text updates so the thumb animates between pills.
function _storPillsHtml(items){
  return items.map(function(it){
    var s = it.s, slug = _storSlug(s.name);
    return '<button class="hist-btn" id="stor-pill-'+slug+'" onclick="storSelect(\''+slug+'\')" role="tab"'
      + ' style="display:inline-flex;align-items:center;gap:8px">'
      + svg(it.icon, 15)
      + esc(s.name)
      + '<span class="stor-pill-pc" id="stor-pill-pc-'+slug+'"></span>'
    + '</button>';
  }).join('');
}

// Selection state — persisted so a reload lands on the same store.
window._storSel = (function(){ try { return localStorage.getItem('pd-stor-sel') || ''; } catch(e){ return ''; } })();
function storSelect(slug){
  window._storSel = slug;
  try { localStorage.setItem('pd-stor-sel', slug); } catch(e){}
  var d = window._lastData;
  if(d && d.proxmox && d.proxmox.storage)
    renderStoragePage(d.proxmox.storage, d.proxmox.storage_content, d.proxmox.storage_drives);
}

// CONTENT cell grid — the POOLS analog: what actually lives on the store,
// aggregated by content class from /nodes/…/storage/…/content (10-min cache).
function renderStoragePage(storage, content, drives){
  var root = document.getElementById('storage-root'); if(!root) return;
  var list = _storageAgg(storage);
  if(!list.length){
    root.innerHTML = '<div class="stor-msg">'
      + (storage ? 'No storage reported by the cluster — add your Proxmox cluster in Settings.' : 'Loading storage…')
      + '</div>';
    _storDevSig = '';
    return;
  }
  // Backup stores get their own lane: PBS datastores by plugin type, plus any
  // store dedicated to backups (content = backup only). Generic to any cluster —
  // mixed-content stores that merely ALLOW backups stay in their scope lane.
  var _isBackupStore = function(s){
    if(String(s.type).toLowerCase() === 'pbs') return true;
    var c = Array.from(s.content);
    return c.length > 0 && c.every(function(x){ return x === 'backup'; });
  };
  var byUsage = function(a,b){ return (b.disk/b.maxdisk||0) - (a.disk/a.maxdisk||0); };
  var backups = list.filter(_isBackupStore).sort(byUsage);
  var shared = list.filter(function(s){ return s.shared && !_isBackupStore(s); }).sort(byUsage);
  var local = list.filter(function(s){ return !s.shared && !_isBackupStore(s); })
    .sort(function(a,b){ return a.name.localeCompare(b.name); });

  var totUsed = list.reduce(function(a,s){ return a + (s.disk||0); }, 0);
  var totCap  = list.reduce(function(a,s){ return a + (s.maxdisk||0); }, 0);
  var totPct = totCap ? Math.round(totUsed/totCap*100) : 0;
  var pctColor = totPct > 90 ? '#EF4444' : totPct > 75 ? '#F59E0B' : '';

  var ordered = shared.concat(backups, local);

  // Selection: default to the first store (shared first); heal a stale pick.
  var slugs = ordered.map(function(s){ return _storSlug(s.name); });
  if(slugs.indexOf(window._storSel) < 0) window._storSel = slugs[0];
  var sel = ordered[slugs.indexOf(window._storSel)];

  // Inspector shell (built once) — sec-hdr + pill selector + detail card.
  if(!root.querySelector('#stor-detail')){
    root.innerHTML =
      '<div class="sec-hdr">'+svg('database',18)
        + '<h2 class="sec-hdr-title">Stores</h2>'
        + '<span class="sec-hdr-sub">Every store, one inspector — pick a store to dig in</span>'
      + '</div>'
      + '<div class="settings-pill-row stor-pill-row">'
        + '<div class="hist-range" id="stor-sel-hist-range" role="tablist" aria-label="Stores"></div>'
      + '</div>'
      + '<div class="hd-card"><div class="stor-detail" id="stor-detail"></div></div>';
    _storDevSig = ''; window._storPillSig = '';
  }

  // Pills: rebuild only when the store list changes; per-tick just update the
  // active class + live % so the sliding thumb animates on selection.
  var laneIcons = { shared:'share-2', backup:'archive', local:'hard-drive' };
  var pillItems = shared.map(function(s){ return { s:s, icon:laneIcons.shared }; })
    .concat(backups.map(function(s){ return { s:s, icon:laneIcons.backup }; }))
    .concat(local.map(function(s){ return { s:s, icon:laneIcons.local }; }));
  var pSig = slugs.join('|');
  if(window._storPillSig !== pSig){
    window._storPillSig = pSig;
    el('stor-sel-hist-range').innerHTML = _storPillsHtml(pillItems);
  }
  ordered.forEach(function(s){
    var slug = _storSlug(s.name);
    var btn = el('stor-pill-'+slug);
    if(btn){
      btn.classList.toggle('active', slug === window._storSel);
      btn.title = esc(s.name)+' · '+(s.type||'storage')+' · '+(s.status||'available');
    }
    var pc = el('stor-pill-pc-'+slug);
    if(pc){
      var pct = s.maxdisk ? Math.round(s.disk/s.maxdisk*100) : 0;
      pc.textContent = pct+'%';
      pc.style.color = (s.status||'available')==='available' ? barHex(pct) : '#EF4444';
    }
  });

  // Detail shell: rebuilt only when the selection or its structure changes so
  // the two Chart.js canvases survive live ticks.
  var sig = window._storSel + ':' + Array.from(sel.nodes).sort().join('+') + ':' + sel.status;
  if(_storDevSig !== sig){
    _storDevSig = sig;
    el('stor-detail').innerHTML = _storDetailShell(sel);
    setTimeout(function(){ loadPxStorHistory(undefined, window._storSel); }, 0);
    _histSchedule();
  }

  // Per-tick (cheap) updates: header meta counts, the selected store's header
  // meta / badge / CONTENT + DRIVES + NODES cells. No canvas or pill touched.
  var hdrMeta = el('storage-hdr-meta');
  if(hdrMeta){
    var _mi = function(icon, num, label){
      return '<span class="page-hdr-meta-item">'+svg(icon,13)+'<b>'+num+'</b> '+label+'</span>';
    };
    var _sep = '<span class="page-hdr-meta-sep"></span>';
    hdrMeta.innerHTML = _mi('database', list.length, 'store'+(list.length===1?'':'s'))
      + _sep + _mi('share-2', shared.length, 'shared')
      + (backups.length ? _sep + _mi('archive', backups.length, 'backup') : '')
      + _sep + _mi('hard-drive', local.length, 'local')
      + (totCap ? _sep + '<span class="page-hdr-meta-item">'+svg('gauge',13)
          + '<b'+(pctColor?' style="color:'+pctColor+'"':'')+'>'+totPct+'%</b> used — '
          + fmtBytes(totUsed)+' of '+fmtBytes(totCap)+'</span>' : '');
  }
  (function(s){
    var slug = _storSlug(s.name);
    var nodes = Array.from(s.nodes);
    // Per-node reachability for the header meta (replaces the removed cells).
    var srows = (storage||[]).filter(function(r){ return r.storage === s.name; });
    var availN = srows.filter(function(r){ return (r.status||'available') === 'available'; }).length;
    var totN = srows.length || nodes.length;
    var reach = totN ? (availN === totN ? nodes.length + ' node' + (nodes.length===1?'':'s')
      : availN + '/' + totN + ' nodes reachable') : nodes.length + ' node' + (nodes.length===1?'':'s');
    var meta = el('stordev-meta-'+slug);
    if(meta) meta.textContent = '· ' + [s.type || 'storage', s.shared ? 'shared' : 'local',
      reach, fmtBytes(s.disk) + ' of ' + fmtBytes(s.maxdisk) + ' used'].join(' · ');
    var badge = el('stordev-badge-'+slug);
    if(badge) badge.innerHTML = '<span class="badge '+((s.status||'available')==='available'?'badge-up':'badge-down')+'">'+esc(s.status||'available')+'</span>';
  })(sel);

  // Sections: Capacity Outlook (answers first) → Largest Volumes → Drive Health.
  _storOutlookRender(ordered, storage);
  _storHogsRender(ordered, content);
  _storDriveHealthRender(drives);
}
let _storDevSig = '';

// ── Capacity Outlook — the page's answers, first ─────────────────────────────
// One ledger row per store (same anatomy as the Backups datastore ledger):
// usage bar · 30d growth · "full ≈ …" punchline · per-node reachability.
// Growth comes from the recorded storage history (async, cached ~5 min in
// _storGrowth so per-tick rebuilds never flash); rows click into the inspector.
var _storGrowth = {};        // slug -> { perDay, fullDays, ts }
var _storGrowthTs = 0;
function _storOutlookRender(ordered, storage){
  var sec = el('stor-outlook-sec'), box = el('stor-outlook');
  if(!sec || !box) return;
  if(!ordered.length){ sec.style.display = 'none'; return; }
  sec.style.display = '';
  var hdr = '<div class="stor-ol-hdr"><div>Store</div><div>Usage</div><div>Growth</div><div>Full by</div><div>Availability</div></div>';
  var rows = ordered.map(function(s){
    var slug = _storSlug(s.name);
    var pct = s.maxdisk ? Math.round(s.disk/s.maxdisk*100) : 0;
    var nrows = (storage||[]).filter(function(r){ return r.storage === s.name; });
    var availN = nrows.filter(function(r){ return (r.status||'available') === 'available'; }).length;
    var totN = nrows.length || s.nodes.size;
    var downNames = nrows.filter(function(r){ return (r.status||'available') !== 'available'; })
      .map(function(r){ return r.node; });
    var dotC = availN === totN ? '#22C55E' : availN > 0 ? '#F59E0B' : '#EF4444';
    var g = _storGrowth[slug];
    var growTxt = !g ? '<span style="color:var(--c-dim)">…</span>'
      : g.perDay > 1e6 ? '+'+fmtBytes(g.perDay)+'/day' : 'flat';
    var fullTxt = !g ? '<span style="color:var(--c-dim)">…</span>'
      : g.fullDays == null ? 'no meaningful growth'
      : g.fullDays > 3650 ? 'full in 10y+'
      : 'full ≈ ' + (g.fullDays > 730 ? (g.fullDays/365).toFixed(1)+'y'
        : g.fullDays > 90 ? Math.round(g.fullDays/30)+'mo' : Math.round(g.fullDays)+'d');
    var fullClr = !g || g.fullDays == null ? 'var(--c-dim)'
      : g.fullDays < 60 ? '#EF4444' : g.fullDays < 180 ? '#F59E0B' : 'var(--c-muted)';
    return '<div class="stor-ol-row" onclick="storSelect(\''+slug+'\')">'
      + '<div style="min-width:0">'
        + '<div style="display:flex;align-items:center;gap:8px">'
          + '<span class="stor-dot" style="width:8px;height:8px;background:'+dotC+';box-shadow:0 0 5px '+dotC+'80"></span>'
          + '<span style="font-size:13px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.name)+'</span>'
          + '<span style="font-size:11px;font-weight:700;color:'+barHex(pct)+';font-variant-numeric:tabular-nums">'+pct+'%</span>'
        + '</div>'
        + '<div style="font-size:10px;color:var(--c-dim);margin-top:2px">'+esc(s.type||'storage')+' · '+(s.shared?'shared':'local')+'</div>'
      + '</div>'
      + '<div style="min-width:0">'
        + '<div class="bar" style="height:5px"><div class="bar-fill '+barCls(pct)+'" style="--bf:'+Math.min(pct,100)+'%"></div></div>'
        + '<div style="font-size:10px;color:var(--c-dim);margin-top:4px">'+fmtBytes(s.disk)+' / '+fmtBytes(s.maxdisk)+' · '+fmtBytes(Math.max(0,s.maxdisk-s.disk))+' free</div>'
      + '</div>'
      + '<div><div style="font-size:12.5px;font-weight:650" id="stor-ol-g-'+slug+'">'+growTxt+'</div>'
        + '<div style="font-size:10px;color:var(--c-dim)">30-day trend</div></div>'
      + '<div><div style="font-size:12.5px;font-weight:650;color:'+fullClr+'" id="stor-ol-f-'+slug+'">'+fullTxt+'</div>'
        + '<div style="font-size:10px;color:var(--c-dim)">at current growth</div></div>'
      + '<div><div style="font-size:12.5px;font-weight:650;color:'+(downNames.length?'#F59E0B':'var(--c-text)')+'">'+availN+' / '+totN+' nodes</div>'
        + '<div style="font-size:10px;color:var(--c-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        + (downNames.length ? esc(downNames.join(', '))+' unreachable' : 'all reachable')+'</div></div>'
    + '</div>';
  }).join('');
  box.innerHTML = hdr + rows;
  // Refresh growth at most every 5 min (per-tick renders read the cache).
  if(Date.now() - _storGrowthTs > 300000){
    _storGrowthTs = Date.now();
    setTimeout(function(){ _storOutlookTrends(ordered); }, 0);
  }
}

async function _storOutlookTrends(ordered){
  try {
    const d = await _swrJSON('/api/history/storage?hours=720', () => {});
    const series = (d && d.series) || [];
    ordered.forEach(function(s){
      const slug = _storSlug(s.name);
      const subs = series.filter(x => x.storage === s.name);
      if(!subs.length) return;
      // Shared stores report the same bytes from every node (take max per ts);
      // local stores are distinct filesystems (sum per ts) — same fold as
      // _storageAgg uses for the live snapshot.
      const m = {};
      subs.forEach(x => x.labels.forEach((t, i) => {
        m[t] = s.shared ? Math.max(m[t] || 0, x.disk[i] || 0) : (m[t] || 0) + (x.disk[i] || 0);
      }));
      const ts = Object.keys(m).map(Number).sort((a, b) => a - b);
      if(ts.length < 2) return;
      const days = (ts[ts.length-1] - ts[0]) / 86400;
      if(days < 0.5) return;
      const perDay = (m[ts[ts.length-1]] - m[ts[0]]) / days;
      const free = Math.max(0, (s.maxdisk || 0) - (s.disk || 0));
      _storGrowth[slug] = { perDay: perDay,
        fullDays: perDay > 1e6 && free > 0 ? free / perDay : null };
    });
    // Paint the cells in place (next tick would too — this avoids the wait).
    ordered.forEach(function(s){
      const slug = _storSlug(s.name), g = _storGrowth[slug];
      if(!g) return;
      const ge = el('stor-ol-g-'+slug), fe = el('stor-ol-f-'+slug);
      if(ge) ge.textContent = g.perDay > 1e6 ? '+'+fmtBytes(g.perDay)+'/day' : 'flat';
      if(fe){
        fe.textContent = g.fullDays == null ? 'no meaningful growth'
          : g.fullDays > 3650 ? 'full in 10y+'
          : 'full ≈ ' + (g.fullDays > 730 ? (g.fullDays/365).toFixed(1)+'y'
            : g.fullDays > 90 ? Math.round(g.fullDays/30)+'mo' : Math.round(g.fullDays)+'d');
        fe.style.color = g.fullDays == null || g.fullDays > 3650 ? 'var(--c-dim)'
          : g.fullDays < 60 ? '#EF4444' : g.fullDays < 180 ? '#F59E0B' : 'var(--c-muted)';
      }
    });
  } catch(e){ console.warn('outlook trends:', e); }
}

// ── Space Hogs — squarified treemap of the cluster's largest volumes ────────
// Two-level layout: stores become regions (area = sum of their top volumes),
// volumes tile inside. Area IS the message — the biggest disk in the cluster
// physically dwarfs the rest. Tiles click through to select the store.
const _HOG_COLORS = ['ACCENT', '#22C55E', '#F59E0B', '#A78BFA', '#F472B6', '#60A5FA', '#2DD4BF'];

// Squarified treemap (Bruls et al.) — items [{v,...}] sorted desc, rect {x,y,w,h}.
// Returns [{x,y,w,h,item}].
function _squarify(items, rect){
  var out = [], rest = items.slice(), r = { x:rect.x, y:rect.y, w:rect.w, h:rect.h };
  var total = items.reduce(function(a,i){ return a+i.v; }, 0);
  if(total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
  var scale = rect.w * rect.h / total;
  function worst(row, len){
    var s = row.reduce(function(a,i){ return a+i.v*scale; }, 0);
    var mx = Math.max.apply(null, row.map(function(i){ return i.v*scale; }));
    var mn = Math.min.apply(null, row.map(function(i){ return i.v*scale; }));
    return Math.max(len*len*mx/(s*s), s*s/(len*len*mn));
  }
  function layout(row){
    var s = row.reduce(function(a,i){ return a+i.v*scale; }, 0);
    var horiz = r.w >= r.h;              // slice along the shorter side
    var len = horiz ? r.h : r.w;
    var thick = s / len;
    var off = 0;
    row.forEach(function(i){
      var frac = (i.v*scale) / s;
      if(horiz) out.push({ x:r.x, y:r.y+off, w:thick, h:len*frac, item:i });
      else      out.push({ x:r.x+off, y:r.y, w:len*frac, h:thick, item:i });
      off += len*frac;
    });
    if(horiz){ r.x += thick; r.w -= thick; }
    else     { r.y += thick; r.h -= thick; }
  }
  var row = [];
  while(rest.length){
    var len2 = Math.min(r.w, r.h);
    var c = rest[0];
    if(!row.length || worst(row.concat([c]), len2) <= worst(row, len2)){
      row.push(rest.shift());
    } else { layout(row); row = []; }
  }
  if(row.length) layout(row);
  return out;
}

// Treemap drill-down: null = all stores, or a store name to zoom into.
window._storHogZoom = null;
function storHogZoom(name){
  window._storHogZoom = name || null;
  var d = window._lastData;
  if(d && d.proxmox && d.proxmox.storage)
    renderStoragePage(d.proxmox.storage, d.proxmox.storage_content, d.proxmox.storage_drives);
}

// Treemap VOLUME-tile label (store titles use the horizontal strip above the
// box). The SIZE is always shown when the tile has any room — the name is added
// on top of it when there's space. Tall → name over size; short → name + size on
// one row with the size protected from clipping; narrow-but-tall → name·size
// rotated down the column; sliver → size only; nothing only when truly tiny.
function _hogInner(mainRich, mainPlain, sub, w, h, nmExtra){
  var ns = nmExtra ? ' style="'+nmExtra+'"' : '';
  sub = sub || '';
  if(w >= 40 && h >= 30)
    return '<div class="hog-nm"'+ns+'>'+mainRich+'</div>' + (sub ? '<div class="hog-sz">'+sub+'</div>' : '');
  if(w >= 40 && h >= 14)
    return '<div class="hog-line"'+ns+'><span class="hog-nm hog-nm-i">'+mainPlain+'</span>'
      + (sub ? '<span class="hog-sz hog-sz-i">'+sub+'</span>' : '') + '</div>';
  if(w >= 12 && h >= 40)
    return '<div class="hog-nm hog-nm-v"'+ns+'>'+mainPlain+(sub ? ' · '+sub : '')+'</div>';
  if(w >= 20 && h >= 9)
    return '<div class="hog-sz"'+ns+' style="line-height:1.1">'+sub+'</div>';
  return '';
}

// Restack thin full-height "needle" store rectangles into a neighbouring column
// as a wide, short block at that column's bottom (area-preserving, with a floor
// so the block is tall enough for a title + a little content). Mirrors how the
// small stores naturally stack in the All view; keeps titles readable above.
function _stackStoreNeedles(rects, H, LBL){
  var MINW = 46, FLOOR = LBL + 26;                 // title strip + a thin content row
  rects.filter(function(r){ return r.w < MINW && r.h > H * 0.5; }).forEach(function(n){
    if(n._stacked) return;
    function neighbour(pred){
      return rects.filter(function(r){
        return r !== n && !r._stacked && Math.abs(r.h - n.h) < 2 && Math.abs(r.y - n.y) < 2 && pred(r);
      }).sort(function(a, b){ return b.w - a.w; })[0];
    }
    var s = neighbour(function(r){ return Math.abs((r.x + r.w) - n.x) < 2; })      // left
         || neighbour(function(r){ return Math.abs(r.x - (n.x + n.w)) < 2; });     // right
    if(!s) return;
    var unionX = Math.min(s.x, n.x), unionW = s.w + n.w, unionH = s.h;
    var nH = Math.max(Math.min((n.w * n.h) / unionW, unionH * 0.45), FLOOR);
    s.x = unionX; s.w = unionW; s.h = unionH - nH;
    n.x = unionX; n.w = unionW; n.y = s.y + (unionH - nH); n.h = nH;
    s._stacked = true; n._stacked = true;
  });
}

function _storHogsRender(ordered, content){
  var sec = el('stor-hogs-sec'), box = el('stor-hogs'), leg = el('stor-hogs-legend');
  if(!sec || !box) return;
  var acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
  // Separate maps per guest type: a PBS group `vm/100` must NOT resolve to a
  // CONTAINER that reuses id 100 today (retired guests' backups keep their id).
  var vmsById = {}, lxcsById = {};
  ((window._pxLast||{}).vms||[]).forEach(function(g){ if(g.vmid!=null) vmsById[g.vmid] = g.name||''; });
  ((window._pxLast||{}).lxcs||[]).forEach(function(g){ if(g.vmid!=null) lxcsById[g.vmid] = g.name||''; });
  // Which guest type does a volid claim? (vzdump-qemu-100 / backup/vm/100 → vm;
  // vzdump-lxc-100 / backup/ct/100 → ct; disk images carry no type → either.)
  var volGuest = function(volid, vmid){
    if(vmid == null) return { name:'', retired:false };
    var m = String(volid||'').match(/vzdump-(qemu|lxc)-|backup\/(vm|ct|host)\//);
    var t = m ? (m[1]==='qemu'||m[2]==='vm' ? 'vm' : m[1]==='lxc'||m[2]==='ct' ? 'ct' : 'host') : null;
    if(t === 'vm') return { name:vmsById[vmid]||'', retired:!(vmid in vmsById), type:'vm' };
    if(t === 'ct') return { name:lxcsById[vmid]||'', retired:!(vmid in lxcsById), type:'ct' };
    if(t === 'host') return { name:'', retired:false, type:'host' };
    // Untyped (disk images): vmids are cluster-unique, either map is safe.
    return { name:vmsById[vmid]||lxcsById[vmid]||'', retired:!(vmid in vmsById || vmid in lxcsById) };
  };
  // One unified view (no class filter): the map shows every store, and you drill
  // into a store to see its volumes. Content type is implicit — PBS stores are
  // backups, rbd/lvm are disk images — so a global filter added little over the
  // drill-down while owning the messiest edge cases. Left as 'all' throughout.
  var f = 'all';
  var pillsEl = el('stor-tm-pills');
  if(pillsEl) pillsEl.innerHTML = '';

  // Dedup lookup: PBS reports per-snapshot LOGICAL sizes (pre-dedup), which
  // wildly overstate real disk use (a store at 7.4x dedup shows ~7x its actual
  // footprint). Scale each backup volume by 1/dedup so tile AREAS reflect
  // estimated PHYSICAL bytes and are comparable to local/rbd stores (already
  // physical). dedup comes from the PBS status (fetch_pbs → datastores[].dedup),
  // joined to the PVE storage id via pbs_storage_map. Estimate assumes dedup is
  // shared evenly across a store's volumes — approximate per-volume, but exact
  // at the store total (Σ ≈ store physical used).
  var _pbsMap = ((window._lastData||{}).proxmox||{}).pbs_storage_map || {};
  var dedupByStore = {};
  (((window._lastData||{}).pbs||{}).datastores || []).forEach(function(d){
    if(d.dedup && d.dedup > 1) dedupByStore[_pbsMap[d.name] || d.name] = d.dedup;
  });

  // Store groups from the content inventory's top volumes (class-filtered).
  var groups = [];
  ordered.forEach(function(s, i){
    var info = (content||{})[s.name];
    var vols = ((info && info.top) || []).filter(function(v){
      if(v.size <= 0) return false;
      if(f === 'live') return v.content !== 'backup';
      if(f === 'backup') return v.content === 'backup';
      return true;
    });
    if(!vols.length) return;
    // Consolidate a guest's backup snapshots into ONE box: eight dated copies of
    // vm/100 read as a single "vm/100 · 8 backups" tile sized to their combined
    // footprint, instead of eight identical tiles. Only backups are merged; disk
    // images stay per-volume. Key on the guest the archive belongs to.
    // The backend already aggregates a guest's backup snapshots into one entry
    // (with a `count`); this pass is idempotent and also covers older cached data
    // that still arrives as raw per-snapshot volumes. Snapshot counts are summed.
    var byGuest = {}, merged = [];
    vols.forEach(function(v){
      var m = v.content === 'backup' && String(v.volid||'')
        .match(/backup\/(vm|ct|host)\/([^/]+)\//) || (v.content === 'backup' && String(v.volid||'')
        .match(/vzdump-(qemu|lxc)-(\d+)-/));
      var key = m ? (m[1] === 'qemu' ? 'vm' : m[1] === 'lxc' ? 'ct' : m[1]) + '/' + m[2] : null;
      var cnt = v.count || 1;
      if(key && byGuest[key]){ byGuest[key].size += v.size; byGuest[key]._count += cnt; }
      else if(key){ byGuest[key] = { volid:v.volid, size:v.size, content:v.content, vmid:v.vmid, format:v.format, _count:cnt }; merged.push(byGuest[key]); }
      else { if(cnt > 1) v._count = cnt; merged.push(v); }
    });
    vols = merged;
    var color = _HOG_COLORS[i % _HOG_COLORS.length];
    var dedup = dedupByStore[s.name] || null;
    var physScale = dedup ? 1 / dedup : 1;   // logical → estimated physical
    // For deduped PBS stores, calibrate the scale to the store's ACTUAL used bytes
    // (physical used ÷ total logical of all snapshots) instead of the coarse dedup
    // ratio — so the itemised guests sum to real usage and the "+ more" remainder
    // (storeDisk − Σtiles) collapses to ~0. classes[*].bytes is the full logical
    // total across every snapshot, not just the ones returned.
    if(dedup){
      var sumLog = 0, cl = (info && info.classes) || {};
      Object.keys(cl).forEach(function(k){ sumLog += (cl[k].bytes || 0); });
      if(sumLog > 0 && s.disk > 0) physScale = s.disk / sumLog;
    }
    groups.push({ store:s.name, slug:_storSlug(s.name),
      color: color === 'ACCENT' ? acc : color,
      type:s.type, sharedFlag:!!s.shared, storeDisk:s.disk, storeMax:s.maxdisk,
      contentTypes:(s.content instanceof Set ? Array.from(s.content)
        : typeof s.content === 'string' ? s.content.split(',') : []).map(function(t){ return String(t).trim(); }).filter(Boolean),
      nodeList:Array.from(s.nodes).sort(), dedup:dedup, physScale:physScale,
      v: vols.reduce(function(a,x){ return a + x.size * physScale; }, 0),
      vols: vols.slice().sort(function(a,b){ return b.size-a.size; }) });
  });
  if(!groups.length){
    // With a filter active, keep the section (and its pills) so the user can
    // switch back; only a truly empty inventory hides the whole section.
    if(f !== 'all'){
      sec.style.display = '';
      box.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--c-dim);font-size:12px">No '
        + (f === 'live' ? 'disk images' : 'backup archives') + ' in the inventory.</div>';
      if(leg) leg.innerHTML = '';
      return;
    }
    sec.style.display = 'none'; return;
  }
  sec.style.display = '';
  groups.sort(function(a,b){ return b.v-a.v; });
  // Strictly proportional: every tile's area IS its estimated physical bytes,
  // never capped. Within a store, the largest volumes show individually and the
  // small tail folds into a "+N smaller" tile — the threshold is relative to the
  // STORE (so a small store still itemises its own volumes when zoomed, rather
  // than vanishing next to a huge one). A store's used space beyond the volumes
  // the API returns becomes a "+ more" tile so the map reflects its true size.
  groups.forEach(function(g){
    var sumTopPhys = g.vols.reduce(function(a,x){ return a + x.size * g.physScale; }, 0);
    // Itemise generously so the "+ more" remainder stays small: show every volume
    // down to ~0.15% of the store (cap 50), roll only the genuinely tiny tail.
    // Store-relative so a small store still itemises its own content when zoomed.
    var sorted = g.vols.slice().sort(function(a,b){ return b.size - a.size; });
    var thr = (sumTopPhys || 1) * 0.0015;
    var shown = [], tail = [];
    sorted.forEach(function(v, idx){
      if(idx < 50 && (v.size * g.physScale) >= thr) shown.push(v);
      else tail.push(v);
    });
    // A store's remainder beyond the itemised volumes. Only meaningful where the
    // reported usage IS the volumes: 'dir' storages report whole-filesystem usage
    // (OS files, not PVE volumes) so their remainder is bogus — never draw it.
    // A category filter (live/backup) is honoured only for single-category stores
    // so a mixed store never counts the other type's usage.
    // 'dir' storages report whole-filesystem usage (OS files, not PVE volumes),
    // so their remainder is bogus — never draw it. Every other store's reported
    // usage IS its volumes, so the remainder is real.
    var beyondSafe = g.type !== 'dir';
    var beyondPhys = beyondSafe ? Math.max(0, (g.storeDisk || 0) - sumTopPhys) : 0;
    if(!beyondPhys && tail.length === 1){ shown.push(tail[0]); tail = []; }  // lone small vol: just show it
    var tailPhys = tail.reduce(function(a,x){ return a + x.size * g.physScale; }, 0);
    var otherPhys = tailPhys + beyondPhys;
    g.vols = shown;
    if(otherPhys > 0 && (beyondPhys > 0 || tail.length)){
      g.vols.push({ _agg:true, _n:tail.length, _more:beyondPhys > 0, _physSize:otherPhys });
    }
    g.v = g.vols.reduce(function(a,x){ return a + (x._physSize != null ? x._physSize : x.size * g.physScale); }, 0);
  });
  var W = box.clientWidth || 900, H = box.clientHeight || 280;
  if(box.clientHeight === 0){ box.style.height = '280px'; H = 280; }

  // ── Drill-down (TreeSize-style) ──────────────────────────────────────────
  // Top level: one tile per store, area ∝ the store's true used size — click to
  // zoom in. Zoomed: that store's volumes fill the whole canvas at full
  // resolution, scoped to the store so no other store can dwarf them.
  var zoom = window._storHogZoom || null;
  var zoomG = zoom ? groups.filter(function(g){ return g.store === zoom; })[0] : null;
  if(zoom && !zoomG) zoom = window._storHogZoom = null;   // store absent under this filter → reset

  var crumb = el('stor-hogs-crumb');
  if(crumb){
    crumb.innerHTML = zoomG
      ? '<a class="hog-crumb-back" onclick="storHogZoom(null)">← All stores</a>'
        + '<span class="hog-crumb-sep">›</span><b>'+esc(zoomG.store)+'</b>'
        + '<span class="hog-crumb-sz">'+(zoomG.dedup?'≈':'')+fmtBytes(zoomG.v)+(zoomG.dedup?' est. physical':'')+'</span>'
      : '';
    crumb.style.display = zoomG ? '' : 'none';
  }

  // Render one volume / "+ more" tile for squarify cell c within store g.
  function volTile(c, g){
    if(c.w < 3 || c.h < 3) return '';
    var v = c.item.vol;
    var physB = v._physSize != null ? v._physSize : v.size * g.physScale;
    var szTxt = (g.dedup ? '≈' : '') + fmtBytes(physB);
    var pos = 'left:'+(c.x+1)+'px;top:'+(c.y+1)+'px;width:'+Math.max(1,c.w-2)+'px;height:'+Math.max(1,c.h-2)+'px;';
    if(v._agg){
      var lbl = v._more ? '+ more' : '+'+v._n+' smaller';
      var ttl = (v._more ? 'used beyond the largest volumes' : v._n+' smaller volume'+(v._n===1?'':'s'))
        + ' · ' + szTxt + ' · ' + g.store;
      return '<div class="hog-cell hog-agg" title="'+esc(ttl)+'" style="'+pos+'cursor:default;'
        + 'background:linear-gradient(180deg,'+g.color+'14,'+g.color+'22);border:1px dashed '+g.color+'40">'
        + _hogInner(lbl, lbl, szTxt, c.w, c.h, 'color:var(--c-muted)') + '</div>';
    }
    var pbsm = String(v.volid||'').match(/(ct|vm|host)\/([^/]+)\/\d{4}-/);
    var nm = pbsm ? pbsm[1]+'/'+pbsm[2] : (String(v.volid||'').split('/').pop() || v.volid);
    var gi = volGuest(v.volid, v.vmid);
    var gname = gi.name;
    if(gi.retired) nm = (gi.type ? gi.type+'/' : '#') + v.vmid + ' · retired';
    var dm = String(v.volid||'').match(/(\d{4})[_-](\d{2})[_-](\d{2})/);
    var when = dm ? new Date(+dm[1], +dm[2]-1, +dm[3])
      .toLocaleDateString([], { month:'short', day:'numeric', year:'2-digit' }) : '';
    var meta = v._count > 1 ? v._count + ' backups' : when;   // consolidated → snapshot count
    var title = nm + (gname ? ' — '+gname+' ('+v.vmid+')' : (v.vmid!=null?' — #'+v.vmid:''))
      + ' · ' + szTxt + (g.dedup ? ' physical ('+fmtBytes(v.size)+' logical)' : '')
      + (v._count > 1 ? ' · '+v._count+' backups' : '') + ' · ' + g.store;
    var data = _storAttr({ kind:'pxstor', name:g.store, type:g.type, shared:g.sharedFlag,
      status:'available', disk:g.storeDisk, maxdisk:g.storeMax, nodes:g.nodeList, content:[],
      per_node:[], content_classes:null, top_volumes:[],
      focus:{ what:'volume', volid:v.volid, size:v.size, physSize:(g.dedup?physB:null), vmid:v.vmid,
              guest:gname, format:v.format||'', cls:v.content||'', when:when } });
    return '<div class="hog-cell" data-stor="'+data+'" onclick="showStorDrawer(this)" title="'+esc(title)+'" style="'+pos
      + 'background:linear-gradient(180deg,'+g.color+'26,'+g.color+'40);border:1px solid '+g.color+'55">'
      + _hogInner(
          esc(gname || nm) + (meta ? ' <span style="color:var(--c-muted);font-weight:400">· '+esc(meta)+'</span>' : ''),
          esc(gname || nm), szTxt, c.w, c.h)
      + '</div>';
  }

  var html = '';
  if(zoomG){
    // Zoomed into one store — its volumes fill the canvas.
    _squarify(zoomG.vols.map(function(v){ return { v:(v._physSize != null ? v._physSize : v.size * zoomG.physScale), vol:v }; }),
              { x:0, y:0, w:W, h:H }).forEach(function(c){ html += volTile(c, zoomG); });
  } else {
    // Top level — one clickable tile per store, area ∝ true used space. Stores
    // that are a tiny fraction of a huge cluster would collapse to unreadable
    // slivers, so the genuinely-tiny ones (< 0.5% of used space) are lifted to a
    // visible minimum — but scaled off a COMMON floor so their sizes stay
    // proportional TO EACH OTHER (local-lvm still reads ~2× local). Big stores
    // keep exact proportions; the label shows the true size; drill-in is exact.
    var totV = groups.reduce(function(a,g){ return a + g.v; }, 0) || 1;
    var TINY = totV * 0.005, FLOOR = totV * 0.012;
    var minTiny = groups.reduce(function(m,g){ return g.v < TINY ? Math.min(m, g.v) : m; }, Infinity);
    var rects = _squarify(groups.map(function(g){
      var dv = (g.v < TINY && minTiny > 0 && minTiny !== Infinity) ? FLOOR * (g.v / minTiny) : g.v;
      return { v:dv, g:g };
    }), { x:0, y:0, w:W, h:H });
    _stackStoreNeedles(rects, H, 16);   // reshape a thin needle into a labelable block
    rects.forEach(function(gr){
      var g = gr.item.g, c = gr;
      if(c.w < 3 || c.h < 3) return;
      var szT = (g.dedup ? '≈' : '') + fmtBytes(g.v);
      var nvol = g.vols.filter(function(x){ return !x._agg; }).length;
      var pos = 'left:'+(c.x+1)+'px;top:'+(c.y+1)+'px;width:'+Math.max(1,c.w-2)+'px;height:'+Math.max(1,c.h-2)+'px;';
      var title = g.store + ' · ' + szT + (g.dedup?' est. physical':'') + ' · click to drill in';
      html += '<div class="hog-cell hog-store-tile" data-zoom="'+esc(g.store)+'" onclick="storHogZoom(this.dataset.zoom)" title="'+esc(title)+'" style="'+pos
        + 'background:linear-gradient(180deg,'+g.color+'2e,'+g.color+'4d);border:1px solid '+g.color+'66">'
        + _hogInner('<b>'+esc(g.store)+'</b>', '<b>'+esc(g.store)+'</b>', szT, c.w, c.h)
        + '</div>';
    });
  }
  box.innerHTML = html;
  if(leg) leg.innerHTML = groups.map(function(g){
    // Legend shows each store's true used size; the dedup note flags the estimate.
    var lg = g.dedup ? ' <span style="color:var(--c-dim)">(est. physical · '+g.dedup.toFixed(1)+'× dedup)</span>' : '';
    var on = (zoomG && zoomG.store === g.store) ? ' style="font-weight:700"' : '';
    return '<span'+on+'><i style="background:'+g.color+'"></i>'+esc(g.store)+' · '+(g.dedup?'≈':'')+fmtBytes(g.v)+lg+'</span>';
  }).join('');
}

// ── Drive Health — physical drive bays grouped by node ──────────────────────
// storage_drives (ZFS/LVM-backed disks: SMART + wearout) merged with Ceph OSDs
// (temp + up/in). Worst life first within each node. Hidden when nothing to show.
function _storDriveHealthRender(drives){
  var sec = el('stor-drives-sec'), box = el('stor-drivehealth');
  if(!sec || !box) return;
  var byNode = {};   // node -> [bay]
  var seen = {};
  // Ceph OSD runtime state (temp, up/in) joins the PHYSICAL disk records by
  // osdid — OSDs are ordinary disks and get the exact same tile: model,
  // SMART, wear tank, plus their temp/state in the footer.
  var ceph = (window._lastData||{}).ceph;
  var osdById = {};
  ((ceph && ceph.osds) || []).forEach(function(o){ if(o.id != null) osdById[o.id] = o; });
  var osdCovered = {};
  Object.keys(drives||{}).forEach(function(store){
    (drives[store]||[]).forEach(function(dk){
      var key = dk.node + '|' + dk.devpath;
      if(seen[key]){ if(seen[key].backs.indexOf(store)<0) seen[key].backs.push(store); return; }
      var o = dk.osdid != null ? osdById[dk.osdid] : null;
      if(dk.osdid != null) osdCovered[dk.osdid] = true;
      var e = { node:dk.node, dev:String(dk.devpath||'').replace('/dev/',''), model:dk.model||'—',
        size:dk.size||0, type:(dk.type||'disk').toUpperCase(), health:dk.health||'',
        wear:(dk.wearout!=null?dk.wearout:null), backs:[store], raw:dk,
        temp:dk.temp!=null ? dk.temp : ((o && o.temp>0) ? o.temp : null),
        osdState:o ? (o.status==='up' ? (o.in_state===1?'Up · In':'Up · Out') : 'Down') : '',
        osdUp:o ? o.status==='up' : null,
        osdName:dk.osdid != null ? 'osd.'+dk.osdid : '' };
      seen[key] = e;
      (byNode[dk.node] = byNode[dk.node] || []).push(e);
    });
  });
  // Fallback: OSDs whose physical disk didn't resolve (e.g. a node the disks
  // API couldn't answer for) still show, from the Ceph data alone.
  ((ceph && ceph.osds) || []).forEach(function(o){
    if(o.id == null || osdCovered[o.id]) return;
    var host = o.host || '?';
    (byNode[host] = byNode[host] || []).push({
      node:host, dev:o.name || ('osd.'+o.id), model:(o.device_class||'osd').toUpperCase()+' · Ceph OSD',
      size:o.size_bytes||0, type:(o.device_class||'OSD').toUpperCase(),
      health:(o.status==='up' ? 'PASSED' : 'DOWN'), wear:null, temp:(o.temp>0?o.temp:null),
      backs:['Ceph'], raw:o, osdState:(o.status==='up' ? (o.in_state===1?'Up · In':'Up · Out') : 'Down'),
      osdUp:o.status==='up', osdName:o.name || ('osd.'+o.id), cephOnly:true });
  });
  var nodes = Object.keys(byNode).sort();
  if(!nodes.length){ sec.style.display = 'none'; return; }
  sec.style.display = '';
  box.innerHTML = nodes.map(function(n){
    var bays = byNode[n].sort(function(a,b){
      return (a.wear==null?101:a.wear) - (b.wear==null?101:b.wear);
    });
    return '<div class="dh-node">'
      + '<div class="dh-node-hdr">'+svg('server',13)+esc(n)
        + '<span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--c-dim)">· '+bays.length+' drive'+(bays.length===1?'':'s')+'</span></div>'
      + '<div class="dh-grid">' + bays.map(function(d){
        // Same shared tile for every drive — OSDs included (their osd state and
        // temp ride along in the footer; SMART/wear/model come from the disk).
        var healthOk = !d.health || /^(passed|ok|unknown)$/i.test(d.health);
        return _driveCellHtml({
          dev:d.dev + (d.osdName ? ' · '+d.osdName : ''), type:d.type, model:d.model,
          size:d.size, health:d.health, wear:d.wear, temp:d.temp, state:d.osdState||'',
          sub:'backs '+d.backs.join(', '),
          ok:d.osdUp === null || d.osdUp === undefined ? healthOk : (healthOk && d.osdUp),
          payload:d.cephOnly
            ? _storAttr(Object.assign({ kind:'ceph-osd' }, d.raw))
            : _storAttr(Object.assign({ kind:'pxdrive', storage:d.backs.join(', '),
                temp:d.temp, osd_state:d.osdState, osd_name:d.osdName }, d.raw)),
          title:d.model+' — backs '+d.backs.join(', '),
        });
      }).join('') + '</div>'
    + '</div>';
  }).join('');
}

// Per-card charts — the same two-chart treatment as the Ceph card. Left canvas:
// THROUGHPUT (guest I/O read/write, painted by the SAME _renderThroughputChart
// the Ceph card uses); right canvas: the capacity forecast with confidence
// pill. One fetch per distinct range; every card sits on its own range pills
// ('pxstor-<slug>').
async function loadPxStorHistory(hrs, onlySlug){
  try {
    const slugs = Array.from(document.querySelectorAll('[id^="chart-stor-"][id$="-cap"]'))
      .map(cv => cv.id.slice('chart-stor-'.length, -'-cap'.length))
      .filter(sl => !onlySlug || sl === onlySlug);
    if (!slugs.length) return;
    const wants = {};   // hours -> [slug]
    slugs.forEach(sl => {
      const h = (onlySlug && hrs !== undefined) ? hrs : _histGetHours('pxstor-'+sl);
      (wants[h] = wants[h] || []).push(sl);
    });
    for (const [h, sls] of Object.entries(wants)) {
      const d = await _swrJSON(`/api/history/storage?hours=${h}`, () => loadPxStorHistory());
      const dio = await _swrJSON(`/api/history/storage_io?hours=${h}`, () => loadPxStorHistory());
      const bySlug = {};
      ((d && d.series) || []).forEach(s => {
        const k = _storSlug(s.storage);
        (bySlug[k] = bySlug[k] || []).push(s);
      });
      const ioBySlug = {};
      Object.entries((dio && dio.storages) || {}).forEach(([name, io]) => {
        ioBySlug[_storSlug(name)] = io;
      });
      sls.forEach(slug => {
        // Left: guest I/O throughput (Read/Write, Ceph treatment). Stores that
        // back no guest disks (PBS datastores, ISO/template dirs) have no guest
        // I/O by definition — say so instead of leaving a blank canvas.
        const ioCv = el('chart-stor-'+slug+'-io');
        const ioEmpty = el('chart-stor-'+slug+'-io-empty');
        const io = ioBySlug[slug];
        if (io && ioCv) {
          ioCv.style.display = '';
          if (ioEmpty) ioEmpty.style.display = 'none';
          _renderThroughputChart('chart-stor-'+slug+'-io', io.labels, io.read, io.write, Number(h));
        } else if (ioCv && !io) {
          // Keep the canvas in the DOM so a later history response can paint it
          // without requiring the whole inspector shell to be rebuilt.
          ioCv.style.display = 'none';
          if (ioEmpty) ioEmpty.style.display = 'flex';
        }
        // Right: capacity forecast (summed across nodes for local stores).
        const subs = bySlug[slug];
        if (!subs) return;
        const acc = {};   // ts -> [usedB, totalB]
        subs.forEach(s => {
          s.labels.forEach((t, i) => {
            const m = acc[t] = acc[t] || [0, 0];
            m[0] += s.disk[i] || 0; m[1] += s.maxdisk[i] || 0;
          });
        });
        const ts = Object.keys(acc).map(Number).sort((a, b) => a - b);
        const usedGB  = ts.map(t => acc[t][0] / 1073741824);
        const totalGB = ts.length ? acc[ts[ts.length-1]][1] / 1073741824 : 0;
        if (el('chart-stor-'+slug+'-cap')) {
          _renderStorageForecastChart('chart-stor-'+slug+'-cap', 'Used', ts, usedGB, totalGB, Number(h),
            { prefix: 'pxstor-'+slug, confPillId: 'stordev-conf-'+slug });
        }
      });
    }
  } catch(e){ console.warn('storage history:', e); }
}

// ── Ceph ───────────────────────────────────────────────────────────────────
// Compact volume cells, reused by the Ceph pool list. Each item:
// { name, used_gb, total_gb, percent }. Clickable → the storage drawer.
function _volumesCompact(items, kind) {
  kind = kind || 'ceph-pool';
  const volIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`;
  return (items || []).map(v => {
    const vc = v.percent > 90 ? '#EF4444' : v.percent > 75 ? '#F59E0B' : 'var(--c-accent)';
    const fmt = gb => gb >= 1000 ? (gb/1000).toFixed(1)+' TB' : Math.round(gb)+' GB';
    const free = Math.max(0, (v.total_gb||0) - (v.used_gb||0));
    const pct = (v.percent||0).toFixed(1);
    const stor = _storAttr({kind, ...v});
    return `<div title="${esc(v.name)}" data-stor="${stor}" onclick="showStorDrawer(this)" class="stor-cell" style="background:var(--c-hover);border:1px solid var(--c-border);border-radius:8px;padding:12px 14px;min-width:0;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:6px;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:6px;color:var(--c-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;min-width:0">
          ${volIcon}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(v.name)}</span>
        </div>
        <span style="width:8px;height:8px;border-radius:50%;background:${vc};box-shadow:0 0 6px ${vc}80;flex-shrink:0" title="${pct}% used"></span>
      </div>
      <div style="font-size:13px;font-weight:600;line-height:1.35;white-space:nowrap">${fmt(v.used_gb||0)} <span style="font-size:10px;font-weight:500;color:var(--c-muted)">/ ${fmt(v.total_gb||0)}</span></div>
      <div style="font-size:10px;color:var(--c-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt(free)} free</div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--c-muted);margin-top:2px">
        <span style="color:${vc};font-weight:600">${pct}%</span>
        <span>Used</span>
      </div>
    </div>`;
  }).join('');
}

function _volumesSection(items, kind) {
  const html = _volumesCompact(items, kind);
  if (!html) return '';
  const n = (items || []).length;
  return `<div style="border-top:1px solid var(--c-border);padding-top:12px;margin-top:14px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Pools</span>
      <span style="font-size:10px;color:var(--c-muted)">${n} pool${n===1?'':'s'}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${html}</div>
  </div>`;
}

// Storage-card toolbar: a Predictions switch + extended range pills. The
// per-prefix _predToggle state gates the dashed forecast segment in the
// storage chart; _histRanges keeps the active range across re-renders.
const _predToggle = {};
function _storPillRow(prefix) {
  const items = ['7d','30d','1y','All','Custom'];
  const stored = _histRanges[prefix];
  const active = items.includes(stored) ? stored : '7d';
  const predOn = _predToggle[prefix] !== false;
  return `<div class="stor-toolbar" style="margin-left:auto;display:inline-flex;align-items:center;gap:8px;flex-shrink:0">
      <div class="hist-range" id="${prefix}-pred-hist-range" style="margin-left:0" title="Show / hide predicted trend">
        <button class="hist-btn${predOn?' active':''}" onclick="togglePredictions('${prefix}',this)">Predictions</button>
      </div>
      <div class="hist-range" id="${prefix}-hist-range" style="margin-left:0">${
        items.map(lbl => `<button class="hist-btn${lbl===active?' active':''}" onclick="histClick(this,'${prefix}')">${lbl}</button>`).join('')
      }</div>
    </div>`;
}

function togglePredictions(prefix, btn) {
  const newOn = !btn.classList.contains('active');
  btn.classList.toggle('active', newOn);
  _predToggle[prefix] = newOn;
  if (typeof _histThumbUpdate === 'function') _histThumbUpdate(prefix + '-pred');
  if (prefix === 'ceph') loadCephHistory();
  else if (prefix === 'ov-stor') loadOvStorageForecast();
  else if (prefix.indexOf('pxstor-') === 0) loadPxStorHistory(undefined, prefix.slice(7));
}

function _renderCephOsdGrid(osds) {
  if (!osds || !osds.length) return '';
  const fmtSize = b => {
    if (!b) return '—';
    const tb = b / 1e12;
    if (tb >= 1) return tb.toFixed(tb >= 10 ? 1 : 2) + ' TB';
    return Math.round(b / 1e9) + ' GB';
  };
  const cards = osds.map(o => {
    const cls = (o.device_class || '').toLowerCase();
    const isSsd = cls === 'ssd' || cls === 'nvme';
    const typeLbl = cls ? cls.toUpperCase() : (isSsd ? 'SSD' : 'HDD');
    const up = o.status === 'up';
    const inCl = o.in_state === 1;
    const dotColor = up && inCl ? '#22C55E' : up ? '#F59E0B' : '#EF4444';
    const stateText = up ? (inCl ? 'Up · In' : 'Up · Out') : 'Down';
    const temp = (o.temp != null && o.temp > 0) ? o.temp : null;
    const tempC = temp != null ? (temp > 50 ? '#EF4444' : temp > 42 ? '#F59E0B' : 'var(--c-accent)') : 'var(--c-dim)';
    const icon = isSsd
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="13" y2="13"/><circle cx="17" cy="16" r="1"/></svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="9"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="3" x2="12" y2="6"/></svg>`;
    const driveNum = (o.id != null) ? o.id : '?';
    const stor = _storAttr({kind:'ceph-osd', ...o});
    return `<div title="${esc(o.name||'')}${o.host?' on '+esc(o.host):''}\n${fmtSize(o.used_bytes)} / ${fmtSize(o.size_bytes)}" data-stor="${stor}" onclick="showStorDrawer(this)" class="stor-cell" style="background:var(--c-hover);border:1px solid var(--c-border);border-radius:8px;padding:12px 14px;min-width:0;display:flex;flex-direction:column;gap:4px">
      <div style="display:flex;align-items:center;gap:6px;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:6px;color:var(--c-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:600">
          ${icon}<span>Drive ${driveNum}</span>
        </div>
        <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};box-shadow:0 0 6px ${dotColor}80" title="${stateText}"></span>
      </div>
      <div style="font-size:13px;font-weight:600;line-height:1.35;white-space:nowrap">${fmtSize(o.used_bytes)} <span style="font-size:10px;font-weight:500;color:var(--c-muted)">${typeLbl}</span></div>
      <div style="font-size:10px;color:var(--c-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.host||'—')}</div>
      <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--c-muted);margin-top:2px">
        <span>${temp != null ? `<span style="color:${tempC};font-weight:600">${temp}°C</span>` : '—'}</span>
        <span>${stateText}</span>
      </div>
    </div>`;
  }).join('');
  return `<div style="border-top:1px solid var(--c-border);padding-top:12px;margin-top:14px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">OSDs</span>
      <span style="font-size:10px;color:var(--c-muted)">${osds.length} drive${osds.length===1?'':'s'}</span>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px">${cards}</div>
  </div>`;
}

// Ceph section card: health badge, throughput + capacity-forecast charts, and
// the pool + OSD grids. Only shown when a live ceph object is present; the
// wrapping #stor-ceph-section is hidden otherwise.
function renderCeph(c) {
  const card = el('ceph-card'); if (!card) return;
  const _csec = el('stor-ceph-section');
  if (!c || !Object.keys(c).length) { card.innerHTML = ''; if (_csec) _csec.style.display = 'none'; return; }
  if (_csec) _csec.style.display = '';
  const cephIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="20.5" cy="12" r="1.5"/><circle cx="12" cy="20.5" r="1.5"/><circle cx="3.5" cy="12" r="1.5"/></svg>`;
  if (c.status && c.status !== 'online') {
    card.innerHTML = offlineCard('Ceph', c.error);
    return;
  }
  const healthOK = (c.health||'').toUpperCase() === 'HEALTH_OK';
  const healthCls = healthOK ? 'badge-up' : (c.health||'').toUpperCase().includes('WARN') ? 'badge-warn' : 'badge-down';
  const healthBadge = `<span class="badge ${healthCls}">${(c.health||'?').replace('HEALTH_','')}</span>`;
  const volsHtml = _volumesSection(c.pools || [], 'ceph-pool');
  const osdsHtml = _renderCephOsdGrid(c.osds || []);
  const bottomRow = (volsHtml && osdsHtml)
    ? `<div class="syn-bot-row" style="display:grid;grid-template-columns:200px minmax(0,1fr);gap:16px;align-items:start">
        <div style="min-width:0">${volsHtml}</div>
        <div style="min-width:0">${osdsHtml}</div>
      </div>`
    : (volsHtml || osdsHtml);
  const mons = (c.mon_quorum || []).length;
  card.innerHTML = `<div class="hd-card p-4">
    <div class="stor-card-hdr" style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
      ${cephIcon}
      <span class="font-medium text-sm" style="flex:1">Ceph <span style="color:var(--c-muted);font-size:11px">· ${mons} mon${mons===1?'':'s'} · ${c.num_pools||0} pools · ${c.num_up_osds||0}/${c.num_osds||0} OSDs up</span></span>
      ${_storPillRow('ceph')}
      ${healthBadge}
    </div>
    <div class="syn-nas-row" style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);gap:16px;align-items:start">
      <div style="min-width:0">
        <div class="stor-hdr">
          <span class="stor-hdr-label">Throughput</span>
          <span class="stor-hdr-spacer"></span>
          <span class="stor-legend">
            <span class="stor-leg"><span class="stor-leg-line" style="background:#22C55E"></span>Read</span>
            <span class="stor-leg"><span class="stor-leg-line" style="background:#F59E0B"></span>Write</span>
          </span>
        </div>
        <div style="position:relative;height:200px"><canvas id="chart-ceph-io"></canvas></div>
      </div>
      <div style="min-width:0;overflow:hidden">
        <div class="stor-hdr">
          <span class="stor-hdr-label">Storage</span>
          <span class="stor-conf-pill" id="ceph-conf-pill">High Confidence</span>
          <span class="stor-hdr-spacer"></span>
          <span class="stor-legend">
            <span class="stor-leg"><span class="stor-leg-line"></span>Historical</span>
            <span class="stor-leg"><span class="stor-leg-line dashed"></span><span class="stor-leg-dia"></span>Prediction</span>
          </span>
        </div>
        <div style="position:relative;height:200px"><canvas id="chart-ceph-store"></canvas></div>
      </div>
    </div>
    ${bottomRow}
  </div>`;
  if (el('page-storage') && el('page-storage').classList.contains('active')) {
    loadCephHistory();
  }
  _histSchedule();
}

async function loadCephHistory(hrs) {
  if (hrs === undefined) hrs = _histGetHours('ceph');
  try {
    const d = await _swrJSON(`/api/history/ceph?hours=${hrs}`, () => loadCephHistory(hrs));
    if (el('chart-ceph-store') && (d.used_gb||[]).length) {
      const totalGB = (d.total_gb && d.total_gb.length) ? d.total_gb[d.total_gb.length-1] : 0;
      _renderStorageForecastChart('chart-ceph-store', 'Used', d.labels, d.used_gb||[], totalGB, hrs,
        { prefix: 'ceph', confPillId: 'ceph-conf-pill' });
    }
    if (el('chart-ceph-io') && (d.labels||[]).length) {
      _renderThroughputChart('chart-ceph-io', d.labels, d.read_bytes_sec, d.write_bytes_sec, hrs);
    }
  } catch(e) { console.warn('ceph history:', e); }
}

// Router calls this on first navigation (see _deferInit in 10-router.js) — paint
// immediately from the cached last tick instead of waiting for the next WS push.
function _storageInit(){
  var d = window._lastData;
  if(d && d.proxmox && d.proxmox.storage) renderStoragePage(d.proxmox.storage, d.proxmox.storage_content, d.proxmox.storage_drives);
  if(d && d.ceph !== undefined) renderCeph(d.ceph);
  else { var _csec = el('stor-ceph-section'); if(_csec) _csec.style.display = 'none'; }
  // Refresh the per-device usage charts on every visit (skeleton may be cached).
  setTimeout(function(){ if(document.querySelector('[id^="chart-stor-"]')) loadPxStorHistory(); }, 0);
}

// The treemap lays out in absolute pixels — rebuild it when the window resizes
// (debounced; only while the Storage page is showing).
let _storHogsResizeT = null;
addEventListener('resize', function(){
  clearTimeout(_storHogsResizeT);
  _storHogsResizeT = setTimeout(function(){
    var pg = el('page-storage');
    if(!pg || !pg.classList.contains('active')) return;
    var d = window._lastData;
    if(d && d.proxmox && d.proxmox.storage)
      renderStoragePage(d.proxmox.storage, d.proxmox.storage_content, d.proxmox.storage_drives);
  }, 200);
});
// ── Network page ──────────────────────────────────────────────────────────
// A cluster-wide networking view built entirely from the live WS snapshot
// (data.proxmox.network) — no external NMS. The backend gathers each node's
// /network interface list, parses every guest's net<N> config for its bridge +
// VLAN tag, and derives a per-node throughput rate. Here we:
//   • fold same-named Linux bridges across nodes into one record (mirrors the
//     Storage page's per-name aggregation — also feeds the Topology page's
//     Network tab, which owns the interactive node/bridge/guest map),
//   • chart per-node in/out throughput over time (/api/history/proxmox_net),
//   • list physical NICs + bonds per node with link state / MTU / feeds-bridge,
//   • draw per-node in/out throughput bars when the counters have moved.
// Everything degrades to a clean placeholder when no network data is present
// (the real case with a placeholder Proxmox config).

// dotted netmask → CIDR prefix length (255.255.255.0 → 24). Falls back to '' on
// anything unparseable so we just omit the suffix rather than render garbage.
function _netMaskToPrefix(mask){
  if(!mask || String(mask).indexOf('.')<0) return '';
  var bits=0, ok=true;
  String(mask).split('.').forEach(function(o){
    var n=parseInt(o,10); if(isNaN(n)||n<0||n>255){ ok=false; return; }
    while(n){ bits+=n&1; n>>=1; }
  });
  return ok?String(bits):'';
}

function _netTruthy(v){ return v===1 || v==='1' || v===true || v==='yes'; }

function _netRate(bps){
  if(!bps || bps<0) return '0 B/s';
  return fmtBytes(bps)+'/s';
}

// Fold the per-node bridge interfaces into one record per bridge name. A bridge
// with the same name on multiple nodes (the common cluster case, e.g. vmbr0 on
// every host) collapses to a single card listing all the nodes it spans.
function _netBridgeAgg(net){
  var map={};
  var nodes=net.nodes||{};
  Object.keys(nodes).forEach(function(node){
    (nodes[node]||[]).forEach(function(i){
      if(i.type!=='bridge' && i.type!=='OVSBridge') return;
      var b=map[i.iface] || (map[i.iface]={
        name:i.iface, ovs:(i.type==='OVSBridge'), nodes:new Set(),
        cidr:'', gateway:'', vlanAware:false, active:false, ports:new Set()
      });
      b.nodes.add(node);
      if(!b.cidr){
        if(i.cidr) b.cidr=i.cidr;
        else if(i.address){ var p=_netMaskToPrefix(i.netmask); b.cidr=i.address+(p?('/'+p):''); }
      }
      if(i.gateway && !b.gateway) b.gateway=i.gateway;
      if(_netTruthy(i.bridge_vlan_aware)) b.vlanAware=true;
      if(_netTruthy(i.active)) b.active=true;
      String(i.bridge_ports||'').split(/\s+/).forEach(function(p){ p=p.trim(); if(p) b.ports.add(p); });
    });
  });
  return Object.keys(map).map(function(k){ return map[k]; })
    .sort(function(a,b){ return a.name.localeCompare(b.name); });
}

// ── Throughput history charts ────────────────────────────────────────────────
// Per-node in/out rates recorded server-side each poll (proxmox_net_stats) and
// charted here with the standard band+avg treatment. Range pills use the
// 'pxnet' prefix (see _histLoad in 65-time-range.js). The interactive
// node/bridge/guest map lives on the Topology page's Network tab now
// (70-topology.js) — this page is charts and tables only.
async function loadPxNetHistory(hrs) {
  if (hrs === undefined) hrs = _histGetHours('pxnet');
  try {
    const d = await _swrJSON(`/api/history/proxmox_net?hours=${hrs}`, () => loadPxNetHistory(hrs));
    if (!el('chart-pxnet-in')) return;
    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    const colors = [_acc,'#22C55E','#F59E0B','#EF4444','#A78BFA','#F472B6'];
    const bsec = _bucketSec(hrs);
    const inDs = [], outDs = [];
    Object.entries((d && d.nodes) || {}).forEach(([node, nd], i) => {
      const color = colors[i % colors.length];
      const inB  = _bucketStats(nd.labels, nd.in, bsec);
      const outB = _bucketStats(nd.labels, nd.out, bsec);
      inDs.push(..._dsBandHidden(node, inB, color), _dsAvgOnly(node, inB, color, { gradient: 'soft' }));
      outDs.push(..._dsBandHidden(node, outB, color), _dsAvgOnly(node, outB, color, { gradient: 'soft' }));
    });
    const fmt = v => fmtBytes(v) + '/s';
    _makeChart('chart-pxnet-in',  inDs,  fmt, hrs, { legendTarget: 'pxnet-in-legend' });
    _makeChart('chart-pxnet-out', outDs, fmt, hrs, { legendTarget: 'pxnet-out-legend' });
    _wireChartHover('chart-pxnet-in');
    _wireChartHover('chart-pxnet-out');
    // The composition chart follows the same range pill (guest history now
    // shares the nodes' 400d tiered retention, so no separate cap here).
    loadNetComposition(hrs);
  } catch(e) { console.warn('pxnet history:', e); }
}

// ── Header meta (rebuilt every tick — carries live throughput) ───────────────
// Counts live in the page header like every other detail page (page-hdr-meta,
// icon · bold number · label); big stat tiles are reserved for the Overview.
function _netHdrMeta(net, bridges){
  var nodes=(net&&net.nodes)||{}, guests=(net&&net.guests)||[], traffic=(net&&net.traffic)||{};
  var nodeNames=Object.keys(nodes);
  var activeUplinks=0, vlanSet={};
  nodeNames.forEach(function(n){
    (nodes[n]||[]).forEach(function(i){
      if(i.type==='eth' && _netTruthy(i.active)) activeUplinks++;
      if(i.type==='vlan'){ var t=String(i.iface).split('.')[1]; if(t) vlanSet[t]=1; }
    });
  });
  guests.forEach(function(g){ if(g.tag!=null && g.tag!=='') vlanSet[String(g.tag)]=1; });
  var vlanCount=Object.keys(vlanSet).length;
  var totIn=0, totOut=0;
  Object.keys(traffic).forEach(function(n){ totIn+=traffic[n].in||0; totOut+=traffic[n].out||0; });
  var mi=function(icon,num,label){
    return '<span class="page-hdr-meta-item">'+svg(icon,13)+'<b>'+num+'</b> '+label+'</span>';
  };
  var sep='<span class="page-hdr-meta-sep"></span>';
  return mi('share-2', bridges.length, 'bridge'+(bridges.length===1?'':'s'))
    + sep + mi('server', activeUplinks, 'active uplink'+(activeUplinks===1?'':'s'))
    + sep + mi('layers', vlanCount, 'VLAN'+(vlanCount===1?'':'s')+' in use')
    + sep + '<span class="page-hdr-meta-item">'+svg('activity',13)
      + '&darr; <b>'+_netRate(totIn)+'</b>&nbsp; &uarr; <b>'+_netRate(totOut)+'</b></span>';
}

// (The Node Interfaces list was removed — physical NIC/bond detail lives on
// the Topology page's node drawers; this page is charts and the guest table.)

function renderNetworkPage(net){
  var root=document.getElementById('network-root'); if(!root) return;
  var nodes=(net&&net.nodes)||{};
  var guests=(net&&net.guests)||[];
  var nodeNames=Object.keys(nodes);
  var bridges=net ? _netBridgeAgg(net) : [];
  var hasIfaces = nodeNames.some(function(n){ return (nodes[n]||[]).length; });

  if(!net || (!bridges.length && !hasIfaces && !guests.length)){
    root.innerHTML='<div class="net-msg">'
      + (net ? 'No network data reported by the cluster. Add your Proxmox cluster in Settings.' : 'Loading network…')
      + '</div>';
    return;
  }

  // Build the persistent skeleton once: summary slot, throughput history charts
  // (persistent — Chart.js owns the canvases), traffic composition, the
  // activity punch card, the guest inventory, and the per-tick "rest".
  if(!root.querySelector('#net-charts-section')){
    root.innerHTML=
      '<div id="net-charts-section" style="margin:6px 0 8px">'
        + '<div class="sec-hdr">'+svg('activity',18)
          + '<h2 class="sec-hdr-title">Throughput</h2>'
          + '<span class="sec-hdr-sub">Per-node network traffic over time</span>'
          + '<div class="sec-hdr-actions">'+_histPillRow('pxnet', ['1d','7d','30d','All','Custom'])+'</div>'
        + '</div>'
        + '<div class="hd-card p-4"><div class="grid grid-cols-1 md:grid-cols-2 gap-3">'
          + '<div><div class="sub-hdr">'+svg('activity',12)
            + '<span class="sub-hdr-title">Inbound</span>'
            + '<div class="sub-hdr-actions" id="pxnet-in-legend"></div></div>'
            + '<div style="position:relative;height:200px"><canvas id="chart-pxnet-in"></canvas></div></div>'
          + '<div><div class="sub-hdr">'+svg('activity',12)
            + '<span class="sub-hdr-title">Outbound</span>'
            + '<div class="sub-hdr-actions" id="pxnet-out-legend"></div></div>'
            + '<div style="position:relative;height:200px"><canvas id="chart-pxnet-out"></canvas></div></div>'
        + '</div></div>'
      + '</div>'
      + '<div class="sec-hdr" style="margin-top:20px">'+svg('layers',18)
        + '<h2 class="sec-hdr-title">Traffic Composition</h2>'
        + '<span class="sec-hdr-sub">Which guests make up the flow — top talkers over time (7-day window)</span>'
        + '<div class="sec-hdr-actions">'
          + '<div class="hd-search-wrap" style="max-width:300px;min-width:180px;flex:1">'
            + '<svg class="hd-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
            + '<input id="netcomp-search" class="hd-search" type="search" placeholder="Filter guests — name, VMID, node…" oninput="_netCompOnSearch(this.value)">'
            + '<button class="hd-search-clear" onclick="el(\'netcomp-search\').value=\'\';_netCompOnSearch(\'\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
          + '</div>'
        + '</div>'
      + '</div>'
      + '<div class="hd-card p-4">'
        + '<div class="sub-hdr">'+svg('layers',12)
          + '<span class="sub-hdr-title">Total traffic by guest</span>'
          + '<div class="sub-hdr-actions" id="netcomp-legend"></div></div>'
        + '<div style="position:relative;height:220px"><canvas id="chart-netcomp"></canvas></div>'
      + '</div>'
      + '<div class="sec-hdr" style="margin-top:20px">'+svg('monitor',18)
        + '<h2 class="sec-hdr-title">Guests</h2>'
        + '<span class="sec-hdr-sub">Every guest on the network — address, wiring, live rates</span>'
        + '<div class="sec-hdr-actions"><div class="hd-search-wrap" style="max-width:260px;min-width:160px">'
          + '<svg class="hd-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
          + '<input class="hd-search" type="search" placeholder="Search guests…" oninput="_netInv.search=this.value;_netInvPaint()">'
        + '</div></div>'
      + '</div>'
      + '<div class="hd-card" style="padding:6px 0;overflow-x:auto" id="net-inv-card"></div>';
    requestAnimationFrame(function(){ if(typeof _histThumbUpdate==='function') _histThumbUpdate('pxnet'); });
    setTimeout(function(){ loadPxNetHistory(); _netInvSparks(); }, 0);
  }
  var hdrMeta=el('network-hdr-meta');
  if(hdrMeta) hdrMeta.innerHTML=_netHdrMeta(net, bridges);
  window._netInvData=net;           // latest snapshot for the inventory painter
  _netInvPaint();
}

// ── Traffic composition — stacked area of the top talkers (Tracearr-style
// distribution view). Painted alongside the throughput charts; the guest_net
// table keeps 7 days, so the range is capped there. The filter box (copied
// from the Compute toolbar) narrows which guests compose the chart — e.g.
// type "arr" to see just the arr stack's share of the pipe.
const _netComp = { search: '' };
let _netCompSearchTimer = null;
function _netCompOnSearch(v){
  _netComp.search = (v||'').trim();
  clearTimeout(_netCompSearchTimer);
  _netCompSearchTimer = setTimeout(() => loadNetComposition(_histGetHours('pxnet')), 160);
}
async function loadNetComposition(hrs){
  try {
    if (!el('chart-netcomp')) return;
    const d = await _swrJSON(`/api/history/guest_net?hours=${hrs}`, () => loadNetComposition(hrs));
    const guests = (d && d.guests) || {};
    const meta = {};
    (((window._pxLast||{}).vms)||[]).concat(((window._pxLast||{}).lxcs)||[])
      .forEach(g => { meta[String(g.vmid)] = g; });
    const names = {};
    Object.entries(meta).forEach(([vmid, g]) => { names[vmid] = g.name || ('#'+vmid); });
    // Rank guests by total volume over the window; top 5 get their own band.
    const q = _netComp.search.toLowerCase();
    const ranked = Object.entries(guests).filter(([vmid]) => {
      if (!q) return true;
      const g = meta[vmid] || {};
      return ((g.name||'')+' '+vmid+' '+(g.node||'')+' '+(g.tags||'')).toLowerCase().includes(q);
    }).map(([vmid, s]) => ({
      vmid, s, vol: s.in.reduce((a,b)=>a+b,0) + s.out.reduce((a,b)=>a+b,0)
    })).sort((a,b)=>b.vol-a.vol);
    const leg = el('netcomp-legend');
    if (leg) { const n = leg.querySelector('.netcomp-empty'); if (n) n.remove(); }
    if (!ranked.length) {
      const ch = _charts['chart-netcomp'];
      if (ch) { try { ch.destroy(); } catch(e){} delete _charts['chart-netcomp']; }
      if (leg) leg.innerHTML = '<span class="netcomp-empty" style="font-size:11px;color:var(--c-muted)">No guests match the filter.</span>';
      return;
    }
    const top = ranked.slice(0, 5), rest = ranked.slice(5);
    // Common time grid = union of top+rest labels.
    const grid = [...new Set(ranked.flatMap(r => r.s.labels))].sort((a,b)=>a-b);
    const at = (s, t) => { const i = s.labels.indexOf(t); return i<0 ? 0 : (s.in[i]||0)+(s.out[i]||0); };
    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    const colors = [_acc,'#22C55E','#F59E0B','#EF4444','#A78BFA'];
    const ds = top.map((r, i) => ({
      label: names[r.vmid] || ('#'+r.vmid),
      data: grid.map(t => ({ x: t*1000, y: at(r.s, t) })),
      borderColor: colors[i], backgroundColor: _chartGradient(colors[i], 0.45, 0.25),
      borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: 0.3,
      fill: true, spanGaps: true,
    }));
    if (rest.length) ds.push({
      label: 'Other ('+rest.length+')',
      data: grid.map(t => ({ x: t*1000, y: rest.reduce((a,r)=>a+at(r.s,t),0) })),
      borderColor: '#6B7280', backgroundColor: 'rgba(107,114,128,.25)',
      borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: 0.3,
      fill: true, spanGaps: true,
    });
    _makeChart('chart-netcomp', ds, v => fmtBytes(v)+'/s', hrs,
      { stacked: true, legendTarget: 'netcomp-legend' });
    _wireChartHover('chart-netcomp');
  } catch(e){ console.warn('net composition:', e); }
}

// ── Guest inventory — searchable live table (name/IP/wiring/rates/sparkline).
const _netInv = { search:'', sparks:{}, sparkTs:0 };
async function _netInvSparks(){
  try {
    if (Date.now() - _netInv.sparkTs < 300000) return;   // refresh sparklines ≤ every 5 min
    _netInv.sparkTs = Date.now();
    const d = await _swrJSON('/api/history/guest_net?hours=1', () => {});
    const guests = (d && d.guests) || {};
    _netInv.sparks = {};
    Object.entries(guests).forEach(([vmid, s]) => {
      const vals = s.labels.map((_, i) => (s.in[i]||0)+(s.out[i]||0));
      _netInv.sparks[vmid] = _healthSparkline(vals, 110, 18,
        getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000');
    });
    _netInvPaint();
  } catch(e){ /* sparklines are decoration — never block the table */ }
}
window._sortState = window._sortState || {};
window._sortState.net = window._sortState.net || { k:'hour', d:-1 };
function _netSort(key){ _sortSet('net', key, (key==='guest'||key==='node'||key==='ip'||key==='bridge')?1:-1, _netInvPaint); }
function _netInvPaint(){
  const card = el('net-inv-card'); if (!card) return;
  const net = window._netInvData || {};
  const rates = net.guest_rates || {};
  const nics = {};
  (net.guests || []).forEach(n => { if (!(n.vmid in nics)) nics[n.vmid] = n; });
  const px = window._pxLast || {};
  let rows = (px.vms||[]).concat(px.lxcs||[]).map(g => {
    const r = rates[String(g.vmid)] || {in:0,out:0};
    const nic = nics[g.vmid] || {};
    return { g, nic, r, total: (r.in||0)+(r.out||0) };
  });
  const q = (_netInv.search||'').toLowerCase();
  if (q) rows = rows.filter(x =>
    ((x.g.name||'')+' '+x.g.vmid+' '+(x.g.node||'')+' '+(x.g.ip||'')+' '+(x.nic.bridge||'')+' '+(x.nic.tag??'')).toLowerCase().includes(q));
  const key = (x,k) => k==='guest' ? (x.g.name||'').toLowerCase() : k==='node' ? (x.g.node||'')
    : k==='ip' ? (x.g.ip||'') : k==='bridge' ? (x.nic.bridge||'') : k==='vlan' ? (x.nic.tag==null||x.nic.tag===''?-1:Number(x.nic.tag))
    : k==='in' ? (x.r.in||0) : k==='out' ? (x.r.out||0) : x.total;   // 'hour' → total traffic
  rows = _sortApply('net', rows, key);
  const zero = 'color:var(--c-dim)';
  const hpad = 'padding:8px 14px;font-size:10px;letter-spacing:.05em';
  const hpr  = 'padding:8px 10px;font-size:10px;letter-spacing:.05em';
  const thead = '<thead><tr>'
    + _sortTh('net','guest','Guest',"_netSort('guest')",'left',hpad)
    + _sortTh('net','node','Node',"_netSort('node')",'left',hpr)
    + _sortTh('net','ip','IP',"_netSort('ip')",'left',hpr)
    + _sortTh('net','bridge','Bridge',"_netSort('bridge')",'left',hpr)
    + _sortTh('net','vlan','VLAN',"_netSort('vlan')",'left',hpr)
    + _sortTh('net','in','&darr; In',"_netSort('in')",'right',hpr)
    + _sortTh('net','out','&uarr; Out',"_netSort('out')",'right',hpr)
    + _sortTh('net','hour','Last hour',"_netSort('hour')",'right','padding:8px 14px;font-size:10px;letter-spacing:.05em')
    + '</tr></thead>';
  card.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:12px;min-width:760px">' + thead + '<tbody>' + rows.map(x => {
    const running = x.g.status === 'running';
    const data = _storAttr({ vmid:x.g.vmid, name:x.g.name, node:x.g.node, type:x.g.type, ip:x.g.ip||'',
      status:x.g.status, cpu:x.g.cpu, maxcpu:x.g.maxcpu, mem:x.g.mem, maxmem:x.g.maxmem,
      disk:x.g.disk, maxdisk:x.g.maxdisk, diskread:x.g.diskread, diskwrite:x.g.diskwrite,
      netin:x.g.netin, netout:x.g.netout, uptime:x.g.uptime, tags:x.g.tags, pool:x.g.pool,
      web_url:window._pxWebUrl||'' });
    return '<tr data-entity="'+data+'" onclick="showGuestDrawer(this)" style="border-top:1px solid var(--c-border);cursor:pointer" '
      + 'onmouseenter="this.style.background=\'var(--c-hover)\'" onmouseleave="this.style.background=\'\'">'
      + '<td style="padding:8px 14px;min-width:140px"><span class="sdot '+(running?'sdot-green dot-live':'sdot-grey')+'" style="margin-right:7px"></span>'
        + '<span style="font-weight:600;color:var(--c-text)">'+esc(x.g.name||('#'+x.g.vmid))+'</span>'
        + ' <span style="color:var(--c-dim);font-size:10px">#'+x.g.vmid+'</span></td>'
      + '<td style="padding:8px 10px;color:var(--c-muted)">'+esc(x.g.node||'')+'</td>'
      + '<td style="padding:8px 10px;font-family:ui-monospace,monospace;font-size:11px;color:var(--c-muted)">'+esc(x.g.ip||'—')+'</td>'
      + '<td style="padding:8px 10px;color:var(--c-muted)">'+esc(x.nic.bridge||'—')+'</td>'
      + '<td style="padding:8px 10px;color:var(--c-muted)">'+(x.nic.tag!=null&&x.nic.tag!==''?esc(String(x.nic.tag)):'—')+'</td>'
      + '<td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;'+(x.r.in?'color:#22C55E;font-weight:600':zero)+'">'+_netRate(x.r.in)+'</td>'
      + '<td style="padding:8px 10px;text-align:right;font-variant-numeric:tabular-nums;'+(x.r.out?'color:var(--c-accent);font-weight:600':zero)+'">'+_netRate(x.r.out)+'</td>'
      + '<td style="padding:4px 14px;text-align:right">'+(_netInv.sparks[String(x.g.vmid)]||'')+'</td>'
    + '</tr>';
  }).join('') + '</tbody></table>'
    + (rows.length ? '' : '<div style="padding:14px;color:var(--c-muted);font-size:12px">No guests match.</div>');
}

// Router calls this on first navigation (see _deferInit in 10-router.js) — paint
// immediately from the cached last tick instead of waiting for the next WS push.
function _networkInit(){
  var d=window._lastData;
  renderNetworkPage((d&&d.proxmox&&d.proxmox.network)||null);
  setTimeout(function(){ _netInvSparks(); }, 0);
}
// ── Compute page: search / status filter / sort ────────────────────────────
// One toolbar (proxmox.html #cmp-toolbar) drives every section. The poll
// dispatch pipes Hosts/VMs/LXCs through _cmpProcess() so filters survive each
// refresh; changing a control re-renders immediately from window._lastData
// (no wait for the next poll).
window._cmp = window._cmp || { search: '', status: 'all', sort: 'none', tags: [], types: [], view: 'list' };
if (!window._cmp.view) window._cmp.view = 'list';
if (!Array.isArray(window._cmp.tags)) window._cmp.tags = [];
if (!Array.isArray(window._cmp.types)) window._cmp.types = [];
// Entity kinds for the Type filter (each maps to a page section).
const _CMP_KINDS = [['host', 'Hosts'], ['vm', 'VMs'], ['lxc', 'LXCs']];
const _CMP_KIND_LABELS = { host: 'Hosts', vm: 'VMs', lxc: 'LXCs' };
let _cmpSearchTimer = null;
// Only an actively-running guest / online node counts as "running"; everything
// else — stopped, offline, paused, or "unknown" (guests on a down node) — is
// treated as stopped/down so the Stopped filter surfaces them.
function _cmpStatusOf(it) {
  const s = (it.status || '').toLowerCase();
  return (s === 'running' || s === 'online') ? 'running' : 'stopped';
}
// Proxmox tags arrive as a string (";"/","/space-separated); normalise to a list.
function _cmpItemTags(it) {
  return (it.tags || '').split(/[;,\s]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}
function _cmpMatch(it) {
  const f = window._cmp;
  if (f.status !== 'all' && _cmpStatusOf(it) !== f.status) return false;
  if (f.tags.length) { const its = _cmpItemTags(it); if (!f.tags.some(t => its.includes(t))) return false; }
  if (f.search) {
    const hay = `${it.name||''} ${it.node||''} ${it.vmid||''} ${it.tags||''} ${it.pool||''} ${it.type||''} ${it.status||''}`.toLowerCase();
    if (!hay.includes(f.search.toLowerCase())) return false;
  }
  return true;
}
// Tags/type are strings; empties sort last (so untagged guests fall to the
// bottom), then name is the tie-breaker within the same tag/type group.
function _cmpStr(get) {
  return (x, y) => {
    const a = get(x), b = get(y);
    if (!a && b) return 1;
    if (a && !b) return -1;
    if (a !== b) return a < b ? -1 : 1;
    const nx = (x.name || x.node || '').toLowerCase(), ny = (y.name || y.node || '').toLowerCase();
    return nx < ny ? -1 : nx > ny ? 1 : 0;
  };
}
function _cmpSortArr(arr) {
  const s = window._cmp.sort, a = arr.slice();
  const nm  = x => (x.name || x.node || '').toLowerCase();
  const cpu = x => _cmpStatusOf(x) === 'running' ? (x.cpu || 0) : -1;
  const ram = x => x.maxmem ? (x.mem / x.maxmem) : -1;
  const dsk = x => (x.maxdisk && x.disk) ? (x.disk / x.maxdisk) : -1;
  const up  = x => x.uptime || 0;
  if (s === 'cpu')          a.sort((x, y) => cpu(y) - cpu(x));
  else if (s === 'ram')     a.sort((x, y) => ram(y) - ram(x));
  else if (s === 'storage') a.sort((x, y) => dsk(y) - dsk(x));
  else if (s === 'uptime')  a.sort((x, y) => up(y) - up(x));
  else if (s === 'type')    a.sort(_cmpStr(x => (x.type || x.kind || x.node_type || '').toLowerCase()));
  else if (s === 'name')    a.sort((x, y) => nm(x) < nm(y) ? -1 : nm(x) > nm(y) ? 1 : 0);
  // 'none' → leave in source order
  return a;
}
function _cmpProcess(arr) { return _cmpSortArr((arr || []).filter(_cmpMatch)); }
// Show/hide a section by the Type filter (each kind maps to one page section).
function _cmpShowSection(gridId, visible) {
  const g = el(gridId); if (!g) return;
  const s = g.closest('section'); if (s) s.style.display = visible ? '' : 'none';
}
// Distinct Proxmox tags across hosts/VMs/LXCs, for the Tag dropdown.
function _cmpAllTags() {
  const d = window._lastData; if (!d || !d.proxmox) return [];
  const px = d.proxmox, set = new Set();
  [...(px.nodes || []), ...(px.vms || []), ...(px.lxcs || [])].forEach(it => _cmpItemTags(it).forEach(t => set.add(t)));
  return [...set].sort();
}
// A utilization cell: a mini bar (green/amber/red by threshold) filling the
// column width, with the % beside it — reuses the horizontal space in the CPU/
// RAM/Disk columns of the list views. Returns "—" when the metric is absent.
function _pctBar(pct) {
  if (pct == null) return '<span style="color:var(--c-dim)">—</span>';
  const p = Math.max(0, Math.min(100, pct));
  const c = barHex(p);   // app-wide standard: green<60 / amber<80 / red≥80
  const fill = (typeof _barFill === 'function') ? _barFill(c) : c;
  return '<div style="display:flex;align-items:center;gap:8px">'
    + '<span style="font-variant-numeric:tabular-nums;min-width:32px;color:' + c + '">' + Math.round(pct) + '%</span>'
    + '<div style="flex:1;min-width:48px;height:6px;border-radius:9999px;background:var(--c-bar-bg);overflow:hidden">'
    + '<div style="width:' + p + '%;height:100%;background:' + fill + ';border-radius:9999px"></div></div></div>';
}
function _cmpApply() {
  _cmpRenderChips();
  const d = window._lastData; if (!d || !d.proxmox) return;
  const px = d.proxmox;
  _pxScopeRenderButtons();
  // Type filter (empty = all): hide the sections whose kind isn't selected.
  const kf = window._cmp.types, show = k => !kf.length || kf.includes(k);
  const list = window._cmp.view === 'list';
  if (px.nodes) renderNodes(_cmpProcess(px.nodes), px.web_url);
  _cmpShowSection('nodes-grid', show('host'));   // Hosts section visibility = type filter
  const ls = el('cmp-list-sec'), ng = el('nodes-grid'), hl = el('cmp-hostlist');
  if (list) {
    // Hosts: swap cards for a table inside the same section.
    _cmpRenderHostList(_cmpProcess(px.nodes || []));
    if (ng) ng.style.display = 'none';
    if (hl) hl.style.display = '';
    // Guests: one combined table; hide the VM/LXC card sections.
    _cmpRenderList(px, show);
    _cmpShowSection('vms-grid', false);
    _cmpShowSection('lxcs-grid', false);
    if (ls) ls.style.display = '';
  } else {
    if (ng) ng.style.display = '';
    if (hl) hl.style.display = 'none';
    renderVmLxc(_cmpProcess(px.vms || []), _cmpProcess(px.lxcs || []));
    _cmpShowSection('vms-grid', show('vm'));
    _cmpShowSection('lxcs-grid', show('lxc'));
    if (ls) ls.style.display = 'none';
  }
}
window._sortState = window._sortState || {};
window._sortState.cmphosts = window._sortState.cmphosts || { k: 'node', d: 1 };
function _cmpHostSort(key) { _sortSet('cmphosts', key, (key === 'node' || key === 'status') ? 1 : -1, _cmpApply); }
function _cmpRenderHostList(nodes) {
  const host = el('cmp-hostlist'); if (!host) return;
  const key = (n, k) => k === 'node' ? (n.node || '').toLowerCase() : k === 'status' ? (n.status || '')
    : k === 'cpu' ? (n.cpu || 0) : k === 'ram' ? (n.maxmem ? n.mem / n.maxmem : 0)
    : k === 'disk' ? (n.maxdisk ? n.disk / n.maxdisk : -1) : k === 'uptime' ? (n.uptime || 0) : 0;
  const rows = _sortApply('cmphosts', nodes, key);
  const th = (k, l) => _sortTh('cmphosts', k, l, "_cmpHostSort('" + k + "')", 'left', 'padding:9px 14px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase');
  const td = (v, ex) => '<td style="padding:8px 14px;font-size:12.5px;white-space:nowrap;' + (ex || '') + '">' + v + '</td>';
  const body = rows.map(n => {
    const online = n.status === 'online';
    const cpu = (n.cpu || 0) * 100, ram = n.maxmem ? n.mem / n.maxmem * 100 : null, disk = n.maxdisk ? n.disk / n.maxdisk * 100 : null;
    const data = _storAttr({ kind: 'node', node: n.node, status: n.status, ip: n.ip || '', cpu: n.cpu, maxcpu: n.maxcpu,
      mem: n.mem, maxmem: n.maxmem, disk: n.disk, maxdisk: n.maxdisk, uptime: n.uptime, web_url: window._pxWebUrl || '' });
    return '<tr data-entity="' + data + '" onclick="showGuestDrawer(this)" style="border-top:1px solid var(--c-border);cursor:pointer" onmouseenter="this.style.background=\'var(--c-hover)\'" onmouseleave="this.style.background=\'\'">'
      + td('<span class="sdot ' + (online ? 'sdot-green dot-live' : 'sdot-grey') + '" style="margin-right:7px"></span><span style="font-weight:600">' + esc(n.node) + '</span>' + (n.maxcpu ? ' <span style="color:var(--c-dim);font-size:10px">' + n.maxcpu + ' cores</span>' : ''))
      + td('<span class="badge ' + (online ? 'badge-up' : 'badge-down') + '">' + esc(n.status || '?') + '</span>')
      + td(_pctBar(cpu), 'min-width:150px')
      + td(_pctBar(ram), 'min-width:150px')
      + td(_pctBar(disk), 'min-width:150px')
      + td(n.uptime ? fmtUptime(n.uptime) : '<span style="color:var(--c-dim)">—</span>', 'color:var(--c-muted)')
      + '</tr>';
  }).join('');
  host.innerHTML = '<div class="hd-card" style="padding:0;overflow-x:auto"><table style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr>'
    + th('node', 'Node') + th('status', 'Status') + th('cpu', 'CPU') + th('ram', 'RAM') + th('disk', 'Disk') + th('uptime', 'Uptime')
    + '</tr></thead><tbody>' + (body || '<tr><td colspan="6" style="padding:14px;color:var(--c-muted)">No hosts.</td></tr>') + '</tbody></table></div>';
}
// View toggle (Cards ↔ List). List = sortable host and combined VM/LXC tables.
function _cmpSetView(btn, v) {
  window._cmp.view = v;
  const p = btn.closest('.hist-range');
  if (p) p.querySelectorAll('.hist-btn').forEach(b => b.classList.toggle('active', b === btn));
  _histThumbUpdate('cmp-view');
  _cmpApply();
}
window._sortState = window._sortState || {};
window._sortState.cmplist = window._sortState.cmplist || { k: 'name', d: 1 };
function _cmpListSort(key) {
  _sortSet('cmplist', key, (key === 'name' || key === 'type' || key === 'node' || key === 'status') ? 1 : -1, _cmpApply);
}
function _cmpRenderList(px, show) {
  const card = el('cmp-list-card'); if (!card) return;
  let rows = [];
  if (show('vm')) rows = rows.concat(_cmpProcess(px.vms || []).map(g => ({ g, type: 'VM' })));
  if (show('lxc')) rows = rows.concat(_cmpProcess(px.lxcs || []).map(g => ({ g, type: 'LXC' })));
  const badge = el('badge-guests'); if (badge) badge.textContent = rows.length;
  const key = (x, k) => { const g = x.g;
    return k === 'name' ? (g.name || '').toLowerCase() : k === 'type' ? x.type : k === 'node' ? (g.node || '')
      : k === 'status' ? (g.status || '') : k === 'cpu' ? (g.cpu || 0)
      : k === 'ram' ? (g.maxmem ? g.mem / g.maxmem : 0)
      : k === 'disk' ? (g.maxdisk && g.disk != null ? g.disk / g.maxdisk : -1)
      : k === 'uptime' ? (g.uptime || 0) : 0; };
  rows = _sortApply('cmplist', rows, key);
  const th = (k, l, al) => _sortTh('cmplist', k, l, "_cmpListSort('" + k + "')", al || 'left', 'padding:9px 14px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase');
  const td = (v, ex) => '<td style="padding:8px 14px;font-size:12.5px;white-space:nowrap;' + (ex || '') + '">' + v + '</td>';
  const body = rows.map(x => {
    const g = x.g, running = g.status === 'running';
    const cpu = (g.cpu || 0) * 100, ram = g.maxmem ? g.mem / g.maxmem * 100 : null,
          disk = (g.maxdisk && g.disk != null) ? g.disk / g.maxdisk * 100 : null;
    const data = _storAttr({ vmid: g.vmid, name: g.name, node: g.node, type: g.type, ip: g.ip || '', status: g.status,
      cpu: g.cpu, maxcpu: g.maxcpu, mem: g.mem, maxmem: g.maxmem, disk: g.disk, maxdisk: g.maxdisk,
      diskread: g.diskread, diskwrite: g.diskwrite, netin: g.netin, netout: g.netout, uptime: g.uptime,
      tags: g.tags, pool: g.pool, web_url: window._pxWebUrl || '' });
    return '<tr data-entity="' + data + '" onclick="showGuestDrawer(this)" style="border-top:1px solid var(--c-border);cursor:pointer" onmouseenter="this.style.background=\'var(--c-hover)\'" onmouseleave="this.style.background=\'\'">'
      + td('<span class="sdot ' + (running ? 'sdot-green dot-live' : 'sdot-grey') + '" style="margin-right:7px"></span><span style="font-weight:600">' + esc(g.name || ('#' + g.vmid)) + '</span> <span style="color:var(--c-dim);font-size:10px">#' + g.vmid + '</span>')
      + td('<span style="color:var(--c-muted)">' + x.type + '</span>')
      + td('<span style="color:var(--c-muted)">' + esc(g.node || '—') + '</span>')
      + td('<span class="badge ' + (running ? 'badge-up' : 'badge-down') + '">' + esc(g.status || '?') + '</span>')
      + td(_pctBar(cpu), 'min-width:150px')
      + td(_pctBar(ram), 'min-width:150px')
      + td(_pctBar(disk), 'min-width:150px')
      + td(g.uptime ? fmtUptime(g.uptime) : '<span style="color:var(--c-dim)">—</span>', 'color:var(--c-muted)')
      + '</tr>';
  }).join('');
  card.innerHTML = '<table style="width:100%;border-collapse:collapse;min-width:720px">'
    + '<thead><tr>' + th('name', 'Name') + th('type', 'Type') + th('node', 'Node') + th('status', 'Status')
    + th('cpu', 'CPU') + th('ram', 'RAM') + th('disk', 'Disk') + th('uptime', 'Uptime')
    + '</tr></thead><tbody>' + (body || '<tr><td colspan="8" style="padding:14px;color:var(--c-muted)">No guests match.</td></tr>') + '</tbody></table>';
}
function _cmpOnSearch(v) {
  window._cmp.search = v.trim();
  clearTimeout(_cmpSearchTimer);
  _cmpSearchTimer = setTimeout(_cmpApply, 160);
}
// Status is an animated .hist-range pill toggle; Tag & Sort are icon buttons
// that open small popover menus and go black-bg/white-icon (.on) when active.
function _cmpSetStatus(btn, val) {
  window._cmp.status = val;
  const p = btn.closest('.hist-range');
  if (p) p.querySelectorAll('.hist-btn').forEach(b => b.classList.toggle('active', b === btn));
  _histThumbUpdate('cmp-status');   // slide the pill thumb like every other toggle
  _cmpApply();
}
const _CMP_TAG_ICO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
const _CMP_SORT_ICO = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/></svg>';
const _CMP_SORTS = [['none', 'None'], ['name', 'Name'], ['type', 'Type'], ['cpu', 'CPU'], ['ram', 'RAM'], ['storage', 'Storage'], ['uptime', 'Uptime']];
const _CMP_SORT_LABELS = { name: 'Name', type: 'Type', cpu: 'CPU', ram: 'RAM', storage: 'Storage', uptime: 'Uptime' };
const _CMP_STATUS_LABELS = { running: 'Running', stopped: 'Stopped' };

// Filter (multi-select tags) + Sort (single-select) dropdowns, built from the
// shared search-toolbar component (src/49) — byte-identical to Activity's menus.
// Mount-based: the open menu is (re)rendered into #cmp-controls; toggling/picking
// re-renders. The shared [data-hd-menu] capture-phase outside-click keeps multi-
// select open (the clicked item detaches on re-render, but capture runs first).
function _cmpRenderControls() {
  const host = el('cmp-controls'); if (!host) return;
  const f = window._cmp, tags = _cmpAllTags();
  f.tags = f.tags.filter(t => tags.includes(t));
  const tagMenu = _stMenu(null,
    _stMenuHdr('Type' + (f.types.length ? ` (${f.types.length})` : ''))
    + _CMP_KINDS.map(([k, l]) => _stCheckItem(l, f.types.includes(k), `_cmpToggleType('${k}')`)).join('')
    + _stMenuSep()
    + _stMenuHdr('Tag' + (f.tags.length ? ` (${f.tags.length})` : ''))
    + (f.tags.length ? _stClearItem('Clear all tags', '_cmpClearTags()') : '')
    + (tags.length
        ? tags.map(t => _stCheckItem(t, f.tags.includes(t), `_cmpToggleTag('${t.replace(/'/g, "\\'")}')`)).join('')
        : '<div style="padding:6px 8px;font-size:12px;color:var(--c-muted)">No tags</div>'));
  const sortMenu = _stMenu(null, _stMenuHdr('Sort by') + _CMP_SORTS.map(([v, l]) => {
    const it = _stRadioItem(l, v, `_cmpPickSort('${v}')`);
    return f.sort === v ? it.replace('class="hd-menu-item"', 'class="hd-menu-item sel"') : it;
  }).join(''));
  host.innerHTML =
    _stDropdown({ id: 'cmp-tag-btn', onclick: "_cmpToggleMenu('tag')", icon: _CMP_TAG_ICO, label: 'Filter', badge: f.tags.length + f.types.length, open: f.openMenu === 'tag', menu: tagMenu })
    + _stDropdown({ id: 'cmp-sort-btn', onclick: "_cmpToggleMenu('sort')", icon: _CMP_SORT_ICO, label: 'Sort', badge: 0, open: f.openMenu === 'sort', menu: sortMenu });
}
function _cmpCloseMenus() { window._cmp.openMenu = null; _cmpRenderControls(); }
function _cmpToggleMenu(which) { window._cmp.openMenu = window._cmp.openMenu === which ? null : which; _cmpRenderControls(); }
function _cmpToggleTag(t) {
  const arr = window._cmp.tags, i = arr.indexOf(t);
  if (i === -1) arr.push(t); else arr.splice(i, 1);
  _cmpRenderControls(); _cmpApply();
}
function _cmpClearTags() { window._cmp.tags = []; _cmpRenderControls(); _cmpApply(); }
function _cmpToggleType(k) {
  const arr = window._cmp.types, i = arr.indexOf(k);
  if (i === -1) arr.push(k); else arr.splice(i, 1);
  _cmpRenderControls(); _cmpApply();
}
function _cmpClearTypes() { window._cmp.types = []; _cmpRenderControls(); _cmpApply(); }
function _cmpPickSort(v) { window._cmp.sort = v; window._cmp.openMenu = null; _cmpRenderControls(); _cmpApply(); }
// Active-filter chips below the toolbar — shared _stChip, identical to Activity.
function _cmpRenderChips() {
  const box = el('cmp-chips'); if (!box) return;
  const f = window._cmp, chips = [];
  if (f.search) chips.push(_stChip('Search', f.search, '_cmpClearSearch()'));
  if (f.status !== 'all') chips.push(_stChip('Status', _CMP_STATUS_LABELS[f.status] || f.status, '_cmpClearStatus()'));
  if (f.types.length) chips.push(_stChip('Type', f.types.length > 2 ? f.types.length + ' selected' : f.types.map(k => _CMP_KIND_LABELS[k] || k).join(', '), '_cmpClearTypes()'));
  if (f.tags.length) chips.push(_stChip('Tags', f.tags.length > 2 ? f.tags.length + ' selected' : f.tags.join(', '), '_cmpClearTags()'));
  if (f.sort !== 'none') chips.push(_stChip('Sort', _CMP_SORT_LABELS[f.sort] || f.sort, "_cmpPickSort('none')"));
  box.innerHTML = chips.length
    ? chips.join('') + '<button onclick="_cmpClearAll()" style="font-size:12px;color:var(--c-muted);background:none;border:none;cursor:pointer;padding:4px 8px;font-family:inherit">Clear all</button>'
    : '';
  box.style.display = chips.length ? 'flex' : 'none';
}
function _cmpClearSearch() { window._cmp.search = ''; const i = el('cmp-search'); if (i) i.value = ''; _cmpApply(); }
function _cmpClearStatus() {
  window._cmp.status = 'all';
  const seg = el('cmp-status-hist-range');
  if (seg) { seg.querySelectorAll('.hist-btn').forEach(b => b.classList.toggle('active', b.dataset.v === 'all')); _histThumbUpdate('cmp-status'); }
  _cmpApply();
}
function _cmpClearAll() {
  const i = el('cmp-search'); if (i) i.value = '';
  Object.assign(window._cmp, { search: '', status: 'all', tags: [], types: [], sort: 'none' });
  const seg = el('cmp-status-hist-range');
  if (seg) { seg.querySelectorAll('.hist-btn').forEach(b => b.classList.toggle('active', b.dataset.v === 'all')); _histThumbUpdate('cmp-status'); }
  _cmpRenderControls(); _cmpApply();
}
// Called from showPage('proxmox'): sync the controls to saved state and paint
// the current filter from cache (the page fragment persists across nav).
function _cmpInit() {
  const si = el('cmp-search'); if (si && si.value !== window._cmp.search) si.value = window._cmp.search;
  const seg = el('cmp-status-hist-range');
  if (seg) {
    seg.querySelectorAll('.hist-btn').forEach(b => b.classList.toggle('active', b.dataset.v === window._cmp.status));
    requestAnimationFrame(() => _histThumbUpdate('cmp-status'));
  }
  // Position the sliding thumbs for the Cluster scope + view toggles too.
  _pxScopeRenderButtons();
  requestAnimationFrame(() => { _histThumbUpdate('px-scope'); _histThumbUpdate('cmp-view'); });
  _cmpRenderControls();
  _cmpRenderChips();
  if (!window._cmpDocBound) {
    window._cmpDocBound = true;
    // Capture phase keyed on [data-hd-menu]: runs BEFORE a menu-item click
    // re-renders (detaches) the clicked button, so multi-select stays open —
    // the exact mechanism the Activity Filters dropdown uses.
    document.addEventListener('click', e => {
      if (window._cmp.openMenu && (!e.target.closest || !e.target.closest('[data-hd-menu]'))) _cmpCloseMenus();
    }, true);
  }
  if (window._lastData) _cmpApply();
}

// ── Cluster chart scope (Compute page) ──────────────────────────────────────
// Toggle the Cluster CPU + RAM line charts between "All" (every node, the old
// default) and a single node. The actual loading lives in loadPxHistory /
// _loadPxNodeDrilldown (src/65-time-range.js); here we just hold the state,
// render the scope buttons, and re-trigger a load on toggle. Picking a single
// node also pulls in that node's own guests (VMs + LXCs) in the drilldown, so
// the filter box doubles as a node-name filter under "All" and a guest-name
// filter once a node is selected.
window._pxScope = window._pxScope || { scope: 'all', search: '' };
let _pxScopeTimer = null;
// Never hardcode node names (portability rule) — read them from live data.
function _pxScopeNodeNames() {
  const px = window._lastData && window._lastData.proxmox;
  return ((px && px.nodes) || []).map(n => n.node).filter(Boolean);
}
// Rebuilds only when the live node set actually changes, so a poll tick
// doesn't tear down the buttons (and the user's selection) every few seconds.
function _pxScopeRenderButtons() {
  const range = el('px-scope-hist-range'); if (!range) return;
  const names = _pxScopeNodeNames();
  const sig = names.join(',');
  if (range.dataset.pxSig === sig && range.querySelector('.hist-btn')) return;
  range.dataset.pxSig = sig;
  if (window._pxScope.scope !== 'all' && !names.includes(window._pxScope.scope)) window._pxScope.scope = 'all';
  const btn = (v, label) => `<button class="hist-btn${window._pxScope.scope === v ? ' active' : ''}" data-v="${esc(v)}" onclick="_pxScopeSet(this,'${esc(v)}')">${esc(label)}</button>`;
  range.innerHTML = btn('all', 'All') + names.map(n => btn(n, n)).join('');
  requestAnimationFrame(() => _histThumbUpdate('px-scope'));
}
function _pxScopeSet(btn, val) {
  window._pxScope.scope = val;
  const p = btn.closest('.hist-range');
  if (p) p.querySelectorAll('.hist-btn').forEach(b => b.classList.toggle('active', b === btn));
  _histThumbUpdate('px-scope');
  loadPxHistory(_histGetHours('px'));
}
function _pxScopeSearch(v) {
  window._pxScope.search = (v || '').trim();
  clearTimeout(_pxScopeTimer);
  _pxScopeTimer = setTimeout(() => loadPxHistory(_histGetHours('px')), 160);
}
// ── Shared drawer helpers ───────────────────────────────────────────────────
// Section card + key/value row + close-button icon. Used by every drawer in
// this file (storage, drive, volume, guest, node). Relocated here from the
// earlier modules during the 2026-07 dead-code removal.
function _sdSection(icon, title, badge, body){
  return `<div class="sd-card">
    <div class="sd-card-hdr">
      <div class="sd-card-hdr-l"><span class="sd-card-ico">${icon}</span><span>${title}</span></div>
      ${badge || ''}
    </div>
    ${body}
  </div>`;
}
function _sdRow(k, v, opts){
  if (v == null || v === '' || v === '—') return '';
  const cls = (opts && opts.mono) ? ' mono' : '';
  return `<div class="sd-row"><span class="sd-row-k">${k}</span><span class="sd-row-v${cls}">${v}</span></div>`;
}
const _laIcons = {
  x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
};

// ── Storage drive / volume drawer ──────────────────────────────────────────
let _storDrawerData = null;
const _STOR_IC = {
  drive: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
  ssd:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="13" y2="13"/><circle cx="17" cy="16" r="1"/></svg>',
  hdd:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="9"/><circle cx="12" cy="12" r="2.5"/><line x1="12" y1="3" x2="12" y2="6"/></svg>',
  vol:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
  shield:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
};

function _storAttr(obj) {
  return escAttr(JSON.stringify(obj));
}
function _storFmtGB(gb) {
  if (gb == null || gb === 0) return '—';
  return gb >= 1000 ? (gb/1000).toFixed(2)+' TB' : Math.round(gb)+' GB';
}
function _storFmtBytes(b) {
  if (!b) return '—';
  const tb = b/1e12;
  if (tb >= 1) return tb.toFixed(2)+' TB';
  return Math.round(b/1e9)+' GB';
}

function showStorDrawer(card) {
  const d = JSON.parse(card.getAttribute('data-stor'));
  _storDrawerData = d;
  const closeBtn = `<button onclick="closeStorDrawer()" aria-label="Close" class="hd-close">${_laIcons.x.replace('width="14"','width="16"').replace('height="14"','height="16"')}</button>`;
  let html = '';

  if (d.kind === 'ceph-pool') {
    const title = 'Pool Details';
    const pct = +d.percent || 0;
    const barColor = pct > 90 ? '#EF4444' : pct > 75 ? '#F59E0B' : 'var(--c-accent)';
    const statusRaw = (d.status||'').toLowerCase();
    const statusOk = !statusRaw || statusRaw === 'normal' || statusRaw === 'active';
    const statusFg = statusOk ? '#16A34A' : '#F59E0B';
    const statusBg = statusOk ? 'rgba(34,197,94,.15)' : 'rgba(245,158,11,.15)';
    const statusLbl = d.status ? (d.status.charAt(0).toUpperCase() + d.status.slice(1)) : 'Active';
    const statusBadge = `<span style="display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;font-size:12px;font-weight:600;color:${statusFg};background:${statusBg};border:1px solid transparent">${statusLbl}</span>`;
    const headerBar = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <span style="font-size:16px;font-weight:600;color:var(--c-text)">${title}</span>
      <span style="margin-left:auto">${statusBadge}</span>${closeBtn}
    </div>`;
    const free = Math.max(0, (d.total_gb||0) - (d.used_gb||0));
    const hero = `<div class="sd-card" style="display:flex;align-items:center;gap:12px">
      <span style="width:42px;height:42px;border-radius:8px;background:rgba(var(--c-accent-rgb),.12);color:var(--c-accent);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${_STOR_IC.vol.replace('width="13"','width="20"').replace('height="13"','height="20"')}</span>
      <div style="min-width:0;flex:1">
        <div style="font-size:15px;font-weight:600;color:var(--c-text);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name||'?'}</div>
        <div style="font-size:13px;color:var(--c-muted);margin-top:3px">${_storFmtGB(d.used_gb)} of ${_storFmtGB(d.total_gb)} used</div>
      </div>
    </div>`;
    const bar = `<div class="sd-card">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--c-muted);margin-bottom:6px"><span style="color:${barColor};font-weight:600">${pct.toFixed(1)}% used</span><span>${_storFmtGB(free)} free</span></div>
      <div style="width:100%;height:8px;background:var(--c-hover);border-radius:4px;overflow:hidden"><div style="width:${Math.min(100,pct)}%;height:100%;background:${barColor};border-radius:4px;transition:width .3s"></div></div>
    </div>`;
    const capBody = [
      _sdRow('Total', _storFmtGB(d.total_gb)),
      _sdRow('Used',  `${_storFmtGB(d.used_gb)} <span style="color:var(--c-muted);margin-left:4px">(${pct.toFixed(1)}%)</span>`),
      _sdRow('Free',  _storFmtGB(free)),
      d.replicas ? _sdRow('Replicas', `×${d.replicas}`) : '',
    ].filter(Boolean).join('');
    html = headerBar + hero + bar + _sdSection(_STOR_IC.vol, 'Capacity', '', capBody);
  } else if (d.kind === 'ceph-osd') {
    const cls = (d.device_class||'').toLowerCase();
    const isSsd = cls === 'ssd' || cls === 'nvme';
    const typeIcon = isSsd ? _STOR_IC.ssd : _STOR_IC.hdd;
    const up = d.status === 'up';
    const inCl = d.in_state === 1;
    const stateText = up ? (inCl ? 'Up · In' : 'Up · Out') : 'Down';
    const stateFg = (up && inCl) ? '#16A34A' : up ? '#CA8A04' : '#EF4444';
    const stateBg = (up && inCl) ? 'rgba(34,197,94,.15)' : up ? 'rgba(234,179,8,.15)' : 'rgba(239,68,68,.15)';
    const stateBadge = `<span style="display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;font-size:12px;font-weight:600;color:${stateFg};background:${stateBg};border:1px solid transparent">${stateText}</span>`;
    const headerBar = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <span style="font-size:16px;font-weight:600;color:var(--c-text)">OSD Details</span>
      <span style="margin-left:auto">${stateBadge}</span>${closeBtn}
    </div>`;
    const hero = `<div class="sd-card" style="display:flex;align-items:center;gap:12px">
      <span style="width:42px;height:42px;border-radius:8px;background:rgba(var(--c-accent-rgb),.12);color:var(--c-accent);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${typeIcon.replace('width="13"','width="18"').replace('height="13"','height="18"')}</span>
      <div style="min-width:0;flex:1">
        <div style="font-size:15px;font-weight:600;color:var(--c-text);line-height:1.2">${d.name||('osd.'+d.id)} <span style="color:var(--c-muted);font-weight:normal">· ${cls ? cls.toUpperCase() : (isSsd?'SSD':'HDD')}</span></div>
        <div style="font-size:13px;color:var(--c-muted);margin-top:3px">${d.host||'—'}</div>
      </div>
    </div>`;
    const pct = d.used_percent != null ? +d.used_percent : (d.size_bytes ? d.used_bytes/d.size_bytes*100 : 0);
    const barColor = pct > 90 ? '#EF4444' : pct > 75 ? '#F59E0B' : 'var(--c-accent)';
    const free = Math.max(0, (d.size_bytes||0) - (d.used_bytes||0));
    const bar = `<div class="sd-card">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--c-muted);margin-bottom:6px"><span style="color:${barColor};font-weight:600">${pct.toFixed(1)}% used</span><span>${_storFmtBytes(free)} free</span></div>
      <div style="width:100%;height:8px;background:var(--c-hover);border-radius:4px;overflow:hidden"><div style="width:${Math.min(100,pct)}%;height:100%;background:${barColor};border-radius:4px;transition:width .3s"></div></div>
    </div>`;
    const idBody = [
      _sdRow('OSD ID',       d.id!=null ? `osd.${d.id}` : ''),
      _sdRow('Name',         d.name),
      _sdRow('Host',         d.host),
      _sdRow('Device class', cls ? cls.toUpperCase() : ''),
      _sdRow('PGs',          d.pgs ? String(d.pgs) : ''),
    ].filter(Boolean).join('');
    const tempC = d.temp > 50 ? '#EF4444' : d.temp > 42 ? '#F59E0B' : 'var(--c-accent)';
    const healthBody = [
      _sdRow('State',       `<span style="color:${stateFg}">${stateText}</span>`),
      _sdRow('Temperature', d.temp!=null ? `<span style="color:${tempC};font-weight:600">${d.temp}°C</span>` : ''),
    ].filter(Boolean).join('');
    const capBody = [
      _sdRow('Total', _storFmtBytes(d.size_bytes)),
      _sdRow('Used',  `${_storFmtBytes(d.used_bytes)} <span style="color:var(--c-muted);margin-left:4px">(${pct.toFixed(1)}%)</span>`),
      _sdRow('Free',  _storFmtBytes(free)),
    ].filter(Boolean).join('');
    html = headerBar + hero + bar
         + _sdSection(_STOR_IC.drive, 'Identity', '', idBody)
         + _sdSection(_STOR_IC.shield, 'Health', '', healthBody)
         + _sdSection(_STOR_IC.vol, 'Capacity', '', capBody);
  } else if (d.kind === 'pxstor') {
    // Proxmox storage cell (Storage page group cards): identity, capacity,
    // placement, per-node breakdown for local stores, and a 7-day usage chart.
    // d.focus says WHICH cell opened the drawer ({what:'node',…} from a node
    // cell/chip, {what:'content',…} from a content cell) — the header, hero
    // and leading section reflect it instead of a one-size-fits-all view.
    const focus = d.focus || null;
    const fNode = focus && focus.what === 'node' ? focus : null;
    const fCls  = focus && focus.what === 'content' ? focus : null;
    const fVol  = focus && focus.what === 'volume' ? focus : null;
    const clsLabels0 = { images:'Disk images', backup:'Backups', iso:'ISOs',
      vztmpl:'Templates', rootdir:'Containers', snippets:'Snippets', import:'Imports' };
    const avail = ((fNode ? fNode.status : d.status) || 'available') === 'available';
    const statusFg = avail ? '#16A34A' : '#EF4444';
    const statusBg = avail ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)';
    const statusBadge = `<span style="display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;font-size:12px;font-weight:600;color:${statusFg};background:${statusBg};border:1px solid transparent">${esc((fNode ? fNode.status : d.status) || 'available')}</span>`;
    const title = fNode ? 'Storage on Node' : fCls ? 'Storage Content' : fVol ? 'Volume Details' : 'Storage Details';
    const headerBar = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <span style="font-size:16px;font-weight:600;color:var(--c-text)">${title}</span>
      <span style="margin-left:auto">${statusBadge}</span>${closeBtn}
    </div>`;
    const pct = d.maxdisk ? (d.disk / d.maxdisk * 100) : 0;
    const barColor = pct > 90 ? '#EF4444' : pct > 75 ? '#F59E0B' : 'var(--c-accent)';
    const free = Math.max(0, (d.maxdisk || 0) - (d.disk || 0));
    const heroSub = fNode
      ? `on ${esc(fNode.node)} · ${esc(d.type || 'storage')} · ${d.shared ? 'shared' : 'local'}`
      : fCls
      ? `${esc(clsLabels0[fCls.cls] || fCls.cls)} · ${esc(d.type || 'storage')}`
      : fVol
      ? `${fVol.guest ? esc(fVol.guest) + ' · ' : ''}on ${esc(d.name)} · ${esc(clsLabels0[fVol.cls] || fVol.cls || 'volume')}`
      : `${esc(d.type || 'storage')} · ${d.shared ? 'shared' : 'local'}`;
    const heroName = fVol ? (String(fVol.volid||'').split('/').pop() || d.name) : (d.name || '?');
    const hero = `<div class="sd-card" style="display:flex;align-items:center;gap:12px">
      <span style="width:42px;height:42px;border-radius:8px;background:rgba(var(--c-accent-rgb),.12);color:var(--c-accent);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${_STOR_IC.drive.replace('width="13"','width="20"').replace('height="13"','height="20"')}</span>
      <div style="min-width:0;flex:1">
        <div style="font-size:15px;font-weight:600;color:var(--c-text);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(heroName)}</div>
        <div style="font-size:13px;color:var(--c-muted);margin-top:3px">${heroSub}</div>
      </div>
    </div>`;
    // Focused leading section — the clicked node's own view of the store, or
    // the clicked content class's summary. Rendered right after the hero.
    let focusSection = '';
    if (fNode) {
      const np = fNode.maxdisk ? (fNode.disk / fNode.maxdisk * 100) : 0;
      const nodeBody = [
        _sdRow('Node',   esc(fNode.node)),
        _sdRow('Status', `<span style="color:${statusFg};text-transform:capitalize">${esc(fNode.status || 'available')}</span>`),
        _sdRow('Used',   fNode.maxdisk ? `${_storFmtBytes(fNode.disk)} / ${_storFmtBytes(fNode.maxdisk)} <span style="color:var(--c-muted);margin-left:4px">(${np.toFixed(1)}%)</span>` : '—'),
      ].filter(Boolean).join('');
      focusSection = _sdSection(_STOR_IC.hdd, `On ${esc(fNode.node)}`, '', nodeBody);
    } else if (fCls) {
      const clsBody = [
        _sdRow('Type',  esc(clsLabels0[fCls.cls] || fCls.cls)),
        _sdRow('Items', String(fCls.count || 0)),
        _sdRow('Size',  fCls.bytes ? _storFmtBytes(fCls.bytes) : '—'),
      ].filter(Boolean).join('');
      focusSection = _sdSection(_STOR_IC.vol, clsLabels0[fCls.cls] || fCls.cls, '', clsBody);
    } else if (fVol) {
      const volBody = [
        _sdRow('Volume', `<span class="mono" style="font-size:10px;overflow-wrap:anywhere">${esc(fVol.volid)}</span>`),
        fVol.guest ? _sdRow('Guest', `${esc(fVol.guest)} <span style="color:var(--c-muted);margin-left:4px">· #${fVol.vmid}</span>`)
                   : (fVol.vmid != null ? _sdRow('Guest', '#' + fVol.vmid) : ''),
        fVol.physSize != null
          ? _sdRow('Size', `≈${_storFmtBytes(fVol.physSize)} <span style="color:var(--c-muted)">physical · ${_storFmtBytes(fVol.size)} logical</span>`)
          : _sdRow('Size', _storFmtBytes(fVol.size)),
        fVol.format ? _sdRow('Format', esc(fVol.format)) : '',
        fVol.cls ? _sdRow('Class', esc(clsLabels0[fVol.cls] || fVol.cls)) : '',
        fVol.when ? _sdRow('Created', esc(fVol.when)) : '',
        _sdRow('Share of store', d.maxdisk ? ((fVol.physSize != null ? fVol.physSize : fVol.size) / d.maxdisk * 100).toFixed(1) + '%'
          + ` <span style="color:var(--c-muted);margin-left:4px">of ${_storFmtBytes(d.maxdisk)}</span>` : '—'),
      ].filter(Boolean).join('');
      focusSection = _sdSection(_STOR_IC.vol, 'This volume', '', volBody);
    }
    const bar = `<div class="sd-card">
      <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--c-muted);margin-bottom:6px"><span style="color:${barColor};font-weight:600">${pct.toFixed(1)}% used</span><span>${_storFmtBytes(free)} free</span></div>
      <div style="width:100%;height:8px;background:var(--c-hover);border-radius:4px;overflow:hidden"><div style="width:${Math.min(100,pct)}%;height:100%;background:${barColor};border-radius:4px;transition:width .3s"></div></div>
    </div>`;
    const capBody = [
      _sdRow('Total', _storFmtBytes(d.maxdisk)),
      _sdRow('Used',  `${_storFmtBytes(d.disk)} <span style="color:var(--c-muted);margin-left:4px">(${pct.toFixed(1)}%)</span>`),
      _sdRow('Free',  _storFmtBytes(free)),
    ].filter(Boolean).join('');
    const placeBody = [
      _sdRow('Type',  d.type || 'storage'),
      _sdRow('Scope', d.shared ? 'Shared (cluster-wide)' : 'Local (per node)'),
      _sdRow('Nodes', (d.nodes || []).join(', ')),
      _sdRow('Content', (d.content || []).join(', ')),
    ].filter(Boolean).join('');
    const perNode = (d.per_node || []).map(r => {
      const p = r.maxdisk ? Math.round((r.disk || 0) / r.maxdisk * 100) : 0;
      return _sdRow(r.node, `${_storFmtBytes(r.disk)} / ${_storFmtBytes(r.maxdisk)} <span style="color:var(--c-muted);margin-left:4px">(${p}%)</span>`);
    }).join('');
    // Content inventory: class rows + the largest volumes on this store. When
    // a content cell opened the drawer, the volume list narrows to that class.
    const contentBody = Object.entries(d.content_classes || {}).sort()
      .map(([cls, c]) => _sdRow(clsLabels0[cls] || cls,
        `${c.count} <span style="color:var(--c-muted);margin-left:4px">${c.bytes ? '· ' + _storFmtBytes(c.bytes) : ''}</span>`))
      .join('');
    const topVols = (d.top_volumes || []).filter(v => !fCls || v.content === fCls.cls);
    const topBody = topVols.slice(0, 6).map(v => {
      const name = String(v.volid || '').split('/').pop() || v.volid;
      return _sdRow(`<span style="font-size:10px;font-family:ui-monospace,monospace;overflow-wrap:anywhere">${esc(name)}</span>`,
        `${_storFmtBytes(v.size)}${v.vmid ? ` <span style="color:var(--c-muted);margin-left:4px">· #${v.vmid}</span>` : ''}`);
    }).join('');
    const topTitle = fCls ? `Largest ${(clsLabels0[fCls.cls] || fCls.cls).toLowerCase()}` : 'Largest volumes';
    const histSection = `<div class="sd-card">
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
        <span class="eyebrow">Usage — last 7 days</span>
      </div>
      <div style="position:relative;height:140px"><canvas id="chart-stor-drawer"></canvas></div>
    </div>`;
    html = headerBar + hero + bar
         + focusSection
         + _sdSection(_STOR_IC.vol, 'Capacity', '', capBody)
         + _sdSection(_STOR_IC.drive, 'Placement', '', placeBody)
         + (perNode && !fNode ? _sdSection(_STOR_IC.hdd, 'Per node', '', perNode) : '')
         + (contentBody && !fCls ? _sdSection(_STOR_IC.vol, 'Content', '', contentBody) : '')
         + (topBody ? _sdSection(_STOR_IC.ssd, topTitle, '', topBody) : '')
         + histSection;
    setTimeout(() => _pxstorDrawerChart(d.name), 30);
  } else if (d.kind === 'pxdrive') {
    // Physical disk behind a ZFS/LVM store (Storage page DRIVES cells):
    // identity + SMART health + where it's used. Data from /nodes/…/disks/list.
    const healthOk = !d.health || /^(passed|ok|unknown)$/i.test(d.health);
    const hFg = healthOk ? '#16A34A' : '#EF4444';
    const hBg = healthOk ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)';
    const healthBadge = `<span style="display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;font-size:12px;font-weight:600;color:${hFg};background:${hBg};border:1px solid transparent;text-transform:capitalize">${esc(d.health || 'unknown')}</span>`;
    const isSsd = d.type === 'ssd' || d.type === 'nvme';
    const typeIcon = isSsd ? _STOR_IC.ssd : _STOR_IC.hdd;
    const headerBar = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <span style="font-size:16px;font-weight:600;color:var(--c-text)">Drive Details</span>
      <span style="margin-left:auto">${healthBadge}</span>${closeBtn}
    </div>`;
    const hero = `<div class="sd-card" style="display:flex;align-items:center;gap:12px">
      <span style="width:42px;height:42px;border-radius:8px;background:rgba(var(--c-accent-rgb),.12);color:var(--c-accent);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${typeIcon.replace('width="13"','width="18"').replace('height="13"','height="18"')}</span>
      <div style="min-width:0;flex:1">
        <div style="font-size:15px;font-weight:600;color:var(--c-text);line-height:1.2">${escText(String(d.devpath||'').replace('/dev/','') || '?')} <span style="color:var(--c-muted);font-weight:normal">· ${escText((d.type||'disk').toUpperCase())}</span></div>
        <div style="font-size:13px;color:var(--c-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.model || '—')}</div>
        <div style="font-size:12px;color:var(--c-muted);margin-top:1px">on ${esc(d.node || '—')}</div>
      </div>
    </div>`;
    const idBody = [
      _sdRow('Model',  esc(d.model)),
      _sdRow('Vendor', esc(d.vendor)),
      _sdRow('Serial', d.serial ? `<span class="mono">${esc(d.serial)}</span>` : ''),
      _sdRow('Device', d.devpath ? `<span class="mono">${esc(d.devpath)}</span>` : ''),
      _sdRow('Type',   `${escText((d.type||'disk').toUpperCase())}${d.rpm ? ' · ' + escText(d.rpm) + ' rpm' : ''}`),
      _sdRow('Size',   _storFmtBytes(d.size)),
    ].filter(Boolean).join('');
    const healthBody = [
      _sdRow('SMART', `<span style="color:${hFg};text-transform:capitalize">${esc(d.health || 'unknown')}</span>`),
      d.wearout != null ? _sdRow('Life remaining', `<span style="color:${d.wearout < 20 ? '#EF4444' : d.wearout < 40 ? '#F59E0B' : '#16A34A'};font-weight:600">${esc(String(d.wearout))}%</span>`) : '',
      d.temp != null ? _sdRow('Temperature', `<span style="color:${d.temp > 50 ? '#EF4444' : d.temp > 42 ? '#F59E0B' : 'var(--c-text)'};font-weight:600">${d.temp}°C</span>`) : '',
      d.osd_state ? _sdRow('Ceph OSD', `${esc(d.osd_name || '')} · ${esc(d.osd_state)}`) : '',
    ].filter(Boolean).join('');
    const useBody = [
      _sdRow('Backs storage', esc(d.storage)),
      _sdRow('Node',          esc(d.node)),
      _sdRow('Used as',       esc(d.used)),
    ].filter(Boolean).join('');
    html = headerBar + hero
         + _sdSection(_STOR_IC.drive, 'Identity', '', idBody)
         + _sdSection(_STOR_IC.shield, 'Health', '', healthBody)
         + _sdSection(_STOR_IC.vol, 'Usage', '', useBody);
  } else {
    return;
  }

  el('stor-drawer-body').innerHTML = html;
  el('stor-drawer-overlay').style.display = 'block';
  el('stor-drawer').classList.add('open');
}

function closeStorDrawer() {
  el('stor-drawer').classList.remove('open');
  el('stor-drawer-overlay').style.display = 'none';
}

// 7-day usage-% chart inside the storage drawer (async after the drawer opens).
async function _pxstorDrawerChart(name){
  try {
    const d = await _swrJSON('/api/history/storage?hours=168', () => {});
    const subs = ((d && d.series) || []).filter(s => s.storage === name);
    if (!subs.length || !el('chart-stor-drawer')) return;
    const m = {};
    subs.forEach(s => s.labels.forEach((t, i) => {
      const a = m[t] = m[t] || [0, 0];
      a[0] += s.disk[i] || 0; a[1] += s.maxdisk[i] || 0;
    }));
    const ts = Object.keys(m).map(Number).sort((a, b) => a - b);
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    const pts = ts.map(t => ({ x: t * 1000, y: m[t][1] > 0 ? Math.round(m[t][0] / m[t][1] * 1000) / 10 : null }));
    _makeChart('chart-stor-drawer', [{ label: name, data: pts, borderColor: acc,
      backgroundColor: _chartGradient(acc), borderWidth: 2, pointRadius: 0, pointHoverRadius: 3,
      tension: 0.3, fill: true, spanGaps: true }], v => Math.round(v) + '%', 168,
      { yMin: 0, yMax: 100, noLegend: true });
  } catch(e){ console.warn('stor drawer chart:', e); }
}

// ── Container / VM detail drawer ────────────────────────────────────────────
// Same chrome as the storage drawer. Renders client-side from the guest
// fields already in /cluster/resources (status, cpu/cores, mem, disk, I/O,
// net, uptime, tags, pool, HA) — no extra backend call. Opened from the
// VM/LXC entity cards (data embedded via _entityCard's `data` option).
let _guestDrawerData = null;
const _VM_IC = {
  server: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
  box:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
  cpu:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
  net:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  info:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  globe:  '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
};
function _gdBar(label, pct, valHtml, clr) {
  // Match the standard entity-card bar (20-proxmox.js): --c-bar-bg track well,
  // pill radius, gradient fill via _barFill, tabular value in the bar color.
  const w = Math.min(Math.max(pct || 0, 0), 100).toFixed(1);
  const fill = (typeof _barFill === 'function') ? _barFill(clr) : clr;
  return `<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;color:var(--c-muted);margin-bottom:6px"><span>${label}</span><span style="color:${clr};font-weight:700;font-variant-numeric:tabular-nums">${valHtml}</span></div>
    <div style="width:100%;height:6px;background:var(--c-bar-bg);border-radius:9999px;overflow:hidden"><div style="width:${w}%;height:100%;background:${fill};border-radius:9999px;transition:width .3s"></div></div>`;
}
function _gdTags(tags) {
  return String(tags).split(/[;, ]+/).filter(Boolean).map(t =>
    `<span style="display:inline-block;background:var(--c-hover);border:1px solid var(--c-border);border-radius:4px;padding:1px 6px;font-size:11px;margin-left:4px">${esc(t)}</span>`).join('');
}
// Network detail rows for a drawer — live rate + config pulled from the current
// snapshot's network view (guest_rates / traffic / per-guest NICs), so the
// Network page's drawer actually carries network info, not just CPU/RAM.
function _gdNetInfo(kind, d) {
  const net = (window._lastData && window._lastData.proxmox && window._lastData.proxmox.network) || {};
  const rows = [];
  if (kind === 'node') {
    const t = (net.traffic || {})[d.node] || {};
    if (d.ip) rows.push(_sdRow('IP address', `<span class="mono">${esc(d.ip)}</span>`));
    rows.push(_sdRow('Throughput in', `<span style="color:#22C55E;font-weight:600">${_netRate(t.in || 0)}</span>`));
    rows.push(_sdRow('Throughput out', `<span style="color:var(--c-accent);font-weight:600">${_netRate(t.out || 0)}</span>`));
    const bridges = ((net.nodes || {})[d.node] || []).filter(i => i.type === 'bridge').map(i => i.iface);
    if (bridges.length) rows.push(_sdRow('Bridges', bridges.map(esc).join(', ')));
  } else if (kind === 'guest') {
    const r = (net.guest_rates || {})[String(d.vmid)] || {};
    if (d.ip) rows.push(_sdRow('IP address', `<span class="mono">${esc(d.ip)}</span>`));
    rows.push(_sdRow('Rate in', `<span style="color:#22C55E;font-weight:600">${_netRate(r.in || 0)}</span>`));
    rows.push(_sdRow('Rate out', `<span style="color:var(--c-accent);font-weight:600">${_netRate(r.out || 0)}</span>`));
    if (d.netin != null) rows.push(_sdRow('Total in', fmtBytes(d.netin)));
    if (d.netout != null) rows.push(_sdRow('Total out', fmtBytes(d.netout)));
    (net.guests || []).filter(n => String(n.vmid) === String(d.vmid)).forEach(n => {
      const parts = [];
      if (n.bridge) parts.push(esc(n.bridge));
      if (n.tag != null && n.tag !== '') parts.push('VLAN ' + esc(String(n.tag)));
      if (n.hwaddr) parts.push(`<span class="mono" style="font-size:10px">${esc(n.hwaddr)}</span>`);
      rows.push(_sdRow(esc(n.dev || 'net'), parts.join(' · ') || '—'));
    });
  }
  return rows.filter(Boolean).join('');
}
// Unified detail drawer for guests (VM/LXC) and Proxmox hosts (kind:'node').
// Both share the chrome + CPU/RAM history graph. The data is embedded per card.
function showGuestDrawer(card) {
  const d = JSON.parse(card.getAttribute('data-entity'));
  _guestDrawerData = d;
  const kind = d.kind || 'guest';
  const closeBtn = `<button onclick="closeGuestDrawer()" aria-label="Close" class="hd-close">${_laIcons.x.replace('width="14"','width="16"').replace('height="14"','height="16"')}</button>`;
  const badge = (lbl, fg, bg) => `<span style="display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;font-size:12px;font-weight:600;color:${fg};background:${bg};border:1px solid transparent">${lbl}</span>`;

  let title, typeIcon, heroName, heroSub, statusBadge, running = false;
  let bars = '', idBody = '', resBody = '', actBody = '', footer = '';
  let histKind = null, histId = null, histNode = null;

  if (kind === 'node') {
    running = d.status === 'online';
    const fg = running ? '#16A34A' : '#EF4444';
    statusBadge = badge(running ? 'Online' : 'Offline', fg, running ? 'rgba(34,197,94,.15)' : 'rgba(239,68,68,.15)');
    title = 'Host Details'; typeIcon = _VM_IC.server;
    heroName = d.node; heroSub = 'Proxmox host' + (d.maxcpu ? ' · ' + d.maxcpu + ' cores' : '');
    const cpuPct = (d.cpu || 0) * 100, memPct = d.maxmem ? d.mem / d.maxmem * 100 : 0, diskPct = d.maxdisk ? d.disk / d.maxdisk * 100 : 0;
    if (running) {
      bars = `<div class="sd-card">`
        + _gdBar('CPU', cpuPct, cpuPct.toFixed(1) + '%' + (d.maxcpu ? ` <span style="color:var(--c-muted);font-weight:400">· ${d.maxcpu} cores</span>` : ''), barHex(cpuPct))
        + (d.maxmem ? '<div style="height:12px"></div>' + _gdBar('Memory', memPct, `${fmtBytes(d.mem)} <span style="color:var(--c-muted);font-weight:400">/ ${fmtBytes(d.maxmem)}</span>`, barHex(memPct)) : '')
        + (d.maxdisk ? '<div style="height:12px"></div>' + _gdBar('Disk', diskPct, `${fmtBytes(d.disk)} <span style="color:var(--c-muted);font-weight:400">/ ${fmtBytes(d.maxdisk)}</span>`, barHex(diskPct)) : '')
        + `</div>`;
    }
    idBody = [
      _sdRow('Node', d.node),
      _sdRow('Status', `<span style="color:${fg};text-transform:capitalize">${d.status || '?'}</span>`),
      _sdRow('CPU cores', d.maxcpu ? String(d.maxcpu) : ''),
    ].filter(Boolean).join('');
    resBody = [
      running ? _sdRow('CPU usage', cpuPct.toFixed(1) + '%') : '',
      d.maxmem ? _sdRow('Memory', `${fmtBytes(d.mem)} / ${fmtBytes(d.maxmem)} <span style="color:var(--c-muted)">(${memPct.toFixed(1)}%)</span>`) : '',
      d.maxdisk ? _sdRow('Disk', `${fmtBytes(d.disk)} / ${fmtBytes(d.maxdisk)} <span style="color:var(--c-muted)">(${diskPct.toFixed(1)}%)</span>`) : '',
    ].filter(Boolean).join('');
    actBody = (running && d.uptime) ? _sdRow('Uptime', fmtUptime(d.uptime)) : '';
    const proxBase = safeHttpUrl(d.web_url);
    if (proxBase) {
      const proxHref = proxBase.replace(/\/+$/,'') + '/#v1:0:=node%2F' + encodeURIComponent(d.node || '');
      footer = `<a href="${escAttr(proxHref)}" target="_blank" rel="noopener" class="sd-card" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--c-accent);font-size:13px;font-weight:600;margin-top:16px">Open in Proxmox ↗</a>`;
    }
    histKind = 'node'; histId = d.node; histNode = d.node;

  } else { // guest (vm / lxc)
    const isLxc = d.type === 'lxc';
    running = d.status === 'running'; const paused = d.status === 'paused';
    const fg = running ? '#16A34A' : paused ? '#CA8A04' : 'var(--c-muted)';
    statusBadge = badge(running ? 'Running' : paused ? 'Paused' : 'Stopped', fg, running ? 'rgba(34,197,94,.15)' : paused ? 'rgba(245,158,11,.15)' : 'var(--c-hover)');
    title = isLxc ? 'Container Details' : 'VM Details'; typeIcon = isLxc ? _VM_IC.box : _VM_IC.server;
    heroName = d.name || ('#' + d.vmid); heroSub = `${isLxc ? 'LXC' : 'QEMU'} · #${d.vmid} · ${esc(d.node || '')}`;
    if (running) {
      const cpuPct = (d.cpu || 0) * 100;
      bars = `<div class="sd-card">` + _gdBar('CPU', cpuPct, cpuPct.toFixed(1) + '%' + (d.maxcpu ? ` <span style="color:var(--c-muted);font-weight:400">of ${d.maxcpu} vCPU</span>` : ''), barHex(cpuPct))
        + (d.maxmem ? '<div style="height:12px"></div>' + _gdBar('Memory', d.mem / d.maxmem * 100, `${fmtBytes(d.mem)} <span style="color:var(--c-muted);font-weight:400">/ ${fmtBytes(d.maxmem)}</span>`, barHex(d.mem / d.maxmem * 100)) : '')
        + ((d.disk && d.maxdisk) ? '<div style="height:12px"></div>' + _gdBar('Disk', d.disk / d.maxdisk * 100, `${fmtBytes(d.disk)} <span style="color:var(--c-muted);font-weight:400">/ ${fmtBytes(d.maxdisk)}</span>`, barHex(d.disk / d.maxdisk * 100)) : '')
        + `</div>`;
    }
    idBody = [
      _sdRow('Type', isLxc ? 'LXC container' : 'QEMU virtual machine'),
      _sdRow('VMID', `<span class="mono">${d.vmid}</span>`),
      _sdRow('Node', d.node),
      _sdRow('Status', `<span style="color:${fg};text-transform:capitalize">${d.status || '?'}</span>`),
      _sdRow('Pool', d.pool),
      d.template ? _sdRow('Template', 'Yes') : '',
      d.lock ? _sdRow('Lock', `<span style="color:#F59E0B">${esc(d.lock)}</span>`) : '',
      d.hastate ? _sdRow('HA state', esc(d.hastate)) : '',
      d.tags ? _sdRow('Tags', _gdTags(d.tags)) : '',
    ].filter(Boolean).join('');
    resBody = [
      _sdRow('vCPUs', d.maxcpu ? String(d.maxcpu) : ''),
      running ? _sdRow('CPU usage', `${((d.cpu || 0) * 100).toFixed(1)}%`) : '',
      _sdRow('Memory max', d.maxmem ? fmtBytes(d.maxmem) : ''),
      (running && d.maxmem) ? _sdRow('Memory used', `${fmtBytes(d.mem)} <span style="color:var(--c-muted)">(${(d.mem / d.maxmem * 100).toFixed(1)}%)</span>`) : '',
      _sdRow('Disk allocated', d.maxdisk ? fmtBytes(d.maxdisk) : ''),
      d.disk ? _sdRow('Disk used', fmtBytes(d.disk)) : '',
    ].filter(Boolean).join('');
    actBody = running ? [
      _sdRow('Uptime', d.uptime ? fmtUptime(d.uptime) : ''),
      _sdRow('Disk read', d.diskread != null ? fmtBytes(d.diskread) : ''),
      _sdRow('Disk write', d.diskwrite != null ? fmtBytes(d.diskwrite) : ''),
    ].filter(Boolean).join('') : '';
    const proxBase = safeHttpUrl(d.web_url);
    if (proxBase) {
      const proxHref = proxBase.replace(/\/+$/,'') + '/#v1:0:=' + (isLxc ? 'lxc' : 'qemu') + '%2F' + encodeURIComponent(d.vmid == null ? '' : d.vmid);
      footer = `<a href="${escAttr(proxHref)}" target="_blank" rel="noopener" class="sd-card" style="display:flex;align-items:center;justify-content:center;gap:6px;text-decoration:none;color:var(--c-accent);font-size:13px;font-weight:600;margin-top:16px">Open in Proxmox ↗</a>`;
    }
    histKind = 'guest'; histId = d.vmid;
  }

  const headerBar = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
    <span style="font-size:16px;font-weight:600;color:var(--c-text)">${title}</span>
    <span style="margin-left:auto">${statusBadge}</span>${closeBtn}
  </div>`;
  const hero = `<div class="sd-card" style="display:flex;align-items:center;gap:12px">
    <span style="width:42px;height:42px;border-radius:8px;background:rgba(var(--c-accent-rgb),.12);color:var(--c-accent);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${typeIcon.replace('width="13"','width="20"').replace('height="13"','height="20"')}</span>
    <div style="min-width:0;flex:1">
      <div style="font-size:15px;font-weight:600;color:var(--c-text);line-height:1.2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(heroName)}</div>
      <div style="font-size:13px;color:var(--c-muted);margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${heroSub}</div>
    </div>
  </div>`;
  // CPU/RAM history graph (24h) — shown for running entities + all hosts.
  const showHist = running || kind === 'node';
  const histBlock = showHist ? `<div class="sd-card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted)">CPU &amp; Memory · 24h</span>
      <div style="margin-left:auto;display:flex;gap:10px;font-size:10px;color:var(--c-muted)">
        <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:2px;border-radius:1px;background:var(--c-accent)"></span>CPU</span>
        <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:2px;border-radius:1px;background:#22C55E"></span>RAM</span>
      </div>
    </div>
    <div style="position:relative;height:120px"><canvas id="chart-drawer-hist"></canvas></div>
    <div id="drawer-hist-note" style="font-size:10px;color:var(--c-muted);text-align:center;margin-top:4px"></div>
  </div>` : '';
  // Network throughput graph (24h) — in/out bytes/sec. Guests read
  // /api/history/guest_net, nodes /api/history/proxmox_net. Colours match the
  // Network page (In green, Out accent).
  const showNet = (running && kind === 'guest') || kind === 'node';
  const netBlock = showNet ? `<div class="sd-card">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--c-muted)">Network · 24h</span>
      <div style="margin-left:auto;display:flex;gap:10px;font-size:10px;color:var(--c-muted)">
        <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:2px;border-radius:1px;background:#22C55E"></span>In</span>
        <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:14px;height:2px;border-radius:1px;background:var(--c-accent)"></span>Out</span>
      </div>
    </div>
    <div style="position:relative;height:120px"><canvas id="chart-drawer-net"></canvas></div>
    <div id="drawer-net-note" style="font-size:10px;color:var(--c-muted);text-align:center;margin-top:4px"></div>
  </div>` : '';
  const netBody = _gdNetInfo(kind, d);

  el('vm-drawer-body').innerHTML = headerBar + hero + bars + histBlock + netBlock
    + (idBody ? _sdSection(_VM_IC.info, 'Identity', '', idBody) : '')
    + (resBody ? _sdSection(_VM_IC.cpu, 'Resources', '', resBody) : '')
    + (netBody ? _sdSection(_VM_IC.globe, 'Network', '', netBody) : '')
    + (actBody ? _sdSection(_VM_IC.net, 'Activity', '', actBody) : '')
    + footer;
  el('vm-drawer-overlay').style.display = 'block';
  el('vm-drawer').classList.add('open');
  if (showHist) _loadDrawerHist(histKind, histId, histNode);
  if (showNet) _loadDrawerNet(histKind, histId, histNode);
}
// CPU/RAM history for the drawer graph. Nodes read /api/history/proxmox;
// guests read /api/history/entity (downsampled, fills over time).
async function _loadDrawerHist(kind, id, node) {
  const cid = 'chart-drawer-hist';
  const hrs = 24;
  try {
    let labels = [], cpu = [], mem = [];
    if (kind === 'node') {
      const d = await _swrJSON(`/api/history/proxmox?hours=${hrs}`, () => _loadDrawerHist(kind, id, node));
      const n = (d.nodes || {})[node || id];
      if (n) { labels = n.labels || []; cpu = n.cpu || []; mem = n.mem || []; }
    } else {
      const d = await _swrJSON(`/api/history/entity?kind=${kind}&id=${encodeURIComponent(id)}&hours=${hrs}`, () => _loadDrawerHist(kind, id, node));
      labels = d.labels || []; cpu = d.cpu || []; mem = d.mem || [];
    }
    if (!el(cid)) return;
    const note = el('drawer-hist-note');
    if (!labels.length) { if (note) note.textContent = 'History fills as data is collected.'; return; }
    if (note) note.textContent = '';
    const bsec = _bucketSec(hrs);
    const cpuB = _bucketStats(labels, cpu, bsec), memB = _bucketStats(labels, mem, bsec);
    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    _makeChart(cid, [
      _dsAvgOnly('CPU', cpuB, _acc, { gradient: true }),
      _dsAvgOnly('RAM', memB, '#22C55E', { gradient: true }),
    ], v => Math.round(v) + '%', hrs, { noLegend: true });
    _wireChartHover(cid);
  } catch(e) { console.warn('drawer hist:', e); }
}
// Network throughput history for the drawer graph (in/out bytes/sec). Nodes read
// /api/history/proxmox_net (per-node); guests read /api/history/guest_net.
async function _loadDrawerNet(kind, id, node) {
  const cid = 'chart-drawer-net';
  const hrs = 24;
  try {
    let labels = [], nin = [], nout = [];
    if (kind === 'node') {
      const d = await _swrJSON(`/api/history/proxmox_net?hours=${hrs}`, () => _loadDrawerNet(kind, id, node));
      const n = (d.nodes || {})[node || id];
      if (n) { labels = n.labels || []; nin = n.in || []; nout = n.out || []; }
    } else {
      const d = await _swrJSON(`/api/history/guest_net?hours=${hrs}`, () => _loadDrawerNet(kind, id, node));
      const g = (d.guests || {})[String(id)];
      if (g) { labels = g.labels || []; nin = g.in || []; nout = g.out || []; }
    }
    if (!el(cid)) return;
    const note = el('drawer-net-note');
    if (!labels.length) { if (note) note.textContent = 'History fills as data is collected.'; return; }
    if (note) note.textContent = '';
    const bsec = _bucketSec(hrs);
    const inB = _bucketStats(labels, nin, bsec), outB = _bucketStats(labels, nout, bsec);
    const _acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    _makeChart(cid, [
      _dsAvgOnly('In', inB, '#22C55E', { gradient: true }),
      _dsAvgOnly('Out', outB, _acc, { gradient: true }),
    ], v => _netRate(v), hrs, { noLegend: true, yMin: 0 });
    _wireChartHover(cid);
  } catch(e) { console.warn('drawer net:', e); }
}
function closeGuestDrawer() {
  el('vm-drawer').classList.remove('open');
  el('vm-drawer-overlay').style.display = 'none';
  if (_charts['chart-drawer-hist']) { _charts['chart-drawer-hist'].destroy(); delete _charts['chart-drawer-hist']; }
  if (_charts['chart-drawer-net']) { _charts['chart-drawer-net'].destroy(); delete _charts['chart-drawer-net']; }
}
// ── Backups (PBS) ─────────────────────────────────────────────────────────
// Filter + sort state for the snapshots table — survives re-renders within
// the session.
window._bk = window._bk || {
  search: '',
  datastore: 'all',           // filter by datastore name
  type: 'all',                // 'all' | 'vm' | 'ct' | 'host'
  orderBy: 'backup_time',     // 'backup_time' | 'size' | 'backup_id'
  orderDir: 'desc',           // 'asc' | 'desc'
};
// Filter / sort changes use _bkUpdateView (partial DOM swap) — they update
// the tbody, header arrows, footer counts, and chip active classes without
// re-rendering the search input or the datastore cards. Calling the full
// renderBackups() on every keystroke is what was making the input lose
// focus per character and the whole page flash on each pill click.
function _bkSetFilter(k, v){ window._bk[k] = v; _bkUpdateView(); }
function _bkSetSort(col){
  const b = window._bk;
  if (b.orderBy === col) b.orderDir = b.orderDir === 'desc' ? 'asc' : 'desc';
  else { b.orderBy = col; b.orderDir = 'desc'; }
  _bkUpdateView();
}
let _bkSearchTimer = null;
function _bkOnSearch(v){
  window._bk.search = v;
  clearTimeout(_bkSearchTimer);
  _bkSearchTimer = setTimeout(_bkUpdateView, 180);
}

function _bkFmtBytes(n){
  if (!n || n <= 0) return '—';
  const units = ['B','KB','MB','GB','TB','PB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
function _bkFmtRelative(t){
  if (!t) return '—';
  const now = Date.now() / 1000;
  const d = now - t;
  if (d < 60)      return 'just now';
  if (d < 3600)    return `${Math.floor(d/60)}m ago`;
  if (d < 86400)   return `${Math.floor(d/3600)}h ago`;
  if (d < 604800)  return `${Math.floor(d/86400)}d ago`;
  if (d < 2592000) return `${Math.floor(d/604800)}w ago`;
  return `${Math.floor(d/2592000)}mo ago`;
}
function _bkFmtAbs(t){
  if (!t) return '—';
  const dt = new Date(t * 1000);
  const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][dt.getMonth()];
  let h = dt.getHours(); const m = dt.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${mo} ${dt.getDate()}, ${dt.getFullYear()} ${h}:${String(m).padStart(2,'0')} ${ap}`;
}

// Backup-type chip — built on the shared .badge token system; each type
// carries its own Lucide icon as a child of the badge.
function _bkTypeBadge(t){
  const map = {
    vm:   { cls:'badge-up',      label:'VM',   svg:'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>' },
    ct:   { cls:'badge-info',    label:'CT',   svg:'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>' },
    host: { cls:'badge-warn',    label:'Host', svg:'<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>' },
  };
  const c = map[t] || { cls:'badge-neutral', label:t||'?', svg:'' };
  return `<span class="badge ${c.cls}" style="gap:4px">${c.svg}${c.label}</span>`;
}

// Verification chip — only shown when a snapshot has a verification record.
function _bkVerifyBadge(state){
  if (!state) return '';
  if (state === 'ok') {
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#16A34A" title="Verified"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Verified</span>`;
  }
  if (state === 'failed') {
    return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:#EF4444" title="Verification failed"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>Failed</span>`;
  }
  return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:11px;color:var(--c-muted)" title="${state}">${state}</span>`;
}

// Snapshots + groups are lazy-loaded via /api/pbs/snapshots — they're not in
// the WS tick payload anymore. Merge the cached detail back in here so the
// rest of renderBackups doesn't have to know.
async function _loadPbsDetail() {
  try {
    window._pbsDetail = await _swrJSON('/api/pbs/snapshots', () => _loadPbsDetail());
    if (currentPage === 'backups') renderBackups(window._pbsLast);
  } catch(e) { console.warn('pbs detail:', e); }
}

// Ledger trend cells: growth GB/day + days-until-full + a 30d usage sparkline
// per datastore, joined to the PVE storage history via px.pbs_storage_map
// (falls back to a same-name match — datastore ids USUALLY equal the PVE
// storage id, but the map is authoritative when present). Fault-isolated:
// stores with no history keep their "—" and an empty sparkline.
async function _bkLedgerTrends(datastores) {
  try {
    const d = await _swrJSON('/api/history/storage?hours=720', () => {});
    const series = (d && d.series) || [];
    const map = ((window._lastData || {}).proxmox || {}).pbs_storage_map || {};
    const acc = getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim() || '#E57000';
    datastores.forEach(ds => {
      const slug = ds.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const svgEl = el('bk-lg-spark-' + slug), gEl = el('bk-lg-growth-' + slug);
      const pveId = map[ds.name] || ds.name;
      const subs = series.filter(s => s.storage === pveId);
      if (!subs.length) { if (gEl) gEl.textContent = '—'; return; }
      // Merge (shared stores report one series per node — identical; take max per ts).
      const m = {};
      subs.forEach(s => s.labels.forEach((t, i) => { m[t] = Math.max(m[t] || 0, s.disk[i] || 0); }));
      const ts = Object.keys(m).map(Number).sort((a, b) => a - b);
      if (ts.length < 2) { if (gEl) gEl.textContent = '—'; return; }
      const vals = ts.map(t => m[t]);
      // Growth: bytes/day across the window (endpoints; backup stores grow smoothly).
      const days = (ts[ts.length - 1] - ts[0]) / 86400;
      const perDay = days > 0.5 ? (vals[vals.length - 1] - vals[0]) / days : 0;
      if (gEl) {
        if (perDay > 1e6) {
          const fullDays = ds.avail > 0 ? ds.avail / perDay : null;
          const fullTxt = fullDays == null ? '' : ' · full ≈ ' +
            (fullDays > 730 ? (fullDays / 365).toFixed(1) + 'y' : fullDays > 90 ? Math.round(fullDays / 30) + 'mo' : Math.round(fullDays) + 'd');
          const warn = fullDays != null && fullDays < 60;
          gEl.innerHTML = '<span style="color:' + (warn ? '#EF4444' : fullDays != null && fullDays < 180 ? '#F59E0B' : 'var(--c-dim)') + '">'
            + '+' + _bkFmtBytes(perDay) + '/day' + fullTxt + '</span>';
        } else gEl.textContent = 'no meaningful growth';
      }
      if (svgEl) {
        const W = svgEl.clientWidth || 200, H = 30;
        svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
        const lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.3 || 1;
        const y = v => (H - 3) - ((v - lo + pad * 0.5) / (hi - lo + pad)) * (H - 6);
        const pts = vals.map((v, i) => (i / (vals.length - 1) * W).toFixed(1) + ',' + y(v).toFixed(1));
        const gid = 'bk-lg-g-' + slug;
        svgEl.innerHTML = '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
            + '<stop offset="0" stop-color="' + acc + '" stop-opacity="0.25"/>'
            + '<stop offset="1" stop-color="' + acc + '" stop-opacity="0"/></linearGradient></defs>'
          + '<polygon points="0,' + (H - 1) + ' ' + pts.join(' ') + ' ' + W + ',' + (H - 1) + '" fill="url(#' + gid + ')"/>'
          + '<polyline points="' + pts.join(' ') + '" fill="none" stroke="' + acc + '" stroke-width="1.5" stroke-linejoin="round"/>';
      }
    });
  } catch (e) { console.warn('ledger trends:', e); }
}

function renderBackups(pbs) {
  const dsWrap = el('backups-datastores');
  const tblWrap = el('backups-table');
  if (!dsWrap || !tblWrap) return;
  // Backend strips snapshots/groups from the WS tick; pull them from the
  // lazy-loaded detail cache if needed.
  if (pbs && window._pbsDetail && !(pbs.snapshots && pbs.snapshots.length)) {
    pbs = Object.assign({}, pbs, {
      snapshots: window._pbsDetail.snapshots || [],
      groups: window._pbsDetail.groups || [],
    });
  }
  window._pbsLast = pbs;

  // The datastore cards, snapshot table and (especially) the per-target heatmap
  // are expensive to build — ~450ms with 1k+ snapshots — and they live ONLY on
  // the Backups page. The render gate also runs this on Overview/Health, but
  // those pages just read window._pbsLast (set above) for their summary cards;
  // they never show this DOM. Building it while off-page wasted ~450ms on every
  // nav AND on every WS poll. Skip the DOM work unless Backups is on screen —
  // showPage() calls renderBackups() directly when you navigate to it.
  if (currentPage !== 'backups') return;

  // Empty / disabled / offline states ---------------------------------------
  // Hide the Datastores/Activity sections entirely — an empty section header
  // above the empty-state card reads as a broken page.
  const _bkSections = show => ['bk-sec-datastores','bk-sec-activity'].forEach(id => {
    const s = el(id); if (s) s.style.display = show ? '' : 'none';
  });
  if (!pbs || !pbs.status) {
    _bkSections(false);
    dsWrap.innerHTML = '';
    const hm=el('bk-heatmap'); if (hm) hm.innerHTML = '';
    tblWrap.innerHTML = `<div class="empty-card">
      <div class="empty-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/></svg></div>
      <div class="empty-title">PBS not configured</div>
      <div class="empty-sub">Enable Proxmox Backup Server in <a href="javascript:showPage('settings')" style="color:var(--c-accent)">Settings → Infrastructure</a> to see datastores and snapshots here.</div>
    </div>`;
    const dsCount=el('meta-bk-datastores'), snCount=el('meta-bk-snapshots'), last=el('meta-bk-last');
    if (dsCount) dsCount.textContent='–';
    if (snCount) snCount.textContent='–';
    if (last)    last.textContent='–';
    return;
  }
  if (pbs.status === 'offline') {
    _bkSections(false);
    dsWrap.innerHTML = '';
    const hm=el('bk-heatmap'); if (hm) hm.innerHTML = '';
    tblWrap.innerHTML = offlineCard('PBS', pbs.error || 'Could not reach PBS API');
    return;
  }
  _bkSections(true);

  const datastores = pbs.datastores || [];
  const snapshots  = pbs.snapshots  || [];
  const f = window._bk;

  // Datastore LEDGER — one aligned row per store (identity+bar · last backup ·
  // verified · protected · dedup/growth · 30d sparkline). Rebuilt every data
  // update; the growth cells + sparklines are painted async from the storage
  // history. Clicking a row filters the snapshots table to that store.
  dsWrap.style.display = 'block';
  const _now = Date.now() / 1000;
  const _lgCell = (v, sub, vClr) =>
    `<div style="min-width:0"><div style="font-size:13px;font-weight:650;${vClr?`color:${vClr}`:''}">${v}</div>
     <div style="font-size:10px;color:var(--c-dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sub}</div></div>`;
  const _lgRows = datastores.map((d, di) => {
    const pct = d.percent || 0, barFg = barHex(pct);
    const snaps = snapshots.filter(s => s.datastore === d.name);
    const groups = new Set(snaps.map(s => s.backup_type + '/' + s.backup_id)).size;
    const latest = snaps.reduce((m, s) => Math.max(m, s.backup_time || 0), 0);
    const ageH = latest ? (_now - latest) / 3600 : null;
    const freshClr = ageH == null ? 'var(--c-muted)' : ageH < 26 ? '#22C55E' : ageH < 72 ? '#F59E0B' : '#EF4444';
    const recent = latest ? new Set(snaps.filter(s => latest - (s.backup_time||0) < 6*3600)
      .map(s => s.backup_type + '/' + s.backup_id)).size : 0;
    const verOk = snaps.filter(s => s.verify_state === 'ok').length;
    const verFail = snaps.filter(s => s.verify_state === 'failed').length;
    const verClr = verFail ? '#EF4444' : verOk === snaps.length && snaps.length ? '#22C55E' : 'var(--c-text)';
    const slug = d.name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const border = di < datastores.length - 1 ? 'border-bottom:1px solid var(--c-border);' : '';
    return `<div class="bk-ledger-row" data-datastore="${escAttr(d.name)}" onclick="_bkSetFilter('datastore',window._bk.datastore===this.dataset.datastore?'all':this.dataset.datastore)"
      style="${border}display:grid;grid-template-columns:230px 1fr 1fr 1fr 1.15fr 200px;gap:14px;align-items:center;padding:13px 16px;cursor:pointer">
      <div style="min-width:0">
        <div style="display:flex;align-items:baseline;gap:8px">
          <span style="font-size:13.5px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.name)}</span>
          <span style="font-size:11px;font-weight:700;color:${barFg};font-variant-numeric:tabular-nums">${pct.toFixed(1)}%</span>
        </div>
        <div class="bar" style="height:5px;margin-top:6px"><div class="bar-fill ${barCls(pct)}" style="--bf:${Math.min(pct,100)}%"></div></div>
        <div style="font-size:10px;color:var(--c-dim);margin-top:4px">${_bkFmtBytes(d.used)} / ${_bkFmtBytes(d.total)} · ${_bkFmtBytes(d.avail)} free</div>
      </div>
      ${_lgCell(latest ? _bkFmtRelative(latest) : '—', latest ? (recent + ' guest' + (recent===1?'':'s') + ' in last run') : 'no snapshots', freshClr)}
      ${_lgCell(snaps.length ? verOk + '/' + snaps.length : '—', verFail ? verFail + ' failed' : (snaps.length ? '0 failed' : ''), verClr)}
      ${_lgCell(groups + ' guest' + (groups===1?'':'s'), snaps.length + ' snapshots')}
      ${_lgCell(d.dedup ? d.dedup.toFixed(1) + '×' : '—', '<span id="bk-lg-growth-' + slug + '">…</span>')}
      <div style="min-width:0"><svg id="bk-lg-spark-${slug}" style="display:block;width:100%" height="30" preserveAspectRatio="none"></svg></div>
    </div>`;
  }).join('');
  const _lgHdr = ['Datastore','Last backup','Verified','Protected','Dedup · Growth','Usage · 30d']
    .map(h => `<div style="font-size:9px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--c-dim)">${h}</div>`).join('');
  dsWrap.innerHTML = datastores.length
    ? `<div class="hd-card" style="overflow-x:auto"><div style="min-width:860px">
        <div style="display:grid;grid-template-columns:230px 1fr 1fr 1fr 1.15fr 200px;gap:14px;padding:10px 16px 8px;border-bottom:1px solid var(--c-border)">${_lgHdr}</div>
        ${_lgRows}
      </div></div>`
    : `<div class="hd-card" style="padding:24px;text-align:center;color:var(--c-muted);font-size:12px">No datastores</div>`;
  setTimeout(() => _bkLedgerTrends(datastores), 0);

  // Page header meta --------------------------------------------------------
  // (ledger trends painter lives below renderBackups)
  const latest = snapshots.reduce((m, s) => Math.max(m, s.backup_time || 0), 0);
  const _dsC=el('meta-bk-datastores'), _snC=el('meta-bk-snapshots'), _lst=el('meta-bk-last');
  if (_dsC) _dsC.textContent = datastores.length;
  if (_snC) _snC.textContent = snapshots.length;
  if (_lst) _lst.textContent = _bkFmtRelative(latest);

  // The snapshot list (the table + heatmap data source) only changes when
  // _loadPbsDetail reloads it — NOT on every WS tick. The datastore usage cards
  // + meta above DO change per tick, so they're always refreshed; but rebuilding
  // the 1k-row table shell + rows + heatmap on every tick was pure waste and,
  // with the progressive row render, made the table visibly flicker (shrink to
  // the initial chunk, re-grow) each poll. Skip that rebuild when the snapshot
  // set is unchanged. Filter/sort/search call _bkUpdateView() directly, so they
  // bypass this guard and always re-render; this also preserves the live search
  // input + focus across ticks (the shell is no longer recreated under the user).
  const _tblSig = `${snapshots.length}:${latest}`;
  if (el('bk-rows') && window._bkTableSig === _tblSig) return;
  window._bkTableSig = _tblSig;

  // Filter chips (static buttons with data-bk-filter attrs — _bkUpdateView
  // toggles their .active class without touching the surrounding markup).
  const dsList = ['all', ...datastores.map(d => d.name)];
  const dsChips = dsList.map(name =>
    `<button class="hist-btn" data-bk-filter="datastore" data-bk-value="${esc(name)}" onclick="_bkSetFilter('datastore',this.dataset.bkValue)">${name === 'all' ? 'All' : esc(name)}</button>`
  ).join('');
  const typesPresent = Array.from(new Set(snapshots.map(s => s.backup_type)));
  const TYPE_LABELS = { all:'All', vm:'VMs', ct:'CTs', host:'Host' };
  const typeList = ['all', ...['vm','ct','host'].filter(t => typesPresent.includes(t))];
  const typeChips = typeList.map(t =>
    `<button class="hist-btn" data-bk-filter="type" data-bk-value="${t}" onclick="_bkSetFilter('type','${t}')">${TYPE_LABELS[t]}</button>`
  ).join('');

  // Build the shell once. Filter/sort changes mutate bk-rows / bk-thead /
  // bk-count / bk-total-size in place — the <input>, the datastore cards,
  // and the chip buttons are never recreated, so focus + the sliding thumb
  // both survive every keystroke and pill click.
  tblWrap.innerHTML = `<div class="hd-card" style="padding:0;overflow:hidden">
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--c-border)">
      <div class="hd-search-wrap" style="max-width:400px;min-width:200px;flex:1">
        <svg class="hd-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="bk-search" class="hd-search" type="search" placeholder="Search ID, datastore, owner…" value="${esc(f.search||'')}" oninput="_bkOnSearch(this.value)">
        <button class="hd-search-clear" onclick="var i=document.getElementById('bk-search');if(i)i.value='';_bkOnSearch('')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      ${datastores.length > 1 ? `<div class="hist-range" id="bk-ds-hist-range" style="margin-left:0">${dsChips}</div>` : ''}
      ${typesPresent.length > 1 ? `<div class="hist-range" id="bk-type-hist-range" style="margin-left:0">${typeChips}</div>` : ''}
      <span style="margin-left:auto;display:inline-flex;gap:14px;font-size:12px;color:var(--c-muted)">
        <span><b id="bk-count" style="color:var(--c-text);font-size:13px">0</b> shown</span>
        <span><b id="bk-total-size" style="color:var(--c-text);font-size:13px">—</b> total</span>
      </span>
    </div>
    <div id="bk-scroll" style="overflow:auto;max-height:clamp(400px,70vh,calc(100vh - 280px))">
      <table style="width:100%;min-width:740px;border-collapse:collapse;font-size:14px;table-layout:fixed">
        <thead id="bk-thead" style="background:var(--c-card);position:sticky;top:0;z-index:1"></thead>
        <tbody id="bk-rows"></tbody>
      </table>
    </div>
  </div>`;

  // Populate rows, header arrows, counts, and chip active states.
  _bkUpdateView();

  // Activity heatmap (independent of the table's filter state — shows
  // overall PBS activity across all datastores and types).
  _bkRenderHeatmap(pbs);
}

// Per-target activity heatmap: one row per VM/CT/host, columns = days,
// color intensity = backup count for that target on that day. Lets you
// see at-a-glance which targets are backed up regularly and where gaps
// or missed-window patterns are.
//
// The toolbar (summary + range pill row) is rendered ONCE via the shell
// helper below — keeping `#bk-hm-hist-range` and its `.hist-thumb`
// element stable across re-renders so the thumb slide animation isn't
// interrupted by innerHTML rebuilds.
function _bkRenderHeatmapShell(container) {
  if (el('bk-hm-hist-range')) return;
  const DAYS = window._bkHmDays || 90;
  const ranges = [
    { lbl: '30d', days: 30 },
    { lbl: '90d', days: 90 },
    { lbl: '6m',  days: 180 },
    { lbl: '1y',  days: 365 },
  ];
  const pillRow = `<div class="hist-range" id="bk-hm-hist-range">${
    ranges.map(r => `<button class="hist-btn${r.days===DAYS?' active':''}" onclick="_bkHmSetRange(${r.days},this)">${r.lbl}</button>`).join('')
  }</div>`;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div id="bk-hm-summary" style="display:flex;align-items:center;gap:10px;font-size:11px;color:var(--c-muted)"></div>
      <div style="margin-left:auto">${pillRow}</div>
    </div>
    <div id="bk-hm-body"></div>
    <div id="bk-hm-legend"></div>
  `;
  _histSchedule();
}

function _bkRenderHeatmap(pbs) {
  const container = el('bk-heatmap');
  if (!container || !pbs || !pbs.snapshots) return;

  // Friendly name lookup — same logic as the snapshots table.
  const px = window._pxLast || { vms: [], lxcs: [] };
  const nameMap = {};
  (px.vms  || []).forEach(v => { if (v.vmid != null) nameMap['vm:'+String(v.vmid)] = v.name || ''; });
  (px.lxcs || []).forEach(c => { if (c.vmid != null) nameMap['ct:'+String(c.vmid)] = c.name || ''; });

  // Group snapshots by target (backup_type:backup_id).
  const targets = {};
  for (const s of pbs.snapshots) {
    if (!s.backup_time) continue;
    const id = s.backup_id || 'unknown';
    const type = s.backup_type || 'unknown';
    const key = `${type}:${id}`;
    let t = targets[key];
    if (!t) t = targets[key] = { type, id, name: nameMap[key] || s.comment || '', byDay: {}, latest: 0, total: 0, size: 0 };
    t.latest = Math.max(t.latest, s.backup_time);
    t.total++;
    t.size += s.size || 0;
    const d = new Date(s.backup_time * 1000);
    const dKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    t.byDay[dKey] = (t.byDay[dKey] || 0) + 1;
  }

  // Range selection driven by the pill row. Cell size is FIXED across
  // every range so the density of squares is visually identical — longer
  // ranges scroll further horizontally rather than shrinking each cell.
  const DAYS = window._bkHmDays || 90;
  const CELL = 14, GAP = 2;
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(today);
  start.setDate(start.getDate() - (DAYS-1));
  const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const startKey = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
  const gridW = DAYS * (CELL + GAP) - GAP;

  // Drop targets with no activity in the visible window — keeps deleted
  // or long-abandoned VMs from cluttering the chart with empty rows.
  // Also recompute `latest` against the window so sorting reflects what's
  // visible, not ancient history.
  const rawList = Object.values(targets);
  const list = rawList
    .map(t => {
      const windowDays = Object.fromEntries(Object.entries(t.byDay).filter(([k]) => k >= startKey));
      const windowLatest = Object.keys(windowDays).reduce((m, k) => k > m ? k : m, '');
      const windowCount  = Object.values(windowDays).reduce((s, c) => s + c, 0);
      return { ...t, byDay: windowDays, latest: windowLatest, total: windowCount };
    })
    .filter(t => t.total > 0)
    .sort((a, b) => b.latest.localeCompare(a.latest));

  if (!list.length) {
    _bkRenderHeatmapShell(container);
    const _s=el('bk-hm-summary'), _b=el('bk-hm-body'), _l=el('bk-hm-legend');
    if (_s) _s.innerHTML = '<span>0 targets in window</span>';
    if (_b) _b.innerHTML = '<div style="padding:24px;text-align:center;color:var(--c-muted);font-size:12px">No backup activity in the last ' + DAYS + ' days</div>';
    if (_l) _l.innerHTML = '';
    return;
  }

  // Quartile-based scale — over the visible window only, so old high-count
  // days don't crush the colour ramp for recent activity.
  const globalMax = Math.max(1, ...list.flatMap(t => Object.values(t.byDay)));
  const levelOf = c => {
    if (c === 0) return 0;
    const r = c / globalMax;
    if (r <= 0.25) return 1;
    if (r <= 0.50) return 2;
    if (r <= 0.75) return 3;
    return 4;
  };
  const fillFor = lvl => lvl === 0 ? 'var(--c-bar-bg)' : `rgba(var(--c-accent-rgb),${[0,0.35,0.58,0.80,1.0][lvl]})`;

  // Month label header — text positioned at the first day of each month,
  // plus a tick mark so the boundary is visible
  let monthSvg = `<svg width="${gridW}" height="18" viewBox="0 0 ${gridW} 18" style="display:block">`;
  let prevMonth = -1;
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(start); date.setDate(date.getDate() + i);
    const m = date.getMonth();
    if (m !== prevMonth) {
      const x = i * (CELL+GAP);
      monthSvg += `<text x="${x}" y="13" font-size="11" font-weight="600" fill="var(--c-text)">${date.toLocaleString('default',{month:'short'})}</text>`;
      if (i > 0) monthSvg += `<line x1="${x - 1.5}" y1="14" x2="${x - 1.5}" y2="18" stroke="var(--c-border)" stroke-width="1"/>`;
      prevMonth = m;
    }
  }
  monthSvg += '</svg>';

  // Precompute the day columns ONCE — key, x offset, today flag, and the
  // (expensive) Intl-formatted tooltip date. rowFor() runs per target, so doing
  // this inside its loop meant ~targets×DAYS Date allocations + toLocaleDateString
  // calls (thousands of Intl calls), which was the bulk of this function's cost.
  const cols = new Array(DAYS);
  for (let i = 0; i < DAYS; i++) {
    const date = new Date(start); date.setDate(date.getDate() + i);
    const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    cols[i] = {
      key,
      x: i * (CELL+GAP),
      isToday: key === todayKey,
      label: date.toLocaleDateString('default',{weekday:'short',month:'short',day:'numeric'}),
    };
  }

  // One row per target — left: badge + label, right: heatmap cells SVG
  const rowFor = (t) => {
    const labelText = t.name || ('ID ' + t.id);
    const typeUp = (t.type||'?').toUpperCase();
    let row = `<svg width="${gridW}" height="${CELL}" viewBox="0 0 ${gridW} ${CELL}" style="display:block">`;
    for (let i = 0; i < DAYS; i++) {
      const col = cols[i];
      const count = t.byDay[col.key] || 0;
      const stroke = col.isToday ? ' stroke="rgba(var(--c-accent-rgb),.95)" stroke-width="1.5"' : '';
      const tooltip = `${col.label}\n${labelText} (${typeUp} ${t.id})\n${count} backup${count!==1?'s':''}`;
      row += `<rect x="${col.x}" y="0" width="${CELL}" height="${CELL}" rx="2.5" fill="${fillFor(levelOf(count))}"${stroke}><title>${tooltip}</title></rect>`;
    }
    row += '</svg>';
    return `<div class="bk-hm-row" title="${esc(labelText)} · ${esc(String(t.total))} backups">
        <div class="bk-hm-label">
          ${_bkTypeBadge(t.type)}
          <span class="bk-hm-name">${esc(labelText)}</span>
          <span class="bk-hm-id">${esc(String(t.id))}</span>
        </div>
        ${row}
      </div>`;
  };

  // Legend
  let legend = '<div style="display:flex;align-items:center;gap:5px;font-size:10px;color:var(--c-muted);margin-top:10px;justify-content:flex-end"><span>Less</span>';
  for (let i = 0; i <= 4; i++) legend += `<span style="width:11px;height:11px;border-radius:2px;background:${fillFor(i)};display:inline-block"></span>`;
  legend += '<span>More</span></div>';

  // Stats row — totals are already windowed (byDay was filtered to startKey above).
  const inWindow = list.reduce((sum, t) => sum + t.total, 0);
  const rangeLabel = DAYS === 30 ? 'last 30 days'
                   : DAYS === 90 ? 'last 90 days'
                   : DAYS === 180 ? 'last 6 months'
                   : 'last year';

  _bkRenderHeatmapShell(container);

  // Update only the body/summary/legend — the toolbar (including the pill
  // row + its sliding .hist-thumb) is left intact so the slide animation
  // isn't interrupted by an innerHTML rebuild.
  const _s = el('bk-hm-summary');
  const _b = el('bk-hm-body');
  const _l = el('bk-hm-legend');
  if (_s) _s.innerHTML = `<span><b style="color:var(--c-text);font-weight:600">${list.length}</b> targets</span><span style="opacity:.4">·</span><span><b style="color:var(--c-text);font-weight:600">${inWindow}</b> backups in ${rangeLabel}</span>`;
  if (_b) {
    // Snap to the right edge so the latest activity (today) is always in view —
    // same behaviour as the health uptime heatmap. (The old preserve-scroll
    // logic stranded it at the oldest column after the empty→data tick.)
    _b.innerHTML = `<div class="bk-hm-scroll"><div class="bk-hm-table"><div class="bk-hm-row bk-hm-head"><div class="bk-hm-label" style="visibility:hidden">_</div>${monthSvg}</div>${list.map(rowFor).join('')}</div></div>`;
    const scroller = _b.querySelector('.bk-hm-scroll');
    if (scroller) {
      scroller.scrollLeft = scroller.scrollWidth;
      window._bkHmResetScroll = false;
      requestAnimationFrame(() => { scroller.scrollLeft = scroller.scrollWidth; });
    }
  }
  if (_l) _l.innerHTML = legend;
}

function _bkHmSetRange(days, btn) {
  window._bkHmDays = days;
  window._bkHmResetScroll = true;
  // Move active class + slide the thumb FIRST so the user sees the
  // animation start before the (slightly heavier) cell re-render. The
  // shell stays in the DOM, so the thumb is the same element across
  // clicks — its CSS transition triggers naturally.
  const range = btn.parentElement;
  if (range) {
    range.querySelectorAll('.hist-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _histThumbUpdate('bk-hm');
  }
  _bkRenderHeatmap(window._pbsLast);
}

// Virtualized <tbody> renderer. Keeps only the rows near the viewport in the DOM
// (plus top/bottom spacer <tr>s that preserve the real scroll height) and
// re-windows on scroll — so a 1k+ row table is ~40 live rows instead of 1k+,
// cutting both DOM weight and render cost. rowHtml(item,i) returns one <tr>.
// Requires table-layout:fixed on the table so columns don't reflow as rows swap.
function _vlist(scrollEl, tbody, items, rowHtml, opts){
  opts = opts || {};
  const colspan = opts.colspan || 1, buffer = opts.buffer || 10;
  const st = { items, rowHtml, colspan, buffer, rowH: scrollEl._vlistRowH || opts.rowH || 0, raf: 0 };
  const paint = () => {
    const s = scrollEl._vlistState; if (!s) return;
    const n = s.items.length;
    if (!n){ tbody.innerHTML = opts.empty || ''; return; }
    if (!s.rowH){
      // Measure once: render a small batch, read a real row height, cache it.
      tbody.innerHTML = s.items.slice(0, Math.min(n, 20)).map(s.rowHtml).join('');
      const r = tbody.querySelector('tr');
      s.rowH = r ? Math.max(1, Math.round(r.getBoundingClientRect().height)) : 48;
      scrollEl._vlistRowH = s.rowH;
    }
    const vh = scrollEl.clientHeight || 600;
    const first = Math.max(0, Math.floor(scrollEl.scrollTop / s.rowH) - s.buffer);
    const last = Math.min(n, first + Math.ceil(vh / s.rowH) + s.buffer * 2);
    const padTop = first * s.rowH, padBot = (n - last) * s.rowH;
    let html = padTop ? `<tr aria-hidden="true"><td colspan="${s.colspan}" style="height:${padTop}px;padding:0;border:0"></td></tr>` : '';
    for (let i = first; i < last; i++) html += s.rowHtml(s.items[i], i);
    if (padBot) html += `<tr aria-hidden="true"><td colspan="${s.colspan}" style="height:${padBot}px;padding:0;border:0"></td></tr>`;
    tbody.innerHTML = html;
  };
  st.paint = paint;
  scrollEl._vlistState = st;
  if (!scrollEl._vlistBound){
    scrollEl.addEventListener('scroll', () => {
      const s = scrollEl._vlistState; if (!s || s.raf) return;
      s.raf = requestAnimationFrame(() => { s.raf = 0; s.paint(); });
    }, { passive: true });
    scrollEl._vlistBound = true;
  }
  paint();
}

// Partial update: replace tbody + thead + counts + chip classes only.
// Called from _bkSetFilter, _bkSetSort, and the debounced search input.
function _bkUpdateView(){
  const pbs = window._pbsLast;
  if (!pbs || !pbs.snapshots) return;
  const f = window._bk;
  const snapshots = pbs.snapshots;

  // Build a {(type,id): name} lookup from the live PVE inventory so we can
  // surface friendly names (e.g. "wireguard") next to the numeric IDs.
  // PVE returns vms[] and lxcs[] each with `vmid` + `name` — vms map to
  // backup_type='vm', lxcs to 'ct'. Host backups have no PVE counterpart.
  const px = window._pxLast || { vms: [], lxcs: [] };
  const _nameMap = {};
  (px.vms || []).forEach(v => { if (v.vmid != null) _nameMap['vm:'+String(v.vmid)] = v.name || ''; });
  (px.lxcs|| []).forEach(c => { if (c.vmid != null) _nameMap['ct:'+String(c.vmid)] = c.name || ''; });
  // Resolve order: PVE name → snapshot comment → '' (PBS often populates the
  // comment with the VM/CT name when the backup was triggered from PVE).
  const nameOf = s => _nameMap[`${s.backup_type}:${s.backup_id}`] || s.comment || '';

  // Filter ------------------------------------------------------------------
  const filtered = snapshots.filter(s => {
    if (f.datastore !== 'all' && s.datastore !== f.datastore) return false;
    if (f.type !== 'all' && s.backup_type !== f.type) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      const hay = `${s.backup_id||''} ${nameOf(s)} ${s.backup_type||''} ${s.datastore||''} ${s.owner||''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  // Sort --------------------------------------------------------------------
  const dir = f.orderDir === 'asc' ? 1 : -1;
  filtered.sort((a, b) => {
    let av, bv;
    if      (f.orderBy === 'size')      { av = a.size||0;        bv = b.size||0; }
    else if (f.orderBy === 'backup_id') { av = (a.backup_id||'').toLowerCase(); bv = (b.backup_id||'').toLowerCase(); }
    else                                { av = a.backup_time||0; bv = b.backup_time||0; }
    if (av < bv) return -1 * dir;
    if (av > bv) return  1 * dir;
    return 0;
  });

  // Sortable header — re-renders the arrow icon for whichever column is
  // active. Cheap to recreate; doesn't host any input state.
  const _sortHdr = (col, label) => {
    const active = f.orderBy === col;
    const arrow = active
      ? (f.orderDir === 'asc'
        ? '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>'
        : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>')
      : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="opacity:.4"><path d="m21 16-4 4-4-4"/><path d="M17 20V4"/><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/></svg>';
    return `<button type="button" onclick="_bkSetSort('${col}')" style="background:none;border:none;padding:0;color:inherit;font:inherit;display:inline-flex;align-items:center;gap:4px;cursor:pointer">${label}<span style="opacity:${active?1:.4}">${arrow}</span></button>`;
  };
  const thead = el('bk-thead');
  if (thead) thead.innerHTML = `<tr style="border-bottom:1px solid var(--c-border)">
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:500;color:var(--c-muted);width:150px;white-space:nowrap">${_sortHdr('backup_time','Backup time')}</th>
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:500;color:var(--c-muted)">${_sortHdr('backup_id','Backup')}</th>
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:500;color:var(--c-muted);width:110px">Datastore</th>
      <th style="padding:10px 16px;text-align:right;font-size:12px;font-weight:500;color:var(--c-muted);width:90px">${_sortHdr('size','Size')}</th>
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:500;color:var(--c-muted);width:105px">Verify</th>
      <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:500;color:var(--c-muted);width:130px">Owner</th>
    </tr>`;

  // Rows --------------------------------------------------------------------
  // Building + parsing all rows at once was the dominant cost on this page
  // (1k+ snapshots × verbose per-row markup ≈ 300ms+), even though only ~15 are
  // ever visible in the scroll viewport. Render an initial chunk synchronously
  // for an instant paint, then append the remainder across animation frames so
  // the page is interactive immediately and the main thread never blocks. A
  // sequence token cancels in-flight appends when a filter/sort/search re-renders.
  const rowHtml = (s) => {
    const name = nameOf(s);
    return `<tr class="hd-trow" style="border-bottom:1px solid var(--c-border)">
    <td style="padding:10px 16px;vertical-align:middle;white-space:nowrap;width:150px">
      <div style="font-size:14px;font-weight:500;color:var(--c-text);line-height:1.2">${_bkFmtRelative(s.backup_time)}</div>
      <div style="font-size:12px;color:var(--c-muted);margin-top:2px">${_bkFmtAbs(s.backup_time)}</div>
    </td>
    <td style="padding:10px 16px;vertical-align:middle;overflow:hidden">
      <!-- table-layout:fixed does NOT clip overflow — without overflow:hidden on
           the td + min-width:0 on the flex name, long guest names paint straight
           over the Datastore column. Badges keep their size; the name ellipsizes. -->
      <div style="display:flex;align-items:center;gap:8px;min-width:0;max-width:100%">
        ${name
          ? `<span style="font-size:14px;font-weight:500;color:var(--c-text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(name)} (${esc(s.backup_type)}/${esc(s.backup_id)})">${esc(name)}<span style="color:var(--c-muted);font-weight:normal;margin-left:6px">${esc(s.backup_id)}</span></span>`
          : `<span style="font-size:14px;font-weight:500;color:var(--c-text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.backup_id)}</span>`}
        ${s.protected ? '<svg style="flex-shrink:0" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" title="Protected"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''}
        <span style="flex-shrink:0;display:inline-flex">${_bkTypeBadge(s.backup_type)}</span>
      </div>
    </td>
    <td style="padding:10px 16px;vertical-align:middle"><span style="font-size:13px;color:var(--c-text)">${esc(s.datastore)}</span></td>
    <td style="padding:10px 16px;vertical-align:middle;text-align:right;font-variant-numeric:tabular-nums"><span style="font-size:13px;color:var(--c-text)">${_bkFmtBytes(s.size)}</span></td>
    <td style="padding:10px 16px;vertical-align:middle">${_bkVerifyBadge(s.verify_state)}</td>
    <td style="padding:10px 16px;vertical-align:middle"><span style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--c-muted)">${esc(s.owner)}</span></td>
  </tr>`;
  };
  const tbody = el('bk-rows');
  const scroll = el('bk-scroll');
  if (tbody && scroll) {
    // Reset scroll to top when the filter/sort/search changed (not on a live
    // data tick), so a windowed re-render doesn't strand the user mid-list.
    const _fsig = JSON.stringify(f);
    if (_fsig !== window._bkFSig) { scroll.scrollTop = 0; window._bkFSig = _fsig; }
    if (!filtered.length) {
      scroll._vlistState = null;
      tbody.innerHTML = `<tr><td colspan="6" style="padding:40px;text-align:center;color:var(--c-muted);font-size:12px">No snapshots match the filters.</td></tr>`;
    } else {
      // Virtualized: only the rows near the viewport live in the DOM (1k+ → ~40).
      _vlist(scroll, tbody, filtered, rowHtml, { colspan: 6, rowH: 53 });
    }
  }

  // Footer counters ---------------------------------------------------------
  const cnt = el('bk-count');      if (cnt) cnt.textContent = filtered.length;
  const tot = el('bk-total-size'); if (tot) tot.textContent = _bkFmtBytes(filtered.reduce((a, s) => a + (s.size || 0), 0));

  // Chip active classes — toggled without rebuilding the buttons. Keeps the
  // sliding thumb continuous: it animates from the old `.active` button to
  // the new one because both buttons are the same DOM nodes.
  document.querySelectorAll('[data-bk-filter]').forEach(b => {
    const k = b.dataset.bkFilter, v = b.dataset.bkValue;
    b.classList.toggle('active', f[k] === v);
  });
  // Slide thumbs into position.
  requestAnimationFrame(() => {
    ['bk-ds', 'bk-type'].forEach(p => {
      if (document.getElementById(p + '-hist-range')) _histThumbUpdate(p);
    });
  });
}
// ── TARS chat (Claude API proxy, streaming thinking + text) ──────────────────
let _tarsHistory = [];
let _tarsBusy = false;
let _tarsActiveId = null;   // id of the conversation currently open, once saved once

function _tarsLine(role, text) {
  const div = document.createElement('div');
  div.className = 'tline tline-' + (role === 'user' ? 'u' : 'a');
  div.textContent = text;
  const chat = el('tars-chat');
  const emp = el('tars-empty'); if (emp) emp.remove();   // first message clears the empty state
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
  return div;
}
// ── Terminal-style markdown for TARS replies (escape-first → XSS-safe) ───────
function _tarsInline(raw) {
  let s = esc(raw);                                   // escape & " < > first
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '' + (codes.length - 1) + ''; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
    /^https?:\/\//i.test(u) ? '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>' : t);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[\s(>])_([^_]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(\d+)/g, (m, i) => '<code class="tmd-code">' + codes[+i] + '</code>');
  return s;
}
function _tarsMd(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let inCode = false, codeBuf = [];
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (!inCode) { inCode = true; codeBuf = []; }
      else { out.push('<pre class="tmd-pre"><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }
    let m;
    if (!raw.trim()) out.push('<div class="tmd-gap"></div>');
    else if (m = raw.match(/^\s*(#{1,4})\s+(.*)$/)) out.push('<div class="tmd-line"><span class="tmd-h">' + _tarsInline(m[2]) + '</span></div>');
    else if (m = raw.match(/^(\s*)[-*+]\s+(.*)$/)) out.push('<div class="tmd-line tmd-li" style="padding-left:' + (m[1].length * 6 + 2) + 'px"><span class="tmd-bullet">•</span> ' + _tarsInline(m[2]) + '</div>');
    else if (m = raw.match(/^(\s*)(\d+)\.\s+(.*)$/)) out.push('<div class="tmd-line tmd-li" style="padding-left:' + (m[1].length * 6 + 2) + 'px"><span class="tmd-num">' + m[2] + '.</span> ' + _tarsInline(m[3]) + '</div>');
    else if (m = raw.match(/^\s*>\s?(.*)$/)) out.push('<div class="tmd-line"><span class="tmd-quote">' + _tarsInline(m[1]) + '</span></div>');
    else if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(raw)) out.push('<div class="tmd-hr"></div>');
    else out.push('<div class="tmd-line">' + _tarsInline(raw) + '</div>');
  }
  if (inCode) out.push('<pre class="tmd-pre"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  return out.join('');
}

function tarsKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tarsSend(); }
  const t = el('tars-input'); if (t) { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }
}
// ── Empty state (suggestion chips, or a setup CTA when not configured) ───────
const _TARS_CHIPS = ["What's down right now?", "How's storage looking?", "Which node is busiest?", "Any failed backups?"];
let _tarsConfigured = true;   // optimistic until /api/tars/info says otherwise
function _tarsRenderEmpty() {
  const c = el('tars-chat'); if (!c) return;
  const body = _tarsConfigured
    ? '<div class="tars-empty-hint">Ask about the cluster, storage, backups, or what is down. The assistant reads your live cluster (read-only).</div>'
      + '<div class="tars-chips">'
      + _TARS_CHIPS.map(q => '<button class="tars-chip" data-q="' + esc(q) + '" onclick="tarsSuggest(this.dataset.q)">' + esc(q) + '</button>').join('')
      + '</div>'
    : '<div class="tars-empty-hint">The assistant isn\'t configured yet — add an API key or point it at a local model in Settings.</div>'
      + '<button class="tars-empty-cta" onclick="_tarsGoSettings()">Set up the Assistant</button>';
  c.innerHTML = '<div class="tars-empty" id="tars-empty">'
    + '<svg class="tars-empty-glyph" width="46" height="40" viewBox="0 0 46 40" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="8" height="36" rx="2.5"/><rect x="14" y="2" width="8" height="36" rx="2.5"/><rect x="26" y="2" width="8" height="36" rx="2.5"/><rect x="38" y="2" width="6" height="36" rx="2.5"/></svg>'
    + body + '</div>';
}
function tarsSuggest(q) {
  const i = el('tars-input'); if (!i) return;
  i.value = q; i.style.height = 'auto';
  tarsSend();
}

// ── Inline "thought process": a collapsible block per assistant turn ─────────
let _tarsThinkSeg = null, _tarsThinkHost = null, _tarsThinkSummary = null;
function _tarsStatus(state, label) {
  const s = _tarsThinkSummary; if (!s) return;
  s.dataset.state = state || 'idle';
  const tx = s.querySelector('.tars-status-txt'); if (tx) tx.textContent = label || '';
}
function _tarsThinkText(txt) {
  const t = _tarsThinkHost; if (!t) return;
  if (!_tarsThinkSeg) { _tarsThinkSeg = document.createElement('div'); _tarsThinkSeg.className = 'think-seg'; t.appendChild(_tarsThinkSeg); }
  _tarsThinkSeg.textContent += txt;
  _tarsScrollChat();
}
function _tarsThinkTool(name) {
  const t = _tarsThinkHost; if (!t) return;
  const row = document.createElement('div'); row.className = 'tmd-tool';
  row.innerHTML = '<span class="tt-spin"></span><span class="tt-ok">✓</span><span class="tt-name">' + esc(name || 'tool') + '</span><span class="tt-sec"></span>';
  t.appendChild(row); _tarsThinkSeg = null; _tarsScrollChat();
}
function _tarsThinkToolDone(input) {
  const t = _tarsThinkHost; if (!t) return;
  const rows = t.querySelectorAll('.tmd-tool:not([data-done])');
  const row = rows[rows.length - 1]; if (!row) return;
  row.setAttribute('data-done', '');
  const sx = input && input.sections ? JSON.stringify(input.sections) : '';
  const sec = row.querySelector('.tt-sec'); if (sec && sx) sec.textContent = sx;
  _tarsScrollChat();
}
function _tarsFinishThink(answer) {
  const host = _tarsThinkHost; if (!host) return;
  const det = host.closest('.tthink');
  if (det && !host.firstChild) { det.remove(); return; }   // no reasoning captured → drop the block
  _tarsStatus(answer ? 'done' : 'idle', 'Thought process');
  if (det) det.open = false;                                // collapse once finished
}
function _tarsScrollChat() { const c = el('tars-chat'); if (c) c.scrollTop = c.scrollHeight; }

// ── Header meta-row (readiness · model) ───────────────────────────────────────
// The model badge only means anything once the assistant is actually usable —
// showing a leftover/default model string next to "not configured" reads as a
// contradiction, so it's hidden entirely until `configured` is true. The
// header stays modest either way (small dot + label); the real call-to-action
// lives in the empty state (_tarsRenderEmpty), which swaps the suggestion
// chips for a setup button when not configured.
function _tarsSyncConfigured(configured) {
  _tarsConfigured = configured;
  if (!_tarsHistory.length && el('tars-empty')) _tarsRenderEmpty();
}
function _tarsLoadInfo() {
  const wrap = el('tars-rdy-wrap'), modelItem = el('tars-meta-model-item'), sep = el('tars-meta-sep');
  fetch('/api/tars/info').then(r => r.json()).then(d => {
    const rd = el('tars-rdy'); if (rd) rd.textContent = d.configured ? 'ready' : 'not configured — set up in Settings';
    const dot = el('tars-rdy-dot'); if (dot) dot.className = 'tars-dot ' + (d.configured ? 'ok' : 'bad');
    if (wrap) wrap.classList.toggle('tars-rdy-bad', !d.configured);
    if (modelItem) modelItem.style.display = d.configured ? '' : 'none';
    if (sep) sep.style.display = d.configured ? '' : 'none';
    const m = el('tars-meta-model'); if (m) m.textContent = String(d.model || '').replace(/^claude-/, '') || '—';
    _tarsSyncConfigured(!!d.configured);
  }).catch(() => {
    const rd = el('tars-rdy'); if (rd) rd.textContent = 'offline';
    const dot = el('tars-rdy-dot'); if (dot) dot.className = 'tars-dot bad';
    if (wrap) wrap.classList.add('tars-rdy-bad');
    if (modelItem) modelItem.style.display = 'none';
    if (sep) sep.style.display = 'none';
    _tarsSyncConfigured(false);
  });
}
function _tarsGoSettings() {
  showPage('settings');
  setTimeout(() => { if (typeof switchSettingsTab === 'function') switchSettingsTab('assistant'); }, 80);
}

// ── Conversation history (localStorage — this backend is stateless per
// request; the browser is the only place a past conversation lives). Capped
// at 30 so it can't grow unbounded. "New chat" saves whatever's open (if it
// has any turns) under a stable per-conversation id, then starts fresh.
const _TARS_CONVOS_KEY = 'hd-tars-convos', _TARS_CONVOS_MAX = 30;
let _tarsConvos = [];
function _tarsLoadConvos() {
  try { _tarsConvos = JSON.parse(localStorage.getItem(_TARS_CONVOS_KEY) || '[]'); }
  catch (e) { _tarsConvos = []; }
  if (!Array.isArray(_tarsConvos)) _tarsConvos = [];
}
function _tarsSaveConvos() {
  try { localStorage.setItem(_TARS_CONVOS_KEY, JSON.stringify(_tarsConvos.slice(0, _TARS_CONVOS_MAX))); } catch (e) {}
}
function _tarsPersistActive() {
  if (!_tarsHistory.length) return;
  _tarsLoadConvos();
  const firstUser = (_tarsHistory.find(m => m.role === 'user') || {}).content || 'Conversation';
  const title = firstUser.length > 60 ? firstUser.slice(0, 60) + '…' : firstUser;
  if (!_tarsActiveId) _tarsActiveId = 'c' + Date.now() + Math.random().toString(36).slice(2, 7);
  const rec = { id: _tarsActiveId, title, messages: _tarsHistory.slice(), updatedAt: Date.now() };
  const idx = _tarsConvos.findIndex(c => c.id === _tarsActiveId);
  if (idx >= 0) _tarsConvos[idx] = rec; else _tarsConvos.unshift(rec);
  _tarsConvos.sort((a, b) => b.updatedAt - a.updatedAt);
  _tarsSaveConvos();
}
function _tarsFmtWhen(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function _tarsRenderHistoryList() {
  const host = el('tars-history-list'); if (!host) return;
  _tarsLoadConvos();
  if (!_tarsConvos.length) {
    host.innerHTML = '<div style="font-size:12px;color:var(--c-muted);padding:8px 0">No past conversations yet.</div>';
    return;
  }
  host.innerHTML = _tarsConvos.map(c =>
    '<div class="tars-hist-row' + (c.id === _tarsActiveId ? ' active' : '') + '" onclick="tarsLoadConvo(\'' + c.id + '\')">'
    + '<div class="tars-hist-main"><div class="tars-hist-title">' + esc(c.title) + '</div>'
    + '<div class="tars-hist-when">' + _tarsFmtWhen(c.updatedAt) + '</div></div>'
    + '<button class="tars-hist-del" onclick="event.stopPropagation();tarsDeleteConvo(\'' + c.id + '\')" aria-label="Delete conversation">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    + '</button></div>'
  ).join('');
}
function tarsLoadConvo(id) {
  _tarsPersistActive();
  _tarsLoadConvos();
  const c = _tarsConvos.find(x => x.id === id); if (!c) return;
  _tarsActiveId = c.id;
  _tarsHistory = c.messages.slice();
  const chat = el('tars-chat'); chat.innerHTML = '';
  _tarsHistory.forEach(m => {
    if (m.role === 'user') { _tarsLine('user', m.content); return; }
    const div = document.createElement('div'); div.className = 'tline tline-a tmd';
    div.innerHTML = _tarsMd(m.content); chat.appendChild(div);
  });
  chat.scrollTop = chat.scrollHeight;
  closeTarsHistory();
}
function tarsDeleteConvo(id) {
  _tarsLoadConvos();
  _tarsConvos = _tarsConvos.filter(c => c.id !== id);
  _tarsSaveConvos();
  if (id === _tarsActiveId) _tarsActiveId = null;
  _tarsRenderHistoryList();
}
function openTarsHistory() {
  _tarsRenderHistoryList();
  const m = el('tars-history-modal'); if (m) m.classList.add('open');
}
function closeTarsHistory() {
  const m = el('tars-history-modal'); if (m) m.classList.remove('open');
}

function tarsClear() {
  _tarsPersistActive();
  _tarsHistory = [];
  _tarsActiveId = null;
  _tarsRenderEmpty();
}

async function tarsSend() {
  if (_tarsBusy) return;
  const inp = el('tars-input'); const msg = (inp.value || '').trim(); if (!msg) return;
  inp.value = ''; inp.style.height = 'auto';
  _tarsLine('user', msg);
  _tarsHistory.push({ role: 'user', content: msg });
  _tarsBusy = true;
  const sendBtn = el('tars-send'); if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '.6'; }

  // assistant turn: inline collapsible thinking + the answer line
  const chat = el('tars-chat');
  const turn = document.createElement('div'); turn.className = 'tturn';
  const think = document.createElement('details'); think.className = 'tthink'; think.open = true;
  think.innerHTML = '<summary><span class="tars-status" data-state="thinking"><span class="tars-dot"></span>'
    + '<span class="tars-status-txt">Thinking…</span></span></summary><div class="tthink-body"></div>';
  const line = document.createElement('div'); line.className = 'tline tline-a tmd tline-live';
  turn.appendChild(think); turn.appendChild(line);
  chat.appendChild(turn); chat.scrollTop = chat.scrollHeight;
  _tarsThinkHost = think.querySelector('.tthink-body');
  _tarsThinkSummary = think.querySelector('.tars-status');
  _tarsThinkSeg = null;

  let answer = '';
  try {
    const r = await fetch('/api/tars/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': _csrf() },
      body: JSON.stringify({ messages: _tarsHistory }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      line.textContent = '⚠ ' + (e.error || ('HTTP ' + r.status)); line.classList.remove('tline-live');
      _tarsStatus('error', 'error');
      _tarsHistory.pop();  // drop the user turn so retry works after fixing config
      return;
    }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let evt = 'message', data = '';
        chunk.split('\n').forEach(l => {
          if (l.startsWith('event:')) evt = l.slice(6).trim();
          else if (l.startsWith('data:')) data += l.slice(5).trim();
        });
        if (!data) continue;
        let obj; try { obj = JSON.parse(data); } catch (e) { continue; }
        if (evt === 'thinking') {
          _tarsThinkText(obj.t || ''); _tarsStatus('thinking', 'Thinking…');
        } else if (evt === 'tool') {
          if (obj.phase === 'call') { _tarsThinkTool(obj.name); _tarsStatus('tool', 'Querying cluster…'); }
          else if (obj.phase === 'result') { _tarsThinkToolDone(obj.input); }
        } else if (evt === 'text') {
          _tarsStatus('responding', 'Responding…');
          answer += obj.t || ''; line.innerHTML = _tarsMd(answer);
          chat.scrollTop = chat.scrollHeight;
        } else if (evt === 'error') {
          line.textContent = '⚠ ' + (obj.detail || obj.error || 'error');
          _tarsStatus('error', 'error');
        }
      }
    }
    if (answer) _tarsHistory.push({ role: 'assistant', content: answer });
    else { _tarsHistory.pop(); if (!line.textContent) line.textContent = '(no output)'; }
  } catch (e) {
    _tarsStatus('error', 'error');
    if (!line.textContent) line.textContent = '⚠ ' + e;
    _tarsHistory.pop();
  } finally {
    _tarsBusy = false;
    line.classList.remove('tline-live');
    _tarsFinishThink(answer);
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = ''; }
    _tarsPersistActive();
  }
}

function _tarsPageShow() {
  _tarsLoadInfo();
  const c = el('tars-chat'); if (c && !_tarsHistory.length && !c.firstChild) _tarsRenderEmpty();
  setTimeout(() => { const i = el('tars-input'); if (i) i.focus(); }, 60);
}
// ── Shared search/filter toolbar — the single source of toolbar markup ───────
// Activity (src/42-activity.js) and Compute (src/26-compute.js + proxmox.html)
// both build their filter toolbar from THESE functions, so the two cannot
// visually diverge: every piece — search field, dropdown button, menu panel,
// menu item, chip — comes from one place. Page-specific bits (icons, handlers,
// which filters exist, open/close state) are passed in; all markup lives here.
//
//   _searchToolbar({ leading, search, controls, chips, clearAll, chipsId })
//     leading   HTML for the leading segmented pills (period / status), or ''
//     search    { id, placeholder, value, oninput, onclear } — handlers are JS exprs
//     controls  HTML for the dropdown buttons + menus (built with _stBtn/_stMenu)
//     chips     HTML of active-filter chips (built with _stChip), or '' / null
//     clearAll  JS expr for the "Clear all" button (only shown when chips present)
//     chipsId   if set (and no chips passed), emit an empty <div id> for live updates

const _ST_SEARCH_ICO = '<svg class="hd-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const _ST_X14  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const _ST_X13  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const _ST_CHEV = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const _ST_CHECK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function _stSearch(o) {
  return '<div class="hd-search-wrap" style="max-width:400px;min-width:200px;flex:1">'
    + _ST_SEARCH_ICO
    + '<input id="' + o.id + '" class="hd-search" type="text" placeholder="' + esc(o.placeholder || '') + '" value="' + String(o.value || '').replace(/"/g, '&quot;') + '" oninput="' + o.oninput + '">'
    + '<button class="hd-search-clear" onclick="' + o.onclear + '">' + _ST_X14 + '</button>'
    + '</div>';
}
// Dropdown trigger button. o.icon = svg HTML; o.badge = count (falsy → hidden).
function _stBtn(o) {
  return '<button type="button"' + (o.id ? ' id="' + o.id + '"' : '') + ' onclick="' + o.onclick + '" class="hd-tbtn">'
    + (o.icon || '') + esc(o.label)
    + (o.badge ? '<span class="hd-tbtn-badge"' + (o.badgeId ? ' id="' + o.badgeId + '"' : '') + '>' + o.badge + '</span>' : '')
    + '<span class="hd-tbtn-chev">' + _ST_CHEV + '</span>'
    + '</button>';
}
// Dropdown = trigger button + (when open) its menu, in a positioned wrapper.
// `data-hd-menu` marks "inside a dropdown" for the shared outside-click close.
// o = _stBtn opts + { open: bool, menu: html }.
function _stDropdown(o) {
  return '<div class="hd-menuwrap" data-hd-menu style="position:relative">' + _stBtn(o) + (o.open ? o.menu : '') + '</div>';
}
// Menu panel. width = px (optional). body = sections/items HTML.
function _stMenu(width, body) {
  return '<div class="hd-menu"' + (width ? ' style="width:' + width + 'px"' : '') + '>' + body + '</div>';
}
function _stMenuHdr(label) { return '<div class="hd-menu-hdr">' + label + '</div>'; }
function _stMenuSep() { return '<div style="height:1px;background:var(--c-border);margin:6px 0"></div>'; }
// Multi-select item — left checkbox (fills accent when checked).
function _stCheckItem(label, checked, onclick) {
  return '<button onclick="' + onclick + '" class="hd-menu-item">'
    + '<span style="width:14px;height:14px;border-radius:3px;border:1px solid var(--c-border);background:' + (checked ? 'var(--c-accent)' : 'transparent') + ';color:var(--c-accent-contrast);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">' + (checked ? _ST_CHECK : '') + '</span>'
    + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(label) + '</span></button>';
}
// Single-select item — right checkmark (shown via .sel toggled by the page).
function _stRadioItem(label, dataV, onclick) {
  return '<button class="hd-menu-item" data-v="' + esc(dataV) + '" onclick="' + onclick + '">' + esc(label)
    + '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>';
}
// Muted "clear" item with a leading ✕.
function _stClearItem(label, onclick) {
  return '<button onclick="' + onclick + '" class="hd-menu-item" style="color:var(--c-muted);font-size:12px">' + _ST_X13 + ' ' + esc(label) + '</button>';
}
// Active-filter chip. value already collapsed ("N selected") by the caller.
function _stChip(label, value, remove) {
  return '<span class="hd-chip"><span style="color:var(--c-muted)">' + esc(label) + ':</span>'
    + '<span style="font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(value) + '</span>'
    + '<button onclick="' + remove + '" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:none;background:transparent;color:var(--c-muted);cursor:pointer;border-radius:9999px" onmouseover="this.style.background=\'var(--c-border)\'" onmouseout="this.style.background=\'transparent\'">' + _ST_X14 + '</button></span>';
}
function _searchToolbar(cfg) {
  const hasChips = !!(cfg.chips && cfg.chips.length);
  return '<div class="hd-toolbar">'
    + '<div class="hd-toolbar-row">' + (cfg.leading || '') + _stSearch(cfg.search) + (cfg.controls || '') + '</div>'
    + (hasChips
        ? '<div class="hd-chips"' + (cfg.chipsId ? ' id="' + cfg.chipsId + '"' : '') + '>' + cfg.chips
          + (cfg.clearAll ? '<button onclick="' + cfg.clearAll + '" style="font-size:12px;color:var(--c-muted);background:none;border:none;cursor:pointer;padding:4px 8px;font-family:inherit">Clear all</button>' : '')
          + '</div>'
        : (cfg.chipsId ? '<div id="' + cfg.chipsId + '" class="hd-chips" style="display:none"></div>' : ''))
    + '</div>';
}
// ── Health ────────────────────────────────────────────────────────────────
// ── Health: helper for latency colour
function _healthLatencyColor(ms){
  if(ms==null) return 'var(--c-dim)';
  if(ms<150) return '#22C55E';
  if(ms<500) return '#F59E0B';
  return '#EF4444';
}
// ── Health: tiny inline SVG sparkline for an array of numbers (or nulls)
let _hsGradN = 0;
function _healthSparkline(values, width, height, color){
  width = width || 140; height = height || 22;
  const vals = values.filter(v => v != null);
  if (!vals.length) return `<svg width="${width}" height="${height}"></svg>`;
  const max = Math.max(...vals, 1), min = 0;
  const n = values.length;
  const stepX = width / Math.max(1, n - 1);
  const yOf = v => height - ((v - min) / (max - min || 1)) * (height - 2) - 1;
  // Stroke path + per-continuous-run area paths (nulls split the line into
  // segments; each segment gets its own fill down to the baseline so gaps
  // stay gaps instead of being bridged by the fill).
  let d = '', areas = '', seg = [];
  const gid = 'hd-hsg' + (++_hsGradN);
  const flush = () => {
    if (seg.length > 1) {
      const a = 'M' + seg[0][0] + ',' + height + ' ' + seg.map(p => 'L' + p[0] + ',' + p[1]).join(' ')
        + ' L' + seg[seg.length-1][0] + ',' + height + ' Z';
      areas += `<path d="${a}" fill="url(#${gid})" stroke="none"/>`;
    }
    seg = [];
  };
  values.forEach((v, i) => {
    if (v == null) { flush(); return; }
    const x = (i * stepX).toFixed(1), y = yOf(v).toFixed(1);
    d += (d === '' || !seg.length ? 'M' : 'L') + x + ',' + y + ' ';
    seg.push([x, y]);
  });
  flush();
  // Last-point dot
  let last = null;
  for (let i = values.length - 1; i >= 0; i--) { if (values[i] != null) { last = {i, v: values[i]}; break; } }
  const dot = last ? `<circle cx="${(last.i * stepX).toFixed(1)}" cy="${yOf(last.v).toFixed(1)}" r="2" fill="${color}"/>` : '';
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">`
    + `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">`
      + `<stop offset="0" stop-color="${color}" stop-opacity="0.25"/>`
      + `<stop offset="1" stop-color="${color}" stop-opacity="0"/>`
    + `</linearGradient></defs>`
    + areas
    + `<path class="hd-spark" d="${d}" fill="none" stroke="${color}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>${dot}</svg>`;
}

// Header meta line: up count, who's down (and for how long), auto/custom
// split, average latency, 24h uptime across every check's history.
function _healthHdrMeta(health){
  const target=el('health-hdr-meta'); if(!target) return;
  const svcs=Object.entries(health).filter(([,v])=>typeof v==='object'&&v!==null);
  const mi=(icon,inner)=>'<span class="page-hdr-meta-item">'+svg(icon,13)+inner+'</span>';
  const sep='<span class="page-hdr-meta-sep"></span>';
  if(!svcs.length){ target.innerHTML=mi('activity','<b>0</b> checks'); return; }
  const up=svcs.filter(([,v])=>v.up===true);
  const down=svcs.filter(([,v])=>v.up!==true);
  const auto=svcs.filter(([,v])=>!v.url).length;
  const now=Date.now()/1000;
  // Down-for duration: last transition to down in the history ring. A check
  // that was never up within the ring has been down for AT LEAST the ring's
  // span — say so with a '+' instead of passing the ring length off as fact.
  const downFor=(v)=>{
    const hist=(v.history||[]).map(h=>typeof h==='object'&&h?h:{up:!!h,ts:null});
    let since=null, floor=false;
    for(let i=hist.length-1;i>=0;i--){
      if(hist[i].up){ since=(hist[i+1]&&hist[i+1].ts)||null; break; }
      if(i===0){ since=hist[0].ts; floor=true; }
    }
    if(!since) return '';
    const m=Math.max(1,Math.round((now-since)/60));
    return (m<60?m+'m':Math.floor(m/60)+'h'+(m%60?m%60+'m':''))+(floor?'+':'');
  };
  // Average current latency across up checks that report one.
  const lats=up.map(([,v])=>v.latency_ms).filter(v=>v!=null);
  const avgLat=lats.length?Math.round(lats.reduce((a,b)=>a+b,0)/lats.length):null;
  // Uptime over the history window — labelled with the window the ring
  // ACTUALLY covers (capped at 24h), not a flat "24h" claim.
  let ok=0,tot=0,oldest=now;
  svcs.forEach(([,v])=>(v.history||[]).forEach(h=>{
    const o=typeof h==='object'&&h?h:{up:!!h,ts:null};
    if(o.ts && now-o.ts<=86400){ tot++; if(o.up) ok++; if(o.ts<oldest) oldest=o.ts; }
  }));
  const upPct=tot?(ok/tot*100):null;
  const spanS=now-oldest;
  const winLbl=spanS>=82800?'24h':spanS>=3600?Math.round(spanS/3600)+'h':Math.max(1,Math.round(spanS/60))+'m';
  const upClr=upPct==null?'':upPct>=99.9?'#22C55E':upPct>=99?'#F59E0B':'#EF4444';
  let html=mi('activity','<b'+(down.length?' style="color:#EF4444"':'')+'>'+up.length+'/'+svcs.length+'</b> checks up');
  if(down.length===1){
    const d=downFor(down[0][1]);
    html+=sep+mi('shield','<b style="color:#EF4444">'+esc(down[0][0])+'</b> down'+(d?' '+d:''));
  } else if(down.length>1){
    html+=sep+'<span class="page-hdr-meta-item" title="'+esc(down.map(([k])=>k).join(', '))+'">'
      +svg('shield',13)+'<b style="color:#EF4444">'+down.length+'</b> down</span>';
  }
  html+=sep+mi('layers','<b>'+svcs.length+'</b> check'+(svcs.length===1?'':'s'));
  if(avgLat!=null) html+=sep+mi('gauge','avg <b>'+avgLat+' ms</b>');
  if(upPct!=null) html+=sep+mi('clock','<b'+(upClr?' style="color:'+upClr+'"':'')+'>'
    +(upPct>=99.95?'100':upPct.toFixed(upPct>=99?2:1))+'%</b> uptime ('+winLbl+')');
  target.innerHTML=html;
}

function renderHealth(health) {
  if(!health||!Object.keys(health).length){
    setInner('health-grid','<div style="font-size:12px;color:var(--c-muted)">No health data</div>');
    _healthHdrMeta({});
    return;
  }
  if(health.error){
    setInner('health-grid',offlineCard('Health checks', health.error));
    _healthHdrMeta({});
    return;
  }
  _healthHdrMeta(health);
  const _svcs = Object.entries(health).filter(([,v])=>typeof v==='object'&&v!==null);
  const _up = _svcs.filter(([,v])=>v.up===true).length;
  const TICKS=90;
  const _healthCardHtml=(name,info)=>{
    const up=info.up===true;
    // History entries are now objects {up, latency_ms, ts}; tolerate legacy bools.
    const hist=(info.history||[]).map(h => typeof h === 'object' ? h : { up: !!h, latency_ms: null });
    const upPct=hist.length?Math.round(hist.filter(h=>h.up).length/hist.length*100):(up?100:0);
    const ticks=Array.from({length:TICKS},(_,i)=>{
      const idx=hist.length-TICKS+i;
      const bg=idx<0?'var(--c-bar-bg)':hist[idx].up?'#22C55E':'#EF4444';
      return `<span class="htick" style="background:${bg}"></span>`;
    }).join('');
    // Latency sparkline (only over the up samples)
    const latencies = hist.slice(-TICKS).map(h => h.up ? h.latency_ms : null);
    const hasLatency = latencies.some(v => v != null);
    const avgLat = (() => {
      const vals = latencies.filter(v => v != null);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
    })();
    const sparkColor = _healthLatencyColor(avgLat);
    const sparkline = hasLatency ? `
      <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
        <span class="eyebrow">Latency</span>
        <div style="flex:1;min-width:0">${_healthSparkline(latencies, 200, 22, sparkColor).replace('width="200"', 'width="100%"')}</div>
        <span style="font-size:10px;font-variant-numeric:tabular-nums;color:${sparkColor};font-weight:600">${avgLat!=null?avgLat+'ms':'—'}</span>
      </div>` : '';
    // SSL cert chip
    const certDays = info.cert_days_remaining;
    const certChip = certDays != null ? (() => {
      const cls = (certDays < 0 || certDays < 7) ? 'badge-down' : certDays < 30 ? 'badge-warn' : 'badge-neutral';
      const lbl = certDays < 0 ? 'EXPIRED' : certDays + 'd';
      return `<span class="badge ${cls}" title="SSL cert expires in ${certDays} days" style="gap:3px">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>${lbl}
      </span>`;
    })() : '';
    // Status code + error line for DOWN cards
    const statusLine = !up ? (() => {
      const msg = info.error || (info.status_code ? `HTTP ${info.status_code}` : 'unreachable');
      return `<div style="font-size:10px;color:#EF4444;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(msg)}">${esc(msg)}</div>`;
    })() : '';
    // Current latency value (next to UP badge if available)
    const curLatHtml = up && info.latency_ms != null ?
      `<span style="font-size:10px;color:${_healthLatencyColor(info.latency_ms)};font-weight:600;font-variant-numeric:tabular-nums">${info.latency_ms}ms</span>` : '';
    // Auto checks that are up but degraded (e.g. Ceph HEALTH_WARN) get a warn chip.
    const warnChip = (up && info.note && /WARN/i.test(String(info.note)))
      ? `<span class="badge badge-warn">${esc(String(info.note))}</span>` : '';
    // Auto checks have no URL — render a plain card, not a link to '#'.
    const healthUrl = safeHttpUrl(info.url);
    const open = healthUrl
      ? `<a class="hd-card p-4 block card-hover" href="${escAttr(healthUrl)}" target="_blank" rel="noopener">`
      : `<div class="hd-card p-4 block">`;
    const close = healthUrl ? '</a>' : '</div>';
    return `${open}
      <div class="flex items-center gap-2 mb-3">
        ${sdot(up?'online':'offline')}
        <span class="font-medium text-sm flex-1" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
        ${certChip}${warnChip}
        <span class="badge ${up?'badge-up':'badge-down'}">${up?'UP':'DOWN'}</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
        <div style="display:flex;align-items:center;gap:6px">
          <span class="eyebrow">Uptime</span>
          <span style="font-size:11px;color:var(--c-text);font-weight:600">${upPct}%</span>
        </div>
        ${curLatHtml}
      </div>
      <div class="flex gap-px overflow-hidden" style="justify-content:flex-end">${ticks}</div>
      ${sparkline}
      ${statusLine}
    ${close}`;
  };
  // Zero-config cluster checks derived from the Proxmox snapshot. (Custom HTTP
  // probes were removed — the console covers cluster health end to end.)
  const entries = Object.entries(health).filter(([,v])=>typeof v==='object'&&v!==null&&'up' in v);
  const checks = entries.filter(([,v])=>v.auto);
  const html = checks.length
    ? '<div class="hd-row-3">'+checks.map(([n,i])=>_healthCardHtml(n,i)).join('')+'</div>'
    : '<div style="font-size:12px;color:var(--c-muted)">No checks yet — connect a Proxmox cluster in Settings.</div>';
  setInner('health-grid',html);
}

// ── Health console: Active Issues · Node Vitals · Subsystems · Timeline ──────
// All derived from the live snapshot (proxmox/ceph/pbs/tasks/health) — zero
// config, any Proxmox cluster. Called alongside renderHealth each health tick.
function renderHealthConsole(data){
  const px = data.proxmox || {}, ceph = data.ceph || {}, pbs = data.pbs || {};
  // Backups subsystem needs PBS groups/snapshots (lazy-loaded, stripped from
  // the WS tick) — kick the fetch once so coverage/verify/freshness populate.
  if (pbs.status === 'online' && !window._pbsDetail && typeof _loadPbsDetail === 'function') _loadPbsDetail();
  const nodes = (px.nodes || []);
  const health = data.health || {};
  const _show = (id, on) => { const s = el(id); if (s) s.style.display = on ? '' : 'none'; };
  const now = Date.now() / 1000;

  // ---- Active Issues -------------------------------------------------------
  const issues = [];
  const push = (sev, icon, who, what, page) => issues.push({ sev, icon, who, what, page });
  // down checks (with how long). Skip the AUTO node/ceph checks — the dedicated
  // "node offline" / "Ceph …" rows below say the same thing (avoids a duplicate
  // e.g. both "Node pve1 check failing" and "pve1 node offline").
  Object.entries(health).forEach(([k, v]) => {
    if (!v || typeof v !== 'object' || !('up' in v) || v.up === true) return;
    if (v.auto && (/^Node /.test(k) || k === 'Ceph')) return;
    const hist = (v.history || []).map(h => typeof h === 'object' ? h : { up: !!h, ts: null });
    let since = null;
    for (let i = hist.length - 1; i >= 0; i--) { if (hist[i].up) { since = (hist[i + 1] && hist[i + 1].ts) || null; break; } if (i === 0) since = hist[0].ts; }
    const dur = since ? ' · ' + _hDur(now - since) : '';
    push(3, 'shield', esc(k), 'check failing' + dur + (v.error ? ' — ' + esc(String(v.error).slice(0, 60)) : ''), 'health');
  });
  // ceph not OK
  if (ceph && ceph.status === 'online' && (ceph.health || '').toUpperCase() !== 'HEALTH_OK')
    push((ceph.health || '').includes('ERR') ? 3 : 2, 'database', 'Ceph', (ceph.health || '?').replace('HEALTH_', '') + ((ceph.pgs_by_state || []).length ? ' · ' + (ceph.pgs_by_state.filter(p => !/(^|\+)active\+clean$/.test(p.state)).map(p => p.count + ' ' + p.state).join(', ') || '') : ''), 'health');
  // offline nodes
  nodes.forEach(n => { if (n.status && n.status !== 'online') push(3, 'server', esc(n.node), 'node offline', 'compute'); });
  // storage over threshold
  ((px.storage) ? _storageAgg(px.storage) : []).forEach(s => {
    const pct = s.maxdisk ? Math.round(s.disk / s.maxdisk * 100) : 0;
    if (pct >= 90) push(3, 'gauge', esc(s.name), pct + '% full — ' + fmtBytes(Math.max(0, s.maxdisk - s.disk)) + ' free', 'storage');
    else if (pct >= 85) push(2, 'gauge', esc(s.name), pct + '% full', 'storage');
  });
  // PBS backup failures
  const _grp = (pbs.groups && pbs.groups.length) ? pbs.groups : ((window._pbsDetail || {}).groups || []);
  const failed = _grp.reduce((a, g) => a + (g.failed_count || 0), 0);
  if (failed) push(2, 'archive', 'Backups', failed + ' failed backup' + (failed === 1 ? '' : 's') + ' in PBS', 'backups');
  // drive SMART / wear
  Object.values(px.storage_drives || {}).flat().forEach(d => {
    const ok = !d.health || /^(passed|ok|unknown)$/i.test(d.health);
    if (!ok) push(3, 'hard-drive', esc((d.devpath || '').replace('/dev/', '')) + ' · ' + esc(d.node || ''), 'SMART ' + esc(d.health), 'storage');
    else if (d.wearout != null && d.wearout < 15) push(2, 'hard-drive', esc((d.devpath || '').replace('/dev/', '')) + ' · ' + esc(d.node || ''), d.wearout + '% life remaining', 'storage');
  });
  // certs expiring
  nodes.forEach(n => { if (n.cert_days != null && n.cert_days < 21) push(n.cert_days < 0 ? 3 : 2, 'shield', esc(n.node), 'TLS cert ' + (n.cert_days < 0 ? 'EXPIRED' : 'expires in ' + n.cert_days + 'd'), 'health'); });
  issues.sort((a, b) => b.sev - a.sev);
  const issEl = el('health-issues');
  if (issEl) {
    if (issues.length) {
      issEl.innerHTML = issues.map(i => {
        const c = i.sev >= 3 ? '#EF4444' : '#F59E0B';
        return '<div class="health-iss" onclick="showPage(\'' + i.page + '\')">'
          + '<span class="health-iss-dot" style="background:' + c + '"></span>'
          + '<span style="color:var(--c-muted);display:inline-flex">' + svg(i.icon, 14) + '</span>'
          + '<span class="health-iss-who">' + i.who + '</span>'
          + '<span class="health-iss-what">' + i.what + '</span>'
          + '<span class="health-iss-go">' + i.page + ' →</span></div>';
      }).join('');
    }
    _show('health-issues-sec', issues.length > 0);
  }

  // ---- Node Vitals (sortable) ----------------------------------------------
  window._healthVitalNodes = nodes.filter(n => n.status === 'online');
  _show('health-vitals-sec', window._healthVitalNodes.length > 0);
  _renderHealthVitals();

  // ---- Tasks (sortable, scrollable) ----------------------------------------
  window._healthTasks = (data.tasks || {}).tasks || [];
  _renderHealthTasks();
  _show('health-timeline-sec', true);
}

// Friendly label for a Proxmox task type.
function _taskLabel(t) {
  const ty = { vzdump: 'Backup', qmigrate: 'Migrate VM', vzmigrate: 'Migrate CT', qmstart: 'Start VM',
    qmstop: 'Stop VM', qmshutdown: 'Shutdown VM', vzstart: 'Start CT', vzstop: 'Stop CT', vzshutdown: 'Shutdown CT',
    startall: 'Start all', stopall: 'Stop all', imgcopy: 'Copy disk', aptupgrade: 'apt upgrade',
    qmclone: 'Clone VM', qmcreate: 'Create VM', vncproxy: 'Console', vncshell: 'Shell',
    spiceproxy: 'Console', download: 'Download', qmrestore: 'Restore VM', vzrestore: 'Restore CT' }[t.type] || t.type;
  return ty + (t.id ? ' ' + t.id : '');
}
// Sort state persists across the WS re-renders so the chosen order sticks.
window._taskSort = window._taskSort || { key: 'start', dir: -1 };
function _taskSortBy(key) {
  const s = window._taskSort;
  if (s.key === key) s.dir = -s.dir; else { s.key = key; s.dir = key === 'start' ? -1 : 1; }
  _renderHealthTasks();
}
function _renderHealthTasks() {
  const tlEl = el('health-timeline');
  if (!tlEl) return;
  const tasks = window._healthTasks || [];
  if (!tasks.length) { tlEl.innerHTML = '<div style="font-size:12px;color:var(--c-muted);padding:16px">No recent cluster tasks.</div>'; return; }
  const now = Date.now() / 1000;
  const dur = t => t.running ? (now - t.start) : (t.end ? Math.max(0, t.end - t.start) : null);
  const s = window._taskSort;
  const key = t => s.key === 'start' ? (t.start || 0)
    : s.key === 'dur' ? (dur(t) || 0)
    : s.key === 'task' ? _taskLabel(t).toLowerCase()
    : s.key === 'node' ? (t.node || '')
    : s.key === 'user' ? (t.user || '')
    : s.key === 'status' ? (t.running ? 0 : t.failed ? 1 : 2)   // running, failed, ok
    : 0;
  const sorted = tasks.slice().sort((a, b) => { const av = key(a), bv = key(b); return (av < bv ? -1 : av > bv ? 1 : 0) * s.dir; });
  const nFail = tasks.filter(t => t.failed).length;
  const car = k => s.key === k ? (s.dir < 0 ? ' ▾' : ' ▴') : '';
  const th = (k, lbl, extra) => '<th onclick="_taskSortBy(\'' + k + '\')" style="position:sticky;top:0;background:var(--c-card);z-index:1;padding:9px 14px;text-align:' + (extra === 'r' ? 'right' : 'left') + ';font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:' + (s.key === k ? 'var(--c-text)' : 'var(--c-muted)') + ';white-space:nowrap;cursor:pointer;user-select:none">' + lbl + car(k) + '</th>';
  const td = (v, extra) => '<td style="padding:8px 14px;font-size:12.5px;white-space:nowrap;' + (extra || '') + '">' + v + '</td>';
  const rows = sorted.map(t => {
    const tag = t.running ? ['#3B82F6', 'RUNNING'] : t.failed ? ['#EF4444', 'FAILED'] : ['#22C55E', 'OK'];
    const d = dur(t);
    return '<tr style="border-top:1px solid var(--c-border)">'
      + td('<span style="color:var(--c-muted);font-variant-numeric:tabular-nums">' + _hClock(t.start) + '</span>')
      + td(d == null ? '<span style="color:var(--c-dim)">—</span>' : (t.running ? '<span style="color:#3B82F6">' + _hDur(d) + '…</span>' : _hDur(d)), 'font-variant-numeric:tabular-nums')
      + td('<span style="font-weight:500">' + esc(_taskLabel(t)) + '</span>' + (t.failed && t.status ? ' <span style="color:#EF4444;font-size:11px">— ' + esc(String(t.status).slice(0, 40)) + '</span>' : ''))
      + td(t.node ? esc(t.node) : '<span style="color:var(--c-dim)">—</span>')
      + td(t.user ? '<span style="color:var(--c-muted)">' + esc(t.user) + '</span>' : '<span style="color:var(--c-dim)">—</span>')
      + td('<span class="badge" style="background:' + tag[0] + '22;color:' + tag[0] + '">' + tag[1] + '</span>')
      + '</tr>';
  }).join('');
  tlEl.innerHTML = (nFail ? '<div style="font-size:11px;color:#EF4444;font-weight:600;padding:10px 14px 0">' + nFail + ' failed task' + (nFail === 1 ? '' : 's') + ' in the last 7 days</div>' : '')
    + '<div style="max-height:460px;overflow:auto">'
    + '<table style="width:100%;border-collapse:collapse;min-width:680px">'
    + '<thead><tr>' + th('start', 'Time') + th('dur', 'Duration') + th('task', 'Task') + th('node', 'Node') + th('user', 'User') + th('status', 'Status') + '</tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';
}

// Node Vitals — sortable table (state survives the WS re-render).
window._sortState.vitals = window._sortState.vitals || { k: 'node', d: 1 };
function _vitalSort(key) { _sortSet('vitals', key, key === 'node' ? 1 : -1, _renderHealthVitals); }
function _renderHealthVitals() {
  const vEl = el('health-vitals'); if (!vEl) return;
  const nodes = window._healthVitalNodes || [];
  const td = (v, extra) => '<td style="padding:9px 14px;font-size:13px;white-space:nowrap;' + (extra || '') + '">' + v + '</td>';
  const pad = 'padding:9px 14px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase';
  const key = (n, k) => k === 'node' ? (n.node || '').toLowerCase() : k === 'uptime' ? (n.uptime || 0)
    : k === 'pve' ? (n.pveversion || '') : k === 'kernel' ? (n.kernel || '')
    : k === 'updates' ? (n.updates || 0) : k === 'cert' ? (n.cert_days == null ? Infinity : n.cert_days) : 0;
  const rows = _sortApply('vitals', nodes, key).map(n => {
    const updClr = n.updates > 50 ? '#EF4444' : n.updates > 0 ? '#F59E0B' : '#22C55E';
    const certClr = n.cert_days < 0 ? '#EF4444' : n.cert_days < 30 ? '#F59E0B' : 'var(--c-text)';
    const flags = n.reboot_required ? ' <span class="badge badge-warn">reboot</span>' : '';
    return '<tr style="border-top:1px solid var(--c-border)">'
      + td('<span class="stor-dot" style="display:inline-block;width:8px;height:8px;background:#22C55E;box-shadow:0 0 5px #22C55E80;margin-right:8px;vertical-align:middle"></span>'
           + '<span style="font-weight:600">' + esc(n.node) + '</span>' + flags)
      + td(fmtUptime(n.uptime))
      + td(n.pveversion ? esc(n.pveversion) : '<span style="color:var(--c-dim)">—</span>')
      + td(n.kernel ? esc(n.kernel) : '<span style="color:var(--c-dim)">—</span>')
      + td(n.updates != null ? '<span style="color:' + updClr + '">' + (n.updates || 0) + ' pending</span>' : '<span style="color:var(--c-dim)">—</span>')
      + td(n.cert_days != null ? '<span style="color:' + certClr + '">' + (n.cert_days < 0 ? 'expired' : n.cert_days + ' days') + '</span>' : '<span style="color:var(--c-dim)">—</span>')
      + '</tr>';
  }).join('');
  vEl.innerHTML = '<div class="hd-card" style="overflow-x:auto;padding:0"><table style="width:100%;border-collapse:collapse;min-width:640px">'
    + '<thead><tr>'
    + _sortTh('vitals', 'node', 'Node', "_vitalSort('node')", 'left', pad)
    + _sortTh('vitals', 'uptime', 'Uptime', "_vitalSort('uptime')", 'left', pad)
    + _sortTh('vitals', 'pve', 'PVE', "_vitalSort('pve')", 'left', pad)
    + _sortTh('vitals', 'kernel', 'Kernel', "_vitalSort('kernel')", 'left', pad)
    + _sortTh('vitals', 'updates', 'Updates', "_vitalSort('updates')", 'left', pad)
    + _sortTh('vitals', 'cert', 'TLS cert', "_vitalSort('cert')", 'left', pad)
    + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

// duration + clock helpers for the health console
function _hDur(sec){
  sec = Math.max(0, Math.round(sec));
  if (sec < 60) return sec + 's';
  const m = Math.floor(sec / 60); if (m < 60) return m + 'm';
  const h = Math.floor(m / 60); if (h < 48) return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '');
  return Math.floor(h / 24) + 'd';
}
function _hClock(ts){
  if (!ts) return '—';
  const d = new Date(ts * 1000), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                 : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Health: 24h heatmap (services × hour grid) ────────────────────────────
// Upcoming releases (Sonarr / Radarr / Lidarr calendars). Fetched on
// demand when the Automation page is entered — calendars don't change
// every 10s so we keep this out of the WS hot path.
// Uptime heatmap — same shell pattern as the backups page: toolbar (with
// pill row + sliding thumb) is rendered ONCE so the slide animation isn't
// interrupted on each range change. Body / summary / legend get re-painted
// on each fetch.
async function loadHealthHeatmap(hours) {
  hours = hours || window._hmHours || 24;
  window._hmHours = hours;

  const root = el('health-heatmap');
  if (!root) return;
  _hmRenderShell(root);

  const url = `/api/health/heatmap?hours=${hours}`;
  const body = el('hm-body');
  if (body && !_swrHas(url)) body.innerHTML = '<div class="text-xs" style="color:var(--c-muted);padding:8px 0">Loading…</div>';

  try {
    const d = await _swrJSON(url, () => loadHealthHeatmap(hours));
    _hmRender(d);
  } catch (e) {
    if (body) body.innerHTML = `<div class="text-xs" style="color:#EF4444">Heatmap error: ${escText(e.message)}</div>`;
  }
}

function _hmRenderShell(container) {
  if (el('hm-hist-range')) return;
  const ranges = [
    { lbl: '1d',  hours: 24 },
    { lbl: '7d',  hours: 168 },
    { lbl: '30d', hours: 720 },
    { lbl: '90d', hours: 2160 },
  ];
  const active = window._hmHours || 24;
  const pillRow = `<div class="hist-range" id="hm-hist-range">${
    ranges.map(r => `<button class="hist-btn${r.hours===active?' active':''}" onclick="_hmSetRange(${r.hours},this)">${r.lbl}</button>`).join('')
  }</div>`;
  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;flex-wrap:wrap">
      <div id="hm-summary" style="display:flex;align-items:center;gap:10px;font-size:11px;color:var(--c-muted)"></div>
      <div style="margin-left:auto">${pillRow}</div>
    </div>
    <div id="hm-body"></div>
    <div id="hm-legend"></div>
  `;
  _histSchedule();
}

// Split an auto-check name into a {type, name} pair for the heatmap's Type column
// and a cleaner label (e.g. "Node pve1" → type Node, name pve1).
function _hmMeta(svc) {
  let m;
  if (/^Cluster/.test(svc))          return { type: 'Cluster', name: svc.replace(/^Cluster\s*/, '') || 'quorum', ord: 0 };
  if ((m = /^Node (.+)$/.exec(svc))) return { type: 'Node',    name: m[1], ord: 1 };
  if (svc === 'Ceph')                return { type: 'Ceph',    name: 'Ceph', ord: 2 };
  if ((m = /^Storage (.+)$/.exec(svc))) return { type: 'Storage', name: m[1], ord: 3 };
  if (svc === 'PBS')                 return { type: 'Backup',  name: 'PBS', ord: 4 };
  return { type: 'Service', name: svc, ord: 5 };   // custom HTTP checks
}

function _hmRender(d) {
  const services = (d.service_names || []).slice()
    .sort((a, b) => { const A = _hmMeta(a), B = _hmMeta(b); return A.ord - B.ord || A.name.localeCompare(B.name); });
  const buckets  = d.hours || [];
  const body     = el('hm-body');
  const summary  = el('hm-summary');
  const legend   = el('hm-legend');
  if (!body) return;

  if (!services.length) {
    body.innerHTML = '<div class="text-xs" style="color:var(--c-muted);padding:8px 0">No data yet — health checks need to run for a while first.</div>';
    if (summary) summary.innerHTML = '';
    if (legend)  legend.innerHTML = '';
    return;
  }

  const cellColor = pct => {
    if (pct == null) return 'var(--c-bar-bg)';
    if (pct >= 90) return '#22C55E';
    if (pct >= 50) return '#F59E0B';
    return '#EF4444';
  };

  // Fixed cell size at every range so the density of squares is identical
  // across pill choices — longer ranges just scroll further horizontally
  // (matches the GitHub contribution-graph convention).
  const n = buckets.length;
  const CELL = 14, GAP = 2;
  const gridW = n * (CELL + GAP) - GAP;

  // Context-aware axis labels — backend labels alone (HH:00 or "May 24")
  // lose meaning across long hourly windows. Re-derive from start_ts so
  // each range gets the right granularity + format.
  const axisLabels = [];
  if (d.bucket_hours === 24) {
    // Daily buckets — every Nth day at "May 24"
    const stride = n <= 30 ? 3 : n <= 90 ? 7 : Math.max(1, Math.floor(n/12));
    for (let i = 0; i < n; i += stride) {
      const dt = new Date(buckets[i].start_ts * 1000);
      axisLabels.push({ x: i*(CELL+GAP), text: dt.toLocaleDateString('default', { month: 'short', day: 'numeric' }) });
    }
  } else if (n <= 24) {
    // 24h hourly — show every 4th hour
    for (let i = 0; i < n; i += 4) {
      const dt = new Date(buckets[i].start_ts * 1000);
      axisLabels.push({ x: i*(CELL+GAP), text: dt.toLocaleTimeString('default', { hour: '2-digit', minute: '2-digit', hour12: false }) });
    }
  } else {
    // Hourly across multiple days (7d view) — anchor labels to midnight,
    // showing the day name so the axis reads like a calendar strip.
    for (let i = 0; i < n; i++) {
      const dt = new Date(buckets[i].start_ts * 1000);
      if (dt.getHours() === 0) {
        axisLabels.push({ x: i*(CELL+GAP), text: dt.toLocaleDateString('default', { weekday: 'short' }) });
      }
    }
    // Fallback: if start_ts never lands on midnight (clock skew, partial
    // first day), at least put a label at the start.
    if (!axisLabels.length) {
      const dt = new Date(buckets[0].start_ts * 1000);
      axisLabels.push({ x: 0, text: dt.toLocaleDateString('default', { weekday: 'short' }) });
    }
  }
  let axisSvg = `<svg width="${gridW}" height="18" viewBox="0 0 ${gridW} 18" style="display:block">`;
  for (const lbl of axisLabels) {
    axisSvg += `<text x="${lbl.x}" y="13" font-size="10" font-weight="600" fill="var(--c-text)">${esc(lbl.text)}</text>`;
  }
  axisSvg += '</svg>';

  // Per-service rows
  const rowFor = (svc) => {
    const row = d.cells[svc] || [];
    let svg = `<svg width="${gridW}" height="${CELL}" viewBox="0 0 ${gridW} ${CELL}" style="display:block">`;
    for (let i = 0; i < n; i++) {
      const pct = row[i];
      const x = i * (CELL+GAP);
      const t = pct == null ? `${buckets[i].label}: no data` : `${buckets[i].label}: ${pct}% up`;
      svg += `<rect x="${x}" y="0" width="${CELL}" height="${CELL}" rx="2" fill="${cellColor(pct)}"><title>${t}</title></rect>`;
    }
    svg += '</svg>';
    const meta = _hmMeta(svc);
    return `<div class="bk-hm-row">
      <div class="bk-hm-label" title="${esc(svc)}">
        <span class="bk-hm-type">${esc(meta.type)}</span>
        <span class="bk-hm-name">${esc(meta.name)}</span>
      </div>
      ${svg}
    </div>`;
  };

  // Summary: avg uptime across the window
  let totalUp = 0, totalSamples = 0;
  for (const svc of services) {
    for (const v of (d.cells[svc] || [])) {
      if (v != null) { totalUp += v; totalSamples++; }
    }
  }
  const avgUptime = totalSamples > 0 ? (totalUp / totalSamples).toFixed(1) : '—';
  const bucketLbl = (d.bucket_hours === 24) ? 'day' : 'hour';

  const headLabel = `<div class="bk-hm-label"><span class="bk-hm-type" style="color:var(--c-dim)">Type</span><span class="bk-hm-name" style="color:var(--c-dim);font-weight:600">Service</span></div>`;
  body.innerHTML = `<div class="bk-hm-scroll"><div class="bk-hm-table"><div class="bk-hm-row bk-hm-head">${headLabel}${axisSvg}</div>${services.map(rowFor).join('')}</div></div>`;
  // Start scrolled to the right edge so "now" is visible on wide ranges.
  const _hmScroll = body.querySelector('.bk-hm-scroll');
  if (_hmScroll) _hmScroll.scrollLeft = _hmScroll.scrollWidth;
  if (summary) summary.innerHTML = `<span><b style="color:var(--c-text);font-weight:600">${services.length}</b> services</span><span style="opacity:.4">·</span><span><b style="color:var(--c-text);font-weight:600">${avgUptime}%</b> avg uptime</span><span style="opacity:.4">·</span><span><b style="color:var(--c-text);font-weight:600">${n}</b> ${bucketLbl}${n===1?'':'s'}</span>`;
  if (legend) legend.innerHTML = `<div style="display:flex;align-items:center;gap:12px;font-size:11px;color:var(--c-muted);margin-top:10px;justify-content:flex-end">
    <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:11px;height:11px;background:#22C55E;border-radius:2px;display:inline-block"></span>≥90%</span>
    <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:11px;height:11px;background:#F59E0B;border-radius:2px;display:inline-block"></span>≥50%</span>
    <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:11px;height:11px;background:#EF4444;border-radius:2px;display:inline-block"></span>&lt;50%</span>
    <span style="display:inline-flex;align-items:center;gap:5px"><span style="width:11px;height:11px;background:var(--c-bar-bg);border-radius:2px;display:inline-block"></span>no data</span>
  </div>`;
}

function _hmSetRange(hours, btn) {
  const range = btn.parentElement;
  if (range) {
    range.querySelectorAll('.hist-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _histThumbUpdate('hm');
  }
  loadHealthHeatmap(hours);
}
// ── Security page ───────────────────────────────────────────────────────────
// Read-only security posture, entirely snapshot-derived (data.security from the
// backend fetch_security, plus node cert/patch fields and the task log). Every
// section fault-isolates: a token without Sys.Audit on /access simply hides the
// Access/Tokens sections rather than breaking Firewall/Repos/Certs.
function _secRerender() { if (window._secData) renderSecurity(window._secData); }
function _secUserSort(k) { _sortSet('secusers', k, (k === 'userid' || k === 'realm') ? 1 : -1, _secRerender); }
function _secTokSort(k)  { _sortSet('sectokens', k, (k === 'owner' || k === 'tokenid') ? 1 : -1, _secRerender); }
function _secAuditSort(k){ _sortSet('secaudit', k, k === 'start' ? -1 : 1, _secRerender); }

function renderSecurity(data) {
  window._secData = data;
  const sec = data.security || {};
  const nodes = (data.proxmox || {}).nodes || [];
  const tasks = (data.tasks || {}).tasks || [];
  const _show = (id, on) => { const s = el(id); if (s) s.style.display = on ? '' : 'none'; };
  const _td = (v, ex) => '<td style="padding:8px 14px;font-size:12.5px;white-space:nowrap;' + (ex || '') + '">' + v + '</td>';
  const _thPad = 'padding:9px 14px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase';
  const card = h => '<div class="hd-card" style="padding:0;overflow-x:auto">' + h + '</div>';
  const now = Date.now() / 1000;
  const badge = (txt, color) => '<span class="badge" style="background:' + color + '22;color:' + color + '">' + txt + '</span>';
  const GREEN = '#22C55E', AMBER = '#F59E0B', RED = '#EF4444', DIM = 'var(--c-dim)';

  // ── Posture summary (header meta) ─────────────────────────────────────────
  const _svgSm = p => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  const IC_SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>';
  const IC_USERS = '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>';
  const IC_KEY = '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2m-4 4 3 3"/>';
  const IC_REFRESH = '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>';
  const mi = (icP, html) => '<span class="page-hdr-meta-item">' + _svgSm(icP) + ' ' + html + '</span>';
  const meta = [];
  const users = Array.isArray(sec.users) ? sec.users : null;
  const tfaKnown = !!sec.tfa_known;
  if (sec.firewall) {
    const on = sec.firewall.enable == 1;
    meta.push(mi(IC_SHIELD, '<b style="color:' + (on ? GREEN : AMBER) + '">Firewall ' + (on ? 'on' : 'off') + '</b>'));
  }
  if (users && tfaKnown) {
    const gaps = users.filter(u => u.enable == 1 && u.tfa === false).length;
    meta.push(mi(IC_USERS, '<b style="color:' + (gaps ? AMBER : GREEN) + '">' + gaps + '</b> without 2FA'));
  }
  const privTok = (sec.tokens || []).filter(t => t.privsep == 0).length;
  if (sec.tokens && sec.tokens.length) meta.push(mi(IC_KEY, '<b' + (privTok ? ' style="color:' + AMBER + '"' : '') + '>' + privTok + '</b> full-priv tokens'));
  const hm = el('security-hdr-meta'); if (hm) hm.innerHTML = meta.join('');

  // ── Access & Identity ─────────────────────────────────────────────────────
  const accEl = el('sec-access');
  if (accEl && (users || (sec.realms && sec.realms.length))) {
    let html = '';
    if (sec.realms && sec.realms.length) {
      html += '<div style="padding:12px 16px 4px;font-size:12px;color:var(--c-muted)">Realms: '
        + sec.realms.map(r => '<span class="badge" style="background:var(--c-hover);color:var(--c-text);margin-right:4px">' + esc(r.realm) + ' <span style="color:var(--c-dim)">' + esc(r.type) + '</span></span>').join('') + '</div>';
    }
    if (users && users.length) {
      const key = (u, k) => k === 'userid' ? (u.userid || '').toLowerCase() : k === 'realm' ? (u.realm || '')
        : k === 'enable' ? (u.enable == 1 ? 0 : 1) : k === 'tfa' ? (u.tfa === true ? 0 : u.tfa === false ? 1 : 2)
        : k === 'expire' ? (u.expire || Infinity) : k === 'tokens' ? ((sec.tokens || []).filter(t => t.owner === u.userid).length) : 0;
      const th = (k, l) => _sortTh('secusers', k, l, "_secUserSort('" + k + "')", 'left', _thPad);
      const rows = _sortApply('secusers', users, key).map(u => {
        const tkn = (sec.tokens || []).filter(t => t.owner === u.userid).length;
        const tfaCell = !tfaKnown ? '<span style="color:' + DIM + '">—</span>'
          : u.tfa ? badge('2FA', GREEN) : badge('none', AMBER);
        const exp = !u.expire ? '<span style="color:' + DIM + '">never</span>'
          : (u.expire < now ? '<span style="color:' + RED + '">expired</span>' : new Date(u.expire * 1000).toLocaleDateString());
        return '<tr style="border-top:1px solid var(--c-border)">'
          + _td('<span style="font-weight:600">' + esc(u.userid) + '</span>' + (u.comment ? ' <span style="color:' + DIM + ';font-size:11px">' + esc(u.comment) + '</span>' : ''))
          + _td('<span style="color:var(--c-muted)">' + esc(u.realm) + '</span>')
          + _td(u.enable == 1 ? badge('enabled', GREEN) : badge('disabled', DIM))
          + _td(tfaCell)
          + _td(exp)
          + _td(tkn ? tkn : '<span style="color:' + DIM + '">—</span>', 'text-align:right');
      }).join('');
      html += card('<table style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr>'
        + th('userid', 'User') + th('realm', 'Realm') + th('enable', 'Status') + th('tfa', '2FA') + th('expire', 'Expires') + th('tokens', 'Tokens')
        + '</tr></thead><tbody>' + rows + '</tbody></table>');
      if (!tfaKnown) html += '<div style="font-size:11px;color:var(--c-dim);padding:8px 16px">2FA status needs a token with Sys.Audit on /access — shown as "—".</div>';
    } else {
      html += '<div class="hd-card p-4" style="font-size:12px;color:var(--c-muted)">User &amp; 2FA data needs a token with <b>Sys.Audit</b> on <code>/access</code>. Realms above are what the current token can see.</div>';
    }
    accEl.innerHTML = html;
    _show('sec-access-sec', true);
  } else _show('sec-access-sec', false);

  // ── API Tokens ────────────────────────────────────────────────────────────
  const tokEl = el('sec-tokens'), tokens = sec.tokens || [];
  if (tokEl && tokens.length) {
    const key = (t, k) => k === 'owner' ? (t.owner || '').toLowerCase() : k === 'tokenid' ? (t.tokenid || '')
      : k === 'privsep' ? (t.privsep == 0 ? 0 : 1) : k === 'expire' ? (t.expire || Infinity) : 0;
    const th = (k, l) => _sortTh('sectokens', k, l, "_secTokSort('" + k + "')", 'left', _thPad);
    const rows = _sortApply('sectokens', tokens, key).map(t => {
      const exp = !t.expire ? '<span style="color:' + DIM + '">never</span>'
        : (t.expire < now ? '<span style="color:' + RED + '">expired</span>' : new Date(t.expire * 1000).toLocaleDateString());
      return '<tr style="border-top:1px solid var(--c-border)">'
        + _td('<span style="color:var(--c-muted)">' + esc(t.owner) + '</span>')
        + _td('<span style="font-weight:600">' + esc(t.tokenid) + '</span>' + (t.comment ? ' <span style="color:' + DIM + ';font-size:11px">' + esc(t.comment) + '</span>' : ''))
        + _td(t.privsep == 0 ? badge('full privileges', AMBER) : badge('separated', GREEN))
        + _td(exp);
    }).join('');
    tokEl.innerHTML = card('<table style="width:100%;border-collapse:collapse;min-width:560px"><thead><tr>'
      + th('owner', 'Owner') + th('tokenid', 'Token') + th('privsep', 'Priv. separation') + th('expire', 'Expires')
      + '</tr></thead><tbody>' + rows + '</tbody></table>');
    _show('sec-tokens-sec', true);
  } else _show('sec-tokens-sec', false);

  // ── Firewall ────────────────────────────────────────────────────────────────
  const fwEl = el('sec-firewall'), fw = sec.firewall;
  if (fwEl && fw) {
    const on = fw.enable == 1;
    const pol = p => p ? (/DROP|REJECT/i.test(p) ? '<span style="color:' + GREEN + '">' + esc(p) + '</span>' : '<span style="color:' + AMBER + '">' + esc(p) + '</span>') : '<span style="color:' + DIM + '">—</span>';
    const kv = (k, v) => '<div style="display:flex;justify-content:space-between;gap:16px;font-size:12.5px;padding:5px 0"><span style="color:var(--c-muted)">' + k + '</span><span style="font-weight:500">' + v + '</span></div>';
    const perNode = (sec.nodes || []).filter(n => n.fw_enable != null);
    fwEl.innerHTML = '<div class="hd-card p-4">'
      + kv('Cluster firewall', on ? badge('enabled', GREEN) : badge('disabled', AMBER))
      + kv('Default inbound', pol(fw.policy_in))
      + kv('Default outbound', pol(fw.policy_out))
      + (fw.rules != null ? kv('Cluster rules', fw.rules) : '')
      + (perNode.length ? '<div style="border-top:1px solid var(--c-border);margin-top:8px;padding-top:8px">'
          + perNode.map(n => kv(esc(n.node), n.fw_enable == 1 ? badge('on', GREEN) : badge('off', AMBER))).join('') + '</div>' : '')
      + '</div>';
    _show('sec-firewall-sec', true);
  } else _show('sec-firewall-sec', false);

  // Certificates + per-node updates/repos intentionally live on the Health page
  // (Node Vitals) to avoid duplicating the same data across two pages.

  // ── Recent Logins ───────────────────────────────────────────────────────────
  // Proxmox doesn't expose an auth-login history API; the closest signal in the
  // task log is interactive access — console/shell/login sessions (vncshell,
  // vncproxy, spiceproxy, termproxy, login). Filter the task log to those.
  const auEl = el('sec-audit');
  const logins = tasks.filter(t => /^(login|vncshell|vncproxy|spiceproxy|termproxy)/i.test(t.type || ''));
  if (auEl && logins.length) {
    const key = (t, k) => k === 'start' ? (t.start || 0) : k === 'user' ? (t.user || '')
      : k === 'via' ? (typeof _taskLabel === 'function' ? _taskLabel(t).toLowerCase() : (t.type || ''))
      : k === 'node' ? (t.node || '') : k === 'status' ? (t.running ? 0 : t.failed ? 1 : 2) : 0;
    const th = (k, l) => _sortTh('secaudit', k, l, "_secAuditSort('" + k + "')", 'left', _thPad);
    const lbl = t => typeof _taskLabel === 'function' ? _taskLabel(t) : ((t.type || '') + (t.id ? ' ' + t.id : ''));
    // Always show the date + time (not time-only for today) — a login log needs
    // the day at a glance.
    const clock = t => { if (!t.start) return '—'; const d = new Date(t.start * 1000);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    const rows = _sortApply('secaudit', logins, key).slice(0, 200).map(t => {
      const tag = t.running ? ['#3B82F6', 'ACTIVE'] : t.failed ? [RED, 'FAILED'] : [GREEN, 'OK'];
      return '<tr style="border-top:1px solid var(--c-border)">'
        + _td('<span style="color:var(--c-muted);font-variant-numeric:tabular-nums">' + clock(t) + '</span>')
        + _td('<span style="font-weight:500">' + esc(t.user || '—') + '</span>')
        + _td(esc(lbl(t)))
        + _td('<span style="color:var(--c-muted)">' + esc(t.node || '—') + '</span>')
        + _td('<span class="badge" style="background:' + tag[0] + '22;color:' + tag[0] + '">' + tag[1] + '</span>');
    }).join('');
    auEl.innerHTML = '<div class="hd-card" style="padding:0;overflow-x:auto"><div style="max-height:460px;overflow:auto">'
      + '<table style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr>'
      + th('start', 'Time') + th('user', 'User') + th('via', 'Via') + th('node', 'Node') + th('status', 'Status')
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    _show('sec-audit-sec', true);
  } else _show('sec-audit-sec', false);
}
// ── Overview — Mission Control (triage-first) ───────────────────────────────
// The overview answers one question fast: "is everything healthy, and if not,
// what needs me first?" Layout, top to bottom:
//   • Verdict banner — one-line cluster health call + node/guest/uptime meta
//   • Stat-tile summary row (the house .hd-card p-3 + _statTile pattern)
//   • Needs attention — a synthesized, severity-ranked feed built across every
//     subsystem (nodes, quorum, Ceph, backups, storage, updates, certs, health,
//     firewall, 2FA, stopped guests) — each row navigates to its owning page
//   • Cluster pulse — a per-node rail (CPU/RAM/load/iowait) + a Ceph one-liner
//   • Cluster load — the live utilization history chart (loadOvResources)
//   • Top consumers — the hottest guests, CPU⇄RAM toggle
//   • Recent activity — the cluster task log
//
// Everything is derived from the generic Proxmox/Ceph/PBS snapshot, so it renders
// for any environment and each fetcher degrades gracefully when absent/denied.
// renderOverview fires on every WS tick; the chart block (#ov-cluster-charts) is
// saved/restored across the innerHTML rebuild so the Chart.js instance stays live,
// and its data reload is throttled to 5 minutes.

var _ovLeadMode = 'cpu';          // Top-consumers toggle, persisted across ticks
var _ovLastData = null;           // last snapshot, so the toggle can re-render

function _ovAccent() {
  return (getComputedStyle(document.documentElement).getPropertyValue('--c-accent') || '#E57000').trim();
}

// ── Derive: everything the sections read, computed from the snapshot ──────────
function _ovDerive(data) {
  var px = data.proxmox || {}, ceph = data.ceph || {}, hc = data.health || {}, sec = data.security || {};
  var pbs = data.pbs || {}, _pd = window._pbsDetail || {};
  var nodes = (px.nodes || []).slice().sort(function (a, b) { return (a.node || '').localeCompare(b.node || ''); });
  var online = nodes.filter(function (n) { return n.status === 'online'; });
  var vms = px.vms || [], lxcs = px.lxcs || [], guests = vms.concat(lxcs);
  var running = guests.filter(function (g) { return g.status === 'running'; });
  var stopped = guests.filter(function (g) { return g.status !== 'running' && !g.template; });

  var cores = 0, wCpu = 0, mem = 0, memMax = 0;
  nodes.forEach(function (n) { cores += n.maxcpu || 0; wCpu += (n.cpu || 0) * (n.maxcpu || 0); mem += n.mem || 0; memMax += n.maxmem || 0; });
  var cpuPct = cores ? Math.round(wCpu / cores * 100) : 0;
  var memPct = memMax ? Math.round(mem / memMax * 100) : 0;

  var stores = _storageAgg(px.storage || []);
  var stUsed = stores.reduce(function (a, s) { return a + (s.disk || 0); }, 0);
  var stCap = stores.reduce(function (a, s) { return a + (s.maxdisk || 0); }, 0);
  var stPct = stCap ? Math.round(stUsed / stCap * 100) : 0;

  var cephOn = ceph && ceph.status === 'online';
  var cephOk = cephOn && String(ceph.health || '').toUpperCase().indexOf('ERR') < 0;
  var cephPct = ceph.usable_percent != null ? Math.round(ceph.usable_percent)
    : (ceph.usable_total_bytes ? Math.round((ceph.usable_used_bytes || 0) / ceph.usable_total_bytes * 100) : 0);

  var pbsOn = pbs.status === 'online' || (pbs.datastores && pbs.datastores.length);
  var groups = (pbs.groups && pbs.groups.length) ? pbs.groups : (_pd.groups || []);
  var snaps = ((pbs.snapshots && pbs.snapshots.length) ? pbs.snapshots : (_pd.snapshots || [])).length;
  var latest = groups.reduce(function (m, g) { return Math.max(m, g.latest_time || 0); }, 0);
  var failedB = groups.reduce(function (a, g) { return a + (g.failed_count || 0); }, 0);
  var ds = (pbs.datastores || [])[0] || null;
  var staleH = latest ? ((Date.now() / 1000 - latest) / 3600) : null;

  var hKeys = Object.keys(hc).filter(function (k) { return hc[k] && typeof hc[k] === 'object' && 'up' in hc[k]; });
  var hDown = hKeys.filter(function (k) { return !hc[k].up; });

  var tasks = (data.tasks && data.tasks.tasks) || [];
  var failedTasks = tasks.filter(function (t) { return t.failed; });

  var users = (sec.users || []).filter(function (u) { return u.enable; });
  var noTfa = users.filter(function (u) { return !u.tfa; });
  var fw = sec.firewall || null;

  // ── Attention feed ──────────────────────────────────────────────────────
  var att = [];
  function A(sev, ic, t, d, page) { att.push({ sev: sev, ic: ic, t: t, d: d, page: page }); }
  nodes.filter(function (n) { return n.status !== 'online'; }).forEach(function (n) {
    A('crit', 'server', 'Node offline — ' + n.node, 'Cluster is running degraded', 'proxmox'); });
  if (nodes.length > 1 && online.length <= nodes.length / 2)
    A('crit', 'alert-triangle', 'Quorum lost', online.length + '/' + nodes.length + ' nodes online', 'proxmox');
  if (cephOn && !cephOk)
    A(String(ceph.health).toUpperCase().indexOf('ERR') >= 0 ? 'crit' : 'warn', 'database',
      'Ceph ' + String(ceph.health || '').replace('HEALTH_', ''),
      (ceph.num_up_osds != null ? ceph.num_up_osds + '/' + ceph.num_osds + ' OSDs up' : 'Cluster health degraded'), 'health');
  failedTasks.slice(0, 3).forEach(function (t) {
    A('crit', 'archive', 'Backup failed — ' + (t.type === 'vzdump' ? 'guest ' : '') + t.id,
      esc(t.status || 'failed') + ' · ' + timeAgo((t.start || 0) * 1000), 'backups'); });
  if (failedB) A('crit', 'archive', failedB + ' failed backup' + (failedB > 1 ? 's' : ''), 'In the Proxmox Backup Server history', 'backups');
  if (staleH != null && staleH > 36) A('warn', 'clock', 'Backups are stale', 'Last successful backup ' + timeAgo(latest * 1000), 'backups');
  stores.filter(function (s) { return s.maxdisk && s.disk / s.maxdisk > 0.9; }).forEach(function (s) {
    var p = Math.round(s.disk / s.maxdisk * 100);
    A('crit', 'hard-drive', 'Storage almost full — ' + s.name, p + '% used (' + fmtBytes(s.disk) + ' / ' + fmtBytes(s.maxdisk) + ')', 'storage'); });
  stores.filter(function (s) { var p = s.maxdisk ? s.disk / s.maxdisk : 0; return p > 0.75 && p <= 0.9; }).forEach(function (s) {
    A('warn', 'hard-drive', 'Storage filling — ' + s.name, Math.round(s.disk / s.maxdisk * 100) + '% used', 'storage'); });
  nodes.filter(function (n) { return n.reboot_required; }).forEach(function (n) {
    A('warn', 'rotate-ccw', 'Reboot required — ' + n.node, 'A kernel or microcode update is pending', 'proxmox'); });
  var upd = nodes.filter(function (n) { return (n.updates || 0) > 0; });
  if (upd.length) { var tot = upd.reduce(function (a, n) { return a + n.updates; }, 0);
    A('info', 'arrow-up-circle', tot + ' package update' + (tot > 1 ? 's' : '') + ' available',
      upd.map(function (n) { return n.node + ' (' + n.updates + ')'; }).join(', '), 'proxmox'); }
  nodes.filter(function (n) { return n.cert_days != null && n.cert_days < 30; }).forEach(function (n) {
    A('warn', 'shield', 'TLS certificate expiring — ' + n.node, n.cert_days + ' days remaining', 'security'); });
  hDown.forEach(function (k) { A('crit', 'activity', 'Health check down — ' + k, esc((hc[k] || {}).error || 'unreachable'), 'health'); });
  if (fw && fw.enable != null && fw.enable != 1) A('warn', 'shield', 'Cluster firewall disabled', 'Datacenter firewall policy is off', 'security');
  if (noTfa.length) A('warn', 'users', noTfa.length + ' account' + (noTfa.length > 1 ? 's' : '') + ' without 2FA',
    noTfa.map(function (u) { return u.userid; }).join(', '), 'security');
  if (stopped.length) A('info', 'power', stopped.length + ' guest' + (stopped.length > 1 ? 's' : '') + ' stopped',
    stopped.map(function (g) { return g.name; }).join(', '), 'proxmox');
  var rank = { crit: 0, warn: 1, info: 2 };
  att.sort(function (a, b) { return rank[a.sev] - rank[b.sev]; });
  var nCrit = att.filter(function (a) { return a.sev === 'crit'; }).length;
  var nWarn = att.filter(function (a) { return a.sev === 'warn'; }).length;
  var nInfo = att.filter(function (a) { return a.sev === 'info'; }).length;

  var byCpu = running.map(function (g) { return { g: g, v: (g.cpu || 0) * (g.maxcpu || 0) }; }).sort(function (a, b) { return b.v - a.v; });
  var byMem = running.map(function (g) { return { g: g, v: g.mem || 0 }; }).sort(function (a, b) { return b.v - a.v; });

  return { ceph: ceph, cephOn: cephOn, cephOk: cephOk, cephPct: cephPct, nodes: nodes, online: online,
    guests: guests, running: running, stopped: stopped, cores: cores, cpuPct: cpuPct, memPct: memPct,
    stores: stores, stUsed: stUsed, stCap: stCap, stPct: stPct, pbsOn: pbsOn, groups: groups, snaps: snaps,
    latest: latest, failedB: failedB, ds: ds, hKeys: hKeys, hDown: hDown, tasks: tasks,
    att: att, nCrit: nCrit, nWarn: nWarn, nInfo: nInfo, byCpu: byCpu, byMem: byMem };
}

// ── semantic status colors (documented palette — allowed as literals) ─────────
var _OV_G = '#22C55E', _OV_A = '#F59E0B', _OV_R = '#EF4444', _OV_N = '#6B7280';
function _ovSev(s) { return s === 'crit' ? _OV_R : s === 'warn' ? _OV_A : _OV_N; }

// Lucide-style icons used by the task feed + consumers header that aren't in
// the shared registry (svg() falls back to the shared _IC for everything else).
var _OV_IC = {
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
};
function _ovSvg(name, size) {
  size = size || 16;
  if (_OV_IC[name]) return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + _OV_IC[name] + '</svg>';
  return svg(name, size);
}
function _ovBar(p, hex) {
  return '<div class="bar"><div class="bar-fill" style="width:' + Math.min(p, 100) + '%;background:' + (hex || barHex(p)) + '"></div></div>';
}

// ── section builders ──────────────────────────────────────────────────────
// The page-header status strip — the house .page-hdr-meta pattern every other
// page uses (small inline item · thin separator · item), not a banner or a row
// of boxed tiles. The health verdict leads as a colored dot + count; the rest
// are clickable jumps to their owning page.
function _ovHdrMeta(D) {
  var sev = D.nCrit ? 'crit' : D.nWarn ? 'warn' : 'ok';
  var col = sev === 'ok' ? _OV_G : _ovSev(sev);
  var sep = '<span class="page-hdr-meta-sep"></span>';
  var mi = function (page, inner) {
    return '<span class="page-hdr-meta-item" style="cursor:pointer" onclick="showPage(\'' + esc(page) + '\')">' + inner + '</span>';
  };
  var items = [];
  items.push('<span class="page-hdr-meta-item">'
    + '<span style="width:8px;height:8px;border-radius:50%;background:' + col + ';display:inline-block"></span> '
    + '<b style="color:' + col + '">' + (sev === 'ok' ? 'Healthy' : D.att.length) + '</b> '
    + (sev === 'ok' ? '' : 'need attention') + '</span>');
  items.push(mi('proxmox', svg('server', 13) + ' <b' + (D.online.length < D.nodes.length ? ' style="color:' + _OV_A + '"' : '') + '>' + D.online.length + '/' + D.nodes.length + '</b> nodes'));
  items.push(mi('proxmox', svg('monitor', 13) + ' <b>' + D.running.length + '/' + D.guests.length + '</b> guests'));
  items.push(mi('storage', svg('database', 13) + ' <b' + (D.stPct > 90 ? ' style="color:' + _OV_R + '"' : D.stPct > 75 ? ' style="color:' + _OV_A + '"' : '') + '>' + D.stPct + '%</b> storage'));
  items.push(mi('health', svg('activity', 13) + ' <b' + (D.hDown.length ? ' style="color:' + _OV_R + '"' : '') + '>' + (D.hKeys.length - D.hDown.length) + '/' + D.hKeys.length + '</b> checks'));
  if (D.cephOn) items.push(mi('health', svg('database', 13) + ' <b style="color:' + (D.cephOk ? _OV_G : _OV_A) + '">' + esc(String(D.ceph.health || '').replace('HEALTH_', '')) + '</b> Ceph'));
  if (D.pbsOn) items.push(mi('backups', svg('archive', 13) + ' ' + (D.failedB ? '<b style="color:' + _OV_R + '">' + D.failedB + '</b> failed' : '<b>' + (D.ds ? Math.round(D.ds.percent) + '%' : '—') + '</b> backups')));
  return items.join(sep);
}

var _OV_SEVW = { crit: 'Critical', warn: 'Warning', info: 'Review' };
function _ovAttention(D) {
  if (!D.att.length) return '<div class="ovm-att-empty">' + svg('check', 16) + ' Nothing needs attention — every node, backup and health check is green.</div>';
  return '<div class="ovm-att">' + D.att.map(function (a) {
    return '<div class="ovm-att-row" style="--sev:' + _ovSev(a.sev) + '" onclick="showPage(\'' + esc(a.page) + '\')" title="Open ' + esc(a.page) + '">'
      + '<span class="ovm-att-dot"></span><span class="ovm-att-sev">' + _OV_SEVW[a.sev] + '</span>'
      + '<div class="ovm-att-body"><div class="ovm-att-t">' + esc(a.t) + '</div><div class="ovm-att-d">' + esc(a.d) + '</div></div>'
      + '<span class="ovm-att-go">' + esc(a.page) + ' &rsaquo;</span></div>';
  }).join('') + '</div>';
}

function _ovNodeChip(n) {
  if (n.status !== 'online') return '<span class="ovm-node-chip" style="background:' + _OV_R + '22;color:' + _OV_R + '">offline</span>';
  if (n.reboot_required) return '<span class="ovm-node-chip" style="background:' + _OV_A + '22;color:' + _OV_A + '">reboot</span>';
  if ((n.updates || 0) > 0) return '<span class="ovm-node-chip" style="background:var(--c-hover);color:var(--c-muted)">' + n.updates + ' upd</span>';
  return '<span class="ovm-node-chip" style="background:' + _OV_G + '1f;color:' + _OV_G + '">online</span>';
}

function _ovNodeRail(D) {
  var acc = _ovAccent();
  return '<div class="ovm-noderail">' + D.nodes.map(function (n) {
    var cp = Math.round((n.cpu || 0) * 100), mp = n.maxmem ? Math.round((n.mem || 0) / n.maxmem * 100) : 0;
    var gc = D.guests.filter(function (g) { return g.node === n.node; }).length;
    return '<div class="ovm-node">'
      + '<div class="ovm-node-top">' + svg('server', 13) + '<span class="ovm-node-nm">' + esc(n.node) + '</span>' + _ovNodeChip(n) + '</div>'
      + '<div class="ovm-node-meta">' + gc + ' guests · ' + fmtUptime(n.uptime) + '</div>'
      + '<div class="ovm-metric"><span class="ml">CPU</span>' + _ovBar(cp, acc) + '<span class="mv"' + (cp > 85 ? ' style="color:' + _OV_R + '"' : '') + '>' + cp + '%</span></div>'
      + '<div class="ovm-metric"><span class="ml">RAM</span>' + _ovBar(mp, _OV_G) + '<span class="mv"' + (mp > 85 ? ' style="color:' + _OV_R + '"' : '') + '>' + mp + '%</span></div>'
      + '<div class="ovm-metric" style="margin-top:5px"><span class="ml">load</span>'
        + '<span style="grid-column:2/4;font-size:10.5px;color:var(--c-muted)">' + (n.loadavg != null ? n.loadavg.toFixed(2) : '—')
          + ' · iowait ' + (n.iowait != null ? n.iowait.toFixed(1) : '—') + '% · ' + (n.maxcpu || 0) + ' cores</span></div>'
      + '</div>';
  }).join('') + '</div>';
}

function _ovLeadHtml(D) {
  var mode = _ovLeadMode, acc = _ovAccent();
  var rows = (mode === 'mem' ? D.byMem : D.byCpu).slice(0, 6);
  var maxv = rows.length ? rows[0].v : 1;
  if (!rows.length) return '<div style="font-size:12px;color:var(--c-muted);padding:8px 0">No running guests.</div>';
  return rows.map(function (r, i) {
    var g = r.g, w = maxv ? Math.round(r.v / maxv * 100) : 0;
    var val = mode === 'mem' ? fmtBytes(g.mem) : ((g.cpu * g.maxcpu).toFixed(1) + ' vCPU');
    return '<div class="ovm-lead-row">'
      + '<span class="ovm-lead-rank">' + (i + 1) + '</span>'
      + '<span class="ovm-lead-nm">' + esc(g.name) + '<span class="n">' + (g.type === 'qemu' ? 'VM' : 'CT') + ' ' + g.vmid + ' · ' + esc(g.node) + '</span></span>'
      + '<div style="width:88px">' + _ovBar(w, mode === 'mem' ? _OV_G : acc) + '</div>'
      + '<span class="ovm-lead-val">' + val + '</span></div>';
  }).join('');
}
function _ovSetLead(m) {
  _ovLeadMode = m;
  var box = el('ov-lead'); if (box && _ovLastData) box.innerHTML = _ovLeadHtml(_ovDerive(_ovLastData));
  ['cpu', 'mem'].forEach(function (k) { var b = el('ov-lead-tab-' + k); if (b) b.classList.toggle('active', k === m); });
}

function _ovTaskIcon(t) {
  var m = { vzdump: 'archive', login: 'log-in', vncshell: 'terminal', termproxy: 'terminal',
    qmstart: 'power', qmstop: 'power', vzstart: 'power', vzstop: 'power' };
  return m[t.type] || 'activity';
}
function _ovTaskLabel(t) {
  if (t.type === 'vzdump') return 'Backup ' + (t.failed ? 'failed' : 'completed') + ' — <b>guest ' + esc(t.id) + '</b>';
  if (t.type === 'login') return 'Login — <b>' + esc(t.user) + '</b>';
  if (t.type === 'vncshell' || t.type === 'termproxy') return 'Console session — <b>' + esc(t.node) + '</b>';
  return esc(t.type) + ' — <b>' + esc(t.id) + '</b>';
}
function _ovTasks(D) {
  var rows = D.tasks.slice(0, 7);
  if (!rows.length) return '<div style="font-size:12px;color:var(--c-muted);padding:8px 0">No recent cluster tasks.</div>';
  return rows.map(function (t) {
    return '<div class="ovm-task">'
      + '<div class="ovm-task-ic"' + (t.failed ? ' style="color:' + _OV_R + ';background:' + _OV_R + '18"' : '') + '>' + _ovSvg(_ovTaskIcon(t), 15) + '</div>'
      + '<div class="ovm-task-body"><div class="ovm-task-t">' + _ovTaskLabel(t) + '</div>'
        + '<div class="ovm-task-m">' + esc(t.user) + ' · ' + esc(t.node) + (t.failed ? ' · <span style="color:' + _OV_R + '">' + esc(t.status) + '</span>' : '') + '</div></div>'
      + '<div class="ovm-task-time">' + timeAgo((t.start || 0) * 1000) + '</div></div>';
  }).join('');
}

// ── render ──────────────────────────────────────────────────────────────────
function renderOverview(data) {
  var ovEl = el('overview-status'); if (!ovEl) return;
  ovEl.className = ''; ovEl.removeAttribute('style');
  _ovLastData = data;
  var D = _ovDerive(data);
  var hdr = el('overview-hdr-meta'); if (hdr) hdr.innerHTML = _ovHdrMeta(D);   // house inline status strip

  var acc = _ovAccent();

  // Attention card (flagship) + Cluster pulse (node rail + Ceph line)
  var attCard = '<div class="hd-card" style="padding:16px">'
    + '<div class="ovm-ch">' + svg('activity', 15) + '<h3>Needs attention</h3>'
      + (D.att.length ? '<span class="sub" style="margin-left:auto">' + D.att.length + ' open</span>' : '') + '</div>'
    + _ovAttention(D) + '</div>';
  var cephLine = D.cephOn
    ? '<div class="ovm-node-foot"><span>' + svg('database', 12) + ' Ceph ' + esc(String(D.ceph.health || '').replace('HEALTH_', ''))
        + (D.ceph.num_up_osds != null ? ' · ' + D.ceph.num_up_osds + '/' + D.ceph.num_osds + ' OSDs' : '') + '</span>'
        + '<span>' + D.cephPct + '% of ' + fmtBytes(D.ceph.usable_total_bytes) + '</span></div>'
    : '';
  var pulseCard = '<div class="hd-card" style="padding:16px">'
    + '<div class="ovm-ch">' + svg('server', 15) + '<h3>Cluster pulse</h3>'
      + '<span style="margin-left:auto;display:inline-flex;align-items:center;gap:6px;font-size:11px;color:var(--c-muted)"><span class="sdot sdot-green dot-live"></span>live</span></div>'
    + _ovNodeRail(D) + cephLine + '</div>';

  // Cluster load chart (live history) — this block is preserved across ticks.
  var loadCard = '<div class="hd-card" style="padding:16px">'
    + '<div class="ovm-ch">' + svg('activity', 15) + '<h3>Cluster load</h3><span class="sub">utilization · % of capacity</span>'
      + '<span style="margin-left:auto" onclick="event.stopPropagation()">' + _histPillRow('ov-infra', ['1d', '7d', '30d', 'All', 'Custom'], { stopPropagation: true }) + '</span></div>'
    + '<div id="ov-cluster-charts">'
      + '<div class="stor-hdr"><span class="stor-hdr-label">CPU &amp; RAM</span>'
        + '<span class="stor-hdr-spacer"></span><span class="stor-legend" id="chart-ov-res-leg"></span></div>'
      + '<div style="position:relative;height:200px"><canvas id="chart-ov-res"></canvas></div>'
    + '</div></div>';

  // Top consumers leaderboard (CPU⇄RAM toggle)
  var consumeCard = '<div class="hd-card" style="padding:16px">'
    + '<div class="ovm-ch">' + _ovSvg('trending-up', 15) + '<h3>Top consumers</h3>'
      + '<span class="ovm-tabs" style="margin-left:auto">'
        + '<button class="ovm-tab' + (_ovLeadMode === 'cpu' ? ' active' : '') + '" id="ov-lead-tab-cpu" onclick="_ovSetLead(\'cpu\')">CPU</button>'
        + '<button class="ovm-tab' + (_ovLeadMode === 'mem' ? ' active' : '') + '" id="ov-lead-tab-mem" onclick="_ovSetLead(\'mem\')">RAM</button>'
      + '</span></div>'
    + '<div id="ov-lead">' + _ovLeadHtml(D) + '</div></div>';

  // Recent activity (task log)
  var taskCard = '<div class="hd-card" style="padding:16px">'
    + '<div class="ovm-ch">' + svg('list', 15) + '<h3>Recent activity</h3><span class="sub" style="margin-left:auto">cluster task log</span></div>'
    + _ovTasks(D) + '</div>';

  // Preserve the live chart block across the every-tick innerHTML rebuild.
  var savedCluster = el('ov-cluster-charts');
  if (savedCluster) savedCluster.remove();

  ovEl.className = 'space-y-6';
  ovEl.innerHTML =
    '<section class="ovm-cols c-2-1">' + attCard + pulseCard + '</section>'
    + '<section class="ovm-cols c-2-1">' + loadCard + consumeCard + '</section>'
    + '<section>' + taskCard + '</section>';
  _histSchedule();

  // Reattach the preserved chart block over its fresh placeholder.
  if (savedCluster) {
    var ph = el('ov-cluster-charts');
    if (ph && ph !== savedCluster) ph.replaceWith(savedCluster);
  }

  // Throttle the chart reload to once per 5 min (WS fires every ~10s); reload
  // immediately if the chart is missing or its canvas got orphaned.
  var now = Date.now();
  var c = _charts['chart-ov-res'];
  var broken = !c || !c.canvas || !c.canvas.isConnected || c.canvas !== el('chart-ov-res');
  if (broken || now - (_ovChartTs || 0) > 300000) {
    _ovChartTs = now;
    setTimeout(function () { loadOvResources(_histGetHours('ov-infra')); }, 0);
  }
}
// ── Main render ───────────────────────────────────────────────────────────
// Per-domain render-gating cache. Each WS tick (~10s) the server pushes a full
// snapshot, but most STABLE domains are byte-identical tick-to-tick — re-running
// their renderer just
// rebuilds the same DOM and repaints for nothing. _renderSig stores a cheap
// JSON signature of each gated domain's input slice; _R skips the renderer when
// the slice is unchanged. Reset on navigation (a fresh page has empty DOM that
// MUST paint) via the _navEpoch signal — see render(). Volatile domains (CPU/RAM
// bars and other live counters) carry NO signature entry, so they render every
// tick exactly as before — liveness is preserved by construction.
let _renderSig = {};
let _renderSigEpoch = -1;
function render(data) {
  if(!data)return;
  // Stale-tab guard: the shell injects window._hdBuild (this page's index.html
  // mtime). Reload only when the server reports a STRICTLY NEWER build — so an
  // older replayed WS payload (sent on reconnect) can't bounce a fresh page,
  // and there's no reload loop.
  if(data.build && window._hdBuild && Number(data.build)>Number(window._hdBuild)){
    location.reload(); return;
  }
  // Keep the latest snapshot so a page loaded *after* this tick (via showPage)
  // can paint immediately from cache instead of waiting up to poll_interval
  // seconds for the next WS broadcast.
  window._lastData = data;
  // Invalidate the per-domain signature cache on navigation: showPage() bumps
  // _navEpoch BEFORE its render(window._lastData) repaint, so the first render
  // onto a freshly-loaded (empty) page clears the cache and paints every active
  // domain. Steady-state WS ticks keep the same epoch, so gating stays in effect.
  if(_renderSigEpoch !== _navEpoch){ _renderSig = {}; _renderSigEpoch = _navEpoch; }
  const px=data.proxmox||{};
  // Each render step is isolated: a throw in one (e.g. a page whose DOM isn't
  // loaded yet) must never abort the rest of the chain. Before this guard, an
  // unhandled throw here would skip every later step — including renderOverview
  // — so the Overview page stayed blank until you visited other pages and the
  // offending render stopped throwing. console.error names the culprit so the
  // underlying null-access can be fixed at its source.
  // Per-page render gate. Each WS tick the server pushes a snapshot covering
  // every domain, but only the page the user is looking at needs its DOM
  // repainted. Skipping the rest is the bulk of the perceived-latency win.
  // Pages that aggregate (overview, topology, health) are listed against every
  // domain they surface. '*' = always.
  const RP={
    nodes:['proxmox','overview','topology'],
    vmlxc:['proxmox','overview','topology'],
    storage:['proxmox','overview'],
    storagePage:['storage'],
    networkPage:['network'],
    backups:['backups','overview','health'],
    ceph:['proxmox','overview','health','storage'],
    health:['health','overview'],
    security:['security'],
    overview:['overview'],
    topology:['topology'],
    meta:'*',
  };
  // Render-source map: the exact snapshot slice each STABLE renderer consumes,
  // for the per-domain gate in _R. A domain is gated only if it appears here;
  // volatile domains (nodes, vmlxc) and the whole-`data` aggregates (overview,
  // topology) + meta are intentionally absent → they render every tick as before
  // (their inputs change each tick, so gating them would never skip anyway).
  const RS={
    backups:  ()=>data.pbs,
    ceph:     ()=>data.ceph,
    // Health page also renders node vitals + ceph + backups + the task timeline,
    // so its gate signature spans those slices (not just the checks dict).
    health:   ()=>[data.health, data.ceph, (data.tasks||{}).tasks, (data.proxmox||{}).nodes, (data.proxmox||{}).storage_drives],
    security: ()=>[data.security, (data.proxmox||{}).nodes, (data.tasks||{}).tasks],
    storage:  ()=>px.storage,
    // storage_io changes every tick and is painted by the chart loaders, so it
    // stays OUT of the gate signature; content is slow-moving and gates fine.
    storagePage: ()=>[px.storage, px.storage_content, px.storage_drives],
    networkPage: ()=>px.network,
  };
  // While a slide-in drawer is open it fully covers the page behind it, so that
  // page must NOT repaint each WS tick: rebuilding invisible DOM is pure waste,
  // and because the drawer overlay lays a full-viewport backdrop-filter:blur
  // over a page that itself stacks blur layers (e.g. the Now Playing cards'
  // blurred poster backdrops), every tick forces an expensive nested-blur
  // recomposite — which is what froze the Overview behind an open session
  // drawer. Freeze the background while any drawer is open; the first tick after
  // it closes repaints normally. 'meta' (title/last-updated) is cheap, keep it.
  const _modalOpen = ['stor-drawer','vm-drawer']
    .some(id=>{const n=el(id);return n&&n.classList.contains('open');});
  const _R=(label,fn)=>{
    const p=RP[label];
    if(p!=='*' && p && !p.includes(currentPage)) return;
    if(_modalOpen && label!=='meta') return;   // keep modal check first so frozen ticks never write the cache
    const src=RS[label];
    if(src){
      let sig; try{ sig=JSON.stringify(src()); }catch(e){ sig=undefined; }
      if(sig!==undefined && sig===_renderSig[label]) return;   // slice unchanged → skip the rebuild
      if(sig!==undefined) _renderSig[label]=sig;
    }
    try{fn();}catch(e){console.error('render['+label+']',e);}
  };
  // Cross-page cache: backups page reads window._pxLast to label PBS targets
  // with their Proxmox host names, so keep it fresh even when vmlxc is gated.
  if(px.vms||px.lxcs) window._pxLast={vms:px.vms||[],lxcs:px.lxcs||[]};
  if(px.web_url) window._pxWebUrl=px.web_url;
  // Compute owns a cards/list layout state, so its renderer must apply that
  // state on the first snapshot as well as every later WS tick. _cmpInit can
  // run before data arrives; falling through to the generic renderers here
  // would paint cards while leaving the List pill active until it was clicked.
  // Overview/Topology still use the generic node/guest render path.
  if(currentPage==='proxmox' && typeof _cmpApply==='function') {
    _R('nodes', ()=>_cmpApply());
  } else {
    _R('nodes', ()=>{ if(px.nodes) renderNodes(_cmpProcess(px.nodes),px.web_url); });
    _R('vmlxc', ()=>{ if(px.vms||px.lxcs) renderVmLxc(_cmpProcess(px.vms||[]),_cmpProcess(px.lxcs||[])); });
  }
  _R('storage', ()=>{ if(px.storage) renderStorage(px.storage); });
  _R('storagePage', ()=>{ if(px.storage) renderStoragePage(px.storage, px.storage_content, px.storage_drives); });
  _R('networkPage', ()=>{ if(typeof renderNetworkPage==='function') renderNetworkPage((px&&px.network)||null); });
  _R('backups', ()=>{ if(data.pbs!==undefined) renderBackups(data.pbs); });
  _R('ceph',    ()=>{ if(data.ceph!==undefined && typeof renderCeph==='function') renderCeph(data.ceph); });
  _R('health',  ()=>{ if(data.health){ renderHealth(data.health); if(typeof renderHealthConsole==='function') renderHealthConsole(data); } });
  _R('security', ()=>{ if(typeof renderSecurity==='function') renderSecurity(data); });
  _R('overview',()=>{ renderOverview(data); });
  _R('topology',()=>{ if(typeof window._topology_update==='function') window._topology_update(data); });
  _R('meta',    ()=>{
    if(data.config_meta?.title){_pageBaseTitle=data.config_meta.title;_setPageTitle(currentPage);const t=el('nav-title');if(t)t.textContent=data.config_meta.title;}
    if(data.timestamp){const ts=new Date(data.timestamp*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});const lu=el('last-updated');if(lu)lu.textContent=ts;}
    const db=el('demo-badge');if(db)db.style.display=data.demo?'':'none';
  });
  // Post-render entrance sweep for the active page: count-up stat numbers, stagger
  // grid cards, draw-on sparklines, stagger heatmap cells (after the renders above
  // populate them — nav fired before the data landed).
  if(typeof _introReveal==='function') _introReveal(currentPage);
}

// ── WebSocket ─────────────────────────────────────────────────────────────
let ws=null,wsRetry=1000;
function wsSetStatus(connected,label){
  const dot=el('ws-dot'),lbl=el('ws-label');
  if(dot){dot.className='sdot flex-shrink-0 '+(connected?'sdot-green dot-live':'sdot-red');}
  if(lbl)lbl.textContent=label;
}
function connect() {
  const proto=location.protocol==='https:'?'wss:':'ws:';
  ws=new WebSocket(`${proto}//${location.host}/ws`);
  ws.onopen=()=>{wsSetStatus(true,'Live');wsRetry=1000;};
  ws.onmessage=e=>{try{const m=JSON.parse(e.data);if(m.type==='update'&&m.data){render(m.data);ws.send('ping');}}catch(err){console.error(err);}};
  ws.onerror=()=>{wsSetStatus(false,'Error');};
  ws.onclose=()=>{wsSetStatus(false,`Reconnect ${wsRetry/1000}s…`);setTimeout(connect,wsRetry);wsRetry=Math.min(wsRetry*2,30000);};
}

// ── Dark mode ─────────────────────────────────────────────────────────────
function toggleDark(){
  const dark=document.documentElement.classList.toggle('dark');
  localStorage.setItem('hd-dark',dark?'1':'0');
  ['','mob'].forEach(sfx=>{
    const m=el('dm-icon-moon'+(sfx?'-'+sfx:'')),s=el('dm-icon-sun'+(sfx?'-'+sfx:''));
    if(m)m.style.display=dark?'none':'block';
    if(s)s.style.display=dark?'block':'none';
  });
  _refreshChartsForTheme();
  _syncThemeColor();
  // Logo default is theme-dependent (/api/logo?theme=…) — re-apply unless a
  // browser-local URL override is pinned.
  try { applyLogo(localStorage.getItem('hd-logo') || ''); } catch(e){}
}

// Live theme switch: charts cache Chart.defaults.color / borderColor at
// construction, so axis ticks + grid lines keep their stale theme until the
// chart is rebuilt. Push fresh defaults, patch the few charts that hardcode
// grid colors at construction, then call update('none') on every live chart.
function _refreshChartsForTheme(){
  if (typeof Chart === 'undefined') return;
  try { _chartDefaults(); } catch(e){}
  const dark = _isDark();
  const tickColor   = dark ? '#A1A1AA' : '#71717A';
  const borderColor = dark ? '#27272A' : '#E4E4E7';
  const gridSoft    = dark ? 'rgba(255,255,255,.04)' : 'rgba(0,0,0,.04)';
  const registries = [typeof _charts !== 'undefined' ? _charts : null];
  const charts = [];
  registries.forEach(r => { if (r) Object.values(r).forEach(c => c && charts.push(c)); });
  charts.forEach(ch => {
    try {
      const sc = ch.options && ch.options.scales;
      if (sc) {
        Object.values(sc).forEach(s => {
          if (!s) return;
          // Axis line (the vertical/horizontal line bordering the plot area).
          // Chart.js v4 caches the resolved value at first draw, so push the
          // new theme color explicitly rather than relying on defaults.
          s.border = Object.assign({}, s.border, { color: borderColor });
          // Tick label color.
          s.ticks = Object.assign({}, s.ticks);
          if (typeof s.ticks.color !== 'function') s.ticks.color = tickColor;
          // Grid lines — only override the soft fixed-rgba shades from
          // construction; don't clobber per-chart custom colors.
          if (s.grid && s.grid.color != null && typeof s.grid.color !== 'function') {
            const c = String(s.grid.color);
            if (c.includes('255,255,255,.04') || c.includes('0,0,0,.04') ||
                c === '#27272A' || c === '#E4E4E7') {
              s.grid.color = gridSoft;
            }
          }
        });
      }
      ch.update();
    } catch(e){}
  });
}

// ── Init ──────────────────────────────────────────────────────────────────
// ── Auth user display ──────────────────────────────────────────────────────
(async function loadAuthUser(){
  try{
    const r=await fetch('/auth/me');
    const d=await r.json();
    if(d.authenticated){
      const wrap=el('auth-user');if(wrap)wrap.style.display='flex';
      const name=el('auth-username');if(name)name.textContent=d.username;
      if(d.thumb){const img=el('auth-thumb');if(img){img.src=d.thumb;img.style.display='block';}}
    }
  }catch(e){}
}());

// The shell's sign-out control is an anchor for no-JS fallback, but logout is
// state-changing. Intercept it and use the authenticated CSRF-protected POST.
function _wireLogoutPost(){
  document.querySelectorAll('a[href="/auth/logout"]').forEach(a=>{
    if(a.dataset.postWired) return;
    a.dataset.postWired='1';
    a.addEventListener('click',async e=>{
      e.preventDefault();
      try{
        const r=await fetch('/auth/logout',{method:'POST',headers:{'X-CSRF-Token':_csrf()}});
        if(!r.ok) throw new Error('HTTP '+r.status);
      }catch(err){ console.warn('logout:',err); }
      location.assign('/auth/login');
    });
  });
}

// ── Sidebar / nav-rail controls ─────────────────────────────────────────────
// Wired from the shell: the hamburger (sidebarToggle), the mobile backdrop
// (sidebarClose), and the collapsed-state expand button (sidebarExpand); the
// boot + resize logic below also drives them. On desktop the sidebar collapses
// to an icon rail (#sidebar.rail); on mobile it slides in over #sidebar-overlay.
let _sidebarOpen=false;
const _RAIL_W=48;   /* twice the icon's rail centre (24) — keeps icon + highlight symmetric in the rail */
function sidebarOpen(){_sidebarOpen=true;const s=el('sidebar');if(s)s.style.transform='translateX(0)';const o=el('sidebar-overlay');if(o)o.classList.add('open');}
function sidebarClose(){_sidebarOpen=false;const s=el('sidebar');if(s&&window.innerWidth<768)s.style.transform='translateX(-100%)';const o=el('sidebar-overlay');if(o)o.classList.remove('open');}
// Desktop minimize = a thin icon-only RAIL (not a full hide). The sidebar stays
// visible; hovering an icon shows its label in a flyout.
function sidebarRail(){
  const s=el('sidebar'),m=el('main-wrap'),btn=el('sidebar-expand-btn');
  if(s){s.style.transform='translateX(0)';s.classList.add('rail');s.style.width=_RAIL_W+'px';}
  if(m&&window.innerWidth>=768){m.style.marginLeft=_RAIL_W+'px';}
  if(btn){btn.style.display='none';}
  const o=el('sidebar-overlay');if(o)o.classList.remove('open');
  _sidebarOpen=true;
  try{localStorage.setItem('hd-sidebar-collapsed','1');}catch(e){}
}
function sidebarExpand(){
  const s=el('sidebar'),m=el('main-wrap'),btn=el('sidebar-expand-btn');
  if(s){s.style.transform='translateX(0)';s.classList.remove('rail');s.style.width='240px';}
  if(m&&window.innerWidth>=768){m.style.marginLeft='240px';}
  if(btn){btn.style.display='none';}
  _navFlyoutHide(true);
  _sidebarOpen=true;
  try{localStorage.removeItem('hd-sidebar-collapsed');}catch(e){}
}
// Strip rail styling when dropping to the mobile drawer so the mobile !important
// width/margin rules take over cleanly.
function _sidebarMobileReset(){
  const s=el('sidebar'); if(s){s.classList.remove('rail');s.style.width='';}
  const m=el('main-wrap'); if(m) m.style.marginLeft='';
  _navFlyoutHide(true);
}
// Unified toggle for the top-bar hamburger: desktop swaps full<->rail; condensed
// widths use the slide-in overlay drawer.
function sidebarToggle(){
  const s=el('sidebar');
  if(window.innerWidth>=768){
    const railed = s && s.classList.contains('rail');
    railed ? sidebarExpand() : sidebarRail();
  } else {
    const hidden = !s || (s.style.transform||'').indexOf('-100%') !== -1;
    hidden ? sidebarOpen() : sidebarClose();
  }
}
// ── Rail flyout: hover labels rendered at body level so they escape overflow.
let _navFlyoutEl=null, _navFlyoutTimer=null, _navHoverOk=null;
function _navHover(){ if(_navHoverOk==null){ try{_navHoverOk=window.matchMedia('(hover:hover) and (pointer:fine)').matches;}catch(e){_navHoverOk=true;} } return _navHoverOk; }
function _navFlyoutNode(){
  if(_navFlyoutEl) return _navFlyoutEl;
  const f=document.createElement('div'); f.id='nav-flyout'; f.className='nav-flyout';
  f.addEventListener('mouseenter',()=>{ if(_navFlyoutTimer){clearTimeout(_navFlyoutTimer);_navFlyoutTimer=null;} });
  f.addEventListener('mouseleave',()=>_navFlyoutHide());
  document.body.appendChild(f); _navFlyoutEl=f; return f;
}
function _navFlyoutHide(now){
  if(_navFlyoutTimer){clearTimeout(_navFlyoutTimer);_navFlyoutTimer=null;}
  const go=()=>{ if(_navFlyoutEl) _navFlyoutEl.classList.remove('open'); };
  if(now) go(); else _navFlyoutTimer=setTimeout(go,150);
}
function _navFlyoutShow(btn){
  const s=el('sidebar'); if(!s||!s.classList.contains('rail')||!_navHover()) return;
  if(_navFlyoutTimer){clearTimeout(_navFlyoutTimer);_navFlyoutTimer=null;}
  const f=_navFlyoutNode();
  const lbl=btn.querySelector('span');
  f.innerHTML='<div class="nav-flyout-tip">'+esc(lbl?lbl.textContent:'')+'</div>';
  f.className='nav-flyout tooltip';
  const r=btn.getBoundingClientRect();
  f.style.left=(r.right+6)+'px';
  f.style.top=r.top+'px';
  f.classList.add('open');
  const fr=f.getBoundingClientRect();
  if(fr.bottom>window.innerHeight-8){ f.style.top=Math.max(8,window.innerHeight-8-fr.height)+'px'; }
}
// Attach hover handlers to the (static) nav buttons once; no-ops unless rail is on.
function _navRailWire(){
  const s=el('sidebar'); if(!s||s._railWired) return; s._railWired=true;
  s.querySelectorAll('[data-sidebar="menu-button"]').forEach(b=>{
    b.addEventListener('mouseenter',()=>_navFlyoutShow(b));
    b.addEventListener('mouseleave',()=>_navFlyoutHide());
  });
}

// Reusable sidebar icon motion: plays only on an actual inactive -> active
// nav transition (click, Enter/Space, or tap — whatever input method causes
// the page to change), never on hover/focus alone. See src/10-router.js.
function _navMotionReduced(){
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch(e) { return false; }
}
function _navIconPlay(btn){
  if(!btn || _navMotionReduced()) return;
  const now=typeof performance!=='undefined' && performance.now ? performance.now() : Date.now();
  if(btn._navIconPlayedAt && now-btn._navIconPlayedAt<140) return;
  btn._navIconPlayedAt=now;
  if(btn._navIconTimer) clearTimeout(btn._navIconTimer);
  btn.classList.remove('nav-icon-run');
  void btn.offsetWidth; // restart CSS keyframes after a previous completed run
  btn.classList.add('nav-icon-run');
  btn._navIconTimer=setTimeout(()=>{
    btn.classList.remove('nav-icon-run');
    btn._navIconTimer=null;
  },820);
}

// Script is at bottom of body — DOM is fully available, no DOMContentLoaded needed
(function init(){
  // Dark is the default; the <head> script already added the class. Sync icons.
  if(document.documentElement.classList.contains('dark')){
    ['','mob'].forEach(sfx=>{
      const m=el('dm-icon-moon'+(sfx?'-'+sfx:'')),s=el('dm-icon-sun'+(sfx?'-'+sfx:''));
      if(m)m.style.display='none';if(s)s.style.display='block';
    });
  }
  // If the server inlined a page into #pages-host, mark it as already-loaded
  // so the first showPage() call doesn't re-fetch HTML the browser already has.
  document.querySelectorAll('#pages-host > [id^="page-"]').forEach(node => {
    _pagesLoaded.add(node.id.slice(5));
  });
  // Pick the boot page. The URL is what the user is actually looking at and
  // refreshing, so trust it FIRST whenever it maps to a known page — that keeps
  // the tab title, mobile header, currentPage (and thus the WS meta title
  // updater) all in agreement with the address bar. Only when the path ISN'T a
  // recognised slug (path-rewriting proxy / base path) do we fall back to the
  // server-inlined active page, then localStorage, then overview.
  const _inlined = document.querySelector('#pages-host > .page.active[id^="page-"]');
  const _serverPage = _inlined ? _inlined.id.slice(5) : null;
  const _urlSlug = location.pathname.replace(/\/$/, '') || '/overview';
  let saved = SLUG_TO_PAGE[_urlSlug] || _serverPage || localStorage.getItem('hd-page') || 'overview';
  if(!PAGES.includes(saved)) saved='overview';
  showPage(saved);
  window.addEventListener('popstate', () => {
    const slug = location.pathname.replace(/\/$/, '') || '/overview';
    const target = SLUG_TO_PAGE[slug] || 'overview';
    showPage(target, {fromPopstate:true});
  });
  _navRailWire();   // attach rail flyout hover handlers to the static nav buttons
  _wireLogoutPost();
  if(window.innerWidth<768){const s=el('sidebar');if(s)s.style.transform='translateX(-100%)';_sidebarOpen=false;}
  else if(localStorage.getItem('hd-sidebar-collapsed')==='1'){sidebarRail();}
  else{_sidebarOpen=true;}   // full-screen default: sidebar pinned open (pushing content), top bar above it
  // Force the sidebar minimized when the window is condensed; restore it on widen.
  { let _wasWide=window.innerWidth>=768;
    window.addEventListener('resize',()=>{
      const wide=window.innerWidth>=768; if(wide===_wasWide)return; _wasWide=wide;
      if(!wide){_sidebarMobileReset();const s=el('sidebar');if(s)s.style.transform='translateX(-100%)';const o=el('sidebar-overlay');if(o)o.classList.remove('open');_sidebarOpen=false;}
      else if(localStorage.getItem('hd-sidebar-collapsed')==='1'){sidebarRail();}
      else{sidebarExpand();}
    },{passive:true}); }
  // Mobile scrolls the document, desktop scrolls #pages-root — listen to both.
  window.addEventListener('scroll', _mobileHdrSync, {passive:true});
  window.addEventListener('resize', _mobileHdrSync, {passive:true});
  { const pr=el('pages-root'); if(pr) pr.addEventListener('scroll', _mobileHdrSync, {passive:true}); }
  _mobileHdrSync();
  _syncThemeColor();
  connect();
  // Warm every page's HTML in the background so the first click on any nav item
  // is instant (no per-page fetch). _loadPage dedupes, and pages stay display:
  // none until activated, so this only front-loads the fetch + parse.
  setTimeout(_prefetchPages, 1200);
}());

// Staggered background prefetch of all page fragments — see init().
let _prefetchStarted = false;
// Skip heavy pages in the background warm-up. (None currently — kept as a hook
// for pages that shouldn't preload into hidden DOM.)
const _PREFETCH_SKIP = new Set();
function _prefetchPages() {
  if (_prefetchStarted) return; _prefetchStarted = true;
  let i = 0;
  const next = () => {
    while (i < PAGES.length && (_pagesLoaded.has(PAGES[i]) || _PREFETCH_SKIP.has(PAGES[i]))) i++;
    if (i >= PAGES.length) return;
    const p = PAGES[i++];
    Promise.resolve(_loadPage(p)).finally(() => setTimeout(next, 50));
  };
  next();
}
// ── Settings ──────────────────────────────────────────────────────────────
let settingsConfig={};
function gval(id){const e=el(id);return e?e.value:'';}
function gchecked(id){const e=el(id);return !!(e&&e.checked);}
function toggleReveal(id,btn){const inp=el(id);if(!inp)return;inp.type=inp.type==='password'?'text':'password';btn.innerHTML=inp.type==='password'?svg('eye',14):svg('eye-off',14);}

function showToast(msg,isErr=false){
  const w=el('hd-toast'),i=el('hd-toast-inner');if(!w||!i)return;
  w.setAttribute('aria-live', isErr ? 'assertive' : 'polite');   // errors interrupt, success is polite
  i.style.cssText=`background:${isErr?'rgba(239,68,68,.15)':'rgba(34,197,94,.15)'};color:${isErr?'#EF4444':'#22C55E'};border:1px solid ${isErr?'rgba(239,68,68,.2)':'rgba(34,197,94,.2)'};`;
  i.textContent=msg; w.classList.remove('hidden');
  setTimeout(()=>w.classList.add('hidden'),2500);
}

function switchSettingsTab(name,btn){
  document.querySelectorAll('[id^="stab-panel-"]').forEach(p=>p.classList.add('hidden'));
  // Settings nav buttons live inside a .hist-range so the sliding thumb
  // animates between sections. Clear active on every nav variant to be safe.
  document.querySelectorAll('#set-section-hist-range .hist-btn, .snav-btn, .stab-btn').forEach(b=>b.classList.remove('active'));
  const p=el('stab-panel-'+name);if(p)p.classList.remove('hidden');
  if(btn){
    btn.classList.add('active');
  } else {
    const sb=el('snav-'+name); if(sb) sb.classList.add('active');
  }
  // Slide the .hist-thumb over to the newly active button.
  requestAnimationFrame(() => _histThumbUpdate('set-section'));
}

// Unsaved-changes hint: any edit to a server-backed control (not browser-local
// .s-local ones like accent/wall) flags the save bar until Save & Apply.
let _settingsDirty = false, _settingsDirtyWired = false;
function _settingsMarkDirty(){
  _settingsDirty = true;
  const s = el('settings-save-status');
  if (s){ s.textContent = '● Unsaved changes'; s.style.color = '#F59E0B'; }
}
function _settingsClearDirty(){
  _settingsDirty = false;
  const s = el('settings-save-status');
  if (s && s.textContent === '● Unsaved changes') s.textContent = '';
}
function _wireSettingsDirty(){
  if (_settingsDirtyWired) return;
  const root = document.querySelector('.settings-content'); if (!root) return;
  _settingsDirtyWired = true;
  const edit = e => { if (!e.target.closest('.s-local')) _settingsMarkDirty(); };
  root.addEventListener('input', edit);
  root.addEventListener('change', edit);
  // Add/Remove device/service buttons restructure config → also dirty.
  root.addEventListener('click', e => {
    if (e.target.closest('.s-btn') && !e.target.closest('.s-test-btn') && !e.target.closest('.s-local')) _settingsMarkDirty();
  });
}

// Loads /api/config and renders all settings sections. Idempotent — re-rendering
// while the page is already populated reflows from a fresh server snapshot.
function loadSettingsPage(){
  Object.entries({general:'Loading…',infrastructure:'Loading…',health:'Loading…',assistant:'Loading…'}).forEach(([k,v])=>{
    const e=el('stab-panel-'+k);if(e)e.innerHTML='<p style="color:var(--c-muted);font-size:13px;padding:20px 0">'+v+'</p>';
  });
  switchSettingsTab('general', el('snav-general'));
  fetch('/api/config').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(cfg=>{
    settingsConfig=cfg;
    try{populateSettings(cfg);}catch(err){console.error('Settings populate error:',err);showToast('Settings render error: '+err.message,true);}
    switchSettingsTab('general', el('snav-general'));
    _wireSettingsDirty(); _settingsClearDirty();
  }).catch(e=>{
    console.error('Settings load error:',e);
    const ep=el('stab-panel-general');if(ep)ep.innerHTML='<p style="color:#EF4444;font-size:13px;padding:20px 0">Failed to load config: '+esc(e.message||String(e))+'<br>Check browser console (F12) for details.</p>';
  });
}

function sRow(lbl,inp){return `<div class="s-row"><span class="s-lbl">${lbl}</span>${inp}</div>`;}
function sText(id,v,ph){return '<input type="text" id="'+id+'" class="s-inp" value="'+esc(v)+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+'>'; }
function sPass(id,v){return `<div style="display:flex;gap:4px;flex:1"><input type="password" id="${id}" class="s-inp" style="flex:1;min-width:0" value="${esc(v)}"><button class="s-reveal" onclick="toggleReveal('${id}',this)">${svg('eye',14)}</button></div>`;}
function sCheck(id,v,lbl){return '<div style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="'+id+'" class="s-check"'+(v?' checked':'')+'>'+(lbl?'<label for="'+id+'" style="font-size:12px;color:var(--c-dim);cursor:pointer">'+lbl+'</label>':'')+'</div>';}
function sGroup(title,body){return `<div class="s-group"><div class="s-group-title">${title}</div>${body}</div>`;}
function sEnabled(id,v){return sRow('Enabled',sCheck(id,v));}
function sHelp(html){return `<div class="s-help">${html}</div>`;}
function sTest(svc,getter,label){
  const tid='tres-'+svc+'-'+Math.random().toString(36).slice(2,8);
  return `<div class="s-test-row"><button class="s-btn s-test-btn" data-svc="${svc}" data-getter="${getter}" data-tid="${tid}" onclick="testServiceBtn(this)">${svg('zap',14)} ${label||'Test Connection'}</button><span id="${tid}" class="s-test-result"></span></div>`;
}
function testServiceBtn(btn){
  const svc=btn.dataset.svc, fnName=btn.dataset.getter, tid=btn.dataset.tid;
  const fn=window[fnName], result=el(tid);
  if(!fn){if(result){result.innerHTML=svg('x',14)+' Missing getter '+esc(fnName);result.style.color='#EF4444';}return;}
  if(result){result.innerHTML=svg('clock',14)+' Testing…';result.style.color='var(--c-muted)';}
  btn.disabled=true;
  let cfg;
  try{cfg=fn(btn);}catch(e){btn.disabled=false;if(result){result.innerHTML=svg('x',14)+' '+esc(e.message);result.style.color='#EF4444';}return;}
  fetch('/api/test',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':_csrf()},body:JSON.stringify({service:svc,config:cfg})})
    .then(r=>r.json())
    .then(d=>{if(!result)return;result.innerHTML=(d.ok?svg('check',14):svg('x',14))+' '+esc(d.message||'');result.style.color=d.ok?'#22C55E':'#EF4444';})
    .catch(e=>{if(result){result.innerHTML=svg('x',14)+' '+esc(e.message);result.style.color='#EF4444';}})
    .finally(()=>{btn.disabled=false;});
}
// Per-service getters
function _getProxmoxCfg(){return{url:gval('cfg-px-url'),token_id:gval('cfg-px-tid'),token_secret:gval('cfg-px-secret')};}
function _getPbsCfg(){return{url:gval('cfg-pbs-url'),token_id:gval('cfg-pbs-tid'),token_secret:gval('cfg-pbs-secret')};}
function _getHcCfg(btn){
  const row=btn.closest('.hc-row');
  return{url:(row.querySelector('.hc-url')||{}).value||''};
}

function populateSettings(cfg){
  const p={general:buildGeneralTab(cfg),infrastructure:buildInfrastructureTab(cfg),health:buildHealthTab(cfg.health_checks||{}),assistant:buildAssistantTab(cfg)};
  Object.entries(p).forEach(([k,v])=>{const e=el('stab-panel-'+k);if(e)e.innerHTML=v;});
}
function buildGeneralTab(cfg){
  const au=cfg.auth||{};
  let accentVal='#E57000', logoVal='';
  try{ accentVal=localStorage.getItem('proxdash-accent')||window.HD_DEFAULT_ACCENT||'#E57000'; }catch(e){}
  try{ logoVal=localStorage.getItem('hd-logo')||''; }catch(e){}
  return sGroup('Dashboard',
      sRow('Title',sText('cfg-title',cfg.title||'Proxdash','Proxdash'))
    + sRow('Refresh',`<input type="number" id="cfg-poll" class="s-inp" style="width:70px" value="${cfg.poll_interval||10}" min="1" max="300"><span style="font-size:11px;color:var(--c-muted);margin-left:6px">sec</span>`)
    + sHelp('How often the dashboard pulls fresh data from Proxmox and every other integration. Lower is more real-time, higher is lighter load.')
  ) + sGroup('Appearance',
      sRow('Accent color',
        '<div class="s-local" style="display:flex;align-items:center;gap:8px">'
        + '<input type="color" id="cfg-accent" value="'+esc(accentVal)+'" oninput="applyAccentColor(this.value);var h=el(\'cfg-accent-hex\');if(h)h.textContent=this.value" style="width:44px;height:30px;padding:0;border:1px solid var(--c-border);border-radius:6px;background:transparent;cursor:pointer">'
        + '<code id="cfg-accent-hex" style="font-size:12px;color:var(--c-muted)">'+esc(accentVal)+'</code>'
        + '<button type="button" class="s-btn" onclick="resetAccentColor();var i=el(\'cfg-accent\');if(i)i.value=window.HD_DEFAULT_ACCENT;var h=el(\'cfg-accent-hex\');if(h)h.textContent=window.HD_DEFAULT_ACCENT">Reset</button>'
        + '</div>')
    + sRow('Logo',
        '<div class="s-local" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<img src="/api/logo?theme=light" id="cfg-logo-preview-light" width="28" height="28" alt="light logo" title="Light mode" style="display:block;background:#fff;border-radius:6px;padding:2px;border:1px solid var(--c-border)">'
        + '<img src="/api/logo?theme=dark" id="cfg-logo-preview-dark" width="28" height="28" alt="dark logo" title="Dark mode" style="display:block;background:#101013;border-radius:6px;padding:2px;border:1px solid var(--c-border)">'
        + '<input type="file" id="cfg-logo-file-light" data-theme="light" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="_logoUpload(this)">'
        + '<input type="file" id="cfg-logo-file-dark" data-theme="dark" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="_logoUpload(this)">'
        + '<button type="button" class="s-btn" onclick="el(\'cfg-logo-file-light\').click()">Upload light…</button>'
        + '<button type="button" class="s-btn" onclick="el(\'cfg-logo-file-dark\').click()">Upload dark…</button>'
        + '<button type="button" class="s-btn" onclick="_logoReset()">Reset</button>'
        + '<span id="cfg-logo-status" style="font-size:11px;color:var(--c-muted)"></span>'
        + '</div>')
    + sRow('Logo URL',
        '<input type="text" id="cfg-logo" class="s-inp s-local" value="'+esc(logoVal)+'" placeholder="/api/logo?theme=dark" oninput="applyLogo(this.value.trim())">')
    + sHelp('Accent color is stored in this browser; default is Proxmox orange (<code>#E57000</code>). <strong>Upload light/dark</strong> stores a PNG/JPEG/WebP logo per theme on the server (max 512&nbsp;KB) so every browser and the login page get it; the two previews show what each theme serves. Reset returns both to the bundled ProxDash marks. The optional <strong>Logo URL</strong> is a per-browser override that wins over the uploaded ones.')
  ) + sGroup('Authentication',
      sRow('Require login',sCheck('cfg-auth-en',au.enabled!==false,'Require a login to view the dashboard'))
    + sRow('Session lifetime',`<input type="number" id="cfg-auth-ttl" class="s-inp" style="width:70px" value="${au.session_ttl_days||7}" min="1" max="365"><span style="font-size:11px;color:var(--c-muted);margin-left:6px">days</span>`)
    + sHelp('The local admin account is created on first launch, right at the login screen. Set <strong>Require login</strong> off (<code>auth.enabled: false</code>) only for a trusted-LAN-only deployment where everyone on the network is allowed in.')
  );
}
// ── Logo upload (Settings → Appearance) ──────────────────────────────────────
// Reads the picked file as a data URL and POSTs it to /api/logo (auth + CSRF).
// The server stores it in the data dir and serves it at GET /api/logo, so every
// browser — and the login page — picks it up. Reset (DELETE) returns to the
// bundled mark. Cache-bust after both so the change is visible immediately.
function _logoStatus(msg, isErr){
  const s = el('cfg-logo-status');
  if (s){ s.textContent = msg || ''; s.style.color = isErr ? '#EF4444' : 'var(--c-muted)'; }
}
function _logoBust(){
  const v = '&v=' + Date.now();
  const cur = _defaultLogoUrl() + v;
  document.querySelectorAll('img[data-logo]').forEach(img => { img.src = cur; });
  const fav = document.querySelector('link[rel="icon"]'); if (fav) fav.href = cur;
  const atl = document.querySelector('link[rel="apple-touch-icon"]'); if (atl) atl.href = cur;
  const pl = el('cfg-logo-preview-light'); if (pl) pl.src = '/api/logo?theme=light' + v;
  const pd = el('cfg-logo-preview-dark');  if (pd) pd.src = '/api/logo?theme=dark' + v;
}
function _logoUpload(inp){
  const f = inp.files && inp.files[0];
  const theme = inp.dataset.theme || 'both';
  inp.value = '';                        // so re-picking the same file re-fires change
  if (!f) return;
  if (f.size > 512 * 1024) { _logoStatus('Too large (max 512 KB)', true); return; }
  const rd = new FileReader();
  rd.onload = async () => {
    _logoStatus('Uploading…');
    try {
      const r = await fetch('/api/logo', { method:'POST',
        headers:{ 'Content-Type':'application/json', 'X-CSRF-Token':_csrf() },
        body: JSON.stringify({ data: rd.result, theme: theme }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      applyLogo('');                     // drop any per-browser URL override
      const li = el('cfg-logo'); if (li) li.value = '';
      _logoBust();
      _logoStatus('Uploaded (' + theme + ')');
      showToast('Logo updated');
    } catch(e){ _logoStatus(e.message, true); showToast('Logo upload failed: ' + e.message, true); }
  };
  rd.readAsDataURL(f);
}
async function _logoReset(){
  try {
    const r = await fetch('/api/logo', { method:'DELETE', headers:{ 'X-CSRF-Token':_csrf() } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    applyLogo('');
    const li = el('cfg-logo'); if (li) li.value = '';
    _logoBust();
    _logoStatus('Reset to bundled mark');
  } catch(e){ _logoStatus(e.message, true); }
}

function buildAssistantTab(cfg){
  const ta=cfg.tars||{};
  const provider = ta.provider==='openai' ? 'openai' : 'anthropic';
  return sGroup('AI Assistant',
      sEnabled('cfg-tars-en',ta.enabled)
    + sRow('Provider','<select id="cfg-tars-provider" class="s-inp">'
        +'<option value="anthropic"'+(provider==='anthropic'?' selected':'')+'>Anthropic (Claude)</option>'
        +'<option value="openai"'+(provider==='openai'?' selected':'')+'>OpenAI-compatible (OpenAI cloud, Open WebUI, Ollama, LM Studio, vLLM…)</option>'
        +'</select>')
    + sRow('API key',sPass('cfg-tars-key',ta.api_key||''))
    + sRow('Base URL',sText('cfg-tars-baseurl',ta.base_url||'','https://api.openai.com/v1'))
    + sRow('Model',sText('cfg-tars-model',ta.model||'claude-sonnet-5','claude-sonnet-5'))
    + sRow('Max tokens','<input type="number" id="cfg-tars-maxtok" class="s-inp" style="width:90px" value="'+(ta.max_tokens||2048)+'" min="256" max="8192">')
    + sRow('Thinking budget','<input type="number" id="cfg-tars-think" class="s-inp" style="width:90px" value="'+(ta.thinking_budget||1200)+'" min="1024" max="6000">')
    + sHelp('Optional AI assistant. <b>Anthropic</b>: get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> — thinking budget (min 1024) applies here. <b>OpenAI-compatible</b>: works with the real OpenAI cloud API, or point Base URL at any local server\'s <code>/v1</code> endpoint — Open WebUI, Ollama (<code>http://192.168.1.X:11434/v1</code>), LM Studio, vLLM — leave the API key blank if the server needs none; thinking budget is ignored. Enabled controls whether the assistant runs at all, independent of these fields.')
  );
}
function buildInfrastructureTab(cfg){
  const px=cfg.proxmox||{},pbs=cfg.pbs||{};
  return sGroup('Proxmox VE',
      sEnabled('cfg-px-en',px.enabled)
    +sRow('API URL',sText('cfg-px-url',px.url||'','https://192.168.1.X:8006/api2/json'))
    +sRow('Token ID',sText('cfg-px-tid',px.token_id||'','root@pam!tokenname'))
    +sRow('Token Secret',sPass('cfg-px-secret',px.token_secret||''))
    +sHelp('Create at <code>Datacenter → Permissions → API Tokens</code>. Token ID format: <code>user@realm!tokenname</code> (e.g., <code>root@pam!proxdash</code>). Give the token <code>PVEAuditor</code> role on path <code>/</code>.')
    +sTest('proxmox','_getProxmoxCfg')
  )+sGroup('Proxmox Backup Server',
      sEnabled('cfg-pbs-en',pbs.enabled)
    +sRow('API URL',sText('cfg-pbs-url',pbs.url||'','https://192.168.1.X:8007'))
    +sRow('Token ID',sText('cfg-pbs-tid',pbs.token_id||'','root@pam!proxdash'))
    +sRow('Token Secret',sPass('cfg-pbs-secret',pbs.token_secret||''))
    +sHelp('In PBS: <code>Configuration → Access Control → API Token</code>. Give the token <code>DatastoreAudit</code> permission on path <code>/datastore</code> (or <code>/</code> for all). Powers the Backups page.')
    +sTest('pbs','_getPbsCfg')
  );
}
function buildHealthTab(hc){return `<div style="margin-bottom:12px">${sCheck('cfg-hc-en',hc.enabled!==false,'Enable health checks')}</div>`+sHelp('Simple HTTP up/down checks — any URL that returns &lt; 500 counts as up. No auth required.')+`<div style="display:grid;grid-template-columns:120px 1fr 28px 110px;gap:6px;margin-bottom:6px;font-size:11px;color:var(--c-muted);font-weight:600"><span>Name</span><span>URL</span><span></span><span></span></div><div id="hc-services-list">${(hc.services||[]).map(s=>hcRow(s)).join('')}</div><div style="margin-top:8px"><button class="s-btn" onclick="addHcRow()">+ Add Service</button></div>`;}
function hcRow(s){const tid='tres-hc-'+Math.random().toString(36).slice(2,8);return `<div class="hc-row" style="display:grid;grid-template-columns:120px 1fr 28px 110px;gap:6px;margin-bottom:6px;align-items:center"><input type="text" class="s-inp hc-name" value="${esc(s.name||'')}" placeholder="Service"><input type="text" class="s-inp hc-url" value="${esc(s.url||'')}" placeholder="http://..."><button class="s-btn s-btn-danger" onclick="this.closest('.hc-row').remove()">${svg('x',14)}</button><div style="display:flex;align-items:center;gap:6px;font-size:10px"><button class="s-btn s-test-btn" data-svc="health" data-getter="_getHcCfg" data-tid="${tid}" onclick="testServiceBtn(this)" style="padding:4px 8px;font-size:10px">${svg('zap',12)} Test</button><span id="${tid}" class="s-test-result"></span></div></div>`;}
function addHcRow(){const w=document.createElement('div');w.innerHTML=hcRow({name:'',url:''});el('hc-services-list').appendChild(w.firstElementChild);}
// Only the kept-domain tabs (General / Proxmox / Health / Assistant) write
// config: title, poll_interval, auth, proxmox, pbs, health_checks, tars. Every
// other key falls through the `...orig` spread untouched, so trimming the UI
// never wipes a still-present integration in config.yaml. Secrets left as the
// server's sentinel round-trip back to their stored value (see _restore_secrets).
function collectSettings(){const orig=settingsConfig;return{...orig,title:gval('cfg-title'),poll_interval:parseInt(gval('cfg-poll'))||10,auth:collectAuth(),proxmox:{enabled:gchecked('cfg-px-en'),url:gval('cfg-px-url'),token_id:gval('cfg-px-tid'),token_secret:gval('cfg-px-secret')},pbs:{enabled:gchecked('cfg-pbs-en'),url:gval('cfg-pbs-url'),token_id:gval('cfg-pbs-tid'),token_secret:gval('cfg-pbs-secret')},health_checks:collectHealth(),tars:{enabled:gchecked('cfg-tars-en'),provider:gval('cfg-tars-provider')||'anthropic',api_key:gval('cfg-tars-key'),base_url:gval('cfg-tars-baseurl'),model:gval('cfg-tars-model')||'claude-sonnet-5',max_tokens:parseInt(gval('cfg-tars-maxtok'))||2048,thinking_budget:parseInt(gval('cfg-tars-think'))||1200}};}
// Preserve any auth keys we don't surface in the UI (session store settings,
// future flags) via the ...orig spread; overwrite only the edited fields.
function collectAuth(){const orig=settingsConfig.auth||{};return{...orig,enabled:gchecked('cfg-auth-en'),session_ttl_days:parseInt(gval('cfg-auth-ttl'))||7};}
function collectHealth(){const s=[];(el('hc-services-list')||{querySelectorAll:()=>[]}).querySelectorAll('.hc-row').forEach(r=>{const n=(r.querySelector('.hc-name')||{value:''}).value.trim(),u=(r.querySelector('.hc-url')||{value:''}).value.trim();if(n||u)s.push({name:n,url:u});});return{enabled:gchecked('cfg-hc-en'),services:s};}
async function saveSettings(){
  const btn=el('settings-save-btn'), orig=btn.textContent;
  const status=el('settings-save-status');
  btn.textContent='Saving…'; btn.disabled=true;
  if (status) status.textContent='';
  try{
    const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':_csrf()},body:JSON.stringify(collectSettings())});
    if(r.ok){
      _settingsDirty = false;   // toast removed — the inline 'Saved & applied' status (left of the button) already covers it
      if (status) {
        status.textContent='Saved & applied just now';
        status.style.color='#16A34A';
        setTimeout(()=>{ if(status.textContent==='Saved & applied just now') status.textContent=''; }, 4000);
      }
    } else {
      const t=await r.text();
      showToast('Save failed: '+t.slice(0,60), true);
      if (status) { status.textContent='Save failed'; status.style.color='#EF4444'; }
    }
  } catch(e) {
    showToast(e.message, true);
    if (status) { status.textContent=e.message; status.style.color='#EF4444'; }
  } finally {
    btn.textContent=orig; btn.disabled=false;
  }
}
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
  const xCfg = _xAxisConfig(hrs);
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
    sy.min = (opts && opts.yMin != null) ? opts.yMin : undefined;
    sy.max = (opts && opts.yMax != null) ? opts.yMax : undefined;
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
             ticks: { maxTicksLimit: 8, font: { size: 10 },
               // Keep time labels horizontal and let autoSkip thin them when the
               // chart is narrow (square window / sidebar open) — rotated or
               // touching x labels read as cramped. Dense when wide, sparse when not.
               maxRotation: 0, autoSkip: true, autoSkipPadding: 40 } },
        y: { beginAtZero: true, stacked,
             ...(opts && opts.yMin != null ? { min: opts.yMin } : {}),
             ...(opts && opts.yMax != null ? { max: opts.yMax } : {}),
             ticks: { maxTicksLimit: 6, font: { size: 10 },
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
  _maybeReveal(_charts[id], id, _isRefresh);  // sweep on first paint / re-visit; resume if a tick interrupted it
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
// ── Tools page ─────────────────────────────────────────────────────────────
let _toolsTargetsLoaded=false;
async function initToolsPage(){
  _refreshImportStatus();          // last-run info for the Import History card
  if(_toolsTargetsLoaded) return;
  try{
    const d=await fetch('/api/tools/targets').then(r=>r.json());
    const wsel=el('wol-device');
    if(wsel) wsel.innerHTML='<option value="">— manual —</option>'
      +(d.wol||[]).map(w=>'<option value="'+escAttr(w.mac)+'">'+escText(w.name)+'</option>').join('');
    _toolsTargetsLoaded=true;
  }catch(e){ console.warn('tools targets',e); }
}
function _wolPick(sel){ const m=el('wol-mac'); if(m && sel.value) m.value=sel.value; }

// ── Tools run-button orbit ("Orbit · fast"): eases up to a constant orbit speed,
// holds while the test runs, then glides back down to its start point on finish.
// Velocity-profiled rotation: accelerate (angle∝f²) and decelerate (angle∝2f−f²)
// both meet the linear run at speed ω, so there's no hitch. Driven via WAAPI.
const _RUN_OD=1500, _RUN_UP=650;   // ms per orbit / spin-up duration
function _runRamp(from,to,N,accel){ const fr=[]; for(let i=0;i<=N;i++){ const f=i/N, p=accel?f*f:(2*f-f*f); fr.push({transform:'rotate('+(from+(to-from)*p)+'deg)',offset:f}); } return fr; }
function _runOrbCancel(btn){ ['_oUp','_oRun','_oDown'].forEach(k=>{ if(btn[k]){ try{btn[k].cancel();}catch(e){} btn[k]=null; } }); }
function _runBtnNeutral(btn){   // hold the button at rest color after a run even if the cursor is still on it
  try{ btn.classList.add('just-ran'); btn.addEventListener('mouseleave',()=>btn.classList.remove('just-ran'),{once:true}); }catch(e){}
}
function _runBtnStart(btn){
  if(!btn) return;
  btn.classList.remove('just-ran');
  btn.disabled=true; btn.classList.add('busy'); btn._oStopping=false;
  const spin=btn.querySelector('.spin'); btn._oSpin=spin;
  if(!spin) return;                       // graceful fallback (old cached markup): just disable
  _runOrbCancel(btn); spin.style.transform='';
  const od=_RUN_OD, up=_RUN_UP, omega=360/od, upDeg=0.5*omega*up;
  btn._oOd=od; btn._oOmega=omega; btn._oUpDeg=upDeg; btn._oUpDur=up;
  const a1=spin.animate(_runRamp(0,upDeg,24,true),{duration:up,easing:'linear',fill:'forwards'});
  btn._oUp=a1;
  a1.onfinish=()=>{ if(!btn.classList.contains('busy')||btn._oStopping) return; btn._oUp=null;
    btn._oRun=spin.animate([{transform:'rotate('+upDeg+'deg)'},{transform:'rotate('+(upDeg+360)+'deg)'}],{duration:od,easing:'linear',iterations:Infinity}); };
}
function _runBtnStop(btn){
  if(!btn) return;
  const spin=btn._oSpin||btn.querySelector('.spin');
  if(!spin){ btn.classList.remove('busy'); btn.disabled=false; _runBtnNeutral(btn); return; }   // fallback
  btn._oStopping=true;
  const od=btn._oOd||_RUN_OD, omega=btn._oOmega||(360/od);
  let theta=0, v=omega;
  if(btn._oRun){ theta=(btn._oUpDeg||0)+360*((btn._oRun.currentTime||0)/od); v=omega; }
  else if(btn._oUp){ const f=Math.min(1,(btn._oUp.currentTime||0)/(btn._oUpDur||1)); theta=(btn._oUpDeg||0)*f*f; v=omega*f; }
  _runOrbCancel(btn);
  if(v<omega*0.05) v=omega*0.05;
  let target=Math.ceil(theta/360)*360; if(target-theta<25) target+=360;     // glide forward to "home" (top)
  const dist=target-theta, dur=Math.max(300,Math.min(1200,2*dist/v));
  const a3=spin.animate(_runRamp(theta,target,24,false),{duration:dur,easing:'linear',fill:'forwards'});
  btn._oDown=a3;
  a3.onfinish=()=>{ btn._oDown=null; btn._oStopping=false; btn.classList.remove('busy'); btn.disabled=false; spin.style.transform=''; _runBtnNeutral(btn); };
}
async function runWol(btn){
  const res=el('tool-wol-result'); if(!btn||!res) return;
  const mac=_toolVal('wol-mac','').trim();
  if(!mac){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a MAC address</span>'; return; }
  _runBtnStart(btn);
  try{
    const d=await _toolPostJSON('/api/tools/wol?mac='+encodeURIComponent(mac));
    if(d.error) throw new Error(d.error);
    res.innerHTML='<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#22C55E"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Magic packet sent to '+esc(d.mac)+'</div>';
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

function _toolStat(label,val,color){
  return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--c-border)">'
    +'<span style="font-size:12px;color:var(--c-muted)">'+esc(label)+'</span>'
    +'<span style="font-size:18px;font-weight:600;color:'+color+';font-variant-numeric:tabular-nums">'+esc(val)+'</span></div>';
}
function _toolVal(id,def){ const e=el(id); return e? (e.value||def) : def; }
async function _toolPostJSON(url){
  const r=await fetch(url,{method:'POST',headers:{'X-CSRF-Token':_csrf()}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
  return d;
}

async function runNetcheck(btn){
  const res=el('tool-netcheck-result'); if(!btn||!res) return;
  const tgt=_toolVal('netcheck-target','').trim();
  if(!tgt){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a host[:port]</span>'; return; }
  _runBtnStart(btn);
  res.innerHTML='<span style="color:var(--c-muted);font-size:12px">Resolving '+esc(tgt)+'…</span>';
  try{
    const d=await _toolPostJSON('/api/tools/netcheck?target='+encodeURIComponent(tgt));
    if(d.error) throw new Error(d.error);
    let h=_toolStat('Resolved',(d.ip||'—'),'var(--c-text)')+_toolStat('DNS',(d.dns_ms!=null?d.dns_ms+' ms':'—'),'var(--c-accent)');
    if(d.open===true) h+=_toolStat('Port '+d.port,'open · '+(d.connect_ms!=null?d.connect_ms+' ms':'—'),'#22C55E');
    else h+=_toolStat('Port '+d.port,'closed / filtered','#EF4444');
    res.innerHTML=h;
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

async function runTraceroute(btn){
  const res=el('tool-trace-result'); if(!btn||!res) return;
  const tgt=_toolVal('trace-target','').trim();
  if(!tgt){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a host</span>'; return; }
  _runBtnStart(btn);
  res.innerHTML='<span style="color:var(--c-muted);font-size:12px">Tracing route to '+esc(tgt)+'…</span>';
  try{
    const d=await _toolPostJSON('/api/tools/traceroute?target='+encodeURIComponent(tgt));
    if(d.error) throw new Error(d.error);
    const hops=d.hops||[];
    res.innerHTML = hops.length
      ? '<div style="font-size:11px;max-height:200px;overflow:auto;margin:-2px 0">'+hops.map(h=>
          '<div style="display:flex;gap:8px;padding:2px 0;align-items:baseline">'
          +'<span style="color:var(--c-dim);width:18px;text-align:right;flex-shrink:0">'+h.hop+'</span>'
          +'<span style="flex:1;min-width:0;color:var(--c-text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(h.ip||'* * *')+'</span>'
          +'<span style="flex-shrink:0;color:var(--c-accent)">'+(h.ms!=null?h.ms+' ms':'')+'</span></div>').join('')+'</div>'
      : '<span style="font-size:12px;color:var(--c-muted)">No hops returned</span>';
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

async function runCertCheck(btn){
  const res=el('tool-cert-result'); if(!btn||!res) return;
  const tgt=_toolVal('cert-target','').trim();
  if(!tgt){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a domain</span>'; return; }
  _runBtnStart(btn);
  res.innerHTML='<span style="color:var(--c-muted);font-size:12px">Checking '+esc(tgt)+'…</span>';
  try{
    const d=await _toolPostJSON('/api/tools/certexpiry?target='+encodeURIComponent(tgt));
    if(d.error) throw new Error(d.error);
    const days=d.days_left;
    const clr = days==null?'var(--c-text)' : days<0?'#EF4444' : days<14?'#EF4444' : days<30?'#F59E0B':'#22C55E';
    const lbl = days==null?'—' : days<0?('expired '+Math.abs(days)+'d ago') : (days+' days');
    res.innerHTML=_toolStat('Expires in', lbl, clr)
      +_toolStat('Issuer', d.issuer||'—','var(--c-text)')
      +(d.not_after?'<div style="font-size:10px;color:var(--c-dim);margin-top:6px">'+esc(d.not_after)+'</div>':'');
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

// ── Import history (Proxmox RRD backfill) ───────────────────────────────────
// Kicks the one-shot backfill job on the backend and polls its status while it
// runs. The result line doubles as the "job" record: last run + rows imported.
function _importSummary(rows){
  const labels={proxmox_stats:'node CPU/RAM', proxmox_net_stats:'node network',
    pxstorage_stats:'storage usage', entity_stats:'guest CPU/RAM', pxstorage_io:'storage I/O'};
  const parts=Object.entries(rows||{}).filter(([,v])=>v>0)
    .map(([k,v])=>v.toLocaleString()+' '+(labels[k]||k)+' points');
  return parts.length?parts.join(' · '):'nothing new to import — history already covered';
}
function _importStatusHtml(st){
  if(st.running) return '<span style="font-size:12px;color:var(--c-muted)">Importing — '+esc(st.phase||'working…')+'</span>';
  if(st.error) return '<span style="font-size:12px;color:#EF4444">'+esc(st.error)+'</span>';
  if(st.last){
    return _toolStat('Last import', timeAgo(st.last.ts*1000)+(st.last.auto?' · auto (first launch)':''), 'var(--c-text)')
      +'<div style="font-size:11px;color:var(--c-muted);margin-top:6px">'+esc(_importSummary(st.last.rows))+'</div>';
  }
  return '<span style="font-size:12px;color:var(--c-dim)">Not run yet.</span>';
}
async function _refreshImportStatus(){
  try{
    const st=await fetch('/api/import/status').then(r=>r.json());
    const res=el('tool-import-result'); if(res) res.innerHTML=_importStatusHtml(st);
    return st;
  }catch(e){ return null; }
}
async function runHistoryImport(btn){
  const res=el('tool-import-result'); if(!btn||!res) return;
  _runBtnStart(btn);
  try{
    const r=await fetch('/api/import/history',{method:'POST',headers:{'X-CSRF-Token':_csrf()}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok && r.status!==409) throw new Error(d.error||('HTTP '+r.status));
    for(;;){
      const st=await _refreshImportStatus();
      const ph=el('tool-import-phase');
      if(ph) ph.textContent = (st && st.running && st.phase) ? st.phase : 'Importing…';
      if(!st || !st.running) break;
      await new Promise(t=>setTimeout(t,1500));
    }
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}
// ── Cluster Topology — interactive tiered graph ──────────────────────────────
// A live, pannable/zoomable graph of the Proxmox cluster built entirely from the
// WebSocket snapshot (data.proxmox nodes/vms/lxcs/storage + data.ceph). No
// /api/topology endpoint and no hand-maintained YAML. Three views:
//   • Compute (primary): Cluster → Nodes → their VMs/LXCs, tiered with bezier
//     connectors, running/stopped styling, per-node CPU/RAM, pan/zoom + search.
//   • Storage: Nodes ↔ the storage they back (shared vs local), shared/Ceph
//     edges drawn in the accent colour.
//   • Network: Nodes → Bridges → attached Guests, node→bridge edges labelled
//     with the physical uplink, bridge→guest edges carrying the VLAN tag.
// The graph engine below does the tier layout, bezier edge draw, pan/zoom,
// search and hover-highlight for all three tabs.

// ═══════════════════════════════════════════════════════════════════════════
// Shared tiered-graph engine
// ═══════════════════════════════════════════════════════════════════════════
const _G_SC = { online:'#22C55E', running:'#22C55E', warning:'#F59E0B', offline:'#EF4444', stopped:'#6B7280' };
function _gsc(s){ return _G_SC[(s||'').toLowerCase()] || '#6B7280'; }
// The runtime accent as a hex, for SVG edge strokes and card accents (SVG
// presentation attributes don't resolve CSS var(), so read the computed value).
function _gAccentHex(){
  return (getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim()) || '#E57000';
}

let _gOrient = 'vertical';                       // graph layout direction (shared)
// Layout view (shared by the Compute/Network tabs): 'grouped' nests each
// parent's children in a wrapped grid under it (bounded width however many
// guests a node has); 'tiered' is the classic flat rows. Persisted per browser.
let _gLayout = (function(){ try { return localStorage.getItem('pd-topo-layout')==='tiered' ? 'tiered' : 'grouped'; } catch(e){ return 'grouped'; } })();
let _gView = { x:0, y:0, s:1, centered:false };  // pan (translate) + zoom (scale)
let _gPan = null;

function _gResetView(){ _gView = { x:0, y:0, s:1, centered:false }; }

// Pan+zoom via a single CSS transform on the canvas (translate + scale). The SVG
// edges are children of the canvas so they scale in lockstep with the node
// cards — drawn once per render at scale-1 offsets, the transform handles every
// view change with no redraw while panning or zooming.
function _gApplyView(canvas){
  if(!canvas) return;
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = 'translate('+_gView.x+'px,'+_gView.y+'px) scale('+_gView.s+')';
}
if(!window._gPanWired){
  window._gPanWired = true;
  window.addEventListener('mousemove', function(e){
    if(!_gPan) return;
    _gView.x = _gPan.ox + (e.clientX - _gPan.x);
    _gView.y = _gPan.oy + (e.clientY - _gPan.y);
    _gApplyView(_gPan.canvas);
  });
  window.addEventListener('mouseup', function(){
    if(_gPan){ _gPan.sc.style.cursor = 'grab'; _gPan = null; }
  });
}

function _gBindZoom(scrollId){
  const sc = document.getElementById(scrollId); if(!sc) return;
  const canvas = sc.firstElementChild; if(!canvas) return;
  sc.style.overflow = 'hidden';            // pan is the transform, not native scroll
  sc.style.cursor = 'grab';
  // First paint (or after a tab/orient reset): centre the graph in the viewport
  // rather than letting a wide graph pin to the left edge.
  if(!_gView.centered){
    const cw = sc.clientWidth, ch = sc.clientHeight;
    const gw = canvas.offsetWidth * _gView.s, gh = canvas.offsetHeight * _gView.s;
    _gView.x = Math.round((cw - gw) / 2);
    _gView.y = (gh < ch) ? Math.round((ch - gh) / 2) : 20;
    _gView.centered = true;
  }
  _gApplyView(canvas);
  sc.addEventListener('wheel', function(e){
    if(e.ctrlKey) return;                  // let OS pinch-zoom through
    e.preventDefault();
    const rect = sc.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const prev = _gView.s;
    let s = Math.min(2.5, Math.max(0.4, prev * Math.exp(-e.deltaY * 0.0011)));
    if(s === prev) return;
    _gView.x = cx - (cx - _gView.x) * (s / prev);   // anchor point under cursor
    _gView.y = cy - (cy - _gView.y) * (s / prev);
    _gView.s = s;
    _gApplyView(canvas);
  }, { passive:false });
  sc.addEventListener('mousedown', function(e){
    if(e.button !== 0) return;
    if(e.target.closest('[onclick]')) return;       // let card clicks through
    _gPan = { sc:sc, canvas:canvas, x:e.clientX, y:e.clientY, ox:_gView.x, oy:_gView.y };
    sc.style.cursor = 'grabbing';
    e.preventDefault();
  });
  // Touch: one finger pans, two fingers pinch-zoom around the pinch midpoint.
  var ts = null;
  var _td = function(t){ var dx=t[0].clientX-t[1].clientX, dy=t[0].clientY-t[1].clientY; return Math.hypot(dx,dy); };
  sc.addEventListener('touchstart', function(e){
    var r = sc.getBoundingClientRect();
    if(e.touches.length === 1){
      ts = { mode:'pan', x:e.touches[0].clientX, y:e.touches[0].clientY, ox:_gView.x, oy:_gView.y };
    } else if(e.touches.length === 2){
      ts = { mode:'pinch', d0:_td(e.touches), s0:_gView.s, ox:_gView.x, oy:_gView.y,
             mx:(e.touches[0].clientX+e.touches[1].clientX)/2 - r.left,
             my:(e.touches[0].clientY+e.touches[1].clientY)/2 - r.top };
    }
  }, { passive:true });
  sc.addEventListener('touchmove', function(e){
    if(!ts) return;
    if(ts.mode === 'pan' && e.touches.length === 1){
      e.preventDefault();
      _gView.x = ts.ox + (e.touches[0].clientX - ts.x);
      _gView.y = ts.oy + (e.touches[0].clientY - ts.y);
      _gApplyView(canvas);
    } else if(ts.mode === 'pinch' && e.touches.length === 2){
      e.preventDefault();
      var s = Math.min(2.5, Math.max(0.4, ts.s0 * (_td(e.touches) / ts.d0)));
      _gView.x = ts.mx - (ts.mx - ts.ox) * (s / ts.s0);
      _gView.y = ts.my - (ts.my - ts.oy) * (s / ts.s0);
      _gView.s = s;
      _gApplyView(canvas);
    }
  }, { passive:false });
  sc.addEventListener('touchend', function(e){ if(e.touches.length === 0) ts = null; });
}

// A node card model: { id, label, sub, stat, accent, dot, icon(name), badge, click }
function _gCard(n, search){
  var sq = (search||'').toLowerCase();
  var lbl = n.label || '', sub = n.sub || '', stat = n.stat || '';
  var match = !sq || lbl.toLowerCase().indexOf(sq) > -1 || sub.toLowerCase().indexOf(sq) > -1;
  var op = !sq ? 1 : (match ? 1 : 0.2);
  var bdr = (match && sq) ? 'var(--c-accent)' : 'var(--c-border)';
  var bsh = (match && sq) ? '0 0 0 1px var(--c-accent)' : 'none';
  var ac = n.accent || '#64748b', dot = n.dot || '#6B7280';
  var click = n.click ? (' onclick="'+n.click+'"') : '';
  var badge = n.badge ? '<span class="g-badge" style="background:'+ac+'22;color:'+ac+'">'+esc(n.badge)+'</span>' : '';
  var ico = n.icon ? '<span class="g-card-ico" style="color:'+ac+'">'+svg(n.icon,14)+'</span>' : '';
  return '<div class="g-card" data-id="'+esc(n.id)+'"'+click
    + ' onmouseenter="_gHover(\''+esc(n.id)+'\')" onmouseleave="_gUnhover()"'
    + ' data-bdr="'+bdr+'" data-bsh="'+bsh+'"'
    + ' style="border-color:'+bdr+';box-shadow:'+bsh+';opacity:'+op+';cursor:'+(n.click?'pointer':'default')+'">'
    + '<div class="g-card-accent" style="background:'+ac+'"></div>'
    + '<div class="g-card-top">'+ico
      + '<span class="g-card-dot" style="background:'+dot+';box-shadow:0 0 4px '+dot+'80"></span>'
      + '<span class="g-card-name">'+esc(lbl)+'</span>'+badge+'</div>'
    + (sub ? '<div class="g-card-sub">'+esc(sub)+'</div>' : '')
    + (stat ? '<div class="g-card-stat">'+esc(stat)+'</div>' : '')
    + '</div>';
}

function _gTierCol(t, search){
  var cnt = (t.count != null) ? ' <span class="g-tier-cnt">('+t.count+')</span>' : '';
  // Grouped tier: each entry is {parent, children[]} — parent card with its
  // children in a bounded wrapped grid beneath (beside, in horizontal
  // orientation). Fixes the "34 guests = 6000px wide" sprawl of flat tiers.
  if(t.groups){
    var wrapDir = _gOrient==='vertical' ? 'row' : 'column';
    var groupDir = _gOrient==='vertical' ? 'column' : 'row';
    var body = t.groups.map(function(g){
      var n = g.children.length;
      var cols = n<=1 ? 1 : n<=4 ? 2 : n<=12 ? 3 : 4;
      return '<div class="g-group" style="flex-direction:'+groupDir+'">'
        + _gCard(g.parent, search)
        + (n ? '<div class="g-ggrid" style="grid-template-columns:repeat('+cols+',minmax(150px,1fr))">'
            + g.children.map(function(c){ return _gCard(c, search); }).join('') + '</div>' : '')
        + '</div>';
    }).join('');
    return '<div class="g-tier">'
      + '<div class="g-tier-lbl">'+esc(t.label)+cnt+'</div>'
      + '<div class="g-tier-cards" style="flex-direction:'+wrapDir+';flex-wrap:wrap;justify-content:center;align-items:flex-start;gap:18px">'+body+'</div>'
      + '</div>';
  }
  var cards = t.nodes.map(function(n){ return _gCard(n, search); }).join('');
  return '<div class="g-tier">'
    + '<div class="g-tier-lbl">'+esc(t.label)+cnt+'</div>'
    + '<div class="g-tier-cards" style="flex-direction:'+(_gOrient==='vertical'?'row':'column')+'">'+cards+'</div>'
    + '</div>';
}

function _gCanvasHtml(tiersHtml, scrollId, canvasId, svgId){
  var dir = _gOrient === 'vertical' ? 'column' : 'row';
  return '<div class="g-scroll" id="'+scrollId+'">'
    + '<div class="g-canvas" id="'+canvasId+'" style="flex-direction:'+dir+'">'
      + '<svg class="g-svg" id="'+svgId+'"></svg>'
      + '<div class="g-tiers" style="flex-direction:'+dir+'">'+tiersHtml+'</div>'
    + '</div></div>';
}

// Draw bezier connectors between cards. The canvas is transform:scale(s); the
// SVG (no viewBox) draws in unscaled units, so divide the measured px by s so
// edges land on the cards regardless of zoom. Mirrors the earlier edge-draw approach.
function _gDrawEdges(svgId){
  var svg = document.getElementById(svgId); if(!svg) return;
  var svgR = svg.getBoundingClientRect(); if(!svgR.width) return;
  var canvas = svg.parentElement;
  var horizontal = canvas && window.getComputedStyle(canvas).flexDirection === 'row';
  var z = _gView.s || 1;
  var edges = window._gEdges || [];
  var dark = document.documentElement.classList.contains('dark');
  var lblBg = dark ? '#18181b' : '#fff', lblBdr = dark ? '#3f3f46' : '#e4e4e7', lblTx = dark ? '#A1A1AA' : '#71717A';
  var paths = '', labels = '';
  edges.forEach(function(e){
    if(e.hidden) return;   // containment implies the relation (grouped view); still hover-connected
    var sEl = canvas.querySelector('.g-card[data-id="'+e.source+'"]');
    var tEl = canvas.querySelector('.g-card[data-id="'+e.target+'"]');
    if(!sEl || !tEl) return;
    var sR = sEl.getBoundingClientRect(), tR = tEl.getBoundingClientRect();
    var sx, sy, tx, ty, lx, ly, d;
    if(horizontal){
      sx = sR.right - svgR.left; sy = sR.top + sR.height/2 - svgR.top;
      tx = tR.left - svgR.left;  ty = tR.top + tR.height/2 - svgR.top;
      if(tx < sx){ sx = sR.left - svgR.left; tx = tR.right - svgR.left; }
      sx/=z; sy/=z; tx/=z; ty/=z;
      var mx = (sx+tx)/2;
      d = 'M'+sx+','+sy+' C'+mx+','+sy+' '+mx+','+ty+' '+tx+','+ty;
      lx = mx; ly = (sy+ty)/2;
    } else {
      sx = sR.left + sR.width/2 - svgR.left; sy = sR.bottom - svgR.top;
      tx = tR.left + tR.width/2 - svgR.left; ty = tR.top - svgR.top;
      if(ty < sy){ var _x=sx; sx=tx; sy=ty; tx=_x; ty=sR.top - svgR.top; }
      sx/=z; sy/=z; tx/=z; ty/=z;
      var my = (sy+ty)/2;
      d = 'M'+sx+','+sy+' C'+sx+','+my+' '+tx+','+my+' '+tx+','+ty;
      lx = (sx+tx)/2; ly = my;
    }
    var col = e.color || '#6B7280', dash = e.dash ? ' stroke-dasharray="4 3"' : '';
    paths += '<path class="g-edge" data-s="'+e.source+'" data-t="'+e.target+'" d="'+d+'" stroke="'+col+'" stroke-width="1.5" fill="none" opacity="0.45"'+dash+'/>';
    if(e.label){
      var lw = e.label.length * 5.4 + 12;
      labels += '<rect x="'+(lx-lw/2)+'" y="'+(ly-6.5)+'" width="'+lw+'" height="13" rx="3" fill="'+lblBg+'" stroke="'+lblBdr+'" stroke-width="0.5" opacity=".96"/>'
        + '<text x="'+lx+'" y="'+(ly+3.5)+'" text-anchor="middle" font-size="9" font-family="ui-monospace,monospace" fill="'+lblTx+'">'+escText(e.label)+'</text>';
    }
  });
  svg.innerHTML = paths + labels;
}

// Hover-highlight: fade unrelated cards/edges, accent the connected neighbourhood.
function _gHover(id){
  var edges = window._gEdges || [];
  var connected = new Set([id]);
  edges.forEach(function(e){ if(e.source===id || e.target===id){ connected.add(e.source); connected.add(e.target); } });
  document.querySelectorAll('.g-edge').forEach(function(p){
    var on = p.dataset.s===id || p.dataset.t===id;
    p.style.opacity = on ? '0.9' : '0.08';
    p.style.strokeWidth = on ? '2' : '1';
  });
  document.querySelectorAll('.g-card').forEach(function(elx){
    var on = connected.has(elx.dataset.id);
    elx.style.opacity = on ? '1' : '0.25';
    if(on) elx.style.borderColor = 'var(--c-accent)';
  });
}
function _gUnhover(){
  document.querySelectorAll('.g-edge').forEach(function(p){ p.style.opacity='0.45'; p.style.strokeWidth='1.5'; });
  document.querySelectorAll('.g-card').forEach(function(elx){
    elx.style.opacity = '1';
    elx.style.borderColor = elx.dataset.bdr || 'var(--c-border)';
    elx.style.boxShadow = elx.dataset.bsh || 'none';
  });
}

// Paint a graph (tiers + edges) into a mount element with pan/zoom bound.
function _gPaint(mountEl, tiers, edges, opts){
  opts = opts || {};
  var scrollId = opts.scrollId || 'g-scroll', canvasId = opts.canvasId || 'g-canvas', svgId = opts.svgId || 'g-svg';
  window._gEdges = edges;
  var shown = tiers.filter(function(t){ return t.groups ? t.groups.length : t.nodes.length; });
  if(!shown.length){
    mountEl.innerHTML = '<div class="g-empty">'+esc(opts.emptyMsg || 'Nothing to display.')+'</div>';
    return;
  }
  var tiersHtml = shown.map(function(t){ return _gTierCol(t, opts.search); }).join('');
  mountEl.innerHTML = _gCanvasHtml(tiersHtml, scrollId, canvasId, svgId);
  requestAnimationFrame(function(){ _gDrawEdges(svgId); _gBindZoom(scrollId); });
}

// A reusable search box that writes into `stateVar.search` and re-renders. The
// input lives OUTSIDE the graph body (which the render replaces), so it keeps
// focus/caret across re-renders — the same trick used for the topology
// search. `onInput` is a JS expression string invoked on each keystroke.
function _gSearchBox(value, onInput, onClear, placeholder){
  var v = escAttr(value||'');
  return '<div class="hd-search-wrap" style="max-width:360px;min-width:180px;flex:1">'
    + '<svg class="hd-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>'
    + '<input class="hd-search" type="search" placeholder="'+escAttr(placeholder||'Search…')+'" value="'+v+'" oninput="'+onInput+'">'
    + '<button class="hd-search-clear" onclick="'+onClear+'"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>'
    + '</div>';
}

// Layout-view segmented control (Grouped / Tiered), reuses .hist-range.
function _gLayoutControl(rangeId, onSet){
  return '<div class="hist-range" id="'+rangeId+'-hist-range" style="margin-left:0;flex-shrink:0" title="Layout view: nest guests under their parent, or flat rows">'
    + '<button class="hist-btn'+(_gLayout==='grouped'?' active':'')+'" data-layout="grouped" onclick="'+onSet+'(\'grouped\')" title="Grouped" style="display:inline-flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="14" width="8" height="8" rx="1"/><rect x="14" y="14" width="8" height="8" rx="1"/><path d="M12 8v3M6 14v-3h12v3"/></svg><span class="topo-btn-lbl">Grouped</span></button>'
    + '<button class="hist-btn'+(_gLayout==='tiered'?' active':'')+'" data-layout="tiered" onclick="'+onSet+'(\'tiered\')" title="Tiered" style="display:inline-flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="5" rx="1"/><rect x="3" y="10" width="18" height="5" rx="1"/><rect x="3" y="17" width="18" height="5" rx="1"/></svg><span class="topo-btn-lbl">Tiered</span></button>'
    + '</div>';
}

// Orientation segmented control (Horizontal / Vertical), reuses .hist-range.
function _gOrientControl(rangeId, onSet){
  return '<div class="hist-range" id="'+rangeId+'-hist-range" style="margin-left:0;flex-shrink:0" title="Graph layout direction">'
    + '<button class="hist-btn'+(_gOrient==='horizontal'?' active':'')+'" data-orient="horizontal" onclick="'+onSet+'(\'horizontal\')" title="Horizontal" style="display:inline-flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="16 7 21 12 16 17"/><polyline points="8 7 3 12 8 17"/></svg><span class="topo-btn-lbl">Horizontal</span></button>'
    + '<button class="hist-btn'+(_gOrient==='vertical'?' active':'')+'" data-orient="vertical" onclick="'+onSet+'(\'vertical\')" title="Vertical" style="display:inline-flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><polyline points="7 8 12 3 17 8"/><polyline points="7 16 12 21 17 16"/></svg><span class="topo-btn-lbl">Vertical</span></button>'
    + '</div>';
}

// ═══════════════════════════════════════════════════════════════════════════
// Topology page
// ═══════════════════════════════════════════════════════════════════════════
const _topoData = { data:null };
const _topoTab = { current:'compute' };
const _tCompute = { search:'' };
const _tStorage = { search:'' };
const _tNetwork = { search:'' };
let _topoSig = '';                    // structural signature — re-render on change only
window._topoNodeMap = {};             // id → { label, sub, status, accent, kind, rows, web_url }

// Router calls this on first navigation (see _deferInit in 10-router.js).
function _topoInit(){
  _gResetView();
  _topoSig = '';
  _topoData.data = window._lastData || null;
  var root = document.getElementById('infra-topology-root'); if(!root) return;
  _topoBootstrap(root);
  _renderTopoActive(false);
}

// WS tick hook, wired in 60-app-core.js via _R('topology', …). Only re-renders
// when the page is on screen, the user is not mid-pan, and the cluster structure
// actually changed — so live ticks never yank the user's pan/zoom or search.
window._topology_update = function(data){
  var page = document.getElementById('page-topology');
  if(!page || !page.classList.contains('active')) return;
  _topoData.data = data;
  var root = document.getElementById('infra-topology-root'); if(!root) return;
  if(!root.querySelector('#topo-tabbar-wrap')){ _topoBootstrap(root); _renderTopoActive(false); return; }
  if(_gPan) return;
  var sig = _topoSignature(data);
  if(sig !== _topoSig) _renderTopoActive(true);
  else _topoRefreshLive(data);
};

function _topoSignature(data){
  var px = (data && data.proxmox) || {};
  var parts = [];
  (px.nodes||[]).forEach(function(n){ parts.push('n'+n.node+':'+n.status); });
  (px.vms||[]).forEach(function(v){ parts.push('v'+v.vmid+':'+v.status+':'+v.node); });
  (px.lxcs||[]).forEach(function(v){ parts.push('l'+v.vmid+':'+v.status+':'+v.node); });
  (px.storage||[]).forEach(function(s){ parts.push('s'+s.storage+':'+s.node+':'+(s.shared?1:0)); });
  var net = px.network || {};
  Object.keys(net.nodes||{}).forEach(function(n){ parts.push('N'+n+':'+(net.nodes[n]||[]).length); });
  (net.guests||[]).forEach(function(g){ parts.push('G'+g.vmid+':'+(g.dev||'')+':'+(g.bridge||'')+':'+(g.tag==null?'':g.tag)+':'+g.status); });
  if(data && data.ceph) parts.push('ceph:'+(data.ceph.health||''));
  return parts.sort().join('|');
}

// Steady WS ticks keep the graph shell (and therefore pan/zoom/search state)
// intact, but the values inside its cards still need to move. Patch those text
// nodes directly whenever the structural signature is unchanged.
function _topoCardEl(id){
  var cards = document.querySelectorAll('#topo-content .g-card');
  for(var i=0;i<cards.length;i++) if(cards[i].dataset.id === id) return cards[i];
  return null;
}
function _topoPatchCard(id, vals){
  var card = _topoCardEl(id); if(!card) return;
  if(vals.sub != null){ var sub=card.querySelector('.g-card-sub'); if(sub) sub.textContent=vals.sub; }
  if(vals.stat != null){ var stat=card.querySelector('.g-card-stat'); if(stat) stat.textContent=vals.stat; }
  if(vals.dot){
    var dot=card.querySelector('.g-card-dot');
    if(dot){ dot.style.background=vals.dot; dot.style.boxShadow='0 0 4px '+vals.dot+'80'; }
  }
}
function _topoRefreshLive(data){
  var px = (data && data.proxmox) || {};
  if(_topoTab.current === 'compute'){
    var nodes=(px.nodes||[]).slice().sort(function(a,b){ return (a.node||'').localeCompare(b.node||''); });
    var vms=px.vms||[], lxcs=px.lxcs||[];
    var onlineN=nodes.filter(function(n){ return n.status==='online'; }).length;
    var runGuests=vms.filter(function(v){ return v.status==='running'; }).length
      + lxcs.filter(function(v){ return v.status==='running'; }).length;
    var totalGuests=vms.length+lxcs.length;
    var ceph=data && data.ceph;
    var cephSub=(ceph && ceph.status==='online') ? 'Ceph '+String(ceph.health||'?').replace('HEALTH_','') : '';
    _topoPatchCard('cluster', {
      sub:onlineN+'/'+nodes.length+' nodes',
      stat:runGuests+'/'+totalGuests+' guests running'+(cephSub?' · '+cephSub:'')
    });
    if(window._topoNodeMap.cluster){
      window._topoNodeMap.cluster.sub=onlineN+'/'+nodes.length+' nodes online';
      window._topoNodeMap.cluster.rows=[['Nodes online',onlineN+'/'+nodes.length],['Guests running',runGuests+'/'+totalGuests],['VMs / LXCs',vms.length+' / '+lxcs.length]];
      if(cephSub) window._topoNodeMap.cluster.rows.push(['Ceph',String(ceph.health||'?').replace('HEALTH_','')+(ceph.num_pools?' · '+ceph.num_pools+' pools':'')]);
    }
    nodes.forEach(function(n,i){
      var id='nd'+i, online=n.status==='online';
      var cpu=Math.round((n.cpu||0)*100), ram=n.maxmem?Math.round((n.mem||0)/n.maxmem*100):0;
      var gc=vms.filter(function(v){return v.node===n.node;}).length+lxcs.filter(function(v){return v.node===n.node;}).length;
      var sub=online?'up '+fmtUptime(n.uptime):(n.status||'offline');
      _topoPatchCard(id,{sub:sub,stat:online?gc+' guests · CPU '+cpu+'% · RAM '+ram+'%':'offline'});
      if(window._topoNodeMap[id]){
        window._topoNodeMap[id].sub=sub;
        window._topoNodeMap[id].rows=[['Status',n.status||'?']];
        if(online){
          window._topoNodeMap[id].rows.push(['CPU',cpu+'%'],['RAM',ram+'%'],['Guests',String(gc)]);
          if(n.uptime) window._topoNodeMap[id].rows.push(['Uptime',fmtUptime(n.uptime)]);
        }
      }
    });
    var guests=vms.map(function(v){return {g:v,kind:'qemu'};}).concat(lxcs.map(function(v){return {g:v,kind:'lxc'};}));
    guests.sort(function(a,b){
      var ar=a.g.status==='running'?0:1, br=b.g.status==='running'?0:1;
      return ar-br||((a.g.vmid||0)-(b.g.vmid||0));
    });
    guests.forEach(function(x,i){
      var v=x.g, id='g'+i, cpu=Math.round((v.cpu||0)*100), isVm=x.kind==='qemu';
      _topoPatchCard(id,{stat:'CPU '+cpu+'%'+(v.node?' · '+v.node:'')});
      if(window._topoNodeMap[id]){
        var rows=[['Type',isVm?'QEMU VM':'LXC'],['VMID',String(v.vmid)],['Status',v.status||'?'],['Node',v.node||'?'],['CPU',cpu+'%']];
        if(v.maxmem) rows.push(['RAM',Math.round((v.mem||0)/v.maxmem*100)+'%']);
        window._topoNodeMap[id].rows=rows;
      }
    });
    return;
  }
  if(_topoTab.current === 'storage'){
    var storMap={};
    (px.storage||[]).forEach(function(s){
      if(!s.storage||!s.maxdisk) return;
      var m=storMap[s.storage]||(storMap[s.storage]={name:s.storage,shared:!!s.shared,nodes:new Set(),disk:0,maxdisk:0,type:s.plugintype||s.type||''});
      if(s.node) m.nodes.add(s.node);
      if(s.shared) m.shared=true;
      m.disk=Math.max(m.disk,s.disk||0); m.maxdisk=Math.max(m.maxdisk,s.maxdisk||0);
    });
    Object.keys(storMap).map(function(k){ var m=storMap[k]; if(m.nodes.size>1)m.shared=true; return m; })
      .sort(function(a,b){ return (b.shared-a.shared)||a.name.localeCompare(b.name); })
      .forEach(function(s,i){
        var id='st'+i, pct=s.maxdisk?Math.round(s.disk/s.maxdisk*100):0;
        _topoPatchCard(id,{stat:fmtBytes(s.disk)+' / '+fmtBytes(s.maxdisk)+' · '+pct+'%'});
        if(window._topoNodeMap[id]) window._topoNodeMap[id].rows=[['Type',s.type||'storage'],['Usage',fmtBytes(s.disk)+' / '+fmtBytes(s.maxdisk)+' ('+pct+'%)'],['Scope',s.shared?'Shared':'Local'],['Nodes',String(s.nodes.size)]];
      });
    return;
  }
  if(_topoTab.current === 'network'){
    var net=px.network||{}, nodesObj=net.nodes||{};
    Object.keys(nodesObj).sort().forEach(function(name,i){
      var up=(nodesObj[name]||[]).filter(function(x){ return (x.type==='eth'||x.type==='bond'||x.type==='OVSBond')&&_netTruthy(x.active); }).length;
      _topoPatchCard('nd'+i,{sub:up+' active uplink'+(up===1?'':'s')});
    });
    _netBridgeAgg(net).forEach(function(b,i){
      var uplink=Array.from(b.ports).join(', ');
      _topoPatchCard('br'+i,{stat:b.nodes.size+' node'+(b.nodes.size===1?'':'s')+(uplink?' · '+uplink:''),dot:b.active?'#22C55E':'#6B7280'});
    });
  }
}

function _topoBootstrap(root){
  if(root.querySelector('#topo-tabbar-wrap')){ _topoThumbUpdate(); return; }
  root.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;background:var(--c-bg)';
  var tDefs = [
    { id:'compute', label:'Compute', icon:'<rect x="2" y="3" width="20" height="7" rx="1"/><rect x="2" y="14" width="20" height="7" rx="1"/>' },
    { id:'storage', label:'Storage', icon:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3S3 13.66 3 12"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>' },
    { id:'network', label:'Network', icon:'<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><line x1="5" y1="16" x2="12" y2="12"/><line x1="19" y1="16" x2="12" y2="12"/>' },
  ];
  root.innerHTML =
    '<div id="topo-tabbar-wrap" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;flex-shrink:0;border-bottom:1px solid var(--c-border)">'
    + '<div id="topo-view-controls" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;flex-wrap:wrap"></div>'
    + '<div class="hist-range" id="topo-tabs-hist-range" role="tablist" style="margin-left:0;flex-shrink:0">'
    + tDefs.map(function(t){
        var active = _topoTab.current === t.id;
        return '<button class="hist-btn'+(active?' active':'')+'" id="topo-tab-'+t.id+'" onclick="topoSwitchTab(\''+t.id+'\')" role="tab" title="'+t.label+'" style="display:inline-flex;align-items:center;gap:5px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+t.icon+'</svg><span class="topo-btn-lbl">'+t.label+'</span></button>';
      }).join('')
    + '</div>'
    + '<div id="topo-orient-wrap" style="flex:1;display:flex;justify-content:flex-end;align-items:center;gap:8px;min-width:0">'
    + '<span id="topo-layout-wrap">' + _gLayoutControl('topo-layout', 'topoSetLayout') + '</span>'
    + _gOrientControl('topo-orient', 'topoSetOrient')
    + '</div>'
    + '</div>'
    + '<div id="topo-content" style="flex:1;width:100%;overflow:hidden;min-height:0;min-width:0;display:flex;flex-direction:column"></div>';
  requestAnimationFrame(function(){ _topoThumbUpdate(); });
  // The icons-only breakpoint is a CONTAINER query — it also fires when the
  // sidebar collapses (no window resize), so watch the bar's own width too.
  if(window.ResizeObserver){
    var bar = root.querySelector('#topo-tabbar-wrap');
    if(bar && !bar._thumbRO){
      bar._thumbRO = new ResizeObserver(function(){
        clearTimeout(_topoResizeT);
        _topoResizeT = setTimeout(_topoThumbUpdate, 120);
      });
      bar._thumbRO.observe(bar);
    }
  }
}

function _topoThumbUpdate(){
  if(typeof _histThumbUpdate === 'function'){ _histThumbUpdate('topo-tabs'); _histThumbUpdate('topo-orient'); _histThumbUpdate('topo-layout'); }
}
// Crossing the icons-only breakpoint changes every button's width — reposition
// the segmented-control thumbs after resize settles.
let _topoResizeT = null;
addEventListener('resize', function(){
  clearTimeout(_topoResizeT);
  _topoResizeT = setTimeout(_topoThumbUpdate, 180);
});

function topoSwitchTab(tab){
  _topoTab.current = tab;
  _gResetView();
  ['compute','storage','network'].forEach(function(t){
    var b = document.getElementById('topo-tab-'+t);
    if(b) b.classList.toggle('active', t===tab);
  });
  _topoThumbUpdate();
  _renderTopoActive(false);
}

function topoSetOrient(o){
  _gOrient = (o==='vertical') ? 'vertical' : 'horizontal';
  var r = document.getElementById('topo-orient-hist-range');
  if(r) r.querySelectorAll('.hist-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.orient===_gOrient); });
  _topoThumbUpdate();
  _gResetView();
  _renderTopoActive(false);
}

function topoSetLayout(l){
  _gLayout = (l==='tiered') ? 'tiered' : 'grouped';
  try { localStorage.setItem('pd-topo-layout', _gLayout); } catch(e){}
  var r = document.getElementById('topo-layout-hist-range');
  if(r) r.querySelectorAll('.hist-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.layout===_gLayout); });
  if(typeof _histThumbUpdate === 'function') _histThumbUpdate('topo-layout');
  _gResetView();
  _renderTopoActive(false);
}

// graphOnly=true: only rebuild the graph body (keeps the search input focus).
function _renderTopoActive(graphOnly){
  var el = document.getElementById('topo-content'); if(!el) return;
  _topoSig = _topoSignature(_topoData.data);
  // The layout view applies to the parent/child tabs; Storage is a small
  // bipartite graph where grouping adds nothing — hide the control there.
  var lw = document.getElementById('topo-layout-wrap');
  if(lw) lw.style.display = (_topoTab.current === 'storage') ? 'none' : '';
  if(_topoTab.current === 'storage') _topoStorageRender(el, graphOnly);
  else if(_topoTab.current === 'network') _topoNetworkRender(el, graphOnly);
  else _topoComputeRender(el, graphOnly);
}

// ── Compute view: Cluster → Nodes → VMs/LXCs ─────────────────────────────────
function _topoComputeRender(el, graphOnly){
  window._topoNodeMap = {};
  var data = _topoData.data || {};
  var px = data.proxmox || {}, ceph = data.ceph || null;
  var nodes = (px.nodes||[]).slice().sort(function(a,b){ return (a.node||'').localeCompare(b.node||''); });
  var vms = (px.vms||[]), lxcs = (px.lxcs||[]);
  var webUrl = px.web_url || '';
  var sq = _tCompute.search;

  var noData = !nodes.length && !vms.length && !lxcs.length;
  if(!graphOnly){
    var controls = _gSearchBox(sq, "_tCompute.search=this.value;_renderTopoActive(true)", "_tCompute.search='';_renderTopoActive(true)", 'Search nodes or guests…');
    var vc = document.getElementById('topo-view-controls'); if(vc) vc.innerHTML = controls;
  }
  if(noData){
    el.innerHTML = '<div class="g-empty">'+(data.proxmox!==undefined ? 'No Proxmox data — add your cluster in Settings.' : 'Loading topology…')+'</div>';
    return;
  }

  // Cluster tier
  var onlineN = nodes.filter(function(n){return n.status==='online';}).length;
  var runGuests = vms.filter(function(v){return v.status==='running';}).length + lxcs.filter(function(v){return v.status==='running';}).length;
  var totGuests = vms.length + lxcs.length;
  var quorumOk = nodes.length && onlineN === nodes.length;
  var clusterStatus = !nodes.length ? 'offline' : (quorumOk ? 'online' : (onlineN ? 'warning' : 'offline'));
  var cephSub = '';
  if(ceph && ceph.status === 'online') cephSub = 'Ceph ' + String(ceph.health||'?').replace('HEALTH_','');
  var clusterRows = [['Nodes online', onlineN+'/'+nodes.length], ['Guests running', runGuests+'/'+totGuests], ['VMs / LXCs', vms.length+' / '+lxcs.length]];
  if(cephSub) clusterRows.push(['Ceph', String(ceph.health||'?').replace('HEALTH_','') + (ceph.num_pools ? ' · '+ceph.num_pools+' pools' : '')]);
  window._topoNodeMap['cluster'] = { label:'Proxmox Cluster', sub:onlineN+'/'+nodes.length+' nodes online', status:clusterStatus, accent:'#8b5cf6', kind:'cluster', rows:clusterRows };
  var clusterTier = { key:'cluster', label:'Cluster', nodes:[{
    id:'cluster', label:'Proxmox Cluster', sub:onlineN+'/'+nodes.length+' nodes', stat:runGuests+'/'+totGuests+' guests running'+(cephSub?' · '+cephSub:''),
    accent:'#8b5cf6', dot:_gsc(clusterStatus), icon:'grid', click:"_openTopoDrawer('cluster')"
  }]};

  // Nodes tier
  var nodeCards = nodes.map(function(n, i){
    var id = 'nd'+i;
    var online = n.status === 'online';
    var cpu = Math.round((n.cpu||0)*100);
    var ram = n.maxmem ? Math.round(n.mem/n.maxmem*100) : 0;
    var gc = vms.filter(function(v){return v.node===n.node;}).length + lxcs.filter(function(v){return v.node===n.node;}).length;
    var rows = [['Status', n.status||'?']];
    if(online){ rows.push(['CPU', cpu+'%']); rows.push(['RAM', ram+'%']); rows.push(['Guests', String(gc)]); if(n.uptime) rows.push(['Uptime', fmtUptime(n.uptime)]); }
    window._topoNodeMap[id] = { label:n.node, sub:online?'up '+fmtUptime(n.uptime):(n.status||'offline'), status:n.status, accent:'#F59E0B', kind:'node', rows:rows, web_url:webUrl };
    return {
      id:id, label:n.node, _node:n.node,
      sub: online ? 'up '+fmtUptime(n.uptime) : (n.status||'offline'),
      stat: online ? gc+' guests · CPU '+cpu+'% · RAM '+ram+'%' : 'offline',
      accent:'#F59E0B', dot:_gsc(n.status), icon:'server', click:"_openTopoDrawer('"+id+"')"
    };
  });
  var nodeByName = {}; nodeCards.forEach(function(c){ nodeByName[c._node] = c.id; });

  // Guests tier
  var guests = vms.map(function(v){return {g:v, kind:'qemu'};}).concat(lxcs.map(function(v){return {g:v, kind:'lxc'};}));
  guests.sort(function(a,b){
    var ar=a.g.status==='running'?0:1, br=b.g.status==='running'?0:1;
    return ar-br || ((a.g.vmid||0)-(b.g.vmid||0));
  });
  var edges = [];
  var grouped = _gLayout === 'grouped';
  var guestCards = guests.map(function(x, i){
    var v = x.g, id = 'g'+i;
    var cpu = Math.round((v.cpu||0)*100);
    var isVm = x.kind==='qemu';
    var ac = isVm ? '#06b6d4' : '#10b981';
    var rows = [['Type', isVm?'QEMU VM':'LXC'], ['VMID', String(v.vmid)], ['Status', v.status||'?'], ['Node', v.node||'?'], ['CPU', cpu+'%']];
    if(v.maxmem) rows.push(['RAM', Math.round((v.mem||0)/v.maxmem*100)+'%']);
    window._topoNodeMap[id] = { label:v.name||('#'+v.vmid), sub:'#'+v.vmid+' · '+v.node, status:v.status, accent:ac, kind:x.kind, rows:rows };
    // Grouped view hides the parent→child connector (containment shows it) but
    // keeps the edge for hover-highlighting.
    if(nodeByName[v.node]) edges.push({ source:nodeByName[v.node], target:id, color:'#6B7280', hidden:grouped });
    return {
      id:id, label:v.name||('#'+v.vmid), sub:(isVm?'VM':'LXC')+' · #'+v.vmid,
      stat:'CPU '+cpu+'%'+(v.node?' · '+v.node:''), accent:ac, dot:_gsc(v.status),
      icon:isVm?'monitor':'layers', click:"_openTopoDrawer('"+id+"')", _node:v.node
    };
  });
  nodeCards.forEach(function(c){ edges.push({ source:'cluster', target:c.id, color:'#8b5cf6' }); });

  var tiers;
  if(grouped){
    var groups = nodeCards.map(function(c){
      return { parent:c, children:guestCards.filter(function(g){ return g._node === c._node; }) };
    });
    var orphans = guestCards.filter(function(g){ return !nodeByName[g._node]; });
    tiers = [clusterTier,
      { key:'nodes', label:'Nodes & Guests', count:guestCards.length, groups:groups }];
    if(orphans.length) tiers.push({ key:'orphans', label:'Other guests', count:orphans.length, nodes:orphans });
  } else {
    tiers = [clusterTier,
      { key:'nodes', label:'Nodes', count:nodeCards.length, nodes:nodeCards },
      { key:'guests', label:'Guests', count:guestCards.length, nodes:guestCards }];
  }
  _gPaint(el, tiers, edges, { scrollId:'topo-scroll', canvasId:'topo-canvas', svgId:'topo-svg', search:sq, emptyMsg:'No compute nodes.' });
}

// ── Storage view: Nodes ↔ backing storage (shared/Ceph vs local) ─────────────
function _topoStorageRender(el, graphOnly){
  window._topoNodeMap = {};
  var data = _topoData.data || {};
  var px = data.proxmox || {};
  var nodes = (px.nodes||[]).slice().sort(function(a,b){ return (a.node||'').localeCompare(b.node||''); });
  var sq = _tStorage.search;

  // Aggregate storage rows by name; a store is shared if flagged or seen on >1 node.
  var storMap = {};
  (px.storage||[]).forEach(function(s){
    if(!s.storage || !s.maxdisk) return;
    var m = storMap[s.storage] || (storMap[s.storage] = { name:s.storage, shared:!!s.shared, nodes:new Set(), disk:0, maxdisk:0, type:s.plugintype||s.type||'' });
    if(s.node) m.nodes.add(s.node);
    if(s.shared) m.shared = true;
    m.disk = Math.max(m.disk, s.disk||0);
    m.maxdisk = Math.max(m.maxdisk, s.maxdisk||0);
  });
  var storList = Object.keys(storMap).map(function(k){ var m=storMap[k]; if(m.nodes.size>1) m.shared=true; return m; })
    .sort(function(a,b){ return (b.shared-a.shared) || a.name.localeCompare(b.name); });

  var noData = !storList.length;
  if(!graphOnly){
    var controls = _gSearchBox(sq, "_tStorage.search=this.value;_renderTopoActive(true)", "_tStorage.search='';_renderTopoActive(true)", 'Search nodes or storage…');
    var vc = document.getElementById('topo-view-controls'); if(vc) vc.innerHTML = controls;
  }
  if(noData){
    el.innerHTML = '<div class="g-empty">'+(px.storage!==undefined ? 'No storage reported by the cluster.' : 'Loading topology…')+'</div>';
    return;
  }

  // Nodes tier (only nodes that back at least one store, plus keep all for context)
  var nodeByName = {};
  var nodeCards = nodes.map(function(n, i){
    var id = 'nd'+i;
    nodeByName[n.node] = id;
    window._topoNodeMap[id] = { label:n.node, sub:n.status||'?', status:n.status, accent:'#F59E0B', kind:'node', rows:[['Status', n.status||'?']] };
    return { id:id, label:n.node, sub:n.status==='online'?'online':(n.status||'offline'), accent:'#F59E0B', dot:_gsc(n.status), icon:'server', click:"_openTopoDrawer('"+id+"')" };
  });

  // Storage tier
  var edges = [];
  var storCards = storList.map(function(s, i){
    var id = 'st'+i;
    var pct = s.maxdisk ? Math.round(s.disk/s.maxdisk*100) : 0;
    var ac = s.shared ? 'var(--c-accent)' : '#64748b';
    var acHex = s.shared ? _gAccentHex() : '#64748b';
    var rows = [['Type', s.type||'storage'], ['Usage', fmtBytes(s.disk)+' / '+fmtBytes(s.maxdisk)+' ('+pct+'%)'], ['Scope', s.shared?'Shared':'Local'], ['Nodes', String(s.nodes.size)]];
    window._topoNodeMap[id] = { label:s.name, sub:(s.shared?'Shared':'Local')+' · '+(s.type||'storage'), status:'online', accent:acHex, kind:'storage', rows:rows };
    s.nodes.forEach(function(nm){ if(nodeByName[nm]) edges.push({ source:nodeByName[nm], target:id, color:s.shared?acHex:'#6B7280', dash:!s.shared }); });
    return {
      id:id, label:s.name, sub:(s.shared?'Shared':'Local')+' · '+(s.type||'storage'),
      stat:fmtBytes(s.disk)+' / '+fmtBytes(s.maxdisk)+' · '+pct+'%',
      accent:acHex, dot:_gsc('online'), icon:'database', badge:s.shared?'SHARED':null, click:"_openTopoDrawer('"+id+"')"
    };
  });

  var tiers = [
    { key:'nodes', label:'Nodes', count:nodeCards.length, nodes:nodeCards },
    { key:'storage', label:'Storage', count:storCards.length, nodes:storCards }
  ];
  _gPaint(el, tiers, edges, { scrollId:'topo-scroll', canvasId:'topo-canvas', svgId:'topo-svg', search:sq, emptyMsg:'No storage.' });
}

// ── Network view: Nodes → Bridges → attached Guests ──────────────────────────
// Built from the px.network snapshot (node interface lists + parsed guest net
// configs — see 24-network.js for the aggregation helpers). Node→Bridge edges
// are labelled with the physical uplink port(s) feeding the bridge (NIC/bond);
// Bridge→Guest edges carry the VLAN tag. Bridges are aggregated by name across
// the cluster (vmbr0 spanning every node → one card).
function _topoNetworkRender(el, graphOnly){
  window._topoNodeMap = {};
  var data = _topoData.data || {};
  var net = (data.proxmox && data.proxmox.network) || null;
  var sq = _tNetwork.search;

  if(!graphOnly){
    var controls = _gSearchBox(sq, "_tNetwork.search=this.value;_renderTopoActive(true)", "_tNetwork.search='';_renderTopoActive(true)", 'Search nodes, bridges, guests…');
    var vc = document.getElementById('topo-view-controls'); if(vc) vc.innerHTML = controls;
  }

  var nodesObj=(net&&net.nodes)||{}, guests=(net&&net.guests)||[];
  var nodeNames=Object.keys(nodesObj).sort();
  var bridges=net ? _netBridgeAgg(net) : [];
  var hasIfaces = nodeNames.some(function(n){ return (nodesObj[n]||[]).length; });
  if(!net || (!bridges.length && !hasIfaces && !guests.length)){
    el.innerHTML = '<div class="g-empty">'+(data.proxmox!==undefined ? 'No network data reported by the cluster — add your Proxmox cluster in Settings.' : 'Loading topology…')+'</div>';
    return;
  }

  var edges=[];
  var nodeById={};
  var nodeCards=nodeNames.map(function(n, i){
    var id='nd'+i;
    nodeById[n]=id;
    var ifaces=nodesObj[n]||[];
    var up=ifaces.filter(function(x){ return (x.type==='eth'||x.type==='bond'||x.type==='OVSBond') && _netTruthy(x.active); }).length;
    return { id:id, label:n, sub:up+' active uplink'+(up===1?'':'s'), accent:'#F59E0B', dot:'#22C55E', icon:'server' };
  });

  var brById={};
  var brCards=bridges.map(function(b, i){
    var id='br'+i;
    brById[b.name]=id;
    var ports=Array.from(b.ports);
    var uplink=ports.join(', ');
    nodeNames.forEach(function(n){
      if(b.nodes.has(n)) edges.push({ source:nodeById[n], target:id, color:'#6B7280', label:uplink||undefined });
    });
    return {
      id:id, label:b.name, sub:b.cidr||'no IP',
      stat:b.nodes.size+' node'+(b.nodes.size===1?'':'s')+(uplink?' · '+uplink:''),
      accent:_gAccentHex(), dot:b.active?'#22C55E':'#6B7280', icon:'network',
      badge:b.vlanAware?'VLAN-aware':(b.ovs?'OVS':null)
    };
  });

  var grouped = _gLayout === 'grouped';
  var gCards=guests.slice().sort(function(a,c){
    var r=(c.status==='running')-(a.status==='running'); if(r) return r;
    return String(a.name).localeCompare(String(c.name));
  }).map(function(g, i){
    var id='gg'+i;
    var running=g.status==='running';
    var hasTag=(g.tag!=null && g.tag!=='');
    if(brById[g.bridge]!=null) edges.push({ source:brById[g.bridge], target:id, color:hasTag?_gAccentHex():'#6B7280', label:hasTag?('VLAN '+g.tag):undefined, hidden:grouped });
    return {
      id:id, label:g.name||('#'+g.vmid), sub:'#'+g.vmid+(g.type?' · '+g.type:''),
      stat:g.bridge||'', accent:running?'#22C55E':'#64748b', dot:running?'#22C55E':'#6B7280',
      icon:'monitor', badge:hasTag?('VLAN '+g.tag):null, _bridge:g.bridge
    };
  });

  var tiers;
  if(grouped){
    var groups=brCards.map(function(b){
      return { parent:b, children:gCards.filter(function(g){ return g._bridge === b.label; }) };
    });
    var orphans=gCards.filter(function(g){ return brById[g._bridge]==null; });
    tiers=[
      { key:'nodes', label:'Nodes', count:nodeCards.length, nodes:nodeCards },
      { key:'bridges', label:'Bridges & Guests', count:gCards.length, groups:groups }
    ];
    if(orphans.length) tiers.push({ key:'orphans', label:'Unattached guests', count:orphans.length, nodes:orphans });
  } else {
    tiers=[
      { key:'nodes', label:'Nodes', count:nodeCards.length, nodes:nodeCards },
      { key:'bridges', label:'Bridges', count:brCards.length, nodes:brCards },
      { key:'guests', label:'Guests', count:gCards.length, nodes:gCards }
    ];
  }
  _gPaint(el, tiers, edges, { scrollId:'topo-scroll', canvasId:'topo-canvas', svgId:'topo-svg', search:sq, emptyMsg:'No bridges or guests reported.' });
}

// ── Shared slide-in detail drawer ────────────────────────────────────────────
function _openTopoDrawer(id){
  var node = window._topoNodeMap[id]; if(!node) return;
  document.querySelector('.topo-drawer-ov')?.remove();
  var ac = node.accent || 'var(--c-accent)', sc = _gsc(node.status);
  var iconName = { cluster:'grid', node:'server', qemu:'monitor', lxc:'layers', storage:'database' }[node.kind] || 'server';
  var rows = (node.rows||[]);
  var tbody = rows.map(function(r){
    return '<tr><td class="topo-dr-k">'+esc(r[0])+'</td><td class="topo-dr-v">'+esc(r[1])+'</td></tr>';
  }).join('');
  var root = document.getElementById('infra-topology-root') || document.body;
  var webHref = safeHttpUrl(node.web_url);
  var ov = document.createElement('div');
  ov.className = 'topo-drawer-ov';
  ov.innerHTML =
    '<div class="topo-drawer">'
    + '<div class="topo-dr-hdr">'
      + '<span class="topo-dr-ico" style="color:'+ac+'">'+svg(iconName,16)+'</span>'
      + '<div class="topo-dr-title"><div class="topo-dr-name">'+esc(node.label)+'</div><div class="topo-dr-sub">'+esc(node.sub||'')+'</div></div>'
      + '<span class="topo-dr-status"><span class="g-card-dot" style="background:'+sc+'"></span>'+esc(node.status||'')+'</span>'
      + '<button class="topo-dr-close" onclick="this.closest(\'.topo-drawer-ov\').remove()">&times;</button>'
    + '</div>'
    + '<div class="topo-dr-body">'
      + (rows.length ? '<table class="topo-dr-tbl"><tbody>'+tbody+'</tbody></table>' : '<div class="topo-dr-empty">No details available.</div>')
      + (webHref ? '<a class="topo-dr-link" href="'+escAttr(webHref)+'" target="_blank" rel="noopener" style="color:'+ac+';border-color:'+ac+'55;background:'+ac+'14">Open in Proxmox &rarr;</a>' : '')
    + '</div></div>';
  ov.addEventListener('click', function(e){ if(e.target===ov) ov.remove(); });
  root.appendChild(ov);
}

// Re-route edges when the viewport resizes (cards reflow / wrap).
if(!window._gResizeWired){
  window._gResizeWired = true;
  var _gResizeTimer = null;
  window.addEventListener('resize', function(){
    clearTimeout(_gResizeTimer);
    _gResizeTimer = setTimeout(function(){
      if(document.getElementById('topo-svg')) _gDrawEdges('topo-svg');
    }, 120);
  });
}

;window.__BUILD__='820b648b109f';
