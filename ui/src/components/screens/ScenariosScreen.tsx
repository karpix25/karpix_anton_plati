import React, { useEffect, useMemo, useState } from "react";
import { RefreshCw, ArrowRight, ThumbsUp, ThumbsDown, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Scenario, ScenarioKeywordSegment, ScenarioVideoPromptItem, WordTimestamp } from "@/types";
import { formatUsd, getBrollGenerationUnitCostUsd, getGeneratedPromptCount, getScenarioActualDurationSeconds, getScenarioBrollGeneratorModel, getScenarioDurationSeconds, getScenarioGenerationCosts, HEYGEN_COST_PER_MINUTE_USD } from "@/lib/generation-costs";
import { BACKGROUND_AUDIO_TAG_LABELS } from "@/lib/background-audio";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const TRANSLATIONS: Record<string, string> = {
  'how_to_list': 'Как сделать (Список)',
  'educational': 'Обучающий',
  'case_study': 'Кейс-стади',
  'solution_showcase': 'Демонстрация решения',
  'personal_story': 'Личная история',
  'myth_busting': 'Развенчание мифов',
  'problem_solution': 'Проблема-Решение',
  'comparison': 'Сравнение',
};

const t = (text: string) => TRANSLATIONS[text] || text;

const formatAngle = (angle: string | undefined) => {
  if (!angle) return "—";
  const mixMatch = angle.match(/^(\w+)\s\((.*)\)$/);
  if (mixMatch) {
    const [, key, role] = mixMatch;
    return `${t(key)} (${role})`;
  }
  return t(angle);
};

const getScenarioVideoSummary = (scenario: Scenario) => {
  const prompts = scenario.video_generation_prompts?.prompts || [];
  const generatedPrompts = prompts.filter((item) => !item.use_ready_asset);
  if (!generatedPrompts.length) {
    return { label: "—", tone: "idle" as const };
  }

  const successCount = generatedPrompts.filter((item) => item.video_url || item.task_state === "success").length;
  const failedCount = generatedPrompts.filter((item) => item.task_state === "fail" || item.submission_status === "failed").length;
  const readyToStartCount = generatedPrompts.filter(
    (item) => !item.video_url && !item.task_id && item.prompt_json
  ).length;
  const pendingCount = generatedPrompts.filter(
    (item) =>
      !item.video_url &&
      !["success", "fail"].includes(item.task_state || "") &&
      ["submitted", "completed", "unknown"].includes(item.submission_status || "submitted")
  ).length;

  if (pendingCount > 0) {
    return { label: `Генерация ${successCount}/${generatedPrompts.length}`, tone: "pending" as const };
  }
  if (successCount === generatedPrompts.length) {
    return { label: `Готово ${successCount}/${generatedPrompts.length}`, tone: "success" as const };
  }
  if (failedCount > 0) {
    return { label: `Ошибка ${failedCount}`, tone: "failed" as const };
  }
  if (readyToStartCount > 0) {
    return { label: `Ждёт запуска ${readyToStartCount}`, tone: "idle" as const };
  }
  return { label: "Ожидание", tone: "idle" as const };
};

const getHeygenStatusMeta = (scenario: Scenario) => {
  const status = (scenario.heygen_status || "").toLowerCase();

  if (scenario.heygen_video_url && (status === "completed" || status === "success")) {
    return { label: "Avatar готов", tone: "success" as const };
  }
  if (status === "failed") {
    return { label: "Avatar ошибка", tone: "failed" as const };
  }
  if (["pending", "waiting", "processing"].includes(status)) {
    return { label: "Avatar рендер", tone: "pending" as const };
  }
  return { label: "—", tone: "idle" as const };
};

interface ScenariosScreenProps {
  scenarios: Scenario[];
  isLoading: boolean;
  onRefresh: () => void;
}

export function ScenariosScreen({ scenarios, isLoading, onRefresh }: ScenariosScreenProps) {
  const toSafeNumber = (value: unknown, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [isAnalyzingAudio, setIsAnalyzingAudio] = useState(false);
  const [isStartingHeygen, setIsStartingHeygen] = useState(false);
  const [isSubmittingVideoPrompts, setIsSubmittingVideoPrompts] = useState(false);
  const [isAssemblingMontage, setIsAssemblingMontage] = useState(false);
  const [isSavingBackgroundAudioTag, setIsSavingBackgroundAudioTag] = useState(false);
  const [generatedAudioUrl, setGeneratedAudioUrl] = useState<string | null>(null);
  const [generatedAudioScenarioId, setGeneratedAudioScenarioId] = useState<number | null>(null);
  const [generatedWordTimestamps, setGeneratedWordTimestamps] = useState<WordTimestamp[]>([]);
  const [generatedTranscript, setGeneratedTranscript] = useState("");
  const [generatedKeywordSegments, setGeneratedKeywordSegments] = useState<ScenarioKeywordSegment[]>([]);
  const [generatedVideoPrompts, setGeneratedVideoPrompts] = useState<ScenarioVideoPromptItem[]>([]);
  const [isPollingVideoStatus, setIsPollingVideoStatus] = useState(false);
  const [actualAudioDurationSeconds, setActualAudioDurationSeconds] = useState<number | null>(null);
  const [scenarioSearchQuery, setScenarioSearchQuery] = useState("");
  const [feedbackRating, setFeedbackRating] = useState<"like" | "dislike" | null>(null);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackCategories, setFeedbackCategories] = useState<string[]>([]);
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);
  const [feedbackSaved, setFeedbackSaved] = useState(false);

  const hasPendingVideoPrompts = (prompts: ScenarioVideoPromptItem[]) =>
    prompts.some(
      (item) =>
        !item.use_ready_asset &&
        !!item.task_id &&
        !item.video_url &&
        !["success", "fail"].includes(item.task_state || "") &&
        ["submitted", "completed", "unknown"].includes(item.submission_status || "submitted")
    );

  const hasStartableVideoPrompts = (prompts: ScenarioVideoPromptItem[]) =>
    prompts.some((item) => {
      if (item.use_ready_asset || !item.prompt_json || item.video_url) return false;
      const taskState = (item.task_state || "").toLowerCase();
      const submissionStatus = (item.submission_status || "").toLowerCase();
      const failed = taskState === "fail" || submissionStatus === "failed";
      return !item.task_id || failed;
    });

  const getVideoStatusLabel = (item: ScenarioVideoPromptItem) => {
    if (item.use_ready_asset) return "готовый файл";
    if (item.video_url) return "видео готово";
    if (!item.task_id && item.prompt_json) return "ожидает запуска";
    if (item.task_state === "fail" || item.submission_status === "failed") return "ошибка генерации";
    if (item.task_state === "success") return "видео готово";
    if (item.task_state === "generating" || item.task_state === "queuing" || item.task_state === "waiting" || item.submission_status === "submitted") {
      return "генерация видео";
    }
    return item.submission_status || "ожидание";
  };

  useEffect(() => {
    return () => {
      if (generatedAudioUrl) {
        window.URL.revokeObjectURL(generatedAudioUrl);
      }
    };
  }, [generatedAudioUrl]);

  const effectiveAudioUrl =
    generatedAudioUrl && generatedAudioScenarioId === selectedScenario?.id
      ? generatedAudioUrl
      : selectedScenario?.tts_audio_path
        ? `/api/tts/audio?scenarioId=${selectedScenario.id}`
        : null;

  useEffect(() => {
    if (!selectedScenario) return;

    const savedWords = selectedScenario.tts_word_timestamps?.words || [];
    const savedTranscript = selectedScenario.tts_word_timestamps?.transcript || "";
    const savedKeywordSegments = selectedScenario.video_keyword_segments?.segments || [];
    const savedVideoPrompts = selectedScenario.video_generation_prompts?.prompts || [];

    setGeneratedWordTimestamps(savedWords);
    setGeneratedTranscript(savedTranscript);
    setGeneratedKeywordSegments(savedKeywordSegments);
    setGeneratedVideoPrompts(savedVideoPrompts);
  }, [selectedScenario]);

  useEffect(() => {
    if (!effectiveAudioUrl) {
      setActualAudioDurationSeconds(null);
      return;
    }

    let cancelled = false;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = effectiveAudioUrl;

    const handleLoadedMetadata = () => {
      if (cancelled) return;
      const duration = Number(audio.duration || 0);
      setActualAudioDurationSeconds(Number.isFinite(duration) && duration > 0 ? duration : null);
    };

    const handleError = () => {
      if (!cancelled) {
        setActualAudioDurationSeconds(null);
      }
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("error", handleError);

    return () => {
      cancelled = true;
      audio.pause();
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.src = "";
    };
  }, [effectiveAudioUrl]);

  useEffect(() => {
    if (!selectedScenario) return;
    const freshScenario = scenarios.find((item) => item.id === selectedScenario.id);
    if (freshScenario && freshScenario !== selectedScenario) {
      setSelectedScenario(freshScenario);
    }
  }, [scenarios, selectedScenario]);

  useEffect(() => {
    if (!selectedScenario?.job_id || !generatedVideoPrompts.length || !hasPendingVideoPrompts(generatedVideoPrompts)) {
      return;
    }

    let cancelled = false;

    const pollVideoStatuses = async () => {
      if (cancelled) return;
      setIsPollingVideoStatus(true);
      try {
        await fetch("/api/kie/poll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: selectedScenario.job_id }),
        });
        await Promise.resolve(onRefresh());
      } catch (error) {
        console.error("KIE polling error:", error);
      } finally {
        if (!cancelled) {
          setIsPollingVideoStatus(false);
        }
      }
    };

    pollVideoStatuses();
    const intervalId = window.setInterval(pollVideoStatuses, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedScenario?.job_id, generatedVideoPrompts, onRefresh]);

  useEffect(() => {
    if (!selectedScenario?.id || !selectedScenario.heygen_video_id) {
      return;
    }

    const status = (selectedScenario.heygen_status || "").toLowerCase();
    if (!["pending", "waiting", "processing"].includes(status)) {
      return;
    }

    let cancelled = false;

    const pollHeygenStatus = async () => {
      if (cancelled) return;
      try {
        await fetch(`/api/heygen/avatar-video?scenarioId=${selectedScenario.id}`, {
          cache: "no-store",
        });
        await Promise.resolve(onRefresh());
      } catch (error) {
        console.error("HeyGen polling error:", error);
      }
    };

    pollHeygenStatus();
    const intervalId = window.setInterval(pollHeygenStatus, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [onRefresh, selectedScenario?.heygen_status, selectedScenario?.heygen_video_id, selectedScenario?.id]);

  const handleGenerateAudio = async (text: string, scenarioId: number) => {
    if (!text) return;
    setIsGeneratingAudio(true);
    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, scenarioId }),
      });

      if (!response.ok) throw new Error("Failed to generate audio");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      if (generatedAudioUrl) {
        window.URL.revokeObjectURL(generatedAudioUrl);
      }

      setGeneratedAudioUrl(url);
      setGeneratedAudioScenarioId(scenarioId);
      setGeneratedWordTimestamps([]);
      setGeneratedTranscript("");
      setGeneratedKeywordSegments([]);
      setGeneratedVideoPrompts([]);
      await Promise.resolve(onRefresh());

      setIsAnalyzingAudio(true);
      try {
        const file = new File([blob], `scenario_${scenarioId}_audio.mp3`, { type: "audio/mpeg" });
        const formData = new FormData();
        formData.append("file", file);

        const timestampResponse = await fetch("/api/tts/timestamps", {
          method: "POST",
          body: formData,
        });

        if (!timestampResponse.ok) {
          throw new Error("Failed to fetch word timestamps");
        }

        const timestampData = await timestampResponse.json();
        setGeneratedWordTimestamps(timestampData.words || []);
        setGeneratedTranscript(timestampData.transcript || "");

        await fetch("/api/scenarios/timestamps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scenarioId,
            transcript: timestampData.transcript || "",
            words: timestampData.words || [],
          }),
        });
      } catch (error) {
        console.error("Deepgram Timestamp Error:", error);
        alert("Аудио создано, но не удалось получить таймкоды слов из Deepgram.");
      } finally {
        setIsAnalyzingAudio(false);
      }
    } catch (error) {
      console.error("TTS Error:", error);
      alert("Ошибка при генерации аудио. Проверьте настройки MiniMax.");
    } finally {
      setIsGeneratingAudio(false);
    }
  };

  const handleCloseScenario = () => {
    setSelectedScenario(null);
    setFeedbackRating(null);
    setFeedbackComment("");
    setFeedbackCategories([]);
    setFeedbackSaved(false);
  };

  const handleGenerateHeygenVideo = async () => {
    if (!selectedScenario?.id) return;

    setIsStartingHeygen(true);
    try {
      const response = await fetch("/api/heygen/avatar-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: selectedScenario.id }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to start HeyGen avatar generation");
      }

      await Promise.resolve(onRefresh());
    } catch (error) {
      console.error("HeyGen start error:", error);
      alert(error instanceof Error ? error.message : "Не удалось запустить HeyGen.");
    } finally {
      setIsStartingHeygen(false);
    }
  };

  const handleAssembleMontage = async () => {
    if (!selectedScenario?.id) return;

    setIsAssemblingMontage(true);
    try {
      const response = await fetch("/api/scenarios/assemble", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: selectedScenario.id }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to assemble montage");
      }

      await Promise.resolve(onRefresh());
    } catch (error) {
      console.error("Montage assemble error:", error);
      alert(error instanceof Error ? error.message : "Не удалось собрать монтаж.");
    } finally {
      setIsAssemblingMontage(false);
    }
  };

  const handleUpdateBackgroundAudioTag = async (backgroundAudioTag: Scenario["background_audio_tag"]) => {
    if (!selectedScenario?.id || !backgroundAudioTag) return;

    setIsSavingBackgroundAudioTag(true);
    try {
      const response = await fetch("/api/scenarios", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: selectedScenario.id, backgroundAudioTag }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to update background audio tag");
      }

      setSelectedScenario((prev) => (prev ? { ...prev, background_audio_tag: backgroundAudioTag } : prev));
      await Promise.resolve(onRefresh());
    } catch (error) {
      console.error("Background audio tag update error:", error);
      alert(error instanceof Error ? error.message : "Не удалось сохранить тег фонового аудио.");
    } finally {
      setIsSavingBackgroundAudioTag(false);
    }
  };

  const handleSubmitVideoPrompts = async () => {
    if (!selectedScenario?.id) return;

    setIsSubmittingVideoPrompts(true);
    try {
      const response = await fetch("/api/kie/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioId: selectedScenario.id }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to submit Seedance prompts");
      }

      await Promise.resolve(onRefresh());
    } catch (error) {
      console.error("KIE submit error:", error);
      alert(error instanceof Error ? error.message : "Не удалось запустить генерацию видео.");
    } finally {
      setIsSubmittingVideoPrompts(false);
    }
  };

  const handleDownloadAudio = () => {
    const audioUrl =
      generatedAudioUrl && generatedAudioScenarioId
        ? generatedAudioUrl
        : selectedScenario?.id
          ? `/api/tts/audio?scenarioId=${selectedScenario.id}`
          : null;

    if (!audioUrl || !selectedScenario?.id) return;

    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `scenario_${selectedScenario.id}_audio.mp3`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const scenarioCosts = selectedScenario ? getScenarioGenerationCosts(selectedScenario) : null;
  const currentTranscriptDurationSeconds = getScenarioDurationSeconds(
    generatedWordTimestamps.length ? generatedWordTimestamps : selectedScenario?.tts_word_timestamps?.words
  );
  const currentActualDurationSeconds =
    actualAudioDurationSeconds ??
    (generatedAudioScenarioId === selectedScenario?.id && generatedAudioUrl
      ? currentTranscriptDurationSeconds
      : getScenarioActualDurationSeconds(selectedScenario));
  const currentGeneratedPromptCount = getGeneratedPromptCount(
    generatedVideoPrompts.length ? generatedVideoPrompts : selectedScenario?.video_generation_prompts?.prompts
  );
  const currentBrollGeneratorModel = getScenarioBrollGeneratorModel(selectedScenario);
  const currentBrollGeneratorLabel =
    currentBrollGeneratorModel === "bytedance/seedance-1.5-pro"
      ? "Seedance 1.5 Pro"
      : currentBrollGeneratorModel === "grok-imagine/text-to-video"
        ? "Grok Imagine T2V"
        : currentBrollGeneratorModel === "veo3"
          ? "Veo 3.1 Quality"
          : currentBrollGeneratorModel === "veo3_fast"
            ? "Veo 3.1 Fast"
            : currentBrollGeneratorModel === "veo3_lite"
              ? "Veo 3.1 Lite"
              : "KIE V1 Pro";
  const currentPromptUnitCostUsd = getBrollGenerationUnitCostUsd(currentBrollGeneratorModel);
  const currentPromptCostUsd = currentGeneratedPromptCount * currentPromptUnitCostUsd;
  const currentHeygenCostUsd = (currentActualDurationSeconds / 60) * HEYGEN_COST_PER_MINUTE_USD;
  const currentTotalCostUsd = currentPromptCostUsd + currentHeygenCostUsd;
  const normalizedScenarioSearchQuery = scenarioSearchQuery.trim().toLowerCase();
  const filteredScenarios = useMemo(() => {
    if (!normalizedScenarioSearchQuery) {
      return scenarios;
    }

    return scenarios.filter((scenario) => {
      const scriptText = String(scenario.scenario_json?.script || "");
      const ttsText = String(scenario.tts_script || "");
      return (
        scriptText.toLowerCase().includes(normalizedScenarioSearchQuery) ||
        ttsText.toLowerCase().includes(normalizedScenarioSearchQuery)
      );
    });
  }, [normalizedScenarioSearchQuery, scenarios]);
  const effectiveMontageUrl =
    selectedScenario?.montage_video_path && selectedScenario?.id
      ? `/api/scenarios/montage?scenarioId=${selectedScenario.id}`
      : null;

  return (
    <div className="max-w-7xl space-y-10">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h2 className="mb-2 text-4xl font-extrabold tracking-tight text-foreground">Сценарии</h2>
          <p className="max-w-lg text-muted-foreground">
            Библиотека всех сгенерированных сценариев на основе ваших референсов.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-12 rounded-xl border-none bg-white px-6 font-bold text-primary shadow-sm"
          onClick={onRefresh}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Обновить список
        </Button>
      </div>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {normalizedScenarioSearchQuery
              ? `${filteredScenarios.length} из ${scenarios.length} записей`
              : `${scenarios.length} записей`}
          </div>
          <div className="mt-3">
            <input
              type="text"
              value={scenarioSearchQuery}
              onChange={(event) => setScenarioSearchQuery(event.target.value)}
              placeholder="Поиск по тексту сценария: слово или фраза"
              className="h-10 w-full rounded-xl border border-[#e5ebf0] bg-[#fbfcfd] px-4 text-sm text-foreground outline-none transition focus:border-primary/30 focus:bg-white"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-12 w-full" />
            ))}
          </div>
        ) : scenarios.length ? (
          filteredScenarios.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Название / Скрипт</TableHead>
                  <TableHead>Режим</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Тема</TableHead>
                  <TableHead>Паттерн</TableHead>
                  <TableHead className="text-center">TTS</TableHead>
                  <TableHead className="text-center">Видео</TableHead>
                  <TableHead className="text-right">Стоимость</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead className="w-[80px] text-right">Скрипт</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredScenarios.map((sc) => (
                  <TableRow key={sc.id}>
                    <TableCell className="max-w-[200px] font-medium text-foreground">
                      <div className="line-clamp-2">{sc.topic || sc.scenario_json?.script?.slice(0, 50) + "..."}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                        {sc.mode === "rewrite" ? "Рерайт" : "Микс"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          sc.generation_source === "auto"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700"
                        }
                      >
                        {sc.generation_source === "auto" ? "Авто" : "Ручн"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs font-bold text-slate-700">{sc.topic || "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className="text-[10px] text-slate-500 italic">{formatAngle(sc.angle)}</span>
                    </TableCell>
                    <TableCell className="text-center">
                    {sc.tts_script ? (
                        <Badge className="bg-emerald-500/10 text-emerald-600 border-none hover:bg-emerald-500/20">
                          <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                          OK
                        </Badge>
                      ) : (
                        <span className="text-[10px] text-slate-300">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {(() => {
                        const avatarSummary = getHeygenStatusMeta(sc);
                        if (avatarSummary.tone === "pending") {
                          return (
                            <Badge className="border-none bg-sky-500/10 text-sky-700 hover:bg-sky-500/20">
                              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                              {avatarSummary.label}
                            </Badge>
                          );
                        }
                        if (avatarSummary.tone === "success") {
                          return (
                            <Badge className="border-none bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20">
                              {avatarSummary.label}
                            </Badge>
                          );
                        }
                        if (avatarSummary.tone === "failed") {
                          return (
                            <Badge className="border-none bg-amber-500/10 text-amber-700 hover:bg-amber-500/20">
                              {avatarSummary.label}
                            </Badge>
                          );
                        }

                        const videoSummary = getScenarioVideoSummary(sc);
                        if (videoSummary.tone === "pending") {
                          return (
                            <Badge className="border-none bg-sky-500/10 text-sky-700 hover:bg-sky-500/20">
                              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                              {videoSummary.label}
                            </Badge>
                          );
                        }
                        if (videoSummary.tone === "success") {
                          return (
                            <Badge className="border-none bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20">
                              {videoSummary.label}
                            </Badge>
                          );
                        }
                        if (videoSummary.tone === "failed") {
                          return (
                            <Badge className="border-none bg-amber-500/10 text-amber-700 hover:bg-amber-500/20">
                              {videoSummary.label}
                            </Badge>
                          );
                        }
                        return <span className="text-[10px] text-slate-300">—</span>;
                      })()}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap text-xs font-bold text-slate-700">
                      {formatUsd(getScenarioGenerationCosts(sc).totalCostUsd)}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {sc.created_at ? new Date(sc.created_at).toLocaleDateString("ru-RU") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => setSelectedScenario(sc)}
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted-foreground">
              По запросу ничего не найдено. Попробуйте другое слово или фразу из текста сценария.
            </div>
          )
        ) : (
          <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted-foreground">
            Сценарии пока не сгенерированы. Перейдите в Генератор, чтобы создать свою первую подборку.
          </div>
        )}
      </div>

      <Dialog open={!!selectedScenario} onOpenChange={(open) => !open && handleCloseScenario()}>
        <DialogContent className="w-[min(98vw,1720px)] max-w-[1720px] sm:max-w-[1720px] max-h-[94vh] flex flex-col p-0 overflow-hidden border-none shadow-2xl rounded-3xl">
          <div className="bg-gradient-to-br from-primary/10 via-background to-background p-8 pb-4">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  {selectedScenario?.mode === "rewrite" ? "Рерайт" : "Микс"}
                </Badge>
                <div className="h-1 w-1 rounded-full bg-slate-300" />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                  {selectedScenario?.created_at ? new Date(selectedScenario.created_at).toLocaleDateString("ru-RU") : ""}
                </span>
              </div>
              <DialogTitle className="text-3xl font-black tracking-tight text-slate-900 leading-tight">
                {selectedScenario?.topic || "Сценарий без названия"}
              </DialogTitle>
              <DialogDescription className="text-slate-500 font-medium mt-1">
                {formatAngle(selectedScenario?.angle)}
              </DialogDescription>
            </DialogHeader>
          </div>

          <div className="flex-1 overflow-y-auto px-8 pb-8 custom-scrollbar space-y-8 mt-4">
            {/* Feedback Panel */}
            {selectedScenario?.id ? (
              <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5 space-y-4 shadow-sm border-emerald-100/50">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5" />
                    Оценка сценария
                  </h3>
                  {feedbackSaved ? (
                    <span className="text-xs font-bold text-emerald-600">✓ Сохранено</span>
                  ) : null}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      (feedbackRating ?? selectedScenario.feedback_rating) === "like"
                        ? "bg-emerald-500 text-white shadow-md shadow-emerald-200"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600"
                    }`}
                    onClick={() => {
                      setFeedbackRating("like");
                      setFeedbackSaved(false);
                    }}
                  >
                    <ThumbsUp className="h-4 w-4" />
                    Нравится
                  </button>
                  <button
                    type="button"
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                      (feedbackRating ?? selectedScenario.feedback_rating) === "dislike"
                        ? "bg-rose-500 text-white shadow-md shadow-rose-200"
                        : "bg-white border border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600"
                    }`}
                    onClick={() => {
                      setFeedbackRating("dislike");
                      setFeedbackSaved(false);
                    }}
                  >
                    <ThumbsDown className="h-4 w-4" />
                    Не нравится
                  </button>
                </div>

                {(feedbackRating ?? selectedScenario.feedback_rating) === "dislike" ? (
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-slate-500">Что именно не понравилось?</div>
                    <div className="flex flex-wrap gap-2">
                      {[
                        { key: "scenario", label: "📝 Текст / сценарий", color: "indigo" },
                        { key: "visual", label: "🎬 Выбор перебивок", color: "violet" },
                        { key: "video", label: "🎥 Качество видео", color: "sky" },
                        { key: "montage", label: "✂️ Монтаж / ритм", color: "amber" },
                      ].map(({ key, label, color }) => {
                        const active = (feedbackCategories.length > 0 ? feedbackCategories : (selectedScenario.feedback_categories || "").split(",").filter(Boolean)).includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                              active
                                ? `bg-${color}-100 text-${color}-700 border border-${color}-300`
                                : "bg-white border border-slate-200 text-slate-500 hover:bg-slate-50"
                            }`}
                            style={active ? { backgroundColor: `var(--${color}-100, #e0e7ff)`, color: `var(--${color}-700, #4338ca)`, borderColor: `var(--${color}-300, #a5b4fc)` } : {}}
                            onClick={() => {
                              setFeedbackCategories((prev) => {
                                const base = prev.length > 0 ? prev : (selectedScenario.feedback_categories || "").split(",").filter(Boolean);
                                return base.includes(key) ? base.filter((c) => c !== key) : [...base, key];
                              });
                              setFeedbackSaved(false);
                            }}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 placeholder:text-slate-400 focus:border-primary/40 focus:outline-none focus:ring-2 focus:ring-primary/10 resize-none"
                      rows={2}
                      maxLength={2000}
                      placeholder="Опишите, что конкретно не так..."
                      value={feedbackComment || selectedScenario.feedback_comment || ""}
                      onChange={(e) => {
                        setFeedbackComment(e.target.value);
                        setFeedbackSaved(false);
                      }}
                    />
                  </div>
                ) : null}

                {(feedbackRating ?? selectedScenario.feedback_rating) ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-bold"
                    disabled={isSavingFeedback || feedbackSaved}
                    onClick={async () => {
                      if (!selectedScenario?.id) return;
                      setIsSavingFeedback(true);
                      try {
                        const rating = feedbackRating ?? selectedScenario.feedback_rating;
                        const comment = feedbackComment || selectedScenario.feedback_comment || "";
                        const cats = feedbackCategories.length > 0 ? feedbackCategories : (selectedScenario.feedback_categories || "").split(",").filter(Boolean);

                        const response = await fetch("/api/scenarios/feedback", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            scenarioId: selectedScenario.id,
                            rating,
                            comment,
                            categories: cats,
                          }),
                        });

                        if (!response.ok) {
                          throw new Error("Failed to save feedback");
                        }

                        setFeedbackSaved(true);
                        await Promise.resolve(onRefresh());
                      } catch (error) {
                        console.error("Feedback save error:", error);
                        alert("Не удалось сохранить оценку");
                      } finally {
                        setIsSavingFeedback(false);
                      }
                    }}
                  >
                    {isSavingFeedback ? "Сохранение..." : feedbackSaved ? "✓ Сохранено" : "Сохранить оценку"}
                  </Button>
                ) : null}
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Итого по сценарию</div>
                <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{formatUsd(currentTotalCostUsd)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{currentBrollGeneratorLabel}</div>
                <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{currentGeneratedPromptCount}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {formatUsd(currentPromptCostUsd)} по ${toSafeNumber(currentPromptUnitCostUsd).toFixed(3)} за генерацию
                </div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">HeyGen длительность</div>
                <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">{toSafeNumber(currentActualDurationSeconds).toFixed(1)}s</div>
                <div className="mt-1 text-xs text-slate-500">{formatUsd(currentHeygenCostUsd)} по $1.00 за минуту</div>
                {Math.abs(currentActualDurationSeconds - currentTranscriptDurationSeconds) > 0.35 ? (
                  <div className="mt-1 text-[11px] text-amber-600">
                    transcript timestamps: {toSafeNumber(currentTranscriptDurationSeconds).toFixed(1)}s
                  </div>
                ) : null}
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Сохранено в БД</div>
                <div className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                  {scenarioCosts ? formatUsd(scenarioCosts.totalCostUsd) : "$0.000"}
                </div>
                <div className="mt-1 text-xs text-slate-500">Расчёт по сохранённым prompts и timestamps</div>
              </div>
            </div>

            {/* Scripts Section */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                  Оригинальный скрипт
                </h3>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 bg-indigo-50/30 p-6 rounded-2xl border border-indigo-100/50 min-h-[200px]">
                  {selectedScenario?.scenario_json?.script || "Скрипт отсутствует"}
                </div>
                <div className="space-y-3 rounded-2xl border border-rose-100 bg-rose-50/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold uppercase tracking-widest text-rose-600">
                      HeyGen avatar video
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] font-bold border-rose-200 text-rose-600 hover:bg-rose-50"
                      onClick={handleGenerateHeygenVideo}
                      disabled={
                        isStartingHeygen ||
                        !selectedScenario?.tts_audio_path ||
                        ["pending", "waiting", "processing"].includes((selectedScenario?.heygen_status || "").toLowerCase())
                      }
                    >
                      {isStartingHeygen || ["pending", "waiting", "processing"].includes((selectedScenario?.heygen_status || "").toLowerCase()) ? (
                        <>
                          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                          Рендер...
                        </>
                      ) : (
                        <>Собрать avatar</>
                      )}
                    </Button>
                  </div>
                  <div className="rounded-xl border border-white/70 bg-white p-4 text-xs text-slate-600">
                    Запуск доступен для любой строки с готовой озвучкой. Видео сохраняется в БД и показывается прямо под оригинальным скриптом.
                  </div>
                  {(selectedScenario?.heygen_avatar_name || selectedScenario?.heygen_look_name || selectedScenario?.heygen_status) ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedScenario?.heygen_avatar_name ? (
                        <Badge variant="outline" className="border-rose-200 bg-white text-rose-700">
                          Avatar: {selectedScenario.heygen_avatar_name}
                        </Badge>
                      ) : null}
                      {selectedScenario?.heygen_look_name ? (
                        <Badge variant="outline" className="border-rose-200 bg-white text-rose-700">
                          Look: {selectedScenario.heygen_look_name}
                        </Badge>
                      ) : null}
                      {selectedScenario?.heygen_status ? (
                        <Badge variant="outline" className="border-rose-200 bg-white text-rose-700">
                          Status: {selectedScenario.heygen_status}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedScenario?.heygen_error ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      {selectedScenario.heygen_error}
                    </div>
                  ) : null}
                  {selectedScenario?.heygen_video_url ? (
                    <div className="space-y-3">
                      <video src={selectedScenario.heygen_video_url} controls className="w-full rounded-xl border border-rose-100 bg-black" />
                      <div className="text-xs text-slate-500">
                        HeyGen video id: {selectedScenario.heygen_video_id || "—"}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-rose-200 bg-white p-4 text-xs text-slate-400">
                      После запуска здесь появится avatar-видео из сохранённой MP3-озвучки.
                    </div>
                  )}
                </div>
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-bold uppercase tracking-widest text-slate-600">
                      Финальный монтаж
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] font-bold border-slate-300 text-slate-700 hover:bg-slate-100"
                      onClick={handleAssembleMontage}
                      disabled={
                        isAssemblingMontage ||
                        !selectedScenario?.tts_audio_path ||
                        !selectedScenario?.heygen_video_url ||
                        (selectedScenario?.montage_status || "").toLowerCase() === "processing"
                      }
                    >
                      {isAssemblingMontage || (selectedScenario?.montage_status || "").toLowerCase() === "processing" ? (
                        <>
                          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                          Сборка...
                        </>
                      ) : (
                        <>Собрать монтаж</>
                      )}
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="space-y-2">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        Фоновое аудио
                      </div>
                      <Select
                        value={selectedScenario?.background_audio_tag || "neutral"}
                        onValueChange={(value) => handleUpdateBackgroundAudioTag(value as Scenario["background_audio_tag"])}
                        disabled={isSavingBackgroundAudioTag}
                      >
                        <SelectTrigger className="h-11 rounded-xl border border-slate-200 bg-white text-sm text-slate-900">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(BACKGROUND_AUDIO_TAG_LABELS).map(([tag, meta]) => (
                            <SelectItem key={tag} value={tag}>
                              {meta.title}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="rounded-xl border border-white/80 bg-white p-4 text-xs text-slate-600">
                      {selectedScenario?.background_audio_tag
                        ? BACKGROUND_AUDIO_TAG_LABELS[selectedScenario.background_audio_tag].description
                        : "Выберите mood-tag. При сборке монтаж возьмёт случайный трек из соответствующей папки Яндекс Диска и подмешает его на 50% громкости."}
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/80 bg-white p-4 text-xs text-slate-600">
                    Таймлайн строится по `slot_start/slot_end` из video prompts: в окнах перебивок используется b-roll, в остальных участках остаётся avatar-видео. Финальный звук теперь собирается из TTS и случайного фонового трека по выбранному тегу.
                  </div>
                  {selectedScenario?.montage_status ? (
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline" className="border-slate-300 bg-white text-slate-700">
                        Status: {selectedScenario.montage_status}
                      </Badge>
                      {selectedScenario?.montage_yandex_status ? (
                        <Badge variant="outline" className="border-sky-300 bg-sky-50 text-sky-700">
                          Yandex Disk: {selectedScenario.montage_yandex_status}
                        </Badge>
                      ) : null}
                      {selectedScenario?.background_audio_tag ? (
                        <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-indigo-700">
                          Audio: {BACKGROUND_AUDIO_TAG_LABELS[selectedScenario.background_audio_tag].title}
                        </Badge>
                      ) : null}
                    </div>
                  ) : null}
                  {selectedScenario?.montage_error ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      {selectedScenario.montage_error}
                    </div>
                  ) : null}
                  {selectedScenario?.montage_yandex_error ? (
                    <div className="rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
                      {selectedScenario.montage_yandex_error}
                    </div>
                  ) : null}
                  {effectiveMontageUrl ? (
                    <div className="space-y-3">
                      <video src={effectiveMontageUrl} controls className="w-full rounded-xl border border-slate-200 bg-black" />
                      <div className="text-xs text-slate-500">
                        Готовый ролик собран по таймингам озвучки и слотам перебивок.
                      </div>
                      {selectedScenario?.montage_background_audio_name ? (
                        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs text-indigo-900">
                          Фоновый трек: {selectedScenario.montage_background_audio_name}
                        </div>
                      ) : null}
                      {selectedScenario?.montage_yandex_disk_path || selectedScenario?.montage_yandex_public_url ? (
                        <div className="space-y-2 rounded-xl border border-sky-100 bg-sky-50/60 p-3 text-xs text-sky-900">
                          <div className="font-semibold uppercase tracking-widest text-sky-700">
                            Яндекс Диск
                          </div>
                          {selectedScenario?.montage_yandex_disk_path ? (
                            <div>Путь: {selectedScenario.montage_yandex_disk_path}</div>
                          ) : null}
                          {selectedScenario?.montage_yandex_public_url ? (
                            <a
                              href={selectedScenario.montage_yandex_public_url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-sky-700 underline underline-offset-2 hover:text-sky-900"
                            >
                              Открыть публичную ссылку
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-xs text-slate-400">
                      После сборки здесь появится финальное видео с аватаром, перебивками и итоговым звуком.
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-widest text-emerald-500 flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Исходный текст для озвучки (TTS)
                  </h3>
                  {selectedScenario?.tts_script && (
                    <Button 
                      size="sm" 
                      variant="outline" 
                      className="h-7 text-[10px] font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                      onClick={() => handleGenerateAudio(selectedScenario.tts_script!, selectedScenario.id)}
                      disabled={isGeneratingAudio}
                    >
                      {isGeneratingAudio ? (
                        <>
                          <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                          Генерация...
                        </>
                      ) : (
                        <>
                          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" x2="12" y1="19" y2="22"/></svg>
                          Озвучить
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <div className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-emerald-900 bg-emerald-50/50 p-6 rounded-2xl border border-emerald-100 min-h-[200px]">
                  {selectedScenario?.tts_script || "Текст для озвучки еще не сгенерирован"}
                </div>
                {selectedScenario?.tts_request_text ? (
                  <div className="space-y-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Текст, отправленный в MiniMax (с interjection tags)
                    </div>
                    <div className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-700">
                      {selectedScenario.tts_request_text}
                    </div>
                  </div>
                ) : selectedScenario?.tts_script ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-500">
                    Здесь появится текст, который реально ушёл в MiniMax с interjection tags. Для старых сценариев поле может быть пустым, пока озвучка не сгенерирована заново.
                  </div>
                ) : null}
                {effectiveAudioUrl ? (
                  <div className="space-y-3 rounded-2xl border border-emerald-100 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs font-bold uppercase tracking-widest text-emerald-500">
                        Аудио озвучки
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                        onClick={handleDownloadAudio}
                      >
                        Скачать mp3
                      </Button>
                    </div>
                    <audio controls className="w-full">
                      <source src={effectiveAudioUrl} type="audio/mpeg" />
                      Ваш браузер не поддерживает аудиоплеер.
                    </audio>
                    <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
                          Таймкоды слов Deepgram
                        </div>
                        {isAnalyzingAudio ? (
                          <div className="flex items-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                            Анализ...
                          </div>
                        ) : null}
                      </div>
                      {generatedTranscript ? (
                        <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs leading-relaxed text-slate-600">
                          {generatedTranscript}
                        </div>
                      ) : null}
                      {generatedWordTimestamps.length ? (
                        <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                          <div className="grid grid-cols-[1.5fr_0.7fr_0.7fr] gap-3 border-b border-slate-200 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                            <div>Слово</div>
                            <div>Start</div>
                            <div>End</div>
                          </div>
                          {generatedWordTimestamps.map((item, index) => (
                            <div
                              key={`${item.word}-${item.start}-${index}`}
                              className="grid grid-cols-[1.5fr_0.7fr_0.7fr] gap-3 border-b border-slate-100 px-3 py-2 text-xs text-slate-600 last:border-b-0"
                            >
                              <div className="font-medium text-slate-800">{item.punctuated_word || item.word}</div>
                              <div>{toSafeNumber(item.start).toFixed(2)}s</div>
                              <div>{toSafeNumber(item.end).toFixed(2)}s</div>
                            </div>
                          ))}
                        </div>
                      ) : !isAnalyzingAudio ? (
                        <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-xs text-slate-400">
                          Таймкоды слов появятся здесь после анализа аудио через Deepgram.
                        </div>
                      ) : null}
                    </div>

                    <div className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
                      <div className="text-xs font-bold uppercase tracking-widest text-violet-500">
                        Ключевые слова и фразы для перебивок
                      </div>
                      {generatedKeywordSegments.length ? (
                        <div className="grid gap-3 xl:grid-cols-2">
                          {generatedKeywordSegments.map((segment, index) => (
                            <div
                              key={`${segment.slot_start}-${segment.keyword}-${index}`}
                              className="rounded-xl border border-violet-100 bg-white p-4"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="rounded-full bg-violet-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-violet-700">
                                  {segment.slot_start}s - {segment.slot_end}s
                                </div>
                                <div className="text-sm font-bold text-slate-900">{segment.keyword}</div>
                                {segment.asset_type === "product_video" ? (
                                  <div className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                                    Готовый product clip
                                  </div>
                                ) : null}
                                {segment.phrase ? (
                                  <div className="text-xs text-slate-500">{segment.phrase}</div>
                                ) : null}
                              </div>
                              <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                                <div>
                                  <span className="font-semibold text-slate-700">Word timing:</span>{" "}
                                  {typeof segment.word_start === "number" ? `${segment.word_start.toFixed(2)}s` : "—"} -{" "}
                                  {typeof segment.word_end === "number" ? `${segment.word_end.toFixed(2)}s` : "—"}
                                </div>
                                <div>
                                  <span className="font-semibold text-slate-700">Visual intent:</span>{" "}
                                  {segment.visual_intent || "—"}
                                </div>
                              </div>
                              {segment.asset_type === "product_video" && segment.asset_url ? (
                                <div className="mt-3">
                                  <video src={segment.asset_url} controls className="w-full rounded-xl border border-emerald-100 bg-black" />
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-violet-200 bg-white p-4 text-xs text-slate-400">
                          Ключевые фразы для видео-перебивок появятся здесь после автоматической обработки нового сценария.
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 rounded-2xl border border-sky-100 bg-sky-50/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-xs font-bold uppercase tracking-widest text-sky-600">
                          Seedance Pro v1 JSON prompts
                        </div>
                        <div className="flex items-center gap-2">
                          {isPollingVideoStatus || hasPendingVideoPrompts(generatedVideoPrompts) ? (
                            <div className="flex items-center text-[10px] font-bold uppercase tracking-widest text-sky-600">
                              <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                              Генерация видео
                            </div>
                          ) : null}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] font-bold border-sky-200 text-sky-700 hover:bg-sky-50"
                            onClick={handleSubmitVideoPrompts}
                            disabled={
                              isSubmittingVideoPrompts ||
                              !generatedVideoPrompts.length ||
                              hasPendingVideoPrompts(generatedVideoPrompts) ||
                              !hasStartableVideoPrompts(generatedVideoPrompts)
                            }
                          >
                            {isSubmittingVideoPrompts ? (
                              <>
                                <RefreshCw className="mr-1 h-3 w-3 animate-spin" />
                                Запуск...
                              </>
                            ) : (
                              <>Запустить видео</>
                            )}
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-white/80 bg-white p-4 text-xs text-slate-600">
                        Prompt-ы сохраняются автоматически, но в генератор видео отправляются по кнопке. Повторный запуск отправит сегменты без `task_id` и сегменты со статусом `failed`.
                      </div>
                      {generatedVideoPrompts.length ? (
                        <div className="space-y-3">
                          {generatedVideoPrompts.map((item, index) => (
                            <div key={`${item.slot_start}-${item.keyword}-${index}`} className="rounded-xl border border-sky-100 bg-white p-4">
                              <div className="mb-3 flex flex-wrap items-center gap-2">
                                <div className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-sky-700">
                                  {item.slot_start}s - {item.slot_end}s
                                </div>
                                <div className="text-sm font-bold text-slate-900">{item.keyword || "Без keyword"}</div>
                                {item.use_ready_asset ? (
                                  <div className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-emerald-700">
                                    Ready asset
                                  </div>
                                ) : (
                                  <div className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-sky-700">
                                    Seedance prompt
                                  </div>
                                )}
                                {item.submission_status ? (
                                  <div className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-slate-700 flex items-center gap-1">
                                    {(!item.use_ready_asset && !item.video_url && (item.task_state === "generating" || item.task_state === "queuing" || item.task_state === "waiting" || item.submission_status === "submitted")) ? (
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                    ) : null}
                                    {getVideoStatusLabel(item)}
                                  </div>
                                ) : null}
                              </div>
                              {!item.use_ready_asset ? (
                                <div className="mb-3 grid gap-2 text-xs text-slate-500 md:grid-cols-3">
                                  <div>
                                    <span className="font-semibold text-slate-700">Provider:</span> {item.provider || "kie.ai"}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-700">Task ID:</span> {item.task_id || "—"}
                                  </div>
                                  <div>
                                    <span className="font-semibold text-slate-700">Статус:</span> {item.submission_status || "—"}
                                  </div>
                                </div>
                              ) : null}
                              {item.video_url ? (
                                <div className="mb-3 space-y-3">
                                  <div className="text-xs text-slate-500">KIE generation result</div>
                                  <video src={item.video_url} controls className="w-full rounded-xl border border-sky-100 bg-black" />
                                </div>
                              ) : null}
                              {!item.video_url && item.result_urls?.length ? (
                                <div className="mb-3 rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs text-slate-600">
                                  {item.result_urls.map((url, urlIndex) => (
                                    <div key={`${url}-${urlIndex}`} className="truncate">
                                      {url}
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {item.error ? (
                                <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                                  {item.error}
                                </div>
                              ) : null}
                              {item.use_ready_asset && item.asset_url ? (
                                <div className="space-y-3">
                                  <div className="text-xs text-slate-500">
                                    Для этого сегмента будет использован готовый файл вместо генерации.
                                  </div>
                                  <video src={item.asset_url} controls className="w-full rounded-xl border border-emerald-100 bg-black" />
                                </div>
                              ) : (
                                <pre className="overflow-x-auto rounded-xl border border-sky-100 bg-slate-950 p-4 text-xs leading-relaxed text-slate-100">
                                  {JSON.stringify(item.prompt_json, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-sky-200 bg-white p-4 text-xs text-slate-400">
                          JSON prompts для Seedance Pro v1 появятся здесь после автоматической обработки нового сценария.
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Creative Assets */}
            {(selectedScenario?.scenario_json?.visual_hooks?.length || selectedScenario?.scenario_json?.audio_triggers?.length) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 border-t border-slate-100">
                {selectedScenario?.scenario_json?.visual_hooks?.length ? (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Визуальные крючки</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedScenario.scenario_json.visual_hooks.map((hook, i) => (
                        <div key={i} className="px-3 py-2 bg-slate-100 rounded-xl text-xs text-slate-600 border border-slate-200">
                          {hook}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {selectedScenario?.scenario_json?.audio_triggers?.length ? (
                  <div className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Аудио триггеры</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedScenario.scenario_json.audio_triggers.map((trigger, i) => (
                        <div key={i} className="px-3 py-2 bg-amber-50 rounded-xl text-xs text-amber-700 border border-amber-100">
                          {trigger}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
            
            {/* Meta Data */}
            <div className="pt-6 border-t border-slate-100 text-[10px] text-slate-400 font-mono tracking-tighter flex justify-between items-center">
               <div>ID: {selectedScenario?.id}</div>
               <div>JOB_ID: {selectedScenario?.job_id || "N/A"}</div>
            </div>

          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
