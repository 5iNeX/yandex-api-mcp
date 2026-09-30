from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from mcp_yandex_ad.hf_metrica import handle


@dataclass(frozen=True)
class _Cfg:
    hf_enabled: bool = True


class _Ctx:
    config = _Cfg()

    def _metrica_get_counter(self, counter_id: str, params: dict[str, Any]) -> dict[str, Any]:  # noqa: ARG002
        return {"counter": {"id": counter_id, "name": "Test counter"}}

    def _metrica_management_call(
        self,
        resource: str,
        method: str,
        params: dict[str, Any] | None,
        data: dict[str, Any] | None,
        path_args: dict[str, Any],
    ) -> dict[str, Any]:  # noqa: ARG002
        if resource == "goals":
            return {"goals": [{"id": 1, "name": "Lead"}]}
        raise AssertionError(f"Unexpected resource: {resource}")


def test_counter_summary_surfaces_goals_fetch_warning() -> None:
    class _FailingCtx(_Ctx):
        def _metrica_management_call(  # type: ignore[override]
            self,
            resource: str,
            method: str,
            params: dict[str, Any] | None,
            data: dict[str, Any] | None,
            path_args: dict[str, Any],
        ) -> dict[str, Any]:
            raise RuntimeError("forbidden")

    out = handle("metrica.hf.counter_summary", _FailingCtx(), {"counter_id": "42"})

    assert out["status"] == "ok"
    assert out["result"]["goals"] is None
    assert out["warnings"][0]["code"] == "metrica_goals_unavailable"
    assert out["warnings"][0]["details"]["counter_id"] == "42"


def test_counter_summary_omits_warnings_when_goals_are_loaded() -> None:
    out = handle("metrica.hf.counter_summary", _Ctx(), {"counter_id": "42"})

    assert out["status"] == "ok"
    assert out["result"]["goals"] == {"goals": [{"id": 1, "name": "Lead"}]}
    assert "warnings" not in out


def test_report_alias_and_geo_dimensions_match_metrica_api() -> None:
    class _StatsCtx(_Ctx):
        params: dict[str, Any]

        def _metrica_get_stats(self, params: dict[str, Any]) -> dict[str, Any]:
            self.params = params
            return {"data": [], "total_rows": 0}

    ctx = _StatsCtx()
    handle("metrica.hf.report_time_series", ctx, {"counter_id": "42", "date_from": "2026-09-01", "date_to": "2026-09-02", "metric": "visits"})
    assert ctx.params["metrics"] == "ym:s:visits"
    handle("metrica.hf.report_geo", ctx, {"counter_id": "42", "date_from": "2026-09-01", "date_to": "2026-09-02", "level": "city"})
    assert ctx.params["dimensions"] == "ym:s:regionCity"
    handle("metrica.hf.report_geo", ctx, {"counter_id": "42", "date_from": "2026-09-01", "date_to": "2026-09-02", "level": "country"})
    assert ctx.params["dimensions"] == "ym:s:regionCountry"
