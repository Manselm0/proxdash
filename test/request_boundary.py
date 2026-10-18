"""Exercise the real auth boundary without startup pollers or private configuration."""
import asyncio
import os
from pathlib import Path
import sys
import tempfile

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

async def check():
    with tempfile.TemporaryDirectory(prefix="request-boundary-") as data:
        os.environ["HOMEDASH_DATA"] = data
        os.environ["PROXDASH_DATA"] = data
        import main
        main.config = {"auth": {"enabled": True}}
        main._sessions.clear()
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://testserver") as client:
            assert (await client.get("/api/config")).status_code == 401
            for host in ["testserver/auth/login?", "testserver#", "testserver\\auth", "testserver@other", "testserver,other"]:
                for method in ["GET", "POST"]:
                    response = await client.request(method, "/api/config", headers={"host": host})
                    assert response.status_code == 400, (host, method, response.status_code)
            response = await client.get("/api/config", headers=[("host", "testserver"), ("host", "other")])
            assert response.status_code == 400
            for host in ["localhost", "server.example:8080", "192.0.2.1", "[::1]:8080", "[fe80::1%eth0]:8080"]:
                assert (await client.get("/api/config", headers={"host": host})).status_code == 401
            assert (await client.get("/auth/login")).status_code == 200
        print("request boundary passed")

asyncio.run(check())
