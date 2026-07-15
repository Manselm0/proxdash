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
  if(name==='overview')      { setTimeout(()=>{loadOvResources(_histGetHours('ov-infra'));loadOvNetwork(_histGetHours('ov-net'));loadOvStorageForecast(_histGetHours('ov-stor'));if(typeof _loadPbsDetail==='function')_loadPbsDetail();},0); }
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
