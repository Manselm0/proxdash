#!/usr/bin/env python3
"""Dependency-free release checks for ProxDash.

These checks deliberately use only the Python standard library so they run in a
fresh clone before FastAPI and the runtime dependencies are installed.
"""

from __future__ import annotations

import ast
import hashlib
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def check_python_syntax() -> None:
    source = (ROOT / "main.py").read_text(encoding="utf-8")
    ast.parse(source, "main.py")


def check_route_safety() -> None:
    source = (ROOT / "main.py").read_text(encoding="utf-8")
    tree = ast.parse(source, "main.py")
    methods: dict[str, set[str]] = {}
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call) or not decorator.args:
                continue
            func = decorator.func
            if not isinstance(func, ast.Attribute) or func.attr not in {"get", "post", "put", "delete", "patch"}:
                continue
            path = decorator.args[0]
            if isinstance(path, ast.Constant) and isinstance(path.value, str):
                methods.setdefault(path.value, set()).add(func.attr.upper())

    mutations = (
        "/api/tools/wol",
        "/api/tools/netcheck",
        "/api/tools/traceroute",
        "/api/tools/certexpiry",
        "/api/reload-config",
    )
    for path in mutations:
        if methods.get(path) != {"POST"}:
            raise AssertionError(f"{path} must be POST-only, found {methods.get(path)}")
    if methods.get("/auth/logout") != {"GET", "POST"}:
        raise AssertionError("logout must expose a non-mutating GET confirmation and a POST action")

    required_guards = (
        "_setup_token_matches",
        "X-Content-Type-Options",
        "_bounded_tool",
        "_bounded_tars_stream",
        "_atomic_private_text",
    )
    missing = [guard for guard in required_guards if guard not in source]
    if missing:
        raise AssertionError("backend safeguards are missing: " + ", ".join(missing))
    for retired in ("/api/tools/speedtest", "/api/tools/speedtest-stream",
                    "/api/tools/storage", "/api/tools/storage-stream"):
        if retired in methods:
            raise AssertionError(f"retired benchmark route remains: {retired}")


def check_portability_gate() -> None:
    result = subprocess.run(
        ["bash", "build.sh", "--check"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    if result.returncode:
        raise AssertionError(result.stdout.strip())


def check_frontend_bundle() -> None:
    modules = sorted((ROOT / "src").glob("[0-9]*.js"))
    if not modules:
        raise AssertionError("no numbered frontend modules found")

    version_inputs = modules + sorted((ROOT / "static/pages").glob("*.html"))
    version_inputs.append(ROOT / "static/index.html")
    digest = hashlib.sha256(b"".join(p.read_bytes() for p in version_inputs)).hexdigest()[:12]
    expected = b"".join(p.read_bytes() for p in modules)
    expected += f"\n;window.__BUILD__='{digest}';\n".encode()

    actual = (ROOT / "static/app.js").read_bytes()
    if actual != expected:
        raise AssertionError("static/app.js is stale; run ./build.sh")
    if (ROOT / "static/version.txt").read_text() != digest:
        raise AssertionError("static/version.txt does not match source inputs")


def check_sidebar_icon_motion() -> None:
    shell = (ROOT / "static/index.html").read_text(encoding="utf-8")
    router = (ROOT / "src/10-router.js").read_text(encoding="utf-8")
    app_core = (ROOT / "src/60-app-core.js").read_text(encoding="utf-8")

    expected = (
        "overview", "compute", "storage", "network", "backups", "topology",
        "health", "security", "tools", "tars", "settings",
    )
    actual = tuple(re.findall(r'<svg class="nav-ico" data-nav-icon="([^"]+)"', shell))
    if actual != expected:
        raise AssertionError(f"sidebar motion icon map is incomplete or reordered: {actual}")

    required_shell = (
        ".nav-icon-run .nav-ico",
        "@keyframes nav-heartbeat-draw",
        "@keyframes nav-gear-turn",
        "prefers-reduced-motion: reduce",
        'class="nav-ico__check" pathLength="1"',
    )
    missing_shell = [marker for marker in required_shell if marker not in shell]
    if missing_shell:
        raise AssertionError("sidebar icon motion CSS/markup is missing: " + ", ".join(missing_shell))

    if "_navIconPlay" not in app_core:
        raise AssertionError("sidebar icon motion helper _navIconPlay is missing")
    banned_wiring = ("_navIconWire", "pointerenter", "pointerdown", "'focus'")
    present_banned = [marker for marker in banned_wiring if marker in app_core]
    if present_banned:
        raise AssertionError(
            "sidebar icon animation must only play on click, not hover/touch/focus: "
            + ", ".join(present_banned)
        )
    if "!wasActive && typeof _navIconPlay==='function'" not in router:
        raise AssertionError("sidebar route activation must only animate inactive -> active transitions")


def check_public_metadata() -> None:
    readme = (ROOT / "README.md").read_text(encoding="utf-8").lower()
    legacy_products = (
        "portainer", "synology", "sonarr", "radarr", "lidarr", "bazarr",
        "prowlarr", "dispatcharr", "huntarr", "wizarr", "fileflows",
    )
    leaked = [name for name in legacy_products if re.search(rf"\b{re.escape(name)}\b", readme)]
    if leaked:
        raise AssertionError("README advertises removed integrations: " + ", ".join(leaked))

    example = (ROOT / "config.yaml.example").read_text(encoding="utf-8")
    proxmox_block = example.split("# ─── Proxmox Backup Server", 1)[0]
    if re.search(r"^\s*(username|password):", proxmox_block, re.MULTILINE):
        raise AssertionError("config example advertises unsupported Proxmox password auth")
    if not re.search(r"^proxmox:\s*\n\s+enabled:\s+false\s*$", example, re.MULTILINE):
        raise AssertionError("config example must not contact a placeholder Proxmox host on first run")
    if 'api_key: ""' not in example:
        raise AssertionError("config example must not mark the optional assistant configured")

    deploy = (ROOT / "deploy.sh").read_text(encoding="utf-8")
    for required in ("config.yaml.example", "requirements.txt", "test/run-smoke.sh"):
        if required not in deploy:
            raise AssertionError(f"deploy.sh is missing release safeguard: {required}")

    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    if "COPY . ." in dockerfile or "RUN ./build.sh" not in dockerfile:
        raise AssertionError("Docker image must use explicit inputs and rebuild the frontend bundle")
    compose = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    for required in ("read_only: true", "cap_drop:", "no-new-privileges:true"):
        if required not in compose:
            raise AssertionError(f"docker-compose.yml is missing hardening: {required}")
    service = (ROOT / "proxdash.service").read_text(encoding="utf-8")
    for required in ("NoNewPrivileges=true", "ProtectSystem=strict", "UMask=0077"):
        if required not in service:
            raise AssertionError(f"proxdash.service is missing hardening: {required}")


def main() -> int:
    checks = (
        check_python_syntax,
        check_route_safety,
        check_portability_gate,
        check_frontend_bundle,
        check_sidebar_icon_motion,
        check_public_metadata,
    )
    failures: list[str] = []
    for check in checks:
        try:
            check()
            print(f"✓ {check.__name__}")
        except Exception as exc:
            failures.append(f"{check.__name__}: {exc}")
            print(f"✗ {failures[-1]}", file=sys.stderr)
    if failures:
        return 1
    print(f"✓ {len(checks)} dependency-free static checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
