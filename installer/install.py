#!/usr/bin/env python3
"""Install a self-contained Linux runtime without carrying deployment data."""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1]


def prepare(prefix, project_name="yandex-mcp", port=8000):
    previous = os.umask(0o022)
    try:
        return _prepare(prefix, project_name, port)
    finally:
        os.umask(previous)


def _prepare(prefix, project_name="yandex-mcp", port=8000):
    prefix = Path(prefix)
    if prefix.exists():
        raise RuntimeError(
            "Каталог установки уже существует; выбери новый --prefix. Рабочая установка не перезаписывается."
        )
    prefix.mkdir(parents=True, mode=0o755)
    prefix.chmod(0o755)
    for folder in (
        "state",
        "secrets",
        "backups",
        "exports",
        "dashboards",
        "bin",
        "code",
        "source",
    ):
        (prefix / folder).mkdir(
            mode=0o700 if folder in ("secrets", "backups") else 0o755
        )
    for name in ("src", "pyproject.toml", "README.md", "Dockerfile"):
        path = SOURCE / name
        target = prefix / "source" / name
        if path.is_dir():
            shutil.copytree(
                path, target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
            )
        else:
            shutil.copy2(path, target)
    template = "docs/templates/dashboard-template-option1-2026-01-28.html"
    (prefix / "source" / template).parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(SOURCE / template, prefix / "source" / template)
    shutil.copytree(
        SOURCE / "installer/yandex_setup",
        prefix / "code/yandex_setup",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    for folder in ("exports", "dashboards"):
        if os.geteuid() == 0:
            os.chown(prefix / folder, 10001, 10001)
    (prefix / "state/accounts.json").write_text('{"accounts": []}\n')
    (prefix / "config.json").write_text(
        json.dumps({"project_name": project_name, "port": port}, indent=2) + "\n"
    )
    env = prefix / "secrets/yandex.env"
    env.touch(mode=0o600)
    compose = f"""services:
  direct:
    build:
      context: ./source
      args:
        MCP_EDITION: public
        MCP_PUBLIC_READONLY: "true"
    image: local/{project_name}:installer
    command: [yandex-direct-metrica-mcp, --transport, sse, --port, "8000"]
    env_file: ./secrets/yandex.env
    environment:
      MCP_ACCOUNTS_FILE: /data/accounts.json
    volumes:
      - ./state:/data:rw
      - ./exports:/exports:rw
      - ./dashboards:/dashboards:rw
    ports:
      - "127.0.0.1:{port}:8000"
    restart: unless-stopped
    security_opt: ["no-new-privileges:true"]
    read_only: true
    tmpfs: ["/tmp:size=256m,mode=1777"]
    logging:
      driver: json-file
      options: {{max-size: "10m", max-file: "3"}}
    healthcheck:
      test: [CMD, python, -c, "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/sse',timeout=2).close()"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 30s
"""
    (prefix / "compose.yaml").write_text(compose)
    launcher = f"""#!/usr/bin/env python3
import os, sys
os.environ["YP_HOME"]={str(prefix)!r}
if os.geteuid()!=0:
    os.execvp("sudo", ["sudo", "/usr/bin/python3", {str(prefix / "bin/yp")!r}, *sys.argv[1:]])
sys.path.insert(0, {str(prefix / "code")!r})
from yandex_setup.app import locked_main
locked_main()
"""
    (prefix / "bin/yp").write_text(launcher)
    (prefix / "bin/yp").chmod(0o755)
    stdio = f"""#!/bin/sh
set -eu
# Proxy belongs to tunnel-client only. Docker exec never receives proxy overrides.
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
exec /usr/bin/docker compose --project-name {project_name} --file {prefix}/compose.yaml exec -T direct yandex-direct-metrica-mcp --transport stdio
"""
    (prefix / "bin/mcp-stdio").write_text(stdio)
    (prefix / "bin/mcp-stdio").chmod(0o755)
    return prefix


def install_compose_plugin():
    arch = {"x86_64": "x86_64", "aarch64": "aarch64", "arm64": "aarch64"}.get(
        platform.machine()
    )
    if not arch:
        raise RuntimeError("Compose plugin: поддерживаются amd64/arm64")
    with urllib.request.urlopen(
        "https://api.github.com/repos/docker/compose/releases/latest", timeout=30
    ) as response:
        release = json.load(response)
    name = "docker-compose-linux-" + arch
    assets = {
        asset["name"]: asset["browser_download_url"] for asset in release["assets"]
    }
    with urllib.request.urlopen(assets[name + ".sha256"], timeout=30) as response:
        expected = response.read().decode().split()[0]
    with urllib.request.urlopen(assets[name], timeout=120) as response:
        binary = response.read()
    if hashlib.sha256(binary).hexdigest() != expected:
        raise RuntimeError("Checksum Docker Compose не совпал")
    target = Path("/usr/local/lib/docker/cli-plugins/docker-compose")
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        raise RuntimeError(
            "Существующий Compose plugin не заменяется. Исправь Docker Compose вручную."
        )
    target.write_bytes(binary)
    target.chmod(0o755)
    print(
        "Официальный Docker Compose plugin установлен, SHA256 проверен: "
        + release["tag_name"]
    )


def install_docker_engine(os_file=Path("/etc/os-release"), apt_root=Path("/etc/apt")):
    release = {}
    for line in os_file.read_text().splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            release[key] = value.strip().strip('"').strip("'")
    distro = release.get("ID")
    suite = release.get("VERSION_CODENAME", "")
    if distro not in ("debian", "ubuntu") or not re.fullmatch(r"[a-z]+", suite):
        raise RuntimeError(
            "Автоматическая установка Docker поддерживает Debian/Ubuntu. Установи Docker Engine 28+ вручную."
        )
    arch = subprocess.check_output(["dpkg", "--print-architecture"], text=True).strip()
    if arch not in ("amd64", "arm64"):
        raise RuntimeError("Поддерживаются amd64/arm64")
    key = apt_root / "keyrings/yandex-mcp-docker.asc"
    source = apt_root / "sources.list.d/yandex-mcp-docker.sources"
    expected = f"Types: deb\nURIs: https://download.docker.com/linux/{distro}\nSuites: {suite}\nComponents: stable\nArchitectures: {arch}\nSigned-By: {key}\n"
    if source.exists() and source.read_text() != expected:
        raise RuntimeError(
            "Существующий apt source отличается; установщик его не заменяет"
        )
    key.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    with urllib.request.urlopen(
        "https://download.docker.com/linux/" + distro + "/gpg", timeout=30
    ) as response:
        public_key = response.read()
    if b"BEGIN PGP PUBLIC KEY BLOCK" not in public_key:
        raise RuntimeError("Получен некорректный публичный ключ Docker")
    key.write_bytes(public_key)
    key.chmod(0o644)
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text(expected)
    source.chmod(0o644)
    subprocess.run(["apt-get", "update"], check=True)
    subprocess.run(
        [
            "apt-get",
            "install",
            "-y",
            "docker-ce",
            "docker-ce-cli",
            "containerd.io",
            "docker-buildx-plugin",
            "docker-compose-plugin",
        ],
        check=True,
    )


def dependencies():
    if not shutil.which("apt-get"):
        raise RuntimeError("Для --install-deps нужен Debian/Ubuntu с apt-get")
    subprocess.run(["apt-get", "update"], check=True)
    subprocess.run(
        ["apt-get", "install", "-y", "python3", "ca-certificates", "sudo", "curl"],
        check=True,
    )
    if not shutil.which("docker"):
        install_docker_engine()
    if subprocess.run(
        ["docker", "compose", "version"], capture_output=True, check=False
    ).returncode:
        for package in ("docker-compose-plugin", "docker-compose-v2"):
            if (
                subprocess.run(
                    ["apt-cache", "show", package], capture_output=True, check=False
                ).returncode
                == 0
            ):
                subprocess.run(["apt-get", "install", "-y", package], check=True)
                break
        else:
            install_compose_plugin()
    subprocess.run(["docker", "compose", "version"], check=True)
    subprocess.run(["systemctl", "enable", "--now", "docker"], check=True)


def trusted_parent(prefix):
    for parent in Path(prefix).parents:
        if parent.is_symlink():
            raise RuntimeError("Каталог установки не должен находиться внутри symlink")
        if parent.exists():
            stat = parent.stat()
            if stat.st_uid != 0 or stat.st_mode & 0o022:
                raise RuntimeError(
                    "Родительский каталог должен принадлежать root и не разрешать запись группе/остальным: "
                    + str(parent)
                )


def main():
    parser = argparse.ArgumentParser(
        description="Русский установщик Yandex MCP для Debian/Ubuntu Linux"
    )
    parser.add_argument("--prefix", default="/opt/yandex-mcp")
    parser.add_argument("--project-name", default="yandex-mcp")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--install-deps",
        action="store_true",
        help="Установить отсутствующий Docker из официального apt-репозитория",
    )
    parser.add_argument(
        "--no-setup",
        action="store_true",
        help="Только установка файлов; настроить позднее командой yp setup",
    )
    parser.add_argument(
        "--plan", action="store_true", help="Показать действия без изменения системы"
    )
    args = parser.parse_args()
    if (
        not re.fullmatch(r"/[a-zA-Z0-9_./-]+", args.prefix)
        or ".." in Path(args.prefix).parts
        or args.prefix == "/"
    ):
        parser.error("--prefix должен быть абсолютным путём без пробелов и ..")
    if Path(args.prefix).parts[1] in (
        "root",
        "home",
        "tmp",
        "run",
        "proc",
        "sys",
        "dev",
        "usr",
        "etc",
    ):
        parser.error(
            "Выбери постоянный каталог в /opt или /srv; домашние и системные каталоги не поддерживаются"
        )
    if not re.fullmatch(r"[a-z][a-z0-9_-]{1,13}", args.project_name):
        parser.error("Некорректное имя Docker Compose проекта")
    if not 1024 <= args.port <= 65535:
        parser.error("Порт должен быть в диапазоне 1024..65535")
    if sys.version_info < (3, 10):  # noqa: UP036 - bootstrap may run before dependency install
        parser.error("Нужен Python 3.10+")
    if args.plan:
        print(
            f"Установка: {args.prefix}; Compose: {args.project_name}; MCP: 127.0.0.1:{args.port}"
        )
        print(
            "Команды: yp, yandex-project. Пустой registry. OAuth и ключи вводятся локально."
        )
        print(
            "Tunnel: отдельная systemd-служба, только исходящий HTTPS, опциональный proxy процесса."
        )
        return
    if sys.platform != "linux":
        parser.error(
            "Системный установщик поддерживает Linux; на macOS используй исходный scripts/setup.py"
        )
    if os.geteuid() != 0:
        os.execvp(
            "sudo",
            ["sudo", sys.executable, str(Path(__file__).resolve()), *sys.argv[1:]],
        )
    if not Path("/run/systemd/system").exists():
        parser.error("Нужен запущенный systemd в VM/LXC/VPS")
    if Path(args.prefix).exists():
        parser.error("Каталог уже существует. Выбери другой --prefix.")
    # Check aliases before creating any runtime files.
    for name in ("yp", "yandex-project"):
        p = Path("/usr/bin") / name
        if p.exists() or p.is_symlink():
            parser.error(f"{p} уже существует; рабочая команда не заменяется")
    trusted_parent(args.prefix)
    if args.install_deps:
        dependencies()
    for tool in ("docker", "curl", "sudo", "visudo", "useradd"):
        if not shutil.which(tool):
            parser.error(f"Не найдена команда {tool}. Повтори с --install-deps.")
    if not Path("/usr/bin/docker").exists():
        parser.error("Ожидается Docker Engine в /usr/bin/docker")
    subprocess.run(["docker", "compose", "version"], check=True)
    version = subprocess.check_output(
        ["docker", "info", "--format", "{{.ServerVersion}}"], text=True
    ).strip()
    if int(version.split(".")[0]) < 28:
        parser.error("Нужен Docker Engine 28+: обнови существующий Docker отдельно")
    prefix = prepare(args.prefix, args.project_name, args.port)
    for name in ("yp", "yandex-project"):
        (Path("/usr/bin") / name).symlink_to(prefix / "bin/yp")
    print("Установлено. Следующий шаг: yp setup")
    if not args.no_setup:
        subprocess.run([str(prefix / "bin/yp"), "setup"], check=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as e:
        print(f"Ошибка установки: {e}", file=sys.stderr)
        sys.exit(1)
