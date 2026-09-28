#!/usr/bin/env python3
"""Russian interactive manager for the existing Yandex MCP accounts registry."""

import datetime as dt
import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import unicodedata

from .common import ROOT, fail, rpc, rpc_sse
from .ui import choose, confirm, msg

REGISTRY = ROOT / "state/accounts.json"
BACKUPS = ROOT / "backups"
error = fail
mcp_call = rpc_sse
mcp_call_stdio = rpc


def data_payload(value):
    if isinstance(value, dict) and isinstance(value.get("result"), dict):
        return value["result"]
    return value if isinstance(value, dict) else {}


def load_registry(path=None):
    path = path or REGISTRY
    try:
        d = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(d, dict) or not isinstance(d.get("accounts"), list):
            raise ValueError("ожидался объект с массивом accounts")  # noqa: TRY004
        return d
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
        error(f"не удалось прочитать {path}: {e}")


def backup_registry(path=None):
    path = path or REGISTRY
    BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    target = BACKUPS / f"accounts-{stamp}.json.bak"
    suffix = 1
    while target.exists():
        target = BACKUPS / f"accounts-{stamp}-{suffix}.json.bak"
        suffix += 1
    shutil.copy2(path, target)
    return target


def save_registry(d, path=None, backup=True):
    path = path or REGISTRY
    if backup:
        saved = backup_registry(path)
        print(f"Резервная копия: {saved}")
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.chmod(tmp, path.stat().st_mode & 0o777)
    os.replace(tmp, path)


def reload_and_verify():
    mcp_call("accounts.reload")
    data = data_payload(mcp_call("accounts.list"))
    current = load_registry()["accounts"]
    profiles = (
        data.get("accounts", data.get("accounts_list", []))
        if isinstance(data, dict)
        else []
    )
    if not isinstance(profiles, list):
        raise RuntimeError("accounts.list не вернул список профилей")  # noqa: TRY004
    api_ids = {str(x.get("id")) for x in profiles if isinstance(x, dict)}
    disk_ids = {str(x.get("id")) for x in current}
    if api_ids != disk_ids:
        raise RuntimeError(
            "accounts.list после перезагрузки не совпал с локальным registry"
        )
    return profiles


def direct_login(a):
    return str(a.get("direct_client_login") or "").strip()


def counter_ids(a):
    v = a.get("metrica_counter_ids") or []
    if isinstance(v, (str, int)):
        v = [v]
    return {str(x) for x in v if x not in (None, "")}


def print_projects(accounts):
    print(f"Реестр: {REGISTRY}\n")
    if not accounts:
        print("Нет проектов в мониторинге.")
        return
    for a in accounts:
        print(a.get("id", "—"))
        print(f"  Название: {a.get('name') or '—'}")
        print(f"  Direct: {direct_login(a) or '—'}")
        print(f"  Метрика: {', '.join(sorted(counter_ids(a))) or '—'}")
        print("  Статус: в мониторинге\n")


def discover(accounts, services=None):
    enabled = json.loads((ROOT / "secrets/oauth-active.json").read_text())["services"]
    requested = set(services or enabled)
    if not requested.issubset(set(enabled)):
        raise RuntimeError("Этот сервис не подключён. Настрой доступы через yp oauth.")
    clients = []
    counters = []
    if "direct" in requested:
        raw = data_payload(
            mcp_call_stdio(
                "direct.list_clients", {"field_names": ["ClientId", "Login"]}
            )
        )
        clients = raw.get("Clients", raw.get("clients", [])) or []
    if "metrika" in requested:
        offset = 1
        while offset <= 100000:
            raw = data_payload(
                mcp_call_stdio(
                    "metrica.list_counters",
                    {"params": {"offset": offset, "per_page": 1000}},
                )
            )
            page = raw.get("counters", []) or []
            counters.extend(page)
            rows = raw.get("rows")
            if (rows is not None and len(counters) >= int(rows)) or (
                rows is None and len(page) < 1000
            ):
                break
            if not page:
                raise RuntimeError(
                    "Метрика вернула неполный список счётчиков; повтори поиск"
                )
            offset += len(page)
    have_logins = {direct_login(a).casefold() for a in accounts if direct_login(a)}
    have_counters = (
        set().union(*(counter_ids(a) for a in accounts)) if accounts else set()
    )
    return (
        [c for c in clients if d_login(c).casefold() not in have_logins],
        [c for c in counters if c_id(c) not in have_counters],
    )


def slug(value):
    s = unicodedata.normalize("NFKD", str(value or "").casefold())
    translit = {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "д": "d",
        "е": "e",
        "ё": "e",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "й": "i",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "h",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    }
    s = "".join(translit.get(ch, ch) for ch in s)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return (s or "project")[:48]


def unique_id(base, accounts):
    used = {str(a.get("id", "")).casefold() for a in accounts}
    base = slug(base)
    if base not in used:
        return base
    i = 2
    while f"{base}-{i}" in used:
        i += 1
    return f"{base}-{i}"


def c_id(c):
    return str(c.get("id") or c.get("CounterId") or "")


def c_site(c):
    site = c.get("site2")
    if isinstance(site, dict):
        site = site.get("domain") or site.get("site")
    return str(site or c.get("site") or "")


def c_name(c):
    return str(c.get("name") or c.get("Name") or c_site(c) or c_id(c))


def d_login(c):
    return str(c.get("Login") or c.get("login") or "").strip()


def d_name(c):
    return str(c.get("ClientInfo") or c.get("Name") or d_login(c))


def show_discovery(clients, counters):
    print("Новые Direct клиенты:")
    if not clients:
        print("  Нет")
    for c in clients:
        print(
            f"  {d_name(c)} — login {d_login(c)} (ClientId {c.get('ClientId', c.get('ClientID', '—'))})"
        )
    print("\nНовые счётчики Метрики:")
    if not counters:
        print("  Нет")
    for c in counters:
        print(f"  {c_name(c)} — счётчик {c_id(c)} ({c_site(c) or 'домен не указан'})")


def save_and_reload(d):
    save_registry(d)
    try:
        profiles = reload_and_verify()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
        msg(
            f"Реестр записан, но MCP не подтвердил перезагрузку: {e}\nПерезапусти пункт «Обновить реестр MCP» или проверь accounts.list."
        )
        return
    msg(f"Реестр обновлён. MCP accounts.list подтверждает {len(profiles)} проект(а).")


def add_direct(accounts):
    clients, _ = discover(accounts, ["direct"])
    items = [
        (d_login(c), f"{d_name(c)} — login {d_login(c)}") for c in clients if d_login(c)
    ]
    chosen = choose(
        "Добавить Direct",
        "Выбери аккаунты (Пробел — отметить, Enter — продолжить):",
        items,
    )
    if not chosen:
        return
    chosen_clients = [c for c in clients if d_login(c) in chosen]
    d = load_registry()
    existing = d["accounts"]
    additions = []
    for c in chosen_clients:
        login = d_login(c)
        additions.append(
            {
                "id": unique_id(login, existing + additions),
                "name": d_name(c),
                "direct_client_login": login,
            }
        )
    summary = "Добавить в мониторинг только Direct?\n\n" + "\n".join(
        f"• {a['id']} — {a['direct_client_login']}" for a in additions
    )
    if confirm(summary):
        d["accounts"].extend(additions)
        save_and_reload(d)


def add_metrica(accounts):
    _, counters = discover(accounts, ["metrika"])
    items = [
        (c_id(c), f"{c_name(c)} — {c_id(c)} — {c_site(c) or 'домен не указан'}")
        for c in counters
        if c_id(c)
    ]
    chosen = choose(
        "Добавить Метрику",
        "Выбери счётчики (Пробел — отметить, Enter — продолжить):",
        items,
    )
    if not chosen:
        return
    d = load_registry()
    existing = d["accounts"]
    additions = []
    for c in counters:
        cid = c_id(c)
        if cid in chosen:
            additions.append(
                {
                    "id": unique_id(
                        f"{c_site(c) or c_name(c)}-{cid}", existing + additions
                    ),
                    "name": c_name(c),
                    "metrica_counter_ids": [cid],
                }
            )
    if confirm(
        "Добавить в мониторинг только Метрику?\n\n"
        + "\n".join(f"• {a['id']} — {a['metrica_counter_ids'][0]}" for a in additions)
    ):
        d["accounts"].extend(additions)
        save_and_reload(d)


def norm(s):
    s = (
        str(s or "")
        .casefold()
        .replace("https://", "")
        .replace("http://", "")
        .split("/")[0]
    )
    s = s.removeprefix("www.").split(":")[0]
    return re.sub(r"[^a-zа-яё0-9]+", "", s)


def match_score(client, counter):
    login = norm(d_login(client))
    cname = norm(d_name(client))
    site = norm(c_site(counter))
    mname = norm(c_name(counter))
    candidates = [x for x in (login, cname) if x]
    targets = [x for x in (site, mname) if x]
    best = 0.0
    for a in candidates:
        for b in targets:
            if a == b:
                best = max(best, 1.0)
            elif len(a) > 3 and (a in b or b in a):
                best = max(best, 0.9)
            else:
                best = max(best, difflib.SequenceMatcher(None, a, b).ratio())
    return best


def add_linked(accounts):
    clients, counters = discover(accounts)
    if not clients or not counters:
        msg(
            "Чтобы связать новые аккаунты, сначала нужен новый Direct клиент и новый счётчик Метрики.\nСуществующие записи можно связать через пункт «Связать добавленные профили»."
        )
        return
    d_items = [
        (d_login(c), f"{d_name(c)} — {d_login(c)}") for c in clients if d_login(c)
    ]
    selected = choose(
        "Связать Direct + Метрика", "Выбери Direct аккаунты для добавления:", d_items
    )
    if not selected:
        return
    d = load_registry()
    additions = []
    for client in [c for c in clients if d_login(c) in selected]:
        available = [
            c
            for c in counters
            if c_id(c)
            not in set().union(*(counter_ids(a) for a in d["accounts"] + additions))
        ]
        if not available:
            break
        ranked = sorted(
            ((match_score(client, c), c) for c in available),
            key=lambda x: x[0],
            reverse=True,
        )
        suggestion = (
            ranked[0][1]
            if ranked
            and ranked[0][0] >= 0.86
            and (len(ranked) == 1 or ranked[0][0] > ranked[1][0])
            else None
        )
        choices = [
            (
                c_id(c),
                f"{c_name(c)} — {c_id(c)} — {c_site(c) or 'домен не указан'}"
                + ("  ← похоже подходит" if c is suggestion else ""),
            )
            for c in available
        ]
        picked = choose(
            "Выбор счётчика",
            "Выбери один счётчик. Сопоставление — только подсказка:",
            choices,
            multiple=False,
            selected=[c_id(suggestion)] if suggestion else [],
        )
        if not picked:
            return
        counter = next(c for c in available if c_id(c) == picked)
        additions.append(
            {
                "id": unique_id(d_login(client), d["accounts"] + additions),
                "name": c_name(counter) or d_name(client),
                "direct_client_login": d_login(client),
                "metrica_counter_ids": [c_id(counter)],
            }
        )
    if additions and confirm(
        "Добавить связанные профили?\n\n"
        + "\n".join(
            f"• {a['id']}\n  Direct: {a['direct_client_login']}\n  Метрика: {a['metrica_counter_ids'][0]}"
            for a in additions
        )
    ):
        d["accounts"].extend(additions)
        save_and_reload(d)


def link_existing(accounts):
    directs = [a for a in accounts if direct_login(a)]
    metrics = [a for a in accounts if counter_ids(a) and not direct_login(a)]
    if not directs or not metrics:
        msg("Нет отдельной пары Direct-only и Метрика-only для связи.")
        return
    dsel = choose(
        "Связать профили",
        "Выбери Direct профиль:",
        [(a["id"], f"{a.get('name', a['id'])} — {direct_login(a)}") for a in directs],
        multiple=False,
    )
    if not dsel:
        return
    msel = choose(
        "Связать профили",
        "Выбери профиль Метрики:",
        [
            (a["id"], f"{a.get('name', a['id'])} — {', '.join(sorted(counter_ids(a)))}")
            for a in metrics
        ],
        multiple=False,
    )
    if not msel:
        return
    target = next(a for a in directs if a["id"] == dsel)
    source = next(a for a in metrics if a["id"] == msel)
    if not confirm(
        f"Связать профили?\n\nDirect: {target['id']} ({direct_login(target)})\nМетрика: {source['id']} ({', '.join(sorted(counter_ids(source)))})\n\nПрофиль Метрики будет объединён с Direct профилем."
    ):
        return
    d = load_registry()
    dst = next(a for a in d["accounts"] if a["id"] == dsel)
    src = next(a for a in d["accounts"] if a["id"] == msel)
    dst["metrica_counter_ids"] = sorted(counter_ids(dst) | counter_ids(src))
    dst["name"] = src.get("name") or dst.get("name")
    d["accounts"] = [a for a in d["accounts"] if a["id"] != msel]
    save_and_reload(d)


def remove_projects(accounts):
    items = [
        (
            a.get("id", ""),
            f"{a.get('name') or a.get('id')} — Direct: {direct_login(a) or '—'}, Метрика: {', '.join(sorted(counter_ids(a))) or '—'}",
        )
        for a in accounts
    ]
    chosen = choose(
        "Исключить из мониторинга",
        "Отметь проекты для удаления из локального реестра:",
        items,
    )
    if not chosen:
        return
    picked = [a for a in accounts if a.get("id") in chosen]
    summary = (
        "Удалить из active registry? Данные в Яндексе не изменятся.\n\n"
        + "\n".join(f"• {a.get('id')} — {a.get('name')}" for a in picked)
    )
    if not confirm(summary):
        return
    d = load_registry()
    d["accounts"] = [a for a in d["accounts"] if a.get("id") not in chosen]
    save_and_reload(d)


def manual_direct(accounts):
    enabled = json.loads((ROOT / "secrets/oauth-active.json").read_text())["services"]
    if "direct" not in enabled:
        raise RuntimeError("Сначала подключи Direct через yp oauth")
    login = input("Логин клиента Direct (Client-Login): ").strip()
    if not re.fullmatch(r"[A-Za-z0-9_.@-]{1,128}", login):
        raise RuntimeError("Некорректный логин Direct")
    if any(direct_login(a).casefold() == login.casefold() for a in accounts):
        raise RuntimeError("Этот Direct уже добавлен")
    mcp_call_stdio(
        "direct.list_campaigns", {"field_names": ["Id"], "direct_client_login": login}
    )
    d = load_registry()
    if confirm("Доступ Direct проверен. Добавить профиль " + login + "?"):
        d["accounts"].append(
            {
                "id": unique_id(login, d["accounts"]),
                "name": login,
                "direct_client_login": login,
            }
        )
        save_and_reload(d)


def main():
    accounts = load_registry()["accounts"]
    if len(sys.argv) > 1 and sys.argv[1] == "--show":
        print_projects(accounts)
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--verify":
        profiles = reload_and_verify()
        print(
            f"OK: accounts_reload выполнен; accounts_list подтвердил {len(profiles)} проектов."
        )
        print_projects(accounts)
        return
    if len(sys.argv) > 1 and sys.argv[1] == "--discover":
        try:
            show_discovery(*discover(accounts))
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
            error(str(e))
        return
    while True:
        selected = choose(
            "Yandex MCP",
            "Управление проектами мониторинга:",
            [
                ("find", "Найти новые Direct и Метрику"),
                ("direct", "Добавить только Direct"),
                ("manual", "Добавить Direct по известному логину"),
                ("metrica", "Добавить только Метрику"),
                ("linked", "Добавить Direct + Метрику"),
                ("link", "Связать добавленные профили"),
                ("remove", "Исключить из мониторинга"),
                ("show", "Показать проекты"),
                ("reload", "Обновить реестр MCP"),
                ("exit", "Выход"),
            ],
            multiple=False,
        )
        if selected in (None, "exit"):
            break
        try:
            accounts = load_registry()["accounts"]
            if selected == "find":
                clients, counters = discover(accounts)
                import contextlib
                import io

                output = io.StringIO()
                with contextlib.redirect_stdout(output):
                    show_discovery(clients, counters)
                msg(output.getvalue(), title="Найденные новые записи")
                if not clients and not counters:
                    msg("Новых доступных записей не найдено.")
                elif confirm(
                    "Добавить найденные записи сейчас?\nВыбери режим добавления в следующем меню."
                ):
                    kind = choose(
                        "Режим добавления",
                        "Как добавить выбранные новые записи?",
                        [
                            ("direct", "Только Direct"),
                            ("metrica", "Только Метрика"),
                            ("linked", "Связать Direct + Метрика"),
                            ("back", "Назад"),
                        ],
                        multiple=False,
                    )
                    if kind == "direct":
                        add_direct(accounts)
                    elif kind == "metrica":
                        add_metrica(accounts)
                    elif kind == "linked":
                        add_linked(accounts)
            elif selected == "direct":
                add_direct(accounts)
            elif selected == "manual":
                manual_direct(accounts)
            elif selected == "metrica":
                add_metrica(accounts)
            elif selected == "linked":
                add_linked(accounts)
            elif selected == "link":
                link_existing(accounts)
            elif selected == "remove":
                remove_projects(accounts)
            elif selected == "show":
                msg(
                    "\n".join(
                        [
                            f"{a.get('id')}\n  Direct: {direct_login(a) or '—'}\n  Метрика: {', '.join(sorted(counter_ids(a))) or '—'}"
                            for a in accounts
                        ]
                    )
                    or "Нет проектов в мониторинге.",
                    title="Проекты в мониторинге",
                )
            elif selected == "reload":
                profiles = reload_and_verify()
                msg(f"accounts_reload выполнен; MCP видит {len(profiles)} проектов.")
        except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as e:
            msg(str(e), title="Ошибка")


if __name__ == "__main__":
    main()
