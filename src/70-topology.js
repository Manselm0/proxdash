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
