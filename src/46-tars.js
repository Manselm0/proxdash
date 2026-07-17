// ── TARS chat (Claude API proxy, streaming thinking + text) ──────────────────
let _tarsHistory = [];
let _tarsBusy = false;
let _tarsActiveId = null;   // id of the conversation currently open, once saved once

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

// ── Header meta-row (readiness · model) ───────────────────────────────────────
// The model badge only means anything once the assistant is actually usable —
// showing a leftover/default model string next to "not configured" reads as a
// contradiction, so it's hidden entirely until `configured` is true. The
// readiness pill itself gets a distinct "bad" treatment (filled, clickable
// straight to Settings) so an unconfigured assistant is unmistakable rather
// than a small dot easy to miss.
function _tarsLoadInfo() {
  const wrap = el('tars-rdy-wrap'), modelItem = el('tars-meta-model-item'), sep = el('tars-meta-sep');
  fetch('/api/tars/info').then(r => r.json()).then(d => {
    const rd = el('tars-rdy'); if (rd) rd.textContent = d.configured ? 'ready' : 'not configured — set up in Settings';
    const dot = el('tars-rdy-dot'); if (dot) dot.className = 'tars-dot ' + (d.configured ? 'ok' : 'bad');
    if (wrap) wrap.classList.toggle('tars-rdy-bad', !d.configured);
    if (modelItem) modelItem.style.display = d.configured ? '' : 'none';
    if (sep) sep.style.display = d.configured ? '' : 'none';
    const m = el('tars-meta-model'); if (m) m.textContent = String(d.model || '').replace(/^claude-/, '') || '—';
  }).catch(() => {
    const rd = el('tars-rdy'); if (rd) rd.textContent = 'offline';
    const dot = el('tars-rdy-dot'); if (dot) dot.className = 'tars-dot bad';
    if (wrap) wrap.classList.add('tars-rdy-bad');
    if (modelItem) modelItem.style.display = 'none';
    if (sep) sep.style.display = 'none';
  });
}
function _tarsGoSettings() {
  showPage('settings');
  setTimeout(() => { if (typeof switchSettingsTab === 'function') switchSettingsTab('assistant'); }, 80);
}

// ── Conversation history (localStorage — this backend is stateless per
// request; the browser is the only place a past conversation lives). Capped
// at 30 so it can't grow unbounded. "New chat" saves whatever's open (if it
// has any turns) under a stable per-conversation id, then starts fresh.
const _TARS_CONVOS_KEY = 'hd-tars-convos', _TARS_CONVOS_MAX = 30;
let _tarsConvos = [];
function _tarsLoadConvos() {
  try { _tarsConvos = JSON.parse(localStorage.getItem(_TARS_CONVOS_KEY) || '[]'); }
  catch (e) { _tarsConvos = []; }
  if (!Array.isArray(_tarsConvos)) _tarsConvos = [];
}
function _tarsSaveConvos() {
  try { localStorage.setItem(_TARS_CONVOS_KEY, JSON.stringify(_tarsConvos.slice(0, _TARS_CONVOS_MAX))); } catch (e) {}
}
function _tarsPersistActive() {
  if (!_tarsHistory.length) return;
  _tarsLoadConvos();
  const firstUser = (_tarsHistory.find(m => m.role === 'user') || {}).content || 'Conversation';
  const title = firstUser.length > 60 ? firstUser.slice(0, 60) + '…' : firstUser;
  if (!_tarsActiveId) _tarsActiveId = 'c' + Date.now() + Math.random().toString(36).slice(2, 7);
  const rec = { id: _tarsActiveId, title, messages: _tarsHistory.slice(), updatedAt: Date.now() };
  const idx = _tarsConvos.findIndex(c => c.id === _tarsActiveId);
  if (idx >= 0) _tarsConvos[idx] = rec; else _tarsConvos.unshift(rec);
  _tarsConvos.sort((a, b) => b.updatedAt - a.updatedAt);
  _tarsSaveConvos();
}
function _tarsFmtWhen(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
function _tarsRenderHistoryList() {
  const host = el('tars-history-list'); if (!host) return;
  _tarsLoadConvos();
  if (!_tarsConvos.length) {
    host.innerHTML = '<div style="font-size:12px;color:var(--c-muted);padding:8px 0">No past conversations yet.</div>';
    return;
  }
  host.innerHTML = _tarsConvos.map(c =>
    '<div class="tars-hist-row' + (c.id === _tarsActiveId ? ' active' : '') + '" onclick="tarsLoadConvo(\'' + c.id + '\')">'
    + '<div class="tars-hist-main"><div class="tars-hist-title">' + esc(c.title) + '</div>'
    + '<div class="tars-hist-when">' + _tarsFmtWhen(c.updatedAt) + '</div></div>'
    + '<button class="tars-hist-del" onclick="event.stopPropagation();tarsDeleteConvo(\'' + c.id + '\')" aria-label="Delete conversation">'
    + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    + '</button></div>'
  ).join('');
}
function tarsLoadConvo(id) {
  _tarsPersistActive();
  _tarsLoadConvos();
  const c = _tarsConvos.find(x => x.id === id); if (!c) return;
  _tarsActiveId = c.id;
  _tarsHistory = c.messages.slice();
  const chat = el('tars-chat'); chat.innerHTML = '';
  _tarsHistory.forEach(m => {
    if (m.role === 'user') { _tarsLine('user', m.content); return; }
    const div = document.createElement('div'); div.className = 'tline tline-a tmd';
    div.innerHTML = _tarsMd(m.content); chat.appendChild(div);
  });
  chat.scrollTop = chat.scrollHeight;
  closeTarsHistory();
}
function tarsDeleteConvo(id) {
  _tarsLoadConvos();
  _tarsConvos = _tarsConvos.filter(c => c.id !== id);
  _tarsSaveConvos();
  if (id === _tarsActiveId) _tarsActiveId = null;
  _tarsRenderHistoryList();
}
function openTarsHistory() {
  _tarsRenderHistoryList();
  const m = el('tars-history-modal'); if (m) m.classList.add('open');
}
function closeTarsHistory() {
  const m = el('tars-history-modal'); if (m) m.classList.remove('open');
}

function tarsClear() {
  _tarsPersistActive();
  _tarsHistory = [];
  _tarsActiveId = null;
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
      body: JSON.stringify({ messages: _tarsHistory }),
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
    _tarsPersistActive();
  }
}

function _tarsPageShow() {
  _tarsLoadInfo();
  const c = el('tars-chat'); if (c && !_tarsHistory.length && !c.firstChild) _tarsRenderEmpty();
  setTimeout(() => { const i = el('tars-input'); if (i) i.focus(); }, 60);
}
