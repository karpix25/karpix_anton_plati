import { 
  Search, 
  Bell, 
  Settings2 
} from "lucide-react";

interface HeaderProps {
  screenTitle: string;
  selectedClientName?: string;
}

export function Header({ screenTitle, selectedClientName }: HeaderProps) {
  return (
    <header className="glass-panel fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-transparent px-4 xl:left-64 xl:px-8">
      <div className="flex items-center gap-4">
        <span className="text-lg font-bold tracking-tight text-foreground">{screenTitle}</span>
        <div className="h-4 w-px bg-border/70" />
        <button className="border-b-2 border-primary py-1 font-semibold text-primary">
          {selectedClientName || "Проект"}
        </button>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative hidden sm:block">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Поиск..."
            className="w-64 rounded-xl border-none bg-[#e8eff3] py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-primary/10"
          />
        </div>
        <button className="rounded-full p-2 text-muted-foreground hover:bg-[#e8eff3]">
          <Bell className="h-5 w-5" />
        </button>
        <button className="rounded-full p-2 text-muted-foreground hover:bg-[#e8eff3]">
          <Settings2 className="h-5 w-5" />
        </button>
        <div className="ml-1 h-8 w-8 rounded-full border border-border/20 bg-[#e8eff3]" />
      </div>
    </header>
  );
}
