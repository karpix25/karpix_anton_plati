import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Client, ElevenLabsVoiceOption, Reference, Scenario, TopicCard, StructureCard, Settings, HeygenAvatarConfig, MinimaxVoiceOption } from "@/types";

const API_BASE = "/api";
const SCENARIO_POLL_WINDOW_MS = 90_000;
const SCENARIO_POLL_INTERVAL_MS = 4_000;

export function useWorkspaceData(selectedClientId: string) {
  const queryClient = useQueryClient();
  const [scenarioPolling, setScenarioPolling] = useState<{ clientId: string; deadline: number; baselineCount: number } | null>(null);

  const startScenarioPolling = () => {
    const currentScenarios = queryClient.getQueryData<Scenario[]>(["scenarios", selectedClientId]) || [];
    setScenarioPolling({
      clientId: selectedClientId,
      deadline: Date.now() + SCENARIO_POLL_WINDOW_MS,
      baselineCount: currentScenarios.length,
    });
    queryClient.invalidateQueries({ queryKey: ["scenarios", selectedClientId] });
  };

  const clientsQuery = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/clients`);
      return data;
    },
  });

  const referencesQuery = useQuery<Reference[]>({
    queryKey: ["references", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/references?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
  });

  const scenariosQuery = useQuery<Scenario[]>({
    queryKey: ["scenarios", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/scenarios?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
    refetchInterval: () => {
      if (!scenarioPolling || scenarioPolling.clientId !== selectedClientId) return false;
      const currentCount = scenariosQuery.data?.length || 0;
      if (currentCount > scenarioPolling.baselineCount) return false;
      return Date.now() < scenarioPolling.deadline ? SCENARIO_POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
  });

  const topicCardsQuery = useQuery<TopicCard[]>({
    queryKey: ["topic-cards", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/topic-cards?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
  });

  const structureCardsQuery = useQuery<StructureCard[]>({
    queryKey: ["structure-cards", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/structure-cards?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
  });

  const heygenAvatarsQuery = useQuery<HeygenAvatarConfig[]>({
    queryKey: ["heygen-avatars", selectedClientId],
    queryFn: async () => {
      if (!selectedClientId) return [];
      const { data } = await axios.get(`${API_BASE}/heygen/avatars?clientId=${selectedClientId}`);
      return data;
    },
    enabled: !!selectedClientId,
  });

  const heygenCatalogQuery = useQuery<HeygenAvatarConfig[]>({
    queryKey: ["heygen-catalog"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/heygen/catalog`);
      return data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const minimaxVoicesQuery = useQuery<MinimaxVoiceOption[]>({
    queryKey: ["minimax-voices"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/minimax/voices`);
      return data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const elevenlabsVoicesQuery = useQuery<ElevenLabsVoiceOption[]>({
    queryKey: ["elevenlabs-voices"],
    queryFn: async () => {
      const { data } = await axios.get(`${API_BASE}/elevenlabs/voices`);
      return data;
    },
    staleTime: 1000 * 60 * 5,
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: Settings) => {
      await axios.put(`${API_BASE}/clients`, {
        id: Number(selectedClientId),
        ...settings,
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
    mutationFn: async ({ topicId, structureId }: { topicId?: number, structureId?: number }) => {
      await axios.post(`${API_BASE}/generate`, {
        clientId: Number(selectedClientId),
        mode: "mix",
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
    references: referencesQuery.data || [],
    scenarios: scenariosQuery.data || [],
    topicCards: topicCardsQuery.data || [],
    structureCards: structureCardsQuery.data || [],
    heygenAvatars: heygenAvatarsQuery.data || [],
    heygenCatalog: heygenCatalogQuery.data || [],
    minimaxVoices: minimaxVoicesQuery.data || [],
    elevenlabsVoices: elevenlabsVoicesQuery.data || [],
    refreshWorkspace: () => {
      queryClient.invalidateQueries({ queryKey: ["references", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["scenarios", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["topic-cards", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["structure-cards", selectedClientId] });
      queryClient.invalidateQueries({ queryKey: ["heygen-avatars", selectedClientId] });
    },
    saveSettingsMutation,
    deleteClientMutation,
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
  };
}
