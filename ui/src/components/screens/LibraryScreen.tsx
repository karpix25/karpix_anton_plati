import { Search, RefreshCw, Link as LinkIcon, CheckCircle2, ArrowRight, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Reference } from "@/types";
import { patternTagStyle, huntStageTagStyle } from "@/lib/utils";

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

interface LibraryScreenProps {
  references: Reference[];
  isLoading: boolean;
  scenarioFilter: "all" | "with" | "without";
  setScenarioFilter: (filter: "all" | "with" | "without") => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onRefresh: () => void;
  onReferenceClick: (ref: Reference) => void;
}

export function LibraryScreen({
  references,
  isLoading,
  scenarioFilter,
  setScenarioFilter,
  searchQuery,
  setSearchQuery,
  onRefresh,
  onReferenceClick
}: LibraryScreenProps) {
  return (
    <div className="max-w-7xl space-y-10">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-foreground">Библиотека (Темы и паттерны)</h2>
          <p className="max-w-lg text-muted-foreground">
            Управляй загруженными из Telegram референсами, анализируй их темы и паттерны, открывай в детальном режиме и переписывай в новые сценарии.
          </p>
        </div>
        <Button
          variant="outline"
          className="h-12 rounded-xl border-none bg-white px-6 font-bold text-primary shadow-sm"
          onClick={onRefresh}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Обновить данные
        </Button>
      </div>

      <div className="rounded-2xl bg-[#f0f4f7] p-2">
        <div className="flex flex-wrap items-center gap-2">
          {(["all", "with", "without"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setScenarioFilter(filter)}
              className={`rounded-xl px-5 py-2 text-sm font-bold shadow-sm transition-all ${
                scenarioFilter === filter ? "bg-white text-primary" : "text-muted-foreground hover:bg-white/50"
              }`}
            >
              {filter === "all" ? "Все" : filter === "with" ? "Со сценарием" : "Без сценария"}
            </button>
          ))}
          <div className="mx-2 h-6 w-px bg-border/60" />
          <button className="flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Settings2 className="h-4 w-4" />
            Расширенные фильтры
          </button>
        </div>
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] transition-all">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="bg-[#f0f4f7] p-2 rounded-xl flex items-center max-w-md w-full">
              <Search className="mx-2 h-4 w-4 text-muted-foreground/50" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="w-full border-none bg-transparent text-sm focus:ring-0"
                placeholder="Фильтр по референсам..."
              />
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              {references.length} записей
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 w-full" />
              ))}
            </div>
          ) : references.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Хук</TableHead>
                  <TableHead>Тема</TableHead>
                  <TableHead>Паттерн</TableHead>
                  <TableHead>Стадия Ханта</TableHead>
                  <TableHead>Ссылка</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead>Статус</TableHead>
                  <TableHead className="w-[90px] text-right">Открыть</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {references.map((ref) => (
                  <TableRow
                    key={ref.id}
                    className="cursor-pointer"
                    onClick={() => onReferenceClick(ref)}
                  >
                    <TableCell className="max-w-[420px] font-medium text-foreground">
                      <div className="line-clamp-2">{ref.audit_json?.atoms?.verbal_hook || "Хук не определён"}</div>
                    </TableCell>
                    <TableCell className="max-w-[220px] text-muted-foreground">
                      <div className="line-clamp-2">
                        {ref.audit_json?.pattern_framework?.core_thesis || "Не выделена"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border border-current/10 ${patternTagStyle(ref.audit_json?.pattern_framework?.pattern_type)}`}>
                        {t(ref.audit_json?.pattern_framework?.pattern_type || "other")}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold shadow-sm ${huntStageTagStyle(ref.audit_json?.hunt_ladder?.stage)}`}>
                        <div className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                        {t(ref.audit_json?.hunt_ladder?.stage || "Не определена")}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[260px] text-muted-foreground">
                      <div className="flex items-center gap-1 truncate">
                        <LinkIcon className="h-3 w-3 shrink-0 text-primary" />
                        <span className="truncate">{ref.reels_url}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(ref.created_at).toLocaleDateString("ru-RU")}
                    </TableCell>
                    <TableCell>
                      {ref.audit_json?.pattern_framework?.core_thesis ? (
                        <Badge className="border-none bg-primary/10 text-primary">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          Размечено
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-border text-muted-foreground">
                          В очереди
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex rounded-lg bg-[#f0f4f7] p-2 text-muted-foreground">
                        <ArrowRight className="h-4 w-4" />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted-foreground">
              Ничего не найдено.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
