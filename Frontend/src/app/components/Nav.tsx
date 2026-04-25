export function Nav() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 py-6 bg-background/80 backdrop-blur-sm border-b border-border/50">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between">
        <div className="flex items-center gap-1 text-lg md:text-xl">
          <span className="text-accent">L</span>
          <span className="text-accent">_</span>
        </div>

        <div className="flex items-center gap-4 md:gap-8">
          <a href="#learn" className="hidden md:inline text-foreground/60 hover:text-foreground transition-colors">
            Learn
          </a>
          <a href="#examples" className="hidden md:inline text-foreground/60 hover:text-foreground transition-colors">
            Examples
          </a>
          <a href="#pricing" className="hidden md:inline text-foreground/60 hover:text-foreground transition-colors">
            Pricing
          </a>
          <button className="px-4 md:px-6 py-2 text-sm md:text-base border border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all">
            Start Reading →
          </button>
        </div>
      </div>
    </nav>
  );
}
