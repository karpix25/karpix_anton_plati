import React from "react";
import { Settings } from "@/types";
import { Button } from "@/components/ui/button";
import { LoaderCircle, Wand2 } from "lucide-react";

interface PromptEvolutionSettingsProps {
  draftSettings: Settings;
  selectedClientId: string | null;
  optimizingCategory: "scenario" | "visual" | "video" | null;
  handleOptimizePrompts: (category: "scenario" | "visual" | "video") => void;
}

export const PromptEvolutionSettings: React.FC<PromptEvolutionSettingsProps> = ({
  draftSettings,
  selectedClientId,
  optimizingCategory,
  handleOptimizePrompts,
}) => {
  const categories = [
    { id: "scenario", title: "Сценарий", rules: draftSettings.learned_rules_scenario },
    { id: "visual", title: "Визуал (B-roll)", rules: draftSettings.learned_rules_visual },
    { id: "video", title: "Видео (Prompts)", rules: draftSettings.learned_rules_video },
  ] as const;

  return (
    <div className="space-y-6 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="space-y-1">
        <h3 className="text-xl font-bold tracking-tight text-foreground flex items-center gap-2">
          Prompt Evolution
        </h3>
        <p className="text-sm text-muted-foreground leading-relaxed">
           Нейросеть проанализирует лайки/дизлайки и комментарии, чтобы составить список улучшений для будущих генераций.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {categories.map((cat) => (
          <div key={cat.id} className="flex flex-col gap-4 rounded-2xl border border-[#e5ebf0] bg-white p-5 shadow-sm transition-all hover:border-primary/20 hover:shadow-md group">
            <div className="flex items-center justify-between">
              <div className="text-xs font-black uppercase tracking-widest text-foreground">{cat.title}</div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0 text-primary hover:bg-primary/5 rounded-full"
                onClick={() => handleOptimizePrompts(cat.id)}
                disabled={!selectedClientId || (optimizingCategory !== null && optimizingCategory !== cat.id)}
                title="Пересчитать правила на основе фидбэка"
              >
                {optimizingCategory === cat.id ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="h-4 w-4" />
                )}
              </Button>
            </div>
            
            <div className="flex-1 overflow-y-auto max-h-[140px] rounded-xl bg-slate-50 p-4 border border-dashed border-slate-200">
               <p className="text-[11px] leading-relaxed text-slate-600 italic">
                 {cat.rules || "Ожидаем накопления фидбэка для формулирования правил..."}
               </p>
            </div>

            <div className="flex items-center gap-2">
               <div className={`h-1.5 w-1.5 rounded-full ${cat.rules ? 'bg-emerald-500' : 'bg-slate-300'}`} />
               <span className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                 {cat.rules ? "Авто-правила активны" : "В ожидании"}
               </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
