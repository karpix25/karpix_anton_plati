import pool from "@/lib/db";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = "google/gemini-2.0-flash-exp-001"; // Or current stable

const CATEGORY_FIELD_MAP: Record<string, string> = {
  scenario: "learned_rules_scenario",
  visual: "learned_rules_visual",
  video: "learned_rules_video",
};

const CATEGORY_CONTEXT: Record<string, string> = {
  scenario: `Ты оптимизируешь ПРОМПТ ГЕНЕРАЦИИ ТЕКСТА СЦЕНАРИЯ.
Этот промпт отвечает за создание текста, который аватар произносит в видео.
Фокус: стиль речи, тон, хуки, структура CTA, длина, формулировки.`,

  visual: `Ты оптимизируешь ПРОМПТ ВЫБОРА ВИЗУАЛЬНЫХ ПЕРЕБИВОК (b-roll).
Этот промпт отвечает за выбор КАКИЕ перебивки показывать и КОГДА.
Фокус: релевантность перебивок к тексту, тайминг, покрытие, выбор сцен.
Применяй принципы Veo-3: разнообразие планов (CU, MS, WS) и логику повествования.`,

  video: `Ты оптимизируешь ПРОМПТ ГЕНЕРАЦИИ ВИДЕО ДЛЯ ПЕРЕБИВОК.
Этот промпт отвечает за ДЕТАЛЬНОЕ ОПИСАНИЕ того, как должна выглядеть каждая перебивка.
Твоя цель — внедрить Veo-3 Meta-Framework:
1. [Cinematography]: Техническое описание камеры (Dolly, Truck, Pan, Tilt, Arc) и ракурса (Low Angle, POV).
2. [Subject]: Детальное описание объекта и его текстур.
3. [Action]: Одно конкретное действие.
4. [Context]: Окружение и освещение (Volumetric, Rembrandt, Golden Hour).
5. [Style & Ambiance]: Настроение без пустых слов типа "cinematic".`,
};

async function optimizeRules(
  category: string,
  currentRules: string,
  feedbackRows: Array<{ feedback_rating: string; feedback_comment: string; scenario_text: string }>
): Promise<string> {
  const categoryContext = CATEGORY_CONTEXT[category] || "";

  const likedExamples = feedbackRows
    .filter((r) => r.feedback_rating === "like" && r.feedback_comment)
    .slice(0, 10)
    .map((r, i) => `👍 #${i + 1}: "${r.feedback_comment}"${r.scenario_text ? `\n   Текст: "${r.scenario_text.slice(0, 200)}..."` : ""}`)
    .join("\n");

  const dislikedExamples = feedbackRows
    .filter((r) => r.feedback_rating === "dislike" && r.feedback_comment)
    .slice(0, 15)
    .map((r, i) => `👎 #${i + 1}: "${r.feedback_comment}"${r.scenario_text ? `\n   Текст: "${r.scenario_text.slice(0, 200)}..."` : ""}`)
    .join("\n");

  const likeCount = feedbackRows.filter((r) => r.feedback_rating === "like").length;
  const dislikeCount = feedbackRows.filter((r) => r.feedback_rating === "dislike").length;

  const prompt = `${categoryContext}

СТАТИСТИКА ФИДБЭКА:
- Лайков: ${likeCount}
- Дизлайков: ${dislikeCount}

${dislikedExamples ? `КОММЕНТАРИИ К ДИЗЛАЙКАМ:\n${dislikedExamples}` : "Дизлайков с комментариями нет."}

${likedExamples ? `КОММЕНТАРИИ К ЛАЙКАМ:\n${likedExamples}` : "Лайков с комментариями нет."}

ТЕКУЩИЕ ВЫУЧЕННЫЕ ПРАВИЛА:
${currentRules || "(пока пусто — это первая оптимизация)"}

ЗАДАЧА:
Проанализируй фидбэк и напиши НОВЫЕ ОПТИМИЗИРОВАННЫЕ ПРАВИЛА для промпта.

ПРИНЦИПЫ ОБРАБОТКИ (Veo-3 Meta-Framework):
1. ПЕРЕВОДИ абстрактный фидбэк в ТЕХНИЧЕСКИЕ параметры.
   - "Выглядит дешево" -> Используй [Context]: Rembrandt lighting, 35mm focal length, textures like grain or steam.
   - "Скучно" -> Добавь [Cinematography]: Dolly In или Arc shot.
   - "Ненастоящее" -> Используй [Subject]: Subsurface scattering для кожи, natural imperfections.
2. ЗАПРЕЩАЙ пустые слова: "cinematic", "stunning", "beautiful", "amazing", "professional".
3. ФОРМУЛИРУЙ правила как краткие инструкции-дополнения.

ФОРМАТ ОТВЕТА (строго):
- Максимум 300 слов
- Пиши на русском
- Конкретные, действуемые инструкции (не абстрактные пожелания)
- Каждое правило с новой строки, начинается с "—"
- Если есть паттерн в дизлайках — сформулируй чёткое правило-запрет
- Если есть паттерн в лайках — сформулируй правило-усилитель
- НЕ дублируй базовые правила промпта — пиши только ДОПОЛНЕНИЯ на основе фидбэка

Ответь ТОЛЬКО текстом правил, без пояснений и заголовков.`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Ты — Senior Technical Cinematographer и эксперт по оптимизации видео-промптов. Твоя специализация — Google Veo 3 и создание фотореалистичного UGC. Ты анализируешь фидбэк пользователей и превращаешь его в строгие технические правила съёмки.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const rules = data?.choices?.[0]?.message?.content?.trim() || "";
  return rules.slice(0, 3000);
}

export async function processOptimization(clientId: number, category: string) {
  if (!clientId || clientId <= 0) {
    throw new Error("clientId is required");
  }

  const dbField = CATEGORY_FIELD_MAP[category];
  if (!dbField) {
    throw new Error("Invalid category");
  }

  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  // Ensure history table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_learned_rules_history (
      id SERIAL PRIMARY KEY,
      client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      rules_text TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Get current rules
  const clientResult = await pool.query(
    `SELECT ${dbField} FROM clients WHERE id = $1`,
    [clientId]
  );
  const currentRules = clientResult.rows[0]?.[dbField] || "";

  // Get feedback for this category
  const feedbackResult = await pool.query(
    `SELECT feedback_rating, feedback_comment, scenario_json->>'script' as scenario_text
     FROM generated_scenarios
     WHERE client_id = $1
       AND feedback_rating IS NOT NULL
       AND (feedback_categories IS NULL OR feedback_categories = '' OR feedback_categories LIKE $2)
     ORDER BY created_at DESC
     LIMIT 50`,
    [clientId, `%${category}%`]
  );

  if (feedbackResult.rows.length === 0) {
    throw new Error("Нет фидбэка для оптимизации. Поставьте лайки/дизлайки на сценарии.");
  }

  // Run LLM optimization
  const newRules = await optimizeRules(category, currentRules, feedbackResult.rows);

  // Save current rules to history before overwriting (if they exist)
  if (currentRules && currentRules.trim().length > 0) {
    await pool.query(
      `INSERT INTO client_learned_rules_history (client_id, category, rules_text) VALUES ($1, $2, $3)`,
      [clientId, category, currentRules]
    );
  }

  // Save new rules
  await pool.query(
    `UPDATE clients SET ${dbField} = $1 WHERE id = $2`,
    [newRules, clientId]
  );

  return {
    category,
    previousRules: currentRules || null,
    newRules,
    feedbackCount: feedbackResult.rows.length,
  };
}
