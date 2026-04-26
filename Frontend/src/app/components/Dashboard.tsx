import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type ChallengeSummary,
  type CurrentUser,
  type Difficulty,
  type Track,
} from '../lib/api';
import { listCodeReviewChallenges } from '../data/codeReviewChallenges';

interface DashboardProps {
  user: CurrentUser;
  onProfileClick: () => void;
  onSelectChallenge?: (challenge: ChallengeSummary) => void;
}

/** Code-review items shown in the list before the backend has full content. */
type DashboardChallenge = ChallengeSummary & { isPreview?: boolean; isTodo?: boolean };

const TODO_CHALLENGE_IDS = new Set([
  'csrf-profile-email-change',
  'idor-invoice-download',
  'jwt-none-alg-bypass',
  'ssrf-metadata-fetcher',
]);

// Code-review challenges are currently driven by frontend-only data (see
// `src/app/data/codeReviewChallenges.ts`). They show up alongside backend
// challenges in the dashboard list.
const CODE_REVIEW_CHALLENGES: DashboardChallenge[] = listCodeReviewChallenges().map(
  (entry) => entry.summary,
);

const DIFFICULTY_TONE: Record<Difficulty, string> = {
  easy: 'text-green-400 border-green-400/30 bg-green-400/5',
  medium: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  hard: 'text-red-400 border-red-400/30 bg-red-400/5',
};

const TRACK_OPTIONS: { value: Track; label: string }[] = [
  { value: 'security', label: 'Security' },
  { value: 'code-review', label: 'Code review' },
];

const DIFFICULTY_ORDER: Record<Difficulty, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
};

function formatChallengeNumber(value?: number): string {
  return value ? `#${value}` : '#-';
}

function FlameIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12.5 2.25c.18 1.7-.4 3.1-1.46 4.32-1.05 1.21-2.43 2.27-3.4 3.66a6.5 6.5 0 0 0-1.18 4.27c.32 4.04 3.71 7 7.62 7s7.06-3.13 7.06-7.06c0-3.21-1.74-5.27-3.5-7.32-1.16-1.34-2.36-2.74-2.78-4.83-.05-.25-.36-.32-.51-.12-.84 1.13-1.45 2.5-1.85 4.04-.95-1.06-1.5-2.32-2-3.96Z" />
    </svg>
  );
}

function UserIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
    </svg>
  );
}

export function Dashboard({ user, onProfileClick, onSelectChallenge }: DashboardProps) {
  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [selectedTracks, setSelectedTracks] = useState<Set<Track>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([api.challenges(), api.categories()])
      .then(([list, cats]) => {
        if (cancelled) return;
        setChallenges(list);
        setCategories(cats.categories);
        setError(null);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const showSecurity = selectedTracks.size === 0 || selectedTracks.has('security');
  const showCodeReview = selectedTracks.size === 0 || selectedTracks.has('code-review');

  // Category filter only applies to security; clear selections when security is hidden
  // so the filter pill doesn't keep stale state when the user reopens the security track.
  useEffect(() => {
    if (!showSecurity && selectedCategories.size > 0) {
      setSelectedCategories(new Set());
    }
  }, [showSecurity, selectedCategories]);

  const challengesWithPreviews = useMemo(() => {
    const byId = new Map<string, ChallengeSummary>();
    for (const c of challenges) {
      byId.set(c.id, c);
    }
    for (const p of CODE_REVIEW_CHALLENGES) {
      if (!byId.has(p.id)) {
        byId.set(p.id, p);
      }
    }
    return Array.from(byId.values()).map((challenge) => ({
      ...challenge,
      isTodo: TODO_CHALLENGE_IDS.has(challenge.id),
    }));
  }, [challenges]);

  const sortChallenges = (list: ChallengeSummary[]) =>
    [...list].sort((a, b) => {
      const difficultyDelta = DIFFICULTY_ORDER[a.difficulty] - DIFFICULTY_ORDER[b.difficulty];
      if (difficultyDelta !== 0) return difficultyDelta;
      return a.name.localeCompare(b.name);
    });

  const challengeNumberById = useMemo(() => {
    const ordered = sortChallenges(challengesWithPreviews);
    return new Map(ordered.map((challenge, index) => [challenge.id, index + 1]));
  }, [challengesWithPreviews]);

  const challengesWithNumbers = useMemo(
    () =>
      challengesWithPreviews.map((challenge) => ({
        ...challenge,
        display_number: challengeNumberById.get(challenge.id),
      })),
    [challengeNumberById, challengesWithPreviews],
  );

  const securityChallenges = useMemo(() => {
    if (!showSecurity) return [];
    let scoped = challengesWithNumbers.filter((c) => c.track === 'security');
    if (selectedCategories.size > 0) {
      scoped = scoped.filter((c) => selectedCategories.has(c.category));
    }
    return sortChallenges(scoped);
  }, [challengesWithNumbers, selectedCategories, showSecurity]);

  const codeReviewChallenges = useMemo(() => {
    if (!showCodeReview) return [];
    return sortChallenges(
      challengesWithNumbers.filter((c) => c.track === 'code-review'),
    );
  }, [challengesWithNumbers, showCodeReview]);

  const totalVisible = securityChallenges.length + codeReviewChallenges.length;

  const completed = new Set(user.challenges_completed ?? []);
  const streak = user.streak ?? 0;
  const displayName = user.name ?? user.nickname ?? 'reader';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1280px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1 text-lg md:text-xl">
            <span className="text-accent">L</span>
            <span className="text-accent">_</span>
          </div>

          <div className="flex items-center gap-3 md:gap-6">
            {showSecurity && (
              <MultiSelectDropdown
                label="Category"
                allLabel="All categories"
                options={categories.map((c) => ({ value: c, label: c }))}
                selected={selectedCategories}
                onChange={(next) => setSelectedCategories(next)}
              />
            )}

            <MultiSelectDropdown
              label="Track"
              allLabel="All tracks"
              options={TRACK_OPTIONS}
              selected={selectedTracks}
              onChange={(next) => setSelectedTracks(next as Set<Track>)}
            />

            <div
              className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm"
              title={
                streak > 0
                  ? `${streak}-day streak`
                  : 'Solve a challenge today to start a streak'
              }
            >
              <FlameIcon
                className={`w-4 h-4 ${streak > 0 ? 'text-orange-400' : 'text-muted-foreground'}`}
              />
              <span className={streak > 0 ? 'text-foreground' : 'text-muted-foreground'}>
                {streak}
              </span>
            </div>

            <button
              type="button"
              onClick={onProfileClick}
              className="flex items-center gap-2 px-3 py-2 border border-border rounded text-sm hover:border-accent hover:text-accent hover:bg-foreground/5 transition-colors cursor-pointer"
              title="Profile"
            >
              <UserIcon className="w-4 h-4" />
              <span className="hidden md:inline">{displayName}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1280px] mx-auto px-4 md:px-8 py-10">
        <div className="mb-8">
          <h1 className="text-2xl md:text-3xl mb-2">Welcome back, {displayName}.</h1>
          <p className="text-sm text-muted-foreground">
            {totalVisible} challenge{totalVisible === 1 ? '' : 's'}
            {selectedTracks.size > 0
              ? ` · ${[...selectedTracks]
                  .map((t) => TRACK_OPTIONS.find((o) => o.value === t)?.label ?? t)
                  .join(', ')} track${selectedTracks.size === 1 ? '' : 's'}`
              : ''}
            {showSecurity && selectedCategories.size > 0
              ? ` · ${[...selectedCategories].join(', ')}`
              : ''} • {completed.size}{' '}
            completed • {user.total_score ?? 0} points
          </p>
        </div>

        {loading && <p className="text-sm text-muted-foreground">Loading challenges...</p>}
        {error && (
          <p className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-3 py-2">
            {error}
          </p>
        )}

        {!loading && !error && totalVisible === 0 && (
          <div className="border border-dashed border-border rounded p-10 text-center text-sm text-muted-foreground">
            No challenges match the current filters.
          </div>
        )}

        {!loading && !error && totalVisible > 0 && (
          <div className="flex flex-col gap-6">
            {showSecurity && (
              <ChallengeSection
                title="Security"
                count={securityChallenges.length}
                challenges={securityChallenges}
                completed={completed}
                onSelectChallenge={onSelectChallenge}
                emptyText="No security challenges match the current filters."
              />
            )}
            {showCodeReview && (
              <ChallengeSection
                title="Code Review"
                count={codeReviewChallenges.length}
                challenges={codeReviewChallenges}
                completed={completed}
                onSelectChallenge={onSelectChallenge}
                emptyText="No code review challenges yet."
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

interface MultiSelectOption {
  value: string;
  label: string;
}

interface MultiSelectDropdownProps {
  label: string;
  allLabel: string;
  options: MultiSelectOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

function MultiSelectDropdown({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocPointerDown = (event: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const summary =
    selected.size === 0
      ? allLabel
      : selected.size === 1
        ? options.find((o) => selected.has(o.value))?.label ?? `${selected.size} selected`
        : `${selected.size} selected`;

  return (
    <div ref={wrapperRef} className="relative">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground hidden md:inline">{label}</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="bg-background border border-border rounded px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent transition-colors flex items-center gap-2 min-w-[10rem] justify-between cursor-pointer"
        >
          <span className="truncate text-left">{summary}</span>
          <span
            className={`text-muted-foreground text-[10px] transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden="true"
          >
            ▼
          </span>
        </button>
      </label>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 mt-2 w-56 max-h-72 overflow-y-auto bg-background border border-border rounded shadow-lg z-50 py-1"
        >
          <button
            type="button"
            onClick={() => onChange(new Set())}
            className="w-full text-left px-3 py-2 text-xs uppercase tracking-wider text-muted-foreground hover:bg-foreground/5 cursor-pointer"
          >
            {allLabel}
          </button>
          <div className="border-t border-border my-1" />
          {options.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No options</p>
          ) : (
            options.map((o) => {
              const checked = selected.has(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  onClick={() => toggle(o.value)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-foreground/5 text-foreground text-left cursor-pointer"
                >
                  <span
                    className={`w-4 h-4 border rounded flex items-center justify-center flex-shrink-0 text-[10px] ${
                      checked
                        ? 'bg-accent border-accent text-accent-foreground'
                        : 'border-border'
                    }`}
                    aria-hidden="true"
                  >
                    {checked ? '✓' : ''}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

interface ChallengeSectionProps {
  title: string;
  count: number;
  challenges: ChallengeSummary[];
  completed: Set<string>;
  onSelectChallenge?: (challenge: ChallengeSummary) => void;
  emptyText: string;
}

function ChallengeSection({
  title,
  count,
  challenges,
  completed,
  onSelectChallenge,
  emptyText,
}: ChallengeSectionProps) {
  const [open, setOpen] = useState(true);
  const sectionId = `challenge-section-${title.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <section
      className={`border border-border rounded-lg bg-card/40 flex flex-col min-h-0 ${open ? 'max-h-[55vh]' : ''}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={sectionId}
        className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-background/40 hover:bg-foreground/5 transition-colors text-left cursor-pointer rounded-t-lg"
      >
        <div className="flex items-center gap-3">
          <span
            className={`text-muted-foreground text-xs transition-transform ${open ? 'rotate-90' : ''}`}
            aria-hidden="true"
          >
            ▶
          </span>
          <h2 className="text-sm uppercase tracking-[0.2em] text-foreground/85 font-semibold">
            {title}
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          {count} {count === 1 ? 'challenge' : 'challenges'}
        </span>
      </button>
      {open && (
        <div
          id={sectionId}
          className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2"
        >
          {challenges.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-6 text-center">
              {emptyText}
            </p>
          ) : (
            challenges.map((c) => (
              <ChallengeRow
                key={c.id}
                challenge={c}
                completed={completed}
                onSelectChallenge={onSelectChallenge}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}

interface ChallengeRowProps {
  challenge: ChallengeSummary;
  completed: Set<string>;
  onSelectChallenge?: (challenge: ChallengeSummary) => void;
}

function ChallengeRow({ challenge, completed, onSelectChallenge }: ChallengeRowProps) {
  const row = challenge as DashboardChallenge;
  const isPreview = Boolean(row.isPreview);
  const isTodo = Boolean(row.isTodo);
  const isUnavailable = isPreview || isTodo;
  const done =
    !isUnavailable && (completed.has(challenge.id) || completed.has(`${challenge.id}:attack`));

  return (
    <div
      className={`w-full border border-border rounded px-4 py-4 grid grid-cols-12 items-center gap-4 transition-colors ${
        isUnavailable
          ? 'bg-foreground/[0.02] opacity-80'
          : 'hover:border-accent/60 hover:bg-foreground/5'
      }`}
    >
      <span className="col-span-12 md:col-span-6 flex items-center gap-2 min-w-0">
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground border border-border/70 rounded px-2 py-0.5 flex-shrink-0">
          {formatChallengeNumber(challenge.display_number)}
        </span>
        <span className="text-foreground truncate">{challenge.name}</span>
        {isPreview && (
          <span className="text-[10px] uppercase tracking-wider text-cyan-300/90 border border-cyan-400/30 rounded px-1.5 py-0.5 flex-shrink-0">
            preview
          </span>
        )}
        {isTodo && (
          <span className="text-[10px] uppercase tracking-wider text-amber-300/90 border border-amber-400/30 bg-amber-400/5 rounded px-1.5 py-0.5 flex-shrink-0">
            coming soon
          </span>
        )}
        {done && (
          <span className="text-[10px] uppercase tracking-wider text-green-400 border border-green-400/30 rounded px-1.5 py-0.5 flex-shrink-0">
            done
          </span>
        )}
      </span>
      <span className="col-span-5 md:col-span-3 text-xs text-muted-foreground">
        {challenge.category}
      </span>
      <span className="col-span-3 md:col-span-1 justify-self-center">
        <span
          className={`text-[10px] uppercase tracking-wider border rounded px-2 py-1 ${DIFFICULTY_TONE[challenge.difficulty]}`}
        >
          {challenge.difficulty}
        </span>
      </span>
      <div className="col-span-4 md:col-span-2 justify-self-end">
        {isUnavailable ? (
          <span
            className="inline-block px-4 py-2 text-xs uppercase tracking-wider rounded border border-border text-muted-foreground cursor-not-allowed"
          >
            {isTodo ? 'Locked' : 'Coming soon'}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onSelectChallenge?.(challenge)}
            className="px-4 py-2 text-xs uppercase tracking-wider bg-accent text-accent-foreground hover:bg-accent/90 rounded transition-colors cursor-pointer"
          >
            {done ? 'Replay →' : 'Start →'}
          </button>
        )}
      </div>
    </div>
  );
}
