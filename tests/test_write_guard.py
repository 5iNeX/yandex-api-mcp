import pytest

from mcp_yandex_ad.config import AppConfig
from mcp_yandex_ad.server import _enforce_write_guard


def _config(**overrides):
    data = dict(
        access_token="token",
        refresh_token=None,
        client_id=None,
        client_secret=None,
        audience_access_token=None,
        audience_refresh_token=None,
        audience_client_id=None,
        audience_client_secret=None,
        direct_client_login=None,
        direct_client_logins=[],
        direct_api_version="v5",
        metrica_counter_ids=[],
        audience_enabled=True,
        wordstat_enabled=True,
        use_sandbox=False,
        write_enabled=False,
        write_sandbox_only=True,
        hf_enabled=True,
        hf_write_enabled=False,
        hf_destructive_enabled=False,
        cache_enabled=True,
        cache_ttl_seconds=300,
        direct_rate_limit_rps=0,
        metrica_rate_limit_rps=0,
        audience_rate_limit_rps=0,
        wordstat_rate_limit_rps=0,
        retry_max_attempts=3,
        retry_base_delay_seconds=0.5,
        retry_max_delay_seconds=8.0,
        content_mode="json",
    )
    data.update(overrides)
    return AppConfig(**data)


def test_write_guard_blocks_when_disabled():
    config = _config(write_enabled=False, use_sandbox=True)
    with pytest.raises(Exception, match="Write operations are disabled"):
        _enforce_write_guard(config, "direct.create_campaigns")


def test_write_guard_blocks_when_not_sandbox():
    config = _config(write_enabled=True, write_sandbox_only=True, use_sandbox=False)
    with pytest.raises(Exception, match="allowed only in sandbox"):
        _enforce_write_guard(config, "direct.update_ads")


def test_write_guard_allows_when_enabled_and_sandbox():
    config = _config(write_enabled=True, write_sandbox_only=True, use_sandbox=True)
    _enforce_write_guard(config, "direct.create_keywords")


def test_write_guard_ignores_read_tool():
    config = _config(write_enabled=False, use_sandbox=False)
    _enforce_write_guard(config, "direct.list_campaigns")


def test_write_guard_treats_raw_call_non_get_as_write():
    config = _config(write_enabled=False, use_sandbox=True)
    with pytest.raises(Exception, match="Write operations are disabled"):
        _enforce_write_guard(config, "direct.raw_call", {"resource": "sitelinks", "method": "add"})


def test_write_guard_allows_raw_call_get():
    config = _config(write_enabled=False, use_sandbox=False)
    _enforce_write_guard(config, "direct.raw_call", {"resource": "campaigns", "method": "get"})


def test_write_guard_treats_audience_raw_call_non_get_as_write():
    config = _config(write_enabled=False, use_sandbox=True)
    with pytest.raises(Exception, match="Write operations are disabled"):
        _enforce_write_guard(config, "audience.raw_call", {"method": "POST", "path": "/segments"})


def test_write_guard_blocks_audience_segment_create():
    config = _config(write_enabled=False, use_sandbox=True)
    with pytest.raises(Exception, match="Write operations are disabled"):
        _enforce_write_guard(config, "audience.segments.create", {"payload": {"name": "x"}})


def test_write_guard_blocks_metrica_goals_write_when_disabled():
    config = _config(write_enabled=False, use_sandbox=True)
    with pytest.raises(Exception, match="Write operations are disabled"):
        _enforce_write_guard(config, "metrica.goals.create", {"counter_id": "1", "data": {"name": "x"}})


def test_write_guard_treats_metrica_hf_apply_as_write():
    config = _config(write_enabled=False, use_sandbox=True)
    with pytest.raises(Exception, match="Write operations are disabled"):
        _enforce_write_guard(config, "metrica.hf.create_goal", {"counter_id": "1", "goal": {"name": "x"}, "apply": True})


def test_write_guard_allows_direct_plan_preview():
    config = _config(write_enabled=False, use_sandbox=False)
    _enforce_write_guard(config, "direct.hf.plan_changes", {"operations": [{"op": "keywords.add", "adgroup_id": 1, "phrases": ["x"]}]})


def test_write_guard_treats_join_yclid_as_write_when_creating_logs():
    config = _config(write_enabled=False, use_sandbox=True)
    with pytest.raises(Exception, match="Write operations are disabled"):
        _enforce_write_guard(config, "join.hf.direct_vs_metrica_by_yclid", {"counter_id": "1", "date_from": "2026-02-01", "date_to": "2026-02-02"})


def test_write_guard_allows_join_yclid_read_only_with_existing_request_id_and_no_cleanup():
    config = _config(write_enabled=False, use_sandbox=False)
    _enforce_write_guard(
        config,
        "join.hf.direct_vs_metrica_by_yclid",
        {"counter_id": "1", "date_from": "2026-02-01", "date_to": "2026-02-02", "request_id": "123", "cleanup": False},
    )


@pytest.mark.parametrize('action', ['create', 'clean', 'cancel'])
def test_public_logs_export_cannot_mutate(action):
    config = _config(public_readonly=True, write_enabled=True, use_sandbox=True)
    with pytest.raises(Exception, match='public read-only'):
        _enforce_write_guard(config, 'metrica.logs_export', {'action': action, 'counter_id': '1', 'request_id': '2'})


@pytest.mark.parametrize('action', ['allinfo', 'info', 'download', 'evaluate'])
def test_logs_export_read_actions_remain_available(action):
    config = _config(public_readonly=True)
    _enforce_write_guard(config, 'metrica.logs_export', {'action': action})
