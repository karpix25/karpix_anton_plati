import React, { useCallback, useEffect, useState } from "react";
import { Settings } from "@/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoaderCircle, RefreshCw } from "lucide-react";

type Engine = {
  code: string;
  title: string;
  hint: string | null;
  credits_per_minute: number | null;
  price_is_measured: boolean;
};

interface Props {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

const LEGACY = "legacy";

export const HeygenEngineSelect: React.FC<Props> = ({ draftSettings, setDraftSettings }) => {
  const [engines, setEngines] = useState<Engine[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch("/api/heygen/engines");
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setEngines(data.engines || []);
    } catch (err) {
      setEngines([]);
      setError(err instanceof Error ? err.message : "Не удалось загрузить список движков.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSync = async () => {
    setIsSyncing(true);
    setError(null);
    try {
      const response = await fetch("/api/heygen/engines", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      setEngines(data.engines || []);
      const added: string[] = data.added || [];
      setError(added.length ? `Добавлены новые движки: ${added.join(", ")}` : "Новых движков у HeyGen нет.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось обновить список движков.");
    } finally {
      setIsSyncing(false);
    }
  };

  const selected = draftSettings.heygen_engine || LEGACY;
  const current = engines?.find((engine) => engine.code === selected) || null;

  return (
    <div className="space-y-4 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Движок генерации HeyGen
          </div>
          <p className="text-sm text-muted-foreground">
            Каким движком HeyGen собирать видео аватара для этого проекта.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-9 shrink-0 rounded-xl text-[11px] font-bold uppercase tracking-wider"
          onClick={handleSync}
          disabled={isSyncing}
          title="Спросить у HeyGen, не появилось ли новых движков"
        >
          {isSyncing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Обновить список
        </Button>
      </div>

      {engines === null ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Загружаю движки...
        </div>
      ) : engines.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Список движков пуст. Нажмите «Обновить список» — он заполнится из HeyGen.
        </p>
      ) : (
        <Select
          value={selected}
          onValueChange={(value) => setDraftSettings((prev) => ({ ...prev, heygen_engine: value }))}
        >
          <SelectTrigger className="h-11 w-full rounded-xl border-none bg-[#f0f4f7] px-4 text-sm font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {engines.map((engine) => (
              <SelectItem key={engine.code} value={engine.code}>
                {engine.title}
                {engine.credits_per_minute
                  ? ` — ${engine.credits_per_minute} кр/мин${engine.price_is_measured ? "" : " (ориентир)"}`
                  : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {current ? (
        <div className="rounded-xl border border-white/70 bg-white p-4 text-xs shadow-inner space-y-1">
          <p className="text-muted-foreground leading-relaxed">{current.hint}</p>
          {current.credits_per_minute ? (
            <p className="font-medium text-foreground">
              {current.credits_per_minute} кредитов за минуту
              {current.price_is_measured ? " (измерено)" : " — ориентир, уточняется замером"}
            </p>
          ) : null}
          {selected !== LEGACY ? (
            <p className="font-medium text-amber-600">
              Движок дороже текущего — счёт HeyGen по этому проекту вырастет.
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? <p className="text-xs font-medium text-muted-foreground">{error}</p> : null}
    </div>
  );
};
