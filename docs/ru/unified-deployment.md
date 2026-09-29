# Развёртывание yandex-api-mcp

Публичный образ объединяет TypeScript core (Webmaster, Direct, Metrika) и Python-адаптер (Wordstat, Audience, Search API) через один MCP gateway. `/healthz` показывает оба процесса и число инструментов. Docker Compose публикует SSE только на `127.0.0.1:8001`; stdio-команда: `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`.

## Установка

На Debian/Ubuntu нужны Docker Engine, Compose v2 и Python 3. Запустите `sudo ./install.sh`, затем `sudo yp oauth`, `sudo yp service start`, `sudo yp doctor` и `sudo yp verify`. Если старый `yp` уже существует, новый называется `yp-api`. Установщик копирует файлы в `/opt/yandex-api-mcp`, сохраняя `state/` и `secrets/`. Сборка по умолчанию публичная и read-only.

OAuth scope по умолчанию: `webmaster:hostinfo webmaster:verify direct:api metrika:read audience:read`. Для загрузок в Метрику отдельно нужен `metrika:write`. Wordstat использует доступ Direct. Search API требует `YANDEX_SEARCH_API_FOLDER_ID` и `YANDEX_SEARCH_API_API_KEY` в `secrets/yandex.env`. Токен один для нескольких проектов; `state/projects.json` не хранит токены. Refresh выполняется автоматически. Добавление scope требует новой авторизации.

## OpenAI Tunnel

Работающий Tunnel остаётся на старом Direct MCP до успешной проверки нового сервера и OAuth Webmaster. Подготовленная команда переключения: `sudo -n /usr/local/libexec/yandex-api-mcp-stdio`. Root-owned wrapper запускает `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`; для `tunnel-client` нужна узкая sudoers-запись. Перед переключением сохранить профиль, после него перезапустить только `tunnel-client.service`, выполнить `tunnel-client doctor --profile yandex-mcp --profile-dir /etc/tunnel-client/profiles` и вызов MCP из ChatGPT. Для отката восстановить профиль и снова перезапустить только Tunnel. Порт наружу и сеть Proxmox менять не требуется.

## Безопасность и откат

Секреты находятся в host files, не в image и не в переменных Docker Compose. Публичный marker принудительно блокирует запись. В pro-сборке запись требует `confirm:true`, удаление — точное `destructive_confirmation`; лимит batch — 50. Повтор 5xx/сетевых ошибок применяется только к операциям чтения.

Для отката остановить только новый Compose: `docker compose -p yandex-api-mcp -f /opt/yandex-api-mcp/compose.yandex-api-mcp.yml stop`. Старый `/opt/yandex-mcp/` и Tunnel независимы. Backup сохранён в `/opt/yandex-mcp/backups/`. Сеть Proxmox и LXC не изменять.
