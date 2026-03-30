import { X, ExternalLink, FolderOpen, Palette, Grid3X3, Sparkles, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Reference, Client } from "@/types";
import { huntStageTagStyle } from "@/lib/utils";

const TRANSLATIONS: Record<string, string> = {
  // Pattern Types
  'how_to_list': 'Как сделать (Список)',
  'educational': 'Обучающий',
  'case_study': 'Кейс-стади',
  'solution_showcase': 'Демонстрация решения',
  'personal_story': 'Личная история',
  'myth_busting': 'Развенчание мифов',
  'problem_solution': 'Проблема-Решение',
  'comparison': 'Сравнение',
  'other': 'Другое',
  
  // Hunt Stages
  'Awareness': 'Осведомленность',
  'Consideration': 'Рассмотрение',
  'Solution': 'Решение',
};

const t = (text: string) => TRANSLATIONS[text] || text;

interface ReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  reference: Reference | null;
  selectedClient?: Client;
  onRewrite: (id: number) => void;
  isRewriting: boolean;
}

export function ReferenceModal({
  isOpen,
  onClose,
  reference,
  selectedClient,
  onRewrite,
  isRewriting
}: ReferenceModalProps) {
  if (!isOpen || !reference) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[#2a3439]/55 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-7xl overflow-y-auto rounded-[28px] bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-white/95 px-6 py-5 backdrop-blur">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-border bg-muted text-muted-foreground uppercase tracking-widest text-[9px]">
                {t(reference.niche || "General")}
              </Badge>
              {reference.audit_json?.pattern_framework?.pattern_type && (
                <Badge className="border-none bg-primary/10 text-primary uppercase tracking-widest text-[9px]">
                  {t(reference.audit_json.pattern_framework.pattern_type)}
                </Badge>
              )}
              {reference.audit_json?.hunt_ladder?.stage && (
                <div className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold ${huntStageTagStyle(reference.audit_json.hunt_ladder.stage)}`}>
                  {t(reference.audit_json.hunt_ladder.stage)}
                </div>
              )}
              {reference.scenario_json?.script && (
                <Badge className="border-none bg-emerald-100 text-emerald-700 uppercase tracking-widest text-[9px]">
                  сценарий готов
                </Badge>
              )}
            </div>
            <h3 className="text-2xl font-bold tracking-tight text-foreground">
              {reference.audit_json?.atoms?.verbal_hook || "Детальный просмотр"}
            </h3>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl border-border bg-white"
              onClick={() => onRewrite(reference.id)}
              disabled={isRewriting}
            >
              {isRewriting ? (
                <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              Переписать
            </Button>
            <Button variant="ghost" size="icon" className="rounded-xl" asChild>
              <a href={reference.reels_url} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
            <Button variant="ghost" size="icon" className="rounded-xl" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 p-6 xl:grid-cols-3">
          <section className="rounded-xl bg-white p-6 shadow-sm xl:col-span-1">
            <div className="mb-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <FolderOpen className="h-4 w-4 text-primary" />
                  Оригинальный скрипт
                </h3>
                <a
                  href={reference.reels_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[10px] font-bold text-primary"
                >
                  ИСТОЧНИК <ExternalLink className="h-3 w-3" />
                </a>
              </div>
              
              {(reference.word_count || reference.duration_seconds) && (
                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  {reference.word_count && <span>{reference.word_count} слов</span>}
                  {reference.word_count && reference.duration_seconds && <span>•</span>}
                  {reference.duration_seconds && <span>{reference.duration_seconds} сек</span>}
                </div>
              )}
            </div>
            <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
              <p>{reference.transcript || "Текст не найден."}</p>
            </div>
          </section>

          <section className="space-y-6 xl:col-span-1">
            <div className="relative rounded-xl bg-[#f0f4f7] p-6">
              <div className="absolute left-0 top-0 h-full w-1 bg-primary" />
              <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Извлеченная тема
              </h3>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-primary shadow-sm">
                  <Palette className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold">
                    {reference.audit_json?.pattern_framework?.core_thesis || "Тема не выделена"}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {reference.audit_json?.pattern_framework?.content_shape?.format_type || "Формат не определён"}
                  </p>
                </div>
              </div>
            </div>

            <div className="relative rounded-xl bg-[#f0f4f7] p-6">
              <div className="absolute left-0 top-0 h-full w-1 bg-secondary" />
              <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                Логика паттерна
              </h3>
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white text-secondary shadow-sm">
                  <Grid3X3 className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-sm font-bold">
                    {t(reference.audit_json?.pattern_framework?.pattern_type || "Паттерн не выделен")}
                  </h4>
                  <p className="text-xs text-muted-foreground">
                    {reference.audit_json?.pattern_framework?.narrator_role || "Роль автора не определена"}
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl bg-[#2a3439] p-8 text-white shadow-2xl xl:col-span-1">
            <h3 className="mb-6 text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
              Сгенерированный сценарий
            </h3>
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">
                  {t(reference.scenario_json?.pattern_type || "Новый сценарий")}
                </h2>
                <p className="mt-2 text-xs italic text-white/60">
                  Целевой сектор: {selectedClient?.name || "Проект не выбран"}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 p-5">
                <p className="text-sm leading-relaxed text-white/80">
                  {reference.scenario_json?.script || "Пока нет сценария. Нажми «Переписать» или запусти batch generation."}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-lg bg-white/5 p-4">
                  <p className="mb-1 text-[10px] font-bold uppercase text-indigo-300">Жизнеспособность</p>
                  <p className="text-lg font-bold">Высокая</p>
                </div>
                <div className="rounded-lg bg-white/5 p-4">
                  <p className="mb-1 text-[10px] font-bold uppercase text-indigo-300">Сложность</p>
                  <p className="text-lg font-bold">Средняя</p>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
