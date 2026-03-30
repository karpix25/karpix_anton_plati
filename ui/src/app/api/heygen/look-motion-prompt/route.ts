import { NextResponse } from "next/server";

const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1";
const HEYGEN_MOTION_PROMPT_MAX_LENGTH = 500;

function getOpenRouterApiKey() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.includes("your_")) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  return apiKey;
}

function sanitizeUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const parsed = new URL(value.trim());
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractPromptFromResponse(payload: unknown) {
  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> } | null)?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) =>
        typeof item === "object" && item && "text" in item && typeof item.text === "string" ? item.text : ""
      )
      .join("\n")
      .trim();

    return text;
  }

  return "";
}

function normalizeMotionPrompt(value: string) {
  return value.trim().slice(0, HEYGEN_MOTION_PROMPT_MAX_LENGTH);
}

export async function POST(request: Request) {
  try {
    const { previewImageUrl, avatarName, lookName } = await request.json();
    const resolvedPreviewImageUrl = sanitizeUrl(previewImageUrl);

    if (!resolvedPreviewImageUrl) {
      return NextResponse.json({ error: "previewImageUrl is required" }, { status: 400 });
    }

    const response = await fetch(`${OPENROUTER_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getOpenRouterApiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Plati Po Miru",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        temperature: 0.4,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `You are writing a HeyGen Add Motion prompt for a photo avatar look.

Analyze the preview image and write one English motion prompt that fits the exact framing, pose, clothing, visible body area, and visible background.

Context:
- Avatar name: ${typeof avatarName === "string" && avatarName.trim() ? avatarName.trim() : "Unknown"}
- Look name: ${typeof lookName === "string" && lookName.trim() ? lookName.trim() : "Unknown"}

Rules:
- Write only the final prompt text. No markdown. No labels.
- The prompt must describe realistic motion that is physically compatible with what is visible in the image.
- If only the head and shoulders are visible, do not invent large body gestures.
- If upper torso or hands are visible, allow subtle natural torso, shoulder, and hand micro-movements.
- If background elements are visible, include slight ambient background motion only when it makes sense.
- Keep the energy calm, natural, professional, and believable.
- Avoid dramatic gestures, dancing, walking, camera moves, exaggerated nodding, or cinematic action.
- Mention subtle breathing, posture adjustments, and gentle human liveliness where appropriate.
- Keep it concise and specific. The final prompt must be no longer than 500 characters.
- This prompt will be sent directly to HeyGen Add Motion.`,
              },
              {
                type: "image_url",
                image_url: {
                  url: resolvedPreviewImageUrl,
                },
              },
            ],
          },
        ],
      }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        (payload as { error?: { message?: string }; message?: string } | null)?.error?.message ||
        (payload as { message?: string } | null)?.message ||
        `OpenRouter request failed with status ${response.status}`;
      throw new Error(message);
    }

    const motionPrompt = normalizeMotionPrompt(extractPromptFromResponse(payload));
    if (!motionPrompt) {
      throw new Error("OpenRouter did not return a motion prompt");
    }

    return NextResponse.json({
      ok: true,
      motionPrompt,
    });
  } catch (error) {
    console.error("HeyGen look motion prompt POST error:", error);
    const message = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
