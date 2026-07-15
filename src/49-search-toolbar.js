// ── Shared search/filter toolbar — the single source of toolbar markup ───────
// Activity (src/42-activity.js) and Compute (src/26-compute.js + proxmox.html)
// both build their filter toolbar from THESE functions, so the two cannot
// visually diverge: every piece — search field, dropdown button, menu panel,
// menu item, chip — comes from one place. Page-specific bits (icons, handlers,
// which filters exist, open/close state) are passed in; all markup lives here.
//
//   _searchToolbar({ leading, search, controls, chips, clearAll, chipsId })
//     leading   HTML for the leading segmented pills (period / status), or ''
//     search    { id, placeholder, value, oninput, onclear } — handlers are JS exprs
//     controls  HTML for the dropdown buttons + menus (built with _stBtn/_stMenu)
//     chips     HTML of active-filter chips (built with _stChip), or '' / null
//     clearAll  JS expr for the "Clear all" button (only shown when chips present)
//     chipsId   if set (and no chips passed), emit an empty <div id> for live updates

const _ST_SEARCH_ICO = '<svg class="hd-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
const _ST_X14  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const _ST_X13  = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const _ST_CHEV = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const _ST_CHECK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

function _stSearch(o) {
  return '<div class="hd-search-wrap" style="max-width:400px;min-width:200px;flex:1">'
    + _ST_SEARCH_ICO
    + '<input id="' + o.id + '" class="hd-search" type="text" placeholder="' + esc(o.placeholder || '') + '" value="' + String(o.value || '').replace(/"/g, '&quot;') + '" oninput="' + o.oninput + '">'
    + '<button class="hd-search-clear" onclick="' + o.onclear + '">' + _ST_X14 + '</button>'
    + '</div>';
}
// Dropdown trigger button. o.icon = svg HTML; o.badge = count (falsy → hidden).
function _stBtn(o) {
  return '<button type="button"' + (o.id ? ' id="' + o.id + '"' : '') + ' onclick="' + o.onclick + '" class="hd-tbtn">'
    + (o.icon || '') + esc(o.label)
    + (o.badge ? '<span class="hd-tbtn-badge"' + (o.badgeId ? ' id="' + o.badgeId + '"' : '') + '>' + o.badge + '</span>' : '')
    + '<span class="hd-tbtn-chev">' + _ST_CHEV + '</span>'
    + '</button>';
}
// Dropdown = trigger button + (when open) its menu, in a positioned wrapper.
// `data-hd-menu` marks "inside a dropdown" for the shared outside-click close.
// o = _stBtn opts + { open: bool, menu: html }.
function _stDropdown(o) {
  return '<div class="hd-menuwrap" data-hd-menu style="position:relative">' + _stBtn(o) + (o.open ? o.menu : '') + '</div>';
}
// Menu panel. width = px (optional). body = sections/items HTML.
function _stMenu(width, body) {
  return '<div class="hd-menu"' + (width ? ' style="width:' + width + 'px"' : '') + '>' + body + '</div>';
}
function _stMenuHdr(label) { return '<div class="hd-menu-hdr">' + label + '</div>'; }
function _stMenuSep() { return '<div style="height:1px;background:var(--c-border);margin:6px 0"></div>'; }
// Multi-select item — left checkbox (fills accent when checked).
function _stCheckItem(label, checked, onclick) {
  return '<button onclick="' + onclick + '" class="hd-menu-item">'
    + '<span style="width:14px;height:14px;border-radius:3px;border:1px solid var(--c-border);background:' + (checked ? 'var(--c-accent)' : 'transparent') + ';color:var(--c-accent-contrast);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">' + (checked ? _ST_CHECK : '') + '</span>'
    + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(label) + '</span></button>';
}
// Single-select item — right checkmark (shown via .sel toggled by the page).
function _stRadioItem(label, dataV, onclick) {
  return '<button class="hd-menu-item" data-v="' + esc(dataV) + '" onclick="' + onclick + '">' + esc(label)
    + '<svg class="ck" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></button>';
}
// Muted "clear" item with a leading ✕.
function _stClearItem(label, onclick) {
  return '<button onclick="' + onclick + '" class="hd-menu-item" style="color:var(--c-muted);font-size:12px">' + _ST_X13 + ' ' + esc(label) + '</button>';
}
// Active-filter chip. value already collapsed ("N selected") by the caller.
function _stChip(label, value, remove) {
  return '<span class="hd-chip"><span style="color:var(--c-muted)">' + esc(label) + ':</span>'
    + '<span style="font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(value) + '</span>'
    + '<button onclick="' + remove + '" style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:none;background:transparent;color:var(--c-muted);cursor:pointer;border-radius:9999px" onmouseover="this.style.background=\'var(--c-border)\'" onmouseout="this.style.background=\'transparent\'">' + _ST_X14 + '</button></span>';
}
function _searchToolbar(cfg) {
  const hasChips = !!(cfg.chips && cfg.chips.length);
  return '<div class="hd-toolbar">'
    + '<div class="hd-toolbar-row">' + (cfg.leading || '') + _stSearch(cfg.search) + (cfg.controls || '') + '</div>'
    + (hasChips
        ? '<div class="hd-chips"' + (cfg.chipsId ? ' id="' + cfg.chipsId + '"' : '') + '>' + cfg.chips
          + (cfg.clearAll ? '<button onclick="' + cfg.clearAll + '" style="font-size:12px;color:var(--c-muted);background:none;border:none;cursor:pointer;padding:4px 8px;font-family:inherit">Clear all</button>' : '')
          + '</div>'
        : (cfg.chipsId ? '<div id="' + cfg.chipsId + '" class="hd-chips" style="display:none"></div>' : ''))
    + '</div>';
}
