# Docker Compose Automation Stack

Этот compose поднимает production-like контур:

- `postgres`
- `web`
- `telegram-bot`
- `final-video-scheduler`
- `final-video-worker`
- `final-video-poller`

## Запуск

```bash
docker compose -f docker-compose.production.yml up -d --build
```

## Что делает каждый сервис

- `web`: Next.js приложение и API routes
- `telegram-bot`: Telegram polling bot для привязки проектов к топикам и отправки Reel-ссылок
- `final-video-scheduler`: автоматически дозаполняет очередь финальных роликов по активным проектам и месячным лимитам
- `final-video-worker`: берёт jobs стадий `scenario`, `avatar_submit`, `montage`
- `final-video-poller`: берёт jobs стадий `waiting_kie`, `waiting_heygen`

## Важные переменные

```env
AUTOMATION_INTERNAL_TOKEN=
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
FINAL_VIDEO_PER_CLIENT_CONCURRENCY=1
FINAL_VIDEO_QUEUE_BACKLOG_PER_CLIENT=3
FINAL_VIDEO_SCHEDULER_BATCH_PER_CLIENT=1
FINAL_VIDEO_SCHEDULER_INTERVAL_SECONDS=60
FINAL_VIDEO_KIE_POLL_INTERVAL_SECONDS=30
FINAL_VIDEO_HEYGEN_POLL_INTERVAL_SECONDS=30
FINAL_VIDEO_RETRY_BASE_SECONDS=30
FINAL_VIDEO_RETRY_MAX_SECONDS=1800
```

## Как работает нагрузка

- scheduler не набивает бесконечную очередь, а ограничивает backlog на проект
- worker/poller используют PostgreSQL-lease модель через `FOR UPDATE SKIP LOCKED`
- на один проект действует ограничение `FINAL_VIDEO_PER_CLIENT_CONCURRENCY`
- долгие ожидания вынесены из worker в poller, чтобы worker не простаивал на внешних API

## Что важно для масштаба

- если нужен выше throughput, горизонтально масштабируй `final-video-worker` и `final-video-poller`
- при росте нагрузки первым делом выноси PostgreSQL на отдельный managed instance
- локальный `/tmp` остаётся временным рабочим хранилищем; для очень больших объёмов дальше лучше выносить промежуточные файлы в object storage
