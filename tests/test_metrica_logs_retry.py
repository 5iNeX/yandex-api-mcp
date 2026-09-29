from types import SimpleNamespace

import pytest
import requests

from mcp_yandex_ad import server
from mcp_yandex_ad.server import _metrica_logs_call


def context(**overrides):
    values = dict(
        clients=SimpleNamespace(),
        direct_rate_limiter=SimpleNamespace(acquire=lambda: None),
        metrica_rate_limiter=SimpleNamespace(acquire=lambda: None),
        audience_rate_limiter=SimpleNamespace(acquire=lambda: None),
        config=SimpleNamespace(retry_max_attempts=3, retry_base_delay_seconds=0,
                               retry_max_delay_seconds=0, audience_enabled=True),
        cache=None,
    )
    values.update(overrides)
    return SimpleNamespace(**values)


def test_logs_create_does_not_retry_after_transient_failure():
    calls = []

    class Endpoint:
        def post(self, *, params):
            calls.append(params)
            raise requests.Timeout("response may have been committed")

    ctx = context(clients=SimpleNamespace(metrica_logs=SimpleNamespace(create=lambda **_kwargs: Endpoint())))

    with pytest.raises(requests.Timeout):
        _metrica_logs_call(ctx, "create", {"counterId": "1"}, {"source": "visits"})
    assert len(calls) == 1


def test_direct_write_does_not_retry_after_transient_failure(monkeypatch):
    calls = []

    class Resource:
        def post(self, *, data):
            calls.append(data)
            raise requests.Timeout("response may have been committed")

    client = SimpleNamespace(campaigns=lambda: Resource())
    monkeypatch.setattr(server, "_select_direct_client", lambda *_args: client)
    with pytest.raises(requests.Timeout):
        server._direct_call(context(), "campaigns", "add", {"Campaigns": [{}]})
    assert len(calls) == 1


def test_metrica_management_write_does_not_retry_after_transient_failure():
    calls = []

    class Resource:
        def post(self, **kwargs):
            calls.append(kwargs)
            raise requests.Timeout("response may have been committed")

    ctx = context(clients=SimpleNamespace(metrica_management=SimpleNamespace(goal=lambda **_kwargs: Resource())))
    with pytest.raises(requests.Timeout):
        server._metrica_management_call(ctx, "goal", "post", None, {"name": "fixture"}, {"counterId": "1"})
    assert len(calls) == 1


def test_audience_write_does_not_retry_after_transient_failure(monkeypatch):
    calls = []

    class Client:
        def __init__(self, *, access_token):
            assert access_token == "fixture"

        def post(self, path, payload, *, params):
            calls.append((path, payload, params))
            raise requests.Timeout("response may have been committed")

    monkeypatch.setattr(server, "AudienceClient", Client)
    ctx = context(audience_tokens=SimpleNamespace(get_access_token=lambda: "fixture"))
    with pytest.raises(requests.Timeout):
        server._audience_call(ctx, "POST", "segments", payload={"name": "fixture"})
    assert len(calls) == 1
