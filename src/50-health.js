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
