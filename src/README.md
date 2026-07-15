# `src/` — ProxDash frontend modules

These files concatenate (in numeric-prefix order) into `../static/app.js`, which
the shell loads as a single classic `<script>`. **There is no module system / build
toolchain** — `app.js` is still one global scope; `src/` is purely an organizational
split so we edit coherent ~200–1600 line domain files instead of one 11k-line file.

Workflow:

```
edit src/*.js   ->   ./build.sh   ->   git commit   (commit BOTH src/ and static/app.js)
```

`build.sh` does `cat src/[0-9]*.js > static/app.js`. `deploy.sh` re-runs it and
refuses to ship a stale bundle. The numeric prefixes preserve the original load
order — keep shared state/consts in `01-globals.js` and boot/init last, since
top-level `const`/`let` (unlike function declarations) don't hoist across the join.
