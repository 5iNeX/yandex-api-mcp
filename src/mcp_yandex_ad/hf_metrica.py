"""Human-friendly (HF) tools for Yandex Metrica."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from .hf_common import HFError, ensure_hf_enabled, ensure_hf_write_enabled, hf_payload, should_apply


def _stats_limit(args: dict[str, Any]) -> int | None:
    if args.get("limit") is None:
        return None
    limit = int(args.get("limit") or 0)
    return max(1, limit)


def _fetch_stats_with_pagination(
    ctx: Any,
    params: dict[str, Any],
    *,
    explicit_limit: int | None,
    page_size: int = 1000,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    warnings: list[dict[str, Any]] = []
    first_params = dict(params)
    first_params["limit"] = explicit_limit or page_size
    first = ctx._metrica_get_stats(first_params)  # type: ignore[attr-defined]
    if explicit_limit is not None:
        total_rows = int(first.get("total_rows") or 0)
        if total_rows > explicit_limit:
            warnings.append(
                {
                    "code": "metrica_rows_truncated",
                    "message": "Response was truncated by limit; pass a larger limit or omit it for auto-pagination.",
                    "details": {"limit": explicit_limit, "total_rows": total_rows},
                }
            )
        return first, warnings

    rows = first.get("data")
    if not isinstance(rows, list):
        return first, warnings

    total_rows = int(first.get("total_rows") or len(rows))
    if total_rows <= len(rows):
        return first, warnings

    merged = dict(first)
    all_rows = list(rows)
    offset = len(rows)
    while offset < total_rows:
        page_params = dict(params)
        page_params["limit"] = page_size
        page_params["offset"] = offset
        page = ctx._metrica_get_stats(page_params)  # type: ignore[attr-defined]
        chunk = page.get("data")
        if not isinstance(chunk, list) or not chunk:
            break
        all_rows.extend(chunk)
        offset += len(chunk)
        if len(chunk) < page_size:
            break

    merged["data"] = all_rows
    return merged, warnings


def _require_counter_id(args: dict[str, Any]) -> str:
    cid = args.get("counter_id")
    if not cid:
        raise HFError("counter_id is required")
    return str(cid)


def _metric_default(metric: str | None) -> str:
    value = (metric or "visits").strip()
    aliases = {"visits": "ym:s:visits", "users": "ym:s:users", "pageviews": "ym:s:pageviews"}
    if value in aliases:
        return aliases[value]
    if value.startswith("ym:"):
        return value
    raise HFError("metric must be a Metrika API metric such as ym:s:visits, or visits/users/pageviews")


def _aggregate_by_period(rows: list[dict[str, Any]], *, granularity: str) -> list[dict[str, Any]]:
    # Input rows are expected to include `dimensions[0].name` as a date string like 'YYYY-MM-DD'.
    # We group by:
    # - week: ISO week (YYYY-Www)
    # - month: YYYY-MM
    # - quarter: YYYY-Qn
    # - year: YYYY
    if granularity == "day":
        return rows

    def key_for(date_str: str) -> str:
        year, month, day = date_str.split("-")
        if granularity == "week":
            import datetime as dt

            y, m, d = int(year), int(month), int(day)
            iso = dt.date(y, m, d).isocalendar()
            return f"{iso.year}-W{iso.week:02d}"
        if granularity == "month":
            return f"{year}-{month}"
        if granularity == "quarter":
            q = (int(month) - 1) // 3 + 1
            return f"{year}-Q{q}"
        if granularity == "year":
            return year
        return date_str

    buckets: dict[str, dict[str, Any]] = {}
    for row in rows:
        dims = row.get("dimensions") or []
        mets = row.get("metrics") or []
        if not dims:
            continue
        name = dims[0].get("name") if isinstance(dims[0], dict) else None
        if not isinstance(name, str) or len(name) < "YYYY-MM-DD".__len__():
            continue
        k = key_for(name[:10])
        if k not in buckets:
            buckets[k] = {"period": k, "metrics": [0.0 for _ in mets]}
        # Sum metrics by index.
        for i, v in enumerate(mets):
            try:
                buckets[k]["metrics"][i] += float(v)
            except Exception:
                continue

    out = list(buckets.values())
    out.sort(key=lambda x: x["period"])
    return out


def handle(tool: str, ctx: Any, args: dict[str, Any]) -> dict[str, Any]:
    ensure_hf_enabled(ctx.config)

    if tool == "metrica.hf.list_accessible_counters":
        data = ctx._metrica_get_management("counters", args.get("params") or {})  # type: ignore[attr-defined]
        counters = data.get("counters", data.get("counters", []))  # api returns {"counters":[...]}
        if isinstance(data.get("counters"), list):
            counters = data["counters"]
        return hf_payload(tool=tool, status="ok", result={"counters": counters})

    if tool == "metrica.hf.counter_summary":
        counter_id = _require_counter_id(args)
        info = ctx._metrica_get_counter(counter_id, {})  # type: ignore[attr-defined]
        # goals list best-effort
        goals = None
        warnings: list[dict[str, Any]] = []
        try:
            goals = ctx._metrica_management_call(  # type: ignore[attr-defined]
                resource="goals",
                method="get",
                params=None,
                data=None,
                path_args={"counterId": counter_id},
            )
        except Exception as exc:
            goals = None
            warnings.append(
                {
                    "code": "metrica_goals_unavailable",
                    "message": "Goals list could not be fetched; counter summary returned without goals.",
                    "details": {"error_type": exc.__class__.__name__, "counter_id": str(counter_id)},
                }
            )
        return hf_payload(
            tool=tool,
            status="ok",
            result={"counter": info.get("counter", info), "goals": goals},
            warnings=warnings or None,
        )

    if tool == "metrica.hf.report_time_series":
        counter_id = _require_counter_id(args)
        date_from = args.get("date_from")
        date_to = args.get("date_to")
        if not date_from or not date_to:
            raise HFError("date_from and date_to are required")
        metric = _metric_default(args.get("metric"))
        granularity = (args.get("granularity") or "day").lower()
        raw = ctx._metrica_get_stats(  # type: ignore[attr-defined]
            {
                "ids": counter_id,
                "metrics": metric,
                "dimensions": "ym:s:date",
                "date1": date_from,
                "date2": date_to,
                "sort": "ym:s:date",
                "limit": 100000,
            }
        )
        rows = raw.get("data", [])
        if not isinstance(rows, list):
            rows = []
        agg = _aggregate_by_period(rows, granularity=granularity)
        return hf_payload(tool=tool, status="ok", result={"counter_id": counter_id, "metric": metric, "granularity": granularity, "data": agg, "raw": raw})

    if tool == "metrica.hf.report_landing_pages":
        counter_id = _require_counter_id(args)
        date_from = args.get("date_from")
        date_to = args.get("date_to")
        if not date_from or not date_to:
            raise HFError("date_from and date_to are required")
        raw, warnings = _fetch_stats_with_pagination(
            ctx,
            {
                "ids": counter_id,
                "metrics": "ym:s:visits,ym:s:avgVisitDurationSeconds",
                "dimensions": "ym:s:startURL",
                "date1": date_from,
                "date2": date_to,
                "sort": "-ym:s:visits",
            },
            explicit_limit=_stats_limit(args),
        )
        return hf_payload(tool=tool, status="ok", result={"counter_id": counter_id, "raw": raw}, warnings=warnings or None)

    if tool == "metrica.hf.report_utm_campaigns":
        counter_id = _require_counter_id(args)
        date_from = args.get("date_from")
        date_to = args.get("date_to")
        if not date_from or not date_to:
            raise HFError("date_from and date_to are required")
        raw, warnings = _fetch_stats_with_pagination(
            ctx,
            {
                "ids": counter_id,
                "metrics": "ym:s:visits,ym:s:avgVisitDurationSeconds",
                "dimensions": "ym:s:UTMCampaign,ym:s:UTMContent",
                "date1": date_from,
                "date2": date_to,
                "sort": "-ym:s:visits",
            },
            explicit_limit=_stats_limit(args),
        )
        return hf_payload(tool=tool, status="ok", result={"counter_id": counter_id, "raw": raw}, warnings=warnings or None)

    if tool == "metrica.hf.report_geo":
        counter_id = _require_counter_id(args)
        date_from = args.get("date_from")
        date_to = args.get("date_to")
        if not date_from or not date_to:
            raise HFError("date_from and date_to are required")
        level = (args.get("level") or "country").lower()
        if level not in {"country", "city"}:
            raise HFError("level must be country or city")
        dim = "ym:s:regionCountry" if level == "country" else "ym:s:regionCity"
        raw, warnings = _fetch_stats_with_pagination(
            ctx,
            {
                "ids": counter_id,
                "metrics": "ym:s:visits,ym:s:avgVisitDurationSeconds",
                "dimensions": dim,
                "date1": date_from,
                "date2": date_to,
                "sort": "-ym:s:visits",
            },
            explicit_limit=_stats_limit(args),
        )
        return hf_payload(tool=tool, status="ok", result={"counter_id": counter_id, "raw": raw}, warnings=warnings or None)

    if tool == "metrica.hf.report_devices":
        counter_id = _require_counter_id(args)
        date_from = args.get("date_from")
        date_to = args.get("date_to")
        if not date_from or not date_to:
            raise HFError("date_from and date_to are required")
        raw, warnings = _fetch_stats_with_pagination(
            ctx,
            {
                "ids": counter_id,
                "metrics": "ym:s:visits,ym:s:avgVisitDurationSeconds",
                "dimensions": "ym:s:deviceCategory",
                "date1": date_from,
                "date2": date_to,
                "sort": "-ym:s:visits",
            },
            explicit_limit=_stats_limit(args),
        )
        return hf_payload(tool=tool, status="ok", result={"counter_id": counter_id, "raw": raw}, warnings=warnings or None)

    if tool == "metrica.hf.logs_export_preset":
        counter_id = _require_counter_id(args)
        date_from = args.get("date_from")
        date_to = args.get("date_to")
        if not date_from or not date_to:
            raise HFError("date_from and date_to are required")
        # Minimal preset: create + evaluate.
        preview = {
            "create": {
                "action": "create",
                "counter_id": counter_id,
                "date_from": date_from,
                "date_to": date_to,
                "source": "visits",
                "fields": "ym:s:dateTime,ym:s:clientID,ym:s:startURL,ym:s:UTMCampaign,ym:s:UTMContent,ym:s:yclid",
            },
            "evaluate": {
                "action": "evaluate",
                "counter_id": counter_id,
                "date_from": date_from,
                "date_to": date_to,
                "source": "visits",
                "fields": "ym:s:dateTime,ym:s:clientID,ym:s:startURL,ym:s:UTMCampaign,ym:s:UTMContent,ym:s:yclid",
            },
        }
        return hf_payload(tool=tool, status="ok", preview=preview)

    if tool in {"metrica.hf.create_goal", "metrica.hf.update_goal", "metrica.hf.delete_goal"}:
        ensure_hf_write_enabled(ctx.config)
        counter_id = _require_counter_id(args)
        goal_id = str(args.get("goal_id") or "").strip()
        goal = args.get("goal")

        if tool == "metrica.hf.create_goal":
            if not isinstance(goal, dict):
                raise HFError("goal (object) is required")
            preview = {"tool": "metrica.goals.create", "counter_id": counter_id, "payload": {"goal": goal}}
            if not should_apply(args):
                return hf_payload(tool=tool, status="dry_run", preview=preview)
            data = ctx._metrica_management_call(  # type: ignore[attr-defined]
                resource="goals",
                method="post",
                params=args.get("params") or None,
                data={"goal": goal},
                path_args={"counterId": counter_id},
            )
            return hf_payload(tool=tool, status="ok", preview=preview, result=data)

        if not goal_id:
            raise HFError("goal_id is required")

        if tool == "metrica.hf.update_goal":
            if not isinstance(goal, dict):
                raise HFError("goal (object) is required")
            preview = {"tool": "metrica.goals.update", "counter_id": counter_id, "goal_id": goal_id, "payload": {"goal": goal}}
            if not should_apply(args):
                return hf_payload(tool=tool, status="dry_run", preview=preview)
            data = ctx._metrica_management_call(  # type: ignore[attr-defined]
                resource="goal",
                method="put",
                params=args.get("params") or None,
                data={"goal": goal},
                path_args={"counterId": counter_id, "goalId": goal_id},
            )
            return hf_payload(tool=tool, status="ok", preview=preview, result=data)

        # delete
        preview = {"tool": "metrica.goals.delete", "counter_id": counter_id, "goal_id": goal_id}
        if not should_apply(args):
            return hf_payload(tool=tool, status="dry_run", preview=preview)
        data = ctx._metrica_management_call(  # type: ignore[attr-defined]
            resource="goal",
            method="delete",
            params=args.get("params") or None,
            data=None,
            path_args={"counterId": counter_id, "goalId": goal_id},
        )
        return hf_payload(tool=tool, status="ok", preview=preview, result=data)

    raise HFError(f"Unknown HF Metrica tool: {tool}")
