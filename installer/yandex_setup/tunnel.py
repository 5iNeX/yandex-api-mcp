"""Optional outbound-only OpenAI tunnel with process-scoped proxy and systemd credentials."""

import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

from .common import ROOT, config, hidden, secure_write

DOCS = "https://developers.openai.com/api/docs/guides/secure-mcp-tunnels"


def download_client():
    existing = shutil.which("tunnel-client") or (
        "/usr/local/bin/tunnel-client"
        if Path("/usr/local/bin/tunnel-client").is_file()
        else None
    )
    if existing:
        target = ROOT / "bin/tunnel-client"
        shutil.copy2(existing, target)
        target.chmod(0o755)
        return str(target)
    arch = {"x86_64": "amd64", "aarch64": "arm64", "arm64": "arm64"}.get(
        platform.machine()
    )
    if not arch:
        raise RuntimeError("Поддерживаются Linux amd64/arm64")
    with urllib.request.urlopen(
        "https://api.github.com/repos/openai/tunnel-client/releases/latest", timeout=30
    ) as response:
        release = json.load(response)
    version = release["tag_name"]
    name = f"tunnel-client-{version}-linux-{arch}.zip"
    assets = {a["name"]: a["browser_download_url"] for a in release["assets"]}
    with urllib.request.urlopen(assets["SHA256SUMS.txt"], timeout=30) as response:
        sums = response.read().decode()
    match = re.search(
        r"^([a-fA-F0-9]{64})\s+\*?" + re.escape(name) + r"$", sums, re.MULTILINE
    )
    if not match:
        raise RuntimeError("Не найден checksum официального tunnel-client")
    with urllib.request.urlopen(assets[name], timeout=120) as response:
        archive = response.read()
    if hashlib.sha256(archive).hexdigest() != match.group(1).lower():
        raise RuntimeError("Checksum tunnel-client не совпал")
    with tempfile.TemporaryDirectory(prefix="yp-tunnel-") as td:
        path = Path(td) / name
        path.write_bytes(archive)
        with zipfile.ZipFile(path) as z:
            binary = next(
                (x for x in z.namelist() if x.split("/")[-1] == "tunnel-client"), None
            )
            if not binary:
                raise RuntimeError("В релизе нет бинарного файла tunnel-client")
            target = ROOT / "bin/tunnel-client"
            target.write_bytes(z.read(binary))
            target.chmod(0o755)
    print("Официальный tunnel-client установлен, SHA256 проверен: " + version)
    return str(target)


def network_check(proxy=""):
    # v0.0.15 accepts HTTP/HTTPS CONNECT proxy URLs, not SOCKS.
    args = [
        "curl",
        "--silent",
        "--show-error",
        "--output",
        "/dev/null",
        "--write-out",
        "%{http_code}",
        "--connect-timeout",
        "10",
        "--max-time",
        "20",
        "https://api.openai.com/v1/models",
    ]
    # Proxy may contain credentials; pass it through curl stdin config, never argv.
    configuration = ""
    if proxy:
        parsed = urllib.parse.urlparse(proxy)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise RuntimeError(
                "tunnel-client принимает HTTP/HTTPS proxy. Для SOCKS нужен существующий HTTP CONNECT bridge."
            )
        if "\n" in proxy or "\r" in proxy:
            raise RuntimeError("Некорректный proxy URL")
        configuration = "proxy = " + json.dumps(proxy) + "\n"
        args += ["--config", "-"]
    environment = dict(os.environ)
    for key in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
        environment.pop(key, None)
    result = subprocess.run(
        args,
        input=configuration,
        text=True,
        capture_output=True,
        env=environment,
        check=False,
    )
    if result.returncode != 0 or result.stdout.strip() not in ("200", "401", "404"):
        raise RuntimeError(
            f"OpenAI недоступен по выбранному маршруту (HTTP {result.stdout.strip() or '000'}). Настрой существующий proxy и повтори yp tunnel."
        )
    print("DNS/TLS/HTTPS к OpenAI доступны по выбранному маршруту.")


def profile_text(tunnel_id, command, health_port=8080, proxy=False):
    return (
        "config_version: 1\n"
        + ('http_proxy: "env:HTTPS_PROXY"\n' if proxy else "")
        + 'control_plane:\n  base_url: "https://api.openai.com"\n  tunnel_id: '
        + json.dumps(tunnel_id)
        + '\n  api_key: "env:CONTROL_PLANE_API_KEY"\nhealth:\n  listen_addr: "127.0.0.1:'
        + str(health_port)
        + '"\nadmin_ui:\n  open_browser: false\nlog:\n  level: info\n  format: json\nmcp:\n  commands:\n    - channel: main\n      command: '
        + json.dumps(command)
        + "\n"
    )


def service_text(root, project, binary, proxy=False):
    unit = "yandex-mcp-tunnel-" + project
    return (
        f"""[Unit]
Description=Yandex MCP OpenAI Tunnel ({project})
Wants=network-online.target
Requires=docker.service
After=network-online.target docker.service
StartLimitIntervalSec=120
StartLimitBurst=10
[Service]
Type=simple
User={unit}
Group={unit}
LoadCredential=runtime-key:{root}/secrets/tunnel-runtime-key
"""
        + (f"LoadCredential=proxy-url:{root}/secrets/tunnel-proxy\n" if proxy else "")
        + f"""ExecStart={root}/bin/tunnel-run
Restart=always
RestartSec=5
TimeoutStopSec=20
PrivateTmp=true
ProtectHome=true
UMask=0077
[Install]
WantedBy=multi-user.target
"""
    )


def environment(key):
    env = dict(os.environ, CONTROL_PLANE_API_KEY=key)
    for name in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
        env.pop(name, None)
    return env


def setup():
    project = config()["project_name"]
    unit = "yandex-mcp-tunnel-" + project
    if (ROOT / "tunnel/profile.yaml").exists():
        raise RuntimeError(
            "Tunnel уже настроен. Перед заменой сохрани конфигурацию; установщик не перезаписывает действующий профиль."
        )
    proxy = hidden(
        "HTTP/HTTPS proxy только для tunnel-client (пусто — прямое соединение, ввод скрыт): "
    ).strip()
    network_check(proxy)
    binary = download_client()
    print(
        "Создай свой Tunnel и привяжи свой ChatGPT workspace: https://platform.openai.com/settings/organization/tunnels"
    )
    print("Runtime API key должен иметь Tunnels Read + Use. Инструкция: " + DOCS)
    tunnel_id = input("Tunnel ID: ").strip()
    if not re.fullmatch(r"tunnel_[A-Za-z0-9]+", tunnel_id):
        raise RuntimeError("Некорректный tunnel_id")
    key = hidden("Runtime API key (ввод скрыт): ").strip()
    if not key or "\n" in key:
        raise RuntimeError("Некорректный runtime key")
    health_port = int(input("Локальный health/UI порт [8080]: ").strip() or "8080")
    if not 1024 <= health_port <= 65535 or health_port == config()["port"]:
        raise RuntimeError("Некорректный health порт")
    with socket.socket() as probe:
        try:
            probe.bind(("127.0.0.1", health_port))
        except OSError:
            raise RuntimeError("Health порт занят, выбери другой") from None
    secure_write(ROOT / "secrets/tunnel-runtime-key", key)
    if proxy:
        secure_write(ROOT / "secrets/tunnel-proxy", proxy)
    else:
        (ROOT / "secrets/tunnel-proxy").unlink(missing_ok=True)
    tunnel_dir = ROOT / "tunnel"
    tunnel_dir.mkdir(mode=0o755, exist_ok=True)
    tunnel_dir.chmod(0o755)
    command = "sudo -n " + str(ROOT / "bin/mcp-stdio")
    profile = tunnel_dir / "profile.yaml"
    profile.write_text(profile_text(tunnel_id, command, health_port, bool(proxy)))
    profile.chmod(0o644)
    env = environment(key)
    if proxy:
        env["HTTPS_PROXY"] = proxy
    # Doctor checks the real profile before any service is enabled. Capture logs: no secrets in terminal output.
    result = subprocess.run(
        [
            binary,
            "doctor",
            "--profile",
            "profile",
            "--profile-dir",
            str(tunnel_dir),
            "--explain",
        ],
        env=env,
        capture_output=True,
        text=True,
        timeout=55,
        check=False,
    )
    if result.returncode:
        profile.unlink()
        raise RuntimeError(
            "Tunnel doctor не прошёл. Проверь runtime key, права Tunnels Read + Use и workspace association. Сервис не включён."
        )
    if subprocess.run(["id", "-u", unit], capture_output=True, check=False).returncode:
        subprocess.run(
            [
                "useradd",
                "--system",
                "--no-create-home",
                "--shell",
                "/usr/sbin/nologin",
                unit,
            ],
            check=True,
            capture_output=True,
        )
    sudo_path = Path("/etc/sudoers.d") / unit
    sudo_path.write_text(
        f'Defaults:{unit} !use_pty\n{unit} ALL=(root) NOPASSWD: {ROOT}/bin/mcp-stdio ""\n'
    )
    sudo_path.chmod(0o440)
    subprocess.run(["visudo", "-cf", str(sudo_path)], check=True, capture_output=True)
    runner = f"""#!/usr/bin/python3
import os
from pathlib import Path
credentials=Path(os.environ["CREDENTIALS_DIRECTORY"])
os.environ["CONTROL_PLANE_API_KEY"]=(credentials/"runtime-key").read_text().strip()
for key in ("HTTP_PROXY","HTTPS_PROXY","ALL_PROXY","http_proxy","https_proxy","all_proxy"):
    os.environ.pop(key,None)
if (credentials/"proxy-url").exists():
    os.environ["HTTPS_PROXY"]=(credentials/"proxy-url").read_text().strip()
os.execv({binary!r},[{binary!r},"run","--profile","profile","--profile-dir",{str(tunnel_dir)!r}])
"""
    (ROOT / "bin/tunnel-run").write_text(runner)
    (ROOT / "bin/tunnel-run").chmod(0o755)
    Path("/etc/systemd/system/" + unit + ".service").write_text(
        service_text(ROOT, project, binary, bool(proxy))
    )
    cfg = config()
    cfg["tunnel"] = {
        "id": tunnel_id,
        "health_port": health_port,
        "unit": unit + ".service",
        "binary": binary,
    }
    (ROOT / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", unit + ".service"], check=True)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    deadline = time.monotonic() + 30
    while True:
        try:
            for path in ("healthz", "readyz"):
                with opener.open(
                    f"http://127.0.0.1:{health_port}/{path}", timeout=3
                ) as response:
                    if response.status != 200:
                        raise OSError("not ready")
            print("Tunnel: /healthz и /readyz OK. Полная диагностика: yp doctor.")
            break
        except OSError:
            if time.monotonic() >= deadline:
                raise RuntimeError(
                    "Служба настроена, но tunnel ещё не ready. Проверь yp doctor и workspace association."
                ) from None
            time.sleep(1)
    print(
        "В ChatGPT: Plugins → создать developer-mode app → Connection: Tunnel → "
        + tunnel_id
    )
