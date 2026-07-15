# ProxDash

The real-time Proxmox dashboard — FastAPI + WebSockets backend, no-build vanilla-JS
frontend. Public-facing fork of the private HomeDash, scoped to **Proxmox only**
(cluster, guests, storage, Ceph, PBS, network, health, tools, AI assistant).

**THE PORTABILITY RULE (owner directive, non-negotiable): everything in ProxDash
must be deployable to any Proxmox instance — nothing custom to the development
homelab.** Concretely: only standard Proxmox/Ceph/PBS APIs; no assumptions about
node names, storage types/counts, network subnets, or installed services; every
integration is config-driven and degrades gracefully when absent or under-permissioned
(fault-isolate fetchers, hide empty columns, never error a page). `./build.sh`
enforces a **portability gate** that fails the build if dev-environment names or
concrete LAN IPs appear in shipped sources — config placeholders use the
`192.168.1.X` form on purpose. Extend the gate's pattern list when new
site-specific tokens become possible.

## Build & test

- **Frontend build:** edit `src/[0-9]*.js` → `./build.sh` → `static/app.js`
  (concatenation, no bundler; commit both). Page fragments: `static/pages/*.html`;
  shell + all CSS: `static/index.html`.
- **Backend:** `main.py` (FastAPI, WS snapshot loop, history APIs, SQLite stats).
- **Local test instance:** run uvicorn with `HOMEDASH_DATA=<data dir>` pointing at a
  scratch dir holding `config.yaml` (see `config.yaml.example`); auth can be
  disabled with `auth: {enabled: false}` for headless testing.
- **Browser verification:** Playwright harness lives in `/root/hdtest` on monolith
  (run scripts from that directory — `playwright` resolves from its node_modules).

## UI

**Read `PROXDASH_UI_GUIDE.md` before touching any UI** — it is the design system as
implemented (tokens, components, chart factory, the stat-tile summary row, the
Ceph-card device anatomy, the tiered graph engine). Cardinal rules: never hard-code
a color (runtime-themable accent; resolve computed `--c-accent` where literals are
unavoidable), reuse the existing classes/helpers, keep every page generic for any
Proxmox environment. HomeDash-cyan (`#19D1E7`) anywhere is a fork leftover — remove
it on sight.

## Portability status (audited 2026-07-12)

The **reachable app is portable**: no hardcoded IPs/hostnames in the live path,
`config.yaml.example` is all `192.168.1.X` / `YOUR_*` placeholders, the backend
fetchers use only generic Proxmox/PBS APIs (the one LAN-specific bit is a
subnet-*ranking* heuristic in `_pbs_base`/network sort — 192.168 > 10 > 172 —
which is environment-agnostic, not a hardcode), and the build gate passes.

**Frontend dead-HomeDash removal — DONE (2026-07-12).** The 11 unreachable
HomeDash modules were removed (`24-home, 30-power, 32-power-render, 40-media,
41-library, 42-activity, 43-activity-drawer, 44-downloads, 48-network,
52-cameras, 66-map`); shared helpers relocated (`_sdRow`/`_sdSection`/`_laIcons`
→ `31-detail-drawers.js`, `_statTile` → `01-globals.js`); dead dispatch branches
pruned from `65-time-range.js`/`60-app-core.js`/`10-router.js` (via call-graph
reachability); orphan shell markup removed from `index.html` (stream/pdu/media
drawer overlays, pdu-confirm, camera fullscreen overlay). Bundle **13,218 →
8,066 lines (−39%)**. The build gate now bans `plex|sonos|simplisafe|tesla|
qbittorrent|slskd|soulseek|pihole|sabnzbd|overseerr|tautulli|jellyfin|
wallconnector` across the shipped **frontend** (`src static/index.html
static/pages config.yaml.example`). `cloudflare` (Tools speedtest provider) and
`tracearr` (design attribution in comments) are intentionally NOT banned. All 10
pages + every drawer verified post-removal.

**Backend dead-HomeDash removal — DONE (2026-07-12, #78b).** Audit found there
were NO dead fetcher *functions* left (a prior scrub removed them) — only
residue: 17 unused module constants (`_tautulli_*`, `_ff_auth`, `_unifi_*`,
`_protect_*`, geocode), 18 never-written DB tables (download/network/synology/
library/stream/overseerr/power/outlet/wallconnector/livetv/pihole/cloudflare/
caddy_access/ip_geo/kv_meta/docker + their CREATE/INDEX/migration/prune refs),
and orphan service comment dividers. All verified zero-reference before removal;
**no @app routes were removed** (route set diffed identical to the backup). The
assistant tool/prompt was scrubbed (`get_status`, Proxmox-only sections).
main.py 4,326 → 3,817 lines. The build gate's service-name check now covers
`main.py` too (`SVC_FILES` includes it), and the **entire shipped codebase
(frontend + backend) is free of banned service names**. Combined with the
frontend pass: bundle 13,218 → 8,047 lines (−39%).

## Repo status

Fresh history planned for the public launch — do not commit/publish without the
owner's go-ahead (see the ProxDash plan: keep `Manselm0/homedash` private/canonical;
this repo becomes the public `ProxDash` with scrubbed content, AGPL-3.0).
