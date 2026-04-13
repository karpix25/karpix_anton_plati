import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { Settings } from "@/types";

interface PronunciationSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

export const PronunciationSettings: React.FC<PronunciationSettingsProps> = ({
  draftSettings,
  setDraftSettings,
}) => {
  const rules = draftSettings.tts_pronunciation_overrides || [];

  const updateRule = (
    index: number,
    field: "search" | "replace" | "case_sensitive" | "word_boundaries",
    value: string | boolean
  ) => {
    setDraftSettings((prev) => ({
      ...prev,
      tts_pronunciation_overrides: (prev.tts_pronunciation_overrides || []).map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, [field]: value } : rule
      ),
    }));
  };

  const addRule = () => {
    setDraftSettings((prev) => ({
      ...prev,
      tts_pronunciation_overrides: [
        ...(prev.tts_pronunciation_overrides || []),
        {
          search: "",
          replace: "",
          case_sensitive: false,
          word_boundaries: true,
        },
      ],
    }));
  };

  const removeRule = (index: number) => {
    setDraftSettings((prev) => ({
      ...prev,
      tts_pronunciation_overrides: (prev.tts_pronunciation_overrides || []).filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  return (
    <div className="space-y-5 rounded-2xl border border-[#e5ebf0] bg-[#fbfcfd] p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Произношение (ElevenLabs)
          </div>
          <p className="text-sm text-muted-foreground">
            Добавьте пары «как написано» → «как произнести», чтобы стабильно контролировать ударения и брендовые формулировки.
          </p>
        </div>
        <button
          type="button"
          onClick={addRule}
          className="inline-flex items-center gap-2 rounded-xl border border-[#d7e2ea] bg-white px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary transition hover:bg-[#f8fbff]"
        >
          <Plus className="h-3.5 w-3.5" />
          Добавить
        </button>
      </div>

      <div className="rounded-xl border border-white/70 bg-white p-4 text-xs leading-relaxed text-muted-foreground shadow-inner">
        Пример: «Плати по миру» → «платИ по мИру». Эти правила применяются только для ElevenLabs.
      </div>

      <div className="space-y-3">
        {rules.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#d9e3ea] bg-white px-4 py-5 text-center text-xs text-muted-foreground">
            Пока нет правил. Нажмите «Добавить».
          </div>
        ) : (
          rules.map((rule, index) => (
            <div key={index} className="rounded-xl border border-[#e5ebf0] bg-white p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Как написано
                  </label>
                  <input
                    type="text"
                    value={rule.search || ""}
                    onChange={(event) => updateRule(index, "search", event.target.value)}
                    placeholder="Плати по миру"
                    className="h-10 w-full rounded-lg border border-[#dbe5ec] bg-[#f8fbfd] px-3 text-sm outline-none transition focus:border-primary/40 focus:bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Как произнести
                  </label>
                  <input
                    type="text"
                    value={rule.replace || ""}
                    onChange={(event) => updateRule(index, "replace", event.target.value)}
                    placeholder="платИ по мИру"
                    className="h-10 w-full rounded-lg border border-[#dbe5ec] bg-[#f8fbfd] px-3 text-sm outline-none transition focus:border-primary/40 focus:bg-white"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRule(index)}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-rose-200 px-3 text-rose-500 transition hover:bg-rose-50"
                  title="Удалить правило"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(rule.word_boundaries ?? true)}
                    onChange={(event) => updateRule(index, "word_boundaries", event.target.checked)}
                    className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
                  />
                  Только как отдельное слово/фраза
                </label>
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(rule.case_sensitive ?? false)}
                    onChange={(event) => updateRule(index, "case_sensitive", event.target.checked)}
                    className="h-4 w-4 rounded border-[#d6e0e8] text-primary focus:ring-primary/20"
                  />
                  Учитывать регистр
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
