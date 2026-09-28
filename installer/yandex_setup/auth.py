"""Hidden-input OAuth code flow and validated token rotation."""

import base64
import hashlib
import json
import secrets
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from .common import (
    ROOT,
    compose_command,
    hidden,
    sanitize,
    secure_write,
    wait_ready,
    write_yandex_env,
)

REDIRECT = "https://oauth.yandex.ru/verification_code"
OAUTH = "https://oauth.yandex.ru"


def request_json(url, token=None, data=None, basic=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "OAuth " + token
    if basic:
        headers["Authorization"] = "Basic " + basic
    if data is not None and not isinstance(data, bytes):
        data = json.dumps(data).encode()
    if basic:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=data, headers=headers)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as e:
        values = [token, basic]
        if basic:
            values.append(base64.b64decode(basic).decode().split(":", 1)[-1])
            if isinstance(data, bytes):
                values.extend(
                    v
                    for items in urllib.parse.parse_qs(data.decode()).values()
                    for v in items
                )
        details = []
        try:
            body = json.loads(e.read(65536))
            entries = [body.get("error", body)] + body.get("errors", [])
            for entry in entries:
                if isinstance(entry, dict):
                    details.append(
                        {
                            k: entry[k]
                            for k in (
                                "error_code",
                                "error_string",
                                "error_detail",
                                "error_type",
                                "code",
                                "message",
                                "error_description",
                            )
                            if k in entry
                        }
                    )
                elif isinstance(entry, str):
                    details.append(entry)
        except (ValueError, OSError):
            pass
        detail = sanitize(json.dumps(details, ensure_ascii=False), values)[:500]
        raise RuntimeError(
            f"API {urllib.parse.urlparse(url).hostname}: HTTP {e.code}; " + detail
        ) from None
    if result.get("error"):
        error = result["error"]
        if isinstance(error, dict):
            text = f"{error.get('error_code', '')} {error.get('error_string', '')} {error.get('error_detail', '')}"
        else:
            text = str(error)
        raise RuntimeError(
            "API отклонил запрос: " + sanitize(text, (token, basic))[:250]
        )
    return result


def verify(token, services, audience=False):
    if "direct" in services:
        request_json(
            "https://api.direct.yandex.com/json/v5/clients",
            token,
            {"method": "get", "params": {"FieldNames": ["ClientId", "Login"]}},
        )
    if "metrika" in services:
        request_json("https://api-metrika.yandex.net/management/v1/counters", token)
    if audience:
        request_json("https://api-audience.yandex.ru/v1/management/segments", token)


def service_choice():
    print(
        "Какие доступы подключить?\n1 — Direct + Метрика\n2 — Только Direct\n3 — Только Метрика"
    )
    choice = input("Выбор [1]: ").strip() or "1"
    if choice not in ("1", "2", "3"):
        raise RuntimeError("Выбери 1, 2 или 3")
    services = {"1": ["direct", "metrika"], "2": ["direct"], "3": ["metrika"]}[choice]
    audience = input("Подключить Audience? [д/Н]: ").strip().lower() in (
        "д",
        "да",
        "y",
        "yes",
    )
    return services, audience


def activate(candidate, app=None):
    services = candidate["services"]
    audience = candidate.get("audience", False)
    secure_write(ROOT / "secrets/oauth-candidate.json", json.dumps(candidate) + "\n")
    if app:
        secure_write(ROOT / "secrets/oauth-app-candidate.json", json.dumps(app) + "\n")
    else:
        (ROOT / "secrets/oauth-app-candidate.json").unlink(missing_ok=True)
    verify(candidate["access_token"], services, audience)
    secrets_dir = ROOT / "secrets"
    env = secrets_dir / "yandex.env"
    old = env.read_bytes() if env.exists() else b""
    if old:
        backup = ROOT / "backups" / ("oauth-" + str(time.time_ns()) + ".env")
        secure_write(backup, old.decode())
    write_yandex_env(candidate["access_token"], audience)
    try:
        subprocess.run(
            compose_command() + ["up", "-d", "--build", "--force-recreate", "direct"],
            check=True,
        )
        wait_ready()
    except (subprocess.CalledProcessError, RuntimeError, OSError):
        secure_write(env, old.decode())
        subprocess.run(
            compose_command() + ["up", "-d", "--force-recreate", "direct"], check=False
        )
        raise RuntimeError(
            "Запуск не удался, прежняя конфигурация восстановлена"
        ) from None
    secure_write(secrets_dir / "oauth-active.json", json.dumps(candidate) + "\n")
    if app:
        secure_write(secrets_dir / "oauth-app.json", json.dumps(app) + "\n")
    (secrets_dir / "oauth-candidate.json").unlink(missing_ok=True)
    (secrets_dir / "oauth-app-candidate.json").unlink(missing_ok=True)
    # Restart the stdio child only if this installation has an active tunnel.
    unit = (
        "yandex-mcp-tunnel-"
        + json.loads((ROOT / "config.json").read_text())["project_name"]
        + ".service"
    )
    if (
        subprocess.run(
            ["systemctl", "is-active", "--quiet", unit], check=False
        ).returncode
        == 0
    ):
        subprocess.run(["systemctl", "restart", unit], check=True)
    print(
        "Доступы проверены, MCP запущен. Токены сохранены в secrets; значения скрыты."
    )


def setup():
    services, audience = service_choice()
    choice = (
        input("1 — Войти через OAuth, 2 — Ввести действующий токен [1]: ").strip()
        or "1"
    )
    if choice == "2":
        token = hidden("Access token (ввод скрыт): ").strip()
        activate(
            {
                "access_token": token,
                "services": services,
                "audience": audience,
                "issued_at": int(time.time()),
            }
        )
        return
    if choice != "1":
        raise RuntimeError("Выбери 1 или 2")
    print(
        "Создай своё приложение в https://oauth.yandex.ru/; для Direct нужен одобренный production API access."
    )
    client_id = input("Client ID: ").strip()
    client_secret = hidden("Client Secret (ввод скрыт): ").strip()
    if not client_id or not client_secret:
        raise RuntimeError("Нужны Client ID и Client Secret")
    redirect = input("Redirect URI [" + REDIRECT + "]: ").strip() or REDIRECT
    if not redirect.startswith(("https://", "http://127.0.0.1", "http://localhost")):
        raise RuntimeError("Redirect URI должен использовать HTTPS или loopback HTTP")
    verifier = secrets.token_urlsafe(64)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
        .rstrip(b"=")
        .decode()
    )
    state = secrets.token_urlsafe(24)
    scopes = [{"direct": "direct:api", "metrika": "metrika:read"}[s] for s in services]
    if audience:
        scopes.append("audience:read")
    url = (
        OAUTH
        + "/authorize?"
        + urllib.parse.urlencode(
            {
                "response_type": "code",
                "client_id": client_id,
                "redirect_uri": redirect,
                "scope": " ".join(scopes),
                "state": state,
                "code_challenge": challenge,
                "code_challenge_method": "S256",
            }
        )
    )
    print("\nОткрой в браузере, выбери свой Яндекс-аккаунт и подтверди доступ:\n" + url)
    entered = hidden("Код или полный redirect URL (ввод скрыт): ").strip()
    if entered.startswith(("https://", "http://")):
        query = urllib.parse.parse_qs(urllib.parse.urlparse(entered).query)
        if query.get("state", [""])[0] != state:
            raise RuntimeError("OAuth state не совпал")
        if query.get("error"):
            raise RuntimeError("Авторизация не подтверждена")
        code = query.get("code", [""])[0]
    else:
        code = entered
    if not code or len(code) > 256:
        raise RuntimeError("Некорректный код")
    basic = base64.b64encode((client_id + ":" + client_secret).encode()).decode()
    result = request_json(
        OAUTH + "/token",
        data=urllib.parse.urlencode(
            {
                "grant_type": "authorization_code",
                "code": code,
                "code_verifier": verifier,
            }
        ).encode(),
        basic=basic,
    )
    if not result.get("access_token") or not result.get("refresh_token"):
        raise RuntimeError("OAuth не вернул access_token + refresh_token")
    result.update(
        {
            "client_id": client_id,
            "issued_at": int(time.time()),
            "services": services,
            "audience": audience,
        }
    )
    activate(
        result,
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect,
        },
    )


def refresh():
    token_file = ROOT / "secrets/oauth-active.json"
    if not token_file.exists():
        return
    current = json.loads(token_file.read_text())
    if not current.get("refresh_token"):
        print("Refresh token отсутствует: повторный вход через yp oauth.")
        return
    lifetime = int(current.get("expires_in") or 365 * 86400)
    refresh_after = min(75 * 86400, max(0, lifetime - 14 * 86400))
    if time.time() - current["issued_at"] < refresh_after:
        print("Токен ещё свежий.")
        return
    app = json.loads((ROOT / "secrets/oauth-app.json").read_text())
    basic = base64.b64encode(
        (app["client_id"] + ":" + app["client_secret"]).encode()
    ).decode()
    result = request_json(
        OAUTH + "/token",
        data=urllib.parse.urlencode(
            {"grant_type": "refresh_token", "refresh_token": current["refresh_token"]}
        ).encode(),
        basic=basic,
    )
    if not result.get("access_token"):
        raise RuntimeError("OAuth не вернул access_token")
    candidate = {**current, **result, "issued_at": int(time.time())}
    activate(candidate)


def resume():
    candidate = ROOT / "secrets/oauth-candidate.json"
    if not candidate.exists():
        raise RuntimeError("Сохранённого кандидата нет")
    app_path = ROOT / "secrets/oauth-app-candidate.json"
    app = json.loads(app_path.read_text()) if app_path.exists() else None
    activate(json.loads(candidate.read_text()), app)
