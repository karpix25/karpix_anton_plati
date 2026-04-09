"use client";

import React, { startTransition, useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceData } from "@/hooks/useWorkspaceData";
import { Sidebar } from "@/components/Sidebar";
import { Header } from "@/components/Header";
import { DashboardScreen } from "@/components/screens/DashboardScreen";
import { LibraryScreen } from "@/components/screens/LibraryScreen";
import { ScenariosScreen } from "@/components/screens/ScenariosScreen";
import { GeneratorScreen } from "@/components/screens/GeneratorScreen";
import { SettingsScreen } from "@/components/screens/SettingsScreen";
import { GraphScreen } from "@/components/screens/GraphScreen";

import { ReferenceModal } from "@/components/ReferenceModal";
import { Screen, Reference, TopicCard, StructureCard, Settings, ProductMediaAsset } from "@/types";
import { navItems } from "@/lib/constants";

type AuthState = "loading" | "authenticated" | "unauthenticated";
type TelegramSessionUser = {
  telegramUserId: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  isAdmin: boolean;
  expiresAt: string;
};

const normalizeProductMediaAssets = (value: unknown) => {
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

export default function CuratorDashboard() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [authUser, setAuthUser] = useState<TelegramSessionUser | null>(null);
  const [authError, setAuthError] = useState("");
  const [isStartingTelegramAuth, setIsStartingTelegramAuth] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // --- Local State ---
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [scenarioFilter, setScenarioFilter] = useState<"all" | "with" | "without">("all");
  
  // Selection state for generator and modal
  const [selectedReferenceId, setSelectedReferenceId] = useState<number | null>(null);
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<TopicCard | null>(null);
  const [selectedStructure, setSelectedStructure] = useState<StructureCard | null>(null);

  // --- Data Fetching ---
  const {
    clients,
    isLoadingClients,
    references,
    scenarios,
    topicCards,
    structureCards,
    heygenAvatars,
    heygenCatalog,
    minimaxVoices,
    elevenlabsVoices,
    refreshWorkspace,
    saveSettingsMutation,
    deleteClientMutation,
    saveHeygenAvatarsMutation,
    batchMixMutation,
    singleRewriteMutation,
    referencesQuery,
    scenariosQuery,
    heygenCatalogQuery,
  } = useWorkspaceData(selectedClientId);

  const activeClientId = selectedClientId || clients[0]?.id?.toString() || "";

  // --- Derived State ---
  const selectedClient = useMemo(
    () => clients.find((c) => c.id.toString() === activeClientId),
    [clients, activeClientId]
  );

  const clientSettings = useMemo<Settings>(
    () => {
      const targetDurationSeconds = selectedClient?.target_duration_seconds || 50;
      const targetDurationMinSeconds = selectedClient?.target_duration_min_seconds || targetDurationSeconds;
      const targetDurationMaxSeconds = selectedClient?.target_duration_max_seconds || targetDurationSeconds;

      return {
      product_info: selectedClient?.product_info || "",
      brand_voice: selectedClient?.brand_voice || "",
      target_audience: selectedClient?.target_audience || "",
      target_duration_seconds: targetDurationSeconds,
      target_duration_min_seconds: Math.min(targetDurationMinSeconds, targetDurationMaxSeconds),
      target_duration_max_seconds: Math.max(targetDurationMinSeconds, targetDurationMaxSeconds),
      broll_interval_seconds: selectedClient?.broll_interval_seconds || 3,
      broll_timing_mode: selectedClient?.broll_timing_mode || "semantic_pause",
      broll_pacing_profile: selectedClient?.broll_pacing_profile || "balanced",
      broll_pause_threshold_seconds: selectedClient?.broll_pause_threshold_seconds || 0.45,
      broll_coverage_percent: selectedClient?.broll_coverage_percent || 35,
      broll_semantic_relevance_priority: selectedClient?.broll_semantic_relevance_priority || "balanced",
      broll_product_clip_policy: selectedClient?.broll_product_clip_policy || "contextual",
      broll_generator_model: selectedClient?.broll_generator_model || "bytedance/v1-pro-text-to-video",
      product_media_assets: normalizeProductMediaAssets(selectedClient?.product_media_assets),
      product_keyword: selectedClient?.product_keyword || "",
      product_video_url: selectedClient?.product_video_url || "",
      tts_provider: selectedClient?.tts_provider || "minimax",
      tts_voice_id: selectedClient?.tts_voice_id || "Russian_Engaging_Podcaster_v1",
      elevenlabs_voice_id: selectedClient?.elevenlabs_voice_id || "0ArNnoIAWKlT4WweaVMY",
      tts_silence_trim_min_duration_seconds: Number(selectedClient?.tts_silence_trim_min_duration_seconds ?? 0.35),
      tts_silence_trim_threshold_db: Number(selectedClient?.tts_silence_trim_threshold_db ?? -45),
      tts_silence_trim_enabled: selectedClient?.tts_silence_trim_enabled ?? true,
      tts_sentence_trim_enabled: selectedClient?.tts_sentence_trim_enabled ?? false,
      tts_sentence_trim_min_gap_seconds: Number(selectedClient?.tts_sentence_trim_min_gap_seconds ?? 0.3),
      subtitles_enabled: selectedClient?.subtitles_enabled || false,
      subtitle_mode: selectedClient?.subtitle_mode || "word_by_word",
      subtitle_style_preset: selectedClient?.subtitle_style_preset || "classic",
      subtitle_font_family: selectedClient?.subtitle_font_family || "pt_sans",
      subtitle_font_color: selectedClient?.subtitle_font_color || "#FFFFFF",
      subtitle_font_weight: selectedClient?.subtitle_font_weight || 700,
      subtitle_outline_color: selectedClient?.subtitle_outline_color || "#111111",
      subtitle_outline_width: selectedClient?.subtitle_outline_width || 3,
      subtitle_margin_v: selectedClient?.subtitle_margin_v || 140,
      subtitle_margin_percent: selectedClient?.subtitle_margin_percent
        ?? Math.round(((selectedClient?.subtitle_margin_v || 140) / 1280) * 100),
      auto_generate_final_videos: selectedClient?.auto_generate_final_videos || false,
      daily_final_video_limit: selectedClient?.daily_final_video_limit || 3,
      daily_final_video_count: selectedClient?.daily_final_video_count || 0,
      monthly_final_video_limit: selectedClient?.monthly_final_video_limit || 30,
      monthly_final_video_count: selectedClient?.monthly_final_video_count || 0,
      open_final_video_jobs: selectedClient?.open_final_video_jobs || 0,
      learned_rules_scenario: selectedClient?.learned_rules_scenario || "",
      learned_rules_visual: selectedClient?.learned_rules_visual || "",
      learned_rules_video: selectedClient?.learned_rules_video || "",
    }},
    [selectedClient]
  );

  const filteredReferences = useMemo(() => {
    return references.filter((ref) => {
      const matchesSearch =
        !searchQuery ||
        ref.transcript?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ref.audit_json?.atoms?.verbal_hook?.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        scenarioFilter === "all" ||
        (scenarioFilter === "with" && ref.scenario_json?.script) ||
        (scenarioFilter === "without" && !ref.scenario_json?.script);

      return matchesSearch && matchesStatus;
    });
  }, [references, searchQuery, scenarioFilter]);

  const selectedReference = useMemo(
    () => references.find((r) => r.id === selectedReferenceId) || null,
    [references, selectedReferenceId]
  );

  const currentScreenTitle = useMemo(
    () => navItems.find((item) => item.id === screen)?.label || "Precision Layer",
    [screen]
  );

  useEffect(() => {
    if (clients.length > 0 && !selectedClientId) {
      startTransition(() => {
        setSelectedClientId(clients[0].id.toString());
      });
    }
  }, [clients, selectedClientId]);

  const checkTelegramSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/telegram/session", { cache: "no-store" });
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.ok && payload?.user) {
        setAuthUser(payload.user as TelegramSessionUser);
        setAuthState("authenticated");
        return;
      }
      setAuthUser(null);
      setAuthState("unauthenticated");
    } catch (error) {
      console.error("Failed to check Telegram session:", error);
      setAuthUser(null);
      setAuthState("unauthenticated");
    }
  }, []);

  useEffect(() => {
    void checkTelegramSession();
  }, [checkTelegramSession]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const url = new URL(window.location.href);
    const error = url.searchParams.get("auth_error");
    if (!error) {
      return;
    }
    setAuthError("Не удалось завершить вход через Telegram. Попробуйте ещё раз.");
    url.searchParams.delete("auth_error");
    window.history.replaceState({}, "", url.toString());
  }, []);

  const handleStartTelegramAuth = async () => {
    setAuthError("");
    setIsStartingTelegramAuth(true);
    try {
      const returnTo =
        typeof window !== "undefined"
          ? `${window.location.pathname}${window.location.search}${window.location.hash}`
          : "/";
      const response = await fetch("/api/auth/telegram/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ returnTo }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.botUrl) {
        throw new Error(payload?.error || "Failed to initialize Telegram auth");
      }
      window.location.href = String(payload.botUrl);
    } catch (error) {
      console.error("Telegram auth start failed:", error);
      setAuthError(error instanceof Error ? error.message : "Не удалось открыть Telegram-бота.");
      setIsStartingTelegramAuth(false);
    }
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      await fetch("/api/auth/telegram/logout", { method: "POST" });
      setAuthUser(null);
      setAuthState("unauthenticated");
      setAuthError("");
    } catch (error) {
      console.error("Failed to logout Telegram session:", error);
      setAuthError("Не удалось выйти из аккаунта.");
    } finally {
      setIsLoggingOut(false);
    }
  };

  if (authState === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-6">
        <div className="rounded-2xl border border-[#dce5ec] bg-white px-8 py-7 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">Проверяю Telegram-сессию...</p>
        </div>
      </main>
    );
  }

  if (authState !== "authenticated") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f8fafc] px-6">
        <div className="w-full max-w-md space-y-5 rounded-3xl border border-[#dce5ec] bg-white p-8 shadow-sm">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold text-foreground">Вход через Telegram</h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Нажмите кнопку, перейдите в бота и подтвердите вход. Бот вернёт вас обратно в браузер.
            </p>
          </div>

          {authError ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {authError}
            </div>
          ) : null}

          <button
            type="button"
            onClick={handleStartTelegramAuth}
            disabled={isStartingTelegramAuth}
            className="w-full rounded-xl bg-[#0f172a] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0b1220] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isStartingTelegramAuth ? "Открываю Telegram..." : "Авторизоваться через Telegram"}
          </button>

          <button
            type="button"
            onClick={() => void checkTelegramSession()}
            className="w-full rounded-xl border border-[#dce5ec] px-4 py-3 text-sm font-semibold text-foreground transition hover:bg-[#f6f9fc]"
          >
            Я уже авторизовался
          </button>
        </div>
      </main>
    );
  }

  // --- Handlers ---
  const handleSaveSettings = (settings: Settings) => {
    saveSettingsMutation.mutate(settings);
  };

  const handleGenerateMix = () => {
    if (selectedTopic && selectedStructure) {
      batchMixMutation.mutate({ 
        topicId: selectedTopic.id, 
        structureId: selectedStructure.id 
      });
      alert("Генерация микса запущена! Проверьте вкладку 'Сценарии' через минуту.");
    }
  };

  const handleSingleRewrite = (id: number) => {
    singleRewriteMutation.mutate(id);
  };

  const handleDeleteProject = () => {
    if (!activeClientId) return;
    const currentId = Number(activeClientId);
    deleteClientMutation.mutate(currentId, {
      onSuccess: () => {
        const remainingClients = clients.filter((client) => client.id !== currentId);
        setSelectedClientId(remainingClients[0]?.id?.toString() || "");
        setScreen("dashboard");
      },
    });
  };

  const handleReferenceClick = (ref: Reference) => {
    setSelectedReferenceId(ref.id);
    setIsReferenceModalOpen(true);
  };

  // --- Render ---
  return (
    <main className="min-h-screen bg-[#f8fafc] font-sans text-foreground selection:bg-primary/10">
      <div className="fixed right-4 top-4 z-50 flex items-center gap-3 rounded-xl border border-[#dce5ec] bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
        <span className="text-muted-foreground">
          {authUser?.firstName || authUser?.username || `id:${authUser?.telegramUserId ?? ""}`}
        </span>
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="rounded-md border border-[#dce5ec] px-2 py-1 font-semibold text-foreground transition hover:bg-[#f6f9fc] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoggingOut ? "Выход..." : "Выйти"}
        </button>
      </div>
      <Sidebar
        selectedClientId={selectedClientId}
        setSelectedClientId={setSelectedClientId}
        clients={clients}
        isLoadingClients={isLoadingClients}
        screen={screen}
        setScreen={setScreen}
      />

      <div className="flex-1 xl:pl-64">
        <Header screenTitle={currentScreenTitle} selectedClientName={selectedClient?.name} />

        <section className="px-4 pb-20 pt-24 xl:px-8">
          {screen === "dashboard" && (
            <DashboardScreen
              selectedClient={selectedClient}
              references={references}
              scenarios={scenarios}
              topicCards={topicCards}
              generatedCount={scenarios.length}
              setScreen={setScreen}
            />
          )}

          {screen === "references" && (
            <LibraryScreen
              references={filteredReferences}
              isLoading={referencesQuery.isLoading}
              scenarioFilter={scenarioFilter}
              setScenarioFilter={setScenarioFilter}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              onRefresh={refreshWorkspace}
              onReferenceClick={handleReferenceClick}
            />
          )}

          {screen === "scenarios" && (
            <ScenariosScreen
              scenarios={scenarios}
              isLoading={scenariosQuery.isLoading}
              onRefresh={() => scenariosQuery.refetch()}
            />
          )}

          {screen === "generator" && (
            <GeneratorScreen
              topicCards={topicCards}
              structureCards={structureCards}
              selectedTopic={selectedTopic}
              setSelectedTopic={setSelectedTopic}
              selectedStructure={selectedStructure}
              setSelectedStructure={setSelectedStructure}
              isGenerating={batchMixMutation.isPending}
              onGenerate={handleGenerateMix}
              selectedClient={selectedClient}
            />
          )}

          {screen === "graph" && (
            <GraphScreen clientId={selectedClientId} />
          )}



          {screen === "settings" && (
            <SettingsScreen
              key={`${activeClientId}-${heygenAvatars.length}-${heygenCatalog.length}`}
              settings={clientSettings}
              onSave={handleSaveSettings}
              onDeleteProject={handleDeleteProject}
              isSaving={saveSettingsMutation.isPending}
              isDeletingProject={deleteClientMutation.isPending}
              selectedClientId={activeClientId}
              heygenAvatars={heygenAvatars}
              heygenCatalog={heygenCatalog}
              minimaxVoices={minimaxVoices}
              elevenlabsVoices={elevenlabsVoices}
              onSaveHeygenAvatars={(avatars) => saveHeygenAvatarsMutation.mutate(avatars)}
              onRefreshHeygenCatalog={async () => {
                const result = await heygenCatalogQuery.refetch();
                return result.data || [];
              }}
              onRefreshWorkspace={refreshWorkspace}
              isSavingHeygenAvatars={saveHeygenAvatarsMutation.isPending}
            />
          )}
        </section>

        <ReferenceModal
          isOpen={isReferenceModalOpen}
          onClose={() => setIsReferenceModalOpen(false)}
          reference={selectedReference}
          selectedClient={selectedClient}
          onRewrite={handleSingleRewrite}
          isRewriting={singleRewriteMutation.isPending}
        />
      </div>
    </main>
  );
}
