import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Eye, EyeOff, LoaderCircle, Plus, Shuffle, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ElevenLabsVoiceOption, HeygenAvatarConfig, MinimaxVoiceOption, ProductMediaAsset, Settings } from "@/types";
import {
  SUBTITLE_FONT_OPTIONS,
  SUBTITLE_MODE_OPTIONS,
  SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT,
  SUBTITLE_PRESET_DEFAULT_MARGIN_V,
  SUBTITLE_STYLE_PRESET_OPTIONS,
} from "@/lib/subtitles";

interface SettingsScreenProps {
  settings: Settings;
  onSave: (settings: Settings) => void;
  onDeleteProject: () => void;
  isSaving: boolean;
  isDeletingProject: boolean;
  selectedClientId: string;
  heygenAvatars: HeygenAvatarConfig[];
  heygenCatalog: HeygenAvatarConfig[];
  minimaxVoices: MinimaxVoiceOption[];
  elevenlabsVoices: ElevenLabsVoiceOption[];
  onSaveHeygenAvatars: (avatars: HeygenAvatarConfig[]) => void;
  onRefreshHeygenCatalog?: () => Promise<HeygenAvatarConfig[]>;
  isSavingHeygenAvatars: boolean;
}

const PACING_LABELS: Record<Settings["broll_pacing_profile"], { title: string; description: string; averageBrollSeconds: number }> = {
  calm: {
    title: "Спокойно",
    description: "Реже перебивки, длиннее удержание аватара, мягче монтаж.",
    averageBrollSeconds: 2.4,
  },
  balanced: {
    title: "Сбалансированно",
    description: "Профессиональный дефолт для talking-head с b-roll.",
    averageBrollSeconds: 2.0,
  },
  dynamic: {
    title: "Динамично",
    description: "Чаще перебивки, но только если текст и паузы это позволяют.",
    averageBrollSeconds: 1.7,
  },
};

const BROLL_GENERATOR_MODEL_LABELS: Record<
  Settings["broll_generator_model"],
  { title: string; description: string }
> = {
  "bytedance/v1-pro-text-to-video": {
    title: "KIE V1 Pro",
    description: "Текущий базовый генератор перебивок через KIE.",
  },
  "bytedance/seedance-1.5-pro": {
    title: "Seedance 1.5 Pro",
    description: "Новая модель KIE для генерации перебивок с API Seedance 1.5 Pro.",
  },
  "grok-imagine/text-to-video": {
    title: "Grok Imagine T2V",
    description: "KIE Text To Video: вертикальные ролики 6 секунд, mode normal, 720p.",
  },
};

const SEMANTIC_RELEVANCE_LABELS: Record<NonNullable<Settings["broll_semantic_relevance_priority"]>, { title: string; description: string }> = {
  precision: {
    title: "Максимально в тему",
    description: "Лучше меньше перебивок, но каждая должна точно иллюстрировать ключевой смысловой блок.",
  },
  balanced: {
    title: "Баланс",
    description: "Компромисс между точностью смысла и плотностью монтажа.",
  },
  dynamic: {
    title: "Больше динамики",
    description: "Можно чаще менять перебивки, если они остаются релевантными сценарию.",
  },
};

const PRODUCT_CLIP_POLICY_LABELS: Record<NonNullable<Settings["broll_product_clip_policy"]>, { title: string; description: string }> = {
  contextual: {
    title: "Только если уместно",
    description: "Product clip не должен вытеснять главные тезисы сценария.",
  },
  prefer: {
    title: "Стараться вставить",
    description: "Product clip желателен, но не ценой потери основных смысловых блоков.",
  },
  required: {
    title: "Обязательно вставить",
    description: "Хотя бы один product clip должен попасть в разметку.",
  },
};

const HEYGEN_MOTION_TYPE_OPTIONS = [
  { value: "consistent", label: "Consistent" },
  { value: "expressive", label: "Expressive" },
  { value: "consistent_gen_3", label: "Consistent Gen 3" },
  { value: "hailuo_2", label: "Hailuo 2" },
  { value: "veo2", label: "Veo 2" },
  { value: "seedance_lite", label: "Seedance Lite" },
  { value: "kling", label: "Kling" },
] as const;

const DEFAULT_ELEVENLABS_VOICE_ID = "0ArNnoIAWKlT4WweaVMY";
const ELEVENLABS_MODEL_ID = "eleven_v3";
const DEFAULT_HEYGEN_MOTION_TYPE = "consistent";
const HEYGEN_MOTION_PROMPT_MAX_LENGTH = 500;
const PENDING_MOTION_STATUSES = new Set(["pending", "queued", "processing", "in_progress"]);
const DEFAULT_HEYGEN_MOTION_PROMPT = `Лёгкое естественное дыхание, мягкие движения плеч и корпуса, деликатная живая пластика без резких жестов. Если видны руки, допустимы только аккуратные микродвижения. Если виден фон, можно оставить едва заметное фоновое движение.`;

const safeTrim = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const normalizeMotionPrompt = (value: unknown) => safeTrim(value).slice(0, HEYGEN_MOTION_PROMPT_MAX_LENGTH);
const isPendingMotionStatus = (value: unknown) => PENDING_MOTION_STATUSES.has(safeTrim(value).toLowerCase());
const normalizeProductMediaAssets = (value: unknown): ProductMediaAsset[] => {
  if (Array.isArray(value)) {
    return value.filter((item): item is ProductMediaAsset => Boolean(item && typeof item === "object"));
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is ProductMediaAsset => Boolean(item && typeof item === "object"))
        : [];
    } catch {
      return [];
    }
  }

  return [];
};

const normalizeSettings = (settings: Settings): Settings => {
  const fallbackPreset = settings.subtitle_style_preset || "classic";
  const fallbackMarginV = SUBTITLE_PRESET_DEFAULT_MARGIN_V[fallbackPreset];
  const fallbackMarginPercent = SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT[fallbackPreset];
  const marginV = Number(settings.subtitle_margin_v);
  const marginPercent = Number(settings.subtitle_margin_percent);

  return {
    ...settings,
    product_media_assets: normalizeProductMediaAssets(settings.product_media_assets),
    subtitle_margin_v:
      Number.isFinite(marginV) && marginV > 0 ? marginV : fallbackMarginV,
    subtitle_margin_percent:
      Number.isFinite(marginPercent) && marginPercent >= 0 ? marginPercent : fallbackMarginPercent,
  };
};

const normalizeLook = (look: Partial<HeygenAvatarConfig["looks"][number]> | null | undefined, lookIndex: number) => {
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

const normalizeAvatar = (avatar: Partial<HeygenAvatarConfig> | null | undefined, avatarIndex: number): HeygenAvatarConfig => {
  const avatarId = safeTrim(avatar?.avatar_id);
  const avatarName = safeTrim(avatar?.avatar_name) || avatarId;

  return {
    id: avatar?.id,
    avatar_id: avatarId,
    avatar_name: avatarName,
    folder_name: safeTrim(avatar?.folder_name),
    preview_image_url: safeTrim(avatar?.preview_image_url),
    is_active: avatar?.is_active ?? true,
    usage_count: typeof avatar?.usage_count === "number" ? avatar.usage_count : 0,
    sort_order: typeof avatar?.sort_order === "number" ? avatar.sort_order : avatarIndex,
    looks: Array.isArray(avatar?.looks) ? avatar.looks.map((look, lookIndex) => normalizeLook(look, lookIndex)) : [],
  };
};

const getAvatarConfigKey = (avatar: HeygenAvatarConfig, avatarIndex: number) => {
  if (avatar.id) return `id:${avatar.id}`;
  if (avatar.avatar_id) return `avatar:${avatar.avatar_id}`;
  return `index:${avatarIndex}`;
};

const mergeCatalogIntoAvatarConfigs = (
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
            preview_image_url: currentLook.preview_image_url || catalogLook?.preview_image_url || "",
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
          preview_image_url: currentAvatar.preview_image_url || catalogAvatar.preview_image_url || "",
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

export function SettingsScreen({
  settings,
  onSave,
  onDeleteProject,
  isSaving,
  isDeletingProject,
  selectedClientId,
  heygenAvatars,
  heygenCatalog,
  minimaxVoices,
  elevenlabsVoices,
  onSaveHeygenAvatars,
  onRefreshHeygenCatalog,
  isSavingHeygenAvatars,
}: SettingsScreenProps) {
  const [isUploadingProductVideo, setIsUploadingProductVideo] = useState(false);
  const [isRefreshingHeygenCatalog, setIsRefreshingHeygenCatalog] = useState(false);
  const [motionLookRequestKey, setMotionLookRequestKey] = useState<string | null>(null);
  const [motionPromptRequestKey, setMotionPromptRequestKey] = useState<string | null>(null);
  const [expandedAvatarPanels, setExpandedAvatarPanels] = useState<Record<string, boolean>>({});
  const [selectedLookTabs, setSelectedLookTabs] = useState<Record<string, string>>({});
  const normalizedHeygenAvatars = useMemo(
    () => heygenAvatars.map((avatar, avatarIndex) => normalizeAvatar(avatar, avatarIndex)),
    [heygenAvatars]
  );
  const normalizedCatalog = useMemo(
    () => heygenCatalog.map((avatar, avatarIndex) => normalizeAvatar(avatar, avatarIndex)),
    [heygenCatalog]
  );

  const [draftSettings, setDraftSettings] = useState<Settings>(() => normalizeSettings(settings));
  const [avatarConfigs, setAvatarConfigs] = useState<HeygenAvatarConfig[]>(
    normalizedHeygenAvatars.length > 0 ? normalizedHeygenAvatars : normalizedCatalog
  );
  const brollIntervalSeconds = Number(draftSettings.broll_interval_seconds || 3);
  const brollTimingMode = draftSettings.broll_timing_mode || "semantic_pause";
  const brollPacingProfile = draftSettings.broll_pacing_profile || "balanced";
  const brollCoveragePercent = Number(draftSettings.broll_coverage_percent || 35);
  const semanticRelevancePriority = draftSettings.broll_semantic_relevance_priority || "balanced";
  const productClipPolicy = draftSettings.broll_product_clip_policy || "contextual";
  const brollGeneratorModel = draftSettings.broll_generator_model || "bytedance/v1-pro-text-to-video";
  const pacingPreview = PACING_LABELS[brollPacingProfile];
  const semanticRelevancePreview = SEMANTIC_RELEVANCE_LABELS[semanticRelevancePriority];
  const productClipPolicyPreview = PRODUCT_CLIP_POLICY_LABELS[productClipPolicy];
  const brollGeneratorModelPreview = BROLL_GENERATOR_MODEL_LABELS[brollGeneratorModel];
  const targetDurationMinSeconds = Math.min(
    Number(draftSettings.target_duration_min_seconds || draftSettings.target_duration_seconds || 50),
    Number(draftSettings.target_duration_max_seconds || draftSettings.target_duration_seconds || 50)
  );
  const targetDurationMaxSeconds = Math.max(
    Number(draftSettings.target_duration_min_seconds || draftSettings.target_duration_seconds || 50),
    Number(draftSettings.target_duration_max_seconds || draftSettings.target_duration_seconds || 50)
  );
  const estimatedWordMin = Math.max(Math.round(targetDurationMinSeconds * 2.4 * 0.85), 20);
  const estimatedWordMax = Math.max(Math.round(targetDurationMaxSeconds * 2.4 * 1.15), estimatedWordMin);
  const ttsProvider = draftSettings.tts_provider || "minimax";
  const subtitlesEnabled = draftSettings.subtitles_enabled || false;
  const subtitleMode = draftSettings.subtitle_mode || "word_by_word";
  const subtitleStylePreset = draftSettings.subtitle_style_preset || "classic";
  const subtitleFontFamily = draftSettings.subtitle_font_family || "pt_sans";
  const subtitleFontColor = draftSettings.subtitle_font_color || "#FFFFFF";
  const subtitleOutlineColor = draftSettings.subtitle_outline_color || "#111111";
  const subtitleFontWeight = draftSettings.subtitle_font_weight || 700;
  const subtitleOutlineWidth = Number(draftSettings.subtitle_outline_width || 3);
  const subtitleMarginDefault = SUBTITLE_PRESET_DEFAULT_MARGIN_V[subtitleStylePreset] || 140;
  const subtitleMarginPercentDefault = SUBTITLE_PRESET_DEFAULT_MARGIN_PERCENT[subtitleStylePreset] || 11;
  const subtitleMarginPercent = Math.min(
    100,
    Math.max(0, Number(draftSettings.subtitle_margin_percent ?? subtitleMarginPercentDefault))
  );
  const subtitleMarginV = Math.round((subtitleMarginPercent / 100) * 1280);
  const subtitlePreviewRef = useRef<HTMLDivElement | null>(null);
  const [subtitlePreviewScale, setSubtitlePreviewScale] = useState(0.24);
  const selectedVoice = minimaxVoices.find((voice) => voice.voice_id === draftSettings.tts_voice_id);
  const selectedElevenLabsVoice = elevenlabsVoices.find(
    (voice) => voice.voice_id === (draftSettings.elevenlabs_voice_id || DEFAULT_ELEVENLABS_VOICE_ID)
  );
  const subtitleModePreview = SUBTITLE_MODE_OPTIONS[subtitleMode];
  const subtitleStylePreview = SUBTITLE_STYLE_PRESET_OPTIONS[subtitleStylePreset];
  const subtitleFontPreview = SUBTITLE_FONT_OPTIONS[subtitleFontFamily];
  const subtitlePreviewFontFamily = `"${subtitleFontPreview.family}", "DejaVu Sans", sans-serif`;

  useEffect(() => {
    setDraftSettings(normalizeSettings(settings));
  }, [settings]);

  useEffect(() => {
    setDraftSettings((prev) => {
      const nextMiniMaxVoiceId = prev.tts_voice_id || minimaxVoices[0]?.voice_id || "Russian_Engaging_Podcaster_v1";
      const nextElevenLabsVoiceId = prev.elevenlabs_voice_id || elevenlabsVoices[0]?.voice_id || DEFAULT_ELEVENLABS_VOICE_ID;

      if (nextMiniMaxVoiceId === prev.tts_voice_id && nextElevenLabsVoiceId === prev.elevenlabs_voice_id) {
        return prev;
      }

      return {
        ...prev,
        tts_voice_id: nextMiniMaxVoiceId,
        elevenlabs_voice_id: nextElevenLabsVoiceId,
      };
    });
  }, [elevenlabsVoices, minimaxVoices]);

  useEffect(() => {
    setAvatarConfigs(normalizedHeygenAvatars.length > 0 ? normalizedHeygenAvatars : normalizedCatalog);
  }, [normalizedHeygenAvatars, normalizedCatalog]);

  useEffect(() => {
    const styleId = `subtitle-preview-font-${subtitleFontFamily}`;
    if (document.getElementById(styleId)) {
      return;
    }

    const link = document.createElement("link");
    link.id = styleId;
    link.rel = "stylesheet";
    link.href = subtitleFontPreview.stylesheetUrl;
    document.head.appendChild(link);

    return () => {
      link.remove();
    };
  }, [subtitleFontFamily, subtitleFontPreview.stylesheetUrl]);

  useEffect(() => {
    const node = subtitlePreviewRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }

    const updateScale = () => {
      const height = node.clientHeight || 1;
      const scale = height / 1280;
      setSubtitlePreviewScale(Number.isFinite(scale) && scale > 0 ? scale : 0.24);
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!selectedClientId) {
      return;
    }

    const pendingLookIds = avatarConfigs
      .flatMap((avatar) => avatar.looks || [])
      .filter((look) => look.id && look.motion_look_id && isPendingMotionStatus(look.motion_status))
      .map((look) => look.id as number);

    if (pendingLookIds.length === 0) {
      return;
    }

    let cancelled = false;

    const pollMotionStatuses = async () => {
      try {
        const responses = await Promise.all(
          pendingLookIds.map(async (lookRowId) => {
            const response = await fetch(`/api/heygen/look-motion?clientId=${selectedClientId}&lookRowId=${lookRowId}`, {
              cache: "no-store",
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.ok) {
              return null;
            }
            return payload as {
              lookRowId: number;
              motionLookId?: string | null;
              motionPrompt?: string;
              motionType?: string;
              motionStatus?: string;
              motionError?: string;
            };
          })
        );

        if (cancelled) {
          return;
        }

        const updates = new Map(
          responses
            .filter((item): item is NonNullable<typeof item> => Boolean(item?.lookRowId))
            .map((item) => [item.lookRowId, item])
        );

        if (updates.size === 0) {
          return;
        }

        setAvatarConfigs((prev) =>
          prev.map((avatar) => ({
            ...avatar,
            looks: (avatar.looks || []).map((look) => {
              if (!look.id || !updates.has(look.id)) {
                return look;
              }

              const update = updates.get(look.id)!;
              return {
                ...look,
                motion_look_id: update.motionLookId ?? look.motion_look_id,
                motion_prompt: update.motionPrompt || look.motion_prompt || DEFAULT_HEYGEN_MOTION_PROMPT,
                motion_type: update.motionType || look.motion_type || DEFAULT_HEYGEN_MOTION_TYPE,
                motion_status: update.motionStatus || look.motion_status,
                motion_error: update.motionError || "",
                motion_updated_at: new Date().toISOString(),
              };
            }),
          }))
        );
      } catch (error) {
        console.error("HeyGen motion polling error:", error);
      }
    };

    pollMotionStatuses();
    const interval = window.setInterval(pollMotionStatuses, 8000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [avatarConfigs, selectedClientId]);

  const updateAvatar = (avatarIndex: number, field: keyof HeygenAvatarConfig, value: string | number | boolean) => {
    setAvatarConfigs((prev) =>
      prev.map((avatar, index) =>
        index === avatarIndex
          ? {
              ...avatar,
              [field]: value,
            }
          : avatar
      )
    );
  };

  const toggleAvatarPanel = (avatar: HeygenAvatarConfig, avatarIndex: number) => {
    const panelKey = getAvatarConfigKey(avatar, avatarIndex);
    setExpandedAvatarPanels((prev) => ({
      ...prev,
      [panelKey]: !prev[panelKey],
    }));
  };

  const updateLook = (
    avatarIndex: number,
    lookIndex: number,
    field: "look_id" | "look_name" | "preview_image_url" | "is_active",
    value: string | boolean
  ) => {
    setAvatarConfigs((prev) =>
      prev.map((avatar, index) =>
        index === avatarIndex
          ? {
              ...avatar,
              looks: (avatar.looks || []).map((look, currentLookIndex) =>
                currentLookIndex === lookIndex
                  ? {
                      ...look,
                      [field]: value,
                    }
                  : look
              ),
            }
          : avatar
      )
    );
  };

  const updateLookMotionField = (
    avatarIndex: number,
    lookIndex: number,
    field: "motion_prompt" | "motion_type",
    value: string
  ) => {
    setAvatarConfigs((prev) =>
      prev.map((avatar, index) =>
        index === avatarIndex
          ? {
              ...avatar,
              looks: (avatar.looks || []).map((look, currentLookIndex) =>
                currentLookIndex === lookIndex
                  ? {
                      ...look,
                      [field]: value,
                    }
                  : look
              ),
            }
          : avatar
      )
    );
  };

  const addAvatar = () => {
    setAvatarConfigs((prev) => {
      const next = [
        ...prev,
        {
          avatar_id: "",
          avatar_name: "",
          folder_name: "",
          is_active: true,
          sort_order: prev.length,
          looks: [],
        },
      ];
      const newAvatar = next[next.length - 1];
      const panelKey = getAvatarConfigKey(newAvatar, next.length - 1);
      setExpandedAvatarPanels((prevPanels) => ({
        ...prevPanels,
        [panelKey]: true,
      }));
      return next;
    });
  };

  const removeAvatar = (avatarIndex: number) => {
    setAvatarConfigs((prev) => {
      const next = prev
        .filter((_, index) => index !== avatarIndex)
        .map((avatar, index) => ({
          ...avatar,
          sort_order: index,
        }));
      setExpandedAvatarPanels({});
      return next;
    });
  };

  const addLook = (avatarIndex: number) => {
    setAvatarConfigs((prev) => {
      const next = prev.map((avatar, index) =>
        index === avatarIndex
          ? {
              ...avatar,
              looks: [
                ...(avatar.looks || []),
                {
                  look_id: "",
                  look_name: "",
                  preview_image_url: "",
                  is_active: true,
                  sort_order: (avatar.looks || []).length,
                },
              ],
            }
          : avatar
      );
      setSelectedLookTabs((prevTabs) => ({
        ...prevTabs,
        [String(avatarIndex)]: String((next[avatarIndex]?.looks?.length || 1) - 1),
      }));
      return next;
    });
  };

  const removeLook = (avatarIndex: number, lookIndex: number) => {
    setAvatarConfigs((prev) => {
      const next = prev.map((avatar, index) =>
        index === avatarIndex
          ? {
              ...avatar,
              looks: avatar.looks
                .filter((_, currentLookIndex) => currentLookIndex !== lookIndex)
                .map((look, currentLookIndex) => ({
                  ...look,
                  sort_order: currentLookIndex,
                })),
            }
          : avatar
      );
      const remaining = next[avatarIndex]?.looks?.length || 0;
      setSelectedLookTabs((prevTabs) => ({
        ...prevTabs,
        [String(avatarIndex)]: remaining ? String(Math.max(0, Math.min(lookIndex - 1, remaining - 1))) : "",
      }));
      return next;
    });
  };

  const handleSaveHeygen = () => {
    const sanitized = avatarConfigs
      .map((avatar, avatarIndex) => normalizeAvatar(avatar, avatarIndex))
      .map((avatar, avatarIndex) => ({
        ...avatar,
        sort_order: avatarIndex,
        looks: avatar.looks
          .map((look, lookIndex) => normalizeLook(look, lookIndex))
          .filter((look) => look.look_id && look.look_name),
      }))
      .filter((avatar) => avatar.avatar_id && avatar.avatar_name);

    onSaveHeygenAvatars(sanitized);
  };

  const handleImportFromHeygen = async () => {
    setIsRefreshingHeygenCatalog(true);
    try {
      const freshCatalog = onRefreshHeygenCatalog ? await onRefreshHeygenCatalog() : heygenCatalog;
      const sourceCatalog = freshCatalog.length > 0 ? freshCatalog : heygenCatalog;
      const normalizedSourceCatalog = sourceCatalog.map((avatar, avatarIndex) => normalizeAvatar(avatar, avatarIndex));
      setAvatarConfigs((prev) =>
        mergeCatalogIntoAvatarConfigs(prev, normalizedSourceCatalog, { pruneMissingPersisted: true })
      );
    } catch (error) {
      console.error("HeyGen catalog refresh error:", error);
      alert(error instanceof Error ? error.message : "Не удалось обновить каталог HeyGen.");
    } finally {
      setIsRefreshingHeygenCatalog(false);
    }
  };

  const handleGenerateLookMotion = async (avatarIndex: number, lookIndex: number) => {
    const avatar = avatarConfigs[avatarIndex];
    const look = avatar?.looks?.[lookIndex];
    if (!selectedClientId || !avatar?.id || !look?.id || !look.look_id) {
      alert("Сначала сохраните пул HeyGen, затем можно добавить motion к образу.");
      return;
    }

    const requestKey = `${avatar.id}-${look.id}`;
    setMotionLookRequestKey(requestKey);

    try {
      const response = await fetch("/api/heygen/look-motion", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId: Number(selectedClientId),
          lookRowId: look.id,
          prompt: normalizeMotionPrompt(look.motion_prompt) || DEFAULT_HEYGEN_MOTION_PROMPT,
          motionType: look.motion_type || DEFAULT_HEYGEN_MOTION_TYPE,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to add motion to HeyGen look");
      }

      setAvatarConfigs((prev) =>
        prev.map((avatarItem, currentAvatarIndex) =>
          currentAvatarIndex === avatarIndex
            ? {
                ...avatarItem,
                looks: (avatarItem.looks || []).map((lookItem, currentLookIndex) =>
                  currentLookIndex === lookIndex
                    ? {
                        ...lookItem,
                        motion_look_id: payload.motionLookId || "",
                        motion_prompt: payload.motionPrompt || "",
                        motion_type: payload.motionType || "",
                        motion_status: payload.motionStatus || "ready",
                        motion_error: "",
                        motion_updated_at: new Date().toISOString(),
                      }
                    : lookItem
                ),
              }
            : avatarItem
        )
      );
    } catch (error) {
      console.error("HeyGen add motion error:", error);
      const message = error instanceof Error ? error.message : "Не удалось добавить motion.";
      setAvatarConfigs((prev) =>
        prev.map((avatarItem, currentAvatarIndex) =>
          currentAvatarIndex === avatarIndex
            ? {
                ...avatarItem,
                looks: (avatarItem.looks || []).map((lookItem, currentLookIndex) =>
                  currentLookIndex === lookIndex
                    ? {
                        ...lookItem,
                        motion_status: "failed",
                        motion_error: message,
                      }
                    : lookItem
                ),
              }
            : avatarItem
        )
      );
      alert(message);
    } finally {
      setMotionLookRequestKey(null);
    }
  };

  const handleGenerateMotionPrompt = async (avatarIndex: number, lookIndex: number) => {
    const avatar = avatarConfigs[avatarIndex];
    const look = avatar?.looks?.[lookIndex];
    const previewImageUrl = look?.preview_image_url || avatar?.preview_image_url || "";
    const sourceText = (look?.motion_prompt || "").trim();

    if (!sourceText) {
      alert("Сначала напиши по-русски, какое движение ты хочешь получить.");
      return;
    }

    const requestKey = `${avatar.id || avatarIndex}-${look?.id || lookIndex}-prompt`;
    setMotionPromptRequestKey(requestKey);

    try {
      const response = await fetch("/api/heygen/look-motion-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          previewImageUrl,
          avatarName: avatar?.avatar_name || "",
          lookName: look?.look_name || "",
          sourceText,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to adapt motion prompt");
      }

      setAvatarConfigs((prev) =>
        prev.map((avatarItem, currentAvatarIndex) =>
          currentAvatarIndex === avatarIndex
            ? {
                ...avatarItem,
                looks: (avatarItem.looks || []).map((lookItem, currentLookIndex) =>
                  currentLookIndex === lookIndex
                    ? {
                        ...lookItem,
                        motion_prompt: payload.motionPrompt || lookItem.motion_prompt || DEFAULT_HEYGEN_MOTION_PROMPT,
                      }
                    : lookItem
                ),
              }
            : avatarItem
        )
      );
    } catch (error) {
      console.error("HeyGen motion prompt generation error:", error);
      alert(error instanceof Error ? error.message : "Не удалось адаптировать motion prompt.");
    } finally {
      setMotionPromptRequestKey(null);
    }
  };

  const handleProductVideoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length || !selectedClientId) return;

    setIsUploadingProductVideo(true);
    try {
      const formData = new FormData();
      formData.append("clientId", selectedClientId);
      files.forEach((file) => {
        formData.append("files", file);
      });

      const response = await fetch("/api/clients/product-video", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload product video");
      }

      const data = await response.json();
      const mergedAssets = Array.isArray(data.all_assets) ? (data.all_assets as ProductMediaAsset[]) : null;
      const uploadedAssets = Array.isArray(data.assets) ? (data.assets as ProductMediaAsset[]) : [];
      setDraftSettings((prev) => ({
        ...prev,
        product_media_assets: mergedAssets ?? [...(prev.product_media_assets || []), ...uploadedAssets],
        product_video_url: prev.product_video_url || mergedAssets?.[0]?.url || uploadedAssets[0]?.url || data.url || "",
      }));
    } catch (error) {
      console.error("Product video upload error:", error);
      alert("Не удалось загрузить product assets.");
    } finally {
      setIsUploadingProductVideo(false);
      event.target.value = "";
    }
  };

  const handleRemoveProductAsset = (assetId: string) => {
    setDraftSettings((prev) => {
      const nextAssets = (prev.product_media_assets || []).filter((asset) => asset.id !== assetId);
      const nextPrimaryUrl = prev.product_video_url && nextAssets.some((asset) => asset.url === prev.product_video_url)
        ? prev.product_video_url
        : nextAssets[0]?.url || "";

      return {
        ...prev,
        product_media_assets: nextAssets,
        product_video_url: nextPrimaryUrl,
      };
    });
  };

  const handleDeleteProject = () => {
    if (!selectedClientId || isDeletingProject) return;
    const confirmed = window.confirm(
      "Удалить проект целиком? Это удалит сценарии, темы, паттерны, настройки, HeyGen avatars и связанные очереди этого проекта."
    );
    if (!confirmed) return;
    onDeleteProject();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="rounded-xl bg-white p-8 shadow-sm">
        <div className="mb-8">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground">Настройки проекта</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Управляй продуктовым контекстом, который влияет на интеграцию бренда в сценарии.
          </p>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-5">
            <div className="space-y-4 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-4">
              <div className="space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Продукт и аудитория
                </div>
                <p className="text-sm text-muted-foreground">
                  Базовый продуктовый контекст, который используется в сценариях, product clip и брендовой интеграции.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Описание продукта
                </label>
                <textarea
                  value={draftSettings.product_info}
                  onChange={(event) => setDraftSettings((prev) => ({ ...prev, product_info: event.target.value }))}
                  rows={5}
                  className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Tone of voice
                </label>
                <textarea
                  value={draftSettings.brand_voice}
                  onChange={(event) => setDraftSettings((prev) => ({ ...prev, brand_voice: event.target.value }))}
                  rows={4}
                  className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Целевая аудитория
                </label>
                <textarea
                  value={draftSettings.target_audience}
                  onChange={(event) => setDraftSettings((prev) => ({ ...prev, target_audience: event.target.value }))}
                  rows={4}
                  className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Product keyword
                </label>
                <input
                  value={draftSettings.product_keyword}
                  onChange={(event) => setDraftSettings((prev) => ({ ...prev, product_keyword: event.target.value }))}
                  className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                  placeholder="Например, Плати по миру"
                />
                <p className="text-xs text-muted-foreground">
                  Если это слово или фраза встречается в keyword segment, вместо генерации будет использован готовый product clip.
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-white/70 bg-white p-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Product assets
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Можно загрузить несколько видео и фото. Фото автоматически конвертируются в вертикальные mp4-клипы по 4 секунды, а при product clip система случайно выберет один из ассетов.
                  </p>
                </div>

                <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-[#d6e0e8] bg-white px-4 py-3 text-sm font-medium text-foreground transition hover:bg-[#f7fafc]">
                    <input
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={handleProductVideoUpload}
                      disabled={!selectedClientId || isUploadingProductVideo}
                      multiple
                    />
                    {isUploadingProductVideo ? "Загружаю ассеты..." : "Загрузить видео и фото"}
                  </label>
                  <div className="text-xs text-muted-foreground">
                    Сейчас в пуле: {(draftSettings.product_media_assets || []).length}
                  </div>
                </div>

                {(draftSettings.product_media_assets || []).length ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {(draftSettings.product_media_assets || []).map((asset) => (
                      <div key={asset.id} className="space-y-2 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-3">
                        <video
                          src={asset.url}
                          controls
                          className="aspect-[9/16] w-full rounded-xl border border-[#e5ebf0] bg-black object-cover"
                        />
                        <div className="space-y-1">
                          <div className="truncate text-sm font-medium text-foreground">{asset.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {asset.source_type === "image" ? "Фото -> видео 4s" : "Видео файл"}
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setDraftSettings((prev) => ({
                                ...prev,
                                product_video_url: asset.url,
                              }))
                            }
                            className="rounded-xl border border-[#d6e0e8] px-3 py-2 text-xs font-medium text-foreground transition hover:bg-[#f7fafc]"
                          >
                            Сделать основным
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveProductAsset(asset.id)}
                            className="rounded-xl border border-rose-200 px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                          >
                            Удалить
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-[#d6e0e8] bg-[#fbfcfd] px-4 py-6 text-center text-xs text-muted-foreground">
                    Пул product assets пока пуст.
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Fallback product URL
                  </label>
                  <input
                    value={draftSettings.product_video_url}
                    onChange={(event) => setDraftSettings((prev) => ({ ...prev, product_video_url: event.target.value }))}
                    className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                    placeholder="/uploads/product-assets/client-1/clip.mp4"
                  />
                  <p className="text-xs text-muted-foreground">
                    Используется как запасной одиночный source, если пул ассетов пуст.
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-4">
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  TTS Provider
                </label>
                <Select
                  value={ttsProvider}
                  onValueChange={(value: Settings["tts_provider"]) => setDraftSettings((prev) => ({ ...prev, tts_provider: value }))}
                >
                  <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                    <SelectValue placeholder="Выберите провайдера озвучки" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minimax">MiniMax</SelectItem>
                    <SelectItem value="elevenlabs">ElevenLabs v3</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {ttsProvider === "minimax" ? (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Голос озвучки MiniMax
                  </label>
                  <Select
                    value={draftSettings.tts_voice_id}
                    onValueChange={(value) => setDraftSettings((prev) => ({ ...prev, tts_voice_id: value }))}
                  >
                    <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                      <SelectValue placeholder="Выберите голос озвучки" />
                    </SelectTrigger>
                    <SelectContent className="max-h-96">
                      {minimaxVoices.map((voice) => (
                        <SelectItem key={`${voice.category}-${voice.voice_id}`} value={voice.voice_id}>
                          {voice.voice_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Голос озвучки ElevenLabs
                  </label>
                  <Select
                    value={draftSettings.elevenlabs_voice_id || DEFAULT_ELEVENLABS_VOICE_ID}
                    onValueChange={(value) => setDraftSettings((prev) => ({ ...prev, elevenlabs_voice_id: value }))}
                  >
                    <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                      <SelectValue placeholder="Выберите голос озвучки" />
                    </SelectTrigger>
                    <SelectContent className="max-h-96">
                      {elevenlabsVoices.map((voice) => (
                        <SelectItem key={voice.voice_id} value={voice.voice_id}>
                          {voice.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="rounded-xl border border-white/70 bg-white px-4 py-3 text-xs leading-5 text-muted-foreground">
                <div><span className="font-semibold text-foreground">Провайдер:</span> {ttsProvider === "elevenlabs" ? "ElevenLabs v3" : "MiniMax"}</div>
                {ttsProvider === "elevenlabs" ? (
                  <>
                    <div><span className="font-semibold text-foreground">Voice ID:</span> {draftSettings.elevenlabs_voice_id || DEFAULT_ELEVENLABS_VOICE_ID}</div>
                    <div><span className="font-semibold text-foreground">Model:</span> {ELEVENLABS_MODEL_ID}</div>
                    {selectedElevenLabsVoice?.category ? (
                      <div><span className="font-semibold text-foreground">Категория:</span> {selectedElevenLabsVoice.category}</div>
                    ) : null}
                    {selectedElevenLabsVoice?.labels?.gender ? (
                      <div><span className="font-semibold text-foreground">Голос:</span> {selectedElevenLabsVoice.labels.gender}</div>
                    ) : null}
                    {selectedElevenLabsVoice?.labels?.accent ? (
                      <div><span className="font-semibold text-foreground">Акцент:</span> {selectedElevenLabsVoice.labels.accent}</div>
                    ) : null}
                    {selectedElevenLabsVoice?.description ? (
                      <div><span className="font-semibold text-foreground">Описание:</span> {selectedElevenLabsVoice.description}</div>
                    ) : null}
                  </>
                ) : (
                  <>
                    <div><span className="font-semibold text-foreground">Voice ID:</span> {draftSettings.tts_voice_id}</div>
                    <div><span className="font-semibold text-foreground">Категория:</span> {selectedVoice?.category || "system"}</div>
                    {selectedVoice?.description?.length ? (
                      <div><span className="font-semibold text-foreground">Описание:</span> {selectedVoice.description.join(" ")}</div>
                    ) : null}
                  </>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Этот провайдер используется и для ручной кнопки «Озвучить», и для фоновой генерации TTS в пайплайне.
              </p>
            </div>

            <div className="space-y-4 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Субтитры
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Вшиваются в финальный монтаж по реальным word timestamps. Можно выбрать режим показа, стиль, кириллический Google Font, цвет текста, жирность и обводку.
                  </p>
                </div>
                <label className="flex items-center gap-2 rounded-xl bg-[#f0f4f7] px-3 py-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={subtitlesEnabled}
                    onChange={(event) =>
                      setDraftSettings((prev) => ({ ...prev, subtitles_enabled: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-[#d6e0e8]"
                  />
                  Включены
                </label>
              </div>

              <div className="rounded-xl border border-white/70 bg-white px-4 py-3 text-xs leading-5 text-muted-foreground">
                <div><span className="font-semibold text-foreground">Режим:</span> {subtitleModePreview.title}</div>
                <div><span className="font-semibold text-foreground">Стиль:</span> {subtitleStylePreview.title}</div>
                <div><span className="font-semibold text-foreground">Шрифт:</span> {subtitleFontPreview.title}</div>
                <div><span className="font-semibold text-foreground">Вес:</span> {subtitleFontWeight === 700 ? "жирный" : "обычный"}</div>
                <div><span className="font-semibold text-foreground">Обводка:</span> {subtitleOutlineWidth.toFixed(1)} px</div>
                <div><span className="font-semibold text-foreground">Высота:</span> {subtitleMarginPercent}% от низа</div>
              </div>

              <div className="grid gap-4 xl:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Режим показа
                  </label>
                  <Select
                    value={subtitleMode}
                    onValueChange={(value: Settings["subtitle_mode"]) =>
                      setDraftSettings((prev) => ({ ...prev, subtitle_mode: value }))
                    }
                  >
                    <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="word_by_word">По одному слову</SelectItem>
                      <SelectItem value="phrase_block">Фразами</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">{subtitleModePreview.description}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Стиль
                  </label>
                  <Select
                    value={subtitleStylePreset}
                    onValueChange={(value: Settings["subtitle_style_preset"]) =>
                      setDraftSettings((prev) => ({ ...prev, subtitle_style_preset: value }))
                    }
                  >
                    <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="classic">Classic Outline</SelectItem>
                      <SelectItem value="impact">Impact</SelectItem>
                      <SelectItem value="soft_box">Soft Box</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">{subtitleStylePreview.description}</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Шрифт Google Fonts
                  </label>
                  <Select
                    value={subtitleFontFamily}
                    onValueChange={(value: Settings["subtitle_font_family"]) =>
                      setDraftSettings((prev) => ({ ...prev, subtitle_font_family: value }))
                    }
                  >
                    <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(SUBTITLE_FONT_OPTIONS).map(([fontKey, font]) => (
                        <SelectItem key={fontKey} value={fontKey}>
                          {font.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-5 text-muted-foreground">{subtitleFontPreview.description}</p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-3 rounded-2xl border border-white/70 bg-white p-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Цвет и обводка
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Цвет текста
                      </div>
                      <div className="flex items-center gap-3 rounded-xl bg-[#f0f4f7] px-3 py-2">
                        <input
                          type="color"
                          value={subtitleFontColor}
                          onChange={(event) =>
                            setDraftSettings((prev) => ({ ...prev, subtitle_font_color: event.target.value.toUpperCase() }))
                          }
                          className="h-8 w-10 rounded-md border-none bg-transparent"
                        />
                        <input
                          value={subtitleFontColor}
                          onChange={(event) =>
                            setDraftSettings((prev) => ({ ...prev, subtitle_font_color: event.target.value.toUpperCase() }))
                          }
                          className="w-full bg-transparent text-sm text-foreground outline-none"
                        />
                      </div>
                    </label>

                    <label className="space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Цвет обводки
                      </div>
                      <div className="flex items-center gap-3 rounded-xl bg-[#f0f4f7] px-3 py-2">
                        <input
                          type="color"
                          value={subtitleOutlineColor}
                          onChange={(event) =>
                            setDraftSettings((prev) => ({ ...prev, subtitle_outline_color: event.target.value.toUpperCase() }))
                          }
                          className="h-8 w-10 rounded-md border-none bg-transparent"
                        />
                        <input
                          value={subtitleOutlineColor}
                          onChange={(event) =>
                            setDraftSettings((prev) => ({ ...prev, subtitle_outline_color: event.target.value.toUpperCase() }))
                          }
                          className="w-full bg-transparent text-sm text-foreground outline-none"
                        />
                      </div>
                    </label>
                  </div>

                  <label className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Толщина обводки
                      </div>
                      <div className="rounded-full bg-[#f0f4f7] px-3 py-1 text-xs font-bold text-foreground">
                        {subtitleOutlineWidth.toFixed(1)} px
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={8}
                      step={0.5}
                      value={subtitleOutlineWidth}
                      onChange={(event) =>
                        setDraftSettings((prev) => ({ ...prev, subtitle_outline_width: Number(event.target.value) }))
                      }
                      className="w-full accent-primary"
                    />
                  </label>
                </div>

                <div className="space-y-3 rounded-2xl border border-white/70 bg-white p-4">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Насыщенность и превью
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Жирность
                    </label>
                    <Select
                      value={String(subtitleFontWeight)}
                      onValueChange={(value) =>
                        setDraftSettings((prev) => ({
                          ...prev,
                          subtitle_font_weight: value === "400" ? 400 : 700,
                        }))
                      }
                    >
                      <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="400">Обычный</SelectItem>
                        <SelectItem value="700">Жирный</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        Высота субтитров
                      </div>
                      <div className="rounded-full bg-[#f0f4f7] px-3 py-1 text-xs font-bold text-foreground">
                        {subtitleMarginPercent}%
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={subtitleMarginPercent}
                      onChange={(event) => {
                        const nextPercent = Number(event.target.value);
                        setDraftSettings((prev) => ({
                          ...prev,
                          subtitle_margin_percent: nextPercent,
                          subtitle_margin_v: Math.round((nextPercent / 100) * 1280),
                        }));
                      }}
                      className="w-full accent-primary"
                    />
                    <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      <span>Низ</span>
                      <span>Верх</span>
                    </div>
                  </label>

                  <div className="rounded-2xl bg-[#f0f4f7] p-4">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Превью
                    </div>
                    <div className="rounded-[1.75rem] bg-[#0f172a] p-3 shadow-inner">
                      <div
                        ref={subtitlePreviewRef}
                        className="relative mx-auto aspect-[9/16] max-h-[340px] w-full max-w-[190px] overflow-hidden rounded-[1.5rem] border border-white/10 bg-[radial-gradient(circle_at_top,#334155_0%,#111827_48%,#020617_100%)]"
                      >
                        <div
                          className="absolute left-0 top-0"
                          style={{
                            width: 720,
                            height: 1280,
                            transform: `scale(${subtitlePreviewScale})`,
                            transformOrigin: "top left",
                          }}
                        >
                          <div className="relative h-full w-full">
                            <div className="absolute left-[96px] top-[96px] space-y-3">
                              <div className="h-14 w-44 rounded-full bg-white/10" />
                              <div className="h-8 w-64 rounded-full bg-white/10" />
                            </div>
                            <div
                              className="absolute left-[42px] right-[42px]"
                              style={{ bottom: subtitleMarginV }}
                            >
                              <div className="flex items-center gap-3 pb-3 text-[20px] font-bold uppercase tracking-[0.24em] text-white/60">
                                <span className="inline-block h-4 w-4 rounded-full bg-emerald-400" />
                                Финальный кадр
                              </div>
                              <div
                                className={`mx-auto text-center uppercase leading-[1.08] tracking-wide ${
                                  subtitleStylePreset === "soft_box" ? "rounded-[28px] bg-black/45 px-14 py-10" : ""
                                }`}
                                style={{
                                  color: subtitleFontColor,
                                  fontFamily: subtitlePreviewFontFamily,
                                  fontWeight: subtitleFontWeight,
                                  WebkitTextStroke:
                                    subtitleStylePreset === "soft_box" ? undefined : `${subtitleOutlineWidth}px ${subtitleOutlineColor}`,
                                  textShadow:
                                    subtitleStylePreset === "soft_box"
                                      ? "none"
                                      : `0 0 ${Math.max(1, subtitleOutlineWidth)}px ${subtitleOutlineColor}`,
                                  fontSize:
                                    subtitleStylePreset === "impact"
                                      ? 28
                                      : subtitleStylePreset === "soft_box"
                                        ? 24
                                        : 25,
                                }}
                              >
                                {subtitleMode === "word_by_word" ? (
                                  <div className="space-y-2">
                                    <div className="opacity-45">ПУТЕШЕСТВУЙ</div>
                                    <div>СВОБОДНО</div>
                                    <div className="opacity-45">ПО МИРУ</div>
                                  </div>
                                ) : (
                                  <div>ПУТЕШЕСТВУЙ СВОБОДНО ПО МИРУ</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="absolute inset-x-0 bottom-3 text-center text-[10px] font-medium text-white/60">
                          {subtitleMode === "word_by_word"
                            ? "Слова будут появляться по отдельности"
                            : "Титры пойдут короткими фразами"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                На первом монтаже сервер подтянет выбранный Google Font с кириллицей и закеширует его. Если сеть недоступна, сборка откатится на системный кириллический шрифт.
              </div>
            </div>

            <div className="space-y-4 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Автоматика финальных роликов
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Включает контур автопроизводства итоговых роликов: сценарий, озвучка, перебивки, аватар, монтаж и выгрузка в Яндекс Диск.
                  </p>
                </div>
                <label className="flex items-center gap-2 rounded-xl bg-[#f0f4f7] px-3 py-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={draftSettings.auto_generate_final_videos}
                    onChange={(event) =>
                      setDraftSettings((prev) => ({ ...prev, auto_generate_final_videos: event.target.checked }))
                    }
                    className="h-4 w-4 rounded border-[#d6e0e8]"
                  />
                  Активен
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                <div className="rounded-xl border border-white/70 bg-white px-4 py-3 text-xs leading-5 text-muted-foreground">
                  <div>
                    <span className="font-semibold text-foreground">Сделано сегодня:</span>{" "}
                    {draftSettings.daily_final_video_count} / {draftSettings.daily_final_video_limit}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Сделано в этом месяце:</span>{" "}
                    {draftSettings.monthly_final_video_count} / {draftSettings.monthly_final_video_limit}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Статус:</span>{" "}
                    {draftSettings.auto_generate_final_videos ? "автомат активен" : "автомат выключен"}
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">Сейчас в очереди:</span>{" "}
                    {draftSettings.open_final_video_jobs}
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Лимит в день
                    </label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={draftSettings.daily_final_video_limit}
                      onChange={(event) =>
                        setDraftSettings((prev) => {
                          const nextDailyLimit = Math.max(1, Number.parseInt(event.target.value || "1", 10) || 1);
                          return {
                            ...prev,
                            daily_final_video_limit: nextDailyLimit,
                            monthly_final_video_limit: Math.max(prev.monthly_final_video_limit || nextDailyLimit, nextDailyLimit),
                          };
                        })
                      }
                      className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Лимит в месяц
                    </label>
                    <input
                      type="number"
                      min={Math.max(1, draftSettings.daily_final_video_limit || 1)}
                      step={1}
                      value={draftSettings.monthly_final_video_limit}
                      onChange={(event) =>
                        setDraftSettings((prev) => ({
                          ...prev,
                          monthly_final_video_limit: Math.max(
                            prev.daily_final_video_limit || 1,
                            Number.parseInt(event.target.value || "1", 10) || 1
                          ),
                        }))
                      }
                      className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Прогресс за день
                  </label>
                  <div className="h-11 overflow-hidden rounded-xl bg-[#f0f4f7]">
                    <div
                      className="h-full rounded-xl bg-primary/15 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((draftSettings.daily_final_video_count || 0) /
                              Math.max(1, draftSettings.daily_final_video_limit || 1)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Прогресс за месяц
                  </label>
                  <div className="h-11 overflow-hidden rounded-xl bg-[#f0f4f7]">
                    <div
                      className="h-full rounded-xl bg-primary/15 transition-all"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            ((draftSettings.daily_final_video_count || 0) /
                              Math.max(1, draftSettings.daily_final_video_limit || 1)) *
                              100
                          )
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground">
                Месячный лимит не может быть меньше дневного. Если увеличить лимит в день, месячный автоматически подстроится.
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Длина сценария
                </label>
                <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-foreground shadow-sm">
                  {targetDurationMinSeconds} - {targetDurationMaxSeconds} сек
                </div>
              </div>
              <div className="rounded-2xl bg-[#f0f4f7] p-4">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Целевой диапазон
                    </div>
                    <div className="mt-1 text-2xl font-black tracking-tight text-foreground">
                      {targetDurationMinSeconds} - {targetDurationMaxSeconds} сек
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Примерно слов
                    </div>
                    <div className="mt-1 text-sm font-bold text-foreground">
                      {estimatedWordMin} - {estimatedWordMax}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    От
                  </div>
                  <input
                    type="number"
                    min={15}
                    max={120}
                    step={5}
                    value={targetDurationMinSeconds}
                    onChange={(event) =>
                      setDraftSettings((prev) => {
                        const nextMin = Math.max(15, Math.min(120, Number(event.target.value) || 15));
                        const nextMax = Math.max(nextMin, Number(prev.target_duration_max_seconds || prev.target_duration_seconds || nextMin));
                        return {
                          ...prev,
                          target_duration_min_seconds: nextMin,
                          target_duration_max_seconds: nextMax,
                          target_duration_seconds: Math.round((nextMin + nextMax) / 2),
                        };
                      })
                    }
                    className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                  />
                </label>
                <label className="space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    До
                  </div>
                  <input
                    type="number"
                    min={15}
                    max={120}
                    step={5}
                    value={targetDurationMaxSeconds}
                    onChange={(event) =>
                      setDraftSettings((prev) => {
                        const nextMax = Math.max(targetDurationMinSeconds, Math.min(120, Number(event.target.value) || targetDurationMinSeconds));
                        const nextMin = Math.min(Number(prev.target_duration_min_seconds || prev.target_duration_seconds || nextMax), nextMax);
                        return {
                          ...prev,
                          target_duration_min_seconds: nextMin,
                          target_duration_max_seconds: nextMax,
                          target_duration_seconds: Math.round((nextMin + nextMax) / 2),
                        };
                      })
                    }
                    className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm leading-6 text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                  />
                </label>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                Генератор будет получать диапазон длительности и подбирать объём текста внутри него, а не пытаться попасть в одну фиксированную цифру.
              </p>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Логика перебивок
                </label>
                <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-foreground shadow-sm">
                  {brollTimingMode === "semantic_pause" ? "По паузам" : brollTimingMode === "coverage_percent" ? "Покрытие" : "Fixed"}
                </div>
              </div>
              <div className="rounded-2xl bg-[#f0f4f7] p-4">
                <div className="grid gap-4 xl:grid-cols-[160px_minmax(0,1fr)]">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Режим
                    </div>
                    <div className="mt-1 text-2xl font-black tracking-tight text-foreground">
                      {brollTimingMode === "semantic_pause" ? "Смысл" : brollTimingMode === "coverage_percent" ? "Покрытие" : "Fixed"}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/70 bg-white/70 p-4 text-xs leading-6 text-foreground">
                    {brollTimingMode === "semantic_pause" ? (
                      <>
                        <div><span className="font-bold">Логика:</span> LLM читает весь transcript с timestamps и сам выбирает смысловые блоки, которые стоит иллюстрировать.</div>
                        <div><span className="font-bold">Перебивки:</span> подбираются по теме сценария с целевым покрытием около {brollCoveragePercent.toFixed(0)}% ролика.</div>
                        <div><span className="font-bold">Приоритет:</span> {semanticRelevancePreview.title}. Product clip policy: {productClipPolicyPreview.title.toLowerCase()}.</div>
                      </>
                    ) : brollTimingMode === "coverage_percent" ? (
                      <>
                        <div><span className="font-bold">Аватар:</span> остаётся базой, но система сама решает, где лучше уступить место перебивкам.</div>
                        <div><span className="font-bold">Перебивки:</span> подбираем окна так, чтобы b-roll занял примерно {brollCoveragePercent.toFixed(0)}% длительности ролика.</div>
                        <div><span className="font-bold">Ритм:</span> частота, длина и даже подряд идущие перебивки определяются автоматически по смыслу сценария.</div>
                      </>
                    ) : (
                      <>
                        <div><span className="font-bold">0.0 – {brollIntervalSeconds.toFixed(1)}с:</span> AI-аватар</div>
                        <div><span className="font-bold">{brollIntervalSeconds.toFixed(1)} – {(brollIntervalSeconds * 2).toFixed(1)}с:</span> video b-roll</div>
                        <div><span className="font-bold">{(brollIntervalSeconds * 2).toFixed(1)} – {(brollIntervalSeconds * 3).toFixed(1)}с:</span> AI-аватар</div>
                        <div><span className="font-bold">{(brollIntervalSeconds * 3).toFixed(1)} – {(brollIntervalSeconds * 4).toFixed(1)}с:</span> video b-roll</div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className={`grid gap-4 ${brollTimingMode === "semantic_pause" ? "xl:grid-cols-2" : ""}`}>
                <div className="space-y-2">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Режим тайминга
                  </label>
                  <Select
                    value={brollTimingMode}
                    onValueChange={(value: Settings["broll_timing_mode"]) =>
                      setDraftSettings((prev) => ({ ...prev, broll_timing_mode: value }))
                    }
                  >
                    <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="semantic_pause">По паузам и смыслу</SelectItem>
                      <SelectItem value="coverage_percent">По проценту покрытия</SelectItem>
                      <SelectItem value="fixed">Фиксированный интервал</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {brollTimingMode !== "fixed" ? (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {brollTimingMode === "semantic_pause" ? "Ритм монтажа" : "Профиль темпа"}
                    </label>
                    <Select
                      value={brollPacingProfile}
                      onValueChange={(value: Settings["broll_pacing_profile"]) =>
                        setDraftSettings((prev) => ({ ...prev, broll_pacing_profile: value }))
                      }
                    >
                      <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="calm">Спокойно</SelectItem>
                        <SelectItem value="balanced">Сбалансированно</SelectItem>
                        <SelectItem value="dynamic">Динамично</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
              </div>
              <div className="rounded-xl border border-white/70 bg-white px-4 py-3 text-xs leading-5 text-muted-foreground">
                {brollTimingMode === "semantic_pause" ? (
                  <>
                    <div><span className="font-semibold text-foreground">Профиль:</span> {pacingPreview.title}</div>
                    <div><span className="font-semibold text-foreground">Приоритет точности:</span> {semanticRelevancePreview.title}</div>
                    <div><span className="font-semibold text-foreground">Product clip:</span> {productClipPolicyPreview.title}</div>
                    <div><span className="font-semibold text-foreground">Как работает:</span> модель смотрит на весь script и timestamps, сама раскладывает смысловые блоки и предлагает тайминги, а код только валидирует окна монтажа.</div>
                  </>
                ) : brollTimingMode === "coverage_percent" ? (
                  <>
                    <div><span className="font-semibold text-foreground">Профиль:</span> {pacingPreview.title}</div>
                    <div><span className="font-semibold text-foreground">Цель покрытия:</span> примерно {brollCoveragePercent.toFixed(0)}% ролика занимают перебивки.</div>
                    <div><span className="font-semibold text-foreground">Как работает:</span> система сама распределяет окна по смыслам и естественному ритму речи так, чтобы уложиться в выбранную долю b-roll без жёсткой сетки.</div>
                  </>
                ) : (
                  <>
                    <div><span className="font-semibold text-foreground">Режим:</span> фиксированная сетка перебивок.</div>
                    <div><span className="font-semibold text-foreground">Как работает:</span> система режет ролик по жёсткому интервалу без анализа пауз и концов фраз.</div>
                    <div><span className="font-semibold text-foreground">Доступные настройки:</span> для fixed-режима используется только ползунок интервала ниже.</div>
                  </>
                )}
              </div>
              {brollTimingMode === "fixed" ? (
                <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Жёсткий интервал перебивок
                  </label>
                  <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-foreground shadow-sm">
                    {brollIntervalSeconds.toFixed(1)} сек
                  </div>
                </div>
                <input
                  type="range"
                  min={2}
                  max={5}
                  step={0.1}
                  value={brollIntervalSeconds}
                  onChange={(event) =>
                    setDraftSettings((prev) => ({ ...prev, broll_interval_seconds: Number(event.target.value) }))
                  }
                  className="w-full accent-primary"
                />
                <div className="flex justify-between text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                  <span>2.0 сек</span>
                  <span>3.0 сек</span>
                  <span>5.0 сек</span>
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  В fixed-режиме это жёсткий шаг, по которому ролик режется на avatar и b-roll блоки. Минимум 2 секунды.
                </p>
                </div>
              ) : null}
              {brollTimingMode === "coverage_percent" || brollTimingMode === "semantic_pause" ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      {brollTimingMode === "semantic_pause" ? "Целевое покрытие перебивками" : "Целевое покрытие перебивками"}
                    </label>
                    <div className="rounded-full bg-white px-3 py-1 text-xs font-bold text-foreground shadow-sm">
                      {brollCoveragePercent.toFixed(0)}%
                    </div>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={100}
                    step={1}
                    value={brollCoveragePercent}
                    onChange={(event) =>
                      setDraftSettings((prev) => ({ ...prev, broll_coverage_percent: Number(event.target.value) }))
                    }
                    className="w-full accent-primary"
                  />
                  <div className="flex justify-between text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
                    <span>15%</span>
                    <span>35%</span>
                    <span>100%</span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    {brollTimingMode === "semantic_pause"
                      ? "LLM старается покрыть перебивками примерно эту долю ролика, но приоритет остаётся у смысловых блоков. При высоком покрытии перебивки могут идти подряд, если это лучше раскрывает сценарий."
                      : "Алгоритм старается занять перебивками примерно эту долю ролика. При высоком покрытии перебивки могут идти подряд, если это лучше иллюстрирует сценарий."}
                  </p>
                </div>
              ) : null}
              <div className="space-y-2">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Генератор перебивок
                </label>
                <Select
                  value={brollGeneratorModel}
                  onValueChange={(value: Settings["broll_generator_model"]) =>
                    setDraftSettings((prev) => ({ ...prev, broll_generator_model: value }))
                  }
                >
                  <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bytedance/v1-pro-text-to-video">KIE V1 Pro</SelectItem>
                    <SelectItem value="bytedance/seedance-1.5-pro">Seedance 1.5 Pro</SelectItem>
                    <SelectItem value="grok-imagine/text-to-video">Grok Imagine T2V</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">{brollGeneratorModelPreview.description}</p>
              </div>
              {brollTimingMode === "semantic_pause" ? (
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Приоритет точности смысла
                    </label>
                    <Select
                      value={semanticRelevancePriority}
                      onValueChange={(value: Settings["broll_semantic_relevance_priority"]) =>
                        setDraftSettings((prev) => ({ ...prev, broll_semantic_relevance_priority: value }))
                      }
                    >
                      <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="precision">Максимально в тему</SelectItem>
                        <SelectItem value="balanced">Баланс</SelectItem>
                        <SelectItem value="dynamic">Больше динамики</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted-foreground">{semanticRelevancePreview.description}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Product clip policy
                    </label>
                    <Select
                      value={productClipPolicy}
                      onValueChange={(value: Settings["broll_product_clip_policy"]) =>
                        setDraftSettings((prev) => ({ ...prev, broll_product_clip_policy: value }))
                      }
                    >
                      <SelectTrigger className="h-12 w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-left text-sm text-foreground focus:ring-2 focus:ring-primary/10">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="contextual">Только если уместно</SelectItem>
                        <SelectItem value="prefer">Стараться вставить</SelectItem>
                        <SelectItem value="required">Обязательно вставить</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs leading-5 text-muted-foreground">{productClipPolicyPreview.description}</p>
                  </div>
                </div>
              ) : null}
            </div>

          </div>

          <div className="rounded-xl bg-[#f0f4f7] p-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Контекст</h3>
            <div className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground">
              <p>Описание продукта определяет, как сервис встраивается в текст.</p>
              <p>Tone of voice нужен, чтобы сценарии звучали в нужной манере.</p>
              <p>Целевая аудитория помогает выбирать правильные боли, примеры и обещания.</p>
              <p>TTS Provider определяет, пойдёт ли озвучка через MiniMax или ElevenLabs, а ниже задаются соответствующие параметры голоса.</p>
              <p>Субтитры вшиваются в финальный монтаж по word timestamps: можно выбрать режим показа, стиль, кириллический Google Font, цвет текста, жирность и обводку.</p>
              <p>Целевая длина задаёт желаемую длительность итогового сценария вместо жёсткой привязки к референсу.</p>
              <p>Режим тайминга определяет, режем ли мы ролик по смыслу и паузам, по целевому проценту покрытия перебивками или по жёсткому интервалу.</p>
              <p>Ритм монтажа задаёт общий характер нарезки: спокойный, сбалансированный или более динамичный.</p>
              <p>Для режима по паузам и смыслу модель сама ищет сильные смысловые блоки по всему transcript, а ты управляешь только покрытием, точностью и политикой product clip.</p>
              <p>Генератор перебивок определяет, какая именно KIE-модель будет использоваться при ручном запуске видео и в автоматическом пайплайне.</p>
              <p>В fixed-режиме работает только жёсткий интервал. В режимах по смыслу и покрытию важнее общая доля b-roll и релевантность перебивок сценарию.</p>
              <p>Product keyword и product video позволяют использовать готовый брендовый клип вместо генерации, когда продукт упоминается в сценарии.</p>
            </div>
            <Button
              className="primary-gradient mt-6 h-12 w-full rounded-xl font-bold text-white shadow-lg"
              onClick={() => onSave(draftSettings)}
              disabled={!selectedClientId || isSaving}
            >
              {isSaving ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Сохраняю...
                </>
              ) : (
                "Сохранить настройки"
              )}
            </Button>
            <Button
              variant="outline"
              className="mt-3 h-12 w-full rounded-xl border-rose-200 bg-white font-bold text-rose-600 hover:bg-rose-50"
              onClick={handleDeleteProject}
              disabled={!selectedClientId || isDeletingProject || isSaving}
            >
              {isDeletingProject ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Удаляю проект...
                </>
              ) : (
                "Удалить проект"
              )}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl bg-white p-8 shadow-sm">
        <div className="mb-8 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">HeyGen</h2>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
              Здесь задаётся пул аватаров для проекта. При создании новых видео система берёт следующий наименее использованный аватар, а внутри него случайно выбирает активный образ.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Источник импорта: реальные avatar groups и looks из вашего аккаунта HeyGen.
            </p>
          </div>
          <div className="rounded-2xl bg-[#f0f4f7] px-4 py-3 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 font-semibold text-foreground">
              <Shuffle className="h-4 w-4" />
              Ротация по проекту
            </div>
            <div className="mt-2">
              Аватары чередуются между сценариями, чтобы использовать весь пул, а не одного ведущего.
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {avatarConfigs.length > 0 ? (
            <div className="space-y-4">
              {avatarConfigs.map((avatar, avatarIndex) => {
                const avatarPanelKey = getAvatarConfigKey(avatar, avatarIndex);
                const isExpanded = expandedAvatarPanels[avatarPanelKey] ?? false;
                const activeLooksCount = avatar.looks.filter((look) => look.is_active ?? true).length;
                const selectedLookIndex = avatar.looks[Number.parseInt(selectedLookTabs[String(avatarIndex)] || "0", 10)]
                  ? Number.parseInt(selectedLookTabs[String(avatarIndex)] || "0", 10)
                  : 0;
                const selectedLook = avatar.looks[selectedLookIndex];

                return (
                  <div
                    key={`${avatar.id || "new"}-${avatarIndex}`}
                    className={`rounded-2xl border bg-[#fbfcfd] transition ${
                      avatar.is_active ? "border-primary/30 bg-[#fafdff] shadow-sm" : "border-[#e5ebf0]"
                    }`}
                  >
                    <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
                      <button
                        type="button"
                        onClick={() => toggleAvatarPanel(avatar, avatarIndex)}
                        className="flex min-w-0 flex-1 items-center justify-between gap-4 text-left transition hover:bg-white/70"
                      >
                        <div className="flex min-w-0 items-center gap-4">
                          <div
                            className={`relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border bg-white ${
                              avatar.is_active ? "border-primary shadow-[0_0_0_3px_rgba(14,165,233,0.12)]" : "border-[#e5ebf0]"
                            }`}
                          >
                            {avatar.preview_image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={avatar.preview_image_url}
                                alt={avatar.avatar_name || avatar.avatar_id}
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <div className="px-2 text-center text-[10px] text-muted-foreground">Нет preview</div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-1 py-1 text-center text-[9px] font-bold uppercase tracking-widest text-white">
                              {avatar.is_active ? "On" : "Off"}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-foreground">
                              {avatar.avatar_name || avatar.avatar_id || `Аватар ${avatarIndex + 1}`}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                              <span className="rounded-full bg-white px-2 py-1">
                                {avatar.is_active ? "Активен" : "Выключен"}
                              </span>
                              <span className="rounded-full bg-white px-2 py-1">
                                Образов: {avatar.looks.length}
                              </span>
                              <span className="rounded-full bg-white px-2 py-1">
                                Активных: {activeLooksCount}
                              </span>
                            </div>
                            {avatar.avatar_id ? (
                              <div className="mt-2 truncate text-xs text-muted-foreground">{avatar.avatar_id}</div>
                            ) : null}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                          <span>{isExpanded ? "Свернуть" : "Открыть"}</span>
                          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => updateAvatar(avatarIndex, "is_active", !(avatar.is_active ?? true))}
                        className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                          avatar.is_active
                            ? "bg-primary/10 text-primary hover:bg-primary/15"
                            : "bg-white text-muted-foreground hover:bg-[#f7fafc]"
                        }`}
                        title={avatar.is_active ? "Выключить аватара" : "Включить аватара"}
                        aria-label={avatar.is_active ? "Выключить аватара" : "Включить аватара"}
                      >
                        {avatar.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        {avatar.is_active ? "Активен" : "Скрыт"}
                      </button>
                    </div>

                    {isExpanded ? (
                      <div className="border-t border-[#e5ebf0] p-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div className="w-full xl:max-w-[180px]">
                  <div className="overflow-hidden rounded-2xl border border-[#e5ebf0] bg-white">
                    {avatar.preview_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatar.preview_image_url}
                        alt={avatar.avatar_name || avatar.avatar_id}
                        className="h-[180px] w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-[180px] items-center justify-center bg-[#f0f4f7] px-4 text-center text-xs text-muted-foreground">
                        Нет превью аватара
                      </div>
                    )}
                  </div>
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Preview
                  </div>
                </div>

                <div className="grid flex-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Название аватара
                    </label>
                    <input
                      value={avatar.avatar_name}
                      onChange={(event) => updateAvatar(avatarIndex, "avatar_name", event.target.value)}
                      className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                      placeholder="Например, Main Host"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Avatar ID
                    </label>
                    <input
                      value={avatar.avatar_id}
                      onChange={(event) => updateAvatar(avatarIndex, "avatar_id", event.target.value)}
                      className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                      placeholder="heygen_avatar_id"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Папка / группа
                    </label>
                    <input
                      value={avatar.folder_name || ""}
                      onChange={(event) => updateAvatar(avatarIndex, "folder_name", event.target.value)}
                      className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                      placeholder="Например, Immigration Hosts"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Avatar preview URL
                    </label>
                    <input
                      value={avatar.preview_image_url || ""}
                      onChange={(event) => updateAvatar(avatarIndex, "preview_image_url", event.target.value)}
                      className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                      placeholder="https://..."
                    />
                  </div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => removeAvatar(avatarIndex)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Удалить аватара
                </Button>
              </div>

              <div className="mt-5 rounded-2xl bg-white p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Образы</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      Внутри выбранного аватара один из активных образов будет выбираться случайно.
                    </div>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => addLook(avatarIndex)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Добавить образ
                  </Button>
                </div>

                {avatar.looks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[#d6e0e8] px-4 py-5 text-sm text-muted-foreground">
                      У этого аватара пока нет образов. Если оставить список пустым, будет использоваться базовый аватар без выбора look.
                    </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-2xl bg-[#f7fafc] p-3">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">
                          Выбрано <span className="font-semibold text-foreground">{selectedLookIndex + 1}</span> из{" "}
                          <span className="font-semibold text-foreground">{avatar.looks.length}</span> образов.
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Для больших пулов удобнее выбирать образ по карточке, а не листать tabs.
                        </div>
                      </div>
                      <div className="max-h-[420px] overflow-y-auto pr-1">
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                          {avatar.looks.map((look, lookIndex) => {
                            const isSelected = lookIndex === selectedLookIndex;
                            return (
                              <div
                                key={`look-card-${look.id || "new"}-${lookIndex}`}
                                className={`rounded-2xl border p-3 text-left transition ${
                                  isSelected
                                    ? "border-primary bg-white shadow-sm"
                                    : "border-[#e5ebf0] bg-white/80 hover:border-[#d6e0e8] hover:bg-white"
                                } ${look.is_active ? "ring-1 ring-primary/20" : "opacity-80"}`}
                              >
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedLookTabs((prev) => ({ ...prev, [String(avatarIndex)]: String(lookIndex) }))}
                                    className="block w-full text-left"
                                  >
                                    <div
                                      className={`overflow-hidden rounded-xl border bg-white ${
                                        look.is_active ? "border-primary shadow-[0_0_0_3px_rgba(14,165,233,0.12)]" : "border-[#e5ebf0]"
                                      }`}
                                    >
                                      {look.preview_image_url ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={look.preview_image_url}
                                          alt={look.look_name || look.look_id}
                                          className="h-[120px] w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-[120px] items-center justify-center bg-[#f0f4f7] px-3 text-center text-[11px] text-muted-foreground">
                                          Нет превью
                                        </div>
                                      )}
                                    </div>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => updateLook(avatarIndex, lookIndex, "is_active", !(look.is_active ?? true))}
                                    className={`absolute right-2 top-2 rounded-full p-2 shadow-sm transition ${
                                      look.is_active
                                        ? "bg-white text-primary hover:bg-primary/10"
                                        : "bg-black/55 text-white hover:bg-black/70"
                                    }`}
                                    title={look.is_active ? "Выключить образ" : "Включить образ"}
                                    aria-label={look.is_active ? "Выключить образ" : "Включить образ"}
                                  >
                                    {look.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                                  </button>
                                  <div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-black/60 to-transparent px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white">
                                    {look.is_active ? "Активен" : "Выключен"}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setSelectedLookTabs((prev) => ({ ...prev, [String(avatarIndex)]: String(lookIndex) }))}
                                  className="mt-3 block w-full text-left"
                                >
                                  <div className="line-clamp-2 text-sm font-semibold text-foreground">
                                    {look.look_name || look.look_id || `Look ${lookIndex + 1}`}
                                  </div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">{look.look_id}</div>
                                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                    <span className={`rounded-full px-2 py-1 ${look.is_active ? "bg-primary/10 text-primary" : "bg-[#f7fafc]"}`}>
                                      {look.is_active ? "Активен" : "Выключен"}
                                    </span>
                                    {look.motion_look_id ? (
                                      <span className="rounded-full bg-[#f7fafc] px-2 py-1">
                                        {look.motion_status === "ready" ? "Motion ready" : "Motion pending"}
                                      </span>
                                    ) : null}
                                  </div>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    {selectedLook ? (
                      <div className="rounded-xl border border-[#edf2f6] bg-[#fbfcfd] p-4">
                          <div className="grid gap-3 md:grid-cols-[120px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto]">
                      <div className="overflow-hidden rounded-xl border border-[#e5ebf0] bg-white">
                        {selectedLook.preview_image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={selectedLook.preview_image_url}
                            alt={selectedLook.look_name || selectedLook.look_id}
                            className="h-[96px] w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-[96px] items-center justify-center bg-[#f0f4f7] px-3 text-center text-[11px] text-muted-foreground">
                            Нет превью
                          </div>
                        )}
                      </div>
                      <input
                        value={selectedLook.look_name}
                        onChange={(event) => updateLook(avatarIndex, selectedLookIndex, "look_name", event.target.value)}
                        className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                        placeholder="Название образа"
                      />
                      <input
                        value={selectedLook.look_id}
                        onChange={(event) => updateLook(avatarIndex, selectedLookIndex, "look_id", event.target.value)}
                        className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                        placeholder="look_id"
                      />
                      <input
                        value={selectedLook.preview_image_url || ""}
                        onChange={(event) => updateLook(avatarIndex, selectedLookIndex, "preview_image_url", event.target.value)}
                        className="w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                        placeholder="Preview image URL"
                      />
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 rounded-xl bg-[#f0f4f7] px-3 py-3 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={selectedLook.is_active ?? true}
                            onChange={(event) => updateLook(avatarIndex, selectedLookIndex, "is_active", event.target.checked)}
                            className="h-4 w-4 rounded border-[#d6e0e8]"
                          />
                          Активен
                        </label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:text-destructive"
                          onClick={() => removeLook(avatarIndex, selectedLookIndex)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                          </div>

                          <div className="mt-3 flex flex-col gap-3 rounded-xl bg-white px-4 py-3 md:flex-row md:items-center md:justify-between">
                            <div className="space-y-1 text-xs text-muted-foreground">
                              <div className="font-semibold text-foreground">
                                {selectedLook.motion_look_id
                                  ? selectedLook.motion_status === "ready"
                                    ? "Motion-версия готова"
                                    : isPendingMotionStatus(selectedLook.motion_status)
                                      ? "Motion-версия создаётся"
                                      : selectedLook.motion_status === "failed"
                                        ? "Motion-версия не создалась"
                                    : "Motion-версия создаётся"
                                  : "Motion пока не добавлен"}
                              </div>
                              <div>
                                {selectedLook.motion_look_id
                                  ? `motion_look_id: ${selectedLook.motion_look_id}`
                                  : "После Add Motion этот образ будет рендериться через motion-версию look-а."}
                              </div>
                              {selectedLook.motion_type ? <div>Тип motion: {selectedLook.motion_type}</div> : null}
                              {selectedLook.motion_status ? <div>Статус: {selectedLook.motion_status}</div> : null}
                              {selectedLook.motion_error ? <div className="text-destructive">{selectedLook.motion_error}</div> : null}
                              {!selectedLook.id || !avatar.id ? (
                                <div>Сначала сохраните пул HeyGen, затем можно запускать Add Motion.</div>
                              ) : null}
                            </div>
                            <div className="flex w-full max-w-[360px] flex-col gap-3">
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                  Motion Type
                                </label>
                                <Select
                                  value={selectedLook.motion_type || DEFAULT_HEYGEN_MOTION_TYPE}
                                  onValueChange={(value) => updateLookMotionField(avatarIndex, selectedLookIndex, "motion_type", value)}
                                >
                                  <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-left">
                                    <SelectValue placeholder="Выберите тип motion" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {HEYGEN_MOTION_TYPE_OPTIONS.map((option) => (
                                      <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                                  Описание motion
                                </label>
                                <textarea
                                  value={selectedLook.motion_prompt || DEFAULT_HEYGEN_MOTION_PROMPT}
                                  onChange={(event) =>
                                    updateLookMotionField(
                                      avatarIndex,
                                      selectedLookIndex,
                                      "motion_prompt",
                                      event.target.value.slice(0, HEYGEN_MOTION_PROMPT_MAX_LENGTH)
                                    )
                                  }
                                  maxLength={HEYGEN_MOTION_PROMPT_MAX_LENGTH}
                                  className="min-h-[128px] w-full rounded-xl border-none bg-[#f0f4f7] px-4 py-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/10"
                                  placeholder="Напиши по-русски, какое движение нужно. Например: лёгкое дыхание, мягкие движения плеч, немного живости в руках, без резких жестов."
                                />
                                <div className="text-right text-[11px] text-muted-foreground">
                                  {(selectedLook.motion_prompt || DEFAULT_HEYGEN_MOTION_PROMPT).length}/{HEYGEN_MOTION_PROMPT_MAX_LENGTH}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => handleGenerateMotionPrompt(avatarIndex, selectedLookIndex)}
                                disabled={motionPromptRequestKey === `${avatar.id || avatarIndex}-${selectedLook.id || selectedLookIndex}-prompt`}
                              >
                                {motionPromptRequestKey === `${avatar.id || avatarIndex}-${selectedLook.id || selectedLookIndex}-prompt` ? (
                                  <>
                                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                    Адаптирую prompt...
                                  </>
                                ) : (
                                  "Адаптировать"
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => handleGenerateLookMotion(avatarIndex, selectedLookIndex)}
                                disabled={
                                  !selectedClientId ||
                                  !avatar.id ||
                                  !selectedLook.id ||
                                  !selectedLook.look_id ||
                                  motionLookRequestKey === `${avatar.id}-${selectedLook.id}` ||
                                  isPendingMotionStatus(selectedLook.motion_status)
                                }
                              >
                                {motionLookRequestKey === `${avatar.id}-${selectedLook.id}` || isPendingMotionStatus(selectedLook.motion_status) ? (
                                  <>
                                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                                    Motion создаётся...
                                  </>
                                ) : (
                                  <>
                                    <Wand2 className="mr-2 h-4 w-4" />
                                    {selectedLook.motion_look_id ? "Обновить motion" : "Add Motion"}
                                  </>
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                    ) : null}
                  </div>
                )}
              </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="flex flex-col gap-3 xl:flex-row">
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={handleImportFromHeygen}
              disabled={isRefreshingHeygenCatalog || (!heygenCatalog.length && !onRefreshHeygenCatalog)}
            >
              {isRefreshingHeygenCatalog ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Обновляю каталог HeyGen...
                </>
              ) : (
                <>
                  <Shuffle className="mr-2 h-4 w-4" />
                  Обновить из HeyGen
                </>
              )}
            </Button>
            <Button type="button" variant="outline" size="lg" onClick={addAvatar}>
              <Plus className="mr-2 h-4 w-4" />
              Добавить аватара
            </Button>
            <Button
              type="button"
              className="primary-gradient h-12 rounded-xl px-6 font-bold text-white shadow-lg"
              onClick={handleSaveHeygen}
              disabled={!selectedClientId || isSavingHeygenAvatars}
            >
              {isSavingHeygenAvatars ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Сохраняю пул аватаров...
                </>
              ) : (
                "Сохранить настройки HeyGen"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
