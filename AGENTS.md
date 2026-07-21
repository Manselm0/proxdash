# ProxDash Agent Instructions

`PROJECT_CONTEXT_ID: proxdash-v1`

ProxDash is a public, real-time Proxmox dashboard built with FastAPI, WebSockets, and a vanilla
JavaScript frontend. Every change must remain portable to an arbitrary Proxmox environment.

## Architecture

- Backend: `main.py`, which owns FastAPI routes, polling, WebSocket snapshots, history, and SQLite.
- Frontend source: numbered modules in `src/`.
- Generated frontend bundle: `static/app.js`.
- Shell and shared CSS: `static/index.html`.
- Lazy page fragments: `static/pages/*.html`.
- Configuration template: `config.yaml.example`.
- Runtime data belongs in the configured data directory and is never committed.

## Generated artifacts

- Edit numbered `src/*.js` modules, not `static/app.js` directly.
- Run `./build.sh` after changing frontend source, page fragments, or the shell.
- Commit `static/app.js` and `static/version.txt` with the source that generated them.
- The build includes a portability gate. A gate failure is a product defect, not a warning to bypass.

## Portability and privacy

- Use only standard Proxmox, Ceph, and PBS APIs for built-in infrastructure features.
- Do not assume node names, storage layouts, subnet addresses, guest counts, installed services, or
  permission levels.
- Make optional integrations config-driven and fault-isolated. Missing services or permissions must
  degrade gracefully instead of breaking a page.
- Never place operator-specific hostnames, addresses, container IDs, SSH paths, credentials, session
  data, or private-repository details in this public repository.
- Use documented placeholders such as `192.168.1.X` where an example address is required.

## UI work

- Read `PROXDASH_UI_GUIDE.md` completely before changing UI behavior or styling.
- Reuse implemented tokens, shared classes, helpers, chart factories, and component anatomy.
- Keep section titles outside cards unless the design guide explicitly defines an internal subheader.
- Resolve the runtime accent from CSS variables. Do not introduce hard-coded fork colors.
- Serve the application over HTTP for browser verification. Do not judge layout from `file://`.
- Check desktop and mobile layouts, browser console errors, horizontal overflow, empty states, and
  live-update stability. Respect `prefers-reduced-motion`.

## Build and verification

Run the focused checks for the files changed, then the release checks before delivery:

```bash
./build.sh
node --check static/app.js
git diff --check
python3 test/static_checks.py
python3 test/runtime_checks.py
python3 test/http_smoke.py
```

The runtime checks require packages from `requirements.txt` and use isolated temporary data. UI
changes also require a browser check against an HTTP-served local instance.

## Git and delivery

- Inspect `git status` before editing and preserve unrelated work.
- Keep commits scoped and include generated assets with their sources.
- Push only when the owner has authorized delivery or the operator environment provides a standing
  instruction to do so.
- `deploy.sh` is environment-specific and requires explicit target configuration. Keep target values
  in private operator context, never in this public file or shipped source.
- A deployment is complete only after its smoke checks pass and its runtime files match the tested
  commit.
