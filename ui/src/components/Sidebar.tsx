import { 
  BarChart3, 
  Sparkles, 
  HelpCircle, 
  Archive 
} from "lucide-react";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { navItems } from "@/lib/constants";
import { Client, Screen } from "@/types";

interface SidebarProps {
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
  clients: Client[];
  isLoadingClients: boolean;
  screen: Screen;
  setScreen: (screen: Screen) => void;
}

export function Sidebar({
  selectedClientId,
  setSelectedClientId,
  clients,
  isLoadingClients,
  screen,
  setScreen
}: SidebarProps) {
  return (
    <aside className="fixed left-0 top-0 z-50 hidden h-screen w-64 flex-col border-r border-transparent bg-[#f0f4f7] p-4 xl:flex">
      <div className="mb-8 px-2 py-4">
        <div className="flex items-center gap-3">
          <div className="primary-gradient flex h-10 w-10 items-center justify-center rounded-xl text-white shadow-lg">
            <BarChart3 className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-black leading-none text-foreground">Precision Layer</h1>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Контент-движок
            </p>
          </div>
        </div>
      </div>

      <div className="mb-6 space-y-2">
        <Select
          value={selectedClientId}
          onValueChange={setSelectedClientId}
          disabled={isLoadingClients || !clients.length}
        >
          <SelectTrigger className="h-12 rounded-xl border-none bg-white text-sm font-medium shadow-sm">
            <SelectValue placeholder="Выберите проект" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((client) => (
              <SelectItem key={client.id} value={client.id.toString()}>
                {client.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button className="primary-gradient mb-6 h-12 w-full justify-center rounded-xl text-xs font-bold uppercase tracking-wider text-white shadow-md">
        <Sparkles className="mr-2 h-4 w-4" />
        Новый проект
      </Button>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setScreen(item.id)}
            className={`w-full rounded-lg px-4 py-3 text-left transition-all duration-200 hover:translate-x-1 ${
              screen === item.id
                ? "bg-white font-bold text-primary shadow-sm"
                : "text-muted-foreground hover:bg-[#e8eff3]"
            }`}
          >
            <div className="flex items-center gap-3">
              <item.icon className="h-5 w-5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">{item.label}</span>
            </div>
          </button>
        ))}
      </nav>

      <div className="space-y-1 border-t border-border/20 pt-4">
        <button className="flex w-full items-center gap-3 px-4 py-2 text-muted-foreground hover:text-primary">
          <HelpCircle className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Поддержка</span>
        </button>
        <button className="flex w-full items-center gap-3 px-4 py-2 text-muted-foreground hover:text-primary">
          <Archive className="h-5 w-5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Архив</span>
        </button>
      </div>
    </aside>
  );
}
