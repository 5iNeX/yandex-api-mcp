# Развёртывание yandex-api-mcp

Пошаговая инструкция для новой установки, включая Яндекс OAuth, Search API key и подключение MCP-клиентов, находится в [README](../../README.md). Эта страница описывает эксплуатацию после установки.

## Структура установки

`sudo ./install.sh` копирует приложение в `/opt/yandex-api-mcp`. Docker Compose запускает один публичный MCP-контейнер с двумя backend-процессами. SSE доступен на `127.0.0.1:8001/sse`; наружу порт не публикуется. `state/oauth.json` содержит обновляемый access/refresh token, `state/projects.json` — профили без копий токена. `secrets/oauth-app.json` и `secrets/yandex.env` содержат данные приложения и ключ Search API. Эти файлы не входят в Git или image.

`yp-api oauth` запрашивает `webmaster:hostinfo webmaster:verify direct:api metrika:read audience:read` по умолчанию. Wordstat и Search API используют отдельные Yandex Cloud Folder ID и API key. После расширения OAuth scope нужна новая авторизация. Новый access token обновляется автоматически при наличии refresh token.

## Управление

```bash
sudo yp-api service status
sudo yp-api doctor
sudo yp-api discover
sudo yp-api project list
sudo yp-api verify
sudo yp-api logs --tail 80
```

`verify` выполняет реальные read-вызовы. Если ключ Wordstat/Search API не настроен, их отдельные проверки могут завершиться ошибкой. Добавление или удаление проекта меняет только локальный реестр; после этого выполните `sudo yp-api service restart`.

## OpenAI Tunnel

OpenAI Secure MCP Tunnel настраивается отдельно с собственным Tunnel ID и runtime API key. Укажите в нём stdio-команду `docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs`. Службе нужны автозапуск и `Restart=always`: при временном исчезновении MCP subprocess tunnel-client может завершиться с кодом 0. Проверьте `tunnel-client health --port 8080 --require-control-plane-poll --json`, затем обновите инструменты приложения ChatGPT. [Официальная инструкция OpenAI](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

## Безопасное обновление и откат

Перед обновлением сохраните защищённые копии `/opt/yandex-api-mcp/state/` и `secrets/`. Получите новую версию исходников, выполните `sudo ./install.sh` и проверьте `sudo yp-api doctor` и `verify`. Установщик сохраняет `state/` и `secrets/`. Публичная сборка блокирует API-записи, включая создание и очистку Logs API export.

Для отката к предыдущему image восстановите сохранённый image/source и только конфигурацию этого приложения. Секреты и OAuth state восстанавливайте осторожно: refresh token мог смениться после создания backup. Не требуется менять сеть, DNS, маршрутизацию или firewall.
