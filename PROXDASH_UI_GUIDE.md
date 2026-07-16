# ProxDash UI Guide — the ProxDash design system (as implemented)

The practical reference for building ProxDash UI. This documents the design system
**as it actually exists in the code** (`static/index.html` `<style>` + `src/*.js` →
`static/app.js`), not an idealized spec — every token, class, and helper below is real
and in use. ProxDash forked from HomeDash and keeps its component grammar, but it has
its **own identity**: Proxmox orange, the PROXDASH wordmark, and a Proxmox-only scope.
Match what is documented here — not HomeDash, not Tracearr.

ProxDash is **vanilla HTML + CSS + JS** — no React, no build step beyond `./build.sh`
concatenating `src/[0-9]*.js` into `static/app.js`. An SPA shell (`index.html`)
lazy-loads page fragments (`static/pages/*.html`). The look: a clean, data-dense
Proxmox dashboard — near-black in dark mode, dark cards defined by 1px borders, one
orange accent, Inter body text.

> **Golden rules**
> 1. Never hard-code a color. Reference a `--c-*` token so light/dark and the runtime
>    accent both work automatically.
> 2. For translucent accent, use `rgba(var(--c-accent-rgb), α)`. Where a literal is
>    unavoidable (Chart.js dataset colors, SVG `stroke` attributes), **resolve the
>    accent at render time** — `getComputedStyle(document.documentElement)
>    .getPropertyValue('--c-accent')` (see `_gAccentHex()` in `70-topology.js` and the
>    `ACCENT`/`ACCENT_RGB` pattern in `65-time-range.js`). A literal `#E57000` breaks
>    the Settings accent picker; a literal HomeDash cyan is a fork leftover — hunt it.
> 3. Use the existing classes (`.hd-card`, `.sec-hdr`, `.page-hdr`, `.badge`, pills,
>    `_statTile`) before inventing new ones.
> 4. No ALL-CAPS widget headers (tiny uppercase micro-labels like `.stor-hdr-label`
>    are the exception). Sentence case, weight 600+.
> 5. **Everything must render for any Proxmox environment.** Pages are built from the
>    generic Proxmox/Ceph/PBS APIs only — no assumption about node names, storage
>    types, or counts. If a widget only makes sense for one specific homelab, it
>    belongs in HomeDash, not here.

---

## 1. Brand

| Element | Value |
|---|---|
| Product name | **PROXDASH** (all caps) — config `title` overrides it everywhere |
| Wordmark font | **Exo 2** 600 (vendored: `static/vendor/fonts/exo2-600-latin.woff2`, OFL) — applied via `#nav-title, .brand-wordmark` ONLY. Body text stays Inter. |
| Default accent | Proxmox orange `#E57000` = `rgb(229,112,0)` (same in light and dark) |
| Logo | `<img data-logo src="/api/logo?theme=dark|light">` — serves the per-theme uploaded logo (Settings → Appearance), falling back to the bundled marks `static/proxdash.svg` (light) / `static/proxdash-dark.svg` (dark). `applyLogo()` re-points every `img[data-logo]` + favicon; re-applied on theme toggle and DOMContentLoaded. `/favicon.ico`/`.svg` route to the same art. |
| Accent picker | Settings → Appearance writes `proxdash-accent` (localStorage) and injects `:root{--c-accent…}` overrides at boot — the reason rule #2 exists. |

## 2. Design Tokens

Light values on `:root`, dark on `html.dark` (dark is the default; boot script adds
`.dark` unless `hd-dark==='0'`).

```css
:root {
  --c-bg:#FFFFFF; --c-panel:#FAFAFA; --c-card:#F4F4F6; --c-border:#E4E4E7;
  --c-text:#09090B; --c-muted:#71717A; --c-dim:#A1A1AA;
  --c-accent:#E57000; --c-accent-rgb:229,112,0;
  --c-accent-contrast:#FFFFFF;      /* ink that sits ON the accent */
  --c-nav-active-text:#1A1206;      /* ink on the solid-orange active nav pill */
  --c-hover:#F4F4F5; --c-bar-bg:#E4E4E7;
  --c-shadow:0 1px 3px rgba(0,0,0,.05);
  --c-shadow-hover:0 2px 12px -5px rgba(var(--c-accent-rgb),.17),
                   0 0 6px -3px rgba(var(--c-accent-rgb),.10);
  --ease-out:cubic-bezier(.22,1,.36,1);   /* entrances, hovers */
  --ease-std:cubic-bezier(.4,0,.2,1);     /* on-screen moves */
  --ease-drawer:cubic-bezier(.32,.72,0,1);/* drawers */
}
html.dark {
  --c-bg:#000000; --c-panel:#18181B; --c-card:#0A0A0C; --c-border:#27272A;
  --c-text:#FAFAFA; --c-muted:#A1A1AA; --c-dim:#71717A;
  --c-accent:#E57000; --c-accent-rgb:229,112,0;
  --c-hover:#27272A; --c-bar-bg:#27272A;
}
```

Roles are inherited from HomeDash: `--c-bg` page, `--c-panel` raised surfaces
(sidebar), `--c-card` card fill (near-bg in dark — cards are defined by **border**),
three text tiers (`--c-text`/`--c-muted`/`--c-dim`), `--c-hover` neutral fills and
pill tracks, `--c-bar-bg` bar tracks.

**The recession rule for tracks/wells:** a recessed element (bar track, gauge
track, input well) is painted one surface step DOWN from what it sits on. On
`--c-card` that's `--c-bar-bg` (the default). On a `--c-hover` surface —
`.stor-cell` tiles etc. — `--c-bar-bg` is the SAME color as the surface in
dark theme and vanishes; use `--c-bg` there (`_donut(..., { track:
'var(--c-bg)' })`). Never hardcode black/white — the token recesses correctly
in both themes.

### Status colors (semantic, not themable)

- Up / running / read: `#22C55E` (dark text `#4ADE80`)
- Down / error: `#EF4444` (text `#DC2626` / dark `#F87171`)
- Warn / filling: `#F59E0B` (text `#D97706` / dark `#FBBF24`)
- Neutral / stopped: `#6B7280` · Nodes tier in graphs: `#F59E0B` · VM `#06b6d4` · LXC `#10b981` · Cluster `#8b5cf6`

### Chart series palette

Multi-series charts assign, in fixed order: runtime accent, `#22C55E`, `#F59E0B`,
`#EF4444`, `#A78BFA`, `#F472B6` — the same entity keeps its color across re-renders.

## 3. Typography

Inter, 14px/1.5, antialiased; metrics use `tabular-nums`. The tiers (never
free-style a heading):

| Tier | Class | Size/weight |
|---|---|---|
| Brand wordmark | `#nav-title` / `.brand-wordmark` | 16/600 Exo 2 |
| Page H1 | `.page-hdr-title` | 18/600 |
| Page sub | `.page-hdr-sub` | 13/400 muted |
| Section | `.sec-hdr-title` | 14/600 |
| Subsection | `.sub-hdr-title` | 13/600 |
| Micro-label | `.stor-hdr-label` | 11/600 uppercase (chart-column labels inside cards) |

## 4. Layout & Pages

Fixed collapsible sidebar (`--c-panel`, orange active pill with
`--c-nav-active-text` ink) + one `.page` at a time. Page rhythm: `.page-hdr` (title,
sub, optional `.page-hdr-meta` strip) then sections ~24px apart (`space-y-6`).
Topology is the one full-bleed page (no padding, inner pan/zoom canvas).

Pages: `overview · proxmox(Compute) · storage · network · backups · topology ·
health · tools · tars(Assistant) · settings` — registered in `PAGES`/`PAGE_LABELS`/
`PAGE_SLUGS` (`10-router.js`) with a `_deferInit` hook for first paint from the
cached snapshot.

## 5. Component Patterns

Inherited from HomeDash unchanged — see the markup in `index.html`:

- **Cards** `.hd-card` (+ `.card-hover`, `.card-hover-border`) — radius 8, 1px
  border, accent-tinted hover shadow; hover = scale(1.02), active dip .98.
- **Page/Section/Sub headers** `.page-hdr`, `.sec-hdr` (18px accent icon; controls in
  `.sec-hdr-actions` inherit color — don't tint them), `.sub-hdr` (muted icon).
- **Badges** `.badge` + `-up/-down/-warn/-info/-neutral` — 10/600 pills.
- **Bars** `.bar > .bar-fill` + `bar-green/yellow/red` by threshold, accent default.
- **Pill toggles** `.hist-range` + sliding `.hist-thumb` + `.hist-btn` — THE
  segmented control (time ranges, tabs, toggles). Single chips use
  `.chart-range-toggle`. Never hand-roll a bare button group.
- **Status dots** `.sdot-*`, `.dot-live` pulse.
- **Icons** inline Lucide-style SVG, `stroke="currentColor"`, width 2, round caps.
  18px accent in `.sec-hdr`, 12–14px muted in `.sub-hdr`, 14px inherit in actions.

### ProxDash-specific patterns

**Stat-tile summary row** — every data page opens with ONE `.hd-card p-3` holding a
single row of `_statTile(value, label, color?)` cells (dark `--c-bg` tiles, centered
value over muted label), laid out `display:grid;grid-template-columns:repeat(4,
minmax(0,1fr))`. Keep it to ~4 tiles; merge related numbers (`↓ 5.6 MB/s ↑ 2.0 MB/s`
is one Throughput tile). Note: the Tailwind sheet is purged — `grid-cols-4` does NOT
exist; use the inline grid style.

**Master–detail inspector (Storage page)** — when a page would otherwise stack N
near-identical device cards, collapse them into ONE widget: a left `.stor-rail`
(one compact row per entity: status dot · name · used-% · slim bar · muted meta —
the rail IS the page's at-a-glance summary) + a `.stor-detail` pane holding the
full device-card anatomy for the selected entity (`_storRailHtml` /
`_storDetailShell` / `storSelect` in `23-storage.js`; selection persisted in
localStorage). The rail collapses to a horizontal strip under 900px. Companion
sections on that page: **Space Hogs** (squarified treemap `_squarify` /
`_storHogsRender` — area = bytes, stores as labelled regions, tiles click-select
the store) and **Drive Health** (`_storDriveHealthRender` — physical drive bays
grouped by node, SSD wear as a "life tank" fill, Ceph OSDs merged in with temp
and up/in state).

**The device-card anatomy (the "Ceph card" pattern)** — any major entity that earns
its own full-width deep-dive (the Storage inspector's detail pane; use it for future
per-entity deep-dives) clones this structure exactly (`_storDetailShell` / `renderCeph`
in `23-storage.js`). The cardinal rule: the two charts must show DIFFERENT things
(activity vs capacity) and the cells must carry real inventory — never clone the
skeleton with duplicated or empty data:

```
.hd-card p-4
├─ .stor-card-hdr  — 14px icon · name (flex:1, 13px/500) with muted `· meta · meta`
│                    inline · _storPillRow(prefix) (Predictions chip + 7d/30d/1y/All/
│                    Custom pills) · status .badge
├─ columns grid (1fr/2fr) — each column starts with a .stor-hdr:
│    LEFT  "Throughput" — activity chart (_renderThroughputChart, Read/Write
│          .stor-legend); when an entity has no activity by definition, a quiet
│          muted note replaces the canvas — never a blank chart
│    RIGHT "Storage" — capacity forecast (_renderStorageForecastChart,
│          .stor-conf-pill + Historical/Prediction legend), 200px canvases
└─ bottom row (.stor-dev-bot — like Ceph's POOLS|OSDS) — each column:
     14px icon + uppercase micro-label + muted count, then clickable .stor-cell
     tiles (auto-fill grids) opening the entity drawer. Storage uses
     CONTENT (inventory classes) | DRIVES (ZFS/LVM physical disks) | NODES
     (full per-node cells for local stores; compact AVAILABILITY chips for
     shared — the grid collapses to whichever columns have data)
```

Cards rebuild their **shell** only on structural change (a signature of names/nodes/
status); live ticks rewrite only value slots by id, so canvases and pill state
survive. Per-card pills get their own prefix (`pxstor-<slug>`), dispatched in
`_histLoad` and `togglePredictions` by prefix match.

**Tiered graph engine** (`70-topology.js`) — the pan/zoom node-edge graph behind the
Topology tabs (Compute/Storage/Network). Cards are `_gCard` models `{id,label,sub,
stat,accent,dot,icon,badge,click}`; edges `{source,target,color,label,dash,hidden}`
(`hidden` edges skip drawing but keep hover-highlight). Edge and card accents are
hex — resolve the runtime accent with `_gAccentHex()`, never a literal. Two layout
views (`_gLayout`, persisted, user-toggled like orientation): **Grouped** (default —
children nest in a bounded wrapped grid under their parent via a `{groups:[{parent,
children}]}` tier, so 30 guests never make a 6,000px canvas) and **Tiered** (flat
rows). Search box + layout + orientation controls are persistent chrome; the body
repaints only on structural signature change.

## 6. Charts

Chart.js v4, vendored. Everything goes through the shared factory so charts look
identical:

- `_makeChart(id, datasets, yFmt, hrs, opts)` — gradient fills (`_chartGradient`),
  external tooltip, `.hd-legend` (auto; `legendTarget` puts it in a header slot,
  `noLegend` for single-series), shared x-axis, now-line plugin.
- **Band+avg treatment** for multi-node history: `_dsBandHidden(label, bucketed,
  color)` + `_dsAvgOnly(...)` per series (see `loadPxHistory`, `loadPxNetHistory`).
- **Forecast charts** — `_renderStorageForecastChart(id, label, labels, usedGB,
  totalGB, hrs, {prefix, confPillId})`: accent historical line + accent gradient
  area, dashed prediction with diamond markers, confidence band and pill. Line and
  shading BOTH derive from the runtime accent — if the area under a line is a
  different hue than the line, that's a bug (it reads as a misaligned second series).
- **Intro** — the left-to-right reveal sweep (`_revealChart`/`_maybeReveal`, 1100ms,
  respects `prefers-reduced-motion`). Not fade, not baseline-rise.
- Rate formatting `fmtBytes(v)+'/s'`; percent charts pin `yMin:0, yMax:100`.
- **Compute page Cluster scope** — `#px-scope-hist-range` is rendered dynamically
  (`_pxScopeRenderButtons()` in `src/26-compute.js`): "All" + one button per live
  node, never hardcoded (portability rule). "All" plots every node's line
  (`loadPxHistory`); picking a single node calls `_loadPxNodeDrilldown`
  (`src/65-time-range.js`), which plots that node's own line (accent colour) plus
  its guests' (VMs + LXCs) top-CPU-consumer lines in the same CPU/RAM chart pair —
  so a node's spike is traceable to the guest driving it. The filter box doubles
  as a node-name filter under "All" and a guest-name filter once a node is picked.
  Guest history (`entity_stats`/`guest_net_stats` in `main.py`) shares the nodes'
  tiered retention — 30 days full resolution, then compacted to hourly and kept
  400 days — so this drilldown and the Network composition chart both have real
  runway at 30d/All, not just the last 7 days.

## 7. Animation & Interaction

Same system as HomeDash: stagger `fade-in` intros (~35ms step), `scale-in`/
`slide-in-right` drawers, `pulse-live` dots, `:active` dip on every pressable,
`fill-mode:backwards` on entrances (never `both`), hover lifts neutralized on touch
via the shared `@media (hover:none)` block, tokenized easings, never
`transition:all`. Dark mode = `.dark` on `<html>`, persisted (`hd-dark`).

**Sidebar nav-icon motion** (`.nav-icon-run`, per-icon `@keyframes nav-*` in
`static/index.html`) plays on click only — an actual inactive → active nav
transition fired from `src/10-router.js`'s `_activatePages` (covers mouse click,
Enter/Space, and touch tap uniformly, since it triggers on the resulting page
change, not the input event). It does **not** play on hover, touch-down, or
keyboard focus alone — those fire far too often for a sidebar item to justify
replaying an animation each time (see the Animation Decision Framework: tens-of-
times-a-day interactions get reduced/no motion). Re-clicking an already-active
item does not replay it either, guarded by the `wasActive` check in `_activatePages`.
`_navIconPlay` (in `src/60-app-core.js`) throttles rapid re-fires and respects
`prefers-reduced-motion`.

## 8. Quick Reference

| Thing | Value |
|---|---|
| Accent | `#E57000` default, runtime-themable — literals only via computed-style reads |
| Wordmark | PROXDASH, Exo 2 600, `#nav-title`/`.brand-wordmark` only |
| Logo | `/api/logo?theme=light|dark` (uploads in Settings; bundled marks fall back) |
| Summary row | `.hd-card p-3` + `_statTile`×4, inline `repeat(4,minmax(0,1fr))` grid |
| Device card | Ceph-card anatomy — `.stor-card-hdr` + `_storPillRow` + `.stor-hdr` columns + `.stor-cell` grid |
| Card | `.hd-card` — radius 8, 1px `--c-border`, `--c-shadow` |
| Pill toggle | `.hist-range`/`.hist-thumb`/`.hist-btn`; per-card prefixes dispatch by `prefix.indexOf(...)===0` |
| Chart factory | `_makeChart` · bands `_dsBandHidden`+`_dsAvgOnly` · forecast `_renderStorageForecastChart` |
| Graph accent | `_gAccentHex()` (SVG attrs can't resolve `var()`) |
| Titles | page 18/600 · section 14/600 (accent icon) · sub 13/600 (muted icon) · micro `.stor-hdr-label` |
| Base font | Inter 14/1.5 · `tabular-nums` for metrics |
| Section gap | 24px (`space-y-6`) · grid gap 12px (`gap-3`) |
