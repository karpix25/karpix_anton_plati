import { useState, useMemo } from "react";
import { Palette, Grid3X3, Zap, LoaderCircle, Search, X, ChevronRight, Check, Shuffle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { TopicCard, StructureCard } from "@/types";
import { normalizePlaceholderText } from "@/lib/utils";

const TRANSLATIONS: Record<string, string> = {
  'how_to_list': 'Как сделать (Список)',
  'educational': 'Обучающий',
  'case_study': 'Кейс-стади',
  'solution_showcase': 'Демонстрация решения',
  'personal_story': 'Личная история',
  'myth_busting': 'Развенчание мифов',
  'problem_solution': 'Проблема-Решение',
  'comparison': 'Сравнение',
  'No Type': 'Без типа',
};

const t = (text: string) => TRANSLATIONS[text] || text;

interface GeneratorScreenProps {
  topicCards: TopicCard[];
  structureCards: StructureCard[];
  selectedTopic: TopicCard | null;
  setSelectedTopic: (topic: TopicCard | null) => void;
  selectedStructure: StructureCard | null;
  setSelectedStructure: (structure: StructureCard | null) => void;
  onDeleteTopicCard: (topicCardId: number) => void;
  onDeleteStructureCard: (structureCardId: number) => void;
  canDeleteCards: boolean;
  isDeletingTopicCard: boolean;
  isDeletingStructureCard: boolean;
  onGenerate: () => void;
  onGenerateRandomBatch: () => void;
  isGenerating: boolean;
}

export function GeneratorScreen({
  topicCards,
  structureCards,
  selectedTopic,
  setSelectedTopic,
  selectedStructure,
  setSelectedStructure,
  onDeleteTopicCard,
  onDeleteStructureCard,
  canDeleteCards,
  isDeletingTopicCard,
  isDeletingStructureCard,
  onGenerate,
  onGenerateRandomBatch,
  isGenerating
}: GeneratorScreenProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("Все");
  const [activePatternGroup, setActivePatternGroup] = useState<string | null>(null);

  // Grouping structures by pattern_type
  const groupedStructures = useMemo(() => {
    const groups: Record<string, StructureCard[]> = {};
    structureCards.forEach(s => {
      const type = normalizePlaceholderText(s.pattern_type) || "No Type";
      if (!groups[type]) groups[type] = [];
      groups[type].push(s);
    });
    return groups;
  }, [structureCards]);

  // Filtering based on search and selectedCategory (simulated categories for now)
  const filteredGroups = useMemo(() => {
    return Object.keys(groupedStructures).filter(type => {
      const items = groupedStructures[type];
      const matchesSearch = type.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           items.some(i => i.narrator_role?.toLowerCase().includes(searchTerm.toLowerCase()));
      
      // Basic category logic (just for demo/UI)
      if (selectedCategory === "Все") return matchesSearch;
      if (selectedCategory === "Продажи") return matchesSearch && type.includes("solution");
      if (selectedCategory === "Обучение") return matchesSearch && type.includes("how_to");
      return matchesSearch;
    });
  }, [groupedStructures, searchTerm, selectedCategory]);

  const categories = ["Все", "Продажи", "Обучение", "Кейсы", "Личный бренд"];

  const handlePatternClick = (type: string) => {
    const variations = groupedStructures[type];
    if (variations.length === 1) {
      setSelectedStructure(variations[0]);
    } else {
      setActivePatternGroup(type);
    }
  };

  return (
    <div className="max-w-7xl space-y-10">
      {/* Variations Drawer Overlay */}
      {activePatternGroup && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm transition-opacity" onClick={() => setActivePatternGroup(null)}>
          <div 
            className="h-full w-full max-w-md border-l bg-white/95 p-8 shadow-2xl backdrop-blur-xl animate-in slide-in-from-right duration-300 dark:bg-slate-900/95"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-8 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-extrabold text-foreground">{t(activePatternGroup)}</h3>
                <p className="text-sm text-muted-foreground">Выбери подходящую подачу (persona)</p>
              </div>
              <button onClick={() => setActivePatternGroup(null)} className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              {groupedStructures[activePatternGroup].map((variant) => (
                <button
                  key={variant.id}
                  onClick={() => {
                    setSelectedStructure(variant);
                    setActivePatternGroup(null);
                  }}
                  className={`group w-full rounded-2xl border-2 p-5 text-left transition-all ${
                    selectedStructure?.id === variant.id
                      ? "border-secondary bg-secondary/5 shadow-md"
                      : "border-transparent bg-slate-50 hover:border-slate-200 dark:bg-slate-800/50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="mb-2 font-bold text-foreground">{variant.narrator_role || "Без роли"}</h4>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {normalizePlaceholderText(variant.core_thesis) || "Тезис не определен"}
                      </p>
                    </div>
                    {selectedStructure?.id === variant.id && <Check className="h-5 w-5 text-secondary" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h2 className="mb-2 text-4xl font-extrabold tracking-tight text-foreground">Генератор (Mix)</h2>
          <p className="max-w-lg text-muted-foreground">
            Выбери одну тему и один паттерн, чтобы создать совершенно новый сценарий.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            className="h-12 rounded-xl px-6 font-bold"
            onClick={onGenerateRandomBatch}
            disabled={isGenerating || !topicCards.length || !structureCards.length}
          >
            {isGenerating ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Shuffle className="mr-2 h-4 w-4" />
            )}
            4 рандомных
          </Button>
          <Button
            className="primary-gradient h-12 rounded-xl px-8 font-bold text-white shadow-lg"
            onClick={onGenerate}
            disabled={!selectedTopic || !selectedStructure || isGenerating}
          >
            {isGenerating ? (
              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Zap className="mr-2 h-4 w-4" />
            )}
            Сгенерировать микс
          </Button>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-8 xl:grid-cols-[1fr_350px]">
        <div className="space-y-12">
          {/* STEP 1 */}
          <div>
            <div className="mb-6 flex items-center gap-2">
              <Palette className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">
                Шаг 1: Выбери тему
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {topicCards.map((topic) => (
                <button
                  key={topic.id}
                  onClick={() => setSelectedTopic(topic)}
                  className={`group relative rounded-2xl border-2 p-5 text-left transition-all ${
                    selectedTopic?.id === topic.id
                      ? "border-primary bg-primary/5 shadow-md scale-[1.02]"
                      : "border-transparent bg-white hover:border-[#f0f4f7] hover:bg-[#f0f4f7]/30 shadow-sm"
                  }`}
                >
                  <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0f4f7] text-primary group-hover:bg-white shadow-inner">
                    <Palette className="h-4 w-4" />
                  </div>
                  <h4 className="mb-1 text-sm font-bold leading-tight text-foreground">
                    {normalizePlaceholderText(topic.topic_short) || "Без названия"}
                  </h4>
                  <p className="line-clamp-2 text-[11px] text-muted-foreground">
                    {normalizePlaceholderText(topic.promise) || "Обещание не выявлено"}
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* STEP 2 */}
          <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <Grid3X3 className="h-5 w-5 text-secondary" />
                <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-foreground">
                  Шаг 2: Выбери паттерн
                </h3>
              </div>
              
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input 
                  placeholder="Поиск по паттернам..." 
                  className="rounded-full bg-white pl-10 shadow-sm transition-all focus-visible:ring-secondary/20 h-10 border-slate-100"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            {/* Category Chips */}
            <div className="flex flex-wrap gap-2">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold transition-all ${
                    selectedCategory === cat
                      ? "bg-secondary text-white shadow-md"
                      : "bg-white text-muted-foreground hover:bg-slate-50 border border-slate-100"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredGroups.map((type) => {
                const variations = groupedStructures[type];
                const isSelected = selectedStructure && variations.some(v => v.id === selectedStructure.id);
                
                return (
                  <button
                    key={type}
                    onClick={() => handlePatternClick(type)}
                    className={`group relative flex flex-col rounded-2xl border-2 p-5 text-left transition-all ${
                      isSelected
                        ? "border-secondary bg-secondary/5 shadow-md scale-[1.02]"
                        : "border-transparent bg-white hover:border-[#f0f4f7] hover:bg-[#f0f4f7]/30 shadow-sm"
                    }`}
                  >
                    <div className="mb-4 flex items-center justify-between">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#f0f4f7] text-secondary group-hover:bg-white shadow-inner">
                        <Grid3X3 className="h-4 w-4" />
                      </div>
                      {variations.length > 1 && (
                        <Badge variant="secondary" className="bg-secondary/10 text-[10px] font-bold text-secondary border-none">
                          {variations.length} вар.
                        </Badge>
                      )}
                    </div>
                    
                    <h4 className="mb-2 text-sm font-extrabold leading-tight text-foreground uppercase tracking-tight">
                      {t(type)}
                    </h4>
                    
                    <div className="mt-auto flex items-center justify-between pt-2 border-t border-slate-50">
                      <p className="line-clamp-1 text-[11px] text-muted-foreground italic">
                        {variations.length === 1 ? variations[0].narrator_role : "Несколько сценариев"}
                      </p>
                      <ChevronRight className={`h-4 w-4 transition-transform ${isSelected ? "text-secondary" : "text-slate-300 group-hover:translate-x-1"}`} />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Builder Sidebar */}
        <div className="relative">
          <div className="sticky top-24 space-y-6">
            <div className="rounded-2xl border border-slate-100 bg-white/70 p-6 shadow-xl backdrop-blur-md">
              <h3 className="mb-6 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Конструктор микса
              </h3>
              <div className="mb-6 space-y-4">
                <div className="rounded-xl border border-primary/10 bg-primary/5 p-4 transition-all">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[9px] font-extrabold uppercase text-primary/60">Слой Темы</p>
                    {canDeleteCards && selectedTopic ? (
                      <Button
                        variant="destructive"
                        size="icon-xs"
                        onClick={() => onDeleteTopicCard(selectedTopic.id)}
                        disabled={isDeletingTopicCard}
                        aria-label={`Удалить тему ${selectedTopic.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-sm font-medium">{selectedTopic?.topic_short || "Не выбрано"}</p>
                </div>
                <div className="rounded-xl border border-secondary/10 bg-secondary/5 p-4 transition-all">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[9px] font-extrabold uppercase text-secondary/60">Слой Паттерна</p>
                    {canDeleteCards && selectedStructure ? (
                      <Button
                        variant="destructive"
                        size="icon-xs"
                        onClick={() => onDeleteStructureCard(selectedStructure.id)}
                        disabled={isDeletingStructureCard}
                        aria-label={`Удалить паттерн ${selectedStructure.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-sm font-medium">
                    {selectedStructure ? (
                      <span className="flex flex-col">
                        <span className="font-bold">{t(selectedStructure.pattern_type as string)}</span>
                        <span className="text-[10px] text-muted-foreground italic line-clamp-1">
                          {selectedStructure.narrator_role}
                        </span>
                      </span>
                    ) : "Не выбрано"}
                  </p>
                </div>
              </div>
              
              <div className="rounded-xl bg-slate-50 p-6 border border-slate-100">
                <p className="text-xs leading-relaxed text-slate-500">
                  Выбранный микс объединит <span className="font-bold text-primary">«{selectedTopic?.topic_short || "Темы"}»</span> с логикой <span className="font-bold text-secondary">«{selectedStructure?.narrator_role || "Паттерна"}»</span>.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
