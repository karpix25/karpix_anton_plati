import React, { useState } from "react";
import { Settings } from "@/types";
import { Button } from "@/components/ui/button";
import { LoaderCircle, Wand2, Undo, Clock, ChevronRight } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface PromptEvolutionSettingsProps {
  draftSettings: Settings;
  selectedClientId: string | null;
  optimizingCategory: "scenario" | "visual" | "video" | null;
  handleOptimizePrompts: (category: "scenario" | "visual" | "video") => void;
  onRollbackPrompt: (category: "scenario" | "visual" | "video", historyId?: number) => void;
}

interface HistoryItem {
  id: number;
  rules_text: string;
  created_at: string;
}

export const PromptEvolutionSettings: React.FC<PromptEvolutionSettingsProps> = ({
  draftSettings,
  selectedClientId,
  optimizingCategory,
  handleOptimizePrompts,
  onRollbackPrompt,
}) => {
  const [historyCategory, setHistoryCategory] = useState<"scenario" | "visual" | "video" | null>(null);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const categories = [
    { id: "scenario", title: "Сценарий", rules: draftSettings.learned_rules_scenario },
    { id: "visual", title: "Визуал (B-roll)", rules: draftSettings.learned_rules_visual },
    { id: "video", title: "Видео (Prompts)", rules: draftSettings.learned_rules_video },
  ] as const;

  const fetchHistory = async (category: "scenario" | "visual" | "video") => {
    if (!selectedClientId) return;
    setIsLoadingHistory(true);
    setHistoryCategory(category);
    try {
      const res = await fetch(`/api/clients/prompt-history?clientId=${selectedClientId}&category=${category}`);
      if (!res.ok) throw new Error("Failed to fetch history");
      const data = await res.json();
      setHistoryItems(data.history || []);
    } catch (e) {
      console.error(e);
      setHistoryItems([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleRollbackAction = (category: "scenario" | "visual" | "video", id?: number) => {
    onRollbackPrompt(category, id);
    setHistoryCategory(null);
  };

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
              <div className="flex gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-400 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-full transition-colors"
                  onClick={() => fetchHistory(cat.id)}
                  disabled={!selectedClientId || optimizingCategory !== null}
                  title="Посмотреть историю версий"
                >
                  <Clock className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-slate-400 hover:text-amber-500 hover:bg-amber-500/10 rounded-full transition-colors"
                  onClick={() => handleRollbackAction(cat.id)}
                  disabled={!selectedClientId || optimizingCategory !== null || !cat.rules}
                  title="Откатить на предыдущую версию"
                >
                  <Undo className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-primary hover:bg-primary/5 rounded-full transition-colors"
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
            </div>
            
            <div className="flex-1 overflow-y-auto max-h-[140px] rounded-xl bg-slate-50 p-4 border border-dashed border-slate-200 scrollbar-thin">
               <p className="text-[11px] font-medium leading-relaxed text-slate-600">
                 {cat.rules ? cat.rules.split('\n').map((line, i) => (
                   <span key={i} className="block mb-1">{line}</span>
                 )) : <span className="italic text-slate-400">Ожидаем накопления фидбэка для формулирования правил...</span>}
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

      <Dialog open={historyCategory !== null} onOpenChange={(open) => !open && setHistoryCategory(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-indigo-500" />
              История эволюции: {categories.find(c => c.id === historyCategory)?.title}
            </DialogTitle>
            <DialogDescription>
              Выберите версию правил для просмотра или восстановления.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto pr-2">
            {isLoadingHistory ? (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <LoaderCircle className="h-8 w-8 animate-spin text-primary/20" />
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Загрузка истории...</p>
              </div>
            ) : historyItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="h-12 w-12 rounded-full bg-slate-50 flex items-center justify-center mb-3">
                  <Clock className="h-6 w-6 text-slate-200" />
                </div>
                <p className="text-sm font-medium text-slate-500">История изменений пуста.</p>
                <p className="text-xs text-slate-400 mt-1">Версии сохраняются автоматически при каждой оптимизации.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-slate-100">
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 w-[140px]">Дата</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">Правила</TableHead>
                    <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Действие</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyItems.map((item) => (
                    <TableRow key={item.id} className="group border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <TableCell className="text-[10px] font-medium text-slate-400 whitespace-nowrap">
                        {new Date(item.created_at).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          year: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </TableCell>
                      <TableCell>
                        <div className="text-[11px] leading-relaxed text-slate-600 line-clamp-3 max-w-[300px]">
                          {item.rules_text}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost" 
                          size="sm"
                          className="h-8 px-3 text-[10px] font-bold uppercase tracking-widest text-primary hover:bg-primary/5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleRollbackAction(historyCategory!, item.id)}
                        >
                          Восстановить
                          <ChevronRight className="ml-1 h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
