# Документация проекта «Плати по миру» (Pay World)

## 🎯 Обзор проекта
Pay World — это высокоавтоматизированная платформа для генерации рекламного видеоконтента с использованием ИИ. Система берет на себя весь цикл: от анализа референсов и написания сценариев до генерации аватаров, подбора перебивок (B-roll) и финального монтажа.

### Ключевые возможности:
- **AI Scenario Generation**: Создание сценариев на основе Tone of Voice клиента и паттернов успешных референсов.
- **AI Evolution (Самообучение)**: Промпты для генерации контента автоматически улучшаются на основе лайков и дизлайков пользователей.
- **Multi-Provider TTS**: Поддержка ElevenLabs и Minimax для максимально естественной озвучки.
- **Automated Video Assembly**: Автоматический монтаж в Remotion/FFmpeg, объединяющий аватара, перебивки и субтитры.
- **Multi-Avatar System**: Возможность закрепления конкретных аватаров и их визуальных образов за разными клиентами.

## 📂 Структура документации
1. [**Архитектура системы (C4 Model)**](./ARCHITECTURE.md) — Стек технологий, контейнеры и связи.
2. [**Пайплайн автоматизации**](./AUTOMATION_PIPELINE.md) — Детальное описание стадий генерации видео от А до Я.
3. [**Интеграции с ИИ-провайдерами**](./INTEGRATIONS.md) — KIE.ai, HeyGen, ElevenLabs, OpenRouter.
4. [**Справочник API**](./API_REFERENCE.md) — Эндпоинты фронтенда и внутренних сервисов.
5. [**Инструкция по развертыванию**](../DOCKER_COMPOSE_AUTOMATION.md) — Настройка окружения и Docker.

## 🛠 Технологический стек
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Radix UI.
- **Backend Services**: Python 3.10+, FastAPI.
- **Database**: PostgreSQL (Prisma на фронтенде, direct pool на бэкенде).
- **Video Rendering**: Remotion (React-based video), FFmpeg.
- **AI Orchestration**: OpenRouter (Gemini/Claude/GPT-4).
- **Infrastructure**: Docker, Docker Compose, EasyPanel (для деплоя).

---
© 2024 Vibetraffic AI Team
