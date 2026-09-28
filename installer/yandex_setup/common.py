"""Filesystem, command and MCP transport helpers; credentials never enter argv."""

import getpass
import json
import os
import re
import secrets
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(os.environ.get("YP_HOME", "/opt/yandex-mcp"))


def fail(message):
    raise RuntimeError(message)


def config():
    return json.loads((ROOT / "config.json").read_text())


def secure_write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + "." + secrets.token_hex(6))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def compose_command():
    return [
        "docker",
        "compose",
        "--project-name",
        config()["project_name"],
        "--file",
        str(ROOT / "compose.yaml"),
    ]


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def payload(result):
    if not isinstance(result, dict):
        raise RuntimeError("MCP вернул некорректный ответ")  # noqa: TRY004
    if result.get("error"):
        e = result["error"]
        # Whitelist API error fields instead of dumping response bodies or headers.
        info = {
            k: e[k]
            for k in (
                "tool",
                "type",
                "http_status",
                "error_code",
                "request_id",
                "message",
                "detail",
            )
            if k in e
        }
        raise RuntimeError(sanitize(json.dumps(info, ensure_ascii=False))[:700])
    return result


def decode(response):
    payload(response)
    result = response.get("result", {})
    if result.get("isError"):
        raise RuntimeError("MCP отклонил запрос; проверь доступы и yp doctor")
    if "structuredContent" in result:
        return payload(result["structuredContent"])
    for item in result.get("content", []):
        if item.get("type") == "text":
            return payload(json.loads(item["text"]))
    return result


def rpc(name, arguments=None, timeout=90, method="tools/call"):
    messages = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "yp", "version": "1.0"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {
            "jsonrpc": "2.0",
            "id": 2,
            "method": method,
            "params": (
                {"name": name, "arguments": arguments or {}}
                if method == "tools/call"
                else {}
            ),
        },
    ]
    command = compose_command() + [
        "exec",
        "-T",
        "direct",
        "yandex-direct-metrica-mcp",
        "--transport",
        "stdio",
    ]
    result = subprocess.run(
        command,
        input="".join(json.dumps(m) + "\n" for m in messages),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )
    for line in result.stdout.splitlines():
        try:
            response = json.loads(line)
        except ValueError:
            continue
        if response.get("id") == 2:
            return decode(response)
    raise RuntimeError("MCP не ответил. Проверь yp doctor и Docker Compose.")


def rpc_sse(name, arguments=None, timeout=45, method="tools/call"):
    """Reload the persistent loopback server; tunnel processes refresh the same file by mtime."""
    base = "http://127.0.0.1:" + str(config()["port"])
    # Never use the caller's proxy for localhost, or export it to the MCP container.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    stream = opener.open(base + "/sse", timeout=timeout)

    def event(raw=False):
        lines = []
        while True:
            line = stream.readline()
            if not line:
                raise RuntimeError("MCP закрыл SSE соединение")
            text = line.decode().rstrip("\r\n")
            if text.startswith("data: "):
                lines.append(text[6:])
            elif not text and lines:
                value = "\n".join(lines)
                return value if raw else json.loads(value)

    def post(path, message):
        request = urllib.request.Request(
            base + path,
            data=json.dumps(message).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with opener.open(request, timeout=timeout) as response:
            response.read()

    try:
        endpoint = event(raw=True)
        if not endpoint.startswith("/messages/"):
            raise RuntimeError("Неожиданный MCP endpoint")
        post(
            endpoint,
            {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {},
                    "clientInfo": {"name": "yp", "version": "1.0"},
                },
            },
        )
        event()
        post(endpoint, {"jsonrpc": "2.0", "method": "notifications/initialized"})
        post(
            endpoint,
            {
                "jsonrpc": "2.0",
                "id": 2,
                "method": method,
                "params": (
                    {"name": name, "arguments": arguments or {}}
                    if method == "tools/call"
                    else {}
                ),
            },
        )
        while True:
            response = event()
            if response.get("id") == 2:
                return decode(response)
    finally:
        stream.close()


def write_yandex_env(token, audience=False):
    if not token or "\n" in token or "\r" in token:
        raise ValueError("Некорректный токен")
    values = {
        "YANDEX_ACCESS_TOKEN": token,
        "MCP_PUBLIC_READONLY": "true",
        "MCP_WRITE_ENABLED": "false",
        "HF_WRITE_ENABLED": "false",
        "HF_DESTRUCTIVE_ENABLED": "false",
        "MCP_ACCOUNTS_WRITE_ENABLED": "false",
        "MCP_AUTH_TOOLS_ENABLED": "false",
        "MCP_AUDIENCE_ENABLED": str(audience).lower(),
        "MCP_WORDSTAT_ENABLED": "false",
        "MCP_SEARCH_API_ENABLED": "false",
        "MCP_CACHE_ENABLED": "true",
    }
    if audience:
        values["YANDEX_AUDIENCE_ACCESS_TOKEN"] = token
    # Compose env files must not interpolate '$' in credentials.
    secure_write(
        ROOT / "secrets/yandex.env",
        "".join(k + "='" + v.replace("'", "\\'") + "'\n" for k, v in values.items()),
    )


def tools_list(transport="sse"):
    result = (rpc_sse if transport == "sse" else rpc)(
        None, method="tools/list", timeout=8
    )
    tools = result.get("tools")
    if not isinstance(tools, list) or not tools:
        raise RuntimeError("MCP tools/list вернул пустой или некорректный список")
    return tools


def wait_ready(timeout=40):
    deadline = time.monotonic() + timeout
    while True:
        try:
            return tools_list()
        except (RuntimeError, OSError, ValueError):
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    "MCP не стал готов за отведённое время; прежний token будет восстановлен"
                ) from None
            time.sleep(1)


def sanitize(message, values=()):
    text = str(message)
    hidden = list(values)
    for filename in (
        "oauth-active.json",
        "oauth-candidate.json",
        "oauth-app.json",
        "oauth-app-candidate.json",
    ):
        try:
            content = json.loads((ROOT / "secrets" / filename).read_text())
            hidden.extend(
                content.get(k, "")
                for k in ("access_token", "refresh_token", "client_secret")
            )
        except (OSError, ValueError):
            pass
    for filename in ("tunnel-runtime-key", "tunnel-proxy"):
        try:
            hidden.append((ROOT / "secrets" / filename).read_text().strip())
        except OSError:
            pass
    for value in hidden:
        if value:
            text = text.replace(str(value), "[скрыто]")
    return re.sub(r"(?:sk-proj-|y0__)[A-Za-z0-9_-]+", "[скрыто]", text)


def hidden(prompt):
    if not sys.stdin.isatty():
        raise RuntimeError(
            "Для скрытого ввода нужен интерактивный терминал (SSH с TTY). Запусти yp setup в терминале."
        )
    return getpass.getpass(prompt)
