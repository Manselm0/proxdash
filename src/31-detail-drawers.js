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
