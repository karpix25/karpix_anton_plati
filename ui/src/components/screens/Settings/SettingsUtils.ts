import { HeygenAvatarConfig, ProductMediaAsset, Settings, TtsPronunciationOverride } from "@/types";
import {
  DEFAULT_ELEVENLABS_VOICE_ID,
  DEFAULT_HEYGEN_MOTION_PROMPT,
  DEFAULT_HEYGEN_MOTION_TYPE,
  DEFAULT_MINIMAX_VOICE_ID,
  HEYGEN_MOTION_PROMPT_MAX_LENGTH,
} from "./SettingsConstants";
import {
  SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT,
  SUBTITLE_PRESET_DEFAULT_MARGIN_V,
} from "@/lib/subtitles";

export const safeTrim = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const isPendingMotionStatus = (value: unknown) =>
  ["pending", "queued", "processing", "in_progress"].includes(safeTrim(value).toLowerCase());

export const isReadyMotionStatus = (value: unknown) =>
  ["ready", "completed", "success"].includes(safeTrim(value).toLowerCase());

export function getMotionIndicator(motionLookId: unknown, motionStatus: unknown) {
  const hasMotionLook = Boolean(safeTrim(motionLookId));
  const normalizedStatus = safeTrim(motionStatus).toLowerCase();

  if (hasMotionLook && isReadyMotionStatus(normalizedStatus)) {
    return { label: "Motion Active", tone: "ready" as const };
  }

  if (isPendingMotionStatus(normalizedStatus)) {
    return { label: "Motion Pending", tone: "pending" as const };
  }

  if (normalizedStatus === "failed") {
    return { label: "Motion Failed", tone: "failed" as const };
  }

  return { label: "No Motion", tone: "none" as const };
}

export const normalizeMotionPrompt = (value: unknown) => safeTrim(value).slice(0, HEYGEN_MOTION_PROMPT_MAX_LENGTH);

export const normalizeProductMediaAssets = (value: unknown): ProductMediaAsset[] => {
  const normalizeItem = (item: unknown): ProductMediaAsset | null => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }
    const asset = item as Record<string, unknown>;
    const url = typeof asset.url === "string" ? asset.url.trim() : "";
    if (!url) {
      return null;
    }
    return {
      id: typeof asset.id === "string" && asset.id.trim() ? asset.id.trim() : url,
      url,
      name: typeof asset.name === "string" && asset.name.trim() ? asset.name.trim() : "Product Asset",
      source_type: asset.source_type === "image" ? "image" : "video",
      duration_seconds: Number(asset.duration_seconds || 0) || 0,
      created_at: typeof asset.created_at === "string" ? asset.created_at : undefined,
    };
  };

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          try {
            return normalizeItem(JSON.parse(item));
          } catch {
            return null;
          }
        }
        return normalizeItem(item);
      })
      .filter((item): item is ProductMediaAsset => Boolean(item));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeProductMediaAssets(parsed);
    } catch {
      return [];
    }
  }

  return [];
};

export const normalizeSettings = (settings: Settings): Settings => {
  const fallbackPreset = settings.subtitle_style_preset || "classic";
  const fallbackMarginV = SUBTITLE_PRESET_DEFAULT_MARGIN_V[fallbackPreset];
  const fallbackMarginPercent = SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT[fallbackPreset];
  const marginV = Number(settings.subtitle_margin_v);
  const marginPercent = Number(settings.subtitle_margin_percent);
  const silenceTrimMinSeconds = Number(settings.tts_silence_trim_min_duration_seconds);
  const silenceTrimThresholdDb = Number(settings.tts_silence_trim_threshold_db);
  const sentenceTrimMinGapSeconds = Number(settings.tts_sentence_trim_min_gap_seconds);
  const sentenceTrimKeepGapSeconds = Number(settings.tts_sentence_trim_keep_gap_seconds);
  const pauseOptimizationEnabled =
    (typeof settings.tts_silence_trim_enabled === "boolean" && settings.tts_silence_trim_enabled) ||
    (typeof settings.tts_sentence_trim_enabled === "boolean" && settings.tts_sentence_trim_enabled);
  const normalizePronunciationRule = (item: unknown): TtsPronunciationOverride | null => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const rule = item as Record<string, unknown>;
    const search = safeTrim(rule.search);
    const replace = safeTrim(rule.replace);
    if (!search || !replace) {
      return null;
    }

    return {
      search,
      replace,
      case_sensitive: Boolean(rule.case_sensitive),
      word_boundaries: typeof rule.word_boundaries === "boolean" ? rule.word_boundaries : true,
    };
  };
  const normalizedPronunciationOverrides = Array.isArray(settings.tts_pronunciation_overrides)
    ? settings.tts_pronunciation_overrides
        .map((item) => normalizePronunciationRule(item))
        .filter((item): item is TtsPronunciationOverride => Boolean(item))
    : [];

  return {
    ...settings,
    product_media_assets: normalizeProductMediaAssets(settings.product_media_assets),
    subtitle_margin_v:
      Number.isFinite(marginV) && marginV > 0 ? marginV : fallbackMarginV,
    subtitle_margin_percent:
      Number.isFinite(marginPercent) && marginPercent >= 0 ? marginPercent : fallbackMarginPercent,
    tts_silence_trim_min_duration_seconds:
      Number.isFinite(silenceTrimMinSeconds) && silenceTrimMinSeconds >= 0 ? silenceTrimMinSeconds : 0.35,
    tts_silence_trim_threshold_db:
      Number.isFinite(silenceTrimThresholdDb) ? silenceTrimThresholdDb : -45,
    tts_silence_trim_enabled: pauseOptimizationEnabled,
    tts_sentence_trim_enabled: pauseOptimizationEnabled,
    tts_sentence_trim_min_gap_seconds:
      Number.isFinite(sentenceTrimMinGapSeconds) && sentenceTrimMinGapSeconds >= 0 ? sentenceTrimMinGapSeconds : 0.3,
    tts_sentence_trim_keep_gap_seconds:
      Number.isFinite(sentenceTrimKeepGapSeconds) && sentenceTrimKeepGapSeconds >= 0 ? sentenceTrimKeepGapSeconds : 0.1,
    tts_pronunciation_overrides: normalizedPronunciationOverrides,
  };
};

export const normalizeLook = (look: Partial<HeygenAvatarConfig["looks"][number]> | null | undefined, lookIndex: number) => {
  const lookId = safeTrim(look?.look_id);
  const lookName = safeTrim(look?.look_name) || lookId;

  return {
    id: look?.id,
    look_id: lookId,
    look_name: lookName,
    preview_image_url: safeTrim(look?.preview_image_url),
    motion_look_id: safeTrim(look?.motion_look_id),
    motion_prompt: normalizeMotionPrompt(look?.motion_prompt) || DEFAULT_HEYGEN_MOTION_PROMPT,
    motion_type: safeTrim(look?.motion_type) || DEFAULT_HEYGEN_MOTION_TYPE,
    motion_status: safeTrim(look?.motion_status),
    motion_error: safeTrim(look?.motion_error),
    motion_updated_at: safeTrim(look?.motion_updated_at),
    is_active: look?.is_active ?? true,
    usage_count: typeof look?.usage_count === "number" ? look.usage_count : 0,
    sort_order: typeof look?.sort_order === "number" ? look.sort_order : lookIndex,
  };
};

export const normalizeAvatarGender = (value: unknown): "male" | "female" => {
  const normalized = safeTrim(value).toLowerCase();
  if (["male", "man", "m", "м", "муж", "мужской"].includes(normalized)) return "male";
  if (["female", "woman", "f", "ж", "жен", "женский"].includes(normalized)) return "female";
  return "female";
};

export const normalizeAvatar = (avatar: Partial<HeygenAvatarConfig> | null | undefined, avatarIndex: number): HeygenAvatarConfig => {
  const avatarId = safeTrim(avatar?.avatar_id);
  const avatarName = safeTrim(avatar?.avatar_name) || avatarId;
  const provider = avatar?.tts_provider === "elevenlabs" ? "elevenlabs" : "minimax";

  return {
    id: avatar?.id,
    avatar_id: avatarId,
    avatar_name: avatarName,
    folder_name: safeTrim(avatar?.folder_name),
    preview_image_url: safeTrim(avatar?.preview_image_url),
    gender: normalizeAvatarGender(avatar?.gender),
    tts_provider: provider,
    tts_voice_id: safeTrim(avatar?.tts_voice_id) || DEFAULT_MINIMAX_VOICE_ID,
    elevenlabs_voice_id: safeTrim(avatar?.elevenlabs_voice_id) || DEFAULT_ELEVENLABS_VOICE_ID,
    is_active: avatar?.is_active ?? true,
    usage_count: typeof avatar?.usage_count === "number" ? avatar.usage_count : 0,
    sort_order: typeof avatar?.sort_order === "number" ? avatar.sort_order : avatarIndex,
    looks: Array.isArray(avatar?.looks) ? avatar.looks.map((look, lookIndex) => normalizeLook(look, lookIndex)) : [],
  };
};

export const getAvatarConfigKey = (avatar: HeygenAvatarConfig, avatarIndex: number) => {
  if (avatar.id) return `id:${avatar.id}`;
  if (avatar.avatar_id) return `avatar:${avatar.avatar_id}`;
  return `index:${avatarIndex}`;
};

export const mergeCatalogIntoAvatarConfigs = (
  current: HeygenAvatarConfig[],
  catalog: HeygenAvatarConfig[],
  options?: { pruneMissingPersisted?: boolean }
): HeygenAvatarConfig[] => {
  const currentByAvatarId = new Map(current.map((avatar) => [avatar.avatar_id, avatar]));
  const catalogAvatarIds = new Set(catalog.map((avatar) => avatar.avatar_id).filter(Boolean));
  const merged: HeygenAvatarConfig[] = [];

  for (const currentAvatar of current) {
    const catalogAvatar = currentByAvatarId.has(currentAvatar.avatar_id)
      ? catalog.find((avatar) => avatar.avatar_id === currentAvatar.avatar_id)
      : null;

    if (!catalogAvatar) {
      if (options?.pruneMissingPersisted && currentAvatar.avatar_id && !catalogAvatarIds.has(currentAvatar.avatar_id)) {
        continue;
      }
      merged.push(currentAvatar);
      continue;
    }

    const currentLooksById = new Map((currentAvatar.looks || []).map((look) => [look.look_id, look]));
    const catalogLooksById = new Map((catalogAvatar.looks || []).map((look) => [look.look_id, look]));

    const mergedLooks = [
      ...(currentAvatar.looks || []).map((currentLook, lookIndex) => {
        const catalogLook = catalogLooksById.get(currentLook.look_id);
        return normalizeLook(
          {
            ...catalogLook,
            ...currentLook,
            look_name: currentLook.look_name || catalogLook?.look_name || currentLook.look_id,
            preview_image_url: catalogLook?.preview_image_url || currentLook.preview_image_url || "",
          },
          lookIndex
        );
      }),
      ...(catalogAvatar.looks || [])
        .filter((catalogLook) => !currentLooksById.has(catalogLook.look_id))
        .map((catalogLook, lookIndex) => normalizeLook(catalogLook, (currentAvatar.looks || []).length + lookIndex)),
    ];

    merged.push(
      normalizeAvatar(
        {
          ...catalogAvatar,
          ...currentAvatar,
          avatar_name: currentAvatar.avatar_name || catalogAvatar.avatar_name || currentAvatar.avatar_id,
          folder_name: currentAvatar.folder_name || catalogAvatar.folder_name || "",
          preview_image_url: catalogAvatar.preview_image_url || currentAvatar.preview_image_url || "",
          looks: mergedLooks,
        },
        merged.length
      )
    );
  }

  for (const catalogAvatar of catalog) {
    if (currentByAvatarId.has(catalogAvatar.avatar_id)) {
      continue;
    }
    merged.push(normalizeAvatar(catalogAvatar, merged.length));
  }

  return merged.map((avatar, avatarIndex) =>
    normalizeAvatar(
      {
        ...avatar,
        sort_order: avatarIndex,
        looks: (avatar.looks || []).map((look, lookIndex) => normalizeLook({ ...look, sort_order: lookIndex }, lookIndex)),
      },
      avatarIndex
    )
  );
};
