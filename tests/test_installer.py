"""Installer acceptance checks; all provider requests and service changes are mocked."""

import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from types import SimpleNamespace

import pytest

from installer.install import install_docker_engine, prepare
from installer.yandex_setup import app, auth, common, projects, tunnel


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: True)
    root = prepare(tmp_path / "runtime", "test-mcp", 18080)
    for module in (app, auth, common, projects, tunnel):
        monkeypatch.setattr(module, "ROOT", root)
    monkeypatch.setattr(projects, "REGISTRY", root / "state/accounts.json")
    monkeypatch.setattr(projects, "BACKUPS", root / "backups")
    return root


def active(root, services=("direct", "metrika")):
    common.secure_write(
        root / "secrets/oauth-active.json", json.dumps({"services": list(services)})
    )


def test_prepare_is_empty_private_and_refuses_overwrite(runtime):
    assert json.loads((runtime / "state/accounts.json").read_text()) == {"accounts": []}
    assert (runtime / "secrets").stat().st_mode & 0o777 == 0o700
    assert (runtime / "secrets/yandex.env").stat().st_mode & 0o777 == 0o600
    compose = (runtime / "compose.yaml").read_text()
    assert "127.0.0.1:18080:8000" in compose
    assert "read_only: true" in compose and 'MCP_PUBLIC_READONLY: "true"' in compose
    wrapper = (runtime / "bin/mcp-stdio").read_text()
    assert "unset HTTP_PROXY HTTPS_PROXY ALL_PROXY" in wrapper
    assert "test-mcp" in wrapper and "compose-direct-1" not in wrapper
    with pytest.raises(RuntimeError):
        prepare(runtime)
    assert json.loads((runtime / "state/accounts.json").read_text()) == {"accounts": []}


def test_secret_atomic_replacement_and_sanitized_errors(runtime):
    path = runtime / "secrets/oauth-active.json"
    common.secure_write(path, json.dumps({"access_token": "fixture-credential"}))
    assert path.stat().st_mode & 0o777 == 0o600
    with pytest.raises(RuntimeError) as error:
        common.payload(
            {
                "error": {
                    "http_status": 403,
                    "message": "rejected fixture-credential",
                    "headers": {"Authorization": "unsafe"},
                }
            }
        )
    assert "403" in str(error.value)
    assert "fixture-credential" not in str(error.value)
    assert "unsafe" not in str(error.value)


def test_metrika_only_and_pagination(runtime, monkeypatch):
    active(runtime, ("metrika",))
    calls = []

    def call(name, args):
        calls.append((name, args))
        assert name == "metrica.list_counters"
        offset = args["params"]["offset"]
        return {"counters": [{"id": str(offset), "name": "Счётчик"}], "rows": 2}

    monkeypatch.setattr(projects, "mcp_call_stdio", call)
    clients, counters = projects.discover(
        [{"id": "existing", "metrica_counter_ids": ["1"]}]
    )
    assert clients == [] and [c["id"] for c in counters] == ["2"]
    assert [a["params"]["offset"] for _, a in calls] == [1, 2]
    with pytest.raises(RuntimeError, match="не подключён"):
        projects.discover([], ["direct"])


def test_direct_add_does_not_call_metrika(runtime, monkeypatch):
    active(runtime)
    calls = []

    def call(name, args):
        calls.append(name)
        assert name == "direct.list_clients"
        assert "page" not in args
        return {"result": {"Clients": [{"Login": "fixture-client", "ClientId": 1}]}}

    monkeypatch.setattr(projects, "mcp_call_stdio", call)
    monkeypatch.setattr(projects, "choose", lambda *a, **k: ["fixture-client"])
    monkeypatch.setattr(projects, "confirm", lambda *a: True)
    monkeypatch.setattr(projects, "msg", lambda *a, **k: None)
    monkeypatch.setattr(
        projects, "reload_and_verify", lambda: projects.load_registry()["accounts"]
    )
    projects.add_direct([])
    assert calls == ["direct.list_clients"]
    assert projects.load_registry()["accounts"] == [
        {
            "id": "fixture-client",
            "name": "fixture-client",
            "direct_client_login": "fixture-client",
        }
    ]
    assert len(list((runtime / "backups").glob("accounts-*"))) == 1


def test_real_handlers_link_and_remove_confirmed_registry(runtime, monkeypatch):
    registry = {
        "accounts": [
            {"id": "d", "direct_client_login": "example"},
            {"id": "m", "metrica_counter_ids": ["123"]},
        ]
    }
    projects.save_registry(registry, backup=False)
    picks = iter(["d", "m"])
    monkeypatch.setattr(projects, "choose", lambda *a, **k: next(picks))
    monkeypatch.setattr(projects, "confirm", lambda *a: True)
    monkeypatch.setattr(projects, "msg", lambda *a, **k: None)
    monkeypatch.setattr(
        projects, "reload_and_verify", lambda: projects.load_registry()["accounts"]
    )
    projects.link_existing(registry["accounts"])
    assert projects.load_registry()["accounts"] == [
        {
            "id": "d",
            "direct_client_login": "example",
            "metrica_counter_ids": ["123"],
            "name": None,
        }
    ]
    monkeypatch.setattr(projects, "choose", lambda *a, **k: ["d"])
    monkeypatch.setattr(projects, "confirm", lambda *a: False)
    projects.remove_projects(projects.load_registry()["accounts"])
    assert len(projects.load_registry()["accounts"]) == 1
    monkeypatch.setattr(projects, "confirm", lambda *a: True)
    projects.remove_projects(projects.load_registry()["accounts"])
    assert projects.load_registry()["accounts"] == []
    assert len(list((runtime / "backups").glob("accounts-*"))) == 2


def test_failed_mcp_readiness_rolls_back_token_and_keeps_candidate(
    runtime, monkeypatch
):
    old = "YANDEX_ACCESS_TOKEN='fixture-old'\n"
    common.secure_write(runtime / "secrets/yandex.env", old)
    old_active = {
        "access_token": "fixture-old",
        "issued_at": 1,
        "services": ["metrika"],
    }
    common.secure_write(runtime / "secrets/oauth-active.json", json.dumps(old_active))
    monkeypatch.setattr(auth, "verify", lambda *a: None)
    calls = []
    monkeypatch.setattr(
        auth.subprocess,
        "run",
        lambda args, **kwargs: calls.append(args) or SimpleNamespace(returncode=0),
    )

    def not_ready():
        raise RuntimeError("not ready")

    monkeypatch.setattr(auth, "wait_ready", not_ready)
    candidate = {
        "access_token": "fixture-new",
        "refresh_token": "fixture-rotated",
        "services": ["metrika"],
    }
    with pytest.raises(RuntimeError, match="восстановлена"):
        auth.activate(candidate)
    assert (runtime / "secrets/yandex.env").read_text() == old
    assert json.loads((runtime / "secrets/oauth-active.json").read_text()) == old_active
    assert (
        json.loads((runtime / "secrets/oauth-candidate.json").read_text()) == candidate
    )
    assert len(calls) == 2
    assert "fixture-new" not in str(calls)


def test_rejected_api_candidate_does_not_restart_mcp(runtime, monkeypatch):
    old = "YANDEX_ACCESS_TOKEN='fixture-old'\n"
    common.secure_write(runtime / "secrets/yandex.env", old)

    def reject(*a):
        raise RuntimeError("HTTP 403")

    monkeypatch.setattr(auth, "verify", reject)
    monkeypatch.setattr(
        auth.subprocess, "run", lambda *a, **k: pytest.fail("Must not restart")
    )
    with pytest.raises(RuntimeError, match="403"):
        auth.activate({"access_token": "fixture-rejected", "services": ["direct"]})
    assert (runtime / "secrets/yandex.env").read_text() == old


def test_oauth_pkce_hidden_exchange_and_success(runtime, monkeypatch, capsys):
    answers = iter(
        [
            "client-public",
            "",
        ]
    )
    secrets = iter(["fixture-secret", "fixture-code"])
    monkeypatch.setattr(auth, "service_choice", lambda: (["metrika"], False))
    # OAuth method, client ID and redirect URI.
    answers = iter(["1", "client-public", ""])
    monkeypatch.setattr("builtins.input", lambda *a: next(answers))
    monkeypatch.setattr(common.getpass, "getpass", lambda *a: next(secrets))
    requests = []

    def request(url, **kwargs):
        requests.append((url, kwargs))
        return {
            "access_token": "fixture-access",
            "refresh_token": "fixture-refresh",
            "expires_in": 31536000,
        }

    monkeypatch.setattr(auth, "request_json", request)
    candidates = []
    monkeypatch.setattr(
        auth, "activate", lambda candidate, app: candidates.append((candidate, app))
    )
    auth.setup()
    output = capsys.readouterr().out
    for secret in (
        "fixture-secret",
        "fixture-code",
        "fixture-access",
        "fixture-refresh",
    ):
        assert secret not in output
    assert "code_challenge_method=S256" in output and "scope=metrika%3Aread" in output
    fields = urllib.parse.parse_qs(requests[0][1]["data"].decode())
    assert fields["grant_type"] == ["authorization_code"] and fields["code"] == [
        "fixture-code"
    ]
    verifier = fields["code_verifier"][0]
    assert 43 <= len(verifier) <= 128
    assert candidates[0][0]["services"] == ["metrika"]


def test_mismatched_oauth_state_stops_before_exchange(runtime, monkeypatch):
    monkeypatch.setattr(auth, "service_choice", lambda: (["metrika"], False))
    answers = iter(["1", "client-public", ""])
    hidden = iter(
        [
            "fixture-secret",
            "https://oauth.yandex.ru/verification_code?code=fixture&state=wrong",
        ]
    )
    monkeypatch.setattr("builtins.input", lambda *a: next(answers))
    monkeypatch.setattr(common.getpass, "getpass", lambda *a: next(hidden))
    monkeypatch.setattr(
        auth,
        "request_json",
        lambda *a, **k: pytest.fail("Wrong state must not be exchanged"),
    )
    with pytest.raises(RuntimeError, match="state"):
        auth.setup()


def test_proxy_is_process_scoped_and_not_in_argv(runtime, monkeypatch):
    calls = []
    monkeypatch.setenv("HTTPS_PROXY", "http://ambient.invalid:8080")

    def run(args, **kw):
        calls.append((args, kw))
        return SimpleNamespace(returncode=0, stdout="401")

    monkeypatch.setattr(tunnel.subprocess, "run", run)
    secret_proxy = "http://user:fixture-password@127.0.0.1:8080"
    tunnel.network_check(secret_proxy)
    args, options = calls[0]
    assert secret_proxy not in str(args) and secret_proxy in options["input"]
    assert "HTTPS_PROXY" not in options["env"]
    assert os.environ["HTTPS_PROXY"] == "http://ambient.invalid:8080"
    profile = tunnel.profile_text(
        "tunnel_example", "sudo -n /opt/example/bin/mcp-stdio", proxy=True
    )
    unit = tunnel.service_text(
        Path("/opt/example"), "example", "/opt/example/bin/tunnel-client", True
    )
    assert "env:HTTPS_PROXY" in profile and "env:CONTROL_PLANE_API_KEY" in profile
    assert "LoadCredential=runtime-key:" in unit and "LoadCredential=proxy-url:" in unit
    assert "Environment=" not in unit and "fixture-password" not in unit
    assert "Restart=always" in unit and "127.0.0.1:8080" in profile


def test_no_credentials_prompt_when_openai_network_fails(runtime, monkeypatch):
    monkeypatch.setattr(common.getpass, "getpass", lambda *a: "")

    def fail(*a):
        raise RuntimeError("network unavailable")

    monkeypatch.setattr(tunnel, "network_check", fail)
    monkeypatch.setattr(
        "builtins.input",
        lambda *a: pytest.fail("Credentials asked before network check"),
    )
    monkeypatch.setattr(
        tunnel, "download_client", lambda: pytest.fail("Network must be checked first")
    )
    with pytest.raises(RuntimeError, match="network"):
        tunnel.setup()


def test_bad_release_checksum_is_rejected(runtime, monkeypatch):
    monkeypatch.setattr(tunnel.shutil, "which", lambda *a: None)
    monkeypatch.setattr(tunnel.Path, "is_file", lambda *a: False)
    monkeypatch.setattr(tunnel.platform, "machine", lambda: "x86_64")
    name = "tunnel-client-v0.0.15-linux-amd64.zip"
    release = {
        "tag_name": "v0.0.15",
        "assets": [
            {"name": name, "browser_download_url": "https://fixture.invalid/binary"},
            {
                "name": "SHA256SUMS.txt",
                "browser_download_url": "https://fixture.invalid/checksums",
            },
        ],
    }
    bodies = {
        "https://api.github.com/repos/openai/tunnel-client/releases/latest": json.dumps(
            release
        ).encode(),
        "https://fixture.invalid/checksums": ("0" * 64 + "  " + name + "\n").encode(),
        "https://fixture.invalid/binary": b"corrupt",
    }
    monkeypatch.setattr(
        tunnel.urllib.request, "urlopen", lambda url, **kw: io.BytesIO(bodies[url])
    )
    with pytest.raises(RuntimeError, match="Checksum"):
        tunnel.download_client()
    assert not (runtime / "bin/tunnel-client").exists()


@pytest.mark.parametrize("value", ["/", "/root/mcp", "/opt/a/../b", "/opt/x;id"])
def test_installer_rejects_unsafe_prefix(value):
    result = subprocess.run(
        ["python3", "installer/install.py", "--plan", "--prefix", value],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0


def test_socks_proxy_rejected_before_credentials(runtime, monkeypatch):
    monkeypatch.setattr(
        tunnel.subprocess,
        "run",
        lambda *a, **kw: pytest.fail("Unsupported SOCKS must fail before requests"),
    )
    with pytest.raises(RuntimeError, match="HTTP/HTTPS"):
        tunnel.network_check("socks5://127.0.0.1:1080")


def test_hidden_input_refuses_echoing_non_tty(monkeypatch):
    monkeypatch.setattr(sys.stdin, "isatty", lambda: False)
    monkeypatch.setattr(
        common.getpass, "getpass", lambda *a: pytest.fail("Non-TTY must be rejected")
    )
    with pytest.raises(RuntimeError, match="терминал"):
        common.hidden("Secret: ")


def test_restrictive_shell_umask_does_not_break_service_access(tmp_path):
    previous = os.umask(0o077)
    try:
        root = prepare(tmp_path / "runtime")
    finally:
        os.umask(previous)
    assert (root / "bin").stat().st_mode & 0o777 == 0o755
    assert (root / "code").stat().st_mode & 0o777 == 0o755
    assert (root / "code/yandex_setup/app.py").stat().st_mode & 0o777 == 0o644
    assert (root / "secrets").stat().st_mode & 0o777 == 0o700


def test_http_api_errors_keep_reason_and_hide_token(runtime, monkeypatch):
    token = "fixture-api-token"
    body = json.dumps(
        {
            "errors": [
                {"error_type": "access_denied", "message": "no scope for " + token}
            ],
            "code": 403,
        }
    ).encode()

    class Opener:
        def open(self, *a, **kw):
            raise urllib.error.HTTPError(
                "https://fixture.invalid/api", 403, "Forbidden", {}, io.BytesIO(body)
            )

    monkeypatch.setattr(auth.urllib.request, "build_opener", lambda *a: Opener())
    with pytest.raises(RuntimeError) as error:
        auth.request_json("https://fixture.invalid/api", token)
    text = str(error.value)
    assert "403" in text and "access_denied" in text
    assert token not in text


def test_fresh_engine_uses_signed_official_repo_without_removing_packages(
    tmp_path, monkeypatch
):
    os_file = tmp_path / "os-release"
    os_file.write_text("ID=debian\nVERSION_CODENAME=bookworm\n")
    monkeypatch.setattr(subprocess, "check_output", lambda *a, **kw: "amd64\n")
    calls = []
    monkeypatch.setattr(subprocess, "run", lambda args, **kw: calls.append(args))
    monkeypatch.setattr(
        urllib.request,
        "urlopen",
        lambda *a, **kw: io.BytesIO(b"-----BEGIN PGP PUBLIC KEY BLOCK-----\nfixture\n"),
    )
    apt_root = tmp_path / "apt"
    install_docker_engine(os_file, apt_root)
    source = (apt_root / "sources.list.d/yandex-mcp-docker.sources").read_text()
    assert "https://download.docker.com/linux/debian" in source
    assert "Suites: bookworm" in source and "Signed-By:" in source
    assert "docker-ce" in calls[-1] and "docker-compose-plugin" in calls[-1]
    assert all("remove" not in call for call in calls)
    assert (apt_root / "keyrings/yandex-mcp-docker.asc").stat().st_mode & 0o777 == 0o644
