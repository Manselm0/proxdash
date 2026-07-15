// ── Shared ProxDash slider (.hd-slider — CSS in index.html) ──────────────────
// Overlay pattern: custom visuals + a transparent native range. _hdSl keeps the
// clip-path fill + knob in sync with the value; hdSlider() builds the markup.
function _hdSl(input) {
  const w = input.closest('.hd-slider'); if (!w) return;
  const mn = parseFloat(input.min) || 0, mxr = parseFloat(input.max), mx = isNaN(mxr) ? 100 : mxr;
  const p = mx > mn ? ((parseFloat(input.value) - mn) / (mx - mn) * 100) : 0;
  w.style.setProperty('--p', Math.max(0, Math.min(100, p)) + '%');
}
function hdSlider(o) {
  o = o || {};
  const mn = o.min == null ? 0 : o.min, mx = o.max == null ? 100 : o.max, v = o.value == null ? mn : o.value;
  const p = mx > mn ? ((v - mn) / (mx - mn) * 100) : 0;
  return '<div class="hd-slider" style="--p:' + Math.max(0, Math.min(100, p)) + '%' + (o.style ? ';' + o.style : '') + '">'
    + '<div class="hd-sl-trk"><div class="hd-sl-fill"></div></div><div class="hd-sl-knob"></div>'
    + '<input type="range" min="' + mn + '" max="' + mx + '" value="' + v + '"' + (o.aria ? ' aria-label="' + esc(o.aria) + '"' : '')
    + ' oninput="_hdSl(this);' + (o.oninput || '') + '"' + (o.onchange ? ' onchange="' + o.onchange + '"' : '') + '></div>';
}

// ── TARS chat (Claude API proxy, streaming thinking + text) ──────────────────
const _TARS_DIALS = [
  { k: 'humor',   label: 'Humor',   def: 75 },
  { k: 'honesty', label: 'Honesty', def: 90 },
  { k: 'sarcasm', label: 'Sarcasm', def: 30 },
];
let _tarsState = { humor: 75, honesty: 90, sarcasm: 30 };
let _tarsHistory = [];
let _tarsBusy = false;

function _tarsLoadDials() {
  try { Object.assign(_tarsState, JSON.parse(localStorage.getItem('hd-tars-dials') || '{}')); } catch (e) {}
}
function _tarsRenderDials() {
  const host = el('tars-dials'); if (!host) return;
  host.innerHTML = _TARS_DIALS.map(d =>
    '<div><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--c-muted);margin-bottom:6px">'
    + '<span>' + d.label + '</span><span id="tars-val-' + d.k + '" style="color:var(--c-accent);font-weight:700">' + _tarsState[d.k] + '%</span></div>'
    + hdSlider({ value: _tarsState[d.k], aria: d.label, oninput: "tarsDial('" + d.k + "',this.value)" }) + '</div>'
  ).join('');
}
function tarsDial(k, v) {
  _tarsState[k] = parseInt(v, 10) || 0;
  const e = el('tars-val-' + k); if (e) e.textContent = _tarsState[k] + '%';
  _tarsUpdateDialMeta();
  try { localStorage.setItem('hd-tars-dials', JSON.stringify(_tarsState)); } catch (e) {}
}
function _tarsLine(role, text) {
  const div = document.createElement('div');
  div.className = 'tline tline-' + (role === 'user' ? 'u' : 'a');
  div.textContent = text;
  const chat = el('tars-chat');
  const emp = el('tars-empty'); if (emp) emp.remove();   // first message clears the empty state
  chat.appendChild(div); chat.scrollTop = chat.scrollHeight;
  return div;
}
// ── Terminal-style markdown for TARS replies (escape-first → XSS-safe) ───────
function _tarsInline(raw) {
  let s = esc(raw);                                   // escape & " < > first
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '' + (codes.length - 1) + ''; });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) =>
    /^https?:\/\//i.test(u) ? '<a href="' + u + '" target="_blank" rel="noopener noreferrer">' + t + '</a>' : t);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\s][^*]*?)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[\s(>])_([^_]+)_(?=[\s).,!?:;]|$)/g, '$1<em>$2</em>');
  s = s.replace(/(\d+)/g, (m, i) => '<code class="tmd-code">' + codes[+i] + '</code>');
  return s;
}
function _tarsMd(text) {
  const lines = String(text || '').split('\n');
  const out = [];
  let inCode = false, codeBuf = [];
  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (!inCode) { inCode = true; codeBuf = []; }
      else { out.push('<pre class="tmd-pre"><code>' + esc(codeBuf.join('\n')) + '</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { codeBuf.push(raw); continue; }
    let m;
    if (!raw.trim()) out.push('<div class="tmd-gap"></div>');
    else if (m = raw.match(/^\s*(#{1,4})\s+(.*)$/)) out.push('<div class="tmd-line"><span class="tmd-h">' + _tarsInline(m[2]) + '</span></div>');
    else if (m = raw.match(/^(\s*)[-*+]\s+(.*)$/)) out.push('<div class="tmd-line tmd-li" style="padding-left:' + (m[1].length * 6 + 2) + 'px"><span class="tmd-bullet">•</span> ' + _tarsInline(m[2]) + '</div>');
    else if (m = raw.match(/^(\s*)(\d+)\.\s+(.*)$/)) out.push('<div class="tmd-line tmd-li" style="padding-left:' + (m[1].length * 6 + 2) + 'px"><span class="tmd-num">' + m[2] + '.</span> ' + _tarsInline(m[3]) + '</div>');
    else if (m = raw.match(/^\s*>\s?(.*)$/)) out.push('<div class="tmd-line"><span class="tmd-quote">' + _tarsInline(m[1]) + '</span></div>');
    else if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(raw)) out.push('<div class="tmd-hr"></div>');
    else out.push('<div class="tmd-line">' + _tarsInline(raw) + '</div>');
  }
  if (inCode) out.push('<pre class="tmd-pre"><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
  return out.join('');
}

function tarsKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); tarsSend(); }
  const t = el('tars-input'); if (t) { t.style.height = 'auto'; t.style.height = Math.min(120, t.scrollHeight) + 'px'; }
}
// ── Empty state (suggestion chips) ───────────────────────────────────────────
const _TARS_CHIPS = ["What's down right now?", "How's storage looking?", "Which node is busiest?", "Any failed backups?"];
function _tarsRenderEmpty() {
  const c = el('tars-chat'); if (!c) return;
  c.innerHTML =
    '<div class="tars-empty" id="tars-empty">'
    + '<svg class="tars-empty-glyph" width="46" height="40" viewBox="0 0 46 40" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="8" height="36" rx="2.5"/><rect x="14" y="2" width="8" height="36" rx="2.5"/><rect x="26" y="2" width="8" height="36" rx="2.5"/><rect x="38" y="2" width="6" height="36" rx="2.5"/></svg>'
    + '<div class="tars-empty-hint">Ask about the cluster, storage, backups, or what is down. The assistant reads your live cluster (read-only).</div>'
    + '<div class="tars-chips">'
    + _TARS_CHIPS.map(q => '<button class="tars-chip" data-q="' + esc(q) + '" onclick="tarsSuggest(this.dataset.q)">' + esc(q) + '</button>').join('')
    + '</div></div>';
}
function tarsSuggest(q) {
  const i = el('tars-input'); if (!i) return;
  i.value = q; i.style.height = 'auto';
  tarsSend();
}

// ── Inline "thought process": a collapsible block per assistant turn ─────────
let _tarsThinkSeg = null, _tarsThinkHost = null, _tarsThinkSummary = null;
function _tarsStatus(state, label) {
  const s = _tarsThinkSummary; if (!s) return;
  s.dataset.state = state || 'idle';
  const tx = s.querySelector('.tars-status-txt'); if (tx) tx.textContent = label || '';
}
function _tarsThinkText(txt) {
  const t = _tarsThinkHost; if (!t) return;
  if (!_tarsThinkSeg) { _tarsThinkSeg = document.createElement('div'); _tarsThinkSeg.className = 'think-seg'; t.appendChild(_tarsThinkSeg); }
  _tarsThinkSeg.textContent += txt;
  _tarsScrollChat();
}
function _tarsThinkTool(name) {
  const t = _tarsThinkHost; if (!t) return;
  const row = document.createElement('div'); row.className = 'tmd-tool';
  row.innerHTML = '<span class="tt-spin"></span><span class="tt-ok">✓</span><span class="tt-name">' + esc(name || 'tool') + '</span><span class="tt-sec"></span>';
  t.appendChild(row); _tarsThinkSeg = null; _tarsScrollChat();
}
function _tarsThinkToolDone(input) {
  const t = _tarsThinkHost; if (!t) return;
  const rows = t.querySelectorAll('.tmd-tool:not([data-done])');
  const row = rows[rows.length - 1]; if (!row) return;
  row.setAttribute('data-done', '');
  const sx = input && input.sections ? JSON.stringify(input.sections) : '';
  const sec = row.querySelector('.tt-sec'); if (sec && sx) sec.textContent = sx;
  _tarsScrollChat();
}
function _tarsFinishThink(answer) {
  const host = _tarsThinkHost; if (!host) return;
  const det = host.closest('.tthink');
  if (det && !host.firstChild) { det.remove(); return; }   // no reasoning captured → drop the block
  _tarsStatus(answer ? 'done' : 'idle', 'Thought process');
  if (det) det.open = false;                                // collapse once finished
}
function _tarsScrollChat() { const c = el('tars-chat'); if (c) c.scrollTop = c.scrollHeight; }

// ── Header meta-row (model · dials · readiness) ──────────────────────────────
function _tarsUpdateDialMeta() {
  const d = el('tars-meta-dials');
  if (d) d.textContent = 'H' + _tarsState.humor + ' · Ho' + _tarsState.honesty + ' · Sa' + _tarsState.sarcasm;
}
function _tarsLoadInfo() {
  _tarsUpdateDialMeta();
  fetch('/api/tars/info').then(r => r.json()).then(d => {
    const m = el('tars-meta-model'); if (m) m.textContent = String(d.model || '').replace(/^claude-/, '') || '—';
    const rd = el('tars-rdy'); if (rd) rd.textContent = d.configured ? 'ready' : 'not configured';
    const dot = el('tars-rdy-dot'); if (dot) dot.className = 'tars-dot ' + (d.configured ? 'ok' : 'bad');
  }).catch(() => {
    const rd = el('tars-rdy'); if (rd) rd.textContent = 'offline';
    const dot = el('tars-rdy-dot'); if (dot) dot.className = 'tars-dot bad';
  });
}

function tarsClear() {
  _tarsHistory = [];
  _tarsRenderEmpty();
}

async function tarsSend() {
  if (_tarsBusy) return;
  const inp = el('tars-input'); const msg = (inp.value || '').trim(); if (!msg) return;
  inp.value = ''; inp.style.height = 'auto';
  _tarsLine('user', msg);
  _tarsHistory.push({ role: 'user', content: msg });
  _tarsBusy = true;
  const sendBtn = el('tars-send'); if (sendBtn) { sendBtn.disabled = true; sendBtn.style.opacity = '.6'; }

  // assistant turn: inline collapsible thinking + the answer line
  const chat = el('tars-chat');
  const turn = document.createElement('div'); turn.className = 'tturn';
  const think = document.createElement('details'); think.className = 'tthink'; think.open = true;
  think.innerHTML = '<summary><span class="tars-status" data-state="thinking"><span class="tars-dot"></span>'
    + '<span class="tars-status-txt">Thinking…</span></span></summary><div class="tthink-body"></div>';
  const line = document.createElement('div'); line.className = 'tline tline-a tmd tline-live';
  turn.appendChild(think); turn.appendChild(line);
  chat.appendChild(turn); chat.scrollTop = chat.scrollHeight;
  _tarsThinkHost = think.querySelector('.tthink-body');
  _tarsThinkSummary = think.querySelector('.tars-status');
  _tarsThinkSeg = null;

  let answer = '';
  try {
    const r = await fetch('/api/tars/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': _csrf() },
      body: JSON.stringify({ messages: _tarsHistory, dials: _tarsState }),
    });
    if (!r.ok) {
      const e = await r.json().catch(() => ({}));
      line.textContent = '⚠ ' + (e.error || ('HTTP ' + r.status)); line.classList.remove('tline-live');
      _tarsStatus('error', 'error');
      _tarsHistory.pop();  // drop the user turn so retry works after fixing config
      return;
    }
    const reader = r.body.getReader(), dec = new TextDecoder(); let buf = '';
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let evt = 'message', data = '';
        chunk.split('\n').forEach(l => {
          if (l.startsWith('event:')) evt = l.slice(6).trim();
          else if (l.startsWith('data:')) data += l.slice(5).trim();
        });
        if (!data) continue;
        let obj; try { obj = JSON.parse(data); } catch (e) { continue; }
        if (evt === 'thinking') {
          _tarsThinkText(obj.t || ''); _tarsStatus('thinking', 'Thinking…');
        } else if (evt === 'tool') {
          if (obj.phase === 'call') { _tarsThinkTool(obj.name); _tarsStatus('tool', 'Querying cluster…'); }
          else if (obj.phase === 'result') { _tarsThinkToolDone(obj.input); }
        } else if (evt === 'text') {
          _tarsStatus('responding', 'Responding…');
          answer += obj.t || ''; line.innerHTML = _tarsMd(answer);
          chat.scrollTop = chat.scrollHeight;
        } else if (evt === 'error') {
          line.textContent = '⚠ ' + (obj.detail || obj.error || 'error');
          _tarsStatus('error', 'error');
        }
      }
    }
    if (answer) _tarsHistory.push({ role: 'assistant', content: answer });
    else { _tarsHistory.pop(); if (!line.textContent) line.textContent = '(no output)'; }
  } catch (e) {
    _tarsStatus('error', 'error');
    if (!line.textContent) line.textContent = '⚠ ' + e;
    _tarsHistory.pop();
  } finally {
    _tarsBusy = false;
    line.classList.remove('tline-live');
    _tarsFinishThink(answer);
    if (sendBtn) { sendBtn.disabled = false; sendBtn.style.opacity = ''; }
  }
}

function _tarsPageShow() {
  _tarsLoadDials();
  _tarsLoadInfo();
  const c = el('tars-chat'); if (c && !_tarsHistory.length && !c.firstChild) _tarsRenderEmpty();
  setTimeout(() => { const i = el('tars-input'); if (i) i.focus(); }, 60);
}
function openTarsDials() {
  _tarsLoadDials(); _tarsRenderDials();
  const m = el('tars-dials-modal'); if (m) m.classList.add('open');
}
function closeTarsDials() {
  const m = el('tars-dials-modal'); if (m) m.classList.remove('open');
}
