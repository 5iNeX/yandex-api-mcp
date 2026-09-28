"""Installed yp entry point: setup, operations and the Russian projects menu."""

import argparse
import fcntl
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

from . import auth, projects, tunnel
from .common import ROOT, config, sanitize, tools_list


def refresh_timer():
    current = json.loads((ROOT / "secrets/oauth-active.json").read_text())
    name = "yandex-mcp-refresh-" + config()["project_name"]
    if not current.get("refresh_token"):
        subprocess.run(
            ["systemctl", "disable", "--now", name + ".timer"],
            capture_output=True,
            check=False,
        )
        return
    # Environment is supplied to the container via its root-readable env file.
    unit = f"""[Unit]
Description=Refresh Yandex MCP OAuth ({config()["project_name"]})
After=docker.service
[Service]
Type=oneshot
ExecStart={ROOT}/bin/yp refresh
UMask=0077
"""
    timer = f"""[Unit]
Description=Check Yandex MCP OAuth expiry daily
[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true
Unit={name}.service
[Install]
WantedBy=timers.target
"""
    Path("/etc/systemd/system/" + name + ".service").write_text(unit)
    Path("/etc/systemd/system/" + name + ".timer").write_text(timer)
    subprocess.run(["systemctl", "daemon-reload"], check=True)
    subprocess.run(["systemctl", "enable", "--now", name + ".timer"], check=True)


def oauth():
    auth.setup()
    refresh_timer()


def setup():
    print(
        "Yandex MCP: первоначальная настройка\nДанные вводятся здесь, на твоём сервере."
    )
    if (ROOT / "secrets/oauth-active.json").exists():
        print("OAuth уже настроен. Заменить авторизацию можно через yp oauth.")
    else:
        oauth()
    if not config().get("tunnel") and input(
        "Настроить OpenAI Tunnel сейчас? [Д/н]: "
    ).strip().lower() not in ("н", "нет", "n", "no"):
        tunnel.setup()
    print(
        "Готово: yp — меню проектов; yp doctor — диагностика; yp connector — подключение ChatGPT."
    )
    print("Добавь нужные проекты в реестр командой yp; по умолчанию реестр пустой.")


def connector():
    cfg = config()
    item = cfg.get("tunnel")
    if not item:
        raise RuntimeError("Сначала запусти yp tunnel")
    print(
        "1. В OpenAI Platform привяжи Tunnel к своему ChatGPT workspace и организации."
    )
    print("   https://platform.openai.com/settings/organization/tunnels")
    print("2. В ChatGPT открой Settings → Plugins → developer-mode app.")
    print("3. Connection: Tunnel. Tunnel ID: " + item["id"])
    print(
        "4. После подключения попроси ChatGPT вызвать accounts.list и показать доступные инструменты."
    )
    print(
        "Для частного подключения требуется developer mode и разрешение администратора workspace."
    )
    print("Документация: " + tunnel.DOCS)


def doctor():
    errors = []
    for transport in ("sse", "stdio"):
        try:
            tools = tools_list(transport)
            print(f"MCP {transport}: tools/list OK ({len(tools)} инструментов)")
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
            print("MCP " + transport + ": " + sanitize(e))
            errors.append(transport)
    if not errors:
        try:
            profiles = projects.reload_and_verify()
            print(f"Реестр: {len(profiles)} проектов, accounts.list OK")
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
            print("Реестр: " + sanitize(e))
            errors.append("registry")
    cfg = config()
    item = cfg.get("tunnel")
    if item:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        for path in ("healthz", "readyz"):
            try:
                with opener.open(
                    f"http://127.0.0.1:{item['health_port']}/{path}", timeout=5
                ) as response:
                    print("Tunnel /" + path + ": HTTP " + str(response.status))
            except OSError:
                print("Tunnel /" + path + ": недоступен")
                errors.append(path)
        key = (ROOT / "secrets/tunnel-runtime-key").read_text().strip()
        env = tunnel.environment(key)
        proxy = ROOT / "secrets/tunnel-proxy"
        if proxy.exists():
            env["HTTPS_PROXY"] = proxy.read_text().strip()
        binary = config()["tunnel"]["binary"]
        result = subprocess.run(
            [
                binary,
                "doctor",
                "--profile",
                "profile",
                "--profile-dir",
                str(ROOT / "tunnel"),
                "--explain",
            ],
            env=env,
            capture_output=True,
            text=True,
            timeout=55,
            check=False,
        )
        if result.returncode:
            print("Tunnel doctor: ошибка. Проверь права ключа и workspace association.")
            errors.append("tunnel doctor")
        else:
            print("Tunnel doctor: OK")
        print(
            "Маршрут OpenAI: "
            + (
                "proxy только tunnel-client"
                if proxy.exists()
                else "прямой исходящий HTTPS"
            )
        )
    else:
        print("Tunnel не настроен; подключение: yp tunnel")
    print(
        "MCP endpoint: 127.0.0.1:"
        + str(cfg["port"])
        + "; общий маршрут сервера не менялся."
    )
    print(
        "tools/list у удалённого клиента проверяется в ChatGPT после подключения: yp connector."
    )
    if errors:
        raise RuntimeError("Диагностика выявила ошибки: " + ", ".join(errors))


def main():
    parser = argparse.ArgumentParser(
        description="Yandex MCP — русское управление сервером"
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="projects",
        choices=[
            "projects",
            "setup",
            "oauth",
            "resume",
            "refresh",
            "tunnel",
            "doctor",
            "connector",
        ],
    )
    parser.add_argument("--show", action="store_true", help="Показать проекты без меню")
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Обновить реестр и проверить accounts.list",
    )
    parser.add_argument(
        "--discover", action="store_true", help="Показать новые доступные аккаунты"
    )
    args = parser.parse_args()
    try:
        if args.command == "projects":
            if not (ROOT / "secrets/oauth-active.json").exists():
                raise RuntimeError("Сначала настрой доступы: yp setup")
            sys.argv = [sys.argv[0]] + (
                ["--show"]
                if args.show
                else ["--verify"]
                if args.verify
                else ["--discover"]
                if args.discover
                else []
            )
            projects.main()
        elif args.command == "resume":
            auth.resume()
            refresh_timer()
        else:
            {
                "setup": setup,
                "oauth": oauth,
                "refresh": auth.refresh,
                "tunnel": tunnel.setup,
                "doctor": doctor,
                "connector": connector,
            }[args.command]()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as e:
        print("Ошибка: " + sanitize(e), file=sys.stderr)
        raise SystemExit(1) from None
    except (KeyboardInterrupt, EOFError):
        print("\nНастройка прервана. Продолжить: yp setup", file=sys.stderr)
        raise SystemExit(130) from None


def locked_main():
    # Serialize local operators and refresh timer; a second process cannot replace a stale registry/token.
    with (ROOT / "operation.lock").open("a") as stream:
        try:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit("Уже работает другая команда yp. Дождись её завершения.")
        main()
