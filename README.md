# yandex-api-mcp

**Один MCP-сервер для Яндекс.Вебмастера, Директа, Метрики, Wordstat, Аудиторий и Search API.** Его можно подключить к ChatGPT и другим MCP-клиентам, чтобы запрашивать данные о сайтах, рекламе, посещениях и поиске обычным языком.

Установка по умолчанию работает **только на чтение**. Инструменты изменения данных скрыты и заблокированы сервером. Несколько проектов могут использовать один OAuth-токен Яндекса; access token обновляется автоматически при наличии refresh token.

## Возможности

| Сервис | Данные |
| --- | --- |
| Вебмастер | Сайты, диагностика, запросы, индексирование, sitemap, ссылки, лимит переобхода |
| Директ | Клиенты агентства, кампании, группы, объявления, ключевые фразы, ставки, отчёты |
| Метрика | Счётчики, цели, сегменты, обычные отчёты, чтение готовых выгрузок Logs API |
| Wordstat | Частотность фраз, динамика, регионы, подсказки |
| Аудитории | Сегменты, пиксели и статистика при наличии прав |
| Search API | Поисковая выдача через Yandex Cloud |

Один MCP-шлюз соединяет TypeScript-ядро для Вебмастера/Директа/Метрики и Python-модули для остальных сервисов. Доступность конкретных данных зависит от прав вашего аккаунта. Реальные read-запросы к шести API проверялись на работающем сервере; операции записи в боевых аккаунтах не тестировались.

## Перед установкой

Нужны Debian 12/13 или Ubuntu 22.04/24.04, `sudo`, Git, Python 3, Docker Engine и Docker Compose v2. Подойдёт VPS, VM или LXC, в котором уже разрешён Docker. Если Docker не установлен, начните с [официальной инструкции для Debian](https://docs.docker.com/engine/install/debian/) или [Ubuntu](https://docs.docker.com/engine/install/ubuntu/). Проверьте `docker compose version`.

Также нужны:

- Яндекс-аккаунт с доступом к нужным сайтам Вебмастера, кабинетам Директа, счётчикам Метрики и Аудиториям.
- Своё OAuth-приложение Яндекса с Client ID и Client Secret.
- Для Wordstat и Search API отдельно: папка Yandex Cloud, сервисный аккаунт и API key.

OAuth не создаёт права на чужие сайты и кабинеты. Wordstat и Search API используют **ключ Yandex Cloud**, а не OAuth-токен Директа.

## Шаг 1. Создайте приложение Яндекс OAuth

1. Войдите на [oauth.yandex.ru](https://oauth.yandex.ru/) под нужным Яндекс-аккаунтом и создайте приложение.
2. Укажите redirect URI: **`https://oauth.yandex.ru/verification_code`**. Этот адрес использует мастер авторизации.
3. Включите права на нужные сервисы:

   | Сервис | OAuth-разрешения |
   | --- | --- |
   | Вебмастер | `webmaster:hostinfo` **и** `webmaster:verify` |
   | Директ | `direct:api` |
   | Метрика | `metrika:read` |
   | Аудитории | `audience:read` |
   | Запись в Метрику в отдельной pro-сборке | `metrika:write` |

4. Сохраните приложение и подготовьте Client ID и Client Secret. Для работы с боевым Директом приложению нужен одобренный доступ к Direct API; доступ к конкретным кабинетам задаётся в Директе.

Команда `yp-api oauth` по умолчанию запрашивает все read-разрешения из таблицы. Если нужны отдельные сервисы, укажите их: `sudo yp-api oauth webmaster metrika`. После добавления нового разрешения в Яндексе **повторите OAuth**: обновление access token не добавляет scope.

## Шаг 2. Установите приложение

```bash
git clone https://github.com/5iNeX/yandex-api-mcp.git
cd yandex-api-mcp
sudo ./install.sh
```

Установщик спросит Client ID и Client Secret; секрет вводится скрыто. Исходники попадут в `/opt/yandex-api-mcp`, OAuth и реестр проектов — в `state/`, ключи приложения — в `secrets/`. Эти каталоги исключены из Git и не встраиваются в Docker image. Установщик не создаёт VM/LXC и не меняет сеть хоста.

Далее используется команда `yp-api`. Если короткое имя `yp` свободно, установщик создаст и его; существующую команду `yp` он не заменяет.

## Шаг 3. Авторизуйтесь и запустите MCP

```bash
sudo yp-api oauth
sudo yp-api service start
sudo yp-api doctor
sudo yp-api discover
```

`oauth` покажет ссылку. Откройте её в браузере, подтвердите доступ и вставьте код **в терминал мастера**. Не публикуйте код и токены в чате или Git. Мастер сохранит access/refresh token локально без вывода их значений.

`discover` покажет доступные сайты Вебмастера, счётчики Метрики и Direct-клиентов. Новый MCP слушает только `127.0.0.1:8001` на сервере. На чистой машине `doctor` может показать `SKIP Tunnel service (optional)`: Tunnel для ChatGPT настраивается отдельно.

## Шаг 4. Настройте Wordstat и Search API

Этот шаг нужен для всех шести сервисов. Если Wordstat и Search API не требуются, переходите к проверке остальных API.

1. В [Yandex Cloud](https://console.yandex.cloud/) выберите папку с Search API и скопируйте её **Folder ID**.
2. Создайте в этой папке сервисный аккаунт, назначьте роль `search-api.webSearch.user` и создайте для него API key. Если для ключа задаются области действия, включите `yc.search-api.execute`. См. [документацию Search API](https://yandex.cloud/ru/docs/search-api/).
3. На сервере откройте файл:

   ```bash
   sudo nano /opt/yandex-api-mcp/secrets/yandex.env
   ```

   Добавьте две строки со своими значениями:

   ```dotenv
   YANDEX_SEARCH_API_FOLDER_ID=ваш_folder_id
   YANDEX_SEARCH_API_API_KEY=ваш_api_key
   ```

4. Закройте файл и восстановите права доступа:

   ```bash
   sudo chown 0:10001 /opt/yandex-api-mcp/secrets/yandex.env
   sudo chmod 440 /opt/yandex-api-mcp/secrets/yandex.env
   sudo yp-api service restart
   ```

Не вставляйте ключ в shell-команды, сохраняемые в истории. Folder ID должен соответствовать папке сервисного аккаунта.

## Шаг 5. Проверьте установку

```bash
sudo yp-api service status
sudo yp-api doctor
sudo yp-api verify
```

`verify` выполняет read-запросы через MCP и выводит статусы и форму ответа без токенов и сырых данных. Для полной зелёной проверки настройте ключи Wordstat/Search API. Если они не настроены, их строки могут показать ошибку, хотя остальные сервисы работают.

## Несколько проектов

Один OAuth-токен используется для нескольких профилей. Сначала получите идентификаторы через `sudo yp-api discover`. Затем добавьте связи проекта:

```bash
sudo yp-api project add my-site \
  --name 'Мой сайт' \
  --direct-login client-login \
  --counter 12345678 \
  --host 'https:example.com:443'
sudo yp-api project list
sudo yp-api service restart
```

Замените логин, ID счётчика и `host_id` своими значениями. Можно указать несколько `--counter` и `--host` или пропустить неиспользуемые поля. `sudo yp-api project remove my-site` удаляет **только локальный профиль**, не данные Яндекса. При работе с несколькими клиентами указывайте проект в вызове MCP явно.

## Подключение клиента

### Claude, Codex, Cursor и другие локальные MCP-клиенты

На той же машине используйте stdio-команду:

```bash
docker exec -i yandex-api-mcp-yandex-api-mcp-1 node gateway/index.mjs
```

Укажите её в настройках MCP-клиента. Локальный SSE endpoint: `http://127.0.0.1:8001/sse`. Он не доступен напрямую с другого компьютера. Доступ к Docker обычно означает широкие права на сервере, поэтому для общего сервера используйте отдельный ограниченный wrapper.

### ChatGPT через OpenAI Secure MCP Tunnel

Для ChatGPT нужен **отдельный OpenAI Tunnel**: собственный Tunnel ID, runtime API key с правами **Tunnels Read + Use** и возможность подключать developer-mode приложения в вашем workspace. Следуйте [официальной инструкции OpenAI](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels): установите `tunnel-client`, создайте Tunnel и задайте для его MCP-канала stdio-команду выше.

Запускайте Tunnel как systemd-службу с автозапуском и `Restart=always`. Храните runtime key через systemd credentials, а для отдельного пользователя службы предоставьте только право запуска фиксированного root-owned wrapper вместо членства в группе `docker`. Проверьте:

```bash
sudo tunnel-client health --port 8080 --require-control-plane-poll --json
sudo yp-api tunnel status
```

Затем подключите Tunnel ID в приложении ChatGPT, обновите его каталог инструментов и попросите выполнить read-вызов `yandex_webmaster_hosts_list`. Публичный MCP-порт для этого не нужен. `yp-api` не создаёт Tunnel и ключ OpenAI автоматически: это отдельные действия владельца workspace.

## Управление и безопасность

| Команда | Назначение |
| --- | --- |
| `sudo yp-api doctor` | Проверить runtime, OAuth, файлы и связь с API |
| `sudo yp-api discover` | Показать доступные объекты Яндекса |
| `sudo yp-api project list` | Показать локальные проекты |
| `sudo yp-api refresh` | Принудительно обновить access token |
| `sudo yp-api verify` | Выполнить read-only smoke через MCP |
| `sudo yp-api logs --tail 80` | Посмотреть логи контейнера |
| `sudo yp-api service status` | Проверить контейнер |
| `sudo yp-api connector info` | Получить локальный адрес и stdio-команду |

Публичный Docker image блокирует write-вызовы, включая `create/clean/cancel` в Metrika Logs API. Отдельная pro-сборка имеет preview и явное подтверждение, но не публикуется автоматически. OAuth хранится в `/opt/yandex-api-mcp/state/oauth.json`, Client Secret и Search API key — в `/opt/yandex-api-mcp/secrets/`. Перед обновлением сохраните защищённую копию этих каталогов; никому не отправляйте их содержимое.

Чтобы обновить сервер, получите новую версию исходников в вашем checkout и снова выполните `sudo ./install.sh`. Установщик сохраняет `state/` и `secrets/` и пересобирает приложение, если OAuth уже настроен. Остановка только этого MCP: `sudo yp-api service stop`.

## Частые проблемы

| Симптом | Что проверить |
| --- | --- |
| `docker compose version` не работает | Установите Docker Engine и Compose plugin |
| OAuth-код отклонён | Redirect URI должен быть `https://oauth.yandex.ru/verification_code`; получите новый код |
| Вебмастер показывает сайты, но запросы по ним дают 403 | Нужны оба scope: `webmaster:hostinfo` и `webmaster:verify`, затем новая OAuth-авторизация |
| Директ даёт 403 | Проверьте одобрение Direct API и права аккаунта/`Client-Login` |
| Wordstat или Search API дают 401/403 | Сверьте Folder ID, роль сервисного аккаунта и scope ключа |
| ChatGPT не видит новый инструмент | Проверьте готовность Tunnel и обновите каталог инструментов приложения |

Лицензия проекта — [Apache-2.0](LICENSE); лицензия TypeScript-ядра — [MIT](core/LICENSE).
