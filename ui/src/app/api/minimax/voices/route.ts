import { NextResponse } from "next/server";

type MinimaxVoiceResponse = {
  system_voice?: Array<{
    voice_id: string;
    voice_name?: string;
    description?: string[];
    created_time?: string;
  }>;
  voice_cloning?: Array<{
    voice_id: string;
    description?: string[];
    created_time?: string;
  }>;
  voice_generation?: Array<{
    voice_id: string;
    description?: string[];
    created_time?: string;
  }>;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

export async function GET() {
  try {
    const apiKey = process.env.MINIMAX_API_KEY;

    if (!apiKey || apiKey.includes("your_")) {
      return NextResponse.json({ error: "MINIMAX_API_KEY is not configured" }, { status: 500 });
    }

    const response = await fetch("https://api.minimax.io/v1/get_voice", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ voice_type: "all" }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => null)) as MinimaxVoiceResponse | null;
    if (!response.ok) {
      return NextResponse.json(
        { error: payload?.base_resp?.status_msg || `MiniMax get_voice failed with status ${response.status}` },
        { status: 500 }
      );
    }

    if (payload?.base_resp?.status_code && payload.base_resp.status_code !== 0) {
      return NextResponse.json(
        { error: payload.base_resp.status_msg || "MiniMax get_voice returned an error" },
        { status: 500 }
      );
    }

    const voices = [
      ...(payload?.system_voice || []).map((voice) => ({
        voice_id: voice.voice_id,
        voice_name: voice.voice_name || voice.voice_id,
        category: "system" as const,
        description: voice.description || [],
        created_time: voice.created_time,
      })),
      ...(payload?.voice_cloning || []).map((voice) => ({
        voice_id: voice.voice_id,
        voice_name: voice.voice_id,
        category: "voice_cloning" as const,
        description: voice.description || [],
        created_time: voice.created_time,
      })),
      ...(payload?.voice_generation || []).map((voice) => ({
        voice_id: voice.voice_id,
        voice_name: voice.voice_id,
        category: "voice_generation" as const,
        description: voice.description || [],
        created_time: voice.created_time,
      })),
    ];

    return NextResponse.json(voices);
  } catch (error) {
    console.error("MiniMax voices GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
