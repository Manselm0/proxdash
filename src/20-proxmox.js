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
