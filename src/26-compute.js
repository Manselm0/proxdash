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
    + th('cpu', 'CPU', 'right') + th('ram', 'RAM', 'right') + th('disk', 'Disk', 'right') + th('uptime', 'Uptime')
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
// Toggle the Cluster CPU + RAM line charts between per-node and per-guest
// (VMs / LXCs) series. The actual loading lives in loadPxHistory /
// _loadPxGuestHistory (src/65-time-range.js); here we just hold the state and
// re-trigger a load on toggle. The filter box is only useful for guest scopes,
// so it's hidden for Nodes.
window._pxScope = window._pxScope || { scope: 'nodes', search: '' };
let _pxScopeTimer = null;
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
