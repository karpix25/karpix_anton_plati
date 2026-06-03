import React from "react";
import { Settings } from "@/types";

interface DeepgramKeywordSettingsProps {
  draftSettings: Settings;
  setDraftSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

const emptyRule = { display: "", variants: "" };

export const DeepgramKeywordSettings: React.FC<DeepgramKeywordSettingsProps> = ({
  draftSettings,
  setDraftSettings,
}) => {
  const rules = draftSettings.deepgram_vocabulary_rules?.length
    ? draftSettings.deepgram_vocabulary_rules
    : [emptyRule];

  const updateRule = (index: number, field: "display" | "variants", value: string) => {
    setDraftSettings((prev) => ({
      ...prev,
      deepgram_vocabulary_rules: rules.map((rule, currentIndex) =>
        currentIndex === index ? { ...rule, [field]: value } : rule
      ),
    }));
  };

  const addRule = () => {
    setDraftSettings((prev) => ({
      ...prev,
      deepgram_vocabulary_rules: [...(prev.deepgram_vocabulary_rules || []), emptyRule],
    }));
  };

  const removeRule = (index: number) => {
    setDraftSettings((prev) => ({
      ...prev,
      deepgram_vocabulary_rules: (prev.deepgram_vocabulary_rules || []).filter((_, currentIndex) => currentIndex !== index),
    }));
  };

  return (
    <section className="rounded-2xl border border-[#e5ebf0] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Словарь Deepgram
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Для брендов и терминов: слева финальное написание, справа варианты распознавания через запятую.
          </p>
        </div>
        <button
          type="button"
          onClick={addRule}
          className="rounded-xl border border-[#dfe7ee] bg-[#f8fafc] px-4 py-2 text-xs font-bold text-slate-700 transition hover:bg-white"
        >
          Добавить
        </button>
      </div>

      <div className="space-y-3">
        {rules.map((rule, index) => (
          <div key={index} className="grid gap-3 rounded-xl border border-[#edf2f6] bg-[#fbfcfd] p-3 md:grid-cols-[0.8fr_1.2fr_auto]">
            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Отображать как
              </span>
              <input
                value={rule.display}
                onChange={(event) => updateRule(index, "display", event.target.value)}
                placeholder="Nsis"
                className="h-11 w-full rounded-xl border border-[#dfe7ee] bg-white px-3 text-sm font-semibold text-foreground outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
              />
            </label>

            <label className="space-y-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Искать варианты
              </span>
              <input
                value={rule.variants}
                onChange={(event) => updateRule(index, "variants", event.target.value)}
                placeholder="Энсис, Энсес, Нсис, NSIS"
                className="h-11 w-full rounded-xl border border-[#dfe7ee] bg-white px-3 text-sm font-medium text-foreground outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10"
              />
            </label>

            <button
              type="button"
              onClick={() => removeRule(index)}
              className="self-end rounded-xl px-3 py-2 text-xs font-bold text-rose-500 transition hover:bg-rose-50 disabled:opacity-40"
              disabled={!draftSettings.deepgram_vocabulary_rules?.length}
            >
              Удалить
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-xl bg-[#f8fafc] px-4 py-3 text-xs leading-relaxed text-slate-500">
        Пример: <span className="font-semibold text-slate-700">Nsis</span> {"->"}{" "}
        <span className="font-semibold text-slate-700">Энсис, Энсес, Нсис</span>. Deepgram получит все варианты как
        подсказки, а в субтитрах найденные варианты будут заменены на Nsis.
      </div>
    </section>
  );
};
