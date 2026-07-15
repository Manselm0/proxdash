#!/usr/bin/env bash
# Deploy ProxDash to the live container from the COMMITTED git state.
#
#   edit  ->  git commit  ->  ./deploy.sh
#
# Ships only tracked files (git archive respects .gitignore, so config.yaml,
# sessions.json and *.db are never pushed). Refuses to deploy a dirty tree so the
# live container always corresponds to a real commit. Backend or dependency
# changes restart the service; dependency changes update the existing venv first.
#
# Override the target with env vars if it ever moves:  HD_NODE, HD_CT.
set -euo pipefail

NODE="${HD_NODE:-}"
CT="${HD_CT:-}"
DEST=/opt/proxdash
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SRC"

if [ -z "$NODE" ] || [ -z "$CT" ]; then
  echo "✗ Set HD_NODE and HD_CT for the target Proxmox host and LXC" >&2
  exit 2
fi

# static/app.js is built from src/ — rebuild it so the dirty-tree check below
# catches a commit where src/ changed but the bundle wasn't regenerated.
[ -x ./build.sh ] && ./build.sh >/dev/null
python3 test/static_checks.py

if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Working tree is dirty — commit (or stash) before deploying so the" >&2
  echo "  live container matches a real commit:" >&2
  git status -s >&2
  exit 1
fi

REV="$(git rev-parse --short HEAD)"
echo "→ Deploying ${REV} to CT ${CT} on ${NODE}"

# Compare backend and dependency inputs with the live install. A requirements
# change must install before restart; merely copying requirements.txt leaves the
# running environment stale.
NEW_MAIN="$(git show HEAD:main.py | sha1sum | cut -d' ' -f1)"
LIVE_MAIN="$(ssh "$NODE" "pct exec $CT -- sha1sum $DEST/main.py 2>/dev/null | cut -d' ' -f1" || true)"
NEW_REQ="$(git show HEAD:requirements.txt | sha1sum | cut -d' ' -f1)"
LIVE_REQ="$(ssh "$NODE" "pct exec $CT -- sha1sum $DEST/requirements.txt 2>/dev/null | cut -d' ' -f1" || true)"
NEEDS_RESTART=0
[ "$NEW_MAIN" != "$LIVE_MAIN" ] && NEEDS_RESTART=1
NEEDS_DEPS=0
if [ "$NEW_REQ" != "$LIVE_REQ" ]; then
  NEEDS_DEPS=1
  NEEDS_RESTART=1
fi

# Tracked source only — git archive excludes untracked/ignored files, so the
# container's config.yaml / sessions.json / stats.db / static/assets are untouched.
TAR="$(mktemp /tmp/hd-deploy.XXXXXX.tar)"
trap 'rm -f "$TAR"' EXIT
git archive --format=tar HEAD \
  main.py requirements.txt config.yaml.example README.md static src build.sh test > "$TAR"

scp -q "$TAR" "$NODE:/tmp/hd-deploy.tar"
ssh "$NODE" "pct push $CT /tmp/hd-deploy.tar /tmp/hd-deploy.tar \
  && pct exec $CT -- rm -rf $DEST/static $DEST/src $DEST/test \
  && pct exec $CT -- tar -C $DEST -xf /tmp/hd-deploy.tar \
  && pct exec $CT -- rm -f /tmp/hd-deploy.tar \
  && rm -f /tmp/hd-deploy.tar"

if [ "$NEEDS_DEPS" = 1 ]; then
  echo "→ requirements.txt changed; updating Python dependencies"
  ssh "$NODE" "pct exec $CT -- $DEST/venv/bin/pip install --disable-pip-version-check -r $DEST/requirements.txt"
fi

if [ "$NEEDS_RESTART" = 1 ]; then
  echo "→ backend runtime changed; restarting proxdash"
  ssh "$NODE" "pct exec $CT -- systemctl restart proxdash"
else
  echo "→ static-only change; no restart needed"
fi

# Post-deploy smoke test (skip with --no-smoke or HD_SKIP_SMOKE=1).
if [ "${1:-}" = "--no-smoke" ] || [ "${HD_SKIP_SMOKE:-}" = "1" ]; then
  echo "✓ Deployed ${REV} (smoke skipped)"
elif [ -x "$SRC/test/run-smoke.sh" ]; then
  echo "→ Smoke-testing the live deploy…"
  if "$SRC/test/run-smoke.sh"; then
    echo "✓ Deployed ${REV} — smoke passed"
  else
    echo "" >&2
    echo "⚠  Deployed ${REV} but the SMOKE TEST FAILED — the live app may be broken." >&2
    echo "   Roll back with:  git revert --no-edit HEAD && ./deploy.sh" >&2
    exit 1
  fi
else
  echo "✗ Deployed ${REV}, but test/run-smoke.sh is missing or not executable" >&2
  exit 1
fi
