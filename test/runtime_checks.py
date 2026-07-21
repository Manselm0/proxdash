#!/usr/bin/env python3
"""Focused runtime regression checks for ProxDash.

Run this with the project's installed dependencies (for example
`venv/bin/python test/runtime_checks.py`). It uses an isolated temporary data
directory and never contacts a Proxmox host or the public internet.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import stat
import sys
import tempfile
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def assert_private(path: Path) -> None:
    mode = stat.S_IMODE(path.stat().st_mode)
    assert mode == 0o600, f"{path.name} mode is {mode:o}, expected 600"


async def check_tool_admission(app_module) -> None:
    sem = asyncio.Semaphore(1)

    @app_module._bounded_tool(sem)
    async def operation():
        return {"ok": True}

    await sem.acquire()
    rejected = await operation()
    assert rejected.status_code == 429
    sem.release()
    assert await operation() == {"ok": True}
    assert not sem.locked(), "tool slot was not released"


def check_routes(app_module) -> None:
    methods: dict[str, set[str]] = {}
    for route in app_module.app.routes:
        path = getattr(route, "path", None)
        if path:
            methods.setdefault(path, set()).update(getattr(route, "methods", set()) or set())

    for path in (
        "/api/tools/wol",
        "/api/tools/netcheck",
        "/api/tools/traceroute",
        "/api/tools/certexpiry",
        "/api/reload-config",
    ):
        assert methods.get(path) == {"POST"}, f"{path} must be POST-only: {methods.get(path)}"
    for path in (
        "/api/tools/speedtest",
        "/api/tools/speedtest-stream",
        "/api/tools/storage",
        "/api/tools/storage-stream",
    ):
        assert path not in methods, f"removed benchmark route is still registered: {path}"
    assert methods.get("/auth/logout") == {"GET", "POST"}
    assert methods.get("/api/history/proxmox_recent") == {"GET"}


def check_legacy_schema_upgrade(app_module) -> None:
    with sqlite3.connect(app_module.DB_PATH) as conn:
        conn.executescript(
            """
            CREATE TABLE proxmox_stats (
                id INTEGER PRIMARY KEY, ts REAL NOT NULL, node TEXT NOT NULL,
                cpu_pct REAL DEFAULT 0, mem_pct REAL DEFAULT 0
            );
            CREATE TABLE ceph_stats (
                id INTEGER PRIMARY KEY, ts REAL NOT NULL,
                bytes_used INTEGER DEFAULT 0, bytes_total INTEGER DEFAULT 0,
                read_bytes_sec INTEGER DEFAULT 0, write_bytes_sec INTEGER DEFAULT 0,
                read_op_per_sec INTEGER DEFAULT 0, write_op_per_sec INTEGER DEFAULT 0,
                num_objects INTEGER DEFAULT 0
            );
            CREATE TABLE health_stats (
                id INTEGER PRIMARY KEY, ts REAL NOT NULL,
                service_name TEXT NOT NULL, up INTEGER NOT NULL
            );
            """
        )

    app_module._prepare_db()
    expected = {
        "proxmox_stats": {"load_norm", "iowait_pct"},
        "ceph_stats": {"usable_used_bytes", "usable_total_bytes"},
        "health_stats": {"latency_ms"},
    }
    with sqlite3.connect(app_module.DB_PATH) as conn:
        for table, required in expected.items():
            columns = {row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')}
            assert required <= columns, f"{table} is missing {sorted(required - columns)}"
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        assert integrity == "ok"


def run() -> None:
    with tempfile.TemporaryDirectory(prefix="proxdash-runtime-check-") as data_dir:
        os.environ["PROXDASH_DATA"] = data_dir

        import main as app_module

        app_module.BASE.mkdir(parents=True, exist_ok=True)
        app_module.config = {"auth": {"enabled": True, "session_ttl_days": 7}}

        app_module._ensure_setup_token()
        assert app_module._setup_token_file.is_file()
        assert_private(app_module._setup_token_file)
        token = app_module._setup_token_file.read_text().strip()
        assert app_module._setup_token_matches(token)
        assert not app_module._setup_token_matches(token + "x")

        app_module._sessions.clear()
        app_module._sessions["test-session"] = {
            "username": "admin",
            "thumb": "",
            "created": datetime.now(),
        }
        assert app_module._sessions_save()
        assert_private(app_module._sessions_file)
        assert "test-session" in json.loads(app_module._sessions_file.read_text())

        app_module._atomic_private_text(app_module.BASE / "config.yaml", "demo: false\n")
        app_module._persist_config({"demo": True, "auth": {"enabled": True}})
        assert_private(app_module.BASE / "config.yaml")
        assert list(app_module.BASE.glob("config.yaml.bak.*")), "config backup was not created"

        check_legacy_schema_upgrade(app_module)
        assert_private(app_module.DB_PATH)
        app_module._db_backup()
        assert app_module.BACKUP_PATH.is_file()
        assert_private(app_module.BACKUP_PATH)
        check_routes(app_module)
        asyncio.run(check_tool_admission(app_module))
        app_module._users_save({"admin": {"created": datetime.now().isoformat()}})
        app_module._ensure_setup_token()
        assert not app_module._setup_token_file.exists(), "consumed setup token was not removed"

    print("✓ runtime checks passed")


if __name__ == "__main__":
    run()
