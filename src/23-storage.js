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
