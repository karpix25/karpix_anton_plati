# Пайплайн автоматизации генерации видео

Этот документ описывает жизненный цикл создания видеоролика в системе Pay World — от идеи до финального файла.

## 🔄 Схема пайплайна (Workflow)

```mermaid
graph TD
    A[Start: Final Video Job] --> B[Stage: Scenario]
    B --> B1[LLM: Write Script]
    B1 --> B2[TTS: Generate Audio]
    B2 --> B3[Deepgram: Aligment & Timestamps]
    B3 --> B4[LLM: Visual Keyword Extraction]
    B4 --> B5[LLM: Video Prompts for B-roll]
    
    B5 --> C[Stage: Waiting KIE]
    C --> C1[Submit Tasks to KIE.ai]
    C1 --> C2[Polling Task Status]
    C2 -->|Success| D[Stage: Avatar Submit]
    C2 -->|Retry| C1
    
    D --> D1[Submit Audio to HeyGen]
    D1 --> E[Stage: Waiting HeyGen]
    E --> E1[Polling HeyGen Status]
    E1 -->|Success| F[Stage: Montage]
    
    F --> F1[FFmpeg/Remotion Assembly]
    F --> F2[Overlay Subtitles]
    F --> F3[Post-processing: Zoom & Audio Fix]
    
    F3 --> G[End: Final Video Ready]
```

## 📝 Детальное описание этапов

### 1. Этап Scenario (Подготовка)
Система работает в нескольких режимах:
- **Mix**: Соединение случайной темы (Topic Card) и структуры (Structure Card).
- **Rewrite**: Переписывание существующего референса (из `telethon` парсера) под оффер клиента.
- **Cluster**: Анализ группы референсов для вычленения общих черт.

**Результат**: Сценарий, аудиофайл озвучки и JSON с временными метками слов.

### 2. Этап Waiting KIE (Визуал)
На основе ключевых сегментов сценария генерируются промпты для Veo-3.
- **Технология**: KIE.ai (модель Veo-3).
- **Логика ретраев**: Если сервис возвращает 422 (ошибка валидации промпта), система автоматически пробует перегенерировать промпт. Ограничение — 3 попытки.

### 3. Этап Avatar Submit (Аватар)
Система отправляет аудиофайл озвучки в HeyGen.
- Используется фиксированный `avatar_id` и `look_id` клиента.
- Если TTS файл отсутствует (сбой на шаге 1), система попытается регенерировать его перед отправкой.

### 4. Этап Montage (Сборка)
Финальный этап, выполняемый эндпоинтом `/api/scenarios/assemble`.
- **Composite**: Наложение аватара на фон или кадрирование.
- **B-roll Overlay**: Наложение сгенерированных видео-перебивок поверх аватара в нужные моменты времени.
- **Yandex Disk**: Загрузка готового ролика в облако клиента.

## 🛠 Управление через Worker
За весь процесс отвечает `final_video_worker.py`. Он работает по принципу конечного автомата (State Machine), переключая `current_stage` в таблице `final_video_jobs`. 

Если одна из стадий падает (например, нет коннекта к KIE), воркер делает экпоненциальную паузу (backoff) и пробует снова.
