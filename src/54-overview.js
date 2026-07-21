// ── Overview — Mission Control (triage-first) ───────────────────────────────
// The overview answers one question fast: "is everything healthy, and if not,
// what needs me first?" Layout, top to bottom:
//   • Verdict banner — one-line cluster health call + node/guest/uptime meta
//   • Stat-tile summary row (the house .hd-card p-3 + _statTile pattern)
//   • Needs attention — a synthesized, severity-ranked feed built across every
//     subsystem (nodes, quorum, Ceph, backups, storage, updates, certs, health,
//     firewall, 2FA, stopped guests) — each row navigates to its owning page
//   • Node activity — compact per-node two-minute CPU/RAM traces + Ceph status
//   • Cluster load — the live utilization history chart (loadOvResources)
//   • Top consumers — the hottest guests, CPU⇄RAM toggle
//   • Recent activity — the cluster task log
//
// Everything is derived from the generic Proxmox/Ceph/PBS snapshot, so it renders
// for any environment and each fetcher degrades gracefully when absent/denied.
// renderOverview fires on every WS tick; the chart block (#ov-cluster-charts) is
// saved/restored across the innerHTML rebuild so the Chart.js instance stays live,
// and its data reload is throttled to 5 minutes.

var _ovLeadMode = 'cpu';          // Top-consumers toggle, persisted across ticks
var _ovLastData = null;           // last snapshot, so the toggle can re-render
var _OV_PULSE_WINDOW_MS = 120000;
var _ovPulseHistory = {};         // rolling two-minute node samples (3-second cadence)
var _ovPulseLastSample = 0;
var _ovPulsePreloadAt = 0;
var _ovPulsePreloadBusy = false;

function _ovAccent() {
  return (getComputedStyle(document.documentElement).getPropertyValue('--c-accent') || '#E57000').trim();
}

// ── Derive: everything the sections read, computed from the snapshot ──────────
function _ovDerive(data) {
  var px = data.proxmox || {}, ceph = data.ceph || {}, hc = data.health || {}, sec = data.security || {};
  var pbs = data.pbs || {}, _pd = window._pbsDetail || {};
  var nodes = (px.nodes || []).slice().sort(function (a, b) { return (a.node || '').localeCompare(b.node || ''); });
  var online = nodes.filter(function (n) { return n.status === 'online'; });
  var vms = px.vms || [], lxcs = px.lxcs || [], guests = vms.concat(lxcs);
  var running = guests.filter(function (g) { return g.status === 'running'; });
  var stopped = guests.filter(function (g) { return g.status !== 'running' && !g.template; });

  var cores = 0, wCpu = 0, mem = 0, memMax = 0;
  nodes.forEach(function (n) { cores += n.maxcpu || 0; wCpu += (n.cpu || 0) * (n.maxcpu || 0); mem += n.mem || 0; memMax += n.maxmem || 0; });
  var cpuPct = cores ? Math.round(wCpu / cores * 100) : 0;
  var memPct = memMax ? Math.round(mem / memMax * 100) : 0;

  var stores = _storageAgg(px.storage || []);
  var stUsed = stores.reduce(function (a, s) { return a + (s.disk || 0); }, 0);
  var stCap = stores.reduce(function (a, s) { return a + (s.maxdisk || 0); }, 0);
  var stPct = stCap ? Math.round(stUsed / stCap * 100) : 0;

  var cephOn = ceph && ceph.status === 'online';
  var cephOk = cephOn && String(ceph.health || '').toUpperCase().indexOf('ERR') < 0;
  var cephPct = ceph.usable_percent != null ? Math.round(ceph.usable_percent)
    : (ceph.usable_total_bytes ? Math.round((ceph.usable_used_bytes || 0) / ceph.usable_total_bytes * 100) : 0);

  var pbsOn = pbs.status === 'online' || (pbs.datastores && pbs.datastores.length);
  var groups = (pbs.groups && pbs.groups.length) ? pbs.groups : (_pd.groups || []);
  var snaps = ((pbs.snapshots && pbs.snapshots.length) ? pbs.snapshots : (_pd.snapshots || [])).length;
  var latest = groups.reduce(function (m, g) { return Math.max(m, g.latest_time || 0); }, 0);
  var failedB = groups.reduce(function (a, g) { return a + (g.failed_count || 0); }, 0);
  var ds = (pbs.datastores || [])[0] || null;
  var staleH = latest ? ((Date.now() / 1000 - latest) / 3600) : null;

  var hKeys = Object.keys(hc).filter(function (k) { return hc[k] && typeof hc[k] === 'object' && 'up' in hc[k]; });
  var hDown = hKeys.filter(function (k) { return !hc[k].up; });

  var tasks = (data.tasks && data.tasks.tasks) || [];
  var failedTasks = tasks.filter(function (t) { return t.failed; });

  var users = (sec.users || []).filter(function (u) { return u.enable; });
  var noTfa = users.filter(function (u) { return !u.tfa; });
  var fw = sec.firewall || null;

  // ── Attention feed ──────────────────────────────────────────────────────
  var att = [];
  function A(sev, ic, t, d, page) { att.push({ sev: sev, ic: ic, t: t, d: d, page: page }); }
  nodes.filter(function (n) { return n.status !== 'online'; }).forEach(function (n) {
    A('crit', 'server', 'Node offline — ' + n.node, 'Cluster is running degraded', 'proxmox'); });
  if (nodes.length > 1 && online.length <= nodes.length / 2)
    A('crit', 'alert-triangle', 'Quorum lost', online.length + '/' + nodes.length + ' nodes online', 'proxmox');
  if (cephOn && !cephOk)
    A(String(ceph.health).toUpperCase().indexOf('ERR') >= 0 ? 'crit' : 'warn', 'database',
      'Ceph ' + String(ceph.health || '').replace('HEALTH_', ''),
      (ceph.num_up_osds != null ? ceph.num_up_osds + '/' + ceph.num_osds + ' OSDs up' : 'Cluster health degraded'), 'health');
  failedTasks.slice(0, 3).forEach(function (t) {
    A('crit', 'archive', 'Backup failed — ' + (t.type === 'vzdump' ? 'guest ' : '') + t.id,
      esc(t.status || 'failed') + ' · ' + timeAgo((t.start || 0) * 1000), 'backups'); });
  if (failedB) A('crit', 'archive', failedB + ' failed backup' + (failedB > 1 ? 's' : ''), 'In the Proxmox Backup Server history', 'backups');
  if (staleH != null && staleH > 36) A('warn', 'clock', 'Backups are stale', 'Last successful backup ' + timeAgo(latest * 1000), 'backups');
  stores.filter(function (s) { return s.maxdisk && s.disk / s.maxdisk > 0.9; }).forEach(function (s) {
    var p = Math.round(s.disk / s.maxdisk * 100);
    A('crit', 'hard-drive', 'Storage almost full — ' + s.name, p + '% used (' + fmtBytes(s.disk) + ' / ' + fmtBytes(s.maxdisk) + ')', 'storage'); });
  stores.filter(function (s) { var p = s.maxdisk ? s.disk / s.maxdisk : 0; return p > 0.75 && p <= 0.9; }).forEach(function (s) {
    A('warn', 'hard-drive', 'Storage filling — ' + s.name, Math.round(s.disk / s.maxdisk * 100) + '% used', 'storage'); });
  nodes.filter(function (n) { return n.reboot_required; }).forEach(function (n) {
    A('warn', 'rotate-ccw', 'Reboot required — ' + n.node, 'A kernel or microcode update is pending', 'proxmox'); });
  var upd = nodes.filter(function (n) { return (n.updates || 0) > 0; });
  if (upd.length) { var tot = upd.reduce(function (a, n) { return a + n.updates; }, 0);
    A('info', 'arrow-up-circle', tot + ' package update' + (tot > 1 ? 's' : '') + ' available',
      upd.map(function (n) { return n.node + ' (' + n.updates + ')'; }).join(', '), 'proxmox'); }
  nodes.filter(function (n) { return n.cert_days != null && n.cert_days < 30; }).forEach(function (n) {
    A('warn', 'shield', 'TLS certificate expiring — ' + n.node, n.cert_days + ' days remaining', 'security'); });
  hDown.forEach(function (k) { A('crit', 'activity', 'Health check down — ' + k, esc((hc[k] || {}).error || 'unreachable'), 'health'); });
  if (fw && fw.enable != null && fw.enable != 1) A('warn', 'shield', 'Cluster firewall disabled', 'Datacenter firewall policy is off', 'security');
  if (noTfa.length) A('warn', 'users', noTfa.length + ' account' + (noTfa.length > 1 ? 's' : '') + ' without 2FA',
    noTfa.map(function (u) { return u.userid; }).join(', '), 'security');
  if (stopped.length) A('info', 'power', stopped.length + ' guest' + (stopped.length > 1 ? 's' : '') + ' stopped',
    stopped.map(function (g) { return g.name; }).join(', '), 'proxmox');
  var rank = { crit: 0, warn: 1, info: 2 };
  att.sort(function (a, b) { return rank[a.sev] - rank[b.sev]; });
  var nCrit = att.filter(function (a) { return a.sev === 'crit'; }).length;
  var nWarn = att.filter(function (a) { return a.sev === 'warn'; }).length;
  var nInfo = att.filter(function (a) { return a.sev === 'info'; }).length;

  var byCpu = running.map(function (g) { return { g: g, v: (g.cpu || 0) * (g.maxcpu || 0) }; }).sort(function (a, b) { return b.v - a.v; });
  var byMem = running.map(function (g) { return { g: g, v: g.mem || 0 }; }).sort(function (a, b) { return b.v - a.v; });

  return { ceph: ceph, cephOn: cephOn, cephOk: cephOk, cephPct: cephPct, nodes: nodes, online: online,
    guests: guests, running: running, stopped: stopped, cores: cores, cpuPct: cpuPct, memPct: memPct,
    stores: stores, stUsed: stUsed, stCap: stCap, stPct: stPct, pbsOn: pbsOn, groups: groups, snaps: snaps,
    latest: latest, failedB: failedB, ds: ds, hKeys: hKeys, hDown: hDown, tasks: tasks,
    att: att, nCrit: nCrit, nWarn: nWarn, nInfo: nInfo, byCpu: byCpu, byMem: byMem };
}

// ── semantic status colors (documented palette — allowed as literals) ─────────
var _OV_G = '#22C55E', _OV_A = '#F59E0B', _OV_R = '#EF4444', _OV_N = '#6B7280';
function _ovSev(s) { return s === 'crit' ? _OV_R : s === 'warn' ? _OV_A : _OV_N; }

// Lucide-style icons used by the task feed + consumers header that aren't in
// the shared registry (svg() falls back to the shared _IC for everything else).
var _OV_IC = {
  power: '<path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/>',
  'log-in': '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>',
  terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
  'trending-up': '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
};
function _ovSvg(name, size) {
  size = size || 16;
  if (_OV_IC[name]) return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + _OV_IC[name] + '</svg>';
  return svg(name, size);
}
function _ovBar(p, hex) {
  return '<div class="bar"><div class="bar-fill" style="width:' + Math.min(p, 100) + '%;background:' + (hex || barHex(p)) + '"></div></div>';
}

// ── section builders ──────────────────────────────────────────────────────
// The page-header status strip — the house .page-hdr-meta pattern every other
// page uses (small inline item · thin separator · item), not a banner or a row
// of boxed tiles. The health verdict leads as a colored dot + count; the rest
// are clickable jumps to their owning page.
function _ovHdrMeta(D) {
  var sev = D.nCrit ? 'crit' : D.nWarn ? 'warn' : 'ok';
  var col = sev === 'ok' ? _OV_G : _ovSev(sev);
  var sep = '<span class="page-hdr-meta-sep"></span>';
  var mi = function (page, inner) {
    return '<span class="page-hdr-meta-item" style="cursor:pointer" onclick="showPage(\'' + esc(page) + '\')">' + inner + '</span>';
  };
  var items = [];
  items.push('<span class="page-hdr-meta-item">'
    + '<span style="width:8px;height:8px;border-radius:50%;background:' + col + ';display:inline-block"></span> '
    + '<b style="color:' + col + '">' + (sev === 'ok' ? 'Healthy' : D.att.length) + '</b> '
    + (sev === 'ok' ? '' : 'need attention') + '</span>');
  items.push(mi('proxmox', svg('server', 13) + ' <b' + (D.online.length < D.nodes.length ? ' style="color:' + _OV_A + '"' : '') + '>' + D.online.length + '/' + D.nodes.length + '</b> nodes'));
  items.push(mi('proxmox', svg('monitor', 13) + ' <b>' + D.running.length + '/' + D.guests.length + '</b> guests'));
  items.push(mi('storage', svg('database', 13) + ' <b' + (D.stPct > 90 ? ' style="color:' + _OV_R + '"' : D.stPct > 75 ? ' style="color:' + _OV_A + '"' : '') + '>' + D.stPct + '%</b> storage'));
  items.push(mi('health', svg('activity', 13) + ' <b' + (D.hDown.length ? ' style="color:' + _OV_R + '"' : '') + '>' + (D.hKeys.length - D.hDown.length) + '/' + D.hKeys.length + '</b> checks'));
  if (D.cephOn) items.push(mi('health', svg('database', 13) + ' <b style="color:' + (D.cephOk ? _OV_G : _OV_A) + '">' + esc(String(D.ceph.health || '').replace('HEALTH_', '')) + '</b> Ceph'));
  if (D.pbsOn) items.push(mi('backups', svg('archive', 13) + ' ' + (D.failedB ? '<b style="color:' + _OV_R + '">' + D.failedB + '</b> failed' : '<b>' + (D.ds ? Math.round(D.ds.percent) + '%' : '—') + '</b> backups')));
  return items.join(sep);
}

var _OV_SEVW = { crit: 'Critical', warn: 'Warning', info: 'Review' };
function _ovAttention(D) {
  if (!D.att.length) return '<div class="ovm-att-empty">' + svg('check', 16) + ' Nothing needs attention — every node, backup and health check is green.</div>';
  return '<div class="ovm-att">' + D.att.map(function (a) {
    return '<div class="ovm-att-row" style="--sev:' + _ovSev(a.sev) + '" onclick="showPage(\'' + esc(a.page) + '\')" title="Open ' + esc(a.page) + '">'
      + '<span class="ovm-att-sev">' + _OV_SEVW[a.sev] + '</span>'
      + '<div class="ovm-att-body"><div class="ovm-att-t">' + esc(a.t) + '</div><div class="ovm-att-d">' + esc(a.d) + '</div></div>'
      + '<span class="ovm-att-go">' + esc(a.page) + ' &rsaquo;</span></div>';
  }).join('') + '</div>';
}

function _ovPulseSample(D) {
  var now = Date.now();
  if (now - _ovPulseLastSample < 2500) return;
  _ovPulseLastSample = now;
  var live = {};
  D.nodes.forEach(function (n) {
    live[n.node] = true;
    var h = _ovPulseHistory[n.node] || [];
    if (n.status === 'online' && n.cpu != null && n.maxmem) {
      h.push({ t: now, cpu: Math.round(n.cpu * 100), mem: Math.round((n.mem || 0) / n.maxmem * 100) });
    }
    _ovPulseHistory[n.node] = h.filter(function (p) { return p.t >= now - _OV_PULSE_WINDOW_MS; });
  });
  Object.keys(_ovPulseHistory).forEach(function (node) { if (!live[node]) delete _ovPulseHistory[node]; });
}

async function _ovPreloadPulse(force) {
  var now = Date.now();
  if (_ovPulsePreloadBusy || (!force && now - _ovPulsePreloadAt < 9000)) return;
  _ovPulsePreloadBusy = true;
  try {
    var data = await _swrJSON('/api/history/proxmox_recent?seconds=120', function () { _ovPreloadPulse(true); });
    var cutoff = Date.now() - _OV_PULSE_WINDOW_MS;
    Object.keys((data && data.nodes) || {}).forEach(function (node) {
      var nd = data.nodes[node] || {}, incoming = [];
      (nd.labels || []).forEach(function (ts, i) {
        var t = Number(ts) * 1000, cpu = Number(nd.cpu && nd.cpu[i]), mem = Number(nd.mem && nd.mem[i]);
        if (t >= cutoff && isFinite(cpu) && isFinite(mem)) incoming.push({ t: t, cpu: cpu, mem: mem });
      });
      var local = (_ovPulseHistory[node] || []).filter(function (p) { return p.t >= cutoff; });
      var merged = incoming.concat(local).sort(function (a, b) { return a.t - b.t; });
      _ovPulseHistory[node] = merged.filter(function (p, i) {
        return !i || Math.abs(p.t - merged[i - 1].t) >= 250;
      });
    });
    _ovPulsePreloadAt = Date.now();
    if (currentPage === 'overview' && _ovLastData) {
      _ovUpdateNodeRail(_ovDerive(_ovLastData));
    }
  } catch (e) { console.warn('ov recent history:', e); }
  finally { _ovPulsePreloadBusy = false; }
}

function _ovNodeKey(node) { return String(node).replace(/[^a-zA-Z0-9_-]/g, '_'); }
function _ovNodeChartId(node) { return 'ov-node-chart-' + _ovNodeKey(node); }
function _ovNodeLegendId(node) { return 'ov-node-legend-' + _ovNodeKey(node); }
function _ovNodeSlot(node, slot) { return 'ov-node-' + slot + '-' + _ovNodeKey(node); }

// Per-node averages across the visible two-minute window. These sit directly
// beneath each node's graph so the current readings on the left can be compared
// with that node's recent baseline without a detached cluster-wide summary.
function _ovNodeAverages(n) {
  if (n.status !== 'online') return { cpu: null, mem: null };
  var cutoff = Date.now() - _OV_PULSE_WINDOW_MS;
  var cpuSum = 0, cpuN = 0, memSum = 0, memN = 0;
  (_ovPulseHistory[n.node] || []).forEach(function (p) {
    if (p.t < cutoff) return;
    if (isFinite(p.cpu)) { cpuSum += p.cpu; cpuN++; }
    if (isFinite(p.mem)) { memSum += p.mem; memN++; }
  });
  return {
    cpu: Math.round(cpuN ? cpuSum / cpuN : (n.cpu || 0) * 100),
    mem: Math.round(memN ? memSum / memN : (n.maxmem ? (n.mem || 0) / n.maxmem * 100 : 0))
  };
}

function _ovRenderNodeCharts(D) {
  var now = Date.now(), windowStart = now - _OV_PULSE_WINDOW_MS, acc = _ovAccent();
  D.nodes.forEach(function (n) {
    var pts = _ovPulseHistory[n.node] || [];
    var canvas = el(_ovNodeChartId(n.node)), empty = el(_ovNodeSlot(n.node, 'empty'));
    if (!pts.length) {
      var old = _charts[_ovNodeChartId(n.node)];
      if (old) { try { old.destroy(); } catch (e) {} delete _charts[_ovNodeChartId(n.node)]; }
      if (canvas) canvas.style.display = 'none';
      if (empty) { empty.style.display = 'flex'; empty.textContent = n.status === 'online' ? 'Waiting for live samples…' : 'Node is offline'; }
      var noLeg = el(_ovNodeLegendId(n.node)); if (noLeg) noLeg.innerHTML = '';
      return;
    }
    if (canvas) canvas.style.display = '';
    if (empty) empty.style.display = 'none';
    var bucket = function (key) {
      var labels = pts.map(function (p) { return p.t / 1000; });
      var avg = pts.map(function (p) { return p[key]; });
      // The first synchronous render has one current sample while persisted
      // history is still preloading. Carry that observed value to both window
      // edges so startup never flashes a lone point/gap; real samples replace
      // the held segment as soon as the preload completes.
      if (labels.length) {
        if (labels[0] * 1000 > windowStart) { labels.unshift(windowStart / 1000); avg.unshift(avg[0]); }
        if (labels[labels.length - 1] * 1000 < now) { labels.push(now / 1000); avg.push(avg[avg.length - 1]); }
      }
      return { labels: labels, avg: avg };
    };
    // Match the other history charts with a soft under-line gradient. The
    // rolling chart still skips the one-shot reveal and its boundary-held
    // startup sample spans the full window, so the fill never looks half-loaded.
    var datasets = [
      _dsAvgOnly('CPU', bucket('cpu'), acc, { gradient: 'soft' }),
      _dsAvgOnly('RAM', bucket('mem'), _OV_G, { gradient: 'soft' })
    ];
    _makeChart(_ovNodeChartId(n.node), datasets, function (v) { return Math.round(v) + '%'; }, _OV_PULSE_WINDOW_MS / 3600000, {
      legendTarget: _ovNodeLegendId(n.node), yMin: 0, yMax: 100, yMaxTicks: 3,
      xMin: windowStart, xMax: now,
      xTime: { unit: 'second', displayFormats: { second: 'HH:mm:ss' } },
      xMaxTicks: 3, xTickValues: [now - _OV_PULSE_WINDOW_MS, now - _OV_PULSE_WINDOW_MS / 2, now],
      xTick: function (v) {
        var ago = Math.max(0, Math.round((Date.now() - v) / 1000));
        if (ago < 2) return 'now';
        return ago >= 60 ? Math.round(ago / 60) + 'm' : ago + 's';
      },
      noReveal: true
    });
    _wireChartHover(_ovNodeChartId(n.node));
  });
}

function _ovPulseTick() {
  if (!_ovLastData || currentPage !== 'overview') return;
  var D = _ovDerive(_ovLastData);
  _ovPulseSample(D);
  _ovUpdateNodeRail(D);
}
setInterval(_ovPulseTick, 3000);

function _ovNodeState(n) {
  if (n.status !== 'online') return { variant: 'down', label: 'Offline' };
  if (n.reboot_required) return { variant: 'warn', label: 'Reboot required' };
  if ((n.updates || 0) > 0) return { variant: 'info', label: n.updates + ' update' + (n.updates === 1 ? '' : 's') };
  return { variant: 'up', label: 'Online' };
}
function _ovNodeChip(n) {
  var s = _ovNodeState(n);
  return '<span class="badge badge-' + s.variant + '" id="' + _ovNodeSlot(n.node, 'status') + '">' + s.label + '</span>';
}

function _ovNodeRail(D) {
  if (!D.nodes.length) return '<div class="ovm-node-empty">' + svg('server', 16) + ' No node data is available.</div>';
  return D.nodes.map(function (n) {
    var cp = Math.round((n.cpu || 0) * 100), mp = n.maxmem ? Math.round((n.mem || 0) / n.maxmem * 100) : 0;
    var av = _ovNodeAverages(n);
    var gc = D.guests.filter(function (g) { return g.node === n.node; }).length;
    var online = n.status === 'online';
    return '<article class="ovm-node" id="' + _ovNodeSlot(n.node, 'row') + '">'
      + '<div class="ovm-node-info">'
        + '<div class="sub-hdr ovm-node-top">' + svg('server', 12) + '<span class="sub-hdr-title ovm-node-nm">' + esc(n.node) + '</span>' + _ovNodeChip(n) + '</div>'
        + '<div class="ovm-node-meta" id="' + _ovNodeSlot(n.node, 'meta') + '">' + gc + ' guests · ' + (n.uptime ? 'up ' + fmtUptime(n.uptime) : 'uptime unavailable') + '</div>'
        + '<div class="ovm-node-readings">'
          + '<div class="stat-mini"><span class="stat-mini-lbl">CPU</span><span class="stat-mini-val cpu' + (online && cp > 85 ? ' hot' : '') + '" id="' + _ovNodeSlot(n.node, 'cpu') + '">' + (online ? cp + '%' : '—') + '</span></div>'
          + '<div class="stat-mini"><span class="stat-mini-lbl">Memory</span><span class="stat-mini-val ram' + (online && mp > 85 ? ' hot' : '') + '" id="' + _ovNodeSlot(n.node, 'ram') + '">' + (online ? mp + '%' : '—') + '</span></div>'
        + '</div>'
      + '</div>'
      + '<div class="ovm-node-window">'
        + '<div class="sub-hdr ovm-node-chart-hdr">' + svg('activity', 12) + '<span class="sub-hdr-title">CPU &amp; memory</span>'
          + '<div class="sub-hdr-actions" id="' + _ovNodeLegendId(n.node) + '"></div></div>'
        + '<div class="ovm-node-chart"><canvas id="' + _ovNodeChartId(n.node) + '" aria-label="' + esc(n.node) + ' CPU and RAM usage over the last two minutes"></canvas>'
          + '<div class="ovm-node-chart-empty" id="' + _ovNodeSlot(n.node, 'empty') + '"></div></div>'
        + '<div class="ovm-node-chart-avgs">'
          + '<span><span>Avg CPU</span><b class="cpu' + (av.cpu != null && av.cpu > 85 ? ' hot' : '') + '" id="' + _ovNodeSlot(n.node, 'avgcpu') + '">' + (av.cpu == null ? '—' : av.cpu + '%') + '</b></span>'
          + '<span><span>Avg RAM</span><b class="ram' + (av.mem != null && av.mem > 85 ? ' hot' : '') + '" id="' + _ovNodeSlot(n.node, 'avgram') + '">' + (av.mem == null ? '—' : av.mem + '%') + '</b></span>'
        + '</div>'
      + '</div>'
      + '</article>';
  }).join('');
}

function _ovUpdateNodeRail(D) {
  var host = el('ov-node-pulse'); if (!host) return;
  var sig = D.nodes.map(function (n) { return n.node; }).join('\u001f');
  if (host.dataset.sig !== sig) {
    host.innerHTML = _ovNodeRail(D);
    host.dataset.sig = sig;
    var active = {};
    D.nodes.forEach(function (n) { active[_ovNodeChartId(n.node)] = true; });
    Object.keys(_charts).filter(function (id) { return id.indexOf('ov-node-chart-') === 0 && !active[id]; }).forEach(function (id) {
      try { _charts[id].destroy(); } catch (e) {} delete _charts[id];
    });
  } else {
    D.nodes.forEach(function (n) {
      var online = n.status === 'online';
      var cp = Math.round((n.cpu || 0) * 100), mp = n.maxmem ? Math.round((n.mem || 0) / n.maxmem * 100) : 0;
      var gc = D.guests.filter(function (g) { return g.node === n.node; }).length;
      var state = _ovNodeState(n), status = el(_ovNodeSlot(n.node, 'status'));
      if (status) { status.className = 'badge badge-' + state.variant; status.textContent = state.label; }
      var meta = el(_ovNodeSlot(n.node, 'meta'));
      if (meta) meta.textContent = gc + ' guests · ' + (n.uptime ? 'up ' + fmtUptime(n.uptime) : 'uptime unavailable');
      var cpu = el(_ovNodeSlot(n.node, 'cpu')), ram = el(_ovNodeSlot(n.node, 'ram'));
      if (cpu) { cpu.textContent = online ? cp + '%' : '—'; cpu.classList.toggle('hot', online && cp > 85); }
      if (ram) { ram.textContent = online ? mp + '%' : '—'; ram.classList.toggle('hot', online && mp > 85); }
      var av = _ovNodeAverages(n), avgCpu = el(_ovNodeSlot(n.node, 'avgcpu')), avgRam = el(_ovNodeSlot(n.node, 'avgram'));
      if (avgCpu) { avgCpu.textContent = av.cpu == null ? '—' : av.cpu + '%'; avgCpu.classList.toggle('hot', av.cpu != null && av.cpu > 85); }
      if (avgRam) { avgRam.textContent = av.mem == null ? '—' : av.mem + '%'; avgRam.classList.toggle('hot', av.mem != null && av.mem > 85); }
    });
  }
  _ovRenderNodeCharts(D);
}

function _ovSectionHeader(icon, title, sub, actions) {
  return '<div class="sec-hdr">' + _ovSvg(icon, 18) + '<h2 class="sec-hdr-title">' + title + '</h2>'
    + (sub ? '<span class="sec-hdr-sub">' + sub + '</span>' : '')
    + (actions ? '<div class="sec-hdr-actions">' + actions + '</div>' : '') + '</div>';
}

function _ovLeadHtml(D) {
  var mode = _ovLeadMode, acc = _ovAccent();
  var rows = (mode === 'mem' ? D.byMem : D.byCpu).slice(0, 6);
  var maxv = rows.length ? rows[0].v : 1;
  if (!rows.length) return '<div style="font-size:12px;color:var(--c-muted);padding:8px 0">No running guests.</div>';
  return rows.map(function (r, i) {
    var g = r.g, w = maxv ? Math.round(r.v / maxv * 100) : 0;
    var val = mode === 'mem' ? fmtBytes(g.mem) : ((g.cpu * g.maxcpu).toFixed(1) + ' vCPU');
    return '<div class="ovm-lead-row">'
      + '<span class="ovm-lead-rank">' + (i + 1) + '</span>'
      + '<span class="ovm-lead-nm">' + esc(g.name) + '<span class="n">' + (g.type === 'qemu' ? 'VM' : 'CT') + ' ' + g.vmid + ' · ' + esc(g.node) + '</span></span>'
      + '<div style="width:88px">' + _ovBar(w, mode === 'mem' ? _OV_G : acc) + '</div>'
      + '<span class="ovm-lead-val">' + val + '</span></div>';
  }).join('');
}
function _ovSetLead(m) {
  _ovLeadMode = m;
  var box = el('ov-lead'); if (box && _ovLastData) box.innerHTML = _ovLeadHtml(_ovDerive(_ovLastData));
  ['cpu', 'mem'].forEach(function (k) { var b = el('ov-lead-tab-' + k); if (b) b.classList.toggle('active', k === m); });
}

function _ovTaskIcon(t) {
  var m = { vzdump: 'archive', login: 'log-in', vncshell: 'terminal', termproxy: 'terminal',
    qmstart: 'power', qmstop: 'power', vzstart: 'power', vzstop: 'power' };
  return m[t.type] || 'activity';
}
function _ovTaskLabel(t) {
  if (t.type === 'vzdump') return 'Backup ' + (t.failed ? 'failed' : 'completed') + ' — <b>guest ' + esc(t.id) + '</b>';
  if (t.type === 'login') return 'Login — <b>' + esc(t.user) + '</b>';
  if (t.type === 'vncshell' || t.type === 'termproxy') return 'Console session — <b>' + esc(t.node) + '</b>';
  return esc(t.type) + ' — <b>' + esc(t.id) + '</b>';
}
function _ovTasks(D) {
  var rows = D.tasks.slice(0, 7);
  if (!rows.length) return '<div style="font-size:12px;color:var(--c-muted);padding:8px 0">No recent cluster tasks.</div>';
  return rows.map(function (t) {
    return '<div class="ovm-task">'
      + '<div class="ovm-task-ic"' + (t.failed ? ' style="color:' + _OV_R + ';background:' + _OV_R + '18"' : '') + '>' + _ovSvg(_ovTaskIcon(t), 15) + '</div>'
      + '<div class="ovm-task-body"><div class="ovm-task-t">' + _ovTaskLabel(t) + '</div>'
        + '<div class="ovm-task-m">' + esc(t.user) + ' · ' + esc(t.node) + (t.failed ? ' · <span style="color:' + _OV_R + '">' + esc(t.status) + '</span>' : '') + '</div></div>'
      + '<div class="ovm-task-time">' + timeAgo((t.start || 0) * 1000) + '</div></div>';
  }).join('');
}

// ── render ──────────────────────────────────────────────────────────────────
function renderOverview(data) {
  var ovEl = el('overview-status'); if (!ovEl) return;
  ovEl.className = ''; ovEl.removeAttribute('style');
  _ovLastData = data;
  var D = _ovDerive(data);
  _ovPulseSample(D);
  var hdr = el('overview-hdr-meta'); if (hdr) hdr.innerHTML = _ovHdrMeta(D);   // house inline status strip

  var acc = _ovAccent();

  // Attention card (flagship) + full-width rolling node activity section.
  var attCard = '<section>' + _ovSectionHeader('activity', 'Needs attention', D.att.length ? D.att.length + ' open' : 'No open issues')
    + '<div class="hd-card ovm-card">' + _ovAttention(D) + '</div></section>';
  var pulseCard = '<section>' + _ovSectionHeader('server', 'Node activity', 'CPU and memory · last 2 minutes')
    + '<div class="hd-card ovm-node-card"><div class="ovm-noderail" id="ov-node-pulse"></div></div></section>';

  // Cluster load chart (live history) — this block is preserved across ticks.
  var loadCard = '<section>' + _ovSectionHeader('activity', 'Cluster load', 'Utilization · % of capacity', '<span onclick="event.stopPropagation()">' + _histPillRow('ov-infra', ['1d', '7d', '30d', 'All', 'Custom'], { stopPropagation: true }) + '</span>')
    + '<div class="hd-card ovm-card"><div id="ov-cluster-charts">'
      + '<div class="stor-hdr"><span class="stor-hdr-label">CPU &amp; RAM</span>'
        + '<span class="stor-hdr-spacer"></span><span class="stor-legend" id="chart-ov-res-leg"></span></div>'
      + '<div style="position:relative;height:200px"><canvas id="chart-ov-res"></canvas></div>'
    + '</div></div></section>';

  // Top consumers leaderboard (CPU⇄RAM toggle)
  var consumeActions = '<span class="ovm-tabs">'
        + '<button class="ovm-tab' + (_ovLeadMode === 'cpu' ? ' active' : '') + '" id="ov-lead-tab-cpu" onclick="_ovSetLead(\'cpu\')">CPU</button>'
        + '<button class="ovm-tab' + (_ovLeadMode === 'mem' ? ' active' : '') + '" id="ov-lead-tab-mem" onclick="_ovSetLead(\'mem\')">RAM</button>'
      + '</span>';
  var consumeCard = '<section>' + _ovSectionHeader('trending-up', 'Top consumers', 'Hottest running guests', consumeActions)
    + '<div class="hd-card ovm-card"><div id="ov-lead">' + _ovLeadHtml(D) + '</div></div></section>';

  // Recent activity (task log)
  var taskCard = '<section>' + _ovSectionHeader('list', 'Recent activity', 'Cluster task log')
    + '<div class="hd-card ovm-card">' + _ovTasks(D) + '</div></section>';

  // Preserve live chart blocks across the every-tick innerHTML rebuild. Their
  // shells only rebuild when the node/chart structure actually changes.
  var savedCluster = el('ov-cluster-charts');
  if (savedCluster) savedCluster.remove();
  var savedPulse = el('ov-node-pulse');
  if (savedPulse) savedPulse.remove();

  ovEl.className = 'space-y-6';
  ovEl.innerHTML =
    attCard + pulseCard
    + '<div class="ovm-cols c-2-1">' + loadCard + consumeCard + '</div>'
    + taskCard;

  // Reattach the preserved chart block over its fresh placeholder.
  if (savedCluster) {
    var ph = el('ov-cluster-charts');
    if (ph && ph !== savedCluster) ph.replaceWith(savedCluster);
  }
  if (savedPulse) {
    var pulsePh = el('ov-node-pulse');
    if (pulsePh && pulsePh !== savedPulse) pulsePh.replaceWith(savedPulse);
  }
  _ovUpdateNodeRail(D);
  _histSchedule();
  _ovPreloadPulse();

  // Throttle the chart reload to once per 5 min (WS fires every ~10s); reload
  // immediately if the chart is missing or its canvas got orphaned.
  var now = Date.now();
  var c = _charts['chart-ov-res'];
  var broken = !c || !c.canvas || !c.canvas.isConnected || c.canvas !== el('chart-ov-res');
  if (broken || now - (_ovChartTs || 0) > 300000) {
    _ovChartTs = now;
    setTimeout(function () { loadOvResources(_histGetHours('ov-infra')); }, 0);
  }
}
