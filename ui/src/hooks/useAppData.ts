import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { fetchJson } from "@/lib/utils";
import { Client, Reference, TopicCard, StructureCard, Scenario, ClientSettings } from "@/types";

export function useAppData(selectedClientId: string) {
  const queryClient = useQueryClient();

  const clientsQuery = useQuery<Client[]>({
    queryKey: ["clients"],
    queryFn: () => fetchJson("/api/clients"),
  });

  const referencesQuery = useQuery<Reference[]>({
    queryKey: ["references", selectedClientId],
    queryFn: () => fetchJson(`/api/references?clientId=${selectedClientId}`),
    enabled: Boolean(selectedClientId),
    placeholderData: keepPreviousData,
  });

  const scenariosQuery = useQuery<Scenario[]>({
    queryKey: ["scenarios", selectedClientId],
    queryFn: () => fetchJson(`/api/scenarios?clientId=${selectedClientId}`),
    enabled: Boolean(selectedClientId),
    placeholderData: keepPreviousData,
  });

  const topicCardsQuery = useQuery<TopicCard[]>({
    queryKey: ["topic-cards", selectedClientId],
    queryFn: () => fetchJson(`/api/topic-cards?clientId=${selectedClientId}`),
    enabled: Boolean(selectedClientId),
    placeholderData: keepPreviousData,
  });

  const structureCardsQuery = useQuery<StructureCard[]>({
    queryKey: ["structure-cards", selectedClientId],
    queryFn: () => fetchJson(`/api/structure-cards?clientId=${selectedClientId}`),
    enabled: Boolean(selectedClientId),
    placeholderData: keepPreviousData,
  });

  const saveSettingsMutation = useMutation({
    mutationFn: async (settings: ClientSettings) =>
      fetchJson<Client>("/api/clients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedClientId, ...settings }),
      }),
    onSuccess: (updatedClient) => {
      queryClient.setQueryData<Client[]>(["clients"], (prev = []) =>
        prev.map((client) => (client.id === updatedClient.id ? updatedClient : client))
      );
    },
  });

  const batchRewriteMutation = useMutation({
    mutationFn: async () =>
      fetchJson("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClientId, count: 5, mode: "rewrite" }),
      }),
  });

  const batchMixMutation = useMutation({
    mutationFn: async ({ topicId, structureId }: { topicId?: number; structureId?: number }) =>
      fetchJson("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClientId,
          count: 10,
          mode: "mix",
          topicId,
          structureId,
        }),
      }),
  });

  const singleRewriteMutation = useMutation({
    mutationFn: async (contentId: number) =>
      fetchJson("/api/generate/single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contentId, clientId: selectedClientId }),
      }),
  });

  return {
    queries: {
      clients: clientsQuery,
      references: referencesQuery,
      scenarios: scenariosQuery,
      topicCards: topicCardsQuery,
      structureCards: structureCardsQuery,
    },
    mutations: {
      saveSettings: saveSettingsMutation,
      batchRewrite: batchRewriteMutation,
      batchMix: batchMixMutation,
      singleRewrite: singleRewriteMutation,
    },
    data: {
      clients: clientsQuery.data || [],
      references: referencesQuery.data || [],
      scenarios: scenariosQuery.data || [],
      topicCards: topicCardsQuery.data || [],
      structureCards: structureCardsQuery.data || [],
    }
  };
}
