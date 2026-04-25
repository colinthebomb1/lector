import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { api, type ChallengeSummary, type CurrentUser } from '../lib/api';
import { CodeSnippet } from './CodeSnippet';
import {
  getCodeReviewChallenge,
  type SolutionVerdict,
} from '../data/codeReviewChallenges';

interface CodeReviewPlayProps {
  challenge: ChallengeSummary;
  user: CurrentUser;
  onExit: () => void;
  onProfileClick: () => void;
  onLoggedOut: () => void;
}

export function CodeReviewPlay({
  challenge,
  user,
  onExit,
  onProfileClick,
  onLoggedOut,
}: CodeReviewPlayProps) {
  const reviewChallenge = useMemo(
    () => getCodeReviewChallenge(challenge.id) ?? null,
    [challenge.id],
  );

  const [code, setCode] = useState<string>(reviewChallenge?.default_code ?? '');
  const [verdict, setVerdict] = useState<SolutionVerdict | null>(null);
  const [grading, setGrading] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [revealedHints, setRevealedHints] = useState<string[]>([]);

  // If the user clicks between two code-review challenges in one session, reset.
  useEffect(() => {
    setCode(reviewChallenge?.default_code ?? '');
    setVerdict(null);
    setGrading(false);
    setHintIndex(0);
    setRevealedHints([]);
  }, [reviewChallenge]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleSubmit();
    });
  };

  const handleReset = useCallback(() => {
    if (!reviewChallenge) return;
    setCode(reviewChallenge.default_code);
    setVerdict(null);
  }, [reviewChallenge]);

  const handleHint = useCallback(() => {
    if (!reviewChallenge) return;
    if (hintIndex >= reviewChallenge.hints.length) return;
    const next = reviewChallenge.hints[hintIndex];
    setRevealedHints((prev) => [...prev, next]);
    setHintIndex((idx) => idx + 1);
  }, [hintIndex, reviewChallenge]);

  const handleSubmit = useCallback(() => {
    if (!reviewChallenge) return;
    setGrading(true);
    setVerdict(null);
    // Async pause so the spinner is visible — keeps grading semantics consistent
    // with the security/defend grader UX even though this check is local.
    setTimeout(() => {
      const result = reviewChallenge.solutionCheck(code);
      setVerdict(result);
      setGrading(false);
    }, 250);
  }, [code, reviewChallenge]);

  const dirty = reviewChallenge ? code !== reviewChallenge.default_code : false;
  const hintsRemaining = reviewChallenge
    ? Math.max(reviewChallenge.hints.length - hintIndex, 0)
    : 0;

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="relative z-50 flex-shrink-0 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onExit}
              className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Dashboard
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono text-xs text-muted-foreground truncate">
              {challenge.id}
            </span>
            <span className="text-foreground truncate">{challenge.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider px-2 py-1 border rounded text-sky-300 border-sky-400/40 bg-sky-400/5">
              Code Review
            </span>
            <UserMenu
              user={user}
              onProfileClick={onProfileClick}
              onLoggedOut={onLoggedOut}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">
        {!reviewChallenge ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            This code-review challenge is not available yet.
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-hidden grid grid-cols-1 xl:grid-cols-2 gap-0">
            <section className="min-w-0 min-h-0 overflow-hidden flex flex-col border-r border-border/80 bg-card/45 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
              <div className="px-5 py-4 border-b border-border/80 bg-background/35 flex-shrink-0">
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/85 font-semibold">
                  Original Source
                </p>
                <h2 className="text-lg text-foreground mt-1">
                  Review the code on the left
                </h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                  {reviewChallenge.prompt}
                </p>
              </div>

              <div className="flex-1 min-h-0 overflow-auto p-4 bg-background/45">
                <CodeSnippet code={reviewChallenge.original_code} />
              </div>

              <div className="flex-shrink-0 border-t border-border/80 bg-background/35 px-4 py-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleHint}
                    disabled={hintsRemaining === 0}
                    className="px-3 py-1.5 text-[10px] uppercase tracking-wider rounded border border-orange-400/50 text-orange-300 bg-orange-400/10 hover:bg-orange-400/15 hover:border-orange-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    title={
                      hintsRemaining > 0
                        ? `${hintsRemaining} hint${hintsRemaining === 1 ? '' : 's'} remaining`
                        : 'No more hints'
                    }
                  >
                    {hintsRemaining > 0
                      ? `Hint (${hintIndex + 1}/${reviewChallenge.hints.length})`
                      : 'No more hints'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={grading}
                    className="px-3 py-1.5 text-[10px] uppercase tracking-wider rounded bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {grading ? 'Checking…' : 'Submit'}
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={!dirty}
                    className="px-3 py-1.5 text-[10px] uppercase tracking-wider border border-red-400/40 text-red-300 rounded hover:border-red-300 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Reset
                  </button>
                  <span className="ml-auto text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    Ctrl/⌘ + Enter to submit
                  </span>
                </div>

                {verdict && (
                  <div
                    className={`rounded border px-3 py-2 text-sm ${
                      verdict.passed
                        ? 'text-green-400 border-green-400/30 bg-green-400/5'
                        : 'text-red-400 border-red-400/30 bg-red-400/5'
                    }`}
                  >
                    <p className="text-[10px] uppercase tracking-[0.18em] mb-1">
                      {verdict.passed ? 'Passed' : 'Try again'}
                    </p>
                    <p className="text-foreground/90">{verdict.message}</p>
                  </div>
                )}

                {revealedHints.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/85 font-semibold">
                      Revealed hints
                    </p>
                    {revealedHints.map((hint, idx) => (
                      <p
                        key={idx}
                        className="text-xs text-foreground/85 bg-background/70 border border-border/70 rounded px-3 py-2"
                      >
                        <span className="text-muted-foreground mr-2">
                          {idx + 1}.
                        </span>
                        {hint}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="min-w-0 min-h-0 overflow-hidden flex flex-col bg-background">
              <div className="px-5 py-3 border-b border-border/80 bg-background/35 flex items-center justify-between gap-3 flex-shrink-0">
                <div>
                  <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/85 font-semibold">
                    Your Patch
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Edit freely — submission runs locally against the rubric.
                  </p>
                </div>
                <span
                  className={`text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border ${
                    dirty
                      ? 'text-amber-300 border-amber-300/40 bg-amber-300/5'
                      : 'text-muted-foreground border-border/70 bg-background/40'
                  }`}
                >
                  {dirty ? 'Unsaved edits' : 'Untouched'}
                </span>
              </div>
              <div className="flex-1 min-h-0 p-4">
                <div className="h-full min-h-[320px] overflow-hidden rounded border border-border/80 bg-background shadow-[0_0_0_1px_rgba(255,255,255,0.025)]">
                  <Editor
                    key={reviewChallenge.summary.id}
                    height="100%"
                    language={reviewChallenge.language}
                    theme="vs-dark"
                    value={code}
                    onChange={(value) => setCode(value ?? '')}
                    onMount={handleEditorMount}
                    options={{
                      minimap: { enabled: false },
                      fontFamily:
                        '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
                      fontSize: 13,
                      lineHeight: 20,
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      automaticLayout: true,
                      tabSize: 4,
                      padding: { top: 12, bottom: 12 },
                    }}
                  />
                </div>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

interface UserMenuProps {
  user: CurrentUser;
  onProfileClick: () => void | Promise<void>;
  onLoggedOut: () => void | Promise<void>;
}

function UserMenu({ user, onProfileClick, onLoggedOut }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const displayName = user.name ?? user.nickname ?? 'reader';
  const initial = displayName.slice(0, 1).toUpperCase();

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleLogout = async () => {
    setError(null);
    setLoggingOut(true);
    try {
      await api.logout();
      setOpen(false);
      await onLoggedOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setLoggingOut(false);
    }
  };

  const handleProfile = async () => {
    setOpen(false);
    await onProfileClick();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-2 py-1.5 border border-border rounded text-xs hover:border-accent hover:text-accent transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
      >
        <span className="w-5 h-5 rounded-full bg-accent/10 border border-accent/40 flex items-center justify-center text-[10px] text-accent">
          {initial}
        </span>
        <span className="hidden md:inline max-w-[120px] truncate">
          {displayName}
        </span>
        <span className="text-muted-foreground text-[10px]">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-30 w-56 bg-background border border-border rounded shadow-lg overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-border">
            <p className="text-sm text-foreground truncate">{displayName}</p>
            <p className="text-xs text-muted-foreground truncate">
              {user.email ?? 'no email'}
            </p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleProfile()}
            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-foreground/5 transition-colors"
          >
            Profile
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
            className="w-full text-left px-3 py-2 text-sm text-foreground hover:bg-red-400/10 hover:text-red-400 transition-colors disabled:opacity-60"
          >
            {loggingOut ? 'Logging out...' : 'Log out'}
          </button>
          {error && (
            <p className="px-3 py-2 text-xs text-red-400 border-t border-border">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
