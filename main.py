#!/usr/bin/env python3
"""ProxDash - Real-time homelab dashboard"""

import asyncio
import base64
import functools
import hashlib
import json
import logging
import math
import os
import re as _re
import secrets
import shutil
import socket
import ssl
import tempfile
import time
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Set

import aiohttp
import yaml
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s %(message)s"
)
log = logging.getLogger("proxdash")

# APP_DIR = where the code + bundled assets (static/, config.yaml.example) live.
# BASE    = the writable data dir (config.yaml, sessions.json, users.json, *.db).
# They're the same for a bare /opt/proxdash install, but separate under Docker
# (code at /app, data volume at /data via PROXDASH_DATA). HOMEDASH_DATA is still
# honored as a fallback for existing installs migrated from the private fork.
APP_DIR = Path(__file__).resolve().parent
BASE = Path(os.environ.get("PROXDASH_DATA") or os.environ.get("HOMEDASH_DATA") or "/opt/proxdash")
import sqlite3

config: Dict[str, Any] = {}
_config_revision = 0
DB_PATH = BASE / "stats.db"
BACKUP_PATH = BASE / "stats.db.bak"
BACKUP_INTERVAL = 900  # seconds between hot backups (~15 min)
_last_backup_ts: float = 0.0

app = FastAPI(title="ProxDash")
# Compress HTML/JSON/JS/CSS responses ≥1 KB. Cuts the 573 KB index.html to
# ~141 KB on the wire (4×); same magnitude win on history JSON. Skips small
# bodies and binary streams that wouldn't benefit.
app.add_middleware(GZipMiddleware, minimum_size=1000)

def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH))
    try:
        if DB_PATH.stat().st_mode & 0o777 != 0o600:
            DB_PATH.chmod(0o600)
    except OSError:
        # SQLite will surface any actual access failure on first use; mode
        # tightening is best-effort for files migrated from older releases.
        pass
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def _migrate_db():
    """Idempotent column adds for tables that have grown new fields over time."""
    cols_to_add = [
        ("ceph_stats",    "usable_used_bytes",  "INTEGER DEFAULT 0"),
        ("ceph_stats",    "usable_total_bytes", "INTEGER DEFAULT 0"),
        ("health_stats",  "latency_ms",         "INTEGER"),
        # Normalized load average (load1 ÷ cores; 1.0 = fully busy) — Overview.
        ("proxmox_stats", "load_norm",           "REAL"),
        # IO wait % (CPU time stalled on disk) — the Utilization "Disk" line.
        ("proxmox_stats", "iowait_pct",          "REAL"),
    ]
    with _db() as conn:
        for table, col, ddl in cols_to_add:
            columns = {row["name"] for row in conn.execute(f'PRAGMA table_info("{table}")')}
            if not columns:
                raise sqlite3.DatabaseError(f"migration table is missing: {table}")
            if col not in columns:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}")

def _prepare_db() -> None:
    """Create the current schema and apply every idempotent migration."""
    _init_db()
    _migrate_db()

def _init_db():
    with _db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS proxmox_stats (
                id INTEGER PRIMARY KEY, ts REAL NOT NULL,
                node TEXT NOT NULL, cpu_pct REAL DEFAULT 0, mem_pct REAL DEFAULT 0,
                load_norm REAL, iowait_pct REAL
            );
            -- Per-node network throughput (bytes/sec, derived from guest counter
            -- deltas each poll) — feeds the Network page's history charts.
            CREATE TABLE IF NOT EXISTS proxmox_net_stats (
                id INTEGER PRIMARY KEY, ts REAL NOT NULL,
                node TEXT NOT NULL, in_bps REAL DEFAULT 0, out_bps REAL DEFAULT 0
            );
            -- Per-storage usage history (bytes), one row per storage×node,
            -- downsampled to ~5 min and kept ~400d so the Storage page can
            -- chart long-horizon usage per device in any Proxmox environment.
            CREATE TABLE IF NOT EXISTS pxstorage_stats (
                ts REAL NOT NULL, storage TEXT NOT NULL, node TEXT NOT NULL,
                shared INTEGER DEFAULT 0, disk REAL DEFAULT 0, maxdisk REAL DEFAULT 0
            );
            -- Per-storage guest I/O rates (bytes/sec, attributed from guest
            -- diskread/diskwrite deltas) — feeds the Storage page THROUGHPUT charts.
            CREATE TABLE IF NOT EXISTS pxstorage_io (
                ts REAL NOT NULL, storage TEXT NOT NULL,
                read_bps REAL DEFAULT 0, write_bps REAL DEFAULT 0
            );
            -- Per-guest network rates (bytes/sec), ~60s samples — feeds the
            -- Network page's traffic composition + guest sparklines. Same
            -- tiered retention as the node tables: full resolution for 30
            -- days, then compacted to hourly and kept 400 days.
            CREATE TABLE IF NOT EXISTS guest_net_stats (
                ts REAL NOT NULL, vmid TEXT NOT NULL,
                in_bps REAL DEFAULT 0, out_bps REAL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_px_ts   ON proxmox_stats(ts);
            CREATE INDEX IF NOT EXISTS idx_pxnet_ts ON proxmox_net_stats(ts);
            CREATE INDEX IF NOT EXISTS idx_pxstor ON pxstorage_stats(storage, ts);
            CREATE INDEX IF NOT EXISTS idx_pxstor_ts ON pxstorage_stats(ts);
            CREATE INDEX IF NOT EXISTS idx_pxstorio_ts ON pxstorage_io(ts);
            CREATE INDEX IF NOT EXISTS idx_guestnet ON guest_net_stats(vmid, ts);
            CREATE INDEX IF NOT EXISTS idx_guestnet_ts ON guest_net_stats(ts);
            -- Small key/value store: import markers, one-shot flags.
            CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT);
            -- Per-guest cpu/mem history for the detail-drawer mini-graph and
            -- the Compute page's per-node guest drilldown. kind='guest',
            -- eid=vmid. Downsampled (~60s); same tiered retention as the node
            -- tables (30d full resolution, then hourly-compacted to 400d) —
            -- nodes use proxmox_stats instead.
            CREATE TABLE IF NOT EXISTS entity_stats (
                ts REAL NOT NULL, kind TEXT NOT NULL, eid TEXT NOT NULL,
                cpu_pct REAL DEFAULT 0, mem_pct REAL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_entity_stats ON entity_stats(kind, eid, ts);
            CREATE TABLE IF NOT EXISTS ceph_stats (
                id INTEGER PRIMARY KEY, ts REAL NOT NULL,
                bytes_used INTEGER DEFAULT 0,
                bytes_total INTEGER DEFAULT 0,
                read_bytes_sec INTEGER DEFAULT 0,
                write_bytes_sec INTEGER DEFAULT 0,
                read_op_per_sec INTEGER DEFAULT 0,
                write_op_per_sec INTEGER DEFAULT 0,
                num_objects INTEGER DEFAULT 0,
                usable_used_bytes INTEGER DEFAULT 0,
                usable_total_bytes INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_ceph_ts ON ceph_stats(ts);
            CREATE TABLE IF NOT EXISTS health_stats (
                id INTEGER PRIMARY KEY, ts REAL NOT NULL,
                service_name TEXT NOT NULL,
                up INTEGER NOT NULL,
                latency_ms INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_hc_ts   ON health_stats(ts);
            CREATE INDEX IF NOT EXISTS idx_hc_svc ON health_stats(service_name, ts);
        """)

def _db_check_integrity() -> bool:
    """Return True if stats.db passes SQLite integrity check."""
    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=5)
        result = conn.execute("PRAGMA integrity_check").fetchone()
        conn.close()
        return result and result[0] == "ok"
    except Exception:
        return False

def _db_backup():
    """Hot-copy stats.db → stats.db.bak using SQLite online backup API. Writes to
    a fresh temp file and atomically renames over the destination — backing up
    directly onto an existing (and possibly corrupt) .bak raises "file is not a
    database" when SQLite reads the garbage destination header."""
    global _last_backup_ts
    tmp = Path(str(BACKUP_PATH) + ".tmp")
    src = dst = None
    try:
        try: tmp.unlink()
        except FileNotFoundError: pass
        src = sqlite3.connect(str(DB_PATH), timeout=10)
        dst = sqlite3.connect(str(tmp), timeout=10)
        src.backup(dst, pages=200)
        src.close(); src = None
        dst.close(); dst = None
        tmp.chmod(0o600)
        os.replace(str(tmp), str(BACKUP_PATH))   # atomic swap over any corrupt prior .bak
        BACKUP_PATH.chmod(0o600)
        _last_backup_ts = time.time()
        log.info("DB backed up to stats.db.bak")
    except Exception as e:
        try:
            if src: src.close()
            if dst: dst.close()
            tmp.unlink()
        except Exception: pass
        log.warning(f"DB backup failed: {e}")

_last_prune = 0.0

def _record_stats(data: dict):
    global _last_prune
    ts = data.get("timestamp", time.time())
    try:
        with _db() as conn:
            px = data.get("proxmox") or {}
            for node in (px.get("nodes") or []):
                # Proxmox /nodes returns mem/maxmem in bytes — derive the pct here.
                mem_total = node.get("maxmem", 0) or 0
                mem_used = node.get("mem", 0) or 0
                mem_pct = round(mem_used / mem_total * 100, 1) if mem_total else 0
                la, cores = node.get("loadavg"), node.get("maxcpu") or 0
                load_norm = round(la / cores, 3) if (la is not None and cores) else None
                iow = node.get("iowait")
                iowait_pct = round(iow * 100, 2) if iow is not None else None
                conn.execute(
                    "INSERT INTO proxmox_stats(ts,node,cpu_pct,mem_pct,load_norm,iowait_pct) VALUES(?,?,?,?,?,?)",
                    (ts, node.get("node", ""), round(node.get("cpu", 0) * 100, 1), mem_pct, load_norm, iowait_pct)
                )
            # Per-node network throughput (bytes/sec) for the Network page charts.
            for nd, tr in (((px.get("network") or {}).get("traffic")) or {}).items():
                conn.execute(
                    "INSERT INTO proxmox_net_stats(ts,node,in_bps,out_bps) VALUES(?,?,?,?)",
                    (ts, nd, tr.get("in", 0) or 0, tr.get("out", 0) or 0)
                )
            # Per-guest network rates (Network page composition + sparklines),
            # downsampled to ~60s like entity_stats.
            if ts - _guestnet_rec_last["ts"] >= 55:
                _guestnet_rec_last["ts"] = ts
                for vmid, r in (((px.get("network") or {}).get("guest_rates")) or {}).items():
                    if (r.get("in") or 0) or (r.get("out") or 0):
                        conn.execute(
                            "INSERT INTO guest_net_stats(ts,vmid,in_bps,out_bps) VALUES(?,?,?,?)",
                            (ts, str(vmid), r.get("in", 0) or 0, r.get("out", 0) or 0)
                        )
            # Per-storage guest I/O rates (Storage page THROUGHPUT charts).
            for st, io in (px.get("storage_io") or {}).items():
                conn.execute(
                    "INSERT INTO pxstorage_io(ts,storage,read_bps,write_bps) VALUES(?,?,?,?)",
                    (ts, st, io.get("read", 0) or 0, io.get("write", 0) or 0)
                )
            # Per-storage usage history (Storage page device charts). Usage moves
            # slowly, so ~5 min samples keep the table small at 400d retention.
            if ts - _pxstor_rec_last["ts"] >= 290:
                _pxstor_rec_last["ts"] = ts
                for s in (px.get("storage") or []):
                    if not s.get("storage") or not s.get("maxdisk"):
                        continue
                    conn.execute(
                        "INSERT INTO pxstorage_stats(ts,storage,node,shared,disk,maxdisk) VALUES(?,?,?,?,?,?)",
                        (ts, s["storage"], s.get("node") or "", 1 if s.get("shared") else 0,
                         s.get("disk", 0) or 0, s.get("maxdisk", 0) or 0)
                    )
            # Per-entity cpu/mem history (drawer mini-graph), downsampled to ~60s.
            if ts - _entity_rec_last["ts"] >= 55:
                _entity_rec_last["ts"] = ts
                for g in ((px.get("vms") or []) + (px.get("lxcs") or [])):
                    if g.get("status") != "running":
                        continue
                    mm = g.get("maxmem") or 0
                    conn.execute(
                        "INSERT INTO entity_stats(ts,kind,eid,cpu_pct,mem_pct) VALUES(?,?,?,?,?)",
                        (ts, "guest", str(g.get("vmid")), round((g.get("cpu", 0) or 0) * 100, 1),
                         round((g.get("mem", 0) / mm * 100), 1) if mm else 0)
                    )
            ceph = data.get("ceph") or {}
            if ceph.get("status") == "online":
                conn.execute(
                    "INSERT INTO ceph_stats(ts,bytes_used,bytes_total,read_bytes_sec,write_bytes_sec,read_op_per_sec,write_op_per_sec,num_objects,usable_used_bytes,usable_total_bytes) VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (ts, ceph.get("bytes_used",0), ceph.get("bytes_total",0),
                     ceph.get("read_bytes_sec",0), ceph.get("write_bytes_sec",0),
                     ceph.get("read_op_per_sec",0), ceph.get("write_op_per_sec",0),
                     ceph.get("num_objects",0),
                     ceph.get("usable_used_bytes",0), ceph.get("usable_total_bytes",0))
                )
            # Health checks: persist on state-change or every 60s heartbeat
            for svc_name, info in (data.get("health") or {}).items():
                if not isinstance(info, dict) or "up" not in info:
                    continue
                up = 1 if info.get("up") else 0
                lat = info.get("latency_ms")
                last = _health_last_persist.get(svc_name)
                if last is None or last[1] != up or (ts - last[0]) >= 60:
                    conn.execute(
                        "INSERT INTO health_stats(ts,service_name,up,latency_ms) VALUES(?,?,?,?)",
                        (ts, svc_name, up, lat)
                    )
                    _health_last_persist[svc_name] = (ts, up)
            # Prune old rows at most hourly — it's a full table scan across 16
            # tables and only matters once a day, so don't run it every tick.
            if ts - _last_prune > 3600:
                _last_prune = ts
                cutoff = ts - 30 * 86400
                for tbl in ("ceph_stats", "health_stats"):
                    conn.execute(f"DELETE FROM {tbl} WHERE ts < ?", (cutoff,))
                # Tiered retention for the Proxmox + guest history tables: full
                # 10s/60s resolution for 30 days, then COMPACT to one row per
                # hour per series and keep those 400 days. This is what lets
                # the RRD history import (up to a year, coarse) coexist with
                # live data — guests get the same long runway as nodes.
                for tbl, grp in (("proxmox_stats", "node"), ("proxmox_net_stats", "node"), ("pxstorage_io", "storage"),
                                 ("entity_stats", "kind, eid"), ("guest_net_stats", "vmid")):
                    conn.execute(
                        f"DELETE FROM {tbl} WHERE ts < ? AND rowid NOT IN ("
                        f"SELECT MIN(rowid) FROM {tbl} WHERE ts < ? GROUP BY {grp}, CAST(ts/3600 AS INTEGER))",
                        (cutoff, cutoff))
                    conn.execute(f"DELETE FROM {tbl} WHERE ts < ?", (ts - 400 * 86400,))
                # Storage usage trends likewise — forecasting wants months of runway.
                conn.execute("DELETE FROM pxstorage_stats WHERE ts < ?", (ts - 400 * 86400,))
    except Exception as e:
        log.warning(f"stats record: {e}")

# ── Auth session store ─────────────────────────────────────────────────────
def _atomic_private_json(path: Path, payload: Any) -> None:
    """Atomically replace a credential-bearing JSON file with mode 0600."""
    _atomic_private_text(path, json.dumps(payload, separators=(",", ":")))

def _atomic_private_text(path: Path, content: str) -> None:
    """Atomically replace a private text file with mode 0600 and durable data."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            fd = -1
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_path, path)
        path.chmod(0o600)
    except Exception:
        if fd >= 0:
            os.close(fd)
        tmp_path.unlink(missing_ok=True)
        raise

def _atomic_private_bytes(path: Path, content: bytes) -> None:
    """Atomically replace a private binary file with mode 0600."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as tmp:
            fd = -1
            tmp.write(content)
            tmp.flush()
            os.fsync(tmp.fileno())
        os.replace(tmp_path, path)
        path.chmod(0o600)
    except Exception:
        if fd >= 0:
            os.close(fd)
        tmp_path.unlink(missing_ok=True)
        raise

_sessions: Dict[str, dict] = {}  # token -> {username, thumb, created}
_sessions_file = BASE / "sessions.json"

def _sessions_load():
    if _sessions_file.exists():
        try:
            raw = json.loads(_sessions_file.read_text())
            loaded = {}
            for token, s in raw.items():
                loaded[token] = {**s, "created": datetime.fromisoformat(s["created"])}
            _sessions.clear()
            _sessions.update(loaded)
        except Exception as e:
            log.warning(f"session store load failed: {e}")

def _sessions_sweep():
    """Drop expired sessions so sessions.json doesn't grow unbounded."""
    ttl = _auth_cfg().get("session_ttl_days", 7)
    cut = datetime.utcnow() - timedelta(days=ttl)
    for t in [t for t, s in _sessions.items() if s.get("created", cut) < cut]:
        _sessions.pop(t, None)

def _sessions_save() -> bool:
    _sessions_sweep()
    try:
        _atomic_private_json(
            _sessions_file,
            {t: {**s, "created": s["created"].isoformat()} for t, s in _sessions.items()},
        )
        return True
    except Exception as e:
        log.error(f"session store save failed: {e}")
        return False

# ── Local admin auth (username/password) ──────────────────────────────────
# A stdlib-only local account, provisioned on first run at the login screen.
# Password hashes (pbkdf2_hmac) live in users.json beside sessions.json,
# owner-only (0600). `auth.enabled: false` bypasses all (trusted-LAN only).
_users_file = BASE / "users.json"
_setup_token_file = BASE / "setup-token.txt"
_PBKDF2_ITERS = 240000
_FIRST_RUN_LOCK = asyncio.Lock()
_LOGIN_HASH_SEM = asyncio.Semaphore(2)
_LOGIN_ATTEMPTS: Dict[str, list] = {}
_LOGIN_WINDOW = 5 * 60
_LOGIN_MAX_ATTEMPTS = 8
_LOGIN_MAX_KEYS = 2048

def _users_load() -> dict:
    try:
        return json.loads(_users_file.read_text()) or {}
    except FileNotFoundError:
        return {}
    except Exception as e:
        log.error(f"user store load failed: {e}")
        raise

def _users_save(users: dict) -> None:
    _atomic_private_json(_users_file, users)

def _ensure_setup_token() -> None:
    """Create the one-time secret required to claim a fresh installation."""
    if not _auth_enabled():
        return
    try:
        if _users_load():
            _setup_token_file.unlink(missing_ok=True)
            return
        if _setup_token_file.exists() and _setup_token_file.read_text().strip():
            return
        token = secrets.token_urlsafe(24)
        _atomic_private_text(_setup_token_file, token + "\n")
        log.warning(
            "First-run setup token: %s (also stored at %s)",
            token,
            _setup_token_file,
        )
    except Exception as e:
        # Do not make an unclaimable instance appear healthy. Provisioning will
        # return a storage error until the private token can be created/read.
        log.error(f"first-run setup token unavailable: {e}")

def _setup_token_matches(candidate: str) -> bool:
    try:
        expected = _setup_token_file.read_text().strip()
        return bool(expected and candidate and secrets.compare_digest(expected, candidate))
    except Exception:
        return False

def _hash_password(pw: str, salt: str = None, iters: int = _PBKDF2_ITERS) -> dict:
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), iters)
    return {"salt": salt, "hash": dk.hex(), "iterations": iters}

def _verify_password(pw: str, rec: dict) -> bool:
    try:
        iterations = int(rec["iterations"])
        if not 10_000 <= iterations <= 2_000_000:
            return False
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(),
                                 bytes.fromhex(rec["salt"]), iterations)
        return secrets.compare_digest(dk.hex(), rec["hash"])
    except Exception:
        return False

def _local_admin_exists() -> bool:
    try:
        return bool(_users_load())
    except Exception:
        # A corrupt/unreadable store must never reopen first-run provisioning.
        return True

def _login_key(request: Request) -> str:
    return request.client.host if request.client else "unknown"

def _login_retry_after(key: str) -> int:
    now = time.monotonic()
    attempts = [ts for ts in _LOGIN_ATTEMPTS.get(key, []) if now - ts < _LOGIN_WINDOW]
    if attempts:
        _LOGIN_ATTEMPTS[key] = attempts
    else:
        _LOGIN_ATTEMPTS.pop(key, None)
    if len(attempts) < _LOGIN_MAX_ATTEMPTS:
        return 0
    return max(1, int(_LOGIN_WINDOW - (now - attempts[0])))

def _login_record_failure(key: str) -> None:
    now = time.monotonic()
    _LOGIN_ATTEMPTS.setdefault(key, []).append(now)
    if len(_LOGIN_ATTEMPTS) > _LOGIN_MAX_KEYS:
        oldest = min(_LOGIN_ATTEMPTS, key=lambda k: _LOGIN_ATTEMPTS[k][-1])
        _LOGIN_ATTEMPTS.pop(oldest, None)

async def _bounded_password_check(password: str, rec: dict):
    """Run the expensive PBKDF2 work off-loop with bounded admission."""
    try:
        await asyncio.wait_for(_LOGIN_HASH_SEM.acquire(), timeout=2)
    except asyncio.TimeoutError:
        return None
    try:
        return await asyncio.to_thread(_verify_password, password, rec)
    finally:
        _LOGIN_HASH_SEM.release()

async def _bounded_password_hash(password: str):
    try:
        await asyncio.wait_for(_LOGIN_HASH_SEM.acquire(), timeout=2)
    except asyncio.TimeoutError:
        return None
    try:
        return await asyncio.to_thread(_hash_password, password)
    finally:
        _LOGIN_HASH_SEM.release()

def _auth_cfg() -> dict:
    return config.get("auth", {})

def _auth_enabled() -> bool:
    # Fail CLOSED: default to enabled when the `auth:` block is missing/partial,
    # so a config that loses its auth section (as the `tools:` block once did)
    # can't silently expose the whole box to the internet. Live deploys set this
    # explicitly; a fresh install creates a local admin at first login (or sets
    # enabled:false deliberately for a trusted-LAN-only deployment).
    return _auth_cfg().get("enabled", True)

def _secure_cookie(request: Request) -> bool:
    """Allow TLS-terminating proxies to force Secure cookies explicitly."""
    return request.url.scheme == "https" or bool(_auth_cfg().get("cookie_secure", False))

def _get_session(request: Request):
    token = request.cookies.get("hd_session")
    if not token:
        return None
    s = _sessions.get(token)
    if not s:
        return None
    ttl = _auth_cfg().get("session_ttl_days", 7)
    if datetime.utcnow() - s["created"] > timedelta(days=ttl):
        _sessions.pop(token, None)
        return None
    return s

def _stream_authed(conn) -> bool:
    """Auth gate for WebSockets, which the HTTP middleware cannot cover."""
    if not _auth_enabled():
        return True
    return _get_session(conn) is not None

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        try:
            content_length = int(request.headers.get("content-length") or 0)
        except ValueError:
            return JSONResponse({"error": "invalid content length"}, status_code=400)
        if content_length > 2 * 1024 * 1024:
            return JSONResponse({"error": "request is too large"}, status_code=413)
    if not _auth_enabled():
        return await call_next(request)
    path = request.url.path
    if (path.startswith("/auth/") or path.startswith("/static/")
            or path == "/ws" or path == "/favicon.svg" or path == "/favicon.ico"
            or (path == "/api/logo" and request.method == "GET")):  # login page + favicon need it
        return await call_next(request)
    if not _get_session(request):
        if path.startswith("/api/"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        resp = RedirectResponse("/auth/login")
        # Remember where the user was actually headed so the post-login callback
        # can send them back there instead of dumping everyone on the overview
        # (a deep-link refresh while logged out used to always land on overview).
        nxt = path + (("?" + request.url.query) if request.url.query else "")
        if request.method == "GET" and nxt.startswith("/") and not nxt.startswith("//"):
            resp.set_cookie("hd_next", nxt, max_age=600, httponly=True, samesite="lax")
        return resp
    # CSRF (double-submit cookie): a cross-site page can neither read the hd_csrf
    # cookie nor set a custom header, so a state-changing API call must echo the
    # cookie value in X-CSRF-Token. (SameSite=Lax already blocks the cross-site
    # POST itself; this is defence-in-depth.)
    if request.method in ("POST", "PUT", "DELETE", "PATCH") and path.startswith("/api/"):
        cc = request.cookies.get("hd_csrf")
        if not cc or request.headers.get("x-csrf-token") != cc:
            return JSONResponse({"error": "csrf token missing or invalid"}, status_code=403)
    resp = await call_next(request)
    if not request.cookies.get("hd_csrf"):   # hand the SPA a token to echo (readable by JS — not HttpOnly)
        try:
            resp.set_cookie("hd_csrf", secrets.token_urlsafe(32), max_age=30 * 86400,
                            samesite="lax", secure=_secure_cookie(request))
        except Exception:
            pass
    return resp

@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Apply baseline browser hardening, including middleware short-circuits."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "same-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    )
    if _secure_cookie(request):
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
    return response

# ── Health check history (ring buffer, 90 ticks ≈ 15 min at 10s poll) ─────
_health_history: Dict[str, list] = {}
_health_current_names: Set[str] = set()  # checks present in the LATEST poll (auto + custom)
HEALTH_HISTORY_MAX = 90
_health_last_persist: Dict[str, tuple] = {}  # svc -> (ts, up) — throttle DB writes
_entity_rec_last = {"ts": 0.0}  # downsample gate for per-entity cpu/mem history
_pxstor_rec_last = {"ts": 0.0}  # downsample gate for per-storage usage history (~5 min)
_guestnet_rec_last = {"ts": 0.0}  # downsample gate for per-guest net rates (~60s)

class WSManager:
    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._last: dict = {}

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self._connections.add(ws)
        if self._last:
            try:
                await ws.send_text(json.dumps(self._last))
            except Exception:
                pass

    def disconnect(self, ws: WebSocket):
        self._connections.discard(ws)

    async def broadcast(self, data: dict):
        # Sends the full snapshot to every client each tick, unconditionally. This
        # is deliberate and left as-is: the per-tick UI cost is client-side DOM
        # churn (handled by per-domain render-gating in src/60-app-core.js), not
        # this send. Deferred server-side levers, none worth their complexity today:
        #   • whole-snapshot change-gate — fires ~never (timestamp/build + live
        #     metrics differ every tick);
        #   • per-domain change flags shipped to the client — no json.dumps/send
        #     saving (volatile domains still go out), and couples the wire format;
        #   • volatile/stable cadence split — needs partial-snapshot handling +
        #     reconnect replay. Prefer the PBS pattern (poll_loop ~:4562: move a
        #     large stable blob off-tick to an on-demand API) if one domain ever
        #     dominates. Revisit only if server CPU/bandwidth becomes a measured issue.
        self._last = data
        msg = json.dumps(data)
        connections = list(self._connections)

        async def _send(ws: WebSocket):
            try:
                await asyncio.wait_for(ws.send_text(msg), timeout=5)
                return None
            except Exception:
                return ws

        if connections:
            dead = {ws for ws in await asyncio.gather(*[_send(ws) for ws in connections]) if ws}
            self._connections -= dead

ws_manager = WSManager()

_NOSSL_CTX = None

def nossl_ctx():
    # Memoized singleton so a shared aiohttp session can pool connections to
    # self-signed LAN hosts (aiohttp keys the pool by the ssl object's identity).
    global _NOSSL_CTX
    if _NOSSL_CTX is None:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        _NOSSL_CTX = ctx
    return _NOSSL_CTX

def _ssl_for(url: str):
    """Pick a TLS context by host: VERIFY for public FQDNs (e.g.
    api.cloudflare.com — sending a Bearer token over an unverified connection
    is MITM-able), allow self-signed only for private/LAN targets (Proxmox,
    PBS and other private appliances commonly use self-signed certs). Returns True (= aiohttp's
    default verifying context) or nossl_ctx()."""
    try:
        host = (urllib.parse.urlparse(url if "://" in url else "http://" + url).hostname or "").lower()
    except Exception:
        return nossl_ctx()
    if not host or "." not in host or host.endswith(".local") or host.endswith(".lan"):
        return nossl_ctx()
    if _re.match(r"^\d{1,3}(\.\d{1,3}){3}$", host):     # IPv4 literal → use the private check
        return nossl_ctx() if _is_private_ip(host) else True
    return True                                         # public FQDN → verify

# Geo-IP cache: {ip: {"city": ..., "country": ..., "country_code": ..., "ts": float}}
def _is_private_ip(ip: str) -> bool:
    if not ip:
        return True
    parts = ip.split(".")
    if len(parts) != 4:
        return ":" in ip  # treat any IPv6 link-local-ish as private; we don't lookup IPv6 here
    try:
        o = [int(p) for p in parts]
    except ValueError:
        return True
    if o[0] == 10: return True
    if o[0] == 127: return True
    if o[0] == 192 and o[1] == 168: return True
    if o[0] == 172 and 16 <= o[1] <= 31: return True
    if o[0] == 169 and o[1] == 254: return True
    if o[0] == 100 and 64 <= o[1] <= 127: return True  # CGNAT
    return False

_http_session = None

def _get_http_session():
    # One shared session (created inside the running loop) gives keep-alive /
    # connection reuse across the ~21 per-tick fetchers instead of a fresh
    # TCP+TLS handshake per call. SSL is chosen per-request via ssl=_ssl_for(url),
    # so mixed verify/no-verify hosts still pool correctly by (host,port,ssl).
    global _http_session
    if _http_session is None or _http_session.closed:
        _http_session = aiohttp.ClientSession()
    return _http_session

async def http_get(url: str, headers: dict = None, params: dict = None, timeout: int = 8) -> Any:
    s = _get_http_session()
    async with s.get(url, params=params or {}, headers=headers or {},
                     ssl=_ssl_for(url), timeout=aiohttp.ClientTimeout(total=timeout)) as r:
        return await r.json(content_type=None)

async def _safe_get(url: str, headers: dict = None, params: dict = None, timeout: int = 6) -> Any:
    """http_get that returns None on any failure — for optional/non-critical fetches."""
    try:
        return await http_get(url, headers=headers, params=params, timeout=timeout)
    except Exception:
        return None

async def check_up(url: str, timeout: int = 4) -> bool:
    try:
        async with aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=nossl_ctx()),
            timeout=aiohttp.ClientTimeout(total=timeout)
        ) as s:
            async with s.get(url, allow_redirects=False) as r:
                return r.status < 500
    except Exception:
        return False

async def check_up_detailed(url: str, timeout: int = 4) -> dict:
    """Like check_up but returns {up, latency_ms, status, error}. Used by health page.

    Redirects are NOT followed — health checks should report on whether the
    target endpoint responds, not whatever it redirects to. Following caused
    false negatives for services like Caddy (HTTP 308 → HTTPS, fails SNI when
    hit by IP) and for any HTTP-to-HTTPS apex redirect served by Cloudflare.
    """
    t0 = time.time()
    try:
        async with aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=nossl_ctx()),
            timeout=aiohttp.ClientTimeout(total=timeout)
        ) as s:
            async with s.get(url, allow_redirects=False) as r:
                latency = int((time.time() - t0) * 1000)
                return {"up": r.status < 500, "latency_ms": latency, "status": r.status, "error": None}
    except asyncio.TimeoutError:
        return {"up": False, "latency_ms": None, "status": None, "error": "timeout"}
    except Exception as e:
        return {"up": False, "latency_ms": None, "status": None, "error": str(e)[:80]}

# ── SSL cert expiry cache (per-URL, 6h TTL) ────────────────────────────────
_ssl_cert_cache: Dict[str, tuple] = {}  # url -> (expires_at_ts, cached_at, days_remaining, error)
SSL_CACHE_TTL = 6 * 3600  # refetch every 6 hours
SSL_FETCH_TIMEOUT = 4

async def _ssl_cert_days(url: str) -> dict:
    """For https URLs, return {days_remaining, expires_at, error} (cached 6h)."""
    if not url.lower().startswith("https://"):
        return {}
    now = time.time()
    cached = _ssl_cert_cache.get(url)
    if cached and (now - cached[1]) < SSL_CACHE_TTL:
        return {"days_remaining": cached[2], "expires_at": cached[0], "error": cached[3]}
    try:
        from urllib.parse import urlparse
        import ssl as _ssl
        parsed = urlparse(url)
        host = parsed.hostname
        port = parsed.port or 443
        ctx = _ssl.create_default_context()
        loop = asyncio.get_event_loop()
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host=host, port=port, ssl=ctx, server_hostname=host),
            timeout=SSL_FETCH_TIMEOUT,
        )
        try:
            ssl_obj = writer.get_extra_info("ssl_object")
            cert = ssl_obj.getpeercert() if ssl_obj else None
        finally:
            writer.close()
            try: await writer.wait_closed()
            except Exception: pass
        if not cert or "notAfter" not in cert:
            _ssl_cert_cache[url] = (0, now, None, "no cert")
            return {"days_remaining": None, "error": "no cert"}
        # notAfter format: "Apr  1 12:34:56 2027 GMT"
        from datetime import datetime as _dt
        exp = _dt.strptime(cert["notAfter"], "%b %d %H:%M:%S %Y %Z")
        exp_ts = exp.timestamp()
        days = int((exp_ts - now) / 86400)
        _ssl_cert_cache[url] = (exp_ts, now, days, None)
        return {"days_remaining": days, "expires_at": exp_ts, "error": None}
    except Exception as e:
        msg = str(e)[:60]
        _ssl_cert_cache[url] = (0, now, None, msg)
        return {"days_remaining": None, "error": msg}

# ── Proxmox ────────────────────────────────────────────────────────────────

# Guest (VM/LXC) primary IPv4s, vmid -> ip. Per-guest API calls (~1 per running
# guest) are too heavy for every tick, so refresh at most every 5 minutes; the
# cards render from this cache in between. LXCs report interfaces natively;
# VMs need the QEMU guest agent and silently stay blank without it.
_guest_ip_cache: dict = {"ts": 0.0, "ips": {}}

def _pick_ipv4(addrs: list, ip_key: str) -> str:
    for a in addrs:
        ip = str(a.get(ip_key) or "").split("/")[0]
        if ip and ":" not in ip and not ip.startswith("127."):
            return ip
    return ""

async def _fetch_guest_ips(base: str, headers: dict, vms: list, lxcs: list) -> dict:
    now = time.time()
    if now - _guest_ip_cache["ts"] < 300:
        return _guest_ip_cache["ips"]

    async def lxc_ip(node, vmid):
        r = await _safe_get(f"{base}/nodes/{node}/lxc/{vmid}/interfaces", headers=headers)
        ifs = [i for i in ((r or {}).get("data") or []) if i.get("name") != "lo"]
        return vmid, _pick_ipv4(ifs, "inet")

    async def vm_ip(node, vmid):
        r = await _safe_get(f"{base}/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces", headers=headers)
        found = []
        for i in (((r or {}).get("data") or {}).get("result") or []):
            if i.get("name") == "lo":
                continue
            ip = _pick_ipv4(i.get("ip-addresses") or [], "ip-address")
            if ip:
                found.append(ip)
        # A VM can enumerate a container/VPN bridge first — prefer the likeliest
        # LAN address, environment-agnostic: 192.168.x and 10.x before 172.x
        # (container bridges commonly use 172.17-31), everything else last.
        def _lan_rank(ip):
            if ip.startswith("192.168."): return 0
            if ip.startswith("10."): return 1
            if ip.startswith("172."): return 2
            return 3
        found.sort(key=_lan_rank)
        return vmid, (found[0] if found else "")

    tasks = [lxc_ip(g.get("node"), g.get("vmid")) for g in lxcs if g.get("status") == "running"] \
          + [vm_ip(g.get("node"), g.get("vmid")) for g in vms if g.get("status") == "running"]
    ips = {}
    for res in await asyncio.gather(*tasks, return_exceptions=True):
        if isinstance(res, tuple) and res[1]:
            ips[res[0]] = res[1]
    _guest_ip_cache["ts"] = now
    _guest_ip_cache["ips"] = ips
    return ips

# ── Proxmox networking (bridges, node interfaces, guest attachment) ─────────
# Node interface lists are cheap (one call per node) and refresh every poll.
# Guest NIC config (which bridge/VLAN each guest sits on) is derived from each
# guest's config — one call per guest — so, like guest IPs, it's cached on a
# longer interval and reused between polls. Per-node throughput is a rate
# derived by diffing the guests' cumulative net counters between polls.
_guest_netcfg_cache: dict = {"ts": 0.0, "guests": [], "disks": {}}
_net_rate_cache: dict = {}  # node -> {"in": bytes, "out": bytes, "ts": float}
_guest_rate_cache: dict = {}  # vmid -> {"in": bytes, "out": bytes, "ts": float}
_stor_io_cache: dict = {}   # storage -> {"read": bytes, "write": bytes, "ts": float}

# Guest config keys that reference a backing storage as "<storage>:<volume>".
_DISK_KEY_RE = _re.compile(r"^(?:scsi|virtio|sata|ide|efidisk|tpmstate|mp)\d+$|^rootfs$")

_NET_IFACE_KEEP = (
    "iface", "type", "active", "autostart", "method", "method6",
    "cidr", "address", "netmask", "gateway", "bridge_ports",
    "bridge_vlan_aware", "slaves", "bond_slaves", "bond_mode",
    "mtu", "comments", "families",
)

def _parse_guest_net(val: str) -> dict:
    """Parse a Proxmox guest ``net<N>`` config string.

    qemu: ``virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=100,firewall=1``
    lxc:  ``name=eth0,bridge=vmbr0,tag=20,hwaddr=AA:BB:..,ip=dhcp``
    Returns ``{bridge, tag, hwaddr}`` (tag is an int VLAN id or None)."""
    out = {"bridge": "", "tag": None, "hwaddr": ""}
    _models = ("virtio", "e1000", "vmxnet3", "rtl8139", "e1000e")
    for part in str(val or "").split(","):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        k = k.strip(); v = v.strip()
        if k == "bridge":
            out["bridge"] = v
        elif k == "tag":
            try: out["tag"] = int(v)
            except Exception: pass
        elif k == "hwaddr":
            out["hwaddr"] = v
        elif k in _models and ":" in v and not out["hwaddr"]:
            out["hwaddr"] = v  # qemu carries the MAC as the model's value
    return out

async def _fetch_guest_netcfg(base: str, headers: dict, guests: list) -> list:
    """One entry per guest NIC: {vmid,name,node,type,status,dev,bridge,tag,hwaddr}.
    Cached for 5 minutes — a guest's bridge/VLAN wiring almost never changes.
    The same per-guest config fetch also yields each guest's backing STORAGES
    (disk keys are "<storage>:<volume>") — cached alongside as
    _guest_netcfg_cache["disks"] = {vmid: [storage, …]} for the per-storage
    guest-I/O attribution. Zero extra API calls."""
    now = time.time()
    if now - _guest_netcfg_cache["ts"] < 300 and _guest_netcfg_cache["guests"]:
        return _guest_netcfg_cache["guests"]

    async def one(g):
        node = g.get("node"); vmid = g.get("vmid")
        kind = "qemu" if g.get("type") == "qemu" else "lxc"
        r = await _safe_get(f"{base}/nodes/{node}/{kind}/{vmid}/config", headers=headers)
        cfg = (r or {}).get("data") or {}
        nics = []
        stors: set = set()
        for k in sorted(cfg.keys()):
            if _DISK_KEY_RE.match(k):
                val = str(cfg[k] or "")
                # "<storage>:<vol>[,opts]" — skip passthrough ("/dev/…") and
                # cdrom media (a mounted ISO must not attribute guest I/O to
                # the ISO store).
                head = val.split(",", 1)[0]
                if ":" in head and not head.startswith("/") and "media=cdrom" not in val:
                    stors.add(head.split(":", 1)[0])
                continue
            if not _re.match(r"^net\d+$", k):
                continue
            p = _parse_guest_net(cfg[k])
            nics.append({
                "vmid": vmid, "name": g.get("name") or str(vmid), "node": node,
                "type": kind, "status": g.get("status") or "",
                "dev": k, "bridge": p["bridge"], "tag": p["tag"], "hwaddr": p["hwaddr"],
            })
        return vmid, nics, stors

    tasks = [one(g) for g in guests if g.get("node") and g.get("vmid") is not None]
    result: list = []
    disks: dict = {}
    for res in await asyncio.gather(*tasks, return_exceptions=True):
        if isinstance(res, tuple):
            result.extend(res[1])
            if res[2]:
                disks[res[0]] = sorted(res[2])
    _guest_netcfg_cache["ts"] = now
    _guest_netcfg_cache["guests"] = result
    _guest_netcfg_cache["disks"] = disks
    return result

async def _fetch_node_networks(base: str, headers: dict, nodes: list,
                               vms: list, lxcs: list) -> dict:
    """Per-node interface lists + a derived per-node throughput rate.
    Offline nodes just yield an empty list (each call is fault-isolated)."""
    online = [n.get("node") for n in nodes
              if n.get("node") and n.get("status") != "offline"]

    async def one(node):
        r = await _safe_get(f"{base}/nodes/{node}/network", headers=headers)
        ifaces = (r or {}).get("data") or []
        out = []
        for i in ifaces:
            out.append({k: i.get(k) for k in _NET_IFACE_KEEP if i.get(k) is not None})
        return node, out

    per: dict = {}
    for res in await asyncio.gather(*[one(n) for n in online], return_exceptions=True):
        if isinstance(res, tuple):
            per[res[0]] = res[1]

    # Throughput: sum each node's guests' cumulative net counters, then diff
    # against the previous poll to get bytes/sec. Guard counter resets (negative
    # delta) and the first poll (no prior sample) as 0. The same pass keeps
    # PER-GUEST rates (Top-guest views on the Network page).
    now = time.time()
    node_sum: dict = {}
    guest_rates: dict = {}
    for g in list(vms) + list(lxcs):
        nd = g.get("node")
        if not nd:
            continue
        gin = int(g.get("netin") or 0); gout = int(g.get("netout") or 0)
        s = node_sum.setdefault(nd, {"in": 0, "out": 0})
        s["in"] += gin
        s["out"] += gout
        vmid = g.get("vmid")
        if vmid is not None:
            prevg = _guest_rate_cache.get(vmid)
            grin = grout = 0.0
            if prevg:
                dt = now - prevg["ts"]
                if dt > 0:
                    di = gin - prevg["in"]; do = gout - prevg["out"]
                    if di >= 0: grin = di / dt
                    if do >= 0: grout = do / dt
            _guest_rate_cache[vmid] = {"in": gin, "out": gout, "ts": now}
            guest_rates[str(vmid)] = {"in": round(grin), "out": round(grout)}
    traffic: dict = {}
    for nd, s in node_sum.items():
        prev = _net_rate_cache.get(nd)
        rin = rout = 0.0
        if prev:
            dt = now - prev["ts"]
            if dt > 0:
                di = s["in"] - prev["in"]; do = s["out"] - prev["out"]
                if di >= 0: rin = di / dt
                if do >= 0: rout = do / dt
        _net_rate_cache[nd] = {"in": s["in"], "out": s["out"], "ts": now}
        traffic[nd] = {"in": round(rin), "out": round(rout)}
    return {"nodes": per, "traffic": traffic, "guest_rates": guest_rates}

def _storage_io_rates(vms: list, lxcs: list, guest_storages: dict) -> dict:
    """Per-storage guest I/O rates (bytes/sec), derived by diffing each guest's
    cumulative diskread/diskwrite counters between polls and attributing them to
    the guest's backing storage(s). A guest with disks on N storages splits its
    counters 1/N (approximate, but never double-counts); host-side traffic
    (backups, migrations, Ceph rebalance) is not visible here."""
    now = time.time()
    sums: dict = {}   # storage -> [read_bytes, write_bytes]
    for g in list(vms) + list(lxcs):
        vmid = g.get("vmid")
        stors = guest_storages.get(vmid) or []
        if not stors:
            continue
        share = 1.0 / len(stors)
        for st in stors:
            s = sums.setdefault(st, [0.0, 0.0])
            s[0] += (g.get("diskread") or 0) * share
            s[1] += (g.get("diskwrite") or 0) * share
    rates: dict = {}
    for st, (rd, wr) in sums.items():
        prev = _stor_io_cache.get(st)
        r_bps = w_bps = 0.0
        if prev:
            dt = now - prev["ts"]
            if dt > 0:
                dr = rd - prev["read"]; dw = wr - prev["write"]
                if dr >= 0: r_bps = dr / dt
                if dw >= 0: w_bps = dw / dt
        _stor_io_cache[st] = {"read": rd, "write": wr, "ts": now}
        rates[st] = {"read": round(r_bps), "write": round(w_bps)}
    return rates

# Content inventory (what actually lives on each storage) — one API call per
# storage (shared: any one online node; local: every online node), cached for
# 10 minutes since volume lists move slowly and PBS datastores can be slow.
_stor_content_cache: dict = {"ts": 0.0, "content": {}}

def _backup_guest_key(volid: str):
    """The guest a backup archive belongs to (`vm/100`, `ct/123`), or None.
    Used to collapse a guest's many snapshots into one entry so the treemap
    reflects the whole datastore instead of only its 8 largest raw snapshots."""
    m = _re.search(r"backup/(vm|ct|host)/([^/]+)/", volid or "")
    if m:
        return m.group(1) + "/" + m.group(2)
    m = _re.search(r"vzdump-(qemu|lxc)-(\d+)-", volid or "")
    if m:
        return ("vm" if m.group(1) == "qemu" else "ct") + "/" + m.group(2)
    return None


async def _fetch_storage_content(base: str, headers: dict, nodes: list, storage_rows: list) -> dict:
    now = time.time()
    if now - _stor_content_cache["ts"] < 600 and _stor_content_cache["content"]:
        return _stor_content_cache["content"]
    online = {n.get("node") for n in nodes if n.get("node") and n.get("status") == "online"}

    # Which (storage, node) pairs to query: shared → first online node that has
    # the row; local → every online node that reports the row.
    pairs: list = []
    seen_shared: set = set()
    for s in storage_rows:
        name, node = s.get("storage"), s.get("node")
        if not name or node not in online:
            continue
        if s.get("shared"):
            if name in seen_shared:
                continue
            seen_shared.add(name)
        pairs.append((name, node))

    async def one(name, node):
        # Generous timeout: a PBS store with thousands of snapshots returns a large
        # content list that can take well over the default few seconds.
        r = await _safe_get(f"{base}/nodes/{node}/storage/{name}/content", headers=headers, timeout=25)
        return name, ((r or {}).get("data") or [])

    out: dict = {}
    for res in await asyncio.gather(*[one(n, nd) for n, nd in pairs], return_exceptions=True):
        if not isinstance(res, tuple):
            continue
        name, vols = res
        agg = out.setdefault(name, {"classes": {}, "top": []})
        for v in vols:
            cls = str(v.get("content") or "other")
            c = agg["classes"].setdefault(cls, {"count": 0, "bytes": 0})
            c["count"] += 1
            c["bytes"] += int(v.get("size") or 0)
            agg["top"].append({"volid": v.get("volid") or "", "size": int(v.get("size") or 0),
                               "vmid": v.get("vmid"), "format": v.get("format") or "",
                               "content": cls})
    # Aggregate the FULL volume list per store so the treemap represents the whole
    # datastore, not just its 8 largest raw volumes: a guest's backup snapshots
    # collapse into one entry (summed size + snapshot count), disk images stay
    # per-volume. Then keep the largest ~20 — enough that the "beyond top" remainder
    # is small for most stores.
    for agg in out.values():
        groups: dict = {}
        for v in agg["top"]:
            gk = _backup_guest_key(v["volid"]) if v.get("content") == "backup" else None
            key = ("b:" + gk) if gk else ("v:" + (v.get("volid") or ""))
            g = groups.get(key)
            if g is None:
                groups[key] = {"volid": v["volid"], "size": v["size"], "vmid": v.get("vmid"),
                               "format": v.get("format") or "", "content": v.get("content") or "other",
                               "count": 1}
            else:
                g["size"] += v["size"]
                g["count"] += 1
        # Guests are bounded (a few dozen even with thousands of snapshots), so
        # keep a generous cap — enough that the frontend's "beyond top" remainder
        # is ~0 for a normal cluster.
        agg["top"] = sorted(groups.values(), key=lambda x: -x["size"])[:60]
    # Resilience: a store whose content fetch timed out this cycle comes back empty
    # (a big PBS store is the usual victim). Never blank a store that had good data —
    # keep its last-known-good entry rather than dropping it from the treemap.
    prev = _stor_content_cache.get("content") or {}
    for name, pagg in prev.items():
        cur = out.get(name)
        if (not cur or not cur.get("top")) and pagg.get("top"):
            out[name] = pagg
    _stor_content_cache["ts"] = now
    _stor_content_cache["content"] = out
    return out

# Physical disks behind node-local storages (Storage page DRIVES cells). Only
# ZFS- and LVM-backed stores are mappable through the Proxmox API (VG → PVs via
# /disks/lvm, pool → vdev leaves via /disks/zfs/{pool}); remote-backed stores
# (PBS/NFS/CIFS/RBD) keep their disks on another machine, so they never appear
# here and the DRIVES column simply hides. Cached 10 min like content.
_stor_drives_cache: dict = {"ts": 0.0, "drives": {}}
# PBS datastore name → PVE storage id, refreshed alongside the drives cache.
_pbs_storage_map: dict = {}

def _osdid_of(dk: dict):
    """Ceph OSD id of a /disks/list entry, or None. PVE quirk: osdid is int -1
    for non-OSD disks but a STRING (e.g. "1") for OSD disks."""
    try:
        v = int(dk.get("osdid"))
        return v if v >= 0 else None
    except (TypeError, ValueError):
        return None

def _smart_temp(sd) -> int | None:
    """Temperature (°C) out of a /disks/smart response — ATA reports it in the
    attributes table, NVMe in the raw text block. None when absent."""
    if not isinstance(sd, dict):
        return None
    for a in (sd.get("attributes") or []):
        if "temperature" in str(a.get("name", "")).lower():
            try:
                return int(str(a.get("raw", "")).split()[0])
            except (ValueError, IndexError):
                pass
    m = _re.search(r"[Tt]emperature[^0-9]*(\d+)", str(sd.get("text") or ""))
    return int(m.group(1)) if m else None

# SMART attribute ids that carry SSD life-remaining as their NORMALIZED value
# (counts down from 100): 173 wear-leveling (SandForce/HP), 177 Samsung,
# 202 Micron percent-lifetime, 231 SSD_Life_Left, 233 Intel media wearout.
_WEAR_ATTR_IDS = {173, 177, 202, 231, 233}

def _smart_wear(sd) -> int | None:
    """SSD life-remaining %, derived from SMART when PVE's own `wearout`
    parser doesn't recognize the drive's wear attribute."""
    if not isinstance(sd, dict):
        return None
    for a in (sd.get("attributes") or []):
        try:
            aid = int(a.get("id"))
        except (TypeError, ValueError):
            continue
        name = str(a.get("name", "")).lower()
        if aid in _WEAR_ATTR_IDS or "wearout" in name or "wear_leveling" in name or "life_left" in name:
            try:
                v = int(a.get("value"))
                if 0 <= v <= 100:
                    return v
            except (TypeError, ValueError):
                pass
    return None

async def _fetch_storage_drives(base: str, headers: dict, nodes: list, storage_rows: list) -> dict:
    now = time.time()
    if now - _stor_drives_cache["ts"] < 600 and _stor_drives_cache["drives"]:
        return _stor_drives_cache["drives"]
    online = [n.get("node") for n in nodes if n.get("node") and n.get("status") == "online"]
    if not online:
        return _stor_drives_cache["drives"]

    # Cluster storage config → which VG / ZFS pool backs each storage id.
    cfg_r = await _safe_get(f"{base}/storage", headers=headers)
    vg_stores: dict = {}    # vgname   -> [storage]
    pool_stores: dict = {}  # zfs pool -> [storage]
    for c in ((cfg_r or {}).get("data") or []):
        t = c.get("type")
        if t in ("lvm", "lvmthin") and c.get("vgname"):
            vg_stores.setdefault(str(c["vgname"]), []).append(c.get("storage"))
        elif t == "zfspool" and c.get("pool"):
            pool_stores.setdefault(str(c["pool"]).split("/")[0], []).append(c.get("storage"))
        elif t == "pbs" and c.get("datastore"):
            # PBS datastore name → PVE storage id (they often match, but are
            # NOT guaranteed to) — lets the Backups page join a datastore to
            # the usage history recorded under its PVE storage id.
            _pbs_storage_map[str(c["datastore"])] = c.get("storage")
    # Ceph-backed storages: OSD disks (marked by `osdid` in /disks/list) get
    # attributed to every rbd/cephfs storage — they back the whole cluster.
    ceph_stores = [c.get("storage") for c in ((cfg_r or {}).get("data") or [])
                   if c.get("type") in ("rbd", "cephfs")]
    if not vg_stores and not pool_stores and not ceph_stores:
        _stor_drives_cache["ts"] = now
        _stor_drives_cache["drives"] = {}
        return {}

    # Which storages actually exist on which nodes (drives attach per node).
    node_stores: dict = {}
    for s in storage_rows:
        if s.get("node") and s.get("storage"):
            node_stores.setdefault(s["node"], set()).add(s["storage"])

    sem = asyncio.Semaphore(8)
    async def _get(path):
        # /disks/list runs smartctl per disk server-side and routinely exceeds
        # _safe_get's 6s default — give the disk endpoints room to answer.
        async with sem:
            r = await _safe_get(f"{base}{path}", headers=headers, timeout=20)
        return (r or {}).get("data")

    async def one_node(node):
        here = node_stores.get(node) or set()
        disks, lvm = await asyncio.gather(
            _get(f"/nodes/{node}/disks/list"), _get(f"/nodes/{node}/disks/lvm"))
        by_dev = {d.get("devpath"): d for d in (disks or []) if d.get("devpath")}
        def find_disk(name):
            # Leaves may be '/dev/sda3', 'sda3' or partition paths — walk back
            # to the parent disk ('/dev/nvme0n1p2' → '/dev/nvme0n1').
            n = str(name or "")
            if not n:
                return None
            if not n.startswith("/dev/"):
                n = "/dev/" + n
            return by_dev.get(n) or by_dev.get(_re.sub(r"p?\d+$", "", n))
        found = []  # (storage, disk-dict)
        # Ceph OSD disks: /disks/list marks them with osdid — same SMART/wear
        # fields as any other disk, attributed to the rbd/cephfs storages so
        # OSDs get the exact same drive treatment as everything else.
        # NB: PVE returns osdid as int -1 for non-OSD disks but as a STRING
        # ("1") for OSD disks — coerce before comparing.
        for dk in (disks or []):
            if _osdid_of(dk) is not None:
                found.extend((st, dk) for st in ceph_stores if st in here)
        vg_list = (lvm or {}).get("children") if isinstance(lvm, dict) else (lvm or [])
        for vg in (vg_list or []):
            stores = [st for st in vg_stores.get(str(vg.get("name")), []) if st in here]
            if not stores:
                continue
            for pv in (vg.get("children") or []):
                dk = find_disk(pv.get("name"))
                if dk:
                    found.extend((st, dk) for st in stores)
        # ZFS pools present on this node that back a storage here.
        want_pools = [p for p, sts in pool_stores.items() if any(st in here for st in sts)]
        if want_pools:
            have = {p.get("name") for p in (await _get(f"/nodes/{node}/disks/zfs")) or []}
            want_pools = [p for p in want_pools if p in have]
            details = await asyncio.gather(
                *[_get(f"/nodes/{node}/disks/zfs/{p}") for p in want_pools],
                return_exceptions=True)
            for pname, det in zip(want_pools, details):
                if not isinstance(det, dict):
                    continue
                leaves: list = []
                def zwalk(ch):
                    for c in (ch or []):
                        if c.get("children"):
                            zwalk(c["children"])
                        else:
                            leaves.append(c.get("name"))
                zwalk(det.get("children"))
                stores = [st for st in pool_stores[pname] if st in here]
                for lf in leaves:
                    dk = find_disk(lf)
                    if dk:
                        found.extend((st, dk) for st in stores)
        # Temperature for every shipped disk — /disks/list doesn't carry it,
        # the per-disk SMART endpoint does. One call per unique disk, inside
        # the same 10-min cache; failures just leave temp unset.
        devs = sorted({dk.get("devpath") for _, dk in found if dk.get("devpath")})
        async def _temp_of(dev):
            sd = await _get(f"/nodes/{node}/disks/smart?disk={urllib.parse.quote(dev)}")
            return dev, _smart_temp(sd), _smart_wear(sd)
        for res in await asyncio.gather(*[_temp_of(d) for d in devs], return_exceptions=True):
            if isinstance(res, tuple) and res[0] in by_dev:
                if res[1] is not None:
                    by_dev[res[0]]["_temp"] = res[1]
                if res[2] is not None:
                    by_dev[res[0]]["_wear"] = res[2]
        return node, found

    drives: dict = {}
    for res in await asyncio.gather(*[one_node(n) for n in online], return_exceptions=True):
        if not isinstance(res, tuple):
            continue
        node, found = res
        for st, dk in found:
            lst = drives.setdefault(st, [])
            if any(e["node"] == node and e["devpath"] == dk.get("devpath") for e in lst):
                continue
            wear = dk.get("wearout")
            if not isinstance(wear, (int, float)):
                wear = dk.get("_wear")   # SMART-derived fallback
            lst.append({
                "node": node, "devpath": dk.get("devpath") or "",
                "model": dk.get("model") or "", "serial": dk.get("serial") or "",
                "vendor": dk.get("vendor") or "", "size": int(dk.get("size") or 0),
                "type": str(dk.get("type") or "").lower(),
                "health": str(dk.get("health") or ""),
                "wearout": wear if isinstance(wear, (int, float)) else None,
                "rpm": dk.get("rpm") if isinstance(dk.get("rpm"), (int, float)) else None,
                "used": str(dk.get("used") or ""),
                "osdid": _osdid_of(dk),
                "temp": dk.get("_temp"),
            })
    for lst in drives.values():
        lst.sort(key=lambda d: (d["node"], d["devpath"]))
    _stor_drives_cache["ts"] = now
    _stor_drives_cache["drives"] = drives
    return drives

# Per-node health extras (apt updates, reboot-required, cert expiry) — slow to
# change, so cached 10 min. Every call is best-effort: PVEAuditor may not see
# apt/certificates on all builds, in which case that node's field stays None.
_node_health_cache: dict = {"ts": 0.0, "data": {}}

async def _fetch_node_health(base: str, headers: dict, nodes: list) -> dict:
    now = time.time()
    if now - _node_health_cache["ts"] < 600 and _node_health_cache["data"]:
        return _node_health_cache["data"]
    online = [n.get("node") for n in nodes if n.get("node") and n.get("status") == "online"]
    async def one(node):
        apt, certs = await asyncio.gather(
            _safe_get(f"{base}/nodes/{node}/apt/update", headers=headers),
            _safe_get(f"{base}/nodes/{node}/certificates/info", headers=headers),
            return_exceptions=True)
        out = {}
        if isinstance(apt, dict):
            pkgs = apt.get("data") or []
            out["updates"] = len(pkgs)
            out["reboot_required"] = any("kernel" in str(p.get("Package", "")).lower()
                                         or p.get("Priority") == "important" for p in pkgs) or None
        if isinstance(certs, dict):
            # The pveproxy cert (or any) with the SOONEST expiry.
            days = [int((c.get("notafter", 0) - now) / 86400)
                    for c in (certs.get("data") or []) if c.get("notafter")]
            if days:
                out["cert_days"] = min(days)
        return node, out
    data = {}
    for res in await asyncio.gather(*[one(n) for n in online], return_exceptions=True):
        if isinstance(res, tuple):
            data[res[0]] = res[1]
    _node_health_cache["ts"] = now
    _node_health_cache["data"] = data
    return data


# Recent cluster tasks → the Health page incident timeline. /cluster/tasks is a
# rolling ring of the last ~50 tasks/node (backups, migrations, starts, etc.).
# Cached 60s. Each task: type, status ('OK' or an error string), node, id,
# user, start/end. We surface failures + notable ops; the frontend ranks them.
async def fetch_cluster_tasks() -> dict:
    cfg = config.get("proxmox", {})
    if not cfg.get("enabled"):
        return {}
    base = cfg["url"].rstrip("/")
    headers = {}
    secret = cfg.get("token_secret", "")
    if cfg.get("token_id") and secret and not secret.startswith("REPLACE"):
        headers["Authorization"] = f"PVEAPIToken={cfg['token_id']}={secret}"
    try:
        # /cluster/tasks returns the cluster's recent task list (it doesn't take a
        # limit param — passing one 400s). We keep the last 7 days, capped below.
        r = await _safe_get(f"{base}/cluster/tasks", headers=headers)
        raw = (r or {}).get("data") or []
        cutoff = time.time() - 7 * 86400
        out = []
        for t in raw:
            st = t.get("starttime") or 0
            if st < cutoff:
                continue
            status = t.get("status")  # None = still running; "OK" = ok; else error
            out.append({
                "type": t.get("type") or "", "id": t.get("id") or "",
                "node": t.get("node") or "", "user": t.get("user") or "",
                "start": st, "end": t.get("endtime"),
                "status": status,
                "ok": status == "OK", "running": status is None,
                "failed": bool(status) and status != "OK",
            })
        out.sort(key=lambda x: x["start"], reverse=True)
        return {"tasks": out[:400]}
    except Exception as e:
        log.warning(f"cluster tasks: {type(e).__name__}: {e}")
        return {"error": str(e)}


async def fetch_proxmox() -> dict:
    cfg = config.get("proxmox", {})
    if not cfg.get("enabled"):
        return {}
    base = cfg["url"].rstrip("/")
    headers = {}
    secret = cfg.get("token_secret", "")
    if cfg.get("token_id") and secret and not secret.startswith("REPLACE"):
        headers["Authorization"] = f"PVEAPIToken={cfg['token_id']}={secret}"

    try:
        nodes_r, res_r, status_r = await asyncio.gather(
            http_get(f"{base}/nodes", headers=headers),
            http_get(f"{base}/cluster/resources", headers=headers),
            _safe_get(f"{base}/cluster/status", headers=headers),
        )
        nodes = (nodes_r or {}).get("data") or []
        resources = (res_r or {}).get("data") or []
        node_ips = {it.get("name"): it.get("ip", "") for it in ((status_r or {}).get("data") or [])
                    if it.get("type") == "node"}
        for n in nodes:
            n["ip"] = node_ips.get(n.get("node"), "")

        # Per-node vitals: load avg + IO wait (Overview Utilization chart) come
        # from the status endpoint, which ALSO carries PVE/kernel version for
        # free. Fault-isolated — a node that won't answer records no sample.
        async def _node_load(n):
            r = await _safe_get(f"{base}/nodes/{n['node']}/status", headers=headers)
            d = ((r or {}).get("data") or {})
            la = d.get("loadavg") or []
            try:
                n["loadavg"] = float(la[0])
            except (TypeError, ValueError, IndexError):
                n["loadavg"] = None
            try:
                n["iowait"] = float(d.get("wait")) if d.get("wait") is not None else None
            except (TypeError, ValueError):
                n["iowait"] = None
            # pveversion is "pve-manager/9.0.11/<githash>" — keep just the number.
            pv = str(d.get("pveversion") or "").replace("pve-manager/", "")
            n["pveversion"] = pv.split("/")[0]
            # kversion is "Linux 6.14.11-4-pve #1 SMP …" — keep just the release.
            kv = str(d.get("kversion") or (d.get("current-kernel") or {}).get("release") or "")
            m = _re.search(r"\d+\.\d+\.[\w.-]+", kv)
            n["kernel"] = m.group(0) if m else ""
        await asyncio.gather(*[_node_load(n) for n in nodes if n.get("status") == "online"],
                             return_exceptions=True)

        # Health-page extras (slow-moving → 10-min cached, fault-isolated): per
        # node the count of pending apt updates + reboot-required, and the
        # pveproxy TLS cert's days-to-expiry. Token may lack apt/cert perms on
        # some setups → the field just stays absent and the UI hides it.
        node_health = await _fetch_node_health(base, headers, nodes)
        for n in nodes:
            nh = node_health.get(n.get("node")) or {}
            n["updates"] = nh.get("updates")
            n["reboot_required"] = nh.get("reboot_required")
            n["cert_days"] = nh.get("cert_days")

        exclude = set(cfg.get("exclude_vmids") or [])
        vms, lxcs, storage = [], [], []
        for r in resources:
            t = r.get("type")
            if t == "qemu":
                if r.get("vmid") in exclude: continue
                vms.append(r)
            elif t == "lxc":
                if r.get("vmid") in exclude: continue
                lxcs.append(r)
            elif t == "storage":
                storage.append(r)

        if not nodes and not headers:
            return {"error": "No API token set — add token_id and token_secret to config.yaml"}

        try:
            gips = await _fetch_guest_ips(base, headers, vms, lxcs)
            for g in vms + lxcs:
                g["ip"] = gips.get(g.get("vmid"), "")
        except Exception:
            pass

        # Networking view (bridges, node NICs/bonds, guest→bridge attachment,
        # per-node throughput). Each part is fault-isolated so a partial failure
        # (e.g. one offline node) still ships what did resolve.
        network = {"nodes": {}, "guests": [], "traffic": {}, "guest_rates": {}}
        storage_io: dict = {}
        storage_content: dict = {}
        try:
            ni = await _fetch_node_networks(base, headers, nodes, vms, lxcs)
            network["nodes"] = ni.get("nodes", {})
            network["traffic"] = ni.get("traffic", {})
            network["guest_rates"] = ni.get("guest_rates", {})
        except Exception as e:
            log.warning(f"proxmox network: {type(e).__name__}: {e}")
        try:
            network["guests"] = await _fetch_guest_netcfg(base, headers, vms + lxcs)
        except Exception as e:
            log.warning(f"proxmox guest netcfg: {type(e).__name__}: {e}")
        # Per-storage guest I/O rates (Storage page THROUGHPUT charts) — uses the
        # guest→storage map cached by _fetch_guest_netcfg just above.
        try:
            storage_io = _storage_io_rates(vms, lxcs, _guest_netcfg_cache.get("disks") or {})
        except Exception as e:
            log.warning(f"proxmox storage io: {type(e).__name__}: {e}")
        # Content inventory (Storage page CONTENT cells) — 10-min cached.
        try:
            storage_content = await _fetch_storage_content(base, headers, nodes, storage)
        except Exception as e:
            log.warning(f"proxmox storage content: {type(e).__name__}: {e}")
        # Physical disks behind ZFS/LVM stores (Storage page DRIVES cells).
        storage_drives: dict = {}
        try:
            storage_drives = await _fetch_storage_drives(base, headers, nodes, storage)
        except Exception as e:
            log.warning(f"proxmox storage drives: {type(e).__name__}: {e}")

        web_url = cfg["url"].rstrip("/").replace("/api2/json", "")
        return {
            "nodes": nodes,
            "vms": vms,
            "lxcs": lxcs,
            "storage": storage,
            "storage_io": storage_io,
            "storage_content": storage_content,
            "storage_drives": storage_drives,
            "pbs_storage_map": dict(_pbs_storage_map),
            "web_url": web_url,
            "network": network,
        }
    except Exception as e:
        log.warning(f"proxmox: {type(e).__name__}: {e}")
        return {"error": str(e)}

# ── Ceph (Proxmox cluster) ─────────────────────────────────────────────────

def _parse_smart_temp(smart: dict) -> float | None:
    """Extract drive temperature in °C from a Proxmox /disks/smart response.
    Handles ATA attribute tables, NVMe key/value lists, and raw smartctl text."""
    attrs = smart.get("attributes") or []
    # ATA: attribute id 194 (Temperature_Celsius) or 190 (Airflow_Temperature_Cel)
    for a in attrs:
        try: aid = int(a.get("id"))
        except Exception: aid = None
        if aid in (194, 190):
            raw = str(a.get("raw") or "")
            m = _re.match(r"\s*(\d+)", raw)
            if m:
                try: return float(m.group(1))
                except Exception: pass
            try: return float(a.get("value"))
            except Exception: pass
    # NVMe / generic: attribute name contains "temp"
    for a in attrs:
        if "temp" in (a.get("name") or "").lower():
            raw = str(a.get("raw") or a.get("value") or "")
            m = _re.search(r"(-?\d+)", raw)
            if m:
                try: return float(m.group(1))
                except Exception: pass
    # Last resort: parse smartctl text output
    text = smart.get("text") or ""
    m = _re.search(r"Temperature_Celsius\b[^\n]*?(\d+)\s*(?:\(|$)", text)
    if m:
        try: return float(m.group(1))
        except Exception: pass
    m = _re.search(r"^\s*Temperature:\s*(\d+)", text, _re.M)
    if m:
        try: return float(m.group(1))
        except Exception: pass
    return None

async def fetch_ceph() -> dict:
    cfg = config.get("proxmox", {})
    if not cfg.get("enabled"):
        return {}
    base = cfg["url"].rstrip("/")
    secret = cfg.get("token_secret", "")
    if not (cfg.get("token_id") and secret and not secret.startswith("REPLACE")):
        return {}
    headers = {"Authorization": f"PVEAPIToken={cfg['token_id']}={secret}"}
    try:
        s_r, nodes_r = await asyncio.gather(
            http_get(f"{base}/cluster/ceph/status", headers=headers, timeout=8),
            http_get(f"{base}/nodes", headers=headers, timeout=5),
            return_exceptions=True,
        )
        if isinstance(s_r, Exception): raise s_r
        s = (s_r or {}).get("data") or {}
        if not s:
            return {"status": "offline", "error": "no ceph cluster"}
        pg = s.get("pgmap") or {}
        osd = s.get("osdmap") or {}
        health = (s.get("health") or {}).get("status") or "UNKNOWN"
        bytes_used  = int(pg.get("bytes_used")  or 0)
        bytes_total = int(pg.get("bytes_total") or 0)
        pct = (bytes_used / bytes_total * 100) if bytes_total else 0
        pgs_by_state = pg.get("pgs_by_state") or []
        pg_states = {p.get("state_name", "?"): int(p.get("count") or 0) for p in pgs_by_state}

        # Per-OSD details from /nodes/{node}/ceph/osd (nested tree under root.children)
        # Per-pool details from /nodes/{node}/ceph/pool (Volumes-equivalent)
        osds = []
        pools = []
        node_list = (nodes_r or {}).get("data") or [] if not isinstance(nodes_r, Exception) else []
        # Build osdid -> temperature map by querying /disks/list on each online node.
        # Proxmox tags each disk that hosts an OSD with `osdid`, giving us a direct
        # link from physical drive (with SMART temp) back to the Ceph OSD.
        # /disks/list returns `temperature` only when smartctl can read it cheaply;
        # NVMe and some HBA-attached drives need a per-disk /disks/smart call.
        osd_temps: dict[int, float] = {}
        osd_disks: list[tuple[int, str, str]] = []  # (osd_id, devpath, node_name)
        active_nodes = [n['node'] for n in node_list if n.get("status") == "online" and n.get("node")]
        disk_calls = [
            http_get(f"{base}/nodes/{nname}/disks/list", headers=headers, timeout=8)
            for nname in active_nodes
        ]
        if disk_calls:
            for nname, d_r in zip(active_nodes, await asyncio.gather(*disk_calls, return_exceptions=True)):
                if isinstance(d_r, Exception): continue
                for d in ((d_r or {}).get("data") or []):
                    oid = d.get("osdid")
                    if oid is None or oid == -1: continue
                    try: oid_i = int(oid)
                    except Exception: continue
                    t = d.get("temperature")
                    if t is not None:
                        try: osd_temps[oid_i] = round(float(t), 1)
                        except Exception: pass
                    dev = d.get("devpath")
                    if dev: osd_disks.append((oid_i, dev, nname))

        # Fallback: for OSDs without temp from /disks/list, query SMART directly.
        missing = [(oid, dev, node) for (oid, dev, node) in osd_disks if oid not in osd_temps]
        if missing:
            smart_calls = [
                http_get(f"{base}/nodes/{node}/disks/smart?disk={urllib.parse.quote(dev, safe='/')}",
                         headers=headers, timeout=8)
                for (_, dev, node) in missing
            ]
            for (oid, _, _), r in zip(missing, await asyncio.gather(*smart_calls, return_exceptions=True)):
                if isinstance(r, Exception): continue
                temp = _parse_smart_temp((r or {}).get("data") or {})
                if temp is not None:
                    osd_temps[oid] = round(temp, 1)
        for n in node_list:
            if n.get("status") != "online": continue
            node_name = n.get("node")
            if not node_name: continue
            try:
                osd_r = await http_get(f"{base}/nodes/{node_name}/ceph/osd", headers=headers, timeout=8)
                root = ((osd_r or {}).get("data") or {}).get("root") or {}
                found = []
                def walk(node, host=""):
                    t = node.get("type") if isinstance(node, dict) else None
                    if t == "osd":
                        try: osd_id = int(node.get("id"))
                        except Exception: osd_id = node.get("id")
                        size_bytes = int(node.get("total_space") or 0)
                        used_bytes = int(node.get("bytes_used") or 0)
                        pct = float(node.get("percent_used") or ((used_bytes/size_bytes*100) if size_bytes else 0))
                        found.append({
                            "id": osd_id,
                            "name": node.get("name") or f"osd.{osd_id}",
                            "host": node.get("host") or host,
                            "status": (node.get("status") or "").lower(),
                            "in_state": int(node.get("in") or 0),
                            "device_class": (node.get("device_class") or "").lower(),
                            "size_bytes": size_bytes,
                            "used_bytes": used_bytes,
                            "used_percent": round(pct, 1),
                            "pgs": int(node.get("pgs") or 0),
                            "temp": osd_temps.get(osd_id if isinstance(osd_id, int) else -999),
                        })
                        return
                    next_host = node.get("name") if t == "host" else host
                    for c in (node.get("children") or []):
                        walk(c, next_host)
                walk(root)
                if found:
                    found.sort(key=lambda o: o.get("id") if isinstance(o.get("id"), int) else 0)
                    osds = found
                try:
                    p_r = await http_get(f"{base}/nodes/{node_name}/ceph/pool", headers=headers, timeout=8)
                    for p in ((p_r or {}).get("data") or []):
                        pname = p.get("pool_name") or f"pool-{p.get('pool')}"
                        if pname == ".mgr":  # built-in mgr pool — not a user volume
                            continue
                        astatus = p.get("autoscale_status") or {}
                        replicas = int(p.get("size") or 1) or 1
                        raw_total = int(astatus.get("subtree_capacity") or 0)
                        usable_total = (raw_total // replicas) if replicas else raw_total
                        usable_used = int(astatus.get("logical_used") or (int(p.get("bytes_used") or 0) // replicas))
                        pct = (usable_used / usable_total * 100) if usable_total else 0
                        pools.append({
                            "name": pname,
                            "used_gb": round(usable_used / 1e9, 1),
                            "total_gb": round(usable_total / 1e9, 1),
                            "percent": round(pct, 1),
                            "replicas": replicas,
                        })
                    pools.sort(key=lambda x: x.get("total_gb") or 0, reverse=True)
                except Exception:
                    pass
                if osds or pools:
                    break
            except Exception:
                continue

        # Usable view: sum across user pools (post-replication). Excludes the
        # built-in .mgr pool to match what's shown in the Volumes section.
        usable_used  = sum(int(round((p.get("used_gb")  or 0) * 1e9)) for p in pools)
        usable_total = sum(int(round((p.get("total_gb") or 0) * 1e9)) for p in pools)
        usable_pct   = (usable_used / usable_total * 100) if usable_total else 0

        return {
            "status":         "online",
            "health":         health,
            "fsid":           s.get("fsid", ""),
            "mon_quorum":     s.get("quorum_names") or [],
            "quorum_age_s":   int(s.get("quorum_age") or 0),
            "bytes_used":     bytes_used,
            "bytes_total":    bytes_total,
            "bytes_avail":    int(pg.get("bytes_avail") or 0),
            "data_bytes":     int(pg.get("data_bytes") or 0),
            "usable_used_bytes":  usable_used,
            "usable_total_bytes": usable_total,
            "usable_percent":     round(usable_pct, 1),
            "used_percent":   round(pct, 1),
            "num_pools":      int(pg.get("num_pools") or 0),
            "num_pgs":        int(pg.get("num_pgs") or 0),
            "num_objects":    int(pg.get("num_objects") or 0),
            "pg_states":      pg_states,
            "num_osds":       int(osd.get("num_osds") or 0),
            "num_up_osds":    int(osd.get("num_up_osds") or 0),
            "num_in_osds":    int(osd.get("num_in_osds") or 0),
            "read_bytes_sec":  int(pg.get("read_bytes_sec")  or 0),
            "write_bytes_sec": int(pg.get("write_bytes_sec") or 0),
            "read_op_per_sec": int(pg.get("read_op_per_sec") or 0),
            "write_op_per_sec":int(pg.get("write_op_per_sec") or 0),
            "osds":            osds,
            "pools":           pools,
        }
    except Exception as e:
        log.warning(f"ceph: {type(e).__name__}: {e}")
        return {"status": "offline", "error": str(e)}

# ── Health checks ─────────────────────────────────────────────────────────

def _health_ring(name: str, up: bool, latency=None) -> list:
    """Append to a service's in-memory uptime ring buffer (shared by custom and
    auto checks) and return it."""
    entry = {"ts": time.time(), "up": bool(up), "latency_ms": latency}
    hist = _health_history.setdefault(name, [])
    hist = [(h if isinstance(h, dict) else {"up": bool(h), "latency_ms": None, "ts": 0}) for h in hist]
    hist.append(entry)
    if len(hist) > HEALTH_HISTORY_MAX:
        hist = hist[-HEALTH_HISTORY_MAX:]
    _health_history[name] = hist
    return hist

def _auto_health(px, ceph, pbs) -> dict:
    """Zero-config health derived from the Proxmox snapshot — the Health page
    works the moment the Proxmox API is set up, no per-service config needed:
    per-node up/down, cluster quorum, per-storage availability, Ceph health,
    PBS reachability. Entries share the custom-check shape ('up', 'history')
    so the heatmap, ring buffers and DB persistence all apply unchanged;
    'auto': True lets the frontend group them separately."""
    out: dict = {}

    def add(name, up, note=None):
        out[name] = {"up": bool(up), "latency_ms": None, "auto": True,
                     "error": None if up else (note or "down"), "note": note,
                     "history": _health_ring(name, up)}

    if isinstance(px, dict) and px.get("nodes"):
        nodes = px["nodes"]
        online = [n for n in nodes if n.get("status") == "online"]
        for n in sorted(nodes, key=lambda x: x.get("node") or ""):
            add(f"Node {n.get('node')}", n.get("status") == "online", n.get("status") or "unknown")
        if len(nodes) > 1:
            add("Cluster quorum", len(online) > len(nodes) / 2,
                f"{len(online)}/{len(nodes)} nodes online")
        # Storage availability — judged only from rows on ONLINE nodes: an
        # offline node still gets storage rows in cluster/resources (status
        # "unknown") and must not mark every store down.
        online_names = {n.get("node") for n in online}
        stor: dict = {}
        for s in (px.get("storage") or []):
            if not s.get("storage") or (s.get("node") and s["node"] not in online_names):
                continue
            ok = (s.get("status") or "available") == "available"
            stor[s["storage"]] = stor.get(s["storage"], True) and ok
        for name in sorted(stor):
            add(f"Storage {name}", stor[name], "available" if stor[name] else "unavailable")
    if isinstance(ceph, dict) and ceph.get("status") == "online":
        h = str(ceph.get("health") or "").upper()
        add("Ceph", "ERR" not in h, h.replace("HEALTH_", "") or "unknown")
    if isinstance(pbs, dict) and pbs.get("status"):
        add("PBS", pbs.get("status") == "online", pbs.get("status"))
    return out

async def fetch_health_checks() -> dict:
    cfg = config.get("health_checks", {})
    if not cfg.get("enabled"):
        return {}
    checks = cfg.get("services", [])
    # Run HTTP checks + SSL cert lookups in parallel
    http_results = await asyncio.gather(
        *[check_up_detailed(c["url"]) for c in checks], return_exceptions=True
    )
    ssl_results = await asyncio.gather(
        *[_ssl_cert_days(c["url"]) for c in checks], return_exceptions=True
    )
    out = {}
    now_ts = time.time()
    for c, r, cert in zip(checks, http_results, ssl_results):
        if isinstance(r, dict):
            up = r.get("up", False)
            latency = r.get("latency_ms")
            status_code = r.get("status")
            err = r.get("error")
        else:
            up, latency, status_code, err = False, None, None, "exception"
        cert_info = cert if isinstance(cert, dict) else {}
        # Ring-buffer entry: object instead of bare bool
        entry = {"ts": now_ts, "up": up, "latency_ms": latency}
        hist = _health_history.setdefault(c["name"], [])
        # Migrate legacy bool entries
        hist = [(h if isinstance(h, dict) else {"up": bool(h), "latency_ms": None, "ts": 0}) for h in hist]
        hist.append(entry)
        if len(hist) > HEALTH_HISTORY_MAX:
            hist = hist[-HEALTH_HISTORY_MAX:]
        _health_history[c["name"]] = hist
        out[c["name"]] = {
            "up": up,
            "url": c["url"],
            "latency_ms": latency,
            "status_code": status_code,
            "error": err,
            "cert_days_remaining": cert_info.get("days_remaining"),
            "cert_error": cert_info.get("error"),
            "history": hist,
        }
    return out

# ── Caddy access-log ingest (Access Map) ──────────────────────────────────
# ── PBS (Proxmox Backup Server) ───────────────────────────────────────────

async def fetch_pbs(include_details: bool = False) -> dict:
    cfg = config.get("pbs", {})
    if not cfg.get("enabled"):
        return {}
    base = _pbs_base(cfg["url"])
    headers = {}
    secret = cfg.get("token_secret", "")
    if cfg.get("token_id") and secret and not secret.startswith("REPLACE"):
        # PBS auth header uses `:` between token-id and secret. PVE uses `=`
        # for the same scheme — same prefix style, different separator. Easy
        # to copy-paste wrong since they look almost identical.
        headers["Authorization"] = f"PBSAPIToken={cfg['token_id']}:{secret}"
    else:
        return {"error": "No PBS API token configured"}

    try:
        ds_r = await http_get(f"{base}/api2/json/admin/datastore", headers=headers)
        datastores_raw = (ds_r or {}).get("data") or []
        result_ds = []
        all_snapshots = []
        for ds in datastores_raw:
            store = ds.get("store", "?")
            # /admin/datastore only returns the configured list — total/used/avail
            # come from /admin/datastore/{store}/status. Best-effort: a token with
            # only DatastoreReader can't see status on some PBS builds.
            total = used = avail = 0
            dedup = None
            try:
                # verbose=true adds gc-status (→ dedup factor) + per-type counts;
                # plain status is just total/used/avail. Older PBS builds ignore
                # the flag — dedup simply stays None and the UI hides it.
                st_r = await http_get(f"{base}/api2/json/admin/datastore/{store}/status?verbose=true", headers=headers)
                st = (st_r or {}).get("data") or {}
                total = st.get("total", 0) or 0
                used  = st.get("used", 0) or 0
                avail = st.get("avail", st.get("available", 0)) or 0
                gc = st.get("gc-status") or {}
                if gc.get("index-data-bytes") and gc.get("disk-bytes"):
                    dedup = round(gc["index-data-bytes"] / gc["disk-bytes"], 2)
            except Exception as e:
                log.warning(f"pbs status {store}: {type(e).__name__}: {e}")
            result_ds.append({
                "name": store,
                "total": total,
                "used":  used,
                "avail": avail,
                "percent": round(used / max(total, 1) * 100, 1) if total else 0.0,
                "dedup": dedup,
            })
            if include_details:
                # Snapshot lists can be thousands of rows and are deliberately
                # collected on a slower cadence than the datastore summary.
                try:
                    snap_r = await http_get(
                        f"{base}/api2/json/admin/datastore/{store}/snapshots",
                        headers=headers,
                        timeout=25,
                    )
                    snaps = (snap_r or {}).get("data") or []
                    for s in snaps[:1000]:
                        ver = s.get("verification") or {}
                        all_snapshots.append({
                            "datastore":   store,
                            "backup_id":   s.get("backup-id", "?"),
                            "backup_type": s.get("backup-type", "?"),
                            "backup_time": s.get("backup-time", 0),
                            "size":        s.get("size", 0),
                            "owner":       s.get("owner", ""),
                            "protected":   bool(s.get("protected")),
                            "verify_state": ver.get("state", ""),
                            "verify_time":  ver.get("upid", "") and 0,
                            "comment":     s.get("comment", ""),
                        })
                except Exception as e:
                    log.warning(f"pbs snapshots {store}: {type(e).__name__}: {e}")

        # Aggregate per (datastore, backup_type, backup_id): latest backup,
        # snapshot count, total size — drives the "by VM/CT" summary view.
        groups: Dict[tuple, dict] = {}
        for s in all_snapshots:
            key = (s["datastore"], s["backup_type"], s["backup_id"])
            g = groups.setdefault(key, {
                "datastore": s["datastore"],
                "backup_type": s["backup_type"],
                "backup_id": s["backup_id"],
                "count": 0,
                "total_size": 0,
                "latest_time": 0,
                "oldest_time": 0,
                "verified_count": 0,
                "failed_count": 0,
                "protected": False,
                "owner": s["owner"],
            })
            g["count"] += 1
            g["total_size"] += s["size"] or 0
            t = s["backup_time"] or 0
            if t > g["latest_time"]: g["latest_time"] = t
            if g["oldest_time"] == 0 or (t and t < g["oldest_time"]): g["oldest_time"] = t
            if s["verify_state"] == "ok":     g["verified_count"] += 1
            if s["verify_state"] == "failed": g["failed_count"] += 1
            if s["protected"]: g["protected"] = True

        web_url = cfg["url"].rstrip("/").replace("/api2/json", "")
        result = {
            "status": "online",
            "datastores": result_ds,
            "web_url": web_url,
            "fetched_at": time.time(),
        }
        if include_details:
            result["snapshots"] = all_snapshots
            result["groups"] = list(groups.values())
        return result
    except Exception as e:
        log.warning(f"pbs: {type(e).__name__}: {e}")
        return {"status": "offline", "error": str(e)}

# ── Security posture ──────────────────────────────────────────────────────
_security_cache: dict = {"ts": 0.0, "data": {}}

async def fetch_security() -> dict:
    """Read-only security posture from standard Proxmox APIs — access/identity,
    2FA coverage, API tokens, firewall, and per-node repo/subscription state.
    Every section is fetched independently and fault-isolated: a token without
    Sys.Audit on /access simply yields no users/tfa (the page hides that section)
    without breaking firewall/repos. Cached 10 min (this data changes rarely)."""
    cfg = config.get("proxmox", {})
    if not cfg.get("enabled"):
        return {}
    now = time.time()
    if now - _security_cache["ts"] < 600 and _security_cache["data"]:
        return _security_cache["data"]
    base = cfg["url"].rstrip("/")
    headers = {}
    secret = cfg.get("token_secret", "")
    if cfg.get("token_id") and secret and not secret.startswith("REPLACE"):
        headers["Authorization"] = f"PVEAPIToken={cfg['token_id']}={secret}"
    out: dict = {}
    try:
        nodesr = await _safe_get(f"{base}/nodes", headers=headers)
        nodes = sorted(n.get("node") for n in ((nodesr or {}).get("data") or []) if n.get("node"))

        # ── Access & identity: users (+tokens via full=1), realms, 2FA ────────
        usersr, domainsr, tfar = await asyncio.gather(
            _safe_get(f"{base}/access/users?full=1", headers=headers),
            _safe_get(f"{base}/access/domains", headers=headers),
            _safe_get(f"{base}/access/tfa", headers=headers),
            return_exceptions=True)
        tfa_map, tfa_known = {}, False
        if isinstance(tfar, dict) and tfar.get("data") is not None:
            tfa_known = True
            for u in tfar["data"]:
                uid = u.get("userid")
                if uid:
                    tfa_map[uid] = any(e.get("enable", 1) for e in (u.get("entries") or []))
        if isinstance(usersr, dict) and usersr.get("data") is not None:
            users, tokens = [], []
            for u in usersr["data"]:
                uid = u.get("userid") or ""
                users.append({
                    "userid": uid, "realm": uid.split("@")[-1] if "@" in uid else "",
                    "enable": u.get("enable", 1), "expire": u.get("expire", 0) or 0,
                    "comment": u.get("comment") or "",
                    "tfa": tfa_map.get(uid) if tfa_known else None,
                })
                for t in (u.get("tokens") or []):
                    tokens.append({
                        "owner": uid, "tokenid": t.get("tokenid") or "",
                        "privsep": t.get("privsep", 1), "expire": t.get("expire", 0) or 0,
                        "comment": t.get("comment") or "",
                    })
            out["users"] = users
            out["tokens"] = tokens
            out["tfa_known"] = tfa_known
        if isinstance(domainsr, dict) and domainsr.get("data") is not None:
            out["realms"] = [{"realm": d.get("realm"), "type": d.get("type") or "",
                              "comment": d.get("comment") or ""} for d in domainsr["data"]]

        # ── Firewall: cluster options + rule count ────────────────────────────
        fwo, fwr = await asyncio.gather(
            _safe_get(f"{base}/cluster/firewall/options", headers=headers),
            _safe_get(f"{base}/cluster/firewall/rules", headers=headers),
            return_exceptions=True)
        fw: dict = {}
        if isinstance(fwo, dict) and isinstance(fwo.get("data"), dict):
            o = fwo["data"]
            fw = {"enable": o.get("enable"), "policy_in": o.get("policy_in"),
                  "policy_out": o.get("policy_out"),
                  "log_in": o.get("log_level_in"), "log_out": o.get("log_level_out")}
        if isinstance(fwr, dict) and fwr.get("data") is not None:
            fw["rules"] = len(fwr["data"])
        if fw:
            out["firewall"] = fw

        # ── Per-node: firewall enable, repo posture, subscription ─────────────
        async def _node_sec(node):
            fo, repo, sub = await asyncio.gather(
                _safe_get(f"{base}/nodes/{node}/firewall/options", headers=headers),
                _safe_get(f"{base}/nodes/{node}/apt/repositories", headers=headers),
                _safe_get(f"{base}/nodes/{node}/subscription", headers=headers),
                return_exceptions=True)
            r = {"node": node}
            if isinstance(fo, dict) and isinstance(fo.get("data"), dict):
                r["fw_enable"] = fo["data"].get("enable")
            if isinstance(repo, dict) and isinstance(repo.get("data"), dict):
                ent = nosub = test = False
                for f in (repo["data"].get("files") or []):
                    for rp in (f.get("repositories") or []):
                        if not rp.get("Enabled"):
                            continue
                        blob = (" ".join(rp.get("Components") or []) + " " + " ".join(rp.get("URIs") or [])).lower()
                        if "enterprise" in blob:
                            ent = True
                        elif "no-subscription" in blob:
                            nosub = True
                        elif "pvetest" in blob:
                            test = True
                r["repo_enterprise"] = ent
                r["repo_nosub"] = nosub
                r["repo_test"] = test
            if isinstance(sub, dict) and isinstance(sub.get("data"), dict):
                r["sub_status"] = sub["data"].get("status")
                r["sub_level"] = sub["data"].get("level") or ""
            return r
        node_rows = []
        for res in await asyncio.gather(*[_node_sec(n) for n in nodes], return_exceptions=True):
            if isinstance(res, dict):
                node_rows.append(res)
        if node_rows:
            out["nodes"] = node_rows
    except Exception as e:
        log.warning(f"fetch_security: {e}")
        if not out:
            out = {"error": str(e)}
    _security_cache["ts"] = now
    _security_cache["data"] = out
    return out


# ── Demo mode ───────────────────────────────────────────────────────────────
# With `demo: true` in config, ProxDash serves a self-contained synthetic
# Proxmox cluster instead of calling a real API — for screenshots, the public
# live demo and offline trials. Nothing downstream changes: poll_all() returns
# this snapshot in the normal shape, and on startup the stats DB is seeded with
# synthetic history (_demo_backfill) so every chart and the uptime heatmap are
# populated from the first frame. All names are generic (pve1/pve2/pve3, common
# self-hosted apps) so the demo is portable and passes the build gate.

_GB = 1024 ** 3
_MB = 1024 ** 2

# node, cores, mem_gb, root_disk_gb, cpu_base(0..1), mem_frac(0..1), uptime_days
_DEMO_NODES = [
    ("pve1", 32, 128, 445, 0.24, 0.58, 214),
    ("pve2", 24,  96, 445, 0.17, 0.49, 214),
    ("pve3", 16,  64, 234, 0.11, 0.37, 96),
]

# vmid, name, node, kind, cores, cpu(0..1), mem_b, maxmem_b, disk_b, maxdisk_b, tags, status
_DEMO_GUESTS = [
    (101, "nextcloud",   "pve1", "qemu", 4, 0.27,  9 * _GB, 16 * _GB,  44 * _GB,  80 * _GB, "web;prod",    "running"),
    (102, "gitea",       "pve1", "qemu", 2, 0.08,  3 * _GB,  8 * _GB,  21 * _GB,  40 * _GB, "web;git",     "running"),
    (103, "postgres",    "pve2", "qemu", 8, 0.34, 25 * _GB, 32 * _GB, 128 * _GB, 200 * _GB, "db;prod",     "running"),
    (104, "grafana",     "pve2", "qemu", 2, 0.06,  2 * _GB,  4 * _GB,   9 * _GB,  20 * _GB, "monitoring",  "running"),
    (105, "mariadb",     "pve3", "qemu", 4, 0.19, 11 * _GB, 16 * _GB,  63 * _GB, 120 * _GB, "db",          "running"),
    (106, "prometheus",  "pve1", "qemu", 4, 0.22, 12 * _GB, 16 * _GB,  92 * _GB, 160 * _GB, "monitoring",  "running"),
    (107, "immich",      "pve3", "qemu", 6, 0.31, 15 * _GB, 24 * _GB, 210 * _GB, 400 * _GB, "media",       "running"),
    (108, "vaultwarden", "pve2", "qemu", 1, 0.0,        0,   1 * _GB,   2 * _GB,   8 * _GB, "web",         "stopped"),
    (201, "traefik",     "pve1", "lxc",  2, 0.05, 420 * _MB, 1 * _GB,   3 * _GB,   8 * _GB, "net;prod",    "running"),
    (202, "paperless",   "pve2", "lxc",  2, 0.12,  2 * _GB,  4 * _GB,  16 * _GB,  40 * _GB, "docs",        "running"),
    (203, "homarr",      "pve3", "lxc",  1, 0.0,        0,   1 * _GB,   2 * _GB,   8 * _GB, "web",         "stopped"),
    (204, "redis",       "pve1", "lxc",  2, 0.07, 1500 * _MB, 4 * _GB,  4 * _GB,  16 * _GB, "db;cache",    "running"),
    (205, "uptime-kuma", "pve2", "lxc",  1, 0.03, 260 * _MB, 1 * _GB,   1 * _GB,   8 * _GB, "monitoring",  "running"),
    (206, "wiki",        "pve3", "lxc",  2, 0.05, 820 * _MB, 2 * _GB,   6 * _GB,  20 * _GB, "docs",        "running"),
]


def _demo_wave(seed: float, amp: float = 0.12, base: float = 1.0) -> float:
    """Deterministic gentle oscillation so the live view breathes between polls
    (no randomness — same seed+time gives the same value, which keeps resume /
    reload stable). Returns a multiplier centred on `base`."""
    t = time.time() / 60.0
    return base + amp * math.sin(t / 3.1 + seed) + amp * 0.4 * math.sin(t / 1.27 + seed * 2.0)


def _demo_snapshot() -> dict:
    """Build one full synthetic cluster snapshot in the exact shape poll_all()
    would return from a live cluster."""
    now = time.time()

    # ── Nodes ────────────────────────────────────────────────────────────────
    nodes = []
    for i, (nm, cores, mem_gb, disk_gb, cpu_b, mem_f, up_days) in enumerate(_DEMO_NODES):
        maxmem = mem_gb * _GB
        maxdisk = disk_gb * _GB
        cpu = max(0.01, min(0.97, cpu_b * _demo_wave(i, 0.35)))
        memf = max(0.05, min(0.95, mem_f * _demo_wave(i + 5, 0.10)))
        la = round(cores * cpu * _demo_wave(i + 2, 0.15), 2)
        nodes.append({
            "id": f"node/{nm}", "node": nm, "type": "node", "status": "online",
            "cpu": cpu, "maxcpu": cores, "mem": int(maxmem * memf), "maxmem": maxmem,
            "disk": int(maxdisk * (0.34 + 0.05 * i)), "maxdisk": maxdisk,
            "uptime": up_days * 86400 + i * 3600, "level": "",
            "ip": f"192.0.2.{11 + i}", "loadavg": la,
            "iowait": round(max(0.0, 0.4 * _demo_wave(i + 3, 0.6)), 2),
            "pveversion": "9.1.9", "kernel": "6.14.11-4-pve",
            "updates": [7, 0, 3][i], "reboot_required": (i == 2), "cert_days": 320 - i * 4,
        })

    # ── Guests (VMs + LXCs) ────────────────────────────────────────────────────
    vms, lxcs = [], []
    guest_rates: dict = {}
    net_guests: list = []
    for j, (vmid, name, nm, kind, cores, cpu_b, mem_b, maxmem, disk_b, maxdisk, tags, st) in enumerate(_DEMO_GUESTS):
        running = st == "running"
        cpu = max(0.0, min(0.97, cpu_b * _demo_wave(vmid, 0.4))) if running else 0.0
        mem = int(mem_b * _demo_wave(vmid + 1, 0.06)) if running else 0
        up = (30 + j) * 86400 + vmid if running else 0
        rin = round((60_000 + 90_000 * abs(math.sin(vmid))) * _demo_wave(vmid, 0.7)) if running else 0
        rout = round((25_000 + 40_000 * abs(math.cos(vmid))) * _demo_wave(vmid + 2, 0.7)) if running else 0
        g = {
            "id": f"{'qemu' if kind == 'qemu' else 'lxc'}/{vmid}", "vmid": vmid, "name": name,
            "node": nm, "type": kind, "status": st,
            "cpu": cpu, "maxcpu": cores, "mem": mem, "maxmem": maxmem,
            "disk": disk_b if running else 0, "maxdisk": maxdisk,
            "diskread": int(2.4e9 + vmid * 1e8), "diskwrite": int(1.1e9 + vmid * 7e7),
            "netin": int(4.0e9 + vmid * 3e8), "netout": int(1.8e9 + vmid * 1e8),
            "uptime": up, "template": 0, "tags": tags, "pool": "",
            "ip": f"192.0.2.{101 + j}" if running else "",
        }
        (vms if kind == "qemu" else lxcs).append(g)
        if running:
            guest_rates[str(vmid)] = {"in": rin, "out": rout}
        net_guests.append({
            "vmid": vmid, "name": name, "node": nm, "type": kind, "status": st,
            "dev": "net0", "bridge": "vmbr0", "tag": None,
            "hwaddr": f"BC:24:11:{vmid % 256:02X}:{(vmid * 7) % 256:02X}:{(vmid * 13) % 256:02X}",
        })

    # ── Storage rows (cluster/resources shape) ──────────────────────────────────
    storage = []
    for i, (nm, cores, mem_gb, disk_gb, *_ ) in enumerate(_DEMO_NODES):
        storage.append({"id": f"storage/{nm}/local", "storage": "local", "node": nm,
                        "type": "storage", "plugintype": "dir", "shared": 0, "status": "available",
                        "content": "iso,vztmpl,backup", "disk": int((14 + i * 3) * _GB), "maxdisk": 100 * _GB})
        lvm_total = (disk_gb - 120) * _GB
        storage.append({"id": f"storage/{nm}/local-lvm", "storage": "local-lvm", "node": nm,
                        "type": "storage", "plugintype": "lvmthin", "shared": 0, "status": "available",
                        "content": "images,rootdir", "disk": int(lvm_total * (0.30 + 0.06 * i)), "maxdisk": lvm_total})
    # Shared: Ceph RBD + PBS-backed backup store (one row each, shared flag set).
    storage.append({"id": "storage/pve1/ceph-vm", "storage": "ceph-vm", "node": "pve1",
                    "type": "storage", "plugintype": "rbd", "shared": 1, "status": "available",
                    "content": "images,rootdir", "disk": int(640 * _GB), "maxdisk": int(2400 * _GB)})
    storage.append({"id": "storage/pve1/backup", "storage": "backup", "node": "pve1",
                    "type": "storage", "plugintype": "pbs", "shared": 1, "status": "available",
                    "content": "backup", "disk": int(3100 * _GB), "maxdisk": int(6000 * _GB)})

    # ── Storage content (treemap) ───────────────────────────────────────────────
    storage_content: dict = {}
    # Guest disk images live on ceph-vm; keep them per-volume.
    ceph_top = []
    for (vmid, name, nm, kind, cores, cpu_b, mem_b, maxmem, disk_b, maxdisk, tags, st) in _DEMO_GUESTS:
        ceph_top.append({"volid": f"ceph-vm:vm-{vmid}-disk-0", "size": int(maxdisk * 0.92),
                         "vmid": vmid, "format": "raw", "content": "images", "count": 1})
    storage_content["ceph-vm"] = {
        "classes": {"images": {"count": len(ceph_top), "bytes": sum(v["size"] for v in ceph_top)}},
        "top": sorted(ceph_top, key=lambda v: -v["size"])[:60]}
    # local: ISOs + templates + a couple of local dumps.
    local_top = [
        {"volid": "local:iso/debian-12.7-amd64-netinst.iso", "size": int(0.63 * _GB), "vmid": None, "format": "iso", "content": "iso", "count": 1},
        {"volid": "local:iso/ubuntu-24.04-live-server.iso", "size": int(2.1 * _GB), "vmid": None, "format": "iso", "content": "iso", "count": 1},
        {"volid": "local:iso/proxmox-ve_8.2.iso", "size": int(1.3 * _GB), "vmid": None, "format": "iso", "content": "iso", "count": 1},
        {"volid": "local:vztmpl/debian-12-standard.tar.zst", "size": int(0.12 * _GB), "vmid": None, "format": "tzst", "content": "vztmpl", "count": 1},
    ]
    storage_content["local"] = {
        "classes": {"iso": {"count": 3, "bytes": sum(v["size"] for v in local_top if v["content"] == "iso")},
                    "vztmpl": {"count": 1, "bytes": local_top[-1]["size"]}},
        "top": local_top}
    # backup (PBS): one consolidated entry per guest (many snapshots collapsed).
    bkp_top = []
    for (vmid, name, nm, kind, cores, cpu_b, mem_b, maxmem, disk_b, maxdisk, tags, st) in _DEMO_GUESTS:
        pfx = "vm" if kind == "qemu" else "ct"
        snaps = 14 + (vmid % 9)
        size = int(maxdisk * 0.42 * snaps / 14)
        bkp_top.append({"volid": f"backup:backup/{pfx}/{vmid}/2026-07-13T02:00:00Z",
                        "size": size, "vmid": vmid, "format": "pbs-vm", "content": "backup", "count": snaps})
    storage_content["backup"] = {
        "classes": {"backup": {"count": sum(v["count"] for v in bkp_top), "bytes": sum(v["size"] for v in bkp_top)}},
        "top": sorted(bkp_top, key=lambda v: -v["size"])[:60]}

    # ── Physical disks behind storages (Storage page DRIVES) ────────────────────
    storage_drives: dict = {}
    osd_i = 0
    ceph_disks = []
    for nm, *_ in [(n[0],) for n in _DEMO_NODES]:
        for d in range(3):
            ceph_disks.append({
                "node": nm, "devpath": f"/dev/nvme{d}n1", "model": "Samsung SSD 980 PRO 1TB",
                "serial": f"S6B0NX0T{osd_i:03d}", "vendor": "Samsung", "size": int(1000 * _GB),
                "type": "ssd", "health": "PASSED", "wearout": 98 - osd_i, "rpm": None,
                "used": "Ceph OSD", "osdid": osd_i, "temp": 34 + (osd_i % 5)})
            osd_i += 1
    storage_drives["ceph-vm"] = ceph_disks
    lvm_disks = []
    for i, (nm, *_rest) in enumerate([(n[0],) for n in _DEMO_NODES]):
        lvm_disks.append({
            "node": nm, "devpath": "/dev/sda", "model": "SAMSUNG MZ7LH480", "serial": f"S4EMNX0R{i:03d}",
            "vendor": "ATA", "size": int(480 * _GB), "type": "ssd", "health": "PASSED",
            "wearout": 92 - i, "rpm": None, "used": "LVM", "osdid": None, "temp": 30 + i})
    storage_drives["local-lvm"] = lvm_disks

    # ── Per-node network throughput + interfaces ────────────────────────────────
    traffic: dict = {}
    for i, (nm, *_ ) in enumerate([(n[0],) for n in _DEMO_NODES]):
        gin = sum(guest_rates.get(str(g["vmid"]), {}).get("in", 0) for g in vms + lxcs if g["node"] == nm)
        gout = sum(guest_rates.get(str(g["vmid"]), {}).get("out", 0) for g in vms + lxcs if g["node"] == nm)
        traffic[nm] = {"in": gin, "out": gout}
    net_nodes: dict = {}
    for i, (nm, *_ ) in enumerate([(n[0],) for n in _DEMO_NODES]):
        net_nodes[nm] = [
            {"iface": "vmbr0", "type": "bridge", "active": 1, "autostart": 1, "method": "static",
             "cidr": f"192.0.2.{11 + i}/24", "address": f"192.0.2.{11 + i}", "gateway": "192.0.2.1",
             "bridge_ports": "bond0", "bridge_vlan_aware": 1},
            {"iface": "bond0", "type": "bond", "active": 1, "autostart": 1,
             "slaves": "eno1 eno2", "bond_mode": "802.3ad"},
            {"iface": "eno1", "type": "eth", "active": 1, "autostart": 1},
            {"iface": "eno2", "type": "eth", "active": 1, "autostart": 1},
        ]
    network = {"nodes": net_nodes, "guests": net_guests, "traffic": traffic, "guest_rates": guest_rates}

    proxmox = {
        "nodes": nodes, "vms": vms, "lxcs": lxcs, "storage": storage,
        "storage_io": {"ceph-vm": {"read": round(42e6 * _demo_wave(1, 0.6)), "write": round(18e6 * _demo_wave(2, 0.6))},
                       "local-lvm": {"read": round(6e6 * _demo_wave(3, 0.6)), "write": round(3e6 * _demo_wave(4, 0.6))}},
        "storage_content": storage_content, "storage_drives": storage_drives,
        "pbs_storage_map": {"backup": "backup"}, "web_url": "", "network": network,
    }

    # ── Ceph ────────────────────────────────────────────────────────────────────
    pool_total = int(2400 * _GB)   # usable (post-replication)
    pool_used = int(640 * _GB * _demo_wave(9, 0.02))
    raw_total = pool_total * 3
    raw_used = pool_used * 3
    osds = []
    for d in ceph_disks:
        osds.append({"id": d["osdid"], "name": f"osd.{d['osdid']}", "host": d["node"],
                     "status": "up", "in_state": 1, "device_class": "ssd",
                     "size_bytes": d["size"], "used_bytes": int(d["size"] * 0.27),
                     "used_percent": 27.0, "pgs": 96, "temp": d["temp"]})
    ceph = {
        "status": "online", "health": "HEALTH_OK",
        "fsid": "d0c0ffee-1234-5678-9abc-def012345678",
        "mon_quorum": ["pve1", "pve2", "pve3"], "quorum_age_s": 214 * 86400,
        "bytes_used": raw_used, "bytes_total": raw_total, "bytes_avail": raw_total - raw_used,
        "data_bytes": pool_used, "usable_used_bytes": pool_used, "usable_total_bytes": pool_total,
        "usable_percent": round(pool_used / pool_total * 100, 1),
        "used_percent": round(raw_used / raw_total * 100, 1),
        "num_pools": 1, "num_pgs": 289, "num_objects": 1_240_500,
        "pg_states": {"active+clean": 289},
        "num_osds": 9, "num_up_osds": 9, "num_in_osds": 9,
        "read_bytes_sec": round(42e6 * _demo_wave(6, 0.5)), "write_bytes_sec": round(18e6 * _demo_wave(7, 0.5)),
        "read_op_per_sec": round(1400 * _demo_wave(8, 0.5)), "write_op_per_sec": round(620 * _demo_wave(9, 0.5)),
        "osds": osds,
        "pools": [{"name": "ceph-vm", "used_gb": round(pool_used / 1e9, 1),
                   "total_gb": round(pool_total / 1e9, 1),
                   "percent": round(pool_used / pool_total * 100, 1), "replicas": 3}],
    }

    # ── PBS ──────────────────────────────────────────────────────────────────────
    snapshots, groups = [], []
    for (vmid, name, nm, kind, cores, cpu_b, mem_b, maxmem, disk_b, maxdisk, tags, st) in _DEMO_GUESTS:
        pfx = "vm" if kind == "qemu" else "ct"
        n_snaps = 14 + (vmid % 9)
        per = int(maxdisk * 0.42 / 14)
        latest = int(now - 3600 * (vmid % 12))
        for k in range(n_snaps):
            bt = int(latest - k * 86400)
            snapshots.append({"datastore": "backup", "backup_id": str(vmid), "backup_type": pfx,
                              "backup_time": bt, "size": per, "owner": "root@pam!backup",
                              "protected": (k == 0 and vmid % 3 == 0), "verify_state": "ok",
                              "verify_time": 0, "comment": ""})
        groups.append({"datastore": "backup", "backup_type": pfx, "backup_id": str(vmid),
                       "count": n_snaps, "total_size": per * n_snaps, "latest_time": latest,
                       "oldest_time": int(latest - (n_snaps - 1) * 86400),
                       "verified_count": n_snaps, "failed_count": 0, "protected": vmid % 3 == 0,
                       "owner": "root@pam!backup"})
    pbs_used = int(3100 * _GB)
    pbs_total = int(6000 * _GB)
    pbs = {
        "status": "online",
        "datastores": [{"name": "backup", "total": pbs_total, "used": pbs_used,
                        "avail": pbs_total - pbs_used, "percent": round(pbs_used / pbs_total * 100, 1),
                        "dedup": 3.4}],
        "snapshots": snapshots, "groups": groups, "web_url": "", "fetched_at": now,
    }

    # ── Cluster tasks ──────────────────────────────────────────────────────────
    tasks = []
    for k, (vmid, name, nm, kind, *_ ) in enumerate(_DEMO_GUESTS):
        start = int(now - 3600 * (k + 1) - 200)
        tasks.append({"type": "vzdump", "id": str(vmid), "node": nm, "user": "root@pam!backup",
                      "start": start, "end": start + 90 + k * 5, "status": "OK",
                      "ok": True, "running": False, "failed": False})
    # A recent failed backup + a couple of interactive logins/shells.
    fstart = int(now - 5400)
    tasks.append({"type": "vzdump", "id": "108", "node": "pve2", "user": "root@pam!backup",
                  "start": fstart, "end": fstart + 12, "status": "unable to open VM 108 config",
                  "ok": False, "running": False, "failed": True})
    for k, (u, nm, typ) in enumerate([("root@pam", "pve1", "vncshell"), ("admin@pve", "pve2", "login"),
                                      ("root@pam", "pve1", "login"), ("deploy@pve", "pve3", "termproxy")]):
        s = int(now - 1800 * (k + 1))
        tasks.append({"type": typ, "id": nm, "node": nm, "user": u, "start": s,
                      "end": s + 300, "status": "OK", "ok": True, "running": False, "failed": False})
    tasks.sort(key=lambda x: x["start"], reverse=True)

    # ── Security ─────────────────────────────────────────────────────────────────
    security = {
        "users": [
            {"userid": "root@pam", "realm": "pam", "enable": 1, "expire": 0, "comment": "", "tfa": True},
            {"userid": "admin@pve", "realm": "pve", "enable": 1, "expire": 0, "comment": "Cluster admin", "tfa": True},
            {"userid": "deploy@pve", "realm": "pve", "enable": 1, "expire": 0, "comment": "CI deploy", "tfa": False},
            {"userid": "backup@pbs", "realm": "pbs", "enable": 1, "expire": 0, "comment": "PBS sync", "tfa": False},
        ],
        "tokens": [
            {"owner": "root@pam", "tokenid": "backup", "privsep": 0, "expire": 0, "comment": "vzdump / PBS"},
            {"owner": "admin@pve", "tokenid": "monitoring", "privsep": 1, "expire": 0, "comment": "read-only metrics"},
            {"owner": "deploy@pve", "tokenid": "ci", "privsep": 1, "expire": 0, "comment": ""},
        ],
        "tfa_known": True,
        "realms": [
            {"realm": "pam", "type": "pam", "comment": "Linux PAM standard authentication"},
            {"realm": "pve", "type": "pve", "comment": "Proxmox VE authentication server"},
        ],
        "firewall": {"enable": 1, "policy_in": "DROP", "policy_out": "ACCEPT",
                     "log_in": "nolog", "log_out": "nolog", "rules": 12},
        "nodes": [
            {"node": nm, "fw_enable": 1, "repo_enterprise": False, "repo_nosub": True,
             "repo_test": False, "sub_status": "notfound", "sub_level": ""}
            for (nm, *_ ) in [(n[0],) for n in _DEMO_NODES]
        ],
    }

    return {"proxmox": proxmox, "ceph": ceph, "pbs": pbs,
            "tasks": {"tasks": tasks}, "security": security}


def _demo_backfill():
    """Seed the stats DB with synthetic history so demo charts and the uptime
    heatmap are populated from the first frame. Idempotent: skips if the DB
    already holds history spanning more than a day (real rows or a prior seed)."""
    now = time.time()
    try:
        with _db() as conn:
            row = conn.execute("SELECT MIN(ts) FROM proxmox_stats").fetchone()
            if row and row[0] is not None and (now - row[0]) > 86400:
                return
            snap = _demo_snapshot()
            px = snap["proxmox"]
            guests = px["vms"] + px["lxcs"]
            DAYS, STEP = 30, 1800          # 30 days at 30-min buckets
            start = now - DAYS * 86400
            n_pts = int((now - start) / STEP)

            def wv(base, amp, seed, k):
                return max(0.0, min(100.0,
                    base + amp * math.sin(k / 9.0 + seed) + amp * 0.4 * math.sin(k / 3.7 + seed * 2)))

            for k in range(n_pts):
                ts = start + k * STEP
                for j, n in enumerate(px["nodes"]):
                    cpu = wv(n["cpu"] * 100, 11, j, k)
                    mem = wv(n["mem"] / n["maxmem"] * 100, 7, j + 1, k)
                    load = wv(n["cpu"] * 100 * 0.9, 10, j + 2, k) / 100.0
                    iow = wv(1.5, 1.4, j + 3, k)
                    conn.execute("INSERT INTO proxmox_stats(ts,node,cpu_pct,mem_pct,load_norm,iowait_pct) VALUES(?,?,?,?,?,?)",
                                 (ts, n["node"], round(cpu, 1), round(mem, 1), round(load, 3), round(iow, 2)))
                    tin = round((3e7 + 2e7 * abs(math.sin(j + 1))) * (0.5 + wv(0.5, 0.5, j, k)))
                    tout = round((1.2e7 + 1e7 * abs(math.cos(j + 1))) * (0.5 + wv(0.5, 0.5, j + 4, k)))
                    conn.execute("INSERT INTO proxmox_net_stats(ts,node,in_bps,out_bps) VALUES(?,?,?,?)",
                                 (ts, n["node"], tin, tout))
                for g in guests:
                    if g["status"] != "running":
                        continue
                    cpu = wv(g["cpu"] * 100, 14, g["vmid"], k)
                    mem = wv(g["mem"] / g["maxmem"] * 100 if g["maxmem"] else 0, 8, g["vmid"] + 1, k)
                    conn.execute("INSERT INTO entity_stats(ts,kind,eid,cpu_pct,mem_pct) VALUES(?,?,?,?,?)",
                                 (ts, "guest", str(g["vmid"]), round(cpu, 1), round(mem, 1)))
                    gin = round((60_000 + 90_000 * abs(math.sin(g["vmid"]))) * (0.4 + wv(0.6, 0.6, g["vmid"], k)))
                    gout = round((25_000 + 40_000 * abs(math.cos(g["vmid"]))) * (0.4 + wv(0.6, 0.6, g["vmid"] + 2, k)))
                    conn.execute("INSERT INTO guest_net_stats(ts,vmid,in_bps,out_bps) VALUES(?,?,?,?)",
                                 (ts, str(g["vmid"]), gin, gout))
                # Ceph capacity + throughput.
                cu = int(640 * _GB * 3 * (0.9 + wv(0.1, 0.1, 1, k) / 100.0 * 10))
                conn.execute("INSERT INTO ceph_stats(ts,bytes_used,bytes_total,read_bytes_sec,write_bytes_sec,read_op_per_sec,write_op_per_sec,num_objects,usable_used_bytes,usable_total_bytes) VALUES(?,?,?,?,?,?,?,?,?,?)",
                             (ts, cu, int(2400 * _GB * 3),
                              round(42e6 * (0.5 + wv(0.5, 0.5, 6, k))), round(18e6 * (0.5 + wv(0.5, 0.5, 7, k))),
                              round(1400 * (0.5 + wv(0.5, 0.5, 8, k))), round(620 * (0.5 + wv(0.5, 0.5, 9, k))),
                              1_240_500, int(cu / 3), int(2400 * _GB)))
            # Storage usage (5-min-ish sampling is fine at daily granularity here).
            for k in range(0, n_pts, 4):
                ts = start + k * STEP
                for s in px["storage"]:
                    if not s.get("maxdisk"):
                        continue
                    grow = 1.0 - (n_pts - k) / n_pts * 0.18   # slow fill toward current
                    conn.execute("INSERT INTO pxstorage_stats(ts,storage,node,shared,disk,maxdisk) VALUES(?,?,?,?,?,?)",
                                 (ts, s["storage"], s.get("node") or "", 1 if s.get("shared") else 0,
                                  int(s["disk"] * grow), s["maxdisk"]))
                for st, io in px["storage_io"].items():
                    conn.execute("INSERT INTO pxstorage_io(ts,storage,read_bps,write_bps) VALUES(?,?,?,?)",
                                 (ts, st, round(io["read"] * (0.4 + wv(0.6, 0.6, 1, k))),
                                  round(io["write"] * (0.4 + wv(0.6, 0.6, 2, k)))))
            # Health heatmap: everything green across the window, except one node
            # outage blip so the heatmap and history have something to show.
            hnames = list(_auto_health(px, snap["ceph"], snap["pbs"]).keys())
            for k in range(n_pts):
                ts = start + k * STEP
                for name in hnames:
                    up = 1
                    # brief pve3 wobble ~5 days ago
                    if name == "Node pve3" and abs(ts - (now - 5 * 86400)) < STEP * 1.5:
                        up = 0
                    conn.execute("INSERT INTO health_stats(ts,service_name,up,latency_ms) VALUES(?,?,?,?)",
                                 (ts, name, up, None))
        log.info("demo: seeded synthetic history")
    except Exception as e:
        log.warning(f"demo backfill: {type(e).__name__}: {e}")


async def poll_all() -> dict:
    if config.get("demo"):
        data = _demo_snapshot()
        try:
            data["health"] = _auto_health(data.get("proxmox"), data.get("ceph"), data.get("pbs"))
            _health_current_names.clear()
            _health_current_names.update(data["health"].keys())
        except Exception as e:
            log.warning(f"demo health: {type(e).__name__}: {e}")
        data["demo"] = True
        data["timestamp"] = time.time()
        data["config_meta"] = {
            "poll_interval": config.get("poll_interval", 10),
            "title": config.get("title", "ProxDash"),
        }
        return data
    results = await asyncio.gather(
        fetch_proxmox(),
        fetch_health_checks(),
        fetch_pbs(),
        fetch_ceph(),
        fetch_cluster_tasks(),
        fetch_security(),
        return_exceptions=True,
    )
    keys = [
        "proxmox", "health", "pbs", "ceph", "tasks", "security",
    ]
    data = {}
    for k, r in zip(keys, results):
        data[k] = r if not isinstance(r, Exception) else {"error": str(r)}
    # Health = zero-config auto checks derived from the snapshot (nodes, quorum,
    # storage, Ceph, PBS) + any optional custom HTTP checks from config.
    try:
        custom = {k: v for k, v in (data.get("health") or {}).items()
                  if isinstance(v, dict) and "up" in v}
        data["health"] = {**_auto_health(data.get("proxmox"), data.get("ceph"), data.get("pbs")),
                          **custom}
        # Remember the live check set: the heatmap filters its history to these
        # names so removed/renamed checks stop haunting it for the 90-day window.
        _health_current_names.clear()
        _health_current_names.update(data["health"].keys())
    except Exception as e:
        log.warning(f"auto health: {type(e).__name__}: {e}")
    data["timestamp"] = time.time()
    data["config_meta"] = {
        "poll_interval": config.get("poll_interval", 10),
        "title": config.get("title", "Proxdash"),
    }
    return data

_pbs_detail_cache: dict = {"snapshots": [], "groups": [], "fetched_at": 0.0}
_PBS_DETAIL_TTL = 15 * 60
_pbs_detail_lock = asyncio.Lock()
_pbs_detail_task = None
_background_tasks: Set[asyncio.Task] = set()

def _start_background_task(coro, name: str) -> asyncio.Task:
    task = asyncio.create_task(coro, name=name)
    _background_tasks.add(task)

    def _done(done: asyncio.Task) -> None:
        _background_tasks.discard(done)
        if done.cancelled():
            return
        try:
            exc = done.exception()
        except asyncio.CancelledError:
            return
        if exc is not None:
            log.error(f"background task {done.get_name()} failed: {exc}")

    task.add_done_callback(_done)
    return task

async def _refresh_pbs_details() -> None:
    """Refresh expensive PBS snapshot detail independently of the fast poll."""
    revision = _config_revision
    async with _pbs_detail_lock:
        if time.time() - _pbs_detail_cache["fetched_at"] < _PBS_DETAIL_TTL:
            return
        detail = await fetch_pbs(include_details=True)
        if revision != _config_revision:
            return
        if isinstance(detail, dict) and detail.get("status") == "online":
            _pbs_detail_cache.update({
                "snapshots": detail.get("snapshots", []),
                "groups": detail.get("groups", []),
                "fetched_at": detail.get("fetched_at", time.time()),
            })

def _schedule_pbs_details() -> None:
    global _pbs_detail_task
    cfg = config.get("pbs", {}) or {}
    if not cfg.get("enabled") or time.time() - _pbs_detail_cache["fetched_at"] < _PBS_DETAIL_TTL:
        return
    if _pbs_detail_task is None or _pbs_detail_task.done():
        _pbs_detail_task = _start_background_task(_refresh_pbs_details(), "pbs-details")

_INDEX_PATH = APP_DIR / "static" / "index.html"

def _build_ver() -> str:
    """Build id = index.html mtime; changes whenever a new frontend is deployed.
    The client compares this each WS tick and reloads itself when it changes,
    so a long-open tab can't keep running stale JS."""
    try:
        mt = _INDEX_PATH.stat().st_mtime
        try:
            mt = max(mt, (APP_DIR / "static" / "app.js").stat().st_mtime)  # JS now lives in app.js
        except Exception:
            pass
        return str(int(mt))
    except Exception:
        return "0"

async def poll_loop():
    await asyncio.sleep(2)
    while True:
        try:
            data = await poll_all()
            data["build"] = _build_ver()
            # PBS snapshots + groups are large (100+ KB) and rarely change. Stash
            # them in a cache for /api/pbs/snapshots and strip from the WS tick
            # so the browser isn't reparsing them on every broadcast.
            pbs = data.get("pbs")
            if isinstance(pbs, dict) and ("snapshots" in pbs or "groups" in pbs):
                _pbs_detail_cache["snapshots"] = pbs.get("snapshots", [])
                _pbs_detail_cache["groups"] = pbs.get("groups", [])
                _pbs_detail_cache["fetched_at"] = pbs.get("fetched_at", time.time())
                data["pbs"] = {k: v for k, v in pbs.items() if k not in ("snapshots", "groups")}
            elif not config.get("demo"):
                _schedule_pbs_details()
            await ws_manager.broadcast({"type": "update", "data": data})
            await asyncio.to_thread(_record_stats, data)
            if time.time() - _last_backup_ts > BACKUP_INTERVAL:
                await asyncio.get_event_loop().run_in_executor(None, _db_backup)
        except Exception as e:
            log.error(f"poll loop: {e}")
        await asyncio.sleep(config.get("poll_interval", 10))

# ── FastAPI routes ────────────────────────────────────────────────────────

# ── History import — Proxmox RRD backfill ──────────────────────────────────
# Proxmox keeps up to a YEAR of RRD metrics for nodes, guests and storages.
# On first launch (or on demand from the Tools page) we pull them into our
# history tables so charts and forecasts are full from day one instead of
# starting empty. Only timestamps OLDER than anything already recorded are
# inserted, so the import never duplicates or fights the live recorder.
_IMPORT_STATE: dict = {"running": False, "phase": "", "started": 0.0, "finished": 0.0,
                       "rows": {}, "error": None, "auto": False}
_RRD_TIMEFRAMES = ("year", "month", "week", "day", "hour")

def _meta_get(key: str):
    try:
        with _db() as conn:
            r = conn.execute("SELECT value FROM app_meta WHERE key=?", (key,)).fetchone()
            return r["value"] if r else None
    except Exception:
        return None

def _meta_set(key: str, value: str):
    try:
        with _db() as conn:
            conn.execute("INSERT INTO app_meta(key,value) VALUES(?,?) "
                         "ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))
    except Exception as e:
        log.warning(f"meta set {key}: {e}")

async def _rrd_series(base: str, headers: dict, path: str, sem: asyncio.Semaphore) -> dict:
    """All RRD points for one entity, every timeframe merged coarse→fine so an
    exact-timestamp collision keeps the finer sample. Returns {ts: row}."""
    out: dict = {}
    for tf in _RRD_TIMEFRAMES:
        async with sem:
            r = await _safe_get(f"{base}{path}", headers=headers,
                                params={"timeframe": tf, "cf": "AVERAGE"}, timeout=20)
        for row in ((r or {}).get("data") or []):
            t = int(row.get("time") or 0)
            if t:
                out[t] = row
    return out

async def _rrd_backfill(auto: bool = False):
    if _IMPORT_STATE["running"]:
        return
    _IMPORT_STATE.update({"running": True, "auto": auto, "phase": "starting", "error": None,
                          "rows": {}, "started": time.time(), "finished": 0.0})
    try:
        cfg = config.get("proxmox", {})
        if not cfg.get("enabled") or not cfg.get("url"):
            raise RuntimeError("Proxmox is not configured")
        base = cfg["url"].rstrip("/")
        headers = {}
        secret = cfg.get("token_secret", "")
        if cfg.get("token_id") and secret and not secret.startswith("REPLACE"):
            headers["Authorization"] = f"PVEAPIToken={cfg['token_id']}={secret}"
        now = time.time()
        sem = asyncio.Semaphore(8)

        _IMPORT_STATE["phase"] = "discovering cluster"
        nodes_r, res_r = await asyncio.gather(
            http_get(f"{base}/nodes", headers=headers),
            http_get(f"{base}/cluster/resources", headers=headers))
        nodes = [n["node"] for n in ((nodes_r or {}).get("data") or [])
                 if n.get("node") and n.get("status") != "offline"]
        resources = (res_r or {}).get("data") or []
        guests = [r for r in resources if r.get("type") in ("qemu", "lxc") and r.get("node") in nodes]
        storrows = [r for r in resources if r.get("type") == "storage" and r.get("node") in nodes]

        # Import only history OLDER than what's already recorded, per table.
        with _db() as conn:
            def _earliest(tbl):
                r = conn.execute(f"SELECT MIN(ts) AS m FROM {tbl}").fetchone()
                return r["m"] or now
            cut = {t: _earliest(t) for t in
                   ("proxmox_stats", "proxmox_net_stats", "pxstorage_stats", "entity_stats",
                    "pxstorage_io", "guest_net_stats")}
        floor_ts = now - 400 * 86400          # matches retention (nodes and guests alike)
        ins = {"proxmox_stats": 0, "proxmox_net_stats": 0, "pxstorage_stats": 0,
               "entity_stats": 0, "pxstorage_io": 0, "guest_net_stats": 0}

        # Nodes: cpu/mem history + net rates (RRD netin/netout are bytes/sec).
        for i, nd in enumerate(nodes):
            _IMPORT_STATE["phase"] = f"nodes ({i+1}/{len(nodes)})"
            series = await _rrd_series(base, headers, f"/nodes/{nd}/rrddata", sem)
            ts_sorted = sorted(series)
            with _db() as conn:
                for j, t in enumerate(ts_sorted):
                    row = series[t]
                    if t < floor_ts:
                        continue
                    # Node RRD carries raw loadavg + maxcpu → normalized load,
                    # and iowait (fraction) → IO-wait %.
                    la, cores = row.get("loadavg"), row.get("maxcpu") or 0
                    load_norm = round(la / cores, 3) if (la is not None and cores) else None
                    iowait_pct = round((row.get("iowait") or 0) * 100, 2) if row.get("iowait") is not None else None
                    if t < cut["proxmox_stats"] and row.get("cpu") is not None and row.get("memtotal"):
                        conn.execute("INSERT INTO proxmox_stats(ts,node,cpu_pct,mem_pct,load_norm,iowait_pct) VALUES(?,?,?,?,?,?)",
                                     (t, nd, round((row.get("cpu") or 0) * 100, 1),
                                      round((row.get("memused") or 0) / row["memtotal"] * 100, 1), load_norm, iowait_pct))
                        ins["proxmox_stats"] += 1
                    elif load_norm is not None or iowait_pct is not None:
                        # Rows recorded/imported before these columns existed:
                        # patch each with its NEAREST RRD sample — a window out
                        # to the midpoint of the neighboring samples (capped 1h)
                        # so compacted/live rows match too. Idempotent (NULL-only,
                        # re-run from the Tools import card).
                        lo = (t + ts_sorted[j-1]) / 2 if j else t - 1800
                        hi = (t + ts_sorted[j+1]) / 2 if j + 1 < len(ts_sorted) else t + 1800
                        conn.execute("UPDATE proxmox_stats SET load_norm=COALESCE(load_norm,?), iowait_pct=COALESCE(iowait_pct,?) "
                                     "WHERE node=? AND (load_norm IS NULL OR iowait_pct IS NULL) AND ts>=? AND ts<?",
                                     (load_norm, iowait_pct, nd, max(lo, t - 3600), min(hi, t + 3600)))
                    if t < cut["proxmox_net_stats"] and (row.get("netin") is not None or row.get("netout") is not None):
                        conn.execute("INSERT INTO proxmox_net_stats(ts,node,in_bps,out_bps) VALUES(?,?,?,?)",
                                     (t, nd, round(row.get("netin") or 0), round(row.get("netout") or 0)))
                        ins["proxmox_net_stats"] += 1

        # Storages: shared → one node's series; local → every node's own.
        _IMPORT_STATE["phase"] = "storage"
        seen_shared: set = set()
        pairs = []
        for s in storrows:
            if not s.get("storage"):
                continue
            if s.get("shared"):
                if s["storage"] in seen_shared:
                    continue
                seen_shared.add(s["storage"])
            pairs.append((s["storage"], s["node"], 1 if s.get("shared") else 0))
        stor_results = await asyncio.gather(
            *[_rrd_series(base, headers, f"/nodes/{nd}/storage/{st}/rrddata", sem) for st, nd, _ in pairs])
        with _db() as conn:
            for (st, nd, sh), series in zip(pairs, stor_results):
                for t, row in series.items():
                    if floor_ts <= t < cut["pxstorage_stats"] and row.get("total"):
                        conn.execute("INSERT INTO pxstorage_stats(ts,storage,node,shared,disk,maxdisk) VALUES(?,?,?,?,?,?)",
                                     (t, st, nd, sh, row.get("used") or 0, row.get("total") or 0))
                        ins["pxstorage_stats"] += 1

        # Guests: cpu/mem (entity drawer + Compute page drilldown, same 400d
        # runway as nodes) + disk I/O attributed to each guest's backing
        # storage(s) — same split as the live recorder.
        gs_disks = _guest_netcfg_cache.get("disks") or {}
        io_acc: dict = {}   # storage -> {ts: [read, write]}
        done = 0
        for chunk_start in range(0, len(guests), 8):
            chunk = guests[chunk_start:chunk_start + 8]
            results = await asyncio.gather(
                *[_rrd_series(base, headers, f"/nodes/{g['node']}/{g['type']}/{g['vmid']}/rrddata", sem) for g in chunk])
            with _db() as conn:
                for g, series in zip(chunk, results):
                    stors = gs_disks.get(g.get("vmid")) or []
                    share = 1.0 / len(stors) if stors else 0
                    for t, row in series.items():
                        if t < floor_ts:
                            continue
                        if t < cut["entity_stats"] and row.get("cpu") is not None:
                            mm = row.get("maxmem") or 0
                            conn.execute("INSERT INTO entity_stats(ts,kind,eid,cpu_pct,mem_pct) VALUES(?,?,?,?,?)",
                                         (t, "guest", str(g.get("vmid")), round((row.get("cpu") or 0) * 100, 1),
                                          round((row.get("mem") or 0) / mm * 100, 1) if mm else 0))
                            ins["entity_stats"] += 1
                        if t < cut["guest_net_stats"] and (row.get("netin") is not None or row.get("netout") is not None):
                            conn.execute("INSERT INTO guest_net_stats(ts,vmid,in_bps,out_bps) VALUES(?,?,?,?)",
                                         (t, str(g.get("vmid")), round(row.get("netin") or 0), round(row.get("netout") or 0)))
                            ins["guest_net_stats"] += 1
                        if stors and t < cut["pxstorage_io"]:
                            for st in stors:
                                a = io_acc.setdefault(st, {}).setdefault(t, [0.0, 0.0])
                                a[0] += (row.get("diskread") or 0) * share
                                a[1] += (row.get("diskwrite") or 0) * share
            done += len(chunk)
            _IMPORT_STATE["phase"] = f"guests ({done}/{len(guests)})"
        with _db() as conn:
            for st, m in io_acc.items():
                for t, (rd, wr) in m.items():
                    conn.execute("INSERT INTO pxstorage_io(ts,storage,read_bps,write_bps) VALUES(?,?,?,?)",
                                 (t, st, round(rd), round(wr)))
                    ins["pxstorage_io"] += 1

        _IMPORT_STATE["rows"] = ins
        _meta_set("rrd_import_last", json.dumps({"ts": time.time(), "rows": ins, "auto": auto}))
        log.info(f"RRD history import done: {ins}")
    except Exception as e:
        _IMPORT_STATE["error"] = str(e)
        log.warning(f"RRD import: {type(e).__name__}: {e}")
    finally:
        _IMPORT_STATE["phase"] = "error" if _IMPORT_STATE["error"] else "done"
        _IMPORT_STATE["running"] = False
        _IMPORT_STATE["finished"] = time.time()

async def _maybe_auto_import():
    """First-launch auto import: wait for the first poll (config + guest disk
    map cache), then backfill if this looks like a fresh install."""
    await asyncio.sleep(25)
    try:
        if config.get("demo"):   # demo history is seeded locally, not from a real API
            return
        if _meta_get("rrd_import_last"):
            return
        with _db() as conn:
            n = conn.execute("SELECT COUNT(*) AS c FROM proxmox_stats").fetchone()["c"]
        if n > 20000:   # long-running install — let the user trigger it manually
            return
        await _rrd_backfill(auto=True)
    except Exception as e:
        log.warning(f"auto rrd import: {e}")

@app.post("/api/import/history")
async def api_import_history():
    if _IMPORT_STATE["running"]:
        return JSONResponse({"error": "Import already running"}, status_code=409)
    _start_background_task(_rrd_backfill(auto=False), "rrd-import")
    return {"status": "started"}

@app.get("/api/import/status")
async def api_import_status():
    last = _meta_get("rrd_import_last")
    try:
        last = json.loads(last) if last else None
    except Exception:
        last = None
    return {**_IMPORT_STATE, "last": last}

def _move_database_aside(destination: Path) -> None:
    """Move a bad DB and its WAL sidecars out of the live database pathname."""
    if DB_PATH.exists():
        DB_PATH.rename(destination)
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(DB_PATH) + suffix)
        if sidecar.exists():
            sidecar.rename(Path(str(destination) + suffix))

def _remove_database_files() -> None:
    for path in (DB_PATH, Path(str(DB_PATH) + "-wal"), Path(str(DB_PATH) + "-shm")):
        path.unlink(missing_ok=True)

@app.on_event("startup")
async def startup():
    global config
    BASE.mkdir(parents=True, exist_ok=True)
    cfg_path = BASE / "config.yaml"
    if not cfg_path.exists():
        # First run: seed from the shipped example if present, else start empty.
        # Never crash on a missing config — the user configures via the Settings UI.
        example = Path(__file__).resolve().parent / "config.yaml.example"
        try:
            if example.exists():
                _atomic_private_text(cfg_path, example.read_text(encoding="utf-8"))
                log.warning(f"No config.yaml — seeded one from {example.name}. "
                            f"Finish setup in the Settings page.")
            else:
                _atomic_private_text(cfg_path, "{}\n")
                log.warning("No config.yaml and no example found — starting empty. "
                            "Configure in the Settings page.")
        except OSError as e:
            log.warning(f"Could not seed config.yaml ({e}); starting with empty config.")
    try:
        with open(cfg_path) as f:
            loaded = yaml.safe_load(f) or {}
        if not isinstance(loaded, dict):
            raise ValueError("top-level config must be a mapping")
        config = loaded
        try:
            cfg_path.chmod(0o600)
        except OSError:
            pass
        log.info(f"Config loaded from {cfg_path}")
    except (OSError, yaml.YAMLError, ValueError) as e:
        config = {}
        log.warning(f"config.yaml invalid or unreadable ({e}) — starting with empty config.")
    _ensure_setup_token()
    _sessions_load()
    _sessions_save()  # sweep expired tokens and enforce atomic 0600 storage
    db_ok = False
    try:
        _prepare_db()
        db_ok = _db_check_integrity()
    except sqlite3.DatabaseError as e:
        log.warning(f"database initialization failed: {e}")
    if not db_ok:
        corrupt = BASE / f"stats.corrupt-{int(time.time())}.db"
        if DB_PATH.exists():
            _move_database_aside(corrupt)
            log.warning(f"DB corrupt — moved to {corrupt.name}")
        if BACKUP_PATH.exists():
            shutil.copy2(str(BACKUP_PATH), str(DB_PATH))
            log.info("Restored stats.db from stats.db.bak")
            try:
                _prepare_db()
                if not _db_check_integrity():
                    raise sqlite3.DatabaseError("backup also corrupt")
                log.info("Backup restore verified OK")
            except (sqlite3.DatabaseError, OSError) as e:
                log.warning(f"Backup restore failed ({e}), starting fresh")
                _remove_database_files()
                _prepare_db()
        else:
            log.warning("No backup found — starting with a fresh database")
            _remove_database_files()
            _prepare_db()
    _hydrate_health_history()
    if config.get("demo"):
        await asyncio.to_thread(_demo_backfill)
    _start_background_task(poll_loop(), "poll-loop")
    _start_background_task(_maybe_auto_import(), "auto-rrd-import")

@app.on_event("shutdown")
async def _shutdown():
    tasks = list(_background_tasks)
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    _background_tasks.clear()
    if _http_session is not None and not _http_session.closed:
        await _http_session.close()

def _hydrate_health_history():
    """Load the last HEALTH_HISTORY_MAX rows per service from DB so the tick strip + sparkline survive restarts."""
    global _health_history
    try:
        with _db() as conn:
            services = [r["service_name"] for r in conn.execute(
                "SELECT DISTINCT service_name FROM health_stats"
            ).fetchall()]
            for svc in services:
                rows = conn.execute(
                    "SELECT ts, up, latency_ms FROM health_stats WHERE service_name=? ORDER BY ts DESC LIMIT ?",
                    (svc, HEALTH_HISTORY_MAX)
                ).fetchall()
                _health_history[svc] = [
                    {"ts": r["ts"], "up": bool(r["up"]), "latency_ms": r["latency_ms"]}
                    for r in reversed(rows)
                ]
        if _health_history:
            log.info(f"hydrated health history for {len(_health_history)} services")
    except Exception as e:
        log.warning(f"hydrate_health_history: {e}")

@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    if not _stream_authed(ws):
        await ws.close(code=1008); return
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect(ws)

@app.get("/api/status")
async def api_status():
    cached = ws_manager._last.get("data") if isinstance(ws_manager._last, dict) else None
    return cached if cached else await poll_all()

def _invalidate_runtime_caches() -> None:
    """Drop all endpoint/credential-bound collector state after config changes."""
    global _config_revision
    _config_revision += 1
    _guest_ip_cache.update({"ts": 0.0, "ips": {}})
    _guest_netcfg_cache.update({"ts": 0.0, "guests": [], "disks": {}})
    _stor_content_cache.update({"ts": 0.0, "content": {}})
    _stor_drives_cache.update({"ts": 0.0, "drives": {}})
    _node_health_cache.update({"ts": 0.0, "data": {}})
    _security_cache.update({"ts": 0.0, "data": {}})
    _pbs_detail_cache.update({"snapshots": [], "groups": [], "fetched_at": 0.0})
    for cache in (_net_rate_cache, _guest_rate_cache, _stor_io_cache,
                  _pbs_storage_map, _ssl_cert_cache, _health_history,
                  _health_last_persist):
        cache.clear()
    _health_current_names.clear()
    ws_manager._last = {}

async def _close_http_session() -> None:
    global _http_session
    session, _http_session = _http_session, None
    if session is not None and not session.closed:
        await session.close()

@app.post("/api/reload-config")
async def reload_config():
    global config
    try:
        with open(BASE / "config.yaml") as f:
            loaded = yaml.safe_load(f) or {}
    except (OSError, yaml.YAMLError) as e:
        return JSONResponse({"error": f"Config reload failed: {e}"}, status_code=400)
    if not isinstance(loaded, dict):
        return JSONResponse({"error": "Config must be a mapping"}, status_code=400)
    config = loaded
    _ensure_setup_token()
    _invalidate_runtime_caches()
    await _close_http_session()
    return {"status": "ok", "message": "Config reloaded"}

@app.get("/api/pbs/snapshots")
async def api_pbs_snapshots():
    """Returns the latest cached PBS snapshots+groups. Lazy-loaded by the
    backups page so the heavy detail doesn't ride every WS broadcast."""
    if not _pbs_detail_cache["fetched_at"] and (config.get("pbs", {}) or {}).get("enabled"):
        # The page asks once when it mounts. Populate a cold cache synchronously
        # so that first request cannot permanently render an empty snapshot list.
        await _refresh_pbs_details()
    else:
        _schedule_pbs_details()
    return _pbs_detail_cache

@app.get("/api/health/heatmap")
async def api_health_heatmap(hours: int = 24):
    """Return uptime % per bucket for every service. Used by the Health page heatmap.
    Response: {service_names, hours: [{label,start_ts}], cells: {svc:[pct,...]}, bucket_hours}.
    `pct` is 0..100 or null when no data was recorded for that bucket.
    Bucket size is hourly up to 7 days, then daily — keeps the cell count
    manageable for long ranges.
    """
    hours = max(1, min(hours, 90 * 24))  # cap at 90 days
    bucket_hours = 1 if hours <= 168 else 24
    bucket = bucket_hours * 3600
    n_buckets = max(1, hours // bucket_hours)
    now = int(time.time())
    start = (now // bucket - n_buckets + 1) * bucket
    fmt = "%H:00" if bucket_hours == 1 else "%b %d"
    buckets = [{"label": datetime.fromtimestamp(start + i * bucket).strftime(fmt), "start_ts": start + i * bucket}
               for i in range(n_buckets)]
    try:
        with _db() as conn:
            services = [r["service_name"] for r in conn.execute(
                "SELECT DISTINCT service_name FROM health_stats ORDER BY service_name"
            ).fetchall()]
            # Only checks that still exist: history keeps 90 days, so without
            # this filter a deleted/renamed check haunts the heatmap for weeks.
            if _health_current_names:
                services = [s for s in services if s in _health_current_names]
            cells = {}
            for svc in services:
                rows = conn.execute(
                    "SELECT ts, up FROM health_stats WHERE service_name=? AND ts>=? ORDER BY ts",
                    (svc, start)
                ).fetchall()
                row_buckets = [[] for _ in range(n_buckets)]
                for r in rows:
                    idx = int((r["ts"] - start) // bucket)
                    if 0 <= idx < n_buckets:
                        row_buckets[idx].append(1 if r["up"] else 0)
                cells[svc] = [
                    (round(sum(b) / len(b) * 100) if b else None)
                    for b in row_buckets
                ]
        return {"hours": buckets, "service_names": services, "cells": cells, "bucket_hours": bucket_hours}
    except Exception as e:
        log.warning(f"health heatmap: {e}")
        return {"hours": buckets, "service_names": [], "cells": {}, "error": str(e), "bucket_hours": bucket_hours}

# ── Settings config: redact secrets on read, preserve them on write ─────────
# GET replaces every secret VALUE with a sentinel so tokens/passwords never
# leave the server (an authed session or an XSS would otherwise read every
# credential). POST restores the sentinel from the in-memory config, so saving
# Settings without re-typing a secret keeps the stored value. Round-trip
# restore(redact(cfg),cfg)==cfg was verified against the live config.
_SECRET_SENTINEL = "__hd_unchanged__"

def _is_secret_key(k) -> bool:
    kl = str(k).lower()
    if kl in ("token_id", "enabled", "url", "host", "username", "user", "port",
              "name", "id", "type", "model", "interval", "slug"):
        return False
    return any(h in kl for h in ("password", "passwd", "secret", "api_token",
                                 "api_key", "apikey", "token"))

def _redact_secrets(obj):
    if isinstance(obj, dict):
        return {k: (_SECRET_SENTINEL if (_is_secret_key(k) and obj[k] not in (None, "", [], {}))
                    else _redact_secrets(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_redact_secrets(x) for x in obj]
    return obj

def _restore_secrets(new, old):
    if isinstance(new, dict):
        out = {}
        for k, v in new.items():
            ov = old.get(k) if isinstance(old, dict) else None
            out[k] = (ov if ov is not None else "") if v == _SECRET_SENTINEL else _restore_secrets(v, ov)
        return out
    if isinstance(new, list):
        out = []
        for i, x in enumerate(new):
            m = None
            if isinstance(x, dict) and isinstance(old, list):   # match by identity so reorders don't swap secrets
                for idk in ("id", "name", "host", "mac", "label"):
                    if x.get(idk):
                        m = next((o for o in old if isinstance(o, dict) and o.get(idk) == x.get(idk)), None)
                        if m: break
            if m is None and isinstance(old, list) and i < len(old):
                m = old[i]
            out.append(_restore_secrets(x, m))
        return out
    return new

@app.get("/api/config")
async def get_config():
    return _redact_secrets(config)

def _persist_config(cfg: dict) -> None:
    """Write config.yaml (0600) after a timestamped 0600 backup of the current one."""
    cfg_path = BASE / "config.yaml"
    try:
        if cfg_path.exists():
            bak = cfg_path.with_name(f"config.yaml.bak.{int(time.time())}")
            _atomic_private_text(bak, cfg_path.read_text())
    except Exception as e:
        log.warning(f"config backup failed: {e}")
    rendered = yaml.safe_dump(
        cfg, default_flow_style=False, allow_unicode=True, sort_keys=False
    )
    _atomic_private_text(cfg_path, rendered)

@app.post("/api/config")
async def post_config(request: Request):
    global config
    try:
        new_config = await request.json()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    if not isinstance(new_config, dict):
        return JSONResponse({"error": "Config must be a JSON object"}, status_code=400)
    # Restore any secret the UI sent back as the sentinel (left unchanged) so a
    # save never blanks a token the user didn't re-type.
    new_config = _restore_secrets(new_config, config)
    _persist_config(new_config)
    config = new_config
    _ensure_setup_token()
    _invalidate_runtime_caches()
    await _close_http_session()
    log.info("Config updated via settings UI")
    return {"status": "ok"}

# ── Custom logo (Settings → Branding upload) ──────────────────────────────
# The uploaded image lives in the DATA dir (survives redeploys, never in git);
# GET falls back to the bundled ProxDash mark so <img src="/api/logo"> always
# resolves — including on the login page (GET is auth-exempt in the middleware;
# POST/DELETE stay behind auth + CSRF). SVG uploads are rejected on purpose:
# an attacker-crafted SVG served same-origin is a stored-XSS vector.
_LOGO_EXT = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}
_LOGO_MAX_BYTES = 512 * 1024

def _logo_file(theme: str):
    """Uploaded logo for a theme: the per-theme slot wins, then the theme-agnostic
    legacy slot (`custom-logo.*`, kept for uploads made before the split)."""
    for name in (f"custom-logo-{theme}", "custom-logo"):
        for ext in _LOGO_EXT.values():
            p = BASE / (name + ext)
            if p.exists():
                return p
    return None

@app.get("/api/logo")
async def get_logo(theme: str = "light"):
    theme = "dark" if theme == "dark" else "light"
    p = _logo_file(theme)
    if p:
        mime = next(m for m, e in _LOGO_EXT.items() if e == p.suffix)
        return FileResponse(p, media_type=mime, headers={"Cache-Control": "no-cache"})
    # Bundled default mark — the ProxDash "X" (theme-aware PNG). SVG kept only
    # as a last-resort fallback for builds shipped before the PNG default.
    png = APP_DIR / "static" / ("proxdash-dark.png" if theme == "dark" else "proxdash.png")
    if png.exists():
        return FileResponse(png, media_type="image/png", headers={"Cache-Control": "no-cache"})
    svg = "proxdash-dark.svg" if theme == "dark" else "proxdash.svg"
    return FileResponse(APP_DIR / "static" / svg, media_type="image/svg+xml",
                        headers={"Cache-Control": "no-cache"})

@app.post("/api/logo")
async def post_logo(request: Request):
    try:
        body = await request.json()
        m = _re.match(r"^data:(image/(?:png|jpeg|webp));base64,(.+)$", str(body.get("data", "")), _re.S)
        if not m:
            return JSONResponse({"error": "Expected a base64 data URL of type png, jpeg or webp"}, status_code=400)
        mime, raw = m.group(1), base64.b64decode(m.group(2), validate=True)
        theme = str(body.get("theme", ""))
        name = f"custom-logo-{theme}" if theme in ("light", "dark") else "custom-logo"
    except Exception as e:
        return JSONResponse({"error": f"Bad upload: {e}"}, status_code=400)
    if len(raw) > _LOGO_MAX_BYTES:
        return JSONResponse({"error": "Logo too large (max 512 KB)"}, status_code=413)
    signatures = {
        "image/png": raw.startswith(b"\x89PNG\r\n\x1a\n"),
        "image/jpeg": raw.startswith(b"\xff\xd8\xff"),
        "image/webp": len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP",
    }
    if not signatures.get(mime, False):
        return JSONResponse({"error": "Uploaded bytes do not match the declared image type"}, status_code=400)
    dest = BASE / f"{name}{_LOGO_EXT[mime]}"
    _atomic_private_bytes(dest, raw)
    for ext in _LOGO_EXT.values():   # one file per slot, whatever the old type was
        old = BASE / (name + ext)
        if old != dest:
            old.unlink(missing_ok=True)
    log.info(f"Custom logo uploaded ({name}, {mime}, {len(raw)} bytes)")
    return {"status": "ok"}

# Bare favicon probes (bookmarks, clients that ignore the <link> tags) get the
# same art as /api/logo — the uploaded logo when present, else the bundled mark.
@app.get("/favicon.ico", include_in_schema=False)
@app.get("/favicon.svg", include_in_schema=False)
async def favicon():
    return await get_logo("dark")

@app.delete("/api/logo")
async def delete_logo():
    removed = 0
    for name in ("custom-logo", "custom-logo-light", "custom-logo-dark"):
        for ext in _LOGO_EXT.values():
            p = BASE / (name + ext)
            if p.exists():
                p.unlink(missing_ok=True)
                removed += 1
    if removed:
        log.info("Custom logo(s) removed — reverting to the bundled marks")
    return {"status": "ok"}

# ── Connection test endpoint ──────────────────────────────────────────────

def _ok(msg: str, **extra) -> dict:
    return {"ok": True, "message": msg, **extra}

def _err(msg: str, **extra) -> dict:
    return {"ok": False, "message": msg, **extra}

async def _test_proxmox(c: dict) -> dict:
    base = (c.get("url") or "").rstrip("/")
    tid, secret = c.get("token_id", ""), c.get("token_secret", "")
    if not base or not tid or not secret:
        return _err("URL, Token ID and Token Secret are required")
    try:
        d = await http_get(f"{base}/version", headers={"Authorization": f"PVEAPIToken={tid}={secret}"}, timeout=6)
        v = (d or {}).get("data", {}).get("version")
        if not v:
            return _err("Authenticated but no version field in response")
        return _ok(f"Proxmox VE {v}")
    except Exception as e:
        return _err(f"{type(e).__name__}: {e}")

def _pbs_base(url: str) -> str:
    """Normalize the PBS base URL — accept both bare host:port and a URL that
    already has /api2/json appended (matching the Proxmox VE convention)."""
    base = (url or "").rstrip("/")
    if base.endswith("/api2/json"):
        base = base[:-len("/api2/json")]
    return base

async def _test_pbs(c: dict) -> dict:
    raw_url = c.get("url") or ""
    base = _pbs_base(raw_url)
    tid, secret = c.get("token_id", ""), c.get("token_secret", "")
    if not base or not tid or not secret:
        return _err("URL, Token ID and Token Secret are required")
    headers = {"Authorization": f"PBSAPIToken={tid}:{secret}"}
    version_url = f"{base}/api2/json/version"
    # Probe the endpoint manually so we can surface a useful HTTP status when
    # the response isn't JSON (e.g. PBS web UI HTML when the path is wrong,
    # 401/403 from a bad token, network errors). Without this you just get the
    # opaque "JSONDecodeError: Expecting value: line 1 column 1".
    try:
        async with aiohttp.ClientSession(
            connector=aiohttp.TCPConnector(ssl=nossl_ctx()),
            timeout=aiohttp.ClientTimeout(total=6),
            headers=headers,
        ) as s:
            async with s.get(version_url) as r:
                ct = r.headers.get("Content-Type", "")
                if r.status >= 400:
                    body = (await r.text())[:200]
                    if r.status in (401, 403):
                        return _err(f"HTTP {r.status} — token rejected ({body.strip()[:120] or 'no message'})")
                    return _err(f"HTTP {r.status} at {version_url}")
                if "json" not in ct:
                    # Most common cause: URL points at the PBS web UI without
                    # the /api2/json prefix, so we get the SPA index.html back.
                    return _err(f"Non-JSON response (Content-Type: {ct or 'unknown'}). Check the URL — should be like https://host:8007 (no /api2/json suffix).")
                d = await r.json(content_type=None)
    except aiohttp.ClientConnectorError as e:
        return _err(f"Cannot connect to {base} — {e}")
    except asyncio.TimeoutError:
        return _err(f"Timed out connecting to {base}")
    except Exception as e:
        return _err(f"{type(e).__name__}: {e}")

    v = (d or {}).get("data", {}).get("version")
    if not v:
        return _err("Authenticated but no version field in response")
    # Probe DatastoreAudit access — the permission the Backups page needs.
    try:
        ds_r = await http_get(f"{base}/api2/json/admin/datastore", headers=headers, timeout=6)
        ds_count = len((ds_r or {}).get("data") or [])
        return _ok(f"PBS {v} · {ds_count} datastore{'s' if ds_count != 1 else ''} visible")
    except Exception:
        return _ok(f"PBS {v} · datastore list inaccessible (grant DatastoreAudit on /datastore)")

async def _test_health(c: dict) -> dict:
    url = c.get("url") or ""
    if not url:
        return _err("URL is required")
    return _ok("URL reachable") if await check_up(url, timeout=6) else _err("URL unreachable or 5xx")

_TEST_HANDLERS = {
    "proxmox": _test_proxmox,
    "pbs": _test_pbs,
    "health": _test_health,
}

@app.post("/api/test")
async def post_test(request: Request):
    try:
        body = await request.json()
    except Exception as e:
        return JSONResponse({"ok": False, "message": f"Bad JSON: {e}"}, status_code=400)
    svc = (body or {}).get("service", "")
    cfg = (body or {}).get("config") or {}
    handler = _TEST_HANDLERS.get(svc)
    if not handler:
        return JSONResponse({"ok": False, "message": f"Unknown service '{svc}'"}, status_code=400)
    try:
        result = await asyncio.wait_for(handler(cfg), timeout=15)
    except asyncio.TimeoutError:
        return {"ok": False, "message": "Test timed out (>15s)"}
    except Exception as e:
        return {"ok": False, "message": f"{type(e).__name__}: {e}"}
    return result

# Map internal page name (used in JS, file names, DOM ids) → URL slug.
# Pages under a dropdown group use the dropdown name as the URL parent so the
# address bar matches the sidebar tree (Infrastructure / Compute, etc.).
_PAGE_SLUGS = {
    "overview":         "/overview",
    "proxmox":          "/compute",
    "storage":          "/storage",
    "network":          "/network",
    "backups":          "/backups",
    "topology":         "/topology",
    "health":           "/health",
    "security":         "/security",
    "tools":            "/tools",
    "tars":             "/assistant",
    "settings":         "/settings",
}
_SLUG_TO_PAGE = {v: k for k, v in _PAGE_SLUGS.items()}

# Mirror of the client's PAGE_LABELS — used to set the <title> server-side so a
# deep-link refresh shows the right tab title from first paint (the client then
# keeps it in sync). Kept in lockstep with PAGE_LABELS in index.html.
_PAGE_LABELS = {
    "overview": "Overview", "proxmox": "Compute", "storage": "Storage",
    "network": "Network", "backups": "Backups", "topology": "Topology",
    "health": "Health", "security": "Security", "tools": "Tools",
    "tars": "Assistant", "settings": "Settings",
}

_shell_cache: dict = {}  # (page_name, index.html mtime) -> rendered HTML string

def _serve_shell(page_name: str | None) -> HTMLResponse:
    """Cached wrapper: the rendered shell only changes when index.html changes
    (deploy), so cache per (page, mtime) instead of re-reading 635 KB + running
    a dozen string replaces on every request."""
    key = (page_name, _build_ver())  # build id now folds in app.js mtime too
    html = _shell_cache.get(key)
    if html is None:
        html = _build_shell(page_name)
        _shell_cache.clear()  # drop entries rendered from an older build
        _shell_cache[key] = html
    return HTMLResponse(html, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

def _build_shell(page_name: str | None) -> str:
    """Render the SPA shell with the chosen page inlined for fast first paint.

    Without inlining, the browser would have to fetch /static/pages/<name>.html
    *after* the shell parses and JS boots — adding a round-trip before any
    content renders. Inlining keeps deep links snappy.
    """
    shell = (APP_DIR / "static" / "index.html").read_text()
    # Stamp this build into the page so a long-open tab auto-reloads when a newer
    # frontend is deployed (client compares against the WS-broadcast build id).
    shell = shell.replace("window.onerror=function", f'window._hdBuild="{_build_ver()}";\nwindow.onerror=function', 1)
    # version the external app.js so a new deploy busts the browser cache
    shell = shell.replace('src="/static/app.js"', f'src="/static/app.js?v={_build_ver()}"', 1)
    if page_name:
        # Set the tab title up front so a deep-link refresh shows the right page
        # title immediately instead of the static "ProxDash" / a stale page.
        label = _PAGE_LABELS.get(page_name)
        if label:
            shell = shell.replace("<title>Proxdash</title>", f"<title>{label} | Proxdash</title>", 1)
            # Also set the mobile top-bar title server-side. The shell hardcodes
            # "Overview" here; without this a deep-link refresh shows the right
            # page but the mobile header (and, via a WS tick, the tab title) can
            # flip back to "Overview" before the client's showPage() catches up.
            shell = shell.replace(
                '<span id="mobile-page-title" class="mobile-hdr-title">Overview</span>',
                f'<span id="mobile-page-title" class="mobile-hdr-title">{label}</span>',
                1,
            )
        try:
            page_html = (APP_DIR / "static" / "pages" / f"{page_name}.html").read_text()
            # Make the inlined page visible immediately (otherwise it has class="page" without active).
            page_html = page_html.replace(
                f'<div id="page-{page_name}" class="page',
                f'<div id="page-{page_name}" class="page active',
                1,
            )
            shell = shell.replace(
                '<div id="pages-host"></div>',
                f'<div id="pages-host">{page_html}</div>',
                1,
            )
            # Fix the sidebar highlight server-side too. The shell ships with
            # Overview hardcoded active; without this, a deep-link refresh paints
            # Overview highlighted for a beat until the client's showPage() runs.
            if page_name != "overview":
                shell = shell.replace(
                    'data-active="true" id="nav-overview"',
                    'data-active="false" id="nav-overview"',
                    1,
                )
                shell = shell.replace(
                    f'data-active="false" id="nav-{page_name}"',
                    f'data-active="true" id="nav-{page_name}"',
                    1,
                )
        except Exception as e:
            log.warning(f"Could not inline page '{page_name}': {e}")
    return shell

@app.get("/", response_class=HTMLResponse)
async def index():
    return _serve_shell("overview")

# pages request dozens at once, so without a cache every page load re-fetches
# the lot. Tier 1 is a bounded in-memory LRU (fast, but lost on restart); tier 2
# is a small on-disk LRU so a deploy/restart doesn't cold-start every image.
# Both are hard-capped (the disk one strictly, given CT 108's 7.8 G rootfs) and
# every disk op is best-effort — any failure degrades cleanly to memory-only.
# Single-threaded asyncio: no await between the dict ops, so no lock needed.
# insights payload (sizes, resolution/codec splits, watched %, decades, genres,
# largest items) — cached together so the expensive walk runs once per 6h.
# ── History API ───────────────────────────────────────────────────────────

MAX_HIST_PTS = 1500  # max data points returned by any history endpoint

def _bucket_secs(hours: int) -> int:
    """Return bucket width in seconds.
    Scales slowly (cap at 1 day) so longer ranges stay detailed.
    With 10s poll and 1500 pts: 1d→60s, 7d→403s, 30d→1728s, 1y→21024s, All→86400s."""
    return max(60, min(int(hours * 3600 / MAX_HIST_PTS), 86400))

@app.get("/api/history/proxmox")
async def history_proxmox(hours: int = 24):
    cutoff = time.time() - hours * 3600
    b = _bucket_secs(hours)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, node, AVG(cpu_pct) AS cpu_pct, AVG(mem_pct) AS mem_pct, "
            f"AVG(load_norm) AS load_norm, AVG(iowait_pct) AS iowait_pct "
            f"FROM proxmox_stats WHERE ts > ? GROUP BY CAST(ts AS INTEGER) / {b}, node ORDER BY ts ASC",
            (cutoff,)
        ).fetchall()
    nodes: dict = {}
    for r in rows:
        n = r["node"]
        if n not in nodes:
            nodes[n] = {"labels": [], "cpu": [], "mem": [], "load": [], "iowait": []}
        nodes[n]["labels"].append(r["ts"])
        nodes[n]["cpu"].append(r["cpu_pct"])
        nodes[n]["mem"].append(r["mem_pct"])
        nodes[n]["load"].append(r["load_norm"])
        nodes[n]["iowait"].append(r["iowait_pct"])
    return {"nodes": nodes}

@app.get("/api/history/proxmox_net")
async def history_proxmox_net(hours: int = 24):
    """Per-node network throughput history (bytes/sec in/out) for the Network page."""
    cutoff = time.time() - hours * 3600
    b = _bucket_secs(hours)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, node, AVG(in_bps) AS in_bps, AVG(out_bps) AS out_bps "
            f"FROM proxmox_net_stats WHERE ts > ? GROUP BY CAST(ts AS INTEGER) / {b}, node ORDER BY ts ASC",
            (cutoff,)
        ).fetchall()
    nodes: dict = {}
    for r in rows:
        n = r["node"]
        if n not in nodes:
            nodes[n] = {"labels": [], "in": [], "out": []}
        nodes[n]["labels"].append(r["ts"])
        nodes[n]["in"].append(round(r["in_bps"] or 0))
        nodes[n]["out"].append(round(r["out_bps"] or 0))
    return {"nodes": nodes}

@app.get("/api/history/guest_net")
async def history_guest_net(hours: int = 24):
    """Per-guest network rate history (Network page composition + sparklines)."""
    cutoff = time.time() - hours * 3600
    b = _bucket_secs(hours)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, vmid, "
            f"AVG(in_bps) AS in_bps, AVG(out_bps) AS out_bps "
            f"FROM guest_net_stats WHERE ts > ? "
            f"GROUP BY CAST(ts AS INTEGER) / {b}, vmid ORDER BY ts ASC",
            (cutoff,)
        ).fetchall()
    guests: dict = {}
    for r in rows:
        g = guests.setdefault(r["vmid"], {"labels": [], "in": [], "out": []})
        g["labels"].append(r["ts"])
        g["in"].append(round(r["in_bps"] or 0))
        g["out"].append(round(r["out_bps"] or 0))
    return {"guests": guests}

@app.get("/api/history/entity_bulk")
async def history_entity_bulk(kind: str = "guest", hours: int = 24):
    """Bulk per-entity CPU/mem history (Compute page resource-composition chart).
    One call returns every entity of `kind`, mirroring /api/history/guest_net.
    Response: {entities: {eid: {labels[], cpu[], mem[]}}}."""
    cutoff = time.time() - hours * 3600
    b = _bucket_secs(hours)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, eid, "
            f"AVG(cpu_pct) AS cpu, AVG(mem_pct) AS mem "
            f"FROM entity_stats WHERE kind = ? AND ts > ? "
            f"GROUP BY CAST(ts AS INTEGER) / {b}, eid ORDER BY ts ASC",
            (kind, cutoff)
        ).fetchall()
    entities: dict = {}
    for r in rows:
        e = entities.setdefault(r["eid"], {"labels": [], "cpu": [], "mem": []})
        e["labels"].append(r["ts"])
        e["cpu"].append(round(r["cpu"] or 0, 1))
        e["mem"].append(round(r["mem"] or 0, 1))
    return {"entities": entities}

@app.get("/api/history/storage_io")
async def history_storage_io(hours: int = 24):
    """Per-storage guest I/O history for the Storage page THROUGHPUT charts."""
    cutoff = time.time() - hours * 3600
    b = _bucket_secs(hours)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, storage, "
            f"AVG(read_bps) AS read_bps, AVG(write_bps) AS write_bps "
            f"FROM pxstorage_io WHERE ts > ? "
            f"GROUP BY CAST(ts AS INTEGER) / {b}, storage ORDER BY ts ASC",
            (cutoff,)
        ).fetchall()
    storages: dict = {}
    for r in rows:
        s = storages.setdefault(r["storage"], {"labels": [], "read": [], "write": []})
        s["labels"].append(r["ts"])
        s["read"].append(round(r["read_bps"] or 0))
        s["write"].append(round(r["write_bps"] or 0))
    return {"storages": storages}

@app.get("/api/history/storage")
async def history_storage(hours: int = 168):
    """Per-storage usage history for the Storage page device charts.
    Shared storages report identical numbers from every node, so they fold to a
    single series; same-named local stores (e.g. `local` on each node) stay one
    series per node."""
    cutoff = time.time() - hours * 3600
    b = _bucket_secs(hours)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, storage, node, "
            f"MAX(shared) AS shared, AVG(disk) AS disk, AVG(maxdisk) AS maxdisk "
            f"FROM pxstorage_stats WHERE ts > ? "
            f"GROUP BY CAST(ts AS INTEGER) / {b}, storage, node ORDER BY ts ASC",
            (cutoff,)
        ).fetchall()
    per: dict = {}          # (storage, node) -> series
    shared_names: set = set()
    for r in rows:
        if r["shared"]:
            shared_names.add(r["storage"])
        k = (r["storage"], r["node"])
        s = per.setdefault(k, {"labels": [], "disk": [], "maxdisk": []})
        s["labels"].append(r["ts"])
        s["disk"].append(r["disk"] or 0)
        s["maxdisk"].append(r["maxdisk"] or 0)
    series: list = []
    by_storage: dict = {}
    for (storage, node), s in per.items():
        by_storage.setdefault(storage, []).append((node, s))
    for storage, subs in by_storage.items():
        if storage in shared_names:
            # identical on every node → average per bucket into one series
            merged: dict = {}
            for _, s in subs:
                for i, t in enumerate(s["labels"]):
                    m = merged.setdefault(t, [0.0, 0.0, 0])
                    m[0] += s["disk"][i]; m[1] += s["maxdisk"][i]; m[2] += 1
            ts_sorted = sorted(merged)
            series.append({"storage": storage, "node": None, "shared": True,
                           "labels": ts_sorted,
                           "disk": [round(merged[t][0] / merged[t][2]) for t in ts_sorted],
                           "maxdisk": [round(merged[t][1] / merged[t][2]) for t in ts_sorted]})
        else:
            for node, s in sorted(subs):
                series.append({"storage": storage, "node": node or None, "shared": False, **s})
    return {"series": series}

@app.get("/api/history/entity")
async def history_entity(kind: str, id: str, hours: int = 24):
    """Per-guest CPU and memory history for the detail-drawer graph."""
    cutoff = time.time() - hours * 3600
    b = _bucket_secs(hours)
    with _db() as conn:
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, AVG(cpu_pct) AS cpu, AVG(mem_pct) AS mem "
            f"FROM entity_stats WHERE kind = ? AND eid = ? AND ts > ? "
            f"GROUP BY CAST(ts AS INTEGER) / {b} ORDER BY ts ASC",
            (kind, str(id), cutoff)
        ).fetchall()
    return {"labels": [r["ts"] for r in rows],
            "cpu": [round(r["cpu"] or 0, 1) for r in rows],
            "mem": [round(r["mem"] or 0, 1) for r in rows]}

@app.get("/api/history/ceph")
async def history_ceph(hours: int = 720):
    cutoff = time.time() - hours * 3600
    with _db() as conn:
        # Adapt the bucket size to the actual data span when it's smaller than
        # the requested range (otherwise "All" with 3h of data collapses to 1
        # point because the bucket is sized for a year).
        span_row = conn.execute("SELECT MIN(ts), MAX(ts) FROM ceph_stats WHERE ts > ?", (cutoff,)).fetchone()
        span_hours = ((span_row[1] - span_row[0]) / 3600) if span_row and span_row[0] is not None else hours
        b = _bucket_secs(int(min(hours, max(1, span_hours))))
        rows = conn.execute(
            f"SELECT (CAST(ts AS INTEGER) / {b}) * {b} AS ts, "
            f"AVG(bytes_used) AS bytes_used, AVG(bytes_total) AS bytes_total, "
            f"AVG(usable_used_bytes) AS usable_used, AVG(usable_total_bytes) AS usable_total, "
            f"AVG(read_bytes_sec) AS rbs, AVG(write_bytes_sec) AS wbs "
            f"FROM ceph_stats WHERE ts > ? GROUP BY CAST(ts AS INTEGER) / {b} ORDER BY ts ASC",
            (cutoff,)
        ).fetchall()
    labels, used_gb, total_gb, rbs, wbs = [], [], [], [], []
    for r in rows:
        labels.append(r["ts"])
        # Prefer usable values (post-replication, what user actually has). Fall
        # back to raw bytes for legacy rows recorded before the migration.
        u = r["usable_used"] if r["usable_used"] else r["bytes_used"]
        t = r["usable_total"] if r["usable_total"] else r["bytes_total"]
        used_gb.append(round((u or 0) / 1e9, 2))
        total_gb.append(round((t or 0) / 1e9, 2))
        rbs.append(int(r["rbs"]) if r["rbs"] is not None else None)
        wbs.append(int(r["wbs"]) if r["wbs"] is not None else None)
    return {"labels": labels, "used_gb": used_gb, "total_gb": total_gb,
            "read_bytes_sec": rbs, "write_bytes_sec": wbs}

# ── Tools ──────────────────────────────────────────────────────────────────
# Lightweight on-demand utilities for the Tools page.

_TOOLS_PROBE_SEM = asyncio.Semaphore(4)

def _bounded_tool(sem: asyncio.Semaphore):
    """Reject excess on-demand work instead of building an unbounded queue."""
    def decorate(fn):
        @functools.wraps(fn)
        async def wrapped(*args, **kwargs):
            try:
                await asyncio.wait_for(sem.acquire(), timeout=0.1)
            except asyncio.TimeoutError:
                return JSONResponse({"error": "tool is busy; try again shortly"}, status_code=429,
                                    headers={"Retry-After": "2"})
            try:
                return await fn(*args, **kwargs)
            finally:
                sem.release()
        return wrapped
    return decorate

@app.get("/api/tools/targets")
async def tools_targets():
    wol = [{"name": d.get("name") or d.get("mac"), "mac": d.get("mac")}
           for d in (config.get("tools", {}) or {}).get("wol_devices", []) or [] if d.get("mac")]
    return {"wol": wol}

@app.post("/api/tools/wol")
async def tools_wol(mac: str = "", broadcast: str = "255.255.255.255"):
    """Send a Wake-on-LAN magic packet to a MAC address on the LAN."""
    clean = "".join(c for c in mac if c in "0123456789abcdefABCDEF")
    if len(clean) != 12:
        return JSONResponse({"error": "Invalid MAC address"}, status_code=400)
    try:
        import ipaddress as _ipa
        _ipa.IPv4Address(broadcast)   # must be an IPv4 literal — no hostname UDP egress
    except Exception:
        return JSONResponse({"error": "Invalid broadcast address"}, status_code=400)
    packet = bytes.fromhex("ff" * 6 + clean * 16)
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sock.sendto(packet, (broadcast, 9))   # discard port (standard WoL)
        sock.sendto(packet, (broadcast, 7))   # echo port (some NICs)
        sock.close()
        return {"ok": True, "mac": ":".join(clean[i:i+2] for i in range(0, 12, 2)), "ts": time.time()}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)

@app.post("/api/tools/netcheck")
@_bounded_tool(_TOOLS_PROBE_SEM)
async def tools_netcheck(target: str = ""):
    """Reachability probe: DNS resolve time + TCP connect latency to host[:port]."""
    target = (target or "").strip()
    if not target:
        return JSONResponse({"error": "no target"}, status_code=400)
    host, _, port_s = target.partition(":")
    port = int(port_s) if port_s.isdigit() else 443
    out = {"host": host, "port": port}
    loop = asyncio.get_event_loop()
    # DNS
    try:
        t0 = time.monotonic()
        infos = await loop.getaddrinfo(host, port)
        out["dns_ms"] = round((time.monotonic() - t0) * 1000, 1)
        out["ip"] = infos[0][4][0]
    except Exception as e:
        out["error"] = f"DNS failed: {e}"
        return out
    # TCP connect
    try:
        t1 = time.monotonic()
        fut = asyncio.open_connection(host, port)
        reader, writer = await asyncio.wait_for(fut, timeout=5)
        out["connect_ms"] = round((time.monotonic() - t1) * 1000, 1)
        out["open"] = True
        writer.close()
        try: await writer.wait_closed()
        except Exception: pass
    except Exception:
        out["open"] = False
    return out

@app.post("/api/tools/traceroute")
@_bounded_tool(_TOOLS_PROBE_SEM)
async def tools_traceroute(target: str = ""):
    """Traceroute (run locally from ProxDash) to a host — hop list with latency."""
    target = (target or "").strip()
    host = target.partition(":")[0].replace("https://", "").replace("http://", "").strip("/").strip()
    if not host:
        return JSONResponse({"error": "no target"}, status_code=400)
    if not _re.match(r"^(?!-)[A-Za-z0-9_.:-]+$", host):   # no leading '-' → can't be an option
        return JSONResponse({"error": "invalid host"}, status_code=400)
    try:
        proc = await asyncio.create_subprocess_exec(
            "/usr/sbin/traceroute", "-n", "-w", "2", "-q", "1", "-m", "20", "--", host,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    except FileNotFoundError:
        return JSONResponse({"error": "traceroute not installed"}, status_code=501)
    try:
        out_b, _ = await asyncio.wait_for(proc.communicate(), timeout=50)
    except asyncio.TimeoutError:
        try: proc.kill()
        except Exception: pass
        return JSONResponse({"error": "traceroute timed out"}, status_code=504)
    hops = []
    for line in out_b.decode(errors="replace").splitlines():
        m = _re.match(r"^\s*(\d+)\s+(.*)$", line)
        if not m:
            continue
        n, rest = int(m.group(1)), m.group(2).strip()
        if rest.startswith("*"):
            hops.append({"hop": n, "ip": None, "ms": None})
        else:
            ms_m = _re.search(r"([\d.]+)\s*ms", rest)
            hops.append({"hop": n, "ip": rest.split()[0], "ms": float(ms_m.group(1)) if ms_m else None})
    if not hops:
        return JSONResponse({"error": "no route data"}, status_code=502)
    return {"host": host, "hops": hops, "ts": time.time()}

@app.post("/api/tools/certexpiry")
@_bounded_tool(_TOOLS_PROBE_SEM)
async def tools_certexpiry(target: str = ""):
    """TLS certificate issuer + days-until-expiry for host[:port] (default 443).
    Uses openssl so it still reports on expired / self-signed certs."""
    import ssl as _ssl
    target = (target or "").strip()
    host, _, port_s = target.partition(":")
    host = host.replace("https://", "").replace("http://", "").strip("/").strip()
    port = port_s if port_s.isdigit() else "443"
    if not host:
        return JSONResponse({"error": "no target"}, status_code=400)
    if not _re.match(r"^(?!-)[A-Za-z0-9.\-]+$", host):   # no leading '-' → can't be an openssl flag
        return JSONResponse({"error": "invalid host"}, status_code=400)
    # No shell: run s_client then pipe its output to x509 in Python (argv only),
    # so the host can never be parsed as an openssl option (arg injection).
    try:
        sc = await asyncio.create_subprocess_exec(
            "openssl", "s_client", "-connect", f"{host}:{port}", "-servername", host,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        sc_out, _ = await asyncio.wait_for(sc.communicate(input=b""), timeout=10)
        x5 = await asyncio.create_subprocess_exec(
            "openssl", "x509", "-noout", "-enddate", "-startdate", "-issuer", "-subject",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out_b, _ = await asyncio.wait_for(x5.communicate(input=sc_out), timeout=10)
    except asyncio.TimeoutError:
        for p in ("sc", "x5"):
            try: locals()[p].kill()
            except Exception: pass
        return JSONResponse({"error": "timed out"}, status_code=504)
    text = out_b.decode(errors="replace")
    def _grab(prefix):
        for ln in text.splitlines():
            if ln.startswith(prefix):
                return ln.split("=", 1)[1].strip()
        return None
    def _cn(s):
        if not s:
            return None
        m = _re.search(r"CN\s*=\s*([^,/]+)", s) or _re.search(r"O\s*=\s*([^,/]+)", s)
        return m.group(1).strip() if m else s
    na = _grab("notAfter")
    if not na:
        return JSONResponse({"error": "could not read certificate"}, status_code=502)
    days = None
    try:
        days = round((_ssl.cert_time_to_seconds(na) - time.time()) / 86400, 1)
    except Exception:
        pass
    return {"host": host, "port": int(port), "days_left": days, "not_after": na,
            "not_before": _grab("notBefore"), "issuer": _cn(_grab("issuer")),
            "subject": _cn(_grab("subject")), "ts": time.time()}

@app.post("/api/clientlog")
async def client_log(request: Request):
    """Sink for browser-side JS errors so we can see what actually fires on a
    real device (read via: journalctl -u proxdash | grep CLIENTERR)."""
    try:
        d = await request.json()
    except Exception:
        d = {"parse": "failed"}
    log.warning("CLIENTERR %s", json.dumps(d)[:3000])
    return {"ok": True}

_SSE_HEADERS = {"Cache-Control": "no-cache, no-transform", "Content-Encoding": "identity", "X-Accel-Buffering": "no"}

# ── Auth routes ───────────────────────────────────────────────────────────

@app.get("/auth/me")
async def auth_me(request: Request):
    s = _get_session(request)
    if s:
        return {"authenticated": True, "username": s["username"], "thumb": s.get("thumb", "")}
    return {"authenticated": False}

_LOGIN_PAGE = """<!DOCTYPE html>
<html lang="en" class="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Proxdash — Sign in</title>
<link rel="icon" href="/api/logo?theme=dark">
<link rel="apple-touch-icon" href="/api/logo?theme=dark">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
/* ── Design tokens — exact match to TracEarr globals.css ── */
:root{
  --c-bg:#FFFFFF;--c-panel:#FAFAFA;--c-card:#FFFFFF;--c-border:#E4E4E7;
  --c-text:#09090B;--c-muted:#71717A;--c-dim:#A1A1AA;
  --c-accent:#E57000;--c-accent-rgb:229,112,0;
  --c-hover:#F4F4F5;
  --c-shadow:0 1px 3px rgba(0,0,0,.06);
  --c-shadow-hover:0 4px 14px -4px rgba(229,112,0,.35);
}
html.dark{
  --c-bg:#09090B;--c-panel:#18181B;--c-card:#09090B;--c-border:#27272A;
  --c-text:#FAFAFA;--c-muted:#A1A1AA;--c-dim:#71717A;
  --c-accent:#E57000;--c-accent-rgb:229,112,0;
  --c-hover:#27272A;
  --c-shadow:0 0 0 1px #27272A;
  --c-shadow-hover:0 0 0 1px rgba(229,112,0,.5);
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  background:var(--c-bg);color:var(--c-text);
  font-family:'Inter',system-ui,sans-serif;
  font-feature-settings:'cv11','ss01';
  -webkit-font-smoothing:antialiased;
  min-height:100vh;display:flex;align-items:center;justify-content:center;
  transition:background .25s ease,color .25s ease;
}
.card{
  background:var(--c-card);
  border:1px solid var(--c-border);
  border-radius:8px;
  padding:40px 36px 36px;
  width:100%;max-width:360px;
  display:flex;flex-direction:column;align-items:center;
  box-shadow:var(--c-shadow);
}
.logo-wrap{
  width:52px;height:52px;border-radius:10px;
  background:rgba(var(--c-accent-rgb),.1);
  border:1px solid rgba(var(--c-accent-rgb),.2);
  display:flex;align-items:center;justify-content:center;
  margin-bottom:20px;color:var(--c-accent);flex-shrink:0;
}
h1{font-size:20px;font-weight:700;letter-spacing:-.3px;margin-bottom:4px;text-align:center;color:var(--c-text)}
.sub{font-size:13px;color:var(--c-muted);margin-bottom:28px;text-align:center;line-height:1.5}
.footer{margin-top:20px;font-size:11px;color:var(--c-dim);text-align:center;line-height:1.5}
@font-face{font-family:'Exo 2';font-style:normal;font-weight:600;font-display:swap;
  src:url('/static/vendor/fonts/exo2-600-latin.woff2') format('woff2')}
</style>
</head>
<body>
<div class="card">
  <div class="logo-wrap">
    <img src="/api/logo?theme=dark" width="36" height="36" alt="ProxDash" style="display:block">
  </div>
  <h1 style="font-family:'Exo 2','Inter',system-ui,sans-serif;text-transform:uppercase">ProxDash</h1>
  <p class="sub">Sign in to access your Proxmox dashboard</p>
  <!--LOCAL_AUTH-->
</div>
</body>
</html>"""

_LOGIN_ERRS = {
    "required": "Username and password are required",
    "short": "Password must be at least 8 characters",
    "creds": "Invalid username or password",
    "rate": "Too many login attempts. Try again shortly",
    "store": "Authentication storage is unavailable",
    "setup": "The one-time setup token is missing or invalid",
}

def _render_login_page(first_run: bool, err: str = "") -> str:
    msg = _LOGIN_ERRS.get(err, "")
    banner = (f'<p style="color:#EF4444;font-size:12px;margin:0 0 10px">{msg}</p>'
              if msg else "")
    ist = ("width:100%;box-sizing:border-box;margin:0 0 8px;padding:10px 12px;border-radius:8px;"
           "border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.04);color:#fff;font-size:14px")
    bst = ("width:100%;padding:10px 12px;border-radius:8px;border:0;background:#E57000;"
           "color:#fff;font-weight:600;font-size:14px;cursor:pointer")
    if first_run:
        title, pw_ac, btn = "Create your admin account", "new-password", "Create account"
        setup_input = (f'<input style="{ist}" type="password" name="setup_token" '
                       'placeholder="One-time setup token" autocomplete="off" required>')
        hint = ('<p class="footer">First run — enter the setup token from the startup log '
                'or data directory, then create the local admin (min 8 characters).</p>')
    else:
        title, pw_ac, btn = "Sign in with a local account", "current-password", "Sign in"
        setup_input = ""
        hint = ""
    form = (f'<p class="sub" style="margin-bottom:10px">{title}</p>{banner}'
            f'<form method="post" action="/auth/local" style="text-align:left">'
            f'<input style="{ist}" type="text" name="username" placeholder="Username" autocomplete="username" required>'
            f'<input style="{ist}" type="password" name="password" placeholder="Password" autocomplete="{pw_ac}" required>'
            f'{setup_input}'
            f'<button style="{bst}" type="submit">{btn}</button></form>{hint}')
    return _LOGIN_PAGE.replace("<!--LOCAL_AUTH-->", form)

@app.get("/auth/login")
async def auth_login(request: Request):
    return HTMLResponse(_render_login_page(not _local_admin_exists(),
                                           request.query_params.get("err", "")))

@app.post("/auth/local")
async def auth_local(request: Request):
    # Local username/password login. Parsed manually (urlencoded) so we don't
    # depend on python-multipart. Under /auth/ → allowlisted + CSRF-exempt by design.
    from urllib.parse import parse_qs
    try:
        content_length = int(request.headers.get("content-length") or 0)
    except ValueError:
        content_length = 8193
    if content_length > 8192:
        raise HTTPException(status_code=413, detail="login form too large")
    body_raw = await request.body()
    if len(body_raw) > 8192:
        raise HTTPException(status_code=413, detail="login form too large")
    body = body_raw.decode("utf-8", "replace")
    data = parse_qs(body)
    username = (data.get("username", [""])[0] or "").strip()
    password = data.get("password", [""])[0] or ""
    setup_token = data.get("setup_token", [""])[0] or ""
    if not username or not password or len(username) > 128 or len(password) > 1024:
        return RedirectResponse("/auth/login?err=required", status_code=303)
    login_key = _login_key(request)
    retry_after = _login_retry_after(login_key)
    if retry_after:
        return HTMLResponse(
            _render_login_page(not _local_admin_exists(), "rate"),
            status_code=429,
            headers={"Retry-After": str(retry_after)},
        )
    try:
        users = _users_load()
    except Exception:
        return HTMLResponse(_render_login_page(False, "store"), status_code=503)
    created = False
    if not users:
        # Serialize first-run provisioning and re-read under the lock. Without
        # this, two simultaneous requests can both observe an empty store and
        # race to replace each other's administrator account.
        async with _FIRST_RUN_LOCK:
            try:
                users = _users_load()
            except Exception:
                return HTMLResponse(_render_login_page(False, "store"), status_code=503)
            if not users:
                if not _setup_token_file.is_file():
                    return HTMLResponse(_render_login_page(True, "store"), status_code=503)
                if not _setup_token_matches(setup_token):
                    _login_record_failure(login_key)
                    return RedirectResponse("/auth/login?err=setup", status_code=303)
                if len(password) < 8:
                    return RedirectResponse("/auth/login?err=short", status_code=303)
                password_rec = await _bounded_password_hash(password)
                if password_rec is None:
                    return HTMLResponse(_render_login_page(True, "rate"), status_code=429,
                                        headers={"Retry-After": "2"})
                users[username] = {**password_rec, "created": datetime.utcnow().isoformat()}
                try:
                    _users_save(users)
                except Exception as e:
                    log.error(f"local admin creation failed: {e}")
                    return HTMLResponse(_render_login_page(True, "store"), status_code=503)
                try:
                    _setup_token_file.unlink(missing_ok=True)
                except Exception as e:
                    log.warning(f"could not remove consumed setup token: {e}")
                created = True
                log.warning(f"Local admin '{username}' created (first run).")
    if not created:
        rec = users.get(username)
        # Verify against a real stored hash even when the username is absent so
        # response timing does not disclose which local account exists.
        check_rec = rec or next(iter(users.values()), {})
        verified = await _bounded_password_check(password, check_rec)
        if verified is None:
            return HTMLResponse(_render_login_page(False, "rate"), status_code=429,
                                headers={"Retry-After": "2"})
        if not rec or not verified:
            _login_record_failure(login_key)
            return RedirectResponse("/auth/login?err=creds", status_code=303)
    _LOGIN_ATTEMPTS.pop(login_key, None)
    # Create a session.
    token = secrets.token_urlsafe(32)
    _sessions[token] = {"username": username, "thumb": "", "created": datetime.utcnow()}
    if not _sessions_save():
        _sessions.pop(token, None)
        return HTMLResponse(_render_login_page(False, "store"), status_code=503)
    ttl = _auth_cfg().get("session_ttl_days", 7)
    dest = request.cookies.get("hd_next") or "/"
    if not dest.startswith("/") or dest.startswith("//"):
        dest = "/"
    resp = RedirectResponse(dest, status_code=303)
    resp.set_cookie("hd_session", token, max_age=ttl * 86400, httponly=True,
                    samesite="lax", secure=_secure_cookie(request))
    resp.delete_cookie("hd_next")
    return resp

@app.get("/auth/logout")
async def auth_logout_confirm(request: Request):
    """Legacy link target: render a non-mutating POST confirmation form."""
    if not _get_session(request):
        return RedirectResponse("/auth/login", status_code=303)
    csrf = secrets.token_urlsafe(32)
    html = (
        "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' "
        "content='width=device-width,initial-scale=1'><title>Sign out</title></head>"
        "<body><main><h1>Sign out of ProxDash?</h1>"
        "<form method='post' action='/auth/logout'>"
        f"<input type='hidden' name='csrf_token' value='{csrf}'>"
        "<button type='submit'>Sign out</button></form><p><a href='/'>Cancel</a></p>"
        "</main></body></html>"
    )
    resp = HTMLResponse(html, headers={"Cache-Control": "no-store"})
    resp.set_cookie("hd_csrf", csrf, max_age=30 * 86400, samesite="lax",
                    secure=_secure_cookie(request))
    return resp

@app.post("/auth/logout")
async def auth_logout(request: Request):
    from urllib.parse import parse_qs
    cookie_csrf = request.cookies.get("hd_csrf") or ""
    supplied = request.headers.get("x-csrf-token") or ""
    if not supplied:
        body = await request.body()
        if len(body) <= 8192:
            supplied = parse_qs(body.decode("utf-8", "replace")).get("csrf_token", [""])[0]
    if not cookie_csrf or not supplied or not secrets.compare_digest(cookie_csrf, supplied):
        return JSONResponse({"error": "csrf token missing or invalid"}, status_code=403)
    token = request.cookies.get("hd_session")
    removed = None
    if token:
        removed = _sessions.pop(token, None)
        if removed is not None and not _sessions_save():
            _sessions[token] = removed
            return JSONResponse({"error": "could not persist logout"}, status_code=503)
    resp = RedirectResponse("/auth/login", status_code=303)
    resp.delete_cookie("hd_session")
    resp.delete_cookie("hd_csrf")
    return resp

# ── (AIA Exhibitors scraper moved to ClearDash) ───────────────────────────

# Catch-all page routes — must be registered AFTER all specific routes
# (e.g. /auth/*) so they don't shadow them.
# ── TARS chat — pluggable LLM backend with adjustable personality dials ──────
# Two providers, one SSE contract: both _tars_stream_anthropic and
# _tars_stream_openai emit the exact same custom event stream (text/thinking/
# tool/done/error — NOT a raw passthrough of either vendor's own stream format),
# so the frontend (src/46-tars.js) never needs to know which provider answered.
# "openai" covers the real OpenAI cloud API AND any self-hosted OpenAI-compatible
# server — Open WebUI, Ollama, LM Studio, vLLM, etc. — via base_url.
def _tars_system(dials: dict) -> str:
    def clamp(v, d):
        try: return max(0, min(100, int(v)))
        except Exception: return d
    h = clamp(dials.get("humor"), 75)
    ho = clamp(dials.get("honesty"), 90)
    sa = clamp(dials.get("sarcasm"), 30)
    band = lambda v, lo, hi: ("high" if v >= hi else "low" if v < lo else "moderate")
    return (
        "You are TARS (Token Annihilating Reasoning System), the AI built into ProxDash — the "
        "control surface for this homelab. You are modeled on TARS from the film Interstellar: a "
        "dry, deadpan, supremely capable machine intelligence with adjustable personality dials. "
        "Lead with the result; be concise.\n\n"
        "Current dial configuration (honor it for this conversation):\n"
        f"- Humor {h}% ({band(h,40,70)}): {'land dry, deadpan quips when they fit' if h>=70 else 'mostly straight, an occasional wry aside' if h>=40 else 'play it completely straight, no jokes'}. Never force a joke or let it pad the answer.\n"
        f"- Honesty {ho}% ({band(ho,50,85)}): give straight answers, state what is true, flag risks plainly. The missing {100-ho}% is tact, not deception.\n"
        f"- Sarcasm {sa}% ({band(sa,35,60)}): {'lean into gentle sarcasm' if sa>=60 else 'occasional and gentle' if sa>=35 else 'essentially none'} — never aimed at the user.\n\n"
        "You can read the live cluster via the get_status tool (READ-ONLY) — call it whenever the user "
        "asks about current status (nodes, VMs/containers, storage, backups, Ceph, what's down, network, "
        "etc.) rather than guessing or claiming you can't see it. You cannot change anything yet; if asked "
        "to *do* something on the infrastructure, say so plainly. Keep responses tight unless asked to expand."
    )

_TARS_TOOLS = [{
    "name": "get_status",
    "description": ("Read the live Proxmox cluster state (READ-ONLY) for the requested sections; returns current JSON. "
                    "Sections: proxmox (nodes/VMs/LXCs/storage), ceph, pbs (backups), network, health (uptime checks). "
                    "Pass ['all'] first to list which sections have data, then query specific ones."),
    "input_schema": {"type": "object", "properties": {
        "sections": {"type": "array", "items": {"type": "string"},
                     "description": "section keys to fetch, or ['all'] for the available list"}},
        "required": ["sections"]},
}]
def _tars_tools_openai():
    """OpenAI function-calling wraps the same JSON schema Anthropic's tool_use
    uses — just under {type:function, function:{name,description,parameters}}."""
    return [{"type": "function", "function": {
        "name": t["name"], "description": t["description"], "parameters": t["input_schema"],
    }} for t in _TARS_TOOLS]

_TARS_SEM = asyncio.Semaphore(2)

async def _bounded_tars_stream(stream):
    try:
        await asyncio.wait_for(_TARS_SEM.acquire(), timeout=0.1)
    except asyncio.TimeoutError:
        yield "event: error\ndata: " + json.dumps({"detail": "assistant is busy; try again shortly"}) + "\n\n"
        return
    try:
        async for chunk in stream:
            yield chunk
    finally:
        _TARS_SEM.release()

def _tars_exec_tool(name: str, inp: dict) -> str:
    if name != "get_status":
        return json.dumps({"error": f"unknown tool: {name}"})
    snap = (getattr(ws_manager, "_last", None) or {}).get("data") or {}
    secs = (inp or {}).get("sections") or ["all"]
    if "all" in secs:
        out = {"available_sections": [k for k in snap if k not in ("timestamp", "config_meta")],
               "note": "call get_status again with specific section keys for detail"}
    else:
        out = {s: snap.get(s, {"error": "no data / unknown section"}) for s in secs}
    txt = json.dumps(out, default=str)
    return txt[:9000] + ("…(truncated)" if len(txt) > 9000 else "")

async def _tars_stream_anthropic(msgs, dials, cfg, key):
    model = cfg.get("model") or "claude-sonnet-5"
    try:
        max_tokens = max(2048, min(int(cfg.get("max_tokens", 2048)), 8192))
        think_budget = max(1024, min(int(cfg.get("thinking_budget", 1200)), max_tokens - 1))
    except (TypeError, ValueError):
        max_tokens, think_budget = 2048, 1200
    base = {
        "model": model, "max_tokens": max_tokens,
        "system": _tars_system(dials), "stream": True,
        "thinking": {"type": "enabled", "budget_tokens": think_budget},
        "tools": _TARS_TOOLS,
    }
    s = _get_http_session()
    headers = {"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    convo = list(msgs)
    try:
        for _turn in range(6):  # cap agentic tool iterations
            cur, stop_reason = {}, None  # cur: block index -> accumulator
            async with s.post("https://api.anthropic.com/v1/messages", json={**base, "messages": convo},
                              headers=headers, timeout=aiohttp.ClientTimeout(total=120)) as r:
                if r.status != 200:
                    detail = (await r.text())[:300]
                    yield "event: error\ndata: " + json.dumps({"status": r.status, "detail": detail}) + "\n\n"
                    return
                async for line_b in r.content:
                    line = line_b.decode("utf-8", "ignore").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data:
                        continue
                    try:
                        ev = json.loads(data)
                    except Exception:
                        continue
                    et = ev.get("type")
                    if et == "content_block_start":
                        cb = ev.get("content_block", {}) or {}
                        t = cb.get("type"); b = {"type": t}
                        if t == "thinking":
                            b.update(thinking="", signature="")
                        elif t == "text":
                            b.update(text="")
                        elif t == "tool_use":
                            b.update(id=cb.get("id"), name=cb.get("name"), _in="")
                            yield "event: tool\ndata: " + json.dumps({"phase": "call", "name": cb.get("name")}) + "\n\n"
                        cur[ev.get("index")] = b
                    elif et == "content_block_delta":
                        b = cur.get(ev.get("index"))
                        if not b:
                            continue
                        d = ev.get("delta", {}); dt = d.get("type")
                        if dt == "thinking_delta":
                            b["thinking"] += d.get("thinking", "")
                            yield "event: thinking\ndata: " + json.dumps({"t": d.get("thinking", "")}) + "\n\n"
                        elif dt == "signature_delta":
                            b["signature"] += d.get("signature", "")
                        elif dt == "text_delta":
                            b["text"] += d.get("text", "")
                            yield "event: text\ndata: " + json.dumps({"t": d.get("text", "")}) + "\n\n"
                        elif dt == "input_json_delta":
                            b["_in"] += d.get("partial_json", "")
                    elif et == "message_delta":
                        stop_reason = (ev.get("delta", {}) or {}).get("stop_reason") or stop_reason
            # reassemble the assistant turn (thinking + text + tool_use) in block order
            blocks = []
            for idx in sorted(cur):
                b = cur[idx]
                if b["type"] == "thinking":
                    blocks.append({"type": "thinking", "thinking": b["thinking"], "signature": b["signature"]})
                elif b["type"] == "text":
                    blocks.append({"type": "text", "text": b["text"]})
                elif b["type"] == "tool_use":
                    try:
                        inp = json.loads(b["_in"] or "{}")
                    except Exception:
                        inp = {}
                    blocks.append({"type": "tool_use", "id": b["id"], "name": b["name"], "input": inp})
            if stop_reason == "tool_use":
                results = []
                for b in blocks:
                    if b.get("type") == "tool_use":
                        out = _tars_exec_tool(b["name"], b["input"])
                        yield "event: tool\ndata: " + json.dumps({"phase": "result", "name": b["name"], "input": b["input"]}) + "\n\n"
                        results.append({"type": "tool_result", "tool_use_id": b["id"], "content": out})
                convo.append({"role": "assistant", "content": blocks})
                convo.append({"role": "user", "content": results})
                continue
            yield "event: done\ndata: {}\n\n"
            return
        yield "event: done\ndata: {}\n\n"  # hit the iteration cap
    except Exception as e:
        yield "event: error\ndata: " + json.dumps({"detail": str(e)[:200]}) + "\n\n"

async def _tars_stream_openai(msgs, dials, cfg, key):
    """OpenAI-compatible chat/completions streaming — the real OpenAI cloud API,
    or any self-hosted server speaking the same wire protocol (Open WebUI,
    Ollama's /v1 endpoint, LM Studio, vLLM, etc.). No extended-thinking field
    in the standard protocol; some local reasoning models (e.g. DeepSeek-R1 via
    Ollama) stream a de-facto `reasoning_content` delta, which we forward as a
    thinking event on a best-effort basis when present."""
    model = cfg.get("model") or "gpt-4o-mini"
    try:
        max_tokens = max(256, min(int(cfg.get("max_tokens", 2048)), 8192))
    except (TypeError, ValueError):
        max_tokens = 2048
    base_url = (cfg.get("base_url") or "https://api.openai.com/v1").rstrip("/")
    convo = [{"role": "system", "content": _tars_system(dials)}] + list(msgs)
    headers = {"content-type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    body_base = {"model": model, "stream": True, "max_tokens": max_tokens, "tools": _tars_tools_openai()}
    s = _get_http_session()
    try:
        for _turn in range(6):  # cap agentic tool iterations
            acc_text = ""
            tool_calls = {}   # index -> {id, name, arguments}
            finish_reason = None
            async with s.post(f"{base_url}/chat/completions", json={**body_base, "messages": convo},
                              headers=headers, timeout=aiohttp.ClientTimeout(total=120)) as r:
                if r.status != 200:
                    detail = (await r.text())[:300]
                    yield "event: error\ndata: " + json.dumps({"status": r.status, "detail": detail}) + "\n\n"
                    return
                async for line_b in r.content:
                    line = line_b.decode("utf-8", "ignore").strip()
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if not data or data == "[DONE]":
                        continue
                    try:
                        ev = json.loads(data)
                    except Exception:
                        continue
                    choices = ev.get("choices") or []
                    if not choices:
                        continue
                    ch = choices[0]
                    delta = ch.get("delta") or {}
                    finish_reason = ch.get("finish_reason") or finish_reason
                    if delta.get("content"):
                        acc_text += delta["content"]
                        yield "event: text\ndata: " + json.dumps({"t": delta["content"]}) + "\n\n"
                    if delta.get("reasoning_content"):
                        yield "event: thinking\ndata: " + json.dumps({"t": delta["reasoning_content"]}) + "\n\n"
                    for tc in (delta.get("tool_calls") or []):
                        idx = tc.get("index", 0)
                        slot = tool_calls.setdefault(idx, {"id": None, "name": None, "arguments": ""})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                            yield "event: tool\ndata: " + json.dumps({"phase": "call", "name": fn["name"]}) + "\n\n"
                        if fn.get("arguments"):
                            slot["arguments"] += fn["arguments"]
            if finish_reason == "tool_calls" and tool_calls:
                oa_tool_calls, results_msgs = [], []
                for idx in sorted(tool_calls):
                    tc = tool_calls[idx]
                    try:
                        inp = json.loads(tc["arguments"] or "{}")
                    except Exception:
                        inp = {}
                    out = _tars_exec_tool(tc["name"], inp)
                    yield "event: tool\ndata: " + json.dumps({"phase": "result", "name": tc["name"], "input": inp}) + "\n\n"
                    oa_tool_calls.append({"id": tc["id"], "type": "function",
                                           "function": {"name": tc["name"], "arguments": tc["arguments"] or "{}"}})
                    results_msgs.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
                convo.append({"role": "assistant", "content": acc_text or None, "tool_calls": oa_tool_calls})
                convo.extend(results_msgs)
                continue
            yield "event: done\ndata: {}\n\n"
            return
        yield "event: done\ndata: {}\n\n"  # hit the iteration cap
    except Exception as e:
        yield "event: error\ndata: " + json.dumps({"detail": str(e)[:200]}) + "\n\n"

@app.post("/api/tars/chat")
async def tars_chat(request: Request):
    cfg = config.get("tars", {}) or {}
    if cfg.get("enabled") is False:
        return JSONResponse({"error": "TARS is disabled (tars.enabled: false)."}, status_code=503)
    provider = (cfg.get("provider") or "anthropic").strip().lower()
    if provider not in ("anthropic", "openai"):
        provider = "anthropic"
    key = cfg.get("api_key") or ""
    if provider == "anthropic" and not key:
        return JSONResponse(
            {"error": "TARS is not configured. Add a `tars:` section with `api_key` (your Anthropic API key) to config.yaml, then reload."},
            status_code=503)
    try:
        content_length = int(request.headers.get("content-length") or 0)
    except ValueError:
        content_length = 256 * 1024 + 1
    if content_length > 256 * 1024:
        return JSONResponse({"error": "request is too large"}, status_code=413)
    raw_body = await request.body()
    if len(raw_body) > 256 * 1024:
        return JSONResponse({"error": "request is too large"}, status_code=413)
    try:
        body = json.loads(raw_body or b"{}")
    except Exception:
        body = {}
    if not isinstance(body, dict):
        return JSONResponse({"error": "request must be a JSON object"}, status_code=400)
    raw = body.get("messages") or []
    if not isinstance(raw, list):
        raw = []
    dials = body.get("dials") or {}
    if not isinstance(dials, dict):
        dials = {}
    # Clean alternating user/assistant turns; cap history + per-message length to bound cost.
    msgs = [{"role": m.get("role"), "content": str(m.get("content", ""))[:8000]}
            for m in raw if isinstance(m, dict) and m.get("role") in ("user", "assistant")
            and str(m.get("content", "")).strip()][-24:]
    if not msgs or msgs[-1]["role"] != "user":
        return JSONResponse({"error": "no user message"}, status_code=400)

    stream = _tars_stream_openai(msgs, dials, cfg, key) if provider == "openai" \
        else _tars_stream_anthropic(msgs, dials, cfg, key)
    return StreamingResponse(_bounded_tars_stream(stream), media_type="text/event-stream", headers=_SSE_HEADERS)

@app.get("/api/tars/info")
async def tars_info():
    """Lightweight, non-secret status for the TARS page header (provider + model + readiness)."""
    cfg = config.get("tars", {}) or {}
    provider = (cfg.get("provider") or "anthropic").strip().lower()
    if provider not in ("anthropic", "openai"):
        provider = "anthropic"
    configured = cfg.get("enabled") is not False and (provider == "openai" or bool(cfg.get("api_key")))
    default_model = "claude-sonnet-5" if provider == "anthropic" else "gpt-4o-mini"
    return {"configured": configured, "provider": provider, "model": cfg.get("model") or default_model}

# Mount static files before the catch-all routes below; otherwise FastAPI would
# match /static/<file> as a page slug and return a misleading 404.
app.mount("/static", StaticFiles(directory=str(APP_DIR / "static")), name="static")

@app.get("/{p1}", response_class=HTMLResponse)
async def page_one(p1: str):
    name = _SLUG_TO_PAGE.get("/" + p1)
    if not name:
        raise HTTPException(status_code=404)
    return _serve_shell(name)

@app.get("/{p1}/{p2}", response_class=HTMLResponse)
async def page_two(p1: str, p2: str):
    name = _SLUG_TO_PAGE.get(f"/{p1}/{p2}")
    if not name:
        raise HTTPException(status_code=404)
    return _serve_shell(name)
