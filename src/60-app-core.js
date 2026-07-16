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
