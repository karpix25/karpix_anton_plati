import { NextResponse } from "next/server";

type ElevenLabsVoicePayload = {
  voices?: Array<{
    voice_id?: string;
    name?: string;
    category?: string;
    description?: string;
    preview_url?: string;
    labels?: {
      accent?: string;
      age?: string;
      description?: string;
      gender?: string;
      use_case?: string;
    };
  }>;
};

const DEFAULT_ELEVENLABS_VOICE_ID = "0ArNnoIAWKlT4WweaVMY";

export async function GET() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;

    const fallbackVoices = [
      {
        voice_id: DEFAULT_ELEVENLABS_VOICE_ID,
        name: "Elena Gromova (Default)",
        category: "professional",
        description: "Fallback voice in case of API error",
        preview_url: "",
        labels: {}
      }
    ];

    if (!apiKey || apiKey.trim() === "" || apiKey.includes("your_")) {
      console.warn("[ElevenLabs API] API Key is missing or placeholders used. Returning fallback voices.");
      return NextResponse.json(fallbackVoices);
    }

    console.log(`[ElevenLabs API] Fetching voices using key (len: ${apiKey.length})...`);

    const response = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: {
        "xi-api-key": apiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ElevenLabs API] Error fetching voices (Status: ${response.status}):`, errorText);
      
      if (response.status === 401) {
        console.error("[ElevenLabs API] CRITICAL: Invalid API Key provided.");
      }
      
      return NextResponse.json(fallbackVoices);
    }

    const payload = (await response.json().catch(() => null)) as ElevenLabsVoicePayload | null;
    const rawVoices = payload?.voices || [];
    
    console.log(`[ElevenLabs API] Successfully fetched ${rawVoices.length} voices.`);

    const voices = rawVoices
      .filter((voice) => typeof voice.voice_id === "string" && voice.voice_id.trim())
      .map((voice) => ({
        voice_id: voice.voice_id!.trim(),
        name: (voice.name || voice.voice_id || "").trim(),
        category: (voice.category || "").trim(),
        description: (voice.description || "").trim(),
        preview_url: (voice.preview_url || "").trim(),
        labels: voice.labels || {},
      }))
      .sort((a, b) => {
        if (a.voice_id === DEFAULT_ELEVENLABS_VOICE_ID) return -1;
        if (b.voice_id === DEFAULT_ELEVENLABS_VOICE_ID) return 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json(voices.length > 0 ? voices : fallbackVoices);
  } catch (error) {
    console.error("ElevenLabs voices GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal Server Error" },
      { status: 500 }
    );
  }
}
