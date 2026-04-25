import { useEffect, useState } from 'react';

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
  const [activeHref, setActiveHref] = useState<string>('#top');

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sections = NAV_LINKS
      .map((link) => document.getElementById(link.href.slice(1)))
      .filter((section): section is HTMLElement => Boolean(section));

    if (sections.length === 0) return;

    let frame = 0;

    const updateActiveSection = () => {
      const marker = 140;
      let nextActive = NAV_LINKS[0]?.href ?? '#top';

      for (let index = 0; index < sections.length; index += 1) {
        const section = sections[index];
        const sectionTop = section.getBoundingClientRect().top;
        if (sectionTop - marker <= 0) {
          nextActive = `#${section.id}`;
        }
      }

      setActiveHref(nextActive);
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateActiveSection();
      });
    };

    const syncFromHash = () => {
      if (!window.location.hash) return;
      setActiveHref(window.location.hash);
    };

    updateActiveSection();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    document.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('hashchange', syncFromHash);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      document.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('hashchange', syncFromHash);
    };
  }, []);

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
              aria-current={activeHref === link.href ? 'page' : undefined}
              className={`relative transition-colors after:absolute after:left-0 after:-bottom-1 after:w-full after:h-px after:bg-accent after:origin-left after:transition-transform ${
                activeHref === link.href
                  ? 'text-accent glow-text-accent after:scale-x-100'
                  : 'hover:text-foreground after:scale-x-0 hover:after:scale-x-100'
              }`}
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
            {authenticated ? 'Dashboard →' : 'Begin Review →'}
          </button>
        </div>
      </div>
    </nav>
  );
}
