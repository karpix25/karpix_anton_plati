# Архитектура системы (C4 Container Diagram)

Проект построен по модульной архитектуре, где пользовательский интерфейс и сервисы автоматизации разделены, но работают с общей базой данных PostgreSQL.

```mermaid
C4Container
    title Схема контейнеров системы Pay World

    Person(user, "Администратор/Контент-мейкер", "Управляет клиентами, оценивает сценарии, запускает генерацию.")

    System_Boundary(c1, "Pay World Platform") {
        Container(ui, "Next.js App", "Next.js 14, React", "Предоставляет Dashboard, управление настройками AI Evolution и мониторинг генерации.")
        Container(api, "Internal API (FastAPI)", "Python, FastAPI", "API для управления задачами автоматизации и взаимодействия сервисов.")
        Container(worker, "Final Video Worker", "Python, Asyncio", "Фоновый процесс, управляющий пайплайном: от сценария до рендера.")
        ContainerDb(db, "Database", "PostgreSQL", "Хранит данные клиентов, сценарии, историю AI Evolution и промпты.")
        Container(redis, "Queue/Cache", "Redis", "Очереди задач (в планах) и кэширование.")
    }

    System_Ext(openrouter, "OpenRouter (LLM)", "Gemini 2.0 / Claude 3.5. Генерирует сценарии и оптимизирует правила.")
    System_Ext(kie, "KIE.ai (Veo-3)", "Генерация B-roll видео по промптам.")
    System_Ext(heygen, "HeyGen / Wav2Lip", "Генерация говорящего аватара.")
    System_Ext(elevenlabs, "ElevenLabs / Minimax", "Голосовая озвучка (TTS) и клонирование голоса.")

    Rel(user, ui, "Использует", "HTTPS")
    Rel(ui, db, "Чтение/Запись", "Prisma/SQL")
    Rel(ui, api, "Вызывает", "HTTP/JSON")
    Rel(worker, db, "Чтение/Запись", "SQL")
    Rel(worker, api, "Координирует", "HTTP")

    Rel(api, openrouter, "Запросы к LLM", "HTTPS")
    Rel(worker, kie, "Генерация видео", "HTTPS")
    Rel(worker, heygen, "Генерация аватара", "HTTPS")
    Rel(api, elevenlabs, "Генерация озвучки", "HTTPS")
```

## 🏗 Ключевые компоненты

### 1. Web UI (Dashboard)
- **Путь**: `/ui`
- **Технологии**: React, Tailwind, Lucide Icons.
- **Особенности**: 
    - Динамический расчет покрытия перебивок.
    - Интерфейс отката версий промптов (AI Evolution History).
    - Система предпросмотра визуальных промптов перед генерацией.

### 2. Automation Engine
- **Путь**: `/services/v1/automation`
- **Логика**: Обрабатывает этапы `scenario`, `waiting_kie`, `avatar_submit`, `montage`.
- **Отказоустойчивость**: Реализована система автоматических ретраев при сбоях ИИ-провайдеров (KIE API 422/500).

### 3. AI Evolution Service
- **Путь**: `/ui/src/lib/optimize-prompts-service.ts`
- **Механика**: 
    - Каждые N дизлайков (с комментарием > 20 символов) триггерят LLM для анализа ошибок.
    - LLM создает "Learned Rules" (Выученные правила), которые подмешиваются в системный промпт.
    - Поддержка версионности и мгновенного Rollback.

### 4. Video Post-processing (Post-production)
- **Path**: `/services/v1/post_production`
- **Функции**:
    - Наложение субтитров.
    - Динамический зум (Zoom In/Out) на аватара для создания динамики.
    - Обработка аудио (удаление тишины и вдохов).
