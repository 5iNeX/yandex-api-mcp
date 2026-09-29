"""Configuration helpers for MCP Yandex Direct + Metrica."""

from dataclasses import dataclass, field
import os
from pathlib import Path

from .accounts import AccountProfile, load_accounts_registry


@dataclass(frozen=True)
class AppConfig:
    access_token: str | None
    refresh_token: str | None
    client_id: str | None
    client_secret: str | None
    audience_access_token: str | None
    audience_refresh_token: str | None
    audience_client_id: str | None
    audience_client_secret: str | None
    direct_client_login: str | None
    direct_client_logins: list[str]
    direct_api_version: str
    metrica_counter_ids: list[str]
    audience_enabled: bool
    wordstat_enabled: bool
    use_sandbox: bool
    write_enabled: bool
    write_sandbox_only: bool
    hf_enabled: bool
    hf_write_enabled: bool
    hf_destructive_enabled: bool
    cache_enabled: bool
    cache_ttl_seconds: int
    direct_rate_limit_rps: int
    metrica_rate_limit_rps: int
    audience_rate_limit_rps: int
    wordstat_rate_limit_rps: int
    retry_max_attempts: int
    retry_base_delay_seconds: float
    retry_max_delay_seconds: float
    content_mode: str
    public_readonly: bool = False
    accounts_write_enabled: bool = False
    accounts_file: str | None = None
    accounts: dict[str, AccountProfile] = field(default_factory=dict)
    edition: str | None = None
    auth_tools_enabled: bool = False
    two_phase_writes_enabled: bool = False
    confirm_ttl_seconds: int = 300
    wordstat_search_api_folder_id: str | None = None
    wordstat_search_api_api_key: str | None = None
    wordstat_search_api_iam_token: str | None = None
    wordstat_api_base_url: str | None = None
    search_api_enabled: bool = True
    search_api_default_region: int = 213
    search_api_web_base_url: str | None = None


def _split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _normalize_direct_api_version(value: str | None) -> str:
    if not value:
        return "v5"
    normalized = value.strip().lower()
    if normalized in {"v5", "5"}:
        return "v5"
    if normalized in {"v501", "501"}:
        return "v501"
    return "v5"


def _read_edition_marker() -> str | None:
    """Detect build edition from a filesystem marker when present.

    This is intended to make the **public Docker image** safe-by-default even if
    runtime env vars are misconfigured.
    """
    marker = Path("/app/.mcp_edition")
    if not marker.exists():
        marker = Path(__file__).resolve().parents[2] / ".mcp_edition"
    try:
        value = marker.read_text(encoding="utf-8").strip().lower()
    except Exception:
        return None
    if value in {"public", "pro"}:
        return value
    return None


def _apply_public_edition_overrides(config: AppConfig) -> AppConfig:
    if (config.edition or "").lower() != "public":
        return config
    # Public edition must be read-only regardless of runtime env.
    return AppConfig(
        **{
            **config.__dict__,
            "public_readonly": True,
            "write_enabled": False,
            "hf_write_enabled": False,
            "hf_destructive_enabled": False,
            "accounts_write_enabled": False,
            "auth_tools_enabled": False,
            "two_phase_writes_enabled": False,
        }
    )


def load_config() -> AppConfig:
    edition = _read_edition_marker() or (os.getenv("MCP_EDITION") or "").strip().lower() or None
    if edition not in {None, "public", "pro"}:
        edition = None
    direct_client_login = os.getenv("YANDEX_DIRECT_CLIENT_LOGIN")
    direct_client_logins = _split_csv(os.getenv("YANDEX_DIRECT_CLIENT_LOGINS"))
    if not direct_client_logins and direct_client_login:
        direct_client_logins = [direct_client_login.strip()]
    accounts_file = os.getenv("MCP_ACCOUNTS_FILE") or None
    accounts = load_accounts_registry(accounts_file)
    config = AppConfig(
        access_token=os.getenv("YANDEX_ACCESS_TOKEN"),
        refresh_token=os.getenv("YANDEX_REFRESH_TOKEN"),
        client_id=os.getenv("YANDEX_CLIENT_ID"),
        client_secret=os.getenv("YANDEX_CLIENT_SECRET"),
        audience_access_token=os.getenv("YANDEX_AUDIENCE_ACCESS_TOKEN"),
        audience_refresh_token=os.getenv("YANDEX_AUDIENCE_REFRESH_TOKEN"),
        audience_client_id=os.getenv("YANDEX_AUDIENCE_CLIENT_ID"),
        audience_client_secret=os.getenv("YANDEX_AUDIENCE_CLIENT_SECRET"),
        direct_client_login=direct_client_login,
        direct_client_logins=direct_client_logins,
        direct_api_version=_normalize_direct_api_version(
            os.getenv("YANDEX_DIRECT_API_VERSION")
        ),
        metrica_counter_ids=_split_csv(os.getenv("YANDEX_METRICA_COUNTER_IDS")),
        audience_enabled=os.getenv("MCP_AUDIENCE_ENABLED", "true").lower() in {"1", "true", "yes"},
        wordstat_enabled=os.getenv("MCP_WORDSTAT_ENABLED", "true").lower() in {"1", "true", "yes"},
        use_sandbox=os.getenv("YANDEX_DIRECT_SANDBOX", "false").lower()
        in {"1", "true", "yes"},
        write_enabled=os.getenv("MCP_WRITE_ENABLED", "false").lower()
        in {"1", "true", "yes"},
        write_sandbox_only=os.getenv("MCP_WRITE_SANDBOX_ONLY", "true").lower()
        in {"1", "true", "yes"},
        hf_enabled=os.getenv("HF_ENABLED", "true").lower() in {"1", "true", "yes"},
        hf_write_enabled=os.getenv("HF_WRITE_ENABLED", "false").lower() in {"1", "true", "yes"},
        hf_destructive_enabled=os.getenv("HF_DESTRUCTIVE_ENABLED", "false").lower()
        in {"1", "true", "yes"},
        cache_enabled=os.getenv("MCP_CACHE_ENABLED", "true").lower() in {"1", "true", "yes"},
        cache_ttl_seconds=int(os.getenv("MCP_CACHE_TTL_SECONDS", "300")),
        direct_rate_limit_rps=int(os.getenv("MCP_DIRECT_RATE_LIMIT_RPS", "0")),
        metrica_rate_limit_rps=int(os.getenv("MCP_METRICA_RATE_LIMIT_RPS", "0")),
        audience_rate_limit_rps=int(os.getenv("MCP_AUDIENCE_RATE_LIMIT_RPS", "0")),
        wordstat_rate_limit_rps=int(os.getenv("MCP_WORDSTAT_RATE_LIMIT_RPS", "0")),
        retry_max_attempts=int(os.getenv("MCP_RETRY_MAX_ATTEMPTS", "3")),
        retry_base_delay_seconds=float(os.getenv("MCP_RETRY_BASE_DELAY_SECONDS", "0.5")),
        retry_max_delay_seconds=float(os.getenv("MCP_RETRY_MAX_DELAY_SECONDS", "8")),
        content_mode=(os.getenv("MCP_CONTENT_MODE", "json") or "json").strip().lower(),
        public_readonly=os.getenv("MCP_PUBLIC_READONLY", "false").lower() in {"1", "true", "yes"},
        accounts_write_enabled=os.getenv("MCP_ACCOUNTS_WRITE_ENABLED", "false").lower()
        in {"1", "true", "yes"},
        accounts_file=accounts_file,
        accounts=accounts,
        edition=edition,
        auth_tools_enabled=os.getenv("MCP_AUTH_TOOLS_ENABLED", "false").lower() in {"1", "true", "yes"},
        two_phase_writes_enabled=os.getenv("MCP_TWO_PHASE_WRITES", "false").lower() in {"1", "true", "yes"},
        confirm_ttl_seconds=int(os.getenv("MCP_CONFIRM_TTL_SECONDS", "300")),
        wordstat_search_api_folder_id=os.getenv("YANDEX_SEARCH_API_FOLDER_ID"),
        wordstat_search_api_api_key=os.getenv("YANDEX_SEARCH_API_API_KEY"),
        wordstat_search_api_iam_token=os.getenv("YANDEX_SEARCH_API_IAM_TOKEN"),
        wordstat_api_base_url=os.getenv("YANDEX_SEARCH_API_WORDSTAT_BASE_URL"),
        search_api_enabled=os.getenv("MCP_SEARCH_API_ENABLED", "true").lower() in {"1", "true", "yes"},
        search_api_default_region=int(os.getenv("YANDEX_SEARCH_API_DEFAULT_REGION", "213")),
        search_api_web_base_url=os.getenv("YANDEX_SEARCH_API_WEB_BASE_URL"),
    )
    return _apply_public_edition_overrides(config)
