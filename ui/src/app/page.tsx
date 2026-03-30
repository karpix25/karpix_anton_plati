"use client";

import React, { startTransition, useEffect, useMemo, useState } from "react";
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
import { Screen, Reference, TopicCard, StructureCard, Settings } from "@/types";
import { navItems } from "@/lib/constants";

export default function CuratorDashboard() {
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
    saveHeygenAvatarsMutation,
    batchRewriteMutation,
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
    () => ({
      product_info: selectedClient?.product_info || "",
      brand_voice: selectedClient?.brand_voice || "",
      target_audience: selectedClient?.target_audience || "",
      target_duration_seconds: selectedClient?.target_duration_seconds || 50,
      broll_interval_seconds: selectedClient?.broll_interval_seconds || 3,
      broll_timing_mode: selectedClient?.broll_timing_mode || "semantic_pause",
      broll_pacing_profile: selectedClient?.broll_pacing_profile || "balanced",
      broll_pause_threshold_seconds: selectedClient?.broll_pause_threshold_seconds || 0.45,
      broll_coverage_percent: selectedClient?.broll_coverage_percent || 35,
      broll_semantic_relevance_priority: selectedClient?.broll_semantic_relevance_priority || "balanced",
      broll_product_clip_policy: selectedClient?.broll_product_clip_policy || "contextual",
      broll_generator_model: selectedClient?.broll_generator_model || "bytedance/v1-pro-text-to-video",
      product_media_assets: selectedClient?.product_media_assets || [],
      product_keyword: selectedClient?.product_keyword || "",
      product_video_url: selectedClient?.product_video_url || "",
      tts_provider: selectedClient?.tts_provider || "minimax",
      tts_voice_id: selectedClient?.tts_voice_id || "Russian_Engaging_Podcaster_v1",
      elevenlabs_voice_id: selectedClient?.elevenlabs_voice_id || "0ArNnoIAWKlT4WweaVMY",
      auto_generate_final_videos: selectedClient?.auto_generate_final_videos || false,
      monthly_final_video_limit: selectedClient?.monthly_final_video_limit || 30,
      monthly_final_video_count: selectedClient?.monthly_final_video_count || 0,
      open_final_video_jobs: selectedClient?.open_final_video_jobs || 0,
    }),
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

  // --- Handlers ---
  const handleSaveSettings = (settings: Settings) => {
    saveSettingsMutation.mutate(settings);
  };

  const handleBatchRewrite = () => {
    batchRewriteMutation.mutate();
  };

  const handleBatchMix = () => {
    batchMixMutation.mutate({});
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

  const handleReferenceClick = (ref: Reference) => {
    setSelectedReferenceId(ref.id);
    setIsReferenceModalOpen(true);
  };

  // --- Render ---
  return (
    <main className="min-h-screen bg-[#f8fafc] font-sans text-foreground selection:bg-primary/10">
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
              batchRewritePending={batchRewriteMutation.isPending}
              batchMixPending={batchMixMutation.isPending}
              onBatchRewrite={handleBatchRewrite}
              onBatchMix={handleBatchMix}
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
              isSaving={saveSettingsMutation.isPending}
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
