# 🌐 Контент машина (Content Machine)

[![Version](https://img.shields.io/badge/version-1.3.4-blue.svg)](https://github.com/vibetram/pay-world)
[![Stack](https://img.shields.io/badge/stack-Next.js%20|%20FastAPI%20|%20PostgreSQL-green.svg)](#-технологический-стек)

**Контент машина** — это высокоавтоматизированная платформа для генерации рекламного видеоконтента с использованием ИИ аватаров и динамических B-roll перебивок. Система автоматизирует полный цикл: от анализа референсов и написания сценариев до генерации аватаров и финального монтажа.

---

## 🎯 Ключевые возможности

- **AI Scenario Generation**: Создание сценариев на основе Tone of Voice клиента и паттернов успешных референсов.
- **AI Evolution (Самообучение)**: Промпты автоматически улучшаются на основе обратной связи пользователей (Learned Rules).
- **Multi-Provider TTS**: Поддержка ElevenLabs и MiniMax (оптимизировано для русского языка).
- **Automated Video Assembly**: Автоматический монтаж в Remotion/FFmpeg: аватар + перебивки + субтитры + динамический зум.
- **Multi-Avatar System**: Управление базой аватаров и их закрепление за конкретными офферами.

---

## 🏗 Архитектура системы

Система построена на модульном принципе: UI на Next.js и бэкенд-сервисы на FastAPI работают с общей базой данных PostgreSQL.

```mermaid
C4Container
    title Схема контейнеров системы Pay World

    Person(user, "Администратор/Контент-мейкер", "Управляет клиентами, оценивает сценарии, запускает генерацию.")

    System_Boundary(c1, "Pay World Platform") {
        Container(ui, "Next.js App", "Next.js 14, React", "Dashboard, управление настройками AI Evolution и мониторинг.")
        Container(api, "Internal API (FastAPI)", "Python, FastAPI", "Координация сервисов и управление задачами.")
        Container(worker, "Final Video Worker", "Python, Asyncio", "State-machine пайплайна: от сценария до рендера.")
        ContainerDb(db, "Database", "PostgreSQL", "Хранит данные клиентов, сценарии, историю AI Evolution и промпты.")
    }

    System_Ext(openrouter, "OpenRouter (LLM)", "Gemini 2.5 / Claude 3.5. Генерирует сценарии и промпты.")
    System_Ext(kie, "KIE.ai (Veo-3)", "Генерация B-roll видео по промптам.")
    System_Ext(heygen, "HeyGen", "Генерация цифрового аватара (Lipsync).")
    System_Ext(minimax, "MiniMax / ElevenLabs", "Голосовая озвучка (TTS).")

    Rel(user, ui, "Использует", "HTTPS")
    Rel(ui, db, "Чтение/Запись", "Prisma/SQL")
    Rel(ui, api, "Вызывает", "HTTP/JSON")
    Rel(worker, db, "Чтение/Запись", "SQL")
```

### Основные компоненты:
1. **Web UI**: `/ui` — Интерфейс управления, расчет покрытия перебивок и Rollback промптов.
2. **Automation Engine**: `/services/v1/automation` — Логика этапов `scenario`, `waiting_kie`, `avatar_submit`.
3. **AI Evolution**: Динамическое обучение на основе дизлайков (автогенерация "Learned Rules").
4. **Post-production**: `/services/v1/post_production` — Наложение субтитров, зум-эффекты и чистка аудио.

---

## 🔄 Пайплайн генерации (Workflow)

Процесс создания ролика управляется `final_video_worker.py` через систему состояний (State Machine):

1. **Scenario**: LLM пишет сценарий → TTS генерирует аудио → Deepgram дает тайминги → LLM выделяет ключевые слова.
2. **Waiting KIE**: Генерация B-roll видео (Veo-3) на основе промптов с логикой ретраев (до 3 попыток).
3. **Avatar Submit**: Отправка аудио в HeyGen для создания аватара.
4. **Waiting HeyGen**: Ожидание готовности аватара (Polling).
5. **Montage**: Сборка в FFmpeg → Субтитры → Кадрирование → Загрузка в Yandex Disk.

### 🎬 Тайминг и смысл перебивок (B-roll)

Чтобы short-form ролик быстрее цеплял внимание, в пайплайне есть жесткие правила раннего входа в перебивки:

- **Аватар-хук**: первые `2.8s` всегда остаются на лице аватара.
- **Первая перебивка**: стартует не позже `3.5s` (финальный guard применяется дважды: до и после пост-обработки сегментов).
- **Источник ранней фразы**: первая фраза/ключ берутся из речи до `3.0s`.
- **Смысловой selector ключа**:
  - `v1` — базовый эвристический выбор (длина слова, позиция, стоп-слова).
  - `v2` — тематический выбор с учетом контекста всего сценария/tts (частотность темы, гео-маркеры и т.д.).

Это уменьшает случаи, когда первая перебивка появляется поздно или попадает в менее релевантное слово.

---

## 📥 Сбор данных и Парсинг (Ingestion)

Система наполняется референсами через автоматизированные инструменты сбора данных:

### 1. Telegram Scraper (Telethon)
Используется для мониторинга целевых Telegram-каналов и извлечения видео-постов.
- **Действие**: Извлекает метаданные поста и загружает видеофайл для последующей транскрибации.
- **Библиотека**: `Telethon` (Telegram Client Library).

### 2. Instagram Reels Downloader (RapidAPI)
Интегрированный парсер для обработки ссылок на Reels, отправляемых пользователями в бот.
- **Технология**: Использует `RapidAPI` для обхода ограничений и получения прямых ссылок на MP4.
- **Логика**: При получении ссылки бот автоматически загружает ролик, извлекает текст через Whisper/Deepgram и создает «Карточку референса» в БД.

### 3. Telegram Management Bot
Служит интерфейсом для оперативного управления: привязка клиентов к топикам, настройка офферов и запуск пайплайна вручную.

---

## 🛰 Интеграции

| Сервис | Роль в системе | Переменная .env |
| :--- | :--- | :--- |
| **OpenRouter** | Генерация текстов (Gemini 2.5 Flash) | `OPENROUTER_API_KEY` |
| **KIE.ai** | Генерация видео (Veo-3) | `KIE_API_KEY` |
| **HeyGen** | Цифровой аватар | `HEYGEN_API_KEY` |
| **MiniMax** | TTS (Лучшая для RU) | `MINIMAX_API_KEY` |
| **ElevenLabs** | TTS (Клонирование голоса) | `ELEVENLABS_API_KEY` |
| **Deepgram** | Тайминги слов (STT) | `DEEPGRAM_API_KEY` |
| **RapidAPI** | Парсинг Instagram Reels | `RAPIDAPI_KEY` |
| **Yandex Disk** | Хранилище готовых видео | `YANDEX_TOKEN` |

---

## 🔐 API & Безопасность

Все внешние запросы проходят валидацию через `validateApiRequest`.

- **Auth**: Требуется валидная кука `tg_session` (Telegram Auth).
- **Rate Limit**: 100 запросов в минуту на пользователя.
- **Security**: Прямой доступ к API бэкенда закрыт извне.

### Ключевые эндпоинты:
- `POST /api/scenarios/feedback` — Сохранение оценки и запуск AI Evolution.
- `POST /api/scenarios/assemble` — Ручной запуск финальной сборки.
- `GET /api/clients` — Управление настройками офферов.

---

## ⚙️ Быстрый старт (.env)

Скопируйте `.env.example` в `.env` и заполните ключи:

```bash
# AI & Core
OPENROUTER_API_KEY=sk-or-...
SCENARIO_MODEL=google/gemini-2.5-flash

# Video & Audio
KIE_API_KEY=...
HEYGEN_API_KEY=...
MINIMAX_API_KEY=...
MINIMAX_GROUP_ID=...
ELEVENLABS_API_KEY=...
DEEPGRAM_API_KEY=...

# B-roll semantic selector
# true  -> использовать selector v2 (рекомендуется)
# false -> откат на selector v1
BROLL_USE_SEMANTIC_KEYWORD_SELECTOR_V2=true

# Database
DB_HOST=localhost
DB_NAME=postgres
DB_USER=...
DB_PASS=...
```

---

## 🎙 Оптимизация озвучки (MiniMax)

Для лучшего качества на русском языке:
- Используйте модель `speech-2.8-hd`.
- Параметр `language_boost` всегда установлен в `"Russian"`.
- Для исправления ударений используйте словарь: `"атлас/атл+ас"`.
- **Важно**: Мы не используем автоматические вздохи/теги эмоций, чтобы сохранить чистоту речи.

---
© 2024–2025 Vibetraffic AI Team
