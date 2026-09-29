# Public mode (контракт v1.0.0)

> Исторический контракт старого образа `yandex-direct-metrica-mcp`. Для нового `yandex-api-mcp` смотрите [README](../../README.md) и [отчёт о миграции](../../MIGRATION_REPORT.md). В новом публичном сервере `metrica.logs_export` разрешает только чтение; действия `create`, `clean` и `cancel` блокируются.

Этот документ описывает **контракт public read-only** для Docker image `yandex-direct-metrica-mcp`.

## Определение “read-only” (Контракт A)

Read-only означает:
- никаких изменений **управляемых сущностей** в Direct/Metrica/Audience (никаких create/update/delete кампаний, сегментов, целей и т.п.).

Допустимые сайд-эффекты на стороне провайдера (и всё равно считаются read-only в этом контракте):
- запросы Wordstat, которые создают/считают “отчётные” данные на стороне API,
- экспортные джобы Metrica Logs API (`metrica.logs_export`) для анализа/джоинов (без изменения настроек счётчика).

## Контрактная поверхность: tools/list

Контракт public-версии — это точный результат `tools/list` для **public edition**.

Гарантия стабильности (1.x):
- `name`, `description`, `inputSchema` (включая дефолты) считаются частью контракта.
- Канонический snapshot: `tests/snapshots/public_tools_v1.json`.

## Модель артефактов

Public image:
- `ghcr.io/<OWNER>/yandex-direct-metrica-mcp:v1.0.0`
- `ghcr.io/<OWNER>/yandex-direct-metrica-mcp:latest` (stable public)

Pro image (отдельный артефакт, вне public контракта):
- `ghcr.io/<OWNER>/yandex-direct-metrica-mcp-pro:v1.0.0`
- `ghcr.io/<OWNER>/yandex-direct-metrica-mcp-pro:latest`

## Safe-by-default гарантия

Public image safe-by-default:
- в образе есть build marker (`/app/.mcp_edition=public`)
- сервер форсит `public_readonly=true` на старте, даже если env переменные ошибочно выставлены.

Следствие:
- write инструменты не возвращаются через `tools/list`,
- любые попытки вызвать write-capable entrypoints должны падать предсказуемой ошибкой write-guard.

## Матрица окружения (public)

### Разрешено / учитывается

Credentials (сервер не хранит секреты на диске):
- `YANDEX_ACCESS_TOKEN` / `YANDEX_REFRESH_TOKEN`
- `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET`
- `YANDEX_AUDIENCE_*` (Audience OAuth)
- `YANDEX_SEARCH_API_FOLDER_ID` + `YANDEX_SEARCH_API_API_KEY` или `YANDEX_SEARCH_API_IAM_TOKEN` (Wordstat через Yandex Search API)

Wordstat Search API настраивается отдельно от Direct OAuth. Сервисный аккаунт должен быть в целевой папке, иметь `search-api.webSearch.user`; для API key нужен scope `yc.search-api.execute`, если scopes включены.

Multi-account registry:
- `MCP_ACCOUNTS_FILE` (read-only mapping `account_id` → Direct `Client-Login` + default Metrica counters)

Runtime tuning:
- `MCP_CONTENT_MODE`
- `MCP_CACHE_ENABLED`, `MCP_CACHE_TTL_SECONDS`
- `MCP_*_RATE_LIMIT_RPS`
- `MCP_RETRY_*`
- `MCP_AUDIENCE_ENABLED`, `MCP_WORDSTAT_ENABLED`

### Игнорируется / принудительно выключено (public)

Флаги включения записей игнорируются в public image:
- `MCP_WRITE_ENABLED`
- `HF_WRITE_ENABLED`
- `HF_DESTRUCTIVE_ENABLED`
- `MCP_ACCOUNTS_WRITE_ENABLED`

Escape hatches не входят в public surface:
- `direct.raw_call`, `metrica.raw_call`, `audience.raw_call`

BI Option 2 не входит в public surface (поставляется отдельным PRO plug-in):
- `dashboard.schema`, `dashboard.dataset.*`, `dashboard.sync.*`

## /data state (public)

Рекомендуемый каталог state внутри контейнера (пример: `/data`):
- `accounts.json` (опционально): account registry для multi-account dashboards и `account_id` resolution.

Сервер не сохраняет OAuth токены и пользовательские данные.
Если включён cache, он может хранить ограниченные ответы API (без “сырых” токенов).
