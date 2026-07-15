// ── Tools page ─────────────────────────────────────────────────────────────
let _toolsTargetsLoaded=false;
async function initToolsPage(){
  _refreshImportStatus();          // last-run info for the Import History card
  if(_toolsTargetsLoaded) return;
  try{
    const d=await fetch('/api/tools/targets').then(r=>r.json());
    const wsel=el('wol-device');
    if(wsel) wsel.innerHTML='<option value="">— manual —</option>'
      +(d.wol||[]).map(w=>'<option value="'+escAttr(w.mac)+'">'+escText(w.name)+'</option>').join('');
    _toolsTargetsLoaded=true;
  }catch(e){ console.warn('tools targets',e); }
}
function _wolPick(sel){ const m=el('wol-mac'); if(m && sel.value) m.value=sel.value; }

// ── Tools run-button orbit ("Orbit · fast"): eases up to a constant orbit speed,
// holds while the test runs, then glides back down to its start point on finish.
// Velocity-profiled rotation: accelerate (angle∝f²) and decelerate (angle∝2f−f²)
// both meet the linear run at speed ω, so there's no hitch. Driven via WAAPI.
const _RUN_OD=1500, _RUN_UP=650;   // ms per orbit / spin-up duration
function _runRamp(from,to,N,accel){ const fr=[]; for(let i=0;i<=N;i++){ const f=i/N, p=accel?f*f:(2*f-f*f); fr.push({transform:'rotate('+(from+(to-from)*p)+'deg)',offset:f}); } return fr; }
function _runOrbCancel(btn){ ['_oUp','_oRun','_oDown'].forEach(k=>{ if(btn[k]){ try{btn[k].cancel();}catch(e){} btn[k]=null; } }); }
function _runBtnNeutral(btn){   // hold the button at rest color after a run even if the cursor is still on it
  try{ btn.classList.add('just-ran'); btn.addEventListener('mouseleave',()=>btn.classList.remove('just-ran'),{once:true}); }catch(e){}
}
function _runBtnStart(btn){
  if(!btn) return;
  btn.classList.remove('just-ran');
  btn.disabled=true; btn.classList.add('busy'); btn._oStopping=false;
  const spin=btn.querySelector('.spin'); btn._oSpin=spin;
  if(!spin) return;                       // graceful fallback (old cached markup): just disable
  _runOrbCancel(btn); spin.style.transform='';
  const od=_RUN_OD, up=_RUN_UP, omega=360/od, upDeg=0.5*omega*up;
  btn._oOd=od; btn._oOmega=omega; btn._oUpDeg=upDeg; btn._oUpDur=up;
  const a1=spin.animate(_runRamp(0,upDeg,24,true),{duration:up,easing:'linear',fill:'forwards'});
  btn._oUp=a1;
  a1.onfinish=()=>{ if(!btn.classList.contains('busy')||btn._oStopping) return; btn._oUp=null;
    btn._oRun=spin.animate([{transform:'rotate('+upDeg+'deg)'},{transform:'rotate('+(upDeg+360)+'deg)'}],{duration:od,easing:'linear',iterations:Infinity}); };
}
function _runBtnStop(btn){
  if(!btn) return;
  const spin=btn._oSpin||btn.querySelector('.spin');
  if(!spin){ btn.classList.remove('busy'); btn.disabled=false; _runBtnNeutral(btn); return; }   // fallback
  btn._oStopping=true;
  const od=btn._oOd||_RUN_OD, omega=btn._oOmega||(360/od);
  let theta=0, v=omega;
  if(btn._oRun){ theta=(btn._oUpDeg||0)+360*((btn._oRun.currentTime||0)/od); v=omega; }
  else if(btn._oUp){ const f=Math.min(1,(btn._oUp.currentTime||0)/(btn._oUpDur||1)); theta=(btn._oUpDeg||0)*f*f; v=omega*f; }
  _runOrbCancel(btn);
  if(v<omega*0.05) v=omega*0.05;
  let target=Math.ceil(theta/360)*360; if(target-theta<25) target+=360;     // glide forward to "home" (top)
  const dist=target-theta, dur=Math.max(300,Math.min(1200,2*dist/v));
  const a3=spin.animate(_runRamp(theta,target,24,false),{duration:dur,easing:'linear',fill:'forwards'});
  btn._oDown=a3;
  a3.onfinish=()=>{ btn._oDown=null; btn._oStopping=false; btn.classList.remove('busy'); btn.disabled=false; spin.style.transform=''; _runBtnNeutral(btn); };
}
async function runWol(btn){
  const res=el('tool-wol-result'); if(!btn||!res) return;
  const mac=_toolVal('wol-mac','').trim();
  if(!mac){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a MAC address</span>'; return; }
  _runBtnStart(btn);
  try{
    const d=await _toolPostJSON('/api/tools/wol?mac='+encodeURIComponent(mac));
    if(d.error) throw new Error(d.error);
    res.innerHTML='<div style="display:flex;align-items:center;gap:8px;font-size:13px;color:#22C55E"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Magic packet sent to '+esc(d.mac)+'</div>';
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

function _toolStat(label,val,color){
  return '<div style="display:flex;justify-content:space-between;align-items:baseline;padding:6px 0;border-bottom:1px solid var(--c-border)">'
    +'<span style="font-size:12px;color:var(--c-muted)">'+esc(label)+'</span>'
    +'<span style="font-size:18px;font-weight:600;color:'+color+';font-variant-numeric:tabular-nums">'+esc(val)+'</span></div>';
}
function _toolVal(id,def){ const e=el(id); return e? (e.value||def) : def; }
async function _toolPostJSON(url){
  const r=await fetch(url,{method:'POST',headers:{'X-CSRF-Token':_csrf()}});
  const d=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(d.error||('HTTP '+r.status));
  return d;
}

async function runNetcheck(btn){
  const res=el('tool-netcheck-result'); if(!btn||!res) return;
  const tgt=_toolVal('netcheck-target','').trim();
  if(!tgt){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a host[:port]</span>'; return; }
  _runBtnStart(btn);
  res.innerHTML='<span style="color:var(--c-muted);font-size:12px">Resolving '+esc(tgt)+'…</span>';
  try{
    const d=await _toolPostJSON('/api/tools/netcheck?target='+encodeURIComponent(tgt));
    if(d.error) throw new Error(d.error);
    let h=_toolStat('Resolved',(d.ip||'—'),'var(--c-text)')+_toolStat('DNS',(d.dns_ms!=null?d.dns_ms+' ms':'—'),'var(--c-accent)');
    if(d.open===true) h+=_toolStat('Port '+d.port,'open · '+(d.connect_ms!=null?d.connect_ms+' ms':'—'),'#22C55E');
    else h+=_toolStat('Port '+d.port,'closed / filtered','#EF4444');
    res.innerHTML=h;
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

async function runTraceroute(btn){
  const res=el('tool-trace-result'); if(!btn||!res) return;
  const tgt=_toolVal('trace-target','').trim();
  if(!tgt){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a host</span>'; return; }
  _runBtnStart(btn);
  res.innerHTML='<span style="color:var(--c-muted);font-size:12px">Tracing route to '+esc(tgt)+'…</span>';
  try{
    const d=await _toolPostJSON('/api/tools/traceroute?target='+encodeURIComponent(tgt));
    if(d.error) throw new Error(d.error);
    const hops=d.hops||[];
    res.innerHTML = hops.length
      ? '<div style="font-size:11px;max-height:200px;overflow:auto;margin:-2px 0">'+hops.map(h=>
          '<div style="display:flex;gap:8px;padding:2px 0;align-items:baseline">'
          +'<span style="color:var(--c-dim);width:18px;text-align:right;flex-shrink:0">'+h.hop+'</span>'
          +'<span style="flex:1;min-width:0;color:var(--c-text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(h.ip||'* * *')+'</span>'
          +'<span style="flex-shrink:0;color:var(--c-accent)">'+(h.ms!=null?h.ms+' ms':'')+'</span></div>').join('')+'</div>'
      : '<span style="font-size:12px;color:var(--c-muted)">No hops returned</span>';
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

async function runCertCheck(btn){
  const res=el('tool-cert-result'); if(!btn||!res) return;
  const tgt=_toolVal('cert-target','').trim();
  if(!tgt){ res.innerHTML='<span style="color:#EF4444;font-size:12px">Enter a domain</span>'; return; }
  _runBtnStart(btn);
  res.innerHTML='<span style="color:var(--c-muted);font-size:12px">Checking '+esc(tgt)+'…</span>';
  try{
    const d=await _toolPostJSON('/api/tools/certexpiry?target='+encodeURIComponent(tgt));
    if(d.error) throw new Error(d.error);
    const days=d.days_left;
    const clr = days==null?'var(--c-text)' : days<0?'#EF4444' : days<14?'#EF4444' : days<30?'#F59E0B':'#22C55E';
    const lbl = days==null?'—' : days<0?('expired '+Math.abs(days)+'d ago') : (days+' days');
    res.innerHTML=_toolStat('Expires in', lbl, clr)
      +_toolStat('Issuer', d.issuer||'—','var(--c-text)')
      +(d.not_after?'<div style="font-size:10px;color:var(--c-dim);margin-top:6px">'+esc(d.not_after)+'</div>':'');
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}

// ── Import history (Proxmox RRD backfill) ───────────────────────────────────
// Kicks the one-shot backfill job on the backend and polls its status while it
// runs. The result line doubles as the "job" record: last run + rows imported.
function _importSummary(rows){
  const labels={proxmox_stats:'node CPU/RAM', proxmox_net_stats:'node network',
    pxstorage_stats:'storage usage', entity_stats:'guest CPU/RAM', pxstorage_io:'storage I/O'};
  const parts=Object.entries(rows||{}).filter(([,v])=>v>0)
    .map(([k,v])=>v.toLocaleString()+' '+(labels[k]||k)+' points');
  return parts.length?parts.join(' · '):'nothing new to import — history already covered';
}
function _importStatusHtml(st){
  if(st.running) return '<span style="font-size:12px;color:var(--c-muted)">Importing — '+esc(st.phase||'working…')+'</span>';
  if(st.error) return '<span style="font-size:12px;color:#EF4444">'+esc(st.error)+'</span>';
  if(st.last){
    return _toolStat('Last import', timeAgo(st.last.ts*1000)+(st.last.auto?' · auto (first launch)':''), 'var(--c-text)')
      +'<div style="font-size:11px;color:var(--c-muted);margin-top:6px">'+esc(_importSummary(st.last.rows))+'</div>';
  }
  return '<span style="font-size:12px;color:var(--c-dim)">Not run yet.</span>';
}
async function _refreshImportStatus(){
  try{
    const st=await fetch('/api/import/status').then(r=>r.json());
    const res=el('tool-import-result'); if(res) res.innerHTML=_importStatusHtml(st);
    return st;
  }catch(e){ return null; }
}
async function runHistoryImport(btn){
  const res=el('tool-import-result'); if(!btn||!res) return;
  _runBtnStart(btn);
  try{
    const r=await fetch('/api/import/history',{method:'POST',headers:{'X-CSRF-Token':_csrf()}});
    const d=await r.json().catch(()=>({}));
    if(!r.ok && r.status!==409) throw new Error(d.error||('HTTP '+r.status));
    for(;;){
      const st=await _refreshImportStatus();
      const ph=el('tool-import-phase');
      if(ph) ph.textContent = (st && st.running && st.phase) ? st.phase : 'Importing…';
      if(!st || !st.running) break;
      await new Promise(t=>setTimeout(t,1500));
    }
  }catch(e){ res.innerHTML='<span style="color:#EF4444;font-size:12px">'+esc(e.message)+'</span>'; }
  _runBtnStop(btn);
}
