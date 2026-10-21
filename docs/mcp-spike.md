# Спайк: удалённый MCP-сервер для ChatGPT / Claude

Цель спайка — проверить, что ИИ-ассистенты могут подключиться к нашему бэкенду по MCP и вызывать инструменты задач.
Данные **тестовые** (в памяти процесса, 4 вымышленных сотрудника и 5 задач), после перезапуска сбрасываются.

## Что сделано

- Эндпоинт `POST /mcp` (MCP Streamable HTTP, режим без сессий, ответы JSON). `GET`/`DELETE /mcp` → 405.
- Инструменты: `list_tasks`, `create_task`, `change_status`, `add_comment`, `who_is_busy`.
  В описании `create_task` модели прямо сказано: ответственного и срок не придумывать, а спрашивать у пользователя.
  Неизвестное имя сотрудника → ошибка со списком допустимых имён.
- Доступ: заголовок `Authorization: Bearer <MCP_DEV_KEY>` (один общий ключ на время спайка).
  Без ключа или с неверным ключом → `401` + `WWW-Authenticate: Bearer`.
- Эндпоинт появляется **только** если задан `MCP_DEV_KEY`; без него `/mcp` отвечает 404.
- Код: `apps/server/src/mcp/` (`fake-store.ts`, `server.ts`, `routes.ts`, тесты `mcp.test.ts`).

## Запуск локально

1. Сгенерировать ключ (не короче 16 символов):

   ```powershell
   node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
   ```

2. Записать его в `apps/server/.env` (файл не коммитится):

   ```
   MCP_DEV_KEY=<ключ>
   ```

3. Запустить сервер: `npm run dev -w apps/server` (по умолчанию `http://127.0.0.1:3000`).

4. Быстрая проверка из PowerShell:

   ```powershell
   $h = @{ Authorization = "Bearer <ключ>"; Accept = "application/json, text/event-stream" }
   $body = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
   Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/mcp -Headers $h -ContentType 'application/json' -Body $body
   ```

## Временный публичный адрес через туннель

ChatGPT и claude.ai ходят к серверу из интернета, поэтому локальный сервер нужно временно открыть, например через Cloudflare quick tunnel:

```powershell
cloudflared tunnel --url http://127.0.0.1:3000
```

cloudflared выведет адрес вида `https://<случайное-имя>.trycloudflare.com`; MCP-адрес — `https://<случайное-имя>.trycloudflare.com/mcp`.
Туннель держать открытым только на время проверки, ключ после проверки сменить.

## Подключение клиентов

### Claude Code — работает с нашим ключом

```powershell
claude mcp add --transport http car-city https://<адрес>/mcp --header "Authorization: Bearer <ключ>"
```

Заголовки (`--header`) для HTTP-серверов Claude Code поддерживает официально.
Наш автотест подключается к серверу официальным MCP SDK-клиентом с таким же заголовком и вызывает инструменты — это проходит.
Живое подключение именно из Claude Code — **не проверено** в рамках спайка.

### claude.ai (веб, а также Desktop и мобильные приложения) — custom connector

Добавляется в **Customize → Connectors → Add custom connector** (на Team/Enterprise — Owner в **Organization settings → Connectors**).
Работает на планах Free (один custom connector), Pro, Max, Team, Enterprise. Сервер должен быть доступен из интернета (запросы идут с адресов Anthropic `160.79.104.0/21`).

Варианты аутентификации по документации Anthropic:

- **OAuth 2.0** (Client ID Metadata Document, Dynamic Client Registration или свой OAuth-клиент) — поддерживается всем.
- **Без аутентификации** — поддерживается всем.
- **Request headers** (статичный `Authorization: Bearer ...`) — **бета, доступна ограниченному числу организаций**.
  Если в диалоге нет раздела Request headers — организации она не доступна. Значение вводится целиком, с префиксом `Bearer `.
  На Team/Enterprise такой заголовок задаёт Owner один раз для всей организации — это общий ключ, а не ключ сотрудника.

Подключение нашего спайка из claude.ai — **не проверено**: есть ли у аккаунта бета Request headers, не проверяли.
Без беты наш сервер с bearer-ключом из claude.ai подключить нельзя (Claude получит 401, попробует найти OAuth-метаданные `/.well-known/oauth-protected-resource`, не найдёт и покажет ошибку подключения).

### ChatGPT — developer mode / custom MCP apps

По документации OpenAI («Add custom MCP server»): только веб-версия ChatGPT, транспорты SSE и streaming HTTP,
аутентификация — **OAuth**, **без аутентификации** или **смешанная** (часть инструментов без входа, часть через OAuth).
Статичного API-ключа / произвольного заголовка `Authorization` в официальной документации **нет**.
Какие тарифы дают developer mode и как сейчас выглядит диалог — **не проверено** (по сторонним источникам UI менялся).

Итог: подключить к ChatGPT наш сервер с bearer-ключом нельзя; нужен OAuth (или открытый сервер без авторизации).

## Главный вывод спайка (для этапа 7)

| Клиент | Статичный Bearer-ключ | OAuth |
| --- | --- | --- |
| Claude Code | да | да |
| claude.ai / Desktop / мобильные | только бета Request headers, не у всех | да |
| ChatGPT | нет | да |

- **Персональные API-ключи** закрывают только Claude Code (и claude.ai, если доступна бета заголовков). Для ChatGPT их недостаточно.
- Если ChatGPT и claude.ai — обязательные клиенты, на этапе 7 нужен **OAuth 2.1 сервер авторизации** поверх нашей авторизации пользователей:
  `401` с `WWW-Authenticate: Bearer resource_metadata="..."`, документ `/.well-known/oauth-protected-resource`,
  метаданные сервера авторизации, PKCE S256, CIMD и/или DCR, токен-эндпоинт с `application/x-www-form-urlencoded`,
  ротация refresh-токенов, редирект `https://claude.ai/api/mcp/auth_callback` и loopback-редиректы для Claude Code.
  Тогда каждый сотрудник входит своим логином, и сервер знает, кто именно создаёт задачи.
- Персональные ключи можно оставить как дополнительный простой путь для Claude Code / скриптов.
- Ключ в URL (`?key=...`) как обходной путь использовать **нельзя**: он попадает в логи, а спецификация MCP это запрещает.

## Что осталось проверить вживую

- [ ] Claude Code через туннель с `--header`.
- [ ] claude.ai: есть ли раздел Request headers; если нет — проверить подключение только после OAuth.
- [ ] ChatGPT developer mode: доступен ли на нашем тарифе; проверка возможна только после OAuth (или временно без авторизации на тестовых данных).
- [ ] Как модели ведут себя на `create_task` без срока/ответственного (спрашивают ли пользователя).

Источники: [Claude — Authentication for connectors](https://claude.com/docs/connectors/building/authentication),
[Claude — Add a connector that isn't in the directory](https://claude.com/docs/connectors/custom/add-unlisted),
[OpenAI — Add custom MCP server](https://developers.openai.com/api/docs/guides/custom-mcp-server).
Документация проверена 2026-10-20.
