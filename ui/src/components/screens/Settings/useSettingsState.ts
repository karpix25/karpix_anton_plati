import { useState, useEffect, useRef, ChangeEvent, useMemo } from "react";
import { toast } from "sonner";
import { HeygenAvatarConfig, ProductMediaAsset, Settings, Voice } from "@/types";
import {
  DEFAULT_HEYGEN_MOTION_PROMPT,
  DEFAULT_HEYGEN_MOTION_TYPE,
  DEFAULT_MINIMAX_VOICE_ID,
  DEFAULT_ELEVENLABS_VOICE_ID,
} from "./SettingsConstants";
import {
  getAvatarConfigKey,
  mergeCatalogIntoAvatarConfigs,
  isPendingMotionStatus,
  normalizeAvatar,
  normalizeLook,
  normalizeMotionPrompt,
  normalizeSettings,
} from "./SettingsUtils";

interface UseSettingsStateProps {
  settings: Settings;
  avatarConfigs: HeygenAvatarConfig[];
  selectedClientId: string | null;
  minimaxVoices: Voice[];
  elevenlabsVoices: Voice[];
  heygenCatalog: HeygenAvatarConfig[];
  onSave: (settings: Settings) => void;
  onSaveHeygenAvatars: (avatars: HeygenAvatarConfig[]) => void;
  onDeleteProject: () => void;
  onRefreshHeygenCatalog?: () => Promise<HeygenAvatarConfig[]>;
  onRefreshWorkspace?: () => void;
  isSaving: boolean;
  isSavingHeygenAvatars: boolean;
  isDeletingProject: boolean;
}

export const useSettingsState = ({
  settings,
  avatarConfigs: initialAvatarConfigs,
  selectedClientId,
  minimaxVoices,
  elevenlabsVoices,
  heygenCatalog,
  onSave,
  onSaveHeygenAvatars,
  onDeleteProject,
  onRefreshHeygenCatalog,
  onRefreshWorkspace,
  isSaving,
  isSavingHeygenAvatars,
  isDeletingProject,
}: UseSettingsStateProps) => {
  const [draftSettings, setDraftSettings] = useState<Settings>(normalizeSettings(settings));
  const [avatarConfigs, setAvatarConfigs] = useState<HeygenAvatarConfig[]>(
    initialAvatarConfigs.map((a, i) => normalizeAvatar(a, i))
  );

  const [expandedAvatarPanels, setExpandedAvatarPanels] = useState<Record<string, boolean>>({});
  const [selectedLookTabs, setSelectedLookTabs] = useState<Record<string, string>>({});
  const [isRefreshingHeygenCatalog, setIsRefreshingHeygenCatalog] = useState(false);
  const [isUploadingProductVideo, setIsUploadingProductVideo] = useState(false);
  const [motionLookRequestKey, setMotionLookRequestKey] = useState<string | null>(null);
  const [motionPromptRequestKey, setMotionPromptRequestKey] = useState<string | null>(null);
  const [optimizingCategory, setOptimizingCategory] = useState<"scenario" | "visual" | "video" | null>(null);
  const [isManualFinalRunPending, setIsManualFinalRunPending] = useState(false);
  const [subtitlePreviewScale, setSubtitlePreviewScale] = useState(0.24);
  const [lastSavedSettings, setLastSavedSettings] = useState<Settings | null>(null);
  const [lastSavedAvatars, setLastSavedAvatars] = useState<HeygenAvatarConfig[] | null>(null);

  const subtitlePreviewRef = useRef<HTMLDivElement>(null);

  // Synchronize with props only if they actually represent different data
  useEffect(() => {
    const normalized = normalizeSettings(settings);
    if (JSON.stringify(normalized) !== JSON.stringify(draftSettings)) {
      setDraftSettings(normalized);
      setLastSavedSettings(normalized);
    }
  }, [settings]); // Depend only on settings, not on draftSettings stable ref

  useEffect(() => {
    const normalized = initialAvatarConfigs.map((a, i) => normalizeAvatar(a, i));
    if (JSON.stringify(normalized) !== JSON.stringify(avatarConfigs)) {
      setAvatarConfigs(normalized);
      setLastSavedAvatars(normalized);
    }
  }, [initialAvatarConfigs]);

  // Subtitle Preview Scale logic
  useEffect(() => {
    const node = subtitlePreviewRef.current;
    if (!node) return;

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

  // Debounced Settings Auto-save
  useEffect(() => {
    // Avoid circular saves: only save if draft differs from initial props AND last saved state
    const normalizedProps = normalizeSettings(settings);
    if (JSON.stringify(draftSettings) === JSON.stringify(normalizedProps)) return;
    if (JSON.stringify(draftSettings) === JSON.stringify(lastSavedSettings)) return;
    
    const timer = setTimeout(() => {
      onSave(draftSettings);
      setLastSavedSettings(draftSettings);
    }, 3000);

    return () => clearTimeout(timer);
  }, [draftSettings, onSave, lastSavedSettings, settings]);

  // Debounced HeyGen Auto-save
  useEffect(() => {
    const normalizedProps = initialAvatarConfigs.map((a, i) => normalizeAvatar(a, i));
    if (JSON.stringify(avatarConfigs) === JSON.stringify(normalizedProps)) return;
    if (JSON.stringify(avatarConfigs) === JSON.stringify(lastSavedAvatars)) return;

    const timer = setTimeout(() => {
      const sanitized = avatarConfigs
        .map((avatar, avatarIndex) => normalizeAvatar(avatar, avatarIndex))
        .map((avatar, avatarIndex) => ({
          ...avatar,
          sort_order: avatarIndex,
          looks: (avatar.looks || [])
            .map((look, lookIndex) => normalizeLook(look, lookIndex))
            .filter((look) => look.look_id && look.look_name),
        }))
        .filter((avatar) => avatar.avatar_id && avatar.avatar_name);

      onSaveHeygenAvatars(sanitized);
      setLastSavedAvatars(avatarConfigs);
    }, 5000);

    return () => clearTimeout(timer);
  }, [avatarConfigs, onSaveHeygenAvatars, lastSavedAvatars, initialAvatarConfigs]);

  // HeyGen motion polling
  useEffect(() => {
    if (!selectedClientId) return;

    const pendingLookIds = avatarConfigs
      .flatMap((avatar) => avatar.looks || [])
      .filter((look) => look.id && look.motion_look_id && isPendingMotionStatus(look.motion_status))
      .map((look) => look.id as number);

    if (pendingLookIds.length === 0) return;

    let cancelled = false;

    const pollMotionStatuses = async () => {
      try {
        const responses = await Promise.all(
          pendingLookIds.map(async (lookRowId) => {
            const response = await fetch(`/api/heygen/look-motion?clientId=${selectedClientId}&lookRowId=${lookRowId}`, {
              cache: "no-store",
            });
            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.ok) return null;
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

        if (cancelled) return;

        const updates = new Map(
          responses
            .filter((item): item is NonNullable<typeof item> => Boolean(item?.lookRowId))
            .map((item) => [item.lookRowId, item])
        );

        if (updates.size === 0) return;

        setAvatarConfigs((prev) =>
          prev.map((avatar) => ({
            ...avatar,
            looks: (avatar.looks || []).map((look) => {
              if (!look.id || !updates.has(look.id)) return look;
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

  // Handlers
  const updateAvatar = (avatarIndex: number, field: keyof HeygenAvatarConfig, value: string | number | boolean) => {
    setAvatarConfigs((prev) =>
      prev.map((avatar, index) =>
        index === avatarIndex ? { ...avatar, [field]: value } : avatar
      )
    );
  };

  const toggleAvatarPanel = (avatar: HeygenAvatarConfig, avatarIndex: number) => {
    const panelKey = getAvatarConfigKey(avatar, avatarIndex);
    setExpandedAvatarPanels((prev) => ({ ...prev, [panelKey]: !prev[panelKey] }));
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
                currentLookIndex === lookIndex ? { ...look, [field]: value } : look
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
                currentLookIndex === lookIndex ? { ...look, [field]: value } : look
              ),
            }
          : avatar
      )
    );
  };

  const addAvatar = () => {
    setAvatarConfigs((prev) => {
      const createdAvatar: HeygenAvatarConfig = {
        avatar_id: "",
        avatar_name: "",
        folder_name: "",
        gender: "female",
        tts_provider: draftSettings.tts_provider || "minimax",
        tts_voice_id: draftSettings.tts_voice_id || minimaxVoices[0]?.voice_id || DEFAULT_MINIMAX_VOICE_ID,
        elevenlabs_voice_id: draftSettings.elevenlabs_voice_id || elevenlabsVoices[0]?.voice_id || DEFAULT_ELEVENLABS_VOICE_ID,
        is_active: true,
        sort_order: prev.length,
        looks: [],
      };
      const next: HeygenAvatarConfig[] = [...prev, createdAvatar];
      const newAvatar = next[next.length - 1];
      const panelKey = getAvatarConfigKey(newAvatar, next.length - 1);
      setExpandedAvatarPanels((prevPanels) => ({ ...prevPanels, [panelKey]: true }));
      return next;
    });
  };

  const removeAvatar = (avatarIndex: number) => {
    setAvatarConfigs((prev) => {
      const next = prev
        .filter((_, index) => index !== avatarIndex)
        .map((avatar, index) => ({ ...avatar, sort_order: index }));
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
                .map((look, currentLookIndex) => ({ ...look, sort_order: currentLookIndex })),
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: Number(selectedClientId),
          lookRowId: look.id,
          prompt: normalizeMotionPrompt(look.motion_prompt) || DEFAULT_HEYGEN_MOTION_PROMPT,
          motionType: look.motion_type || DEFAULT_HEYGEN_MOTION_TYPE,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Failed to add motion to HeyGen look");

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
                    ? { ...lookItem, motion_status: "failed", motion_error: message }
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          previewImageUrl,
          avatarName: avatar?.avatar_name || "",
          lookName: look?.look_name || "",
          sourceText,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Failed to adapt motion prompt");

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
      files.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/clients/product-video", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error("Failed to upload product video");

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

      return { ...prev, product_media_assets: nextAssets, product_video_url: nextPrimaryUrl };
    });
  };

  const handleDeleteProject = () => {
    if (!confirmedDelete()) return;
    onDeleteProject();
  };

  const confirmedDelete = () => {
    if (!selectedClientId || isDeletingProject) return false;
    return window.confirm(
      "Удалить проект целиком? Это удалит сценарии, темы, паттерны, настройки, HeyGen avatars и связанные очереди этого проекта."
    );
  };

  const handleOptimizePrompts = async (category: "scenario" | "visual" | "video") => {
    if (!selectedClientId) return;
    try {
      setOptimizingCategory(category);
      const response = await fetch('/api/clients/optimize-prompts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, category })
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to optimize prompts");
      }
      alert("Правила успешно обновлены");
      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (e) {
      console.error(e);
      alert(`Ошибка: ${e instanceof Error ? e.message : "Неизвестная ошибка"}`);
    } finally {
      setOptimizingCategory(null);
    }
  };

  const handleRollbackPrompt = async (category: "scenario" | "visual" | "video", historyId?: number) => {
    if (!selectedClientId) return;
    
    try {
      setOptimizingCategory(category);
      
      let targetHistoryId = historyId;
      
      if (!targetHistoryId) {
        const histRes = await fetch(`/api/clients/prompt-history?clientId=${selectedClientId}&category=${category}`);
        if (!histRes.ok) throw new Error("Не удалось загрузить историю промптов");
        
        const histData = await histRes.json();
        if (!histData.history || histData.history.length === 0) {
          alert("Нет сохраненной истории для отката.");
          return;
        }
        targetHistoryId = histData.history[0].id;
      }
      
      if (!window.confirm("Откатить правила на выбранную версию? Текущие правила сохранятся в историю.")) {
        return;
      }

      const rbRes = await fetch('/api/clients/prompt-history', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClientId, category, historyId: targetHistoryId })
      });
      
      if (!rbRes.ok) {
        const errorData = await rbRes.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Не удалось откатить промпт");
      }
      
      alert("Правила успешно восстановлены из истории.");
      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (e) {
      console.error("Rollback error:", e);
      alert(`Ошибка: ${e instanceof Error ? e.message : "Неизвестная ошибка"}`);
    } finally {
      setOptimizingCategory(null);
    }
  };

  const handleManualFinalAutomationRun = async () => {
    if (!selectedClientId || isManualFinalRunPending) return;

    try {
      setIsManualFinalRunPending(true);

      const response = await fetch("/api/automation/final-videos/manual-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: Number(selectedClientId) }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Не удалось запустить ручной прогон автоматики.");
      }

      const queuedCount = Number(payload?.queuedCount || 0);
      const requestedBatchSize = Number(payload?.requestedBatchSize || 0);
      const remainingMonthlyAfter = Number(payload?.remainingMonthlyAfter || 0);

      setDraftSettings((prev) => ({
        ...prev,
        open_final_video_jobs: Math.max(0, Number(prev.open_final_video_jobs || 0) + queuedCount),
      }));

      if (queuedCount > 0) {
        alert(
          `Ручной запуск выполнен: в очередь добавлено ${queuedCount} задач (пакет ${requestedBatchSize}). ` +
            `Остаток месячного лимита по запросам: ${remainingMonthlyAfter}.`
        );
      } else {
        alert("Ручной запуск не добавил задач: месячный лимит уже исчерпан.");
      }

      if (onRefreshWorkspace) onRefreshWorkspace();
    } catch (error) {
      console.error("Manual final automation run error:", error);
      alert(error instanceof Error ? error.message : "Не удалось запустить ручной прогон автоматики.");
    } finally {
      setIsManualFinalRunPending(false);
    }
  };

  const handleSaveSettings = () => {
    onSave(draftSettings);
  };

  return {
    draftSettings,
    setDraftSettings,
    avatarConfigs,
    setAvatarConfigs,
    expandedAvatarPanels,
    selectedLookTabs,
    setSelectedLookTabs,
    isRefreshingHeygenCatalog,
    isUploadingProductVideo,
    motionLookRequestKey,
    motionPromptRequestKey,
    optimizingCategory,
    isManualFinalRunPending,
    subtitlePreviewScale,
    subtitlePreviewRef,
    updateAvatar,
    toggleAvatarPanel,
    updateLook,
    updateLookMotionField,
    addAvatar,
    removeAvatar,
    addLook,
    removeLook,
    handleSaveHeygen,
    handleImportFromHeygen,
    handleGenerateLookMotion,
    handleGenerateMotionPrompt,
    handleProductVideoUpload,
    handleRemoveProductAsset,
    handleDeleteProject,
    handleOptimizePrompts,
    handleRollbackPrompt,
    handleManualFinalAutomationRun,
    handleSaveSettings,
  };
};
