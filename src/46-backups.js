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
