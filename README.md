# yandex-api-mcp

Единый MCP-сервер для Yandex Webmaster, Direct, Metrika, Wordstat, Audience и Search API. Развёртывание по умолчанию **только для чтения**. TypeScript core основан на [webkoth/yandex-mcp](https://github.com/webkoth/yandex-mcp) (MIT); Wordstat, Audience, Search API и часть аналитических инструментов сохранены из этого репозитория в Python-адаптере. Клиент видит один MCP endpoint.

## Возможности

| Сервис | Чтение | Запись в pro-сборке |
|---|---|---|
| Webmaster | hosts, verification status, summary, SQI, queries, indexing, URLs, sitemaps, recrawl quota, diagnostics, links, Pro export status, feeds | hosts, verification, sitemaps, recrawl, feeds |
| Direct | clients/agency, campaigns, adgroups, ads, keywords, bids, modifiers, reports, Units | guarded campaign/adgroup/ad/keyword/bid changes |
| Metrika | counters, goals, segments, filters, Reporting API, Logs download | guarded goals, CRM, calls, offline conversions, expenses |
| Wordstat | user, top requests, dynamics, regions, suggestions | — |
| Audience | segments, pixels, statistics, overlap | — |
| Search API | SERP via folder ID and API key | — |

Публичный образ скрывает инструменты записи и отклоняет их вызовы. Смешанный `metrica.logs_export` остаётся доступным для чтения существующих экспортов, но действия `create`, `clean` и `cancel` блокируются. Pro-сборка требует `confirm:true`; для удаления также требуется `destructive_confirmation` с именем инструмента. BI Option 2 остаётся private plugin и не входит в OSS image.

## Установка Debian/Ubuntu

Нужны Docker Engine, Compose v2 и Python 3. Из этой ветки:

```bash
git clone https://github.com/5iNeX/yandex-api-mcp.git
cd yandex-api-mcp
sudo ./install.sh
sudo yp oauth
sudo yp service start
sudo yp doctor
```

Установщик размещает приложение в `/opt/yandex-api-mcp`, не удаляя прежний MCP. Если `yp` уже занята, используется `yp-api`. Секреты хранятся в `/opt/yandex-api-mcp/secrets/`; OAuth и реестр проектов — в `/opt/yandex-api-mcp/state/`. Эти каталоги не входят в Git или Docker image.

`yp oauth` запрашивает OAuth code и сохраняет токены без вывода значений. Scope: Webmaster — `webmaster:hostinfo webmaster:verify`; Direct — `direct:api`; Metrika — `metrika:read` или `metrika:write` для загрузок; Audience — `audience:read`. Wordstat использует доступ Direct API. Search API использует отдельные `YANDEX_SEARCH_API_FOLDER_ID` и `YANDEX_SEARCH_API_API_KEY` в `secrets/yandex.env`. Refresh не может расширить scope: после добавления прав нужна новая авторизация.

Команды: `yp setup`, `yp oauth`, `yp refresh`, `yp discover`, `yp project list|add|remove`, `yp verify`, `yp doctor`, `yp service status|start|restart|stop`, `yp tunnel status`, `yp connector info`, `yp logs`. После изменения реестра выполните `yp service restart`.

## Архитектура и проекты

`gateway/index.mjs` открывает один stdio или локальный SSE MCP. Он запускает `core/` (Webmaster, Direct, Metrika) и Python-адаптер `src/mcp_yandex_ad/` (Wordstat, Audience, Search API, дополнительные read tools) как дочерние MCP-процессы, объединяет `tools/list` и направляет `tools/call`. Общий OAuth state лежит в `state/oauth.json`; `state/projects.json` содержит связи проектов с Direct login, счётчиками и сайтами, без токенов.

```json
{"accounts":[{"id":"site-a","name":"Site A","direct_client_login":"agency-client","metrica_counter_ids":[123456],"webmaster_hosts":["https:example.com:443"]}]}
```

Для discovery используйте `yp discover` и MCP `yandex_projects_list`, `yandex_webmaster_hosts_list`, `yandex_direct_clients_get`, `yandex_metrika_counters_list`. Direct/Metrika принимают `project`; Webmaster — `host_id`. Активный проект в core глобален для процесса, поэтому при нескольких клиентах задавайте `project` явно. Access token обновляется автоматически перед истечением или после 401; запись состояния атомарна.

## Docker и MCP-клиенты

```bash
docker compose up -d --build
curl http://127.0.0.1:8001/healthz
docker compose ps
```

Compose публикует SSE только на `127.0.0.1:8001`; внешний MCP порт не открыт. Для Claude/Codex/Cursor на том же сервере stdio-команда: `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`. Для удалённого ChatGPT нужен OpenAI Tunnel; [переключение](docs/ru/unified-deployment.md). Старый Tunnel остаётся подключённым к старому MCP до завершения OAuth и проверки нового сервера.

## Проверка и неполадки

```bash
pytest -q
npm ci && npm --prefix core ci
npm run build && npm test
sudo yp doctor
sudo yp verify
```

`ACCESS_FORBIDDEN` Webmaster при успешном `hosts_list` означает, что токену может не хватать `webmaster:verify` или прав на конкретный ресурс. Ошибки Direct 4001 для adgroups/ads/keywords требуют `SelectionCriteria`, например `CampaignIds`. Search API требует отдельные folder ID и API key. Логи: `yp logs`. Текущий результат миграции и rollback: [MIGRATION_REPORT.md](MIGRATION_REPORT.md).

English overview: [README.en.md](README.en.md). Старые Python installer, Dockerfile и Compose сохранены как `install.legacy.sh`, `Dockerfile.legacy`, `docker-compose.legacy.yml`.
