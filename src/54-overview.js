// ── Overview ──────────────────────────────────────────────────────────────
// Proxmox-only overview in the house language: a 4-across stat-tile summary
// row, a flagship Cluster card (Ceph-card anatomy: header meta + CPU|RAM
// history columns + NODES cells), a Storage card (capacity forecast + STORES
// cells), and the Reliability row (Backups + Health). Everything is built from
// the generic snapshot and navigates to its page on click.
//
// renderOverview fires on every WS tick; the chart columns (canvases, legends,
// confidence pill) are saved/restored across the innerHTML rebuild so Chart.js
// instances stay live, and chart data reloads are throttled to 5 minutes.
function renderOverview(data) {
  const ovEl=el('overview-status');if(!ovEl)return;
  ovEl.className='';ovEl.removeAttribute('style');
  const px=data.proxmox||{};
  const hc=data.health||{};
  const ceph=data.ceph||{};
  const nodes=px.nodes||[],onlineN=nodes.filter(n=>n.status==='online');
  const vms=px.vms||[],lxcs=px.lxcs||[];
  const runG=vms.filter(v=>v.status==='running').length+lxcs.filter(v=>v.status==='running').length;
  const totG=vms.length+lxcs.length;
  const hKeys=Object.keys(hc).filter(k=>typeof hc[k]==='object'&&hc[k]!==null&&'up' in hc[k]);
  const hUp=hKeys.filter(k=>hc[k].up).length;
  const stores=_storageAgg(px.storage||[]);
  const totUsed=stores.reduce((a,s)=>a+(s.disk||0),0);
  const totCap=stores.reduce((a,s)=>a+(s.maxdisk||0),0);
  const storPct=totCap?Math.round(totUsed/totCap*100):0;

  // ── Header stat strip (compact, clickable → the owning page) — mirrors the
  // other pages' .page-hdr-meta line, and folds in the newer subsystems. ──────
  const _ovG='#22C55E', _ovA='#F59E0B', _ovR='#EF4444';
  const _ovIcon=p=>'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+p+'</svg>';
  const _OVIC={
    node:'<rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/>',
    guest:'<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    store:'<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    check:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    ceph:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
    backup:'<path d="M21 8v13H3V8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'};
  const _ovMi=(page,ic,valHtml,label)=>'<span class="page-hdr-meta-item" style="cursor:pointer" onclick="showPage(\''+page+'\')">'+_ovIcon(_OVIC[ic])+' '+valHtml+' '+label+'</span>';
  const _ovItems=[
    _ovMi('proxmox','node','<b'+(onlineN.length===nodes.length?'':' style="color:'+_ovA+'"')+'>'+onlineN.length+'/'+(nodes.length||0)+'</b>','nodes'),
    _ovMi('proxmox','guest','<b>'+runG+'/'+totG+'</b>','guests running'),
    _ovMi('storage','store','<b'+(storPct>90?' style="color:'+_ovR+'"':storPct>75?' style="color:'+_ovA+'"':'')+'>'+storPct+'%</b>','storage'+(totCap?' ('+fmtBytes(totUsed)+' / '+fmtBytes(totCap)+')':'')),
    _ovMi('health','check','<b'+((hKeys.length-hUp)>0?' style="color:'+_ovR+'"':'')+'>'+hUp+'/'+hKeys.length+'</b>','checks up'),
  ];
  if(ceph&&ceph.status==='online'){ const _ok=(ceph.health||'').toUpperCase()==='HEALTH_OK'; _ovItems.push(_ovMi('health','ceph','<b style="color:'+(_ok?_ovG:_ovA)+'">'+esc(String(ceph.health||'?').replace('HEALTH_',''))+'</b>','Ceph')); }
  const _pbs=data.pbs||{}; const _grp=(_pbs.groups&&_pbs.groups.length)?_pbs.groups:((window._pbsDetail||{}).groups||[]);
  const _failB=_grp.reduce((a,g)=>a+(g.failed_count||0),0);
  if(_pbs.status==='online'||(_pbs.datastores&&_pbs.datastores.length)){ const _ds=(_pbs.datastores||[]).length;
    _ovItems.push(_ovMi('backups','backup', _failB?'<b style="color:'+_ovR+'">'+_failB+'</b>':'<b style="color:'+_ovG+'">'+_ds+'</b>', _failB?'failed backups':('datastore'+(_ds===1?'':'s')))); }
  const _sec=data.security||{};
  if(_sec.firewall){ const _fon=_sec.firewall.enable==1; _ovItems.push(_ovMi('security','shield','<b style="color:'+(_fon?_ovG:_ovA)+'">'+(_fon?'on':'off')+'</b>','firewall')); }
  const _ovHdr=el('overview-hdr-meta'); if(_ovHdr) _ovHdr.innerHTML=_ovItems.join('');

  // ── Resources card (cluster history) + Nodes carousel ─────────────────────
  const quorumOk=nodes.length&&onlineN.length===nodes.length;
  const clusterBadge=!nodes.length?''
    : quorumOk?'<span class="badge badge-up">healthy</span>'
    : onlineN.length>nodes.length/2?'<span class="badge badge-warn">degraded</span>'
    : '<span class="badge badge-down">no quorum</span>';
  const cephMeta=(ceph&&ceph.status==='online')?' · Ceph '+esc(String(ceph.health||'?').replace('HEALTH_','')):'';
  const clusterCard='<div class="hd-card p-4">'
    +'<div class="stor-card-hdr" style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
      +svg('server',14)
      +'<span class="font-medium text-sm" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Resources'
        +' <span style="color:var(--c-muted);font-size:11px">· '+onlineN.length+'/'+nodes.length+' nodes · '+runG+'/'+totG+' guests running'+cephMeta+'</span></span>'
      +clusterBadge
    +'</div>'
    +'<div id="ov-cluster-charts">'
      +'<div style="min-width:0">'
        +'<div class="stor-hdr"><span class="stor-hdr-label">Utilization</span>'
          +'<span style="font-size:10px;color:var(--c-dim)">cluster-wide, % of capacity</span>'
          +'<span class="stor-hdr-spacer"></span><span class="stor-legend" id="chart-ov-res-leg"></span></div>'
        +'<div style="position:relative;height:220px"><canvas id="chart-ov-res"></canvas></div>'
      +'</div>'
    +'</div>'
  +'</div>';

  // (No per-node section here — the Resources charts carry per-node lines, the
  // stat tiles carry the counts, and the Compute page owns the node cards.)

  // ── Storage card (forecast + STORES cells) ─────────────────────────────────
  const storBadge=stores.length
    ? (stores.every(s=>(s.status||'available')==='available')
      ? '<span class="badge badge-up">available</span>'
      : '<span class="badge badge-warn">degraded</span>')
    : '';
  const storeCells=stores.slice().sort((a,b)=>((b.disk/b.maxdisk)||0)-((a.disk/a.maxdisk)||0)).map(s=>{
    const pct=s.maxdisk?Math.round(s.disk/s.maxdisk*100):0;
    const c=pct>90?'#EF4444':pct>75?'#F59E0B':'#22C55E';
    return '<div title="'+esc(s.name)+'" onclick="showPage(\'storage\')" class="stor-cell" style="background:var(--c-hover);border:1px solid var(--c-border);border-radius:8px;padding:12px 14px;min-width:0;display:flex;flex-direction:column;gap:4px;cursor:pointer">'
      +'<div style="display:flex;align-items:center;gap:6px;justify-content:space-between">'
        +'<div style="display:flex;align-items:center;gap:6px;color:var(--c-muted);font-size:10px;text-transform:uppercase;letter-spacing:.05em;font-weight:600;min-width:0">'
          +svg('database',12)+'<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(s.name)+'</span></div>'
        +'<span class="stor-dot" style="background:'+c+';box-shadow:0 0 5px '+c+'80"></span></div>'
      +'<div style="font-size:13px;font-weight:600;color:var(--c-text)">'+fmtBytes(s.disk)+' <span style="color:var(--c-muted);font-weight:400;font-size:11px">/ '+fmtBytes(s.maxdisk)+'</span></div>'
      +'<div style="display:flex;align-items:center;justify-content:space-between;font-size:10px;color:var(--c-muted);margin-top:2px">'
        +'<span>'+esc(s.type||'storage')+' · '+(s.shared?'shared':'local')+'</span><span style="color:'+c+';font-weight:600">'+pct+'%</span></div>'
    +'</div>';
  }).join('')||'<div style="font-size:12px;color:var(--c-muted)">No storage reported.</div>';
  const storageCard='<div class="hd-card p-4">'
    +'<div class="stor-card-hdr" style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
      +svg('database',14)
      +'<span class="font-medium text-sm" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Storage'
        +' <span style="color:var(--c-muted);font-size:11px">· '+stores.length+' store'+(stores.length===1?'':'s')+(totCap?' · '+fmtBytes(totUsed)+' of '+fmtBytes(totCap)+' used':'')+'</span></span>'
      +'<span id="ov-stor-pills">'+_storPillRow('ov-stor')+'</span>'
      +storBadge
    +'</div>'
    +'<div id="ov-storage-chart">'
      +'<div class="stor-hdr">'
        +'<span class="stor-hdr-label">Storage</span>'
        +'<span class="stor-conf-pill" id="ov-stor-conf">High Confidence</span>'
        +'<span class="stor-hdr-spacer"></span>'
        +'<span class="stor-legend">'
          +'<span class="stor-leg"><span class="stor-leg-line"></span>Historical</span>'
          +'<span class="stor-leg"><span class="stor-leg-line dashed"></span><span class="stor-leg-dia"></span>Prediction</span>'
        +'</span>'
      +'</div>'
      +'<div style="position:relative;height:180px"><canvas id="chart-ov-storage"></canvas></div>'
    +'</div>'
    +'<div style="border-top:1px solid var(--c-border);padding-top:12px;margin-top:14px">'
      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">'
        +svg('database',14)
        +'<span style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em">Stores</span>'
        +'<span style="font-size:10px;color:var(--c-muted)">'+stores.length+' store'+(stores.length===1?'':'s')+'</span></div>'
      +'<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">'+storeCells+'</div>'
    +'</div>'
  +'</div>';

  const row1=''
    +'<div class="sec-hdr">'+svg('server',18)+'<h2 class="sec-hdr-title">Compute</h2><span class="sec-hdr-sub">Resource history and live nodes</span>'
      +'<div class="sec-hdr-actions" onclick="event.stopPropagation()">'+_histPillRow('ov-infra', ['1d','7d','30d','All','Custom'], { stopPropagation: true })+'</div>'
    +'</div>'
    +clusterCard;
  const row2=''
    +'<div class="sec-hdr">'+svg('database',18)+'<h2 class="sec-hdr-title">Storage</h2><span class="sec-hdr-sub">Cluster-wide capacity and forecast</span></div>'
    +storageCard;

  // ── Network section: cluster-wide throughput (live meta + history chart) ──
  const _traf=(((data.proxmox||{}).network)||{}).traffic||{};
  let _tIn=0,_tOut=0;
  Object.keys(_traf).forEach(k=>{ _tIn+=_traf[k].in||0; _tOut+=_traf[k].out||0; });
  const networkCard='<div class="hd-card p-4">'
    +'<div class="stor-card-hdr" style="display:flex;align-items:center;gap:8px;margin-bottom:12px">'
      +svg('activity',14)
      +'<span class="font-medium text-sm" style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Throughput'
        +' <span style="color:var(--c-muted);font-size:11px">· live &darr; '+fmtBytes(_tIn)+'/s · &uarr; '+fmtBytes(_tOut)+'/s</span></span>'
    +'</div>'
    +'<div id="ov-net-chart">'
      +'<div class="stor-hdr"><span class="stor-hdr-label">Network</span>'
        +'<span style="font-size:10px;color:var(--c-dim)">all nodes summed</span>'
        +'<span class="stor-hdr-spacer"></span><span class="stor-legend" id="chart-ov-net-leg"></span></div>'
      +'<div style="position:relative;height:180px"><canvas id="chart-ov-net"></canvas></div>'
    +'</div>'
  +'</div>';
  const rowNet=''
    +'<div class="sec-hdr">'+svg('activity',18)+'<h2 class="sec-hdr-title">Network</h2><span class="sec-hdr-sub">Cluster-wide throughput over time</span>'
      +'<div class="sec-hdr-actions" onclick="event.stopPropagation()">'+_histPillRow('ov-net', ['1d','7d','30d','All','Custom'], { stopPropagation: true })+'</div>'
    +'</div>'
    +networkCard;

  // ── Reliability: Backups + Health ──────────────────────────────────────────
  const _nowSec=Date.now()/1000;
  const pbs=data.pbs||{};
  const _pbsOn=pbs.status==='online';
  // snapshots/groups are stripped from the WS tick (heavy) — pull them from the
  // lazy-loaded detail cache, kicked off by the overview init hook.
  const _pbsDet=window._pbsDetail||{};
  const _pbsGroups=(pbs.groups&&pbs.groups.length)?pbs.groups:(_pbsDet.groups||[]);
  const _pbsSnaps=((pbs.snapshots&&pbs.snapshots.length)?pbs.snapshots:(_pbsDet.snapshots||[])).length;
  const _pbsLatest=_pbsGroups.reduce((m,g)=>Math.max(m,g.latest_time||0),0);
  const _pbsFailed=_pbsGroups.reduce((a,g)=>a+(g.failed_count||0),0);
  const _pbsRecent=_pbsLatest&&(_nowSec-_pbsLatest)<129600;
  const _archiveSvg='<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/></svg>';
  // Shared rich-card shell: header (icon + label + badge) + a custom body. Clickable.
  const _ovRich=(o)=>'<div class="hd-card" style="padding:16px;cursor:pointer;display:flex;flex-direction:column" onclick="showPage(\''+o.page+'\')">'
    +'<div style="display:flex;align-items:center;gap:7px;margin-bottom:13px;color:var(--c-muted)">'+o.icon+'<span style="font-size:12px;font-weight:600;color:var(--c-text)">'+o.label+'</span>'+(o.badge?'<span style="margin-left:auto;display:inline-flex">'+o.badge+'</span>':'')+'</div>'
    +'<div style="flex:1;min-width:0">'+o.body+'</div></div>';
  const _bkClr=_pbsFailed?'#EF4444':_pbsRecent?'#22C55E':'#F59E0B';
  // Compact inline bars: name · track · % — lighter than the old full-width stack.
  const _bkBars=(pbs.datastores||[]).slice(0,3).map(function(d){const p=Math.round(d.percent||0);return '<div style="display:flex;align-items:center;gap:10px;margin-top:8px">'
    +'<span style="font-size:11px;color:var(--c-muted);width:74px;flex-shrink:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(d.name)+'</span>'
    +'<div style="flex:1;height:6px;border-radius:3px;background:var(--c-bar-bg);overflow:hidden"><div style="height:100%;width:'+Math.min(p,100)+'%;background:'+barHex(p)+';border-radius:3px"></div></div>'
    +'<span style="font-size:11px;font-weight:600;color:'+barHex(p)+';width:30px;text-align:right;flex-shrink:0">'+p+'%</span></div>';}).join('');
  const backupsCard=_ovRich({page:'backups',icon:_archiveSvg,label:'Backups',
    badge:_pbsOn?(_pbsFailed?'<span class="badge badge-down">'+_pbsFailed+' failed</span>':'<span class="badge badge-up">Protected</span>'):'<span class="badge badge-neutral">Offline</span>',
    body:_pbsOn
      ? '<div style="display:flex;align-items:center;gap:9px"><span style="width:9px;height:9px;border-radius:50%;background:'+_bkClr+';box-shadow:0 0 0 3px '+_bkClr+'22;flex-shrink:0"></span>'
          +'<span style="font-size:13px;font-weight:600;color:var(--c-text)">'+(_pbsLatest?'Last backup '+timeAgo(_pbsLatest*1000):'No recent backups')+'</span></div>'
        +'<div style="font-size:11px;color:var(--c-muted);margin-top:5px;margin-left:18px">'+(_pbsGroups.length||'—')+' guests · '+_pbsSnaps.toLocaleString()+' snapshots</div>'
        +(_bkBars?'<div style="margin-top:13px;padding-top:12px;border-top:1px solid var(--c-border)">'+_bkBars+'</div>':'')
      : '<div style="font-size:12px;color:var(--c-muted);padding:6px 0">'+(pbs.error?esc(pbs.error):'Not configured')+'</div>'});

  // Health — up count + per-service status dots (auto cluster checks + custom).
  const _hNow=Date.now()/1000;
  const _hsvc=hKeys.map(function(k){
    const info=hc[k];
    const hist=(info.history||[]).map(h=>typeof h==='object'&&h?h:{up:!!h,latency_ms:null,ts:null});
    const up=info.up===true;
    let downStr='down';
    if(!up && hist.length){
      let since=null;
      for(let i=hist.length-1;i>=0;i--){ if(hist[i].up){ since=(hist[i+1]&&hist[i+1].ts)||null; break; } if(i===0&&!hist[0].up) since=hist[0].ts; }
      if(since){ const m=Math.max(0,Math.round((_hNow-since)/60)); downStr='down '+(m<60?m+'m':Math.floor(m/60)+'h'+(m%60?(m%60)+'m':'')); }
    }
    return {k:k,up:up,downStr:downStr};
  });
  const _hIssues=_hsvc.filter(s=>!s.up);
  const _hStatClr=_hIssues.length===0?'#22C55E':'#EF4444';
  const _hStatLbl=_hIssues.length===0?'All systems operational':(_hIssues.length+' need'+(_hIssues.length===1?'s':'')+' attention');
  // Per-service status grid — one rounded square per service (green up / red down).
  const _hGrid='<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:13px;padding-top:12px;border-top:1px solid var(--c-border)">'
    +_hsvc.map(s=>'<span title="'+esc(s.k)+(s.up?'':' · '+s.downStr)+'" style="width:9px;height:9px;border-radius:2px;flex-shrink:0;background:'+(s.up?'#22C55E':'#EF4444')+(s.up?'':';box-shadow:0 0 5px #EF444466')+'"></span>').join('')
    +'</div>';
  const healthCard=hKeys.length
    ? _ovRich({page:'health',icon:svg('activity',13),label:'Health',
        badge:_hIssues.length?'<span class="badge badge-down">'+_hIssues.length+' down</span>':'',
        body:'<div style="display:flex;align-items:center;gap:9px"><span style="width:9px;height:9px;border-radius:50%;background:'+_hStatClr+';box-shadow:0 0 0 3px '+_hStatClr+'22;flex-shrink:0"></span>'
          +'<span style="font-size:13px;font-weight:600;color:'+_hStatClr+'">'+_hStatLbl+'</span></div>'
          +'<div style="font-size:11px;color:var(--c-muted);margin-top:5px;margin-left:18px">'+hUp+' / '+hKeys.length+' checks up</div>'
          +_hGrid})
    : _ovRich({page:'health',icon:svg('activity',13),label:'Health',body:'<div style="font-size:12px;color:var(--c-muted);padding:6px 0">Waiting for cluster data…</div>'});

  const _shieldChkSvg='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></svg>';
  const row3=''
    +'<div class="sec-hdr">'+_shieldChkSvg+'<h2 class="sec-hdr-title">Reliability</h2><span class="sec-hdr-sub">Backups and service health</span></div>'
    +'<div class="hd-row-2">'+backupsCard+healthCard+'</div>';

  // Preserve the chart blocks (canvases + legends + confidence pill) across the
  // every-tick innerHTML rebuild so Chart.js instances stay live.
  const savedCluster=el('ov-cluster-charts');
  const savedNet=el('ov-net-chart');
  const savedStor=el('ov-storage-chart');
  // Preserve the storage pill row too — its Custom-date popover must survive
  // the every-tick rebuild while the user is picking a range.
  const savedStorPills=el('ov-stor-pills');
  if(savedCluster) savedCluster.remove();
  if(savedNet) savedNet.remove();
  if(savedStor) savedStor.remove();
  if(savedStorPills) savedStorPills.remove();

  // Section wrappers + the page's space-y-6 rhythm — without them every block
  // was a direct child and the section headers sat flush against the card above.
  ovEl.className='space-y-6';
  ovEl.innerHTML='<section>'+row1+'</section><section>'+row2+'</section><section>'+rowNet+'</section><section>'+row3+'</section>';
  _histSchedule();

  // Reattach saved blocks in place of the fresh placeholders.
  const _ovRestore=(saved,id)=>{
    if(!saved) return;
    const ph=el(id);
    if(ph&&ph!==saved) ph.replaceWith(saved);
  };
  _ovRestore(savedCluster,'ov-cluster-charts');
  _ovRestore(savedNet,'ov-net-chart');
  _ovRestore(savedStor,'ov-storage-chart');
  _ovRestore(savedStorPills,'ov-stor-pills');

  // Throttle routine chart reloads to once per 5 min (WS fires every 10s), but
  // reload immediately if a chart is missing or its canvas got orphaned.
  const now=Date.now();
  const _ovBroken=cid=>{const c=_charts[cid];return !c||!c.canvas||!c.canvas.isConnected||c.canvas!==el(cid);};
  const _ovNeedsBuild=_ovBroken('chart-ov-res')||_ovBroken('chart-ov-net')||_ovBroken('chart-ov-storage');
  if(_ovNeedsBuild||now-(_ovChartTs||0)>300000){
    _ovChartTs=now;
    setTimeout(()=>{
      loadOvResources(_histGetHours('ov-infra'));
      loadOvNetwork(_histGetHours('ov-net'));
      loadOvStorageForecast(_histGetHours('ov-stor'));
    },0);
  }
}
