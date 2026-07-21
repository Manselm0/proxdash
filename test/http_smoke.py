#!/usr/bin/env python3
"""Launch ProxDash in demo mode and exercise the real HTTP auth boundary."""

from __future__ import annotations

import http.cookiejar
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def request(opener, url: str, *, method: str = "GET", data=None, headers=None, expected=200):
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        response = opener.open(req, timeout=10)
    except urllib.error.HTTPError as exc:
        if exc.code != expected:
            raise
        return exc, exc.read()
    if response.status != expected:
        raise AssertionError(f"{method} {url}: HTTP {response.status}, expected {expected}")
    return response, response.read()


def run() -> None:
    with tempfile.TemporaryDirectory(prefix="proxdash-http-smoke-") as data_dir:
        data = Path(data_dir)
        (data / "config.yaml").write_text(
            "demo: true\npoll_interval: 3600\nauth:\n  enabled: true\n  session_ttl_days: 7\n",
            encoding="utf-8",
        )
        port = free_port()
        base = f"http://127.0.0.1:{port}"
        env = os.environ.copy()
        env.update({"PROXDASH_DATA": data_dir, "PYTHONDONTWRITEBYTECODE": "1"})
        log_path = data / "server.log"

        with log_path.open("w+", encoding="utf-8") as log:
            proc = subprocess.Popen(
                [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(port)],
                cwd=ROOT,
                env=env,
                stdout=log,
                stderr=subprocess.STDOUT,
                text=True,
            )
            try:
                plain = urllib.request.build_opener()
                deadline = time.monotonic() + 30
                while True:
                    if proc.poll() is not None:
                        raise AssertionError("server exited during startup")
                    try:
                        response, login = request(plain, base + "/auth/login")
                        break
                    except (OSError, urllib.error.URLError):
                        if time.monotonic() >= deadline:
                            raise AssertionError("server did not become ready")
                        time.sleep(0.1)

                assert b"One-time setup token" in login
                assert response.headers["X-Content-Type-Options"] == "nosniff"
                unauthorized, _ = request(plain, base + "/api/status", expected=401)
                assert unauthorized.headers["X-Frame-Options"] == "DENY"

                token_path = data / "setup-token.txt"
                assert (data / "config.yaml").stat().st_mode & 0o777 == 0o600
                token = token_path.read_text(encoding="utf-8").strip()
                bad = urllib.parse.urlencode(
                    {"username": "admin", "password": "correct-horse", "setup_token": "wrong"}
                ).encode()
                _, bad_page = request(
                    plain,
                    base + "/auth/local",
                    method="POST",
                    data=bad,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                assert b"setup token is missing or invalid" in bad_page

                jar = http.cookiejar.CookieJar()
                authed = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
                good = urllib.parse.urlencode(
                    {"username": "admin", "password": "correct-horse", "setup_token": token}
                ).encode()
                _, shell = request(
                    authed,
                    base + "/auth/local",
                    method="POST",
                    data=good,
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                )
                assert b"/static/app.js" in shell
                assert not token_path.exists()

                cookies = {cookie.name: cookie.value for cookie in jar}
                assert cookies.get("hd_session")
                assert cookies.get("hd_csrf")
                _, status_body = request(authed, base + "/api/status")
                status = json.loads(status_body)
                assert "proxmox" in status and status.get("config_meta")
                _, recent_body = request(authed, base + "/api/history/proxmox_recent?seconds=30")
                recent = json.loads(recent_body)
                assert isinstance(recent.get("nodes"), dict)

                request(authed, base + "/api/tools/wol?mac=001122334455", expected=405)
                request(
                    authed,
                    base + "/api/tools/wol?mac=001122334455",
                    method="POST",
                    data=b"",
                    expected=403,
                )

                request(
                    authed,
                    base + "/auth/logout",
                    method="POST",
                    data=b"",
                    headers={"X-CSRF-Token": cookies["hd_csrf"]},
                )
                request(authed, base + "/api/status", expected=401)
                assert json.loads((data / "sessions.json").read_text(encoding="utf-8")) == {}
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read()[-12000:], file=sys.stderr)
                raise
            finally:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5)

    print("✓ HTTP smoke passed")


if __name__ == "__main__":
    run()
