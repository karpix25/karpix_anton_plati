interface HeaderProps {
  screenTitle: string;
  selectedClientName?: string;
}

export function Header({ screenTitle, selectedClientName }: HeaderProps) {
  return (
    <header className="glass-panel fixed left-0 right-0 top-0 z-40 flex h-16 items-center border-b border-transparent px-4 xl:left-64 xl:px-8">
      <div className="flex items-center gap-4">
        <span className="text-lg font-bold tracking-tight text-foreground">{screenTitle}</span>
        <div className="h-4 w-px bg-border/70" />
        <button className="max-w-[min(55vw,520px)] truncate border-b-2 border-primary py-1 font-semibold text-primary">
          {selectedClientName || "Проект"}
        </button>
      </div>
    </header>
  );
}
