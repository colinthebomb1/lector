interface NavProps {
  onAuthClick?: () => void;
  authenticated?: boolean;
}

const NAV_LINKS = [
  { href: '#tracks', label: 'Tracks' },
  { href: '#how-it-works', label: 'Pipeline' },
  { href: '#agents', label: 'Agents' },
];

export function Nav({ onAuthClick, authenticated = false }: NavProps) {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-4 md:px-8 py-4 bg-background/70 backdrop-blur-md border-b border-border/50">
      <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-6">
        <a href="#top" className="flex items-center gap-2 group">
          <span className="relative flex items-center gap-1 text-lg md:text-xl">
            <span className="text-accent group-hover:glow-text-accent transition-all">L</span>
            <span className="text-accent group-hover:glow-text-accent transition-all">_</span>
          </span>
          <span className="hidden sm:inline text-xs uppercase tracking-[0.25em] text-muted-foreground group-hover:text-foreground/80 transition-colors">
            lector
          </span>
        </a>

        <div className="hidden md:flex items-center gap-8 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="relative hover:text-foreground transition-colors after:absolute after:left-0 after:-bottom-1 after:w-full after:h-px after:bg-accent after:scale-x-0 hover:after:scale-x-100 after:origin-left after:transition-transform"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3 md:gap-4">
          <button
            onClick={onAuthClick}
            className="px-4 md:px-6 py-2 text-sm md:text-base border border-accent text-accent hover:bg-accent hover:text-accent-foreground transition-all"
          >
            {authenticated ? 'Dashboard →' : 'Begin review →'}
          </button>
        </div>
      </div>
    </nav>
  );
}
