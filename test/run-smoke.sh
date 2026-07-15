#!/usr/bin/env bash
# Minimal live-deploy smoke test. Runs from the repository and probes the app
# inside its LXC, so it needs no hard-coded dashboard address or browser harness.
set -euo pipefail

NODE="${HD_NODE:-}"
CT="${HD_CT:-}"
PORT="${HD_PORT:-}"

if [ -z "$NODE" ] || [ -z "$CT" ]; then
  echo "✗ Set HD_NODE and HD_CT before running the live smoke test" >&2
  exit 2
fi

# The packaged systemd unit binds port 80, while existing/manual installs may
# run uvicorn on another port (the development LXC uses 8090). Discover the
# active unit's port unless the operator explicitly supplied HD_PORT.
if [ -z "$PORT" ]; then
  PORT="$(ssh "$NODE" "pct exec $CT -- systemctl show proxdash -p ExecStart --value" \
    | sed -nE 's/.*--port ([0-9]+).*/\1/p' | head -1)"
fi
PORT="${PORT:-80}"
case "$PORT" in
  *[!0-9]*|'') echo "✗ Invalid ProxDash smoke-test port: $PORT" >&2; exit 2 ;;
esac

for attempt in $(seq 1 40); do
  if ssh "$NODE" "pct exec $CT -- env PROXDASH_SMOKE_PORT=$PORT python3 -" <<'PY'
import os
import sys
import urllib.request

base = f"http://127.0.0.1:{os.environ['PROXDASH_SMOKE_PORT']}"
checks = (
    (f"{base}/auth/login", b"ProxDash"),
    (f"{base}/static/app.js", b"window.__BUILD__"),
    (f"{base}/api/logo?theme=dark", None),
)
for url, marker in checks:
    with urllib.request.urlopen(url, timeout=4) as response:
        body = response.read()
        if response.status != 200 or not body or (marker and marker not in body):
            raise SystemExit(f"bad response from {url}: HTTP {response.status}, {len(body)} bytes")
print("live HTTP probes passed")
PY
  then
    echo "✓ live smoke passed on CT $CT"
    exit 0
  fi
  [ "$attempt" -lt 40 ] && sleep 1
done

echo "✗ live smoke failed after 40 attempts on CT $CT at $NODE" >&2
exit 1
