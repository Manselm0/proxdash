// ── Security page ───────────────────────────────────────────────────────────
// Read-only security posture, entirely snapshot-derived (data.security from the
// backend fetch_security, plus node cert/patch fields and the task log). Every
// section fault-isolates: a token without Sys.Audit on /access simply hides the
// Access/Tokens sections rather than breaking Firewall/Repos/Certs.
function _secRerender() { if (window._secData) renderSecurity(window._secData); }
function _secUserSort(k) { _sortSet('secusers', k, (k === 'userid' || k === 'realm') ? 1 : -1, _secRerender); }
function _secTokSort(k)  { _sortSet('sectokens', k, (k === 'owner' || k === 'tokenid') ? 1 : -1, _secRerender); }
function _secAuditSort(k){ _sortSet('secaudit', k, k === 'start' ? -1 : 1, _secRerender); }

function renderSecurity(data) {
  window._secData = data;
  const sec = data.security || {};
  const nodes = (data.proxmox || {}).nodes || [];
  const tasks = (data.tasks || {}).tasks || [];
  const _show = (id, on) => { const s = el(id); if (s) s.style.display = on ? '' : 'none'; };
  const _td = (v, ex) => '<td style="padding:8px 14px;font-size:12.5px;white-space:nowrap;' + (ex || '') + '">' + v + '</td>';
  const _thPad = 'padding:9px 14px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase';
  const card = h => '<div class="hd-card" style="padding:0;overflow-x:auto">' + h + '</div>';
  const now = Date.now() / 1000;
  const badge = (txt, color) => '<span class="badge" style="background:' + color + '22;color:' + color + '">' + txt + '</span>';
  const GREEN = '#22C55E', AMBER = '#F59E0B', RED = '#EF4444', DIM = 'var(--c-dim)';

  // ── Posture summary (header meta) ─────────────────────────────────────────
  const _svgSm = p => '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  const IC_SHIELD = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>';
  const IC_USERS = '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>';
  const IC_KEY = '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2m-4 4 3 3"/>';
  const IC_REFRESH = '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>';
  const mi = (icP, html) => '<span class="page-hdr-meta-item">' + _svgSm(icP) + ' ' + html + '</span>';
  const meta = [];
  const users = Array.isArray(sec.users) ? sec.users : null;
  const tfaKnown = !!sec.tfa_known;
  if (sec.firewall) {
    const on = sec.firewall.enable == 1;
    meta.push(mi(IC_SHIELD, '<b style="color:' + (on ? GREEN : AMBER) + '">Firewall ' + (on ? 'on' : 'off') + '</b>'));
  }
  if (users && tfaKnown) {
    const gaps = users.filter(u => u.enable == 1 && u.tfa === false).length;
    meta.push(mi(IC_USERS, '<b style="color:' + (gaps ? AMBER : GREEN) + '">' + gaps + '</b> without 2FA'));
  }
  const privTok = (sec.tokens || []).filter(t => t.privsep == 0).length;
  if (sec.tokens && sec.tokens.length) meta.push(mi(IC_KEY, '<b' + (privTok ? ' style="color:' + AMBER + '"' : '') + '>' + privTok + '</b> full-priv tokens'));
  const hm = el('security-hdr-meta'); if (hm) hm.innerHTML = meta.join('');

  // ── Access & Identity ─────────────────────────────────────────────────────
  const accEl = el('sec-access');
  if (accEl && (users || (sec.realms && sec.realms.length))) {
    let html = '';
    if (sec.realms && sec.realms.length) {
      html += '<div style="padding:12px 16px 4px;font-size:12px;color:var(--c-muted)">Realms: '
        + sec.realms.map(r => '<span class="badge" style="background:var(--c-hover);color:var(--c-text);margin-right:4px">' + esc(r.realm) + ' <span style="color:var(--c-dim)">' + esc(r.type) + '</span></span>').join('') + '</div>';
    }
    if (users && users.length) {
      const key = (u, k) => k === 'userid' ? (u.userid || '').toLowerCase() : k === 'realm' ? (u.realm || '')
        : k === 'enable' ? (u.enable == 1 ? 0 : 1) : k === 'tfa' ? (u.tfa === true ? 0 : u.tfa === false ? 1 : 2)
        : k === 'expire' ? (u.expire || Infinity) : k === 'tokens' ? ((sec.tokens || []).filter(t => t.owner === u.userid).length) : 0;
      const th = (k, l) => _sortTh('secusers', k, l, "_secUserSort('" + k + "')", 'left', _thPad);
      const rows = _sortApply('secusers', users, key).map(u => {
        const tkn = (sec.tokens || []).filter(t => t.owner === u.userid).length;
        const tfaCell = !tfaKnown ? '<span style="color:' + DIM + '">—</span>'
          : u.tfa ? badge('2FA', GREEN) : badge('none', AMBER);
        const exp = !u.expire ? '<span style="color:' + DIM + '">never</span>'
          : (u.expire < now ? '<span style="color:' + RED + '">expired</span>' : new Date(u.expire * 1000).toLocaleDateString());
        return '<tr style="border-top:1px solid var(--c-border)">'
          + _td('<span style="font-weight:600">' + esc(u.userid) + '</span>' + (u.comment ? ' <span style="color:' + DIM + ';font-size:11px">' + esc(u.comment) + '</span>' : ''))
          + _td('<span style="color:var(--c-muted)">' + esc(u.realm) + '</span>')
          + _td(u.enable == 1 ? badge('enabled', GREEN) : badge('disabled', DIM))
          + _td(tfaCell)
          + _td(exp)
          + _td(tkn ? tkn : '<span style="color:' + DIM + '">—</span>', 'text-align:right');
      }).join('');
      html += card('<table style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr>'
        + th('userid', 'User') + th('realm', 'Realm') + th('enable', 'Status') + th('tfa', '2FA') + th('expire', 'Expires') + th('tokens', 'Tokens')
        + '</tr></thead><tbody>' + rows + '</tbody></table>');
      if (!tfaKnown) html += '<div style="font-size:11px;color:var(--c-dim);padding:8px 16px">2FA status needs a token with Sys.Audit on /access — shown as "—".</div>';
    } else {
      html += '<div class="hd-card p-4" style="font-size:12px;color:var(--c-muted)">User &amp; 2FA data needs a token with <b>Sys.Audit</b> on <code>/access</code>. Realms above are what the current token can see.</div>';
    }
    accEl.innerHTML = html;
    _show('sec-access-sec', true);
  } else _show('sec-access-sec', false);

  // ── API Tokens ────────────────────────────────────────────────────────────
  const tokEl = el('sec-tokens'), tokens = sec.tokens || [];
  if (tokEl && tokens.length) {
    const key = (t, k) => k === 'owner' ? (t.owner || '').toLowerCase() : k === 'tokenid' ? (t.tokenid || '')
      : k === 'privsep' ? (t.privsep == 0 ? 0 : 1) : k === 'expire' ? (t.expire || Infinity) : 0;
    const th = (k, l) => _sortTh('sectokens', k, l, "_secTokSort('" + k + "')", 'left', _thPad);
    const rows = _sortApply('sectokens', tokens, key).map(t => {
      const exp = !t.expire ? '<span style="color:' + DIM + '">never</span>'
        : (t.expire < now ? '<span style="color:' + RED + '">expired</span>' : new Date(t.expire * 1000).toLocaleDateString());
      return '<tr style="border-top:1px solid var(--c-border)">'
        + _td('<span style="color:var(--c-muted)">' + esc(t.owner) + '</span>')
        + _td('<span style="font-weight:600">' + esc(t.tokenid) + '</span>' + (t.comment ? ' <span style="color:' + DIM + ';font-size:11px">' + esc(t.comment) + '</span>' : ''))
        + _td(t.privsep == 0 ? badge('full privileges', AMBER) : badge('separated', GREEN))
        + _td(exp);
    }).join('');
    tokEl.innerHTML = card('<table style="width:100%;border-collapse:collapse;min-width:560px"><thead><tr>'
      + th('owner', 'Owner') + th('tokenid', 'Token') + th('privsep', 'Priv. separation') + th('expire', 'Expires')
      + '</tr></thead><tbody>' + rows + '</tbody></table>');
    _show('sec-tokens-sec', true);
  } else _show('sec-tokens-sec', false);

  // ── Firewall ────────────────────────────────────────────────────────────────
  const fwEl = el('sec-firewall'), fw = sec.firewall;
  if (fwEl && fw) {
    const on = fw.enable == 1;
    const pol = p => p ? (/DROP|REJECT/i.test(p) ? '<span style="color:' + GREEN + '">' + esc(p) + '</span>' : '<span style="color:' + AMBER + '">' + esc(p) + '</span>') : '<span style="color:' + DIM + '">—</span>';
    const kv = (k, v) => '<div style="display:flex;justify-content:space-between;gap:16px;font-size:12.5px;padding:5px 0"><span style="color:var(--c-muted)">' + k + '</span><span style="font-weight:500">' + v + '</span></div>';
    const perNode = (sec.nodes || []).filter(n => n.fw_enable != null);
    fwEl.innerHTML = '<div class="hd-card p-4">'
      + kv('Cluster firewall', on ? badge('enabled', GREEN) : badge('disabled', AMBER))
      + kv('Default inbound', pol(fw.policy_in))
      + kv('Default outbound', pol(fw.policy_out))
      + (fw.rules != null ? kv('Cluster rules', fw.rules) : '')
      + (perNode.length ? '<div style="border-top:1px solid var(--c-border);margin-top:8px;padding-top:8px">'
          + perNode.map(n => kv(esc(n.node), n.fw_enable == 1 ? badge('on', GREEN) : badge('off', AMBER))).join('') + '</div>' : '')
      + '</div>';
    _show('sec-firewall-sec', true);
  } else _show('sec-firewall-sec', false);

  // Certificates + per-node updates/repos intentionally live on the Health page
  // (Node Vitals) to avoid duplicating the same data across two pages.

  // ── Recent Logins ───────────────────────────────────────────────────────────
  // Proxmox doesn't expose an auth-login history API; the closest signal in the
  // task log is interactive access — console/shell/login sessions (vncshell,
  // vncproxy, spiceproxy, termproxy, login). Filter the task log to those.
  const auEl = el('sec-audit');
  const logins = tasks.filter(t => /^(login|vncshell|vncproxy|spiceproxy|termproxy)/i.test(t.type || ''));
  if (auEl && logins.length) {
    const key = (t, k) => k === 'start' ? (t.start || 0) : k === 'user' ? (t.user || '')
      : k === 'via' ? (typeof _taskLabel === 'function' ? _taskLabel(t).toLowerCase() : (t.type || ''))
      : k === 'node' ? (t.node || '') : k === 'status' ? (t.running ? 0 : t.failed ? 1 : 2) : 0;
    const th = (k, l) => _sortTh('secaudit', k, l, "_secAuditSort('" + k + "')", 'left', _thPad);
    const lbl = t => typeof _taskLabel === 'function' ? _taskLabel(t) : ((t.type || '') + (t.id ? ' ' + t.id : ''));
    // Always show the date + time (not time-only for today) — a login log needs
    // the day at a glance.
    const clock = t => { if (!t.start) return '—'; const d = new Date(t.start * 1000);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
    const rows = _sortApply('secaudit', logins, key).slice(0, 200).map(t => {
      const tag = t.running ? ['#3B82F6', 'ACTIVE'] : t.failed ? [RED, 'FAILED'] : [GREEN, 'OK'];
      return '<tr style="border-top:1px solid var(--c-border)">'
        + _td('<span style="color:var(--c-muted);font-variant-numeric:tabular-nums">' + clock(t) + '</span>')
        + _td('<span style="font-weight:500">' + esc(t.user || '—') + '</span>')
        + _td(esc(lbl(t)))
        + _td('<span style="color:var(--c-muted)">' + esc(t.node || '—') + '</span>')
        + _td('<span class="badge" style="background:' + tag[0] + '22;color:' + tag[0] + '">' + tag[1] + '</span>');
    }).join('');
    auEl.innerHTML = '<div class="hd-card" style="padding:0;overflow-x:auto"><div style="max-height:460px;overflow:auto">'
      + '<table style="width:100%;border-collapse:collapse;min-width:640px"><thead><tr>'
      + th('start', 'Time') + th('user', 'User') + th('via', 'Via') + th('node', 'Node') + th('status', 'Status')
      + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    _show('sec-audit-sec', true);
  } else _show('sec-audit-sec', false);
}
