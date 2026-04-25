# Справочник API (Endpoints)

Система взаимодействует через REST API. Основные эндпоинты разделены на управление контентом, ИИ и видео-процессы.

## 🤖 AI Evolution & Prompts

### `POST /api/scenarios/feedback`
Сохранение оценки пользователя и запуск автоматической оптимизации.
- **Payload**:
  ```json
  {
    "scenarioId": 123,
    "rating": "like" | "dislike",
    "comment": "строка (мин 20 символов для оптимизации)",
    "categories": ["scenario", "visual", "video"]
  }
  ```
- **Логика**: При дизлайке с комментарием вызывает `optimize-prompts-service.ts` для обновления правил промпта в БД клиента.

### `POST /api/clients/optimize-prompts`
Ручной запуск оптимизации правил для конкретного клиента.
- **Payload**: `{"clientId": 1, "category": "scenario"}`

---

### `GET /api/prompts/history`
Получение истории изменений выученных правил.
- **Параметры**: `clientId`, `category`.
- **Ответ**: Список версий с текстом правил и датой создания.

## 🎬 Video Production

### `POST /api/scenarios/assemble`
Запуск финального монтажа.
- **Payload**: `{"scenarioId": 123}`
- **Действие**: Подтягивает все ассеты (аватар, b-roll, аудио) и собирает их в ролик через Remotion/FFmpeg.

### `POST /api/tts`
Генерация аудио-озвучки.
- **Payload**: `{"text": "...", "client_id": 1}`
- **Провайдеры**: Выбирается автоматически на основе настроек аватара клиента (Minimax/ElevenLabs).

## 👥 Client Management

### `GET /api/clients`
Список всех активных клиентов и их настроек (Tone of Voice, Продукт, Аватар).

### `PATCH /api/clients/:id`
Обновление настроек клиента (выученные правила, аватар и т.д.).
