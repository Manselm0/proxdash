#!/usr/bin/env bash
# Build static/app.js by concatenating the src/ modules in numeric-prefix order.
#
# The frontend is still a single classic <script src="app.js"> with one global
# scope — there is NO module system. src/ is purely an organizational split so we
# edit ~200-1600 line domain files instead of one 11k-line file; this script
# stitches them back into the byte-equivalent bundle the shell loads.
#
#   edit src/*.js  ->  ./build.sh  ->  git commit (both src/ and static/app.js)
#
# Ordering matters: function declarations hoist within the combined file, but
# top-level const/let do not — keep shared state/consts in 01-globals.js and the
# boot/init sequence last. deploy.sh re-runs this and refuses to ship if the
# committed bundle is stale.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

# ── Portability gate ─────────────────────────────────────────────────────────
# ProxDash must deploy to ANY Proxmox environment — nothing site-specific ships.
# Fail the build if development-environment names or concrete LAN IPs leak into
# the shipped sources (config placeholders use the 192.168.1.X form on purpose).
GATE_FILES=(src static/index.html static/pages main.py config.yaml.example README.md)
BAD_NAMES=$(grep -rniE 'manselmo|clearfuze|clearspark|millamoretti|HAL9000|DaveBowman|DiscoveryOne|PodBayDrives|HALnet' "${GATE_FILES[@]}" 2>/dev/null || true)
# Catch concrete RFC1918 addresses. Documentation placeholders ending in `.X`
# intentionally do not match because the final octet must be numeric.
BAD_IPS=$(grep -rnE '(^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)' "${GATE_FILES[@]}" 2>/dev/null || true)
# Non-Proxmox service names — ProxDash is Proxmox-only, so no HomeDash media/home/
# power integrations may leak into shipped sources, FRONTEND OR BACKEND. Both were
# fully de-HomeDashed in the 2026-07-12 dead-code removal (11 frontend modules +
# main.py dead constants/tables/comments). `cloudflare` is intentionally NOT
# banned: it's the legit LibreSpeed/speedtest provider on the Tools page.
# `tracearr` is NOT banned: it's a design attribution in comments (the FOSS
# dashboard ProxDash's visuals reference), not a leak.
SVC_FILES=(src static/index.html static/pages config.yaml.example main.py README.md)
# Treat underscore as punctuation so stale identifiers such as `_service_cache`
# are caught too. grep -w misses those because underscore is a "word" byte.
BAD_SERVICES=$(grep -rniE '(^|[^[:alnum:]])(plex|sonos|simplisafe|tesla|qbittorrent|slskd|soulseek|pihole|sabnzbd|overseerr|tautulli|jellyfin|wallconnector)([^[:alnum:]]|$)' "${SVC_FILES[@]}" 2>/dev/null || true)
if [ -n "$BAD_NAMES$BAD_IPS$BAD_SERVICES" ]; then
  echo "✗ portability gate: site-specific / non-Proxmox values found in shipped sources —" >&2
  echo "  ProxDash must work on any Proxmox cluster and stay Proxmox-only. Offending lines:" >&2
  [ -n "$BAD_NAMES" ] && echo "$BAD_NAMES" >&2
  [ -n "$BAD_IPS" ] && echo "$BAD_IPS" >&2
  [ -n "$BAD_SERVICES" ] && echo "$BAD_SERVICES" >&2
  exit 1
fi

if [ "${1:-}" = "--check" ]; then
  echo "✓ portability gate passed"
  exit 0
fi

mods=$(ls src/[0-9]*.js | sort)
[ -n "$mods" ] || { echo "✗ no src/[0-9]*.js modules found" >&2; exit 1; }
cat $mods > static/app.js

# Build version: a content hash of every source input (modules + page fragments
# + the shell). Any change bumps it. Written to static/version.txt AND stamped
# into the bundle as window.__BUILD__, so the running app can compare the two and
# auto-reload once when a deploy makes them diverge (see _checkBuildVersion). The
# hash excludes app.js itself (which we stamp) and version.txt, so it stays
# deterministic — deploy.sh re-runs this and a non-deterministic build would trip
# its dirty-tree guard.
VER=$(cat $mods static/pages/*.html static/index.html | sha256sum | cut -c1-12)
printf '%s' "$VER" > static/version.txt
printf '\n;window.__BUILD__=%s;\n' "'$VER'" >> static/app.js
echo "✓ built static/app.js — $(wc -l < static/app.js) lines from $(echo "$mods" | wc -l) modules (build $VER)"
