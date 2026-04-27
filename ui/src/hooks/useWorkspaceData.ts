import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Client, ElevenLabsVoiceOption, Reference, Scenario, TopicCard, StructureCard, Settings, HeygenAvatarConfig, MinimaxVoiceOption, PaginatedResponse } from "@/types";

const API_BASE = "/api";
const SCENARIO_POLL_WINDOW_MS = 90_000;
const SCENARIO_POLL_INTERVAL_MS = 4_000;
const EMPTY_COST_STATS = {
  totalPrompts: 0,
  totalHeygenDuration: 0,
  totalCostUsd: 0,
};

const normalizeProductMediaAssets = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }

      const asset = item as Record<string, unknown>;
      const url = typeof asset.url === "string" ? asset.url.trim() : "";
      if (!url) {
        return null;
      }

      return {
        id: typeof asset.id === "string" ? asset.id.trim() : url,
        url,
        name: typeof asset.name === "string" ? asset.name.trim() : "Product Asset",
        source_type: asset.source_type === "image" ? "image" : "video",
        duration_seconds: Number(asset.duration_seconds || 0) || 0,
        created_at: typeof asset.created_at === "string" ? asset.created_at : null,
      };
    })
    .filter(Boolean);
};

export function useWorkspaceData(selectedClientId: string) {
  const queryClient = useQueryClient();
  const [scenarioPolling, setScenarioPolling] = useState<{ clientId: string; deadline: number; baselineCount: number } | null>(null);

  // Pagination & Filter State
  const [scenarioPage, setScenarioPage] = useState(0);
  const [scenarioPageSize, setScenarioPageSize] = useState(20);
  const [scenarioSearch, setScenarioSearch] = useState("");
  
  const [referencePage, setReferencePage] = useState(0);
  const [referencePageSize, setReferencePageSize] = useState(20);
  const [referenceSearch, setReferenceSearch] = useState("");
  const [referenceStatusFilter, setReferenceStatusFilter] = useState<"all" | "with" | "without">("all");

  const startScenarioPolling = () => {
    const currentScenariosData = queryClient.getQueryData<PaginatedResponse<Scenario>>(["scenarios", selectedClientId, scenarioPage, scenarioPageSize]);
    const currentCount = currentScenariosData?.data?.length || 0;
    
    setScenarioPolling({
      clientId: selectedClientId,
      deadline: Date.now() + SCENARIO_POLL_WINDOW_MS,
      baselineCount: currentCount,
    });
    queryClient.invalidateQueries({ queryKey: ["scenarios", selectedClientId] });
  };

  const clientsQuery = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/clients`);
      return data;
    },
    staleTime: 60000, // 1 minute
  });

  const referencesQuery = useQuery<PaginatedResponse<Reference>>({
    queryKey: ["references", selectedClientId, referencePage, referencePageSize, referenceSearch, referenceStatusFilter],
    queryFn: async () => {
      if (!selectedClientId) return { data: [], totalCount: 0 };
      const { data } = await axios.get(`${API_BASE}/references`, {
        params: {
          clientId: selectedClientId,
          limit: referencePageSize,
          offset: referencePage * referencePageSize,
          q: referenceSearch.trim() || undefined,
          filter: referenceStatusFilter
        }
      });
      return data;
    },
    enabled: !!selectedClientId,
    staleTime: 30000,
  });

  const scenariosQuery = useQuery<PaginatedResponse<Scenario>>({
    queryKey: ["scenarios", selectedClientId, scenarioPage, scenarioPageSize, scenarioSearch],
    queryFn: async () => {
      if (!selectedClientId) return { data: [], totalCount: 0 };
      const { data } = await axios.get(`${API_BASE}/scenarios`, {
        params: {
          clientId: selectedClientId,
          limit: scenarioPageSize,
          offset: scenarioPage * scenarioPageSize,
          q: scenarioSearch.trim() || undefined
        }
      });
      return data;
    },
    enabled: !!selectedClientId,
    refetchInterval: () => {
      if (!scenarioPolling || scenarioPolling.clientId !== selectedClientId) return false;
      const currentCount = scenariosQuery.data?.data?.length || 0;
      if (currentCount > scenarioPolling.baselineCount) return false;
      return Date.now() < scenarioPolling.deadline ? SCENARIO_POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
    staleTime: 20000,
  });

  const topicCardsQuery = useQuery<TopicCard[]>({
    queryKey: ["topic-cards", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/topic-cards?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
    staleTime: 60000,
  });

  const structureCardsQuery = useQuery<StructureCard[]>({
    queryKey: ["structure-cards", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/structure-cards?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
    staleTime: 60000,
  });

  const heygenAvatarsQuery = useQuery<HeygenAvatarConfig[]>({
    queryKey: ["heygen-avatars", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/heygen/avatars?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
    staleTime: 60000,
  });

  const heygenCatalogQuery = useQuery<HeygenAvatarConfig[]>({
    queryKey: ["heygen-catalog"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/heygen/catalog`);
      return data;
    },
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  const minimaxVoicesQuery = useQuery<MinimaxVoiceOption[]>({
    queryKey: ["minimax-voices"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/minimax/voices`);
      return data;
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const elevenlabsVoicesQuery = useQuery<ElevenLabsVoiceOption[]>({
    queryKey: ["elevenlabs-voices"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/elevenlabs/voices`);
      return data;
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const costStatsQuery = useQuery<{
    totalPrompts: number;
    totalHeygenDuration: number;
    totalCostUsd: number;
  }>({
    queryKey: ["reports-costs", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return EMPTY_COST_STATS;
      const { data } = await axios.get(`${API_BASE}/reports/costs`, {
        params: { clientId: selectedClientId },
      });
      return {
        totalPrompts: Number(data?.totalPrompts || 0),
        totalHeygenDuration: Number(data?.totalHeygenDuration || 0),
        totalCostUsd: Number(data?.totalCostUsd || 0),
      };
    },
    enabled: !!selectedClientId,
    staleTime: 60_000,
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Settings) => {
      await axios.put(`${API_BASE}/clients`, {
        id: Number(selectedClientId),
        ...settings,
        product_media_assets: normalizeProductMediaAssets(settings.product_media_assets),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (clientId: number) => {
      await axios.delete(`${API_BASE}/clients?id=${clientId}`);
    },
    onSuccess: (_, clientId) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.removeQueries({ queryKey: ["references", String(clientId)] });
      queryClient.removeQueries({ queryKey: ["scenarios", String(clientId)] });
      queryClient.removeQueries({ queryKey: ["topic-cards", String(clientId)] });
      queryClient.removeQueries({ queryKey: ["structure-cards", String(clientId)] });
      queryClient.removeQueries({ queryKey: ["heygen-avatars", String(clientId)] });
    },
  });

  const deleteReferenceMutation = useMutation({
    mutationFn: async (referenceId: number) => {
      await axios.delete(`${API_BASE}/references?id=${referenceId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["references", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["topic-cards", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["structure-cards", selectedClientId] });
    },
  });

  const deleteTopicCardMutation = useMutation({
    mutationFn: async (topicCardId: number) => {
      await axios.delete(`${API_BASE}/topic-cards?id=${topicCardId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["topic-cards", selectedClientId] });
    },
  });

  const deleteStructureCardMutation = useMutation({
    mutationFn: async (structureCardId: number) => {
      await axios.delete(`${API_BASE}/structure-cards?id=${structureCardId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["structure-cards", selectedClientId] });
    },
  });

  const saveHeygenAvatarsMutation = useMutation({
    mutationFn: async (avatars: HeygenAvatarConfig[]) => {
      await axios.put(`${API_BASE}/heygen/avatars`, {
        clientId: Number(selectedClientId),
        avatars,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["heygen-avatars", selectedClientId] });
    },
  });

  const batchRewriteMutation = useMutation({
    mutationFn: async () => {
      await axios.post(`${API_BASE}/generate`, {
        clientId: Number(selectedClientId),
        mode: "rewrite",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["references", selectedClientId] });
      startScenarioPolling();
    },
  });

  const batchMixMutation = useMutation({
    mutationFn: async ({
      topicId,
      structureId,
      count = 1,
    }: {
      topicId?: number;
      structureId?: number;
      count?: number;
    }) => {
      await axios.post(`${API_BASE}/generate`, {
        clientId: Number(selectedClientId),
        mode: "mix",
        count,
        topicId,
        structureId
      });
    },
    onSuccess: () => {
      startScenarioPolling();
    },
  });

  const singleRewriteMutation = useMutation({
    mutationFn: async (referenceId: number) => {
      await axios.post(`${API_BASE}/generate/single`, {
        contentId: referenceId,
        clientId: Number(selectedClientId),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["references", selectedClientId] });
      startScenarioPolling();
    },
  });

  return {
    clients: clientsQuery.data || [],
    isLoadingClients: clientsQuery.isLoading,
    references: referencesQuery.data?.data || [],
    totalReferences: referencesQuery.data?.totalCount || 0,
    scenarios: scenariosQuery.data?.data || [],
    totalScenarios: scenariosQuery.data?.totalCount || 0,
    topicCards: topicCardsQuery.data || [],
    structureCards: structureCardsQuery.data || [],
    heygenAvatars: heygenAvatarsQuery.data || [],
    heygenCatalog: heygenCatalogQuery.data || [],
    minimaxVoices: minimaxVoicesQuery.data || [],
    elevenlabsVoices: elevenlabsVoicesQuery.data || [],
    refreshWorkspace: () => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      queryClient.invalidateQueries({ queryKey: ["references", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["scenarios", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["topic-cards", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["structure-cards", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["heygen-avatars", selectedClientId] });
    },
    saveSettingsMutation,
    deleteClientMutation,
    deleteReferenceMutation,
    deleteTopicCardMutation,
    deleteStructureCardMutation,
    saveHeygenAvatarsMutation,
    batchRewriteMutation,
    batchMixMutation,
    singleRewriteMutation,
    referencesQuery,
    scenariosQuery,
    heygenAvatarsQuery,
    heygenCatalogQuery,
    minimaxVoicesQuery,
    elevenlabsVoicesQuery,
    
    // Pagination & Filter Controls
    scenarioPage,
    setScenarioPage,
    scenarioPageSize,
    setScenarioPageSize,
    scenarioSearch,
    setScenarioSearch: (q: string) => {
      setScenarioSearch(q);
      setScenarioPage(0);
    },
    referencePage,
    setReferencePage,
    referencePageSize,
    setReferencePageSize,
    referenceSearch,
    setReferenceSearch: (q: string) => {
      setReferenceSearch(q);
      setReferencePage(0);
    },
    referenceStatusFilter,
    setReferenceStatusFilter: (filter: "all" | "with" | "without") => {
      setReferenceStatusFilter(filter);
      setReferencePage(0);
    },
    // Stats
    costStats: costStatsQuery.data || EMPTY_COST_STATS,
    isLoadingStats: costStatsQuery.isLoading,
  };
}
