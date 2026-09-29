"""MCP server for Yandex Direct + Metrica (Python)."""

import asyncio
import importlib.metadata
import logging
import os
import secrets
import textwrap
import webbrowser

import click
from dotenv import load_dotenv


def _pkg_version() -> str:
    try:
        return importlib.metadata.version("yandex-api-mcp")
    except Exception:
        return "0.0.0"


__version__ = _pkg_version()

logger = logging.getLogger("yandex-direct-metrica-mcp")


@click.group(invoke_without_command=True)
@click.option(
    "-v",
    "--verbose",
    count=True,
    help="Increase verbosity (can be used multiple times)",
)
@click.option(
    "--env-file",
    type=click.Path(exists=True, dir_okay=False),
    help="Path to .env file",
)
@click.option(
    "--transport",
    type=click.Choice(["stdio", "sse"]),
    default="stdio",
    help="Transport type (stdio or sse)",
)
@click.option(
    "--port",
    default=8000,
    help="Port to listen on for SSE transport",
)
@click.pass_context
def main(
    ctx: click.Context,
    verbose: int,
    env_file: str | None,
    transport: str,
    port: int,
) -> None:
    """MCP server for Yandex Direct + Metrica."""
    logging_level = logging.WARNING
    if verbose == 1:
        logging_level = logging.INFO
    elif verbose >= 2:
        logging_level = logging.DEBUG

    logging.basicConfig(
        level=logging_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    if env_file:
        logger.debug("Loading environment from file: %s", env_file)
        load_dotenv(env_file)
    else:
        load_dotenv()

    from . import server

    if ctx.invoked_subcommand is None:
        asyncio.run(server.run_server(transport=transport, port=port))


@main.command("auth")
@click.option("--client-id", default=lambda: os.getenv("YANDEX_CLIENT_ID"), help="Yandex OAuth client id")
@click.option(
    "--client-secret",
    default=lambda: os.getenv("YANDEX_CLIENT_SECRET"),
    help="Yandex OAuth client secret",
)
@click.option(
    "--redirect-uri",
    default=lambda: os.getenv("YANDEX_REDIRECT_URI") or "https://oauth.yandex.ru/verification_code",
    help="Redirect URI used in the app settings",
)
@click.option(
    "--scopes",
    default=lambda: os.getenv("YANDEX_SCOPES") or "",
    help="Space-separated scopes (example: 'direct:api metrika:read')",
)
@click.option(
    "--open-browser/--no-open-browser",
    default=True,
    help="Open authorization URL in a browser",
)
@click.option(
    "--flow",
    type=click.Choice(["hybrid", "manual", "local"]),
    default="hybrid",
    show_default=True,
    help="Auth UX: hybrid tries local callback for loopback redirect_uri; otherwise falls back to manual code copy/paste.",
)
@click.option(
    "--timeout-seconds",
    default=180,
    show_default=True,
    help="Max time to wait for loopback callback in local/hybrid flows.",
)
@click.option(
    "--output-env",
    type=click.Path(dir_okay=False),
    default=None,
    help="Optional path to write the resulting env block (chmod 600 best-effort).",
)
def auth_command(
    client_id: str | None,
    client_secret: str | None,
    redirect_uri: str,
    scopes: str,
    open_browser: bool,
    flow: str,
    timeout_seconds: int,
    output_env: str | None,
) -> None:
    """Interactive OAuth helper: open auth URL and exchange code for tokens."""
    if not client_id or not client_secret:
        raise click.ClickException(
            "Missing YANDEX_CLIENT_ID / YANDEX_CLIENT_SECRET. Set env vars or pass --client-id/--client-secret."
        )

    from .oauth import build_authorize_url, exchange_code_for_tokens
    from .auth_flow import is_loopback_redirect_uri, wait_for_code_via_loopback

    scopes_list = [s for s in scopes.split(" ") if s.strip()] if scopes else []
    state = secrets.token_urlsafe(24)
    auth_url = build_authorize_url(
        client_id=client_id,
        redirect_uri=redirect_uri,
        scopes=scopes_list or None,
        state=state,
    )

    click.echo("1) Open this URL and authorize the app:")
    click.echo(auth_url)
    if open_browser:
        webbrowser.open(auth_url)

    code: str | None = None
    if flow in {"hybrid", "local"} and is_loopback_redirect_uri(redirect_uri):
        click.echo("\n2) Waiting for loopback callback (local redirect_uri)...")
        click.echo(f"   redirect_uri={redirect_uri}")
        click.echo("   Tip: ensure this redirect URI is allowed in your OAuth app settings.")
        try:
            res = wait_for_code_via_loopback(
                redirect_uri=redirect_uri,
                expected_state=state,
                timeout_seconds=int(timeout_seconds),
            )
        except Exception as exc:
            if flow == "local":
                raise click.ClickException(str(exc)) from exc
            click.echo(f"   Warning: loopback callback failed ({exc}); falling back to manual mode.")
            res = None
        if res and res.error:
            if flow == "local":
                raise click.ClickException(res.error)
            click.echo(f"   Warning: callback returned error ({res.error}); falling back to manual mode.")
        elif res and res.code:
            code = res.code

    if code is None:
        if flow == "local" and not is_loopback_redirect_uri(redirect_uri):
            raise click.ClickException(
                "Local flow requires a loopback redirect URI, e.g. http://127.0.0.1:8765/callback (with explicit port)."
            )
        click.echo("\n2) Paste the authorization code from Yandex:")
        code = click.prompt("code", hide_input=False).strip()
    if not code:
        raise click.ClickException("Empty code")

    click.echo("\n3) Exchanging code for tokens...")
    try:
        tokens = exchange_code_for_tokens(
            code=code,
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
        )
    except Exception as exc:
        raise click.ClickException(str(exc)) from exc

    click.echo("\n✓ Success. Store these in your secrets/.env (do not commit it):\n")
    refresh = tokens.refresh_token or ""
    env_block = textwrap.dedent(
        f"""\
        # OAuth
        YANDEX_CLIENT_ID={client_id}
        YANDEX_CLIENT_SECRET={client_secret}
        YANDEX_ACCESS_TOKEN={tokens.access_token}
        YANDEX_REFRESH_TOKEN={refresh}
        YANDEX_REDIRECT_URI={redirect_uri}
        """
    ).rstrip()

    if output_env:
        from pathlib import Path

        path = Path(output_env)
        path.write_text(env_block + "\n", encoding="utf-8")
        try:
            os.chmod(path, 0o600)
        except Exception:
            pass
        click.echo(f"Wrote env block to: {path}")
    else:
        click.echo(env_block)


__all__ = ["__version__", "main", "server"]

if __name__ == "__main__":
    main()
