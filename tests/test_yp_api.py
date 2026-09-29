"""Minimal checks for the standalone administrator CLI's persistent files."""

import importlib.util
import json
from pathlib import Path
import stat


def load_cli(tmp_path, monkeypatch):
    monkeypatch.setenv("YP_API_ROOT", str(tmp_path))
    source = Path(__file__).resolve().parents[1] / "scripts" / "yp_api.py"
    spec = importlib.util.spec_from_file_location("yp_api_test", source)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_secure_registry_and_project_changes(tmp_path, monkeypatch):
    cli = load_cli(tmp_path, monkeypatch)
    cli.secure_json(cli.PROJECTS, {"accounts": []})
    cli.projects("add", "alpha", "Alpha", "agency-login")
    value = json.loads(cli.PROJECTS.read_text())
    assert value["accounts"][0]["direct_client_login"] == "agency-login"
    assert stat.S_IMODE(cli.PROJECTS.stat().st_mode) == 0o600
    cli.projects("remove", "alpha", None, None)
    assert json.loads(cli.PROJECTS.read_text())["accounts"] == []


def test_refresh_state_does_not_drop_refresh_token(tmp_path, monkeypatch):
    cli = load_cli(tmp_path, monkeypatch)
    cli.save_token({"access_token": "new", "expires_in": 3600}, {"refresh_token": "rotating"})
    value = json.loads(cli.OAUTH.read_text())
    assert value["access_token"] == "new"
    assert value["refresh_token"] == "rotating"
    assert stat.S_IMODE(cli.OAUTH.stat().st_mode) == 0o600


def test_setup_generates_secret_and_registry_files(tmp_path, monkeypatch):
    cli = load_cli(tmp_path, monkeypatch)
    monkeypatch.setattr("builtins.input", lambda _: "app-id")
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: "app-secret")
    cli.setup()
    assert json.loads(cli.APP.read_text())["client_id"] == "app-id"
    assert json.loads(cli.PROJECTS.read_text())["accounts"][0]["id"] == "default"
    assert stat.S_IMODE(cli.APP.stat().st_mode) & 0o007 == 0
    assert stat.S_IMODE(cli.PROJECTS.stat().st_mode) == 0o600


def test_oauth_requests_service_specific_scopes(tmp_path, monkeypatch, capsys):
    cli = load_cli(tmp_path, monkeypatch)
    cli.secure_json(cli.APP, {"client_id": "app-id", "client_secret": "secret",
                              "redirect_uri": "https://oauth.yandex.ru/verification_code"})
    monkeypatch.setattr(cli.getpass, "getpass", lambda _: "auth-code")
    monkeypatch.setattr(cli, "token_request", lambda _: {"access_token": "ACCESS_SECRET_VALUE",
                                                         "refresh_token": "refresh", "expires_in": 3600})
    cli.oauth(["webmaster", "direct"])
    output = capsys.readouterr().out
    assert "webmaster%3Averify" in output
    assert "direct%3Aapi" in output
    assert "app-secret" not in output
    assert "ACCESS_SECRET_VALUE" not in output
