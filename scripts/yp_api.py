#!/usr/bin/env python3
"""Local administrator CLI for the unified Yandex API MCP deployment."""

from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(os.environ.get("YP_API_ROOT", "/opt/yandex-api-mcp"))
STATE = ROOT / "state"
SECRETS = ROOT / "secrets"
OAUTH = STATE / "oauth.json"
APP = SECRETS / "oauth-app.json"
PROJECTS = STATE / "projects.json"
COMPOSE = ROOT / "compose.yandex-api-mcp.yml"
CONTAINER = "yandex-api-mcp-yandex-api-mcp-1"
SCOPES = {
    "webmaster": ["webmaster:hostinfo", "webmaster:verify"],
    "direct": ["direct:api"],
    "metrika": ["metrika:read"],
    "metrika-write": ["metrika:write"],
    "audience": ["audience:read"],
    "wordstat": [],  # Uses Yandex Cloud Search API credentials, not Yandex OAuth.
}


def secure_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        if os.geteuid() == 0:
            if path.parent == STATE:
                os.chown(path, 10001, 10001)
            elif path.parent == SECRETS:
                os.chown(path, 0, 10001)
                os.chmod(path, 0o440)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_json(path: Path, fallback=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def compose(*args: str, check=True) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", "compose", "-p", "yandex-api-mcp", "-f", str(COMPOSE), *args],
                          cwd=ROOT, check=check)


def token_request(form: dict) -> dict:
    request = Request("https://oauth.yandex.ru/token", data=urlencode(form).encode(),
                      headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urlopen(request, timeout=30) as response:
            data = json.load(response)
    except Exception as exc:
        raise RuntimeError(f"OAuth exchange failed ({type(exc).__name__}); check app credentials and code") from None
    if not data.get("access_token"):
        raise RuntimeError("OAuth exchange returned no access token")
    return data


def save_token(data: dict, prior: dict | None = None) -> None:
    prior = prior or {}
    secure_json(OAUTH, {"access_token": data["access_token"],
                        "refresh_token": data.get("refresh_token") or prior.get("refresh_token"),
                        "scope": data.get("scope") or prior.get("scope", ""),
                        "issued_at": int(time.time()), "expires_in": data.get("expires_in")})


def setup() -> None:
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    SECRETS.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(STATE, 0o700)
    os.chmod(SECRETS, 0o750)
    if os.geteuid() == 0:
        os.chown(STATE, 10001, 10001)
        os.chown(SECRETS, 0, 10001)
    if not APP.exists():
        client_id = input("Yandex OAuth Client ID: ").strip()
        client_secret = getpass.getpass("Yandex OAuth Client Secret: ").strip()
        if not client_id or not client_secret:
            raise RuntimeError("Client ID and secret are required")
        secure_json(APP, {"client_id": client_id, "client_secret": client_secret,
                          "redirect_uri": "https://oauth.yandex.ru/verification_code"})
    if not PROJECTS.exists():
        secure_json(PROJECTS, {"accounts": [{"id": "default", "name": "Default"}]})
    extra = SECRETS / "yandex.env"
    if not extra.exists():
        extra.touch(mode=0o600)
    if os.geteuid() == 0:
        os.chown(extra, 0, 10001)
        os.chmod(extra, 0o440)
    if not OAUTH.exists():
        print("Run 'yp oauth' to authorize Yandex, then 'yp service start'.")
        return
    compose("up", "-d", "--build", "--no-deps")


def oauth(services: list[str]) -> None:
    app = load_json(APP)
    if not app:
        raise RuntimeError("Run 'yp setup' first")
    selected = services or ["webmaster", "direct", "metrika", "audience", "wordstat"]
    scopes = sorted({scope for name in selected for scope in SCOPES[name]})
    if not scopes:
        raise RuntimeError("Wordstat uses a Yandex Cloud folder ID and API key; configure secrets/yandex.env")
    params = urlencode({"response_type": "code", "client_id": app["client_id"],
                        "redirect_uri": app.get("redirect_uri", "https://oauth.yandex.ru/verification_code"),
                        "scope": " ".join(scopes)})
    print("Open this URL in a browser and grant access:\nhttps://oauth.yandex.ru/authorize?" + params)
    code = getpass.getpass("Authorization code: ").strip()
    if not code:
        raise RuntimeError("Authorization code is required")
    data = token_request({"grant_type": "authorization_code", "code": code,
                          "client_id": app["client_id"], "client_secret": app["client_secret"],
                          "redirect_uri": app.get("redirect_uri", "https://oauth.yandex.ru/verification_code")})
    # Yandex may omit scope in the token response. Keep the requested scopes for diagnostics;
    # actual access is still confirmed by read-only API probes.
    save_token({**data, "scope": data.get("scope") or " ".join(scopes)})
    print("OAuth token saved with mode 0600; token value was not printed.")


def refresh() -> None:
    app, state = load_json(APP), load_json(OAUTH)
    if not app or not state or not state.get("refresh_token"):
        raise RuntimeError("OAuth application and refresh token are required")
    data = token_request({"grant_type": "refresh_token", "refresh_token": state["refresh_token"],
                          "client_id": app["client_id"], "client_secret": app["client_secret"]})
    save_token(data, state)
    print("OAuth access token refreshed and persisted.")


def api_json(url: str, *, token: str, body: dict | None = None, bearer=False):
    payload = json.dumps(body).encode() if body is not None else None
    request = Request(url, data=payload, method="POST" if body is not None else "GET",
                      headers={"Authorization": ("Bearer " if bearer else "OAuth ") + token,
                               "Content-Type": "application/json"})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def discover() -> None:
    state = load_json(OAUTH)
    if not state or not state.get("access_token"):
        raise RuntimeError("Run 'yp oauth' first")
    token = state["access_token"]
    for label, action in [
        ("Webmaster hosts", lambda: api_json("https://api.webmaster.yandex.net/v4/user", token=token)),
        ("Metrika counters", lambda: api_json("https://api-metrika.yandex.net/management/v1/counters", token=token)),
        ("Direct clients", lambda: api_json("https://api.direct.yandex.com/json/v5/clients", token=token,
            bearer=True, body={"method": "get", "params": {"FieldNames": ["Login"]}})),
    ]:
        try:
            data = action()
            if label == "Webmaster hosts":
                user_id = data.get("user_id")
                data = api_json(f"https://api.webmaster.yandex.net/v4/user/{user_id}/hosts", token=token)
                rows = [(h.get("host_id"), h.get("unicode_host_url") or h.get("ascii_host_url"))
                        for h in data.get("hosts", [])]
            elif label == "Metrika counters":
                rows = [(str(c.get("id")), c.get("name") or c.get("site")) for c in data.get("counters", [])]
            else:
                rows = [(c.get("Login"), c.get("Name") or "") for c in data.get("result", {}).get("Clients", [])]
            print(f"{label}: {len(rows)} available")
            for ident, title in rows[:20]:
                print(f"  {ident or '-'}  {title or ''}")
            if len(rows) > 20:
                print(f"  … and {len(rows) - 20} more")
        except Exception as exc:
            print(f"{label}: unavailable ({type(exc).__name__})")


def projects(action: str, ident: str | None, name: str | None, login: str | None,
             counters: list[str] | None = None, hosts: list[str] | None = None) -> None:
    registry = load_json(PROJECTS, {"accounts": []})
    items = registry.setdefault("accounts", [])
    if action == "list":
        for item in items:
            print(f"{item['id']}: {item.get('name') or item['id']} (Direct: {item.get('direct_client_login') or '-'})")
        return
    if not ident:
        raise RuntimeError("Project id is required")
    if action == "add":
        if any(item["id"] == ident for item in items):
            raise RuntimeError("Project id already exists")
        items.append({"id": ident, "name": name or ident, "direct_client_login": login,
                      "metrica_counter_ids": [int(x) for x in counters or []],
                      "webmaster_hosts": hosts or []})
    else:
        if not any(item["id"] == ident for item in items):
            raise RuntimeError("Project id not found")
        registry["accounts"] = [item for item in items if item["id"] != ident]
    secure_json(PROJECTS, registry)
    print("Project registry updated; restart service to load the change.")


def doctor() -> int:
    checks = []
    optional = []
    checks.append(("Docker", shutil.which("docker") is not None))
    checks.append(("Compose config", COMPOSE.exists()))
    checks.append(("OAuth app", bool(load_json(APP))))
    state = load_json(OAUTH, {})
    checks.append(("OAuth access token", bool(state.get("access_token"))))
    checks.append(("OAuth refresh token", bool(state.get("refresh_token"))))
    checks.append(("Project registry", bool(load_json(PROJECTS, {}).get("accounts"))))
    for path in [OAUTH, APP, PROJECTS]:
        checks.append((f"Permissions {path.name}", path.exists() and path.stat().st_mode & 0o007 == 0
                       and (path == APP or path.stat().st_mode & 0o070 == 0)))
    scopes = set(state.get("scope", "").split())
    if "webmaster:hostinfo" in scopes or "webmaster:verify" in scopes:
        optional.append(("Requested Webmaster OAuth scopes", set(SCOPES["webmaster"]).issubset(scopes)))
    else:
        optional.append(("Requested Webmaster OAuth scopes", None))
    try:
        with urlopen("http://127.0.0.1:8001/healthz", timeout=5) as response:
            health = json.load(response)
        checks.append(("MCP process and health", health.get("status") == "ok"))
        checks.append(("Both backends", set(health.get("backends", [])) == {"core", "services"}))
    except (URLError, OSError, ValueError):
        checks.extend([("MCP process and health", False), ("Both backends", False)])
    tunnel = subprocess.run(["systemctl", "is-active", "tunnel-client.service"],
                            capture_output=True, text=True, check=False) if shutil.which("systemctl") else None
    if tunnel is not None and tunnel.returncode == 0:
        optional.append(("Tunnel service", True))
    elif (ROOT / "tunnel-candidate.yaml").exists():
        optional.append(("Tunnel service", False))
    else:
        optional.append(("Tunnel service (optional)", None))
    docker_service = subprocess.run(["systemctl", "is-active", "docker.service"],
                                    capture_output=True, text=True, check=False) if shutil.which("systemctl") else None
    checks.append(("Docker systemd service", docker_service is not None and docker_service.stdout.strip() == "active"))
    expiry = int(state.get("issued_at") or 0) + int(state.get("expires_in") or 0)
    if expiry:
        checks.append(("OAuth not expired", expiry > time.time()))
    if state.get("access_token"):
        try:
            if "webmaster:hostinfo" in scopes:
                api_json("https://api.webmaster.yandex.net/v4/user", token=state["access_token"])
            elif "metrika:read" in scopes or "metrika:write" in scopes:
                api_json("https://api-metrika.yandex.net/management/v1/counters", token=state["access_token"])
            elif "direct:api" in scopes:
                api_json("https://api.direct.yandex.com/json/v5/campaigns", token=state["access_token"],
                         bearer=True, body={"method": "get", "params": {"FieldNames": ["Id"],
                                                                  "Page": {"Limit": 1, "Offset": 0}}})
            elif "audience:read" in scopes:
                api_json("https://api-audience.yandex.com/v1/management/user/info", token=state["access_token"])
            else:
                raise RuntimeError("No supported API probe for selected scopes")
            checks.append(("Yandex API connectivity", True))
        except Exception:
            checks.append(("Yandex API connectivity", False))
    for label, good in checks:
        print(f"{'OK' if good else 'FAIL'}  {label}")
    for label, good in optional:
        print(f"{'SKIP' if good is None else 'OK' if good else 'FAIL'}  {label}")
    return 0 if all(good for _, good in checks) and all(good is not False for _, good in optional) else 1


def main() -> int:
    parser = argparse.ArgumentParser(prog="yp", description="Yandex API MCP administrator CLI")
    subs = parser.add_subparsers(dest="command", required=True)
    subs.add_parser("setup")
    auth = subs.add_parser("oauth")
    auth.add_argument("services", nargs="*", choices=sorted(SCOPES))
    subs.add_parser("refresh")
    subs.add_parser("discover")
    subs.add_parser("doctor")
    subs.add_parser("verify")
    project = subs.add_parser("project")
    project.add_argument("action", choices=["list", "add", "remove"])
    project.add_argument("id", nargs="?")
    project.add_argument("--name")
    project.add_argument("--direct-login")
    project.add_argument("--counter", action="append", default=[])
    project.add_argument("--host", action="append", default=[])
    service = subs.add_parser("service")
    service.add_argument("action", choices=["start", "stop", "restart", "status"])
    tunnel = subs.add_parser("tunnel")
    tunnel.add_argument("action", nargs="?", choices=["status"], default="status")
    connector = subs.add_parser("connector")
    connector.add_argument("action", nargs="?", choices=["info"], default="info")
    logs = subs.add_parser("logs")
    logs.add_argument("--tail", type=int, default=80)
    args = parser.parse_args()
    try:
        if args.command == "setup": setup()
        elif args.command == "oauth": oauth(args.services)
        elif args.command == "refresh": refresh()
        elif args.command == "discover": discover()
        elif args.command == "doctor": return doctor()
        elif args.command == "verify":
            probe = ROOT / "scripts/unified-live-check.mjs"
            with probe.open("rb") as stream:
                return subprocess.run(["docker", "exec", "-i", CONTAINER, "node", "--input-type=module"],
                                      stdin=stream, check=False).returncode
        elif args.command == "project": projects(args.action, args.id, args.name, args.direct_login,
                                                 args.counter, args.host)
        elif args.command == "service":
            if args.action == "status": compose("ps", check=False)
            elif args.action == "start": compose("up", "-d", "--build", "--no-deps")
            elif args.action == "stop": compose("stop")
            else: compose("restart")
        elif args.command == "tunnel":
            subprocess.run(["systemctl", "status", "tunnel-client.service", "--no-pager"], check=False)
        elif args.command == "connector":
            print("SSE: http://127.0.0.1:8001/sse")
            print(f"Stdio: docker exec -i {CONTAINER} node gateway/index.mjs")
            print("ChatGPT: install and configure OpenAI Secure MCP Tunnel separately; point its stdio command at the line above.")
        elif args.command == "logs":
            compose("logs", "--tail", str(args.tail), check=False)
    except (RuntimeError, OSError, ValueError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
