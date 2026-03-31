# Deploy On EasyPanel

Этот проект разворачивается в EasyPanel без прямого bind'а host-портов из `docker-compose`.

Почему один сервис:
- основной HTTP-сервис здесь это `Next.js`
- Python не слушает отдельный порт, а запускается из Next API routes как дочерние процессы
- для сборки монтажа нужен `ffmpeg`, поэтому контейнер должен содержать и `Node.js`, и `Python`, и `ffmpeg`

## Что создать в EasyPanel

1. Создай новый `Project`
2. Добавь `App`
3. Подключи Git-репозиторий этого проекта
4. EasyPanel должен использовать корневой `Dockerfile`
5. В EasyPanel укажи публичный порт `3000` для сервиса `web`
6. Настрой домен на этот `App`

## Health Check

Используй HTTP health check:

```text
/api/health
```

Ожидаемый ответ:

```json
{
  "ok": true,
  "service": "platipo-miru",
  "db": "ok"
}
```

## Обязательные Environment Variables

```env
DB_HOST=
DB_NAME=
DB_USER=
DB_PASS=
DB_PORT=5432

OPENROUTER_API_KEY=
DEEPGRAM_API_KEY=
MINIMAX_API_KEY=
MINIMAX_GROUP_ID=
ELEVENLABS_API_KEY=
HEYGEN_API_KEY=
YANDEX_DISK_OAUTH_TOKEN=
YANDEX_DISK_TOKEN=
YANDEX_TOKEN=
RAPIDAPI_KEY=
TELEGRAM_BOT_TOKEN=
```

## Рекомендуемые Environment Variables

```env
NODE_ENV=production
PORT=3000
NEXT_TELEMETRY_DISABLED=1
LOG_LEVEL=INFO
YANDEX_DISK_PROJECT_FOLDER=Плати по миру
```

## Что делает старт контейнера

Стартовый скрипт:
- вызывает `init_db()` перед поднятием приложения
- затем запускает `next start` на `0.0.0.0:$PORT`

Это значит, что таблицы и новые колонки будут доздаваться автоматически при старте контейнера.

## Важные замечания

- Временные файлы аудио и видео пишутся в `/tmp`
- Финальные монтажи будут загружаться в Яндекс Диск, если задан любой из токенов:
  `YANDEX_DISK_OAUTH_TOKEN`, `YANDEX_DISK_TOKEN` или `YANDEX_TOKEN`
- Если на проде планируется активный монтаж, контейнеру нужен достаточный диск и RAM
- Если Postgres находится в другом сервисе EasyPanel, используй внутренние credentials этого Postgres-сервиса
- В `docker-compose.production.yml` порты не публикуются наружу через `ports:`; EasyPanel должен проксировать `web:3000` сам
- Если хочешь хранить медиа дольше жизни контейнера, дальше нужно выносить их из `/tmp` в object storage

## После деплоя проверь

1. `GET /api/health`
2. `GET /api/clients`
3. генерацию TTS
4. генерацию сценария
5. сборку монтажа, если используется `ffmpeg`
