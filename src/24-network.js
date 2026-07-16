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
