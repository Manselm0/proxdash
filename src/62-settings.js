// ── Settings ──────────────────────────────────────────────────────────────
let settingsConfig={};
function gval(id){const e=el(id);return e?e.value:'';}
function gchecked(id){const e=el(id);return !!(e&&e.checked);}
function toggleReveal(id,btn){const inp=el(id);if(!inp)return;inp.type=inp.type==='password'?'text':'password';btn.innerHTML=inp.type==='password'?svg('eye',14):svg('eye-off',14);}

function showToast(msg,isErr=false){
  const w=el('hd-toast'),i=el('hd-toast-inner');if(!w||!i)return;
  w.setAttribute('aria-live', isErr ? 'assertive' : 'polite');   // errors interrupt, success is polite
  i.style.cssText=`background:${isErr?'rgba(239,68,68,.15)':'rgba(34,197,94,.15)'};color:${isErr?'#EF4444':'#22C55E'};border:1px solid ${isErr?'rgba(239,68,68,.2)':'rgba(34,197,94,.2)'};`;
  i.textContent=msg; w.classList.remove('hidden');
  setTimeout(()=>w.classList.add('hidden'),2500);
}

function switchSettingsTab(name,btn){
  document.querySelectorAll('[id^="stab-panel-"]').forEach(p=>p.classList.add('hidden'));
  // Settings nav buttons live inside a .hist-range so the sliding thumb
  // animates between sections. Clear active on every nav variant to be safe.
  document.querySelectorAll('#set-section-hist-range .hist-btn, .snav-btn, .stab-btn').forEach(b=>b.classList.remove('active'));
  const p=el('stab-panel-'+name);if(p)p.classList.remove('hidden');
  if(btn){
    btn.classList.add('active');
  } else {
    const sb=el('snav-'+name); if(sb) sb.classList.add('active');
  }
  // Slide the .hist-thumb over to the newly active button.
  requestAnimationFrame(() => _histThumbUpdate('set-section'));
}

// Unsaved-changes hint: any edit to a server-backed control (not browser-local
// .s-local ones like accent/wall) flags the save bar until Save & Apply.
let _settingsDirty = false, _settingsDirtyWired = false;
function _settingsMarkDirty(){
  _settingsDirty = true;
  const s = el('settings-save-status');
  if (s){ s.textContent = '● Unsaved changes'; s.style.color = '#F59E0B'; }
}
function _settingsClearDirty(){
  _settingsDirty = false;
  const s = el('settings-save-status');
  if (s && s.textContent === '● Unsaved changes') s.textContent = '';
}
function _wireSettingsDirty(){
  if (_settingsDirtyWired) return;
  const root = document.querySelector('.settings-content'); if (!root) return;
  _settingsDirtyWired = true;
  const edit = e => { if (!e.target.closest('.s-local')) _settingsMarkDirty(); };
  root.addEventListener('input', edit);
  root.addEventListener('change', edit);
  // Add/Remove device/service buttons restructure config → also dirty.
  root.addEventListener('click', e => {
    if (e.target.closest('.s-btn') && !e.target.closest('.s-test-btn') && !e.target.closest('.s-local')) _settingsMarkDirty();
  });
}

// Loads /api/config and renders all settings sections. Idempotent — re-rendering
// while the page is already populated reflows from a fresh server snapshot.
function loadSettingsPage(){
  Object.entries({general:'Loading…',infrastructure:'Loading…',health:'Loading…',assistant:'Loading…'}).forEach(([k,v])=>{
    const e=el('stab-panel-'+k);if(e)e.innerHTML='<p style="color:var(--c-muted);font-size:13px;padding:20px 0">'+v+'</p>';
  });
  switchSettingsTab('general', el('snav-general'));
  fetch('/api/config').then(r=>{if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}).then(cfg=>{
    settingsConfig=cfg;
    try{populateSettings(cfg);}catch(err){console.error('Settings populate error:',err);showToast('Settings render error: '+err.message,true);}
    switchSettingsTab('general', el('snav-general'));
    _wireSettingsDirty(); _settingsClearDirty();
  }).catch(e=>{
    console.error('Settings load error:',e);
    const ep=el('stab-panel-general');if(ep)ep.innerHTML='<p style="color:#EF4444;font-size:13px;padding:20px 0">Failed to load config: '+esc(e.message||String(e))+'<br>Check browser console (F12) for details.</p>';
  });
}

function sRow(lbl,inp){return `<div class="s-row"><span class="s-lbl">${lbl}</span>${inp}</div>`;}
function sText(id,v,ph){return '<input type="text" id="'+id+'" class="s-inp" value="'+esc(v)+'"'+(ph?' placeholder="'+esc(ph)+'"':'')+'>'; }
function sPass(id,v){return `<div style="display:flex;gap:4px;flex:1"><input type="password" id="${id}" class="s-inp" style="flex:1;min-width:0" value="${esc(v)}"><button class="s-reveal" onclick="toggleReveal('${id}',this)">${svg('eye',14)}</button></div>`;}
function sCheck(id,v,lbl){return '<div style="display:flex;align-items:center;gap:6px"><input type="checkbox" id="'+id+'" class="s-check"'+(v?' checked':'')+'>'+(lbl?'<label for="'+id+'" style="font-size:12px;color:var(--c-dim);cursor:pointer">'+lbl+'</label>':'')+'</div>';}
function sGroup(title,body){return `<div class="s-group"><div class="s-group-title">${title}</div>${body}</div>`;}
function sEnabled(id,v){return sRow('Enabled',sCheck(id,v));}
function sHelp(html){return `<div class="s-help">${html}</div>`;}
function sTest(svc,getter,label){
  const tid='tres-'+svc+'-'+Math.random().toString(36).slice(2,8);
  return `<div class="s-test-row"><button class="s-btn s-test-btn" data-svc="${svc}" data-getter="${getter}" data-tid="${tid}" onclick="testServiceBtn(this)">${svg('zap',14)} ${label||'Test Connection'}</button><span id="${tid}" class="s-test-result"></span></div>`;
}
function testServiceBtn(btn){
  const svc=btn.dataset.svc, fnName=btn.dataset.getter, tid=btn.dataset.tid;
  const fn=window[fnName], result=el(tid);
  if(!fn){if(result){result.innerHTML=svg('x',14)+' Missing getter '+esc(fnName);result.style.color='#EF4444';}return;}
  if(result){result.innerHTML=svg('clock',14)+' Testing…';result.style.color='var(--c-muted)';}
  btn.disabled=true;
  let cfg;
  try{cfg=fn(btn);}catch(e){btn.disabled=false;if(result){result.innerHTML=svg('x',14)+' '+esc(e.message);result.style.color='#EF4444';}return;}
  fetch('/api/test',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':_csrf()},body:JSON.stringify({service:svc,config:cfg})})
    .then(r=>r.json())
    .then(d=>{if(!result)return;result.innerHTML=(d.ok?svg('check',14):svg('x',14))+' '+esc(d.message||'');result.style.color=d.ok?'#22C55E':'#EF4444';})
    .catch(e=>{if(result){result.innerHTML=svg('x',14)+' '+esc(e.message);result.style.color='#EF4444';}})
    .finally(()=>{btn.disabled=false;});
}
// Per-service getters
function _getProxmoxCfg(){return{url:gval('cfg-px-url'),token_id:gval('cfg-px-tid'),token_secret:gval('cfg-px-secret')};}
function _getPbsCfg(){return{url:gval('cfg-pbs-url'),token_id:gval('cfg-pbs-tid'),token_secret:gval('cfg-pbs-secret')};}
function _getHcCfg(btn){
  const row=btn.closest('.hc-row');
  return{url:(row.querySelector('.hc-url')||{}).value||''};
}

function populateSettings(cfg){
  const p={general:buildGeneralTab(cfg),infrastructure:buildInfrastructureTab(cfg),health:buildHealthTab(cfg.health_checks||{}),assistant:buildAssistantTab(cfg)};
  Object.entries(p).forEach(([k,v])=>{const e=el('stab-panel-'+k);if(e)e.innerHTML=v;});
}
function buildGeneralTab(cfg){
  const au=cfg.auth||{};
  let accentVal='#E57000', logoVal='';
  try{ accentVal=localStorage.getItem('proxdash-accent')||window.HD_DEFAULT_ACCENT||'#E57000'; }catch(e){}
  try{ logoVal=localStorage.getItem('hd-logo')||''; }catch(e){}
  return sGroup('Dashboard',
      sRow('Title',sText('cfg-title',cfg.title||'Proxdash','Proxdash'))
    + sRow('Refresh',`<input type="number" id="cfg-poll" class="s-inp" style="width:70px" value="${cfg.poll_interval||10}" min="1" max="300"><span style="font-size:11px;color:var(--c-muted);margin-left:6px">sec</span>`)
    + sHelp('How often the dashboard pulls fresh data from Proxmox and every other integration. Lower is more real-time, higher is lighter load.')
  ) + sGroup('Appearance',
      sRow('Accent color',
        '<div class="s-local" style="display:flex;align-items:center;gap:8px">'
        + '<input type="color" id="cfg-accent" value="'+esc(accentVal)+'" oninput="applyAccentColor(this.value);var h=el(\'cfg-accent-hex\');if(h)h.textContent=this.value" style="width:44px;height:30px;padding:0;border:1px solid var(--c-border);border-radius:6px;background:transparent;cursor:pointer">'
        + '<code id="cfg-accent-hex" style="font-size:12px;color:var(--c-muted)">'+esc(accentVal)+'</code>'
        + '<button type="button" class="s-btn" onclick="resetAccentColor();var i=el(\'cfg-accent\');if(i)i.value=window.HD_DEFAULT_ACCENT;var h=el(\'cfg-accent-hex\');if(h)h.textContent=window.HD_DEFAULT_ACCENT">Reset</button>'
        + '</div>')
    + sRow('Logo',
        '<div class="s-local" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
        + '<img src="/api/logo?theme=light" id="cfg-logo-preview-light" width="28" height="28" alt="light logo" title="Light mode" style="display:block;background:#fff;border-radius:6px;padding:2px;border:1px solid var(--c-border)">'
        + '<img src="/api/logo?theme=dark" id="cfg-logo-preview-dark" width="28" height="28" alt="dark logo" title="Dark mode" style="display:block;background:#101013;border-radius:6px;padding:2px;border:1px solid var(--c-border)">'
        + '<input type="file" id="cfg-logo-file-light" data-theme="light" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="_logoUpload(this)">'
        + '<input type="file" id="cfg-logo-file-dark" data-theme="dark" accept="image/png,image/jpeg,image/webp" style="display:none" onchange="_logoUpload(this)">'
        + '<button type="button" class="s-btn" onclick="el(\'cfg-logo-file-light\').click()">Upload light…</button>'
        + '<button type="button" class="s-btn" onclick="el(\'cfg-logo-file-dark\').click()">Upload dark…</button>'
        + '<button type="button" class="s-btn" onclick="_logoReset()">Reset</button>'
        + '<span id="cfg-logo-status" style="font-size:11px;color:var(--c-muted)"></span>'
        + '</div>')
    + sRow('Logo URL',
        '<input type="text" id="cfg-logo" class="s-inp s-local" value="'+esc(logoVal)+'" placeholder="/api/logo?theme=dark" oninput="applyLogo(this.value.trim())">')
    + sHelp('Accent color is stored in this browser; default is Proxmox orange (<code>#E57000</code>). <strong>Upload light/dark</strong> stores a PNG/JPEG/WebP logo per theme on the server (max 512&nbsp;KB) so every browser and the login page get it; the two previews show what each theme serves. Reset returns both to the bundled ProxDash marks. The optional <strong>Logo URL</strong> is a per-browser override that wins over the uploaded ones.')
  ) + sGroup('Authentication',
      sRow('Require login',sCheck('cfg-auth-en',au.enabled!==false,'Require a login to view the dashboard'))
    + sRow('Session lifetime',`<input type="number" id="cfg-auth-ttl" class="s-inp" style="width:70px" value="${au.session_ttl_days||7}" min="1" max="365"><span style="font-size:11px;color:var(--c-muted);margin-left:6px">days</span>`)
    + sHelp('The local admin account is created on first launch, right at the login screen. Set <strong>Require login</strong> off (<code>auth.enabled: false</code>) only for a trusted-LAN-only deployment where everyone on the network is allowed in.')
  );
}
// ── Logo upload (Settings → Appearance) ──────────────────────────────────────
// Reads the picked file as a data URL and POSTs it to /api/logo (auth + CSRF).
// The server stores it in the data dir and serves it at GET /api/logo, so every
// browser — and the login page — picks it up. Reset (DELETE) returns to the
// bundled mark. Cache-bust after both so the change is visible immediately.
function _logoStatus(msg, isErr){
  const s = el('cfg-logo-status');
  if (s){ s.textContent = msg || ''; s.style.color = isErr ? '#EF4444' : 'var(--c-muted)'; }
}
function _logoBust(){
  const v = '&v=' + Date.now();
  const cur = _defaultLogoUrl() + v;
  document.querySelectorAll('img[data-logo]').forEach(img => { img.src = cur; });
  const fav = document.querySelector('link[rel="icon"]'); if (fav) fav.href = cur;
  const atl = document.querySelector('link[rel="apple-touch-icon"]'); if (atl) atl.href = cur;
  const pl = el('cfg-logo-preview-light'); if (pl) pl.src = '/api/logo?theme=light' + v;
  const pd = el('cfg-logo-preview-dark');  if (pd) pd.src = '/api/logo?theme=dark' + v;
}
function _logoUpload(inp){
  const f = inp.files && inp.files[0];
  const theme = inp.dataset.theme || 'both';
  inp.value = '';                        // so re-picking the same file re-fires change
  if (!f) return;
  if (f.size > 512 * 1024) { _logoStatus('Too large (max 512 KB)', true); return; }
  const rd = new FileReader();
  rd.onload = async () => {
    _logoStatus('Uploading…');
    try {
      const r = await fetch('/api/logo', { method:'POST',
        headers:{ 'Content-Type':'application/json', 'X-CSRF-Token':_csrf() },
        body: JSON.stringify({ data: rd.result, theme: theme }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
      applyLogo('');                     // drop any per-browser URL override
      const li = el('cfg-logo'); if (li) li.value = '';
      _logoBust();
      _logoStatus('Uploaded (' + theme + ')');
      showToast('Logo updated');
    } catch(e){ _logoStatus(e.message, true); showToast('Logo upload failed: ' + e.message, true); }
  };
  rd.readAsDataURL(f);
}
async function _logoReset(){
  try {
    const r = await fetch('/api/logo', { method:'DELETE', headers:{ 'X-CSRF-Token':_csrf() } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    applyLogo('');
    const li = el('cfg-logo'); if (li) li.value = '';
    _logoBust();
    _logoStatus('Reset to bundled mark');
  } catch(e){ _logoStatus(e.message, true); }
}

function buildAssistantTab(cfg){
  const ta=cfg.tars||{};
  const provider = ta.provider==='openai' ? 'openai' : 'anthropic';
  return sGroup('AI Assistant',
      sEnabled('cfg-tars-en',ta.enabled)
    + sRow('Provider','<select id="cfg-tars-provider" class="s-inp">'
        +'<option value="anthropic"'+(provider==='anthropic'?' selected':'')+'>Anthropic (Claude)</option>'
        +'<option value="openai"'+(provider==='openai'?' selected':'')+'>OpenAI-compatible (OpenAI cloud, Open WebUI, Ollama, LM Studio, vLLM…)</option>'
        +'</select>')
    + sRow('API key',sPass('cfg-tars-key',ta.api_key||''))
    + sRow('Base URL',sText('cfg-tars-baseurl',ta.base_url||'','https://api.openai.com/v1'))
    + sRow('Model',sText('cfg-tars-model',ta.model||'claude-sonnet-5','claude-sonnet-5'))
    + sRow('Max tokens','<input type="number" id="cfg-tars-maxtok" class="s-inp" style="width:90px" value="'+(ta.max_tokens||2048)+'" min="256" max="8192">')
    + sRow('Thinking budget','<input type="number" id="cfg-tars-think" class="s-inp" style="width:90px" value="'+(ta.thinking_budget||1200)+'" min="1024" max="6000">')
    + sHelp('Optional AI assistant. <b>Anthropic</b>: get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a> — thinking budget (min 1024) applies here. <b>OpenAI-compatible</b>: works with the real OpenAI cloud API, or point Base URL at any local server\'s <code>/v1</code> endpoint — Open WebUI, Ollama (<code>http://192.168.1.X:11434/v1</code>), LM Studio, vLLM — leave the API key blank if the server needs none; thinking budget is ignored. Enabled controls whether the assistant runs at all, independent of these fields.')
  );
}
function buildInfrastructureTab(cfg){
  const px=cfg.proxmox||{},pbs=cfg.pbs||{};
  return sGroup('Proxmox VE',
      sEnabled('cfg-px-en',px.enabled)
    +sRow('API URL',sText('cfg-px-url',px.url||'','https://192.168.1.X:8006/api2/json'))
    +sRow('Token ID',sText('cfg-px-tid',px.token_id||'','root@pam!tokenname'))
    +sRow('Token Secret',sPass('cfg-px-secret',px.token_secret||''))
    +sHelp('Create at <code>Datacenter → Permissions → API Tokens</code>. Token ID format: <code>user@realm!tokenname</code> (e.g., <code>root@pam!proxdash</code>). Give the token <code>PVEAuditor</code> role on path <code>/</code>.')
    +sTest('proxmox','_getProxmoxCfg')
  )+sGroup('Proxmox Backup Server',
      sEnabled('cfg-pbs-en',pbs.enabled)
    +sRow('API URL',sText('cfg-pbs-url',pbs.url||'','https://192.168.1.X:8007'))
    +sRow('Token ID',sText('cfg-pbs-tid',pbs.token_id||'','root@pam!proxdash'))
    +sRow('Token Secret',sPass('cfg-pbs-secret',pbs.token_secret||''))
    +sHelp('In PBS: <code>Configuration → Access Control → API Token</code>. Give the token <code>DatastoreAudit</code> permission on path <code>/datastore</code> (or <code>/</code> for all). Powers the Backups page.')
    +sTest('pbs','_getPbsCfg')
  );
}
function buildHealthTab(hc){return `<div style="margin-bottom:12px">${sCheck('cfg-hc-en',hc.enabled!==false,'Enable health checks')}</div>`+sHelp('Simple HTTP up/down checks — any URL that returns &lt; 500 counts as up. No auth required.')+`<div style="display:grid;grid-template-columns:120px 1fr 28px 110px;gap:6px;margin-bottom:6px;font-size:11px;color:var(--c-muted);font-weight:600"><span>Name</span><span>URL</span><span></span><span></span></div><div id="hc-services-list">${(hc.services||[]).map(s=>hcRow(s)).join('')}</div><div style="margin-top:8px"><button class="s-btn" onclick="addHcRow()">+ Add Service</button></div>`;}
function hcRow(s){const tid='tres-hc-'+Math.random().toString(36).slice(2,8);return `<div class="hc-row" style="display:grid;grid-template-columns:120px 1fr 28px 110px;gap:6px;margin-bottom:6px;align-items:center"><input type="text" class="s-inp hc-name" value="${esc(s.name||'')}" placeholder="Service"><input type="text" class="s-inp hc-url" value="${esc(s.url||'')}" placeholder="http://..."><button class="s-btn s-btn-danger" onclick="this.closest('.hc-row').remove()">${svg('x',14)}</button><div style="display:flex;align-items:center;gap:6px;font-size:10px"><button class="s-btn s-test-btn" data-svc="health" data-getter="_getHcCfg" data-tid="${tid}" onclick="testServiceBtn(this)" style="padding:4px 8px;font-size:10px">${svg('zap',12)} Test</button><span id="${tid}" class="s-test-result"></span></div></div>`;}
function addHcRow(){const w=document.createElement('div');w.innerHTML=hcRow({name:'',url:''});el('hc-services-list').appendChild(w.firstElementChild);}
// Only the kept-domain tabs (General / Proxmox / Health / Assistant) write
// config: title, poll_interval, auth, proxmox, pbs, health_checks, tars. Every
// other key falls through the `...orig` spread untouched, so trimming the UI
// never wipes a still-present integration in config.yaml. Secrets left as the
// server's sentinel round-trip back to their stored value (see _restore_secrets).
function collectSettings(){const orig=settingsConfig;return{...orig,title:gval('cfg-title'),poll_interval:parseInt(gval('cfg-poll'))||10,auth:collectAuth(),proxmox:{enabled:gchecked('cfg-px-en'),url:gval('cfg-px-url'),token_id:gval('cfg-px-tid'),token_secret:gval('cfg-px-secret')},pbs:{enabled:gchecked('cfg-pbs-en'),url:gval('cfg-pbs-url'),token_id:gval('cfg-pbs-tid'),token_secret:gval('cfg-pbs-secret')},health_checks:collectHealth(),tars:{enabled:gchecked('cfg-tars-en'),provider:gval('cfg-tars-provider')||'anthropic',api_key:gval('cfg-tars-key'),base_url:gval('cfg-tars-baseurl'),model:gval('cfg-tars-model')||'claude-sonnet-5',max_tokens:parseInt(gval('cfg-tars-maxtok'))||2048,thinking_budget:parseInt(gval('cfg-tars-think'))||1200}};}
// Preserve any auth keys we don't surface in the UI (session store settings,
// future flags) via the ...orig spread; overwrite only the edited fields.
function collectAuth(){const orig=settingsConfig.auth||{};return{...orig,enabled:gchecked('cfg-auth-en'),session_ttl_days:parseInt(gval('cfg-auth-ttl'))||7};}
function collectHealth(){const s=[];(el('hc-services-list')||{querySelectorAll:()=>[]}).querySelectorAll('.hc-row').forEach(r=>{const n=(r.querySelector('.hc-name')||{value:''}).value.trim(),u=(r.querySelector('.hc-url')||{value:''}).value.trim();if(n||u)s.push({name:n,url:u});});return{enabled:gchecked('cfg-hc-en'),services:s};}
async function saveSettings(){
  const btn=el('settings-save-btn'), orig=btn.textContent;
  const status=el('settings-save-status');
  btn.textContent='Saving…'; btn.disabled=true;
  if (status) status.textContent='';
  try{
    const r=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':_csrf()},body:JSON.stringify(collectSettings())});
    if(r.ok){
      _settingsDirty = false;   // toast removed — the inline 'Saved & applied' status (left of the button) already covers it
      if (status) {
        status.textContent='Saved & applied just now';
        status.style.color='#16A34A';
        setTimeout(()=>{ if(status.textContent==='Saved & applied just now') status.textContent=''; }, 4000);
      }
    } else {
      const t=await r.text();
      showToast('Save failed: '+t.slice(0,60), true);
      if (status) { status.textContent='Save failed'; status.style.color='#EF4444'; }
    }
  } catch(e) {
    showToast(e.message, true);
    if (status) { status.textContent=e.message; status.style.color='#EF4444'; }
  } finally {
    btn.textContent=orig; btn.disabled=false;
  }
}
