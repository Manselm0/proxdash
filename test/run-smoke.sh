#!/usr/bin/env bash
# Minimal live-deploy smoke test. Runs from the repository and probes the app
# inside its LXC, so it needs no hard-coded dashboard address or browser harness.
set -euo pipefail

NODE="${HD_NODE:-}"
CT="${HD_CT:-}"

if [ -z "$NODE" ] || [ -z "$CT" ]; then
  echo "✗ Set HD_NODE and HD_CT before running the live smoke test" >&2
  exit 2
fi

for attempt in $(seq 1 40); do
  if ssh "$NODE" "pct exec $CT -- python3 -" <<'PY'
import sys
import urllib.request

checks = (
    ("http://127.0.0.1/auth/login", b"ProxDash"),
    ("http://127.0.0.1/static/app.js", b"window.__BUILD__"),
    ("http://127.0.0.1/api/logo?theme=dark", None),
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
