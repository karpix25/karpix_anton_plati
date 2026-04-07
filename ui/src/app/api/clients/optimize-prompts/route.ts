import { NextResponse } from "next/server";
import pool from "@/lib/db";

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_MODEL = "google/gemini-2.5-flash";

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

export async function POST(request: Request) {
  try {
    const { clientId, category } = await request.json();
    const resolvedClientId = Number.parseInt(String(clientId), 10);

    if (!Number.isFinite(resolvedClientId) || resolvedClientId <= 0) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    if (!category || !CATEGORY_FIELD_MAP[category]) {
      return NextResponse.json(
        { error: "category must be 'scenario', 'visual', or 'video'" },
        { status: 400 }
      );
    }

    if (!OPENROUTER_API_KEY) {
      return NextResponse.json({ error: "OPENROUTER_API_KEY is not configured" }, { status: 500 });
    }

    const dbField = CATEGORY_FIELD_MAP[category];

    // Get current rules
    const clientResult = await pool.query(
      `SELECT ${dbField} FROM clients WHERE id = $1`,
      [resolvedClientId]
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
      [resolvedClientId, `%${category}%`]
    );

    if (feedbackResult.rows.length === 0) {
      return NextResponse.json({ error: "Нет фидбэка для оптимизации. Поставьте лайки/дизлайки на сценарии." }, { status: 400 });
    }

    // Run LLM optimization
    const newRules = await optimizeRules(category, currentRules, feedbackResult.rows);

    // Save new rules
    await pool.query(
      `UPDATE clients SET ${dbField} = $1 WHERE id = $2`,
      [newRules, resolvedClientId]
    );

    return NextResponse.json({
      ok: true,
      category,
      previousRules: currentRules || null,
      newRules,
      feedbackCount: feedbackResult.rows.length,
    });
  } catch (error) {
    console.error("Optimize prompts error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");
    const resolvedClientId = Number.parseInt(String(clientId), 10);

    if (!Number.isFinite(resolvedClientId) || resolvedClientId <= 0) {
      return NextResponse.json({ error: "clientId is required" }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT learned_rules_scenario, learned_rules_visual, learned_rules_video FROM clients WHERE id = $1`,
      [resolvedClientId]
    );

    if (!rows[0]) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Get feedback stats
    const statsResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE feedback_rating = 'like') as likes,
         COUNT(*) FILTER (WHERE feedback_rating = 'dislike') as dislikes,
         COUNT(*) FILTER (WHERE feedback_rating IS NOT NULL) as total
       FROM generated_scenarios
       WHERE client_id = $1`,
      [resolvedClientId]
    );

    return NextResponse.json({
      rules: {
        scenario: rows[0].learned_rules_scenario || "",
        visual: rows[0].learned_rules_visual || "",
        video: rows[0].learned_rules_video || "",
      },
      stats: {
        likes: Number(statsResult.rows[0]?.likes || 0),
        dislikes: Number(statsResult.rows[0]?.dislikes || 0),
        total: Number(statsResult.rows[0]?.total || 0),
      },
    });
  } catch (error) {
    console.error("Get prompt rules error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
