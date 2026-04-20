import { Search, RefreshCw, Link as LinkIcon, CheckCircle2, ArrowRight, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Reference, StructureCard, TopicCard } from "@/types";
import { patternTagStyle, huntStageTagStyle, normalizePlaceholderText } from "@/lib/utils";

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
const HUNT_STAGE_FALLBACK = "Осознает проблему";

interface LibraryScreenProps {
  references: Reference[];
  topicCards: TopicCard[];
  structureCards: StructureCard[];
  isLoading: boolean;
  scenarioFilter: "all" | "with" | "without";
  setScenarioFilter: (filter: "all" | "with" | "without") => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onRefresh: () => void;
  onReferenceClick: (ref: Reference) => void;
  onDeleteTopicCard: (topicCardId: number) => void;
  onDeleteStructureCard: (structureCardId: number) => void;
  canDeleteCards: boolean;
  isDeletingTopicCard: boolean;
  isDeletingStructureCard: boolean;
}

export function LibraryScreen({
  references,
  topicCards,
  structureCards,
  isLoading,
  scenarioFilter,
  setScenarioFilter,
  searchQuery,
  setSearchQuery,
  onRefresh,
  onReferenceClick,
  onDeleteTopicCard,
  onDeleteStructureCard,
  canDeleteCards,
  isDeletingTopicCard,
  isDeletingStructureCard,
}: LibraryScreenProps) {
  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredTopicCards = topicCards.filter((topic) => {
    if (!normalizedSearch) return true;
    return [
      normalizePlaceholderText(topic.topic_short),
      normalizePlaceholderText(topic.topic_cluster),
      normalizePlaceholderText(topic.topic_angle),
      normalizePlaceholderText(topic.promise),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });
  const filteredStructureCards = structureCards.filter((structure) => {
    if (!normalizedSearch) return true;
    return [
      normalizePlaceholderText(structure.pattern_type),
      normalizePlaceholderText(structure.narrator_role),
      normalizePlaceholderText(structure.core_thesis),
      normalizePlaceholderText(structure.hook_style),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });

  return (
    <div className="max-w-7xl space-y-10">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h2 className="text-4xl font-extrabold tracking-tight text-foreground">Библиотека (Темы и паттерны)</h2>
          <p className="max-w-lg text-muted-foreground">
            Управляй загруженными из Telegram референсами, анализируй их темы и паттерны, открывай в детальном режиме, переписывай в новые сценарии и при необходимости удаляй.
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
                {references.map((ref) => {
                  const coreThesis =
                    normalizePlaceholderText(ref.audit_json?.pattern_framework?.core_thesis) ||
                    normalizePlaceholderText(ref.audit_json?.reference_strategy?.topic_cluster);
                  const patternType =
                    normalizePlaceholderText(ref.audit_json?.pattern_framework?.pattern_type) || "other";
                  const huntStage =
                    normalizePlaceholderText(ref.audit_json?.hunt_ladder?.stage) || HUNT_STAGE_FALLBACK;

                  return (
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
                        {coreThesis || "Не выделена"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border border-current/10 ${patternTagStyle(patternType)}`}>
                        {t(patternType)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className={`inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold shadow-sm ${huntStageTagStyle(huntStage)}`}>
                        <div className="mr-1.5 h-1.5 w-1.5 rounded-full bg-current opacity-40" />
                        {t(huntStage)}
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
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-white p-10 text-center text-sm text-muted-foreground">
              Ничего не найдено.
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-extrabold tracking-tight text-foreground">Темы</h3>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {filteredTopicCards.length} шт.
              </span>
            </div>
            {filteredTopicCards.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Тема</TableHead>
                    <TableHead>Угол</TableHead>
                    {canDeleteCards ? <TableHead className="w-[70px] text-right">Удалить</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredTopicCards.map((topic) => (
                    <TableRow key={topic.id}>
                      <TableCell className="max-w-[220px]">
                        <div className="line-clamp-2 font-medium text-foreground">
                          {normalizePlaceholderText(topic.topic_short) || normalizePlaceholderText(topic.topic_cluster) || "Без темы"}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] text-muted-foreground">
                        <div className="line-clamp-2">
                          {normalizePlaceholderText(topic.topic_angle) || "Без угла"}
                        </div>
                      </TableCell>
                      {canDeleteCards ? (
                        <TableCell className="text-right">
                          <Button
                            variant="destructive"
                            size="icon-xs"
                            onClick={() => onDeleteTopicCard(topic.id)}
                            disabled={isDeletingTopicCard}
                            aria-label={`Удалить тему ${topic.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                Темы не найдены.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-zinc-100 bg-white p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-extrabold tracking-tight text-foreground">Паттерны</h3>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {filteredStructureCards.length} шт.
              </span>
            </div>
            {filteredStructureCards.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Тип</TableHead>
                    <TableHead>Роль</TableHead>
                    {canDeleteCards ? <TableHead className="w-[70px] text-right">Удалить</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStructureCards.map((structure) => {
                    const patternType = normalizePlaceholderText(structure.pattern_type) || "other";
                    return (
                      <TableRow key={structure.id}>
                        <TableCell>
                          <span className={`inline-flex rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border border-current/10 ${patternTagStyle(patternType)}`}>
                            {t(patternType)}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[220px] text-muted-foreground">
                          <div className="line-clamp-2">
                            {normalizePlaceholderText(structure.narrator_role) || "Без роли"}
                          </div>
                        </TableCell>
                        {canDeleteCards ? (
                          <TableCell className="text-right">
                            <Button
                              variant="destructive"
                              size="icon-xs"
                              onClick={() => onDeleteStructureCard(structure.id)}
                              disabled={isDeletingStructureCard}
                              aria-label={`Удалить паттерн ${structure.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                Паттерны не найдены.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
