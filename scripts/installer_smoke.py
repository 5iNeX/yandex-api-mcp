#!/usr/bin/env python3
"""Build and check an isolated installer runtime. Never call live Yandex APIs."""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from installer.install import prepare
from installer.yandex_setup import common


def main():
    with tempfile.TemporaryDirectory(prefix="yp-docker-smoke-") as directory:
        root = prepare(Path(directory) / "runtime", "yp-installer-smoke", 18991)
        common.ROOT = root
        common.write_yandex_env("fixture-no-live-api")
        command = common.compose_command()
        subprocess.run(command + ["config", "--quiet"], check=True)
        try:
            subprocess.run(command + ["up", "-d", "--build"], check=True)
            common.wait_ready(timeout=40)
            for transport in ("sse", "stdio"):
                tools = common.tools_list(transport)
                assert any(t["name"] == "accounts.list" for t in tools)
                print(f"{transport}: tools/list OK ({len(tools)})")
            assert common.rpc_sse("accounts.list")["accounts"] == []
            (root / "state/accounts.json").write_text(
                json.dumps(
                    {
                        "accounts": [
                            {"id": "fixture-project", "metrica_counter_ids": ["123"]}
                        ]
                    }
                )
            )
            common.rpc_sse("accounts.reload")
            assert (
                common.rpc_sse("accounts.list")["accounts"][0]["id"]
                == "fixture-project"
            )
            # This must be denied before any provider request is attempted.
            for action in ("clean", "cancel"):
                try:
                    common.rpc_sse(
                        "metrica.logs_export",
                        {"counter_id": "123", "request_id": "1", "action": action},
                    )
                except RuntimeError as e:
                    assert "public read-only" in str(e), str(e)
                else:
                    raise AssertionError("Destructive Logs action was accepted")
            print("Empty registry, reload and public destructive guards: OK")
        finally:
            subprocess.run(command + ["down", "--remove-orphans"], check=False)


if __name__ == "__main__":
    main()
