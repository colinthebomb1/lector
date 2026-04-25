import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import confetti from 'canvas-confetti';
import { api, type ChallengeSummary, type CurrentUser } from '../lib/api';
import { CodeSnippet } from './CodeSnippet';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from './ui/resizable';
import {
  getCodeReviewChallenge,
  getCodeReviewVariant,
  type SolutionVerdict,
} from '../data/codeReviewChallenges';

interface CodeReviewPlayProps {
  challenge: ChallengeSummary;
  user: CurrentUser;
  onExit: () => void;
  onProfileClick: () => void;
  onLoggedOut: () => void;
  onCompleted?: () => void;
}

export function CodeReviewPlay({
  challenge,
  user,
  onExit,
  onProfileClick,
  onLoggedOut,
  onCompleted,
}: CodeReviewPlayProps) {
  const reviewChallenge = useMemo(
    () => getCodeReviewChallenge(challenge.id) ?? null,
    [challenge.id],
  );

  const [activeLanguage, setActiveLanguage] = useState<string>(
    () => getCodeReviewVariant(challenge.id)?.language ?? '',
  );

  // When the user navigates to a different challenge, keep their language
  // preference if the new challenge offers it; otherwise fall back to that
  // challenge's declared default.
  useEffect(() => {
    setActiveLanguage((prev) => {
      const stillOffered = getCodeReviewVariant(challenge.id, prev);
      if (stillOffered && stillOffered.language === prev) return prev;
      return getCodeReviewVariant(challenge.id)?.language ?? '';
    });
  }, [challenge.id]);

  const variant = useMemo(
    () => getCodeReviewVariant(challenge.id, activeLanguage) ?? null,
    [challenge.id, activeLanguage],
  );

  const [code, setCode] = useState<string>(variant?.default_code ?? '');
  const [verdict, setVerdict] = useState<SolutionVerdict | null>(null);
  const [grading, setGrading] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);
  const [revealedHints, setRevealedHints] = useState<string[]>([]);
  const [aiHint, setAiHint] = useState<string | null>(null);
  const [aiHintProgress, setAiHintProgress] = useState<string | null>(null);
  const [loadingAiHint, setLoadingAiHint] = useState(false);
  const [aiHintHistory, setAiHintHistory] = useState<string[]>([]);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [scoreAwarded, setScoreAwarded] = useState<number | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);

  // Reset editor + grading state whenever the active variant changes —
  // either because the user picked a different challenge or a different
  // language for the same challenge.
  useEffect(() => {
    setCode(variant?.default_code ?? '');
    setVerdict(null);
    setGrading(false);
    setHintIndex(0);
    setRevealedHints([]);
    setAiHint(null);
    setAiHintProgress(null);
    setLoadingAiHint(false);
    setAiHintHistory([]);
    setShowSuccessModal(false);
    setScoreAwarded(null);
    setPersistError(null);
  }, [variant]);

  useEffect(() => {
    if (!verdict?.passed) return;

    setShowSuccessModal(true);

    const end = Date.now() + 1800;
    const colors = ['#f59e0b', '#34d399', '#60a5fa', '#f472b6'];
    const frame = () => {
      confetti({
        particleCount: 8,
        angle: 60,
        spread: 70,
        origin: { x: 0.1, y: 0 },
        colors,
      });
      confetti({
        particleCount: 8,
        angle: 120,
        spread: 70,
        origin: { x: 0.9, y: 0 },
        colors,
      });
      if (Date.now() < end) {
        window.requestAnimationFrame(frame);
      }
    };

    frame();
  }, [verdict]);

  const handleEditorMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleSubmit();
    });
  };

  const handleReset = useCallback(() => {
    if (!variant) return;
    setCode(variant.default_code);
    setVerdict(null);
  }, [variant]);

  const handleHint = useCallback(() => {
    if (!variant) return;
    if (hintIndex >= variant.hints.length) return;
    const next = variant.hints[hintIndex];
    setRevealedHints((prev) => [...prev, next]);
    setHintIndex((idx) => idx + 1);
  }, [hintIndex, variant]);

  const handleSubmit = useCallback(async () => {
    if (!reviewChallenge || !variant) return;
    setGrading(true);
    setVerdict(null);
    setScoreAwarded(null);
    setPersistError(null);
    // Brief async pause so the spinner is visible — keeps grading semantics
    // consistent with the security/defend grader UX even though this check
    // is local.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const result = variant.solutionCheck(code);
    setVerdict(result);
    setGrading(false);

    if (!result.passed) return;

    // Persist the pass to the backend so the user actually gets credit.
    // Resubmits are atomically guarded server-side so points are awarded
    // at most once per challenge.
    try {
      const persisted = await api.submitCodeReview({
        challenge_id: reviewChallenge.summary.id,
        language: variant.language,
        code,
        passed: true,
        message: result.message,
      });
      setScoreAwarded(persisted.score_awarded ?? 0);
      onCompleted?.();
    } catch (err) {
      setPersistError(
        err instanceof Error ? err.message : 'Could not save your score.',
      );
    }
  }, [code, onCompleted, reviewChallenge, variant]);

  const handleAiHint = useCallback(async () => {
    if (!reviewChallenge || !variant) return;
    setLoadingAiHint(true);
    try {
      const result = await api.codeReviewHint({
        challenge_id: reviewChallenge.summary.id,
        challenge_name: reviewChallenge.summary.name,
        challenge_prompt: variant.prompt,
        language: variant.language,
        starter_code: variant.default_code,
        current_code: code,
        rubric_items: variant.aiHintRubric,
        static_hints: variant.hints,
        prior_hints: aiHintHistory,
      });
      const nextHint = result.hint || result.analysis || 'No hint available right now.';
      setAiHint(nextHint);
      setAiHintProgress(result.progress || null);
      setAiHintHistory((prev) => [...prev, nextHint]);
    } catch (err) {
      setAiHint(err instanceof Error ? err.message : 'Hint request failed.');
      setAiHintProgress(null);
    } finally {
      setLoadingAiHint(false);
    }
  }, [aiHintHistory, code, reviewChallenge, variant]);

  const dirty = variant ? code !== variant.default_code : false;
  const hintsRemaining = variant
    ? Math.max(variant.hints.length - hintIndex, 0)
    : 0;

  const handleLanguageSwitch = useCallback(
    (lang: string) => {
      if (lang === activeLanguage) return;
      if (dirty && !verdict?.passed) {
        const ok = window.confirm(
          'Switching languages will discard your current edits. Continue?',
        );
        if (!ok) return;
      }
      setActiveLanguage(lang);
    },
    [activeLanguage, dirty, verdict?.passed],
  );

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
            {challenge.display_number ? (
              <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground border border-border/70 rounded px-2 py-0.5 flex-shrink-0">
                #{challenge.display_number}
              </span>
            ) : null}
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
        {!reviewChallenge || !variant ? (
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
                  {variant.prompt}
                </p>
              </div>

              <ResizablePanelGroup direction="vertical" className="flex-1 min-h-0">
                <ResizablePanel defaultSize={70} minSize={35}>
                  <div className="h-full min-h-0 overflow-auto p-4 bg-background/45">
                    <CodeSnippet code={variant.original_code} />
                  </div>
                </ResizablePanel>

                <ResizableHandle
                  withHandle
                  className="border-y border-border/80 bg-background/60 hover:bg-accent/20 transition-colors"
                />

                <ResizablePanel defaultSize={30} minSize={18} maxSize={55}>
                  <div className="h-full min-h-0 overflow-hidden bg-background/35 flex flex-col">
                    <div className="border-b border-border/80 px-4 py-2 flex-shrink-0">
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
                            ? `Hint (${hintIndex + 1}/${variant.hints.length})`
                            : 'No more hints'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAiHint()}
                          disabled={loadingAiHint}
                          className="px-3 py-1.5 text-[10px] uppercase tracking-wider rounded border border-sky-400/50 text-sky-200 bg-sky-400/10 hover:bg-sky-400/15 hover:border-sky-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          title="Get an adaptive hint based on your current patch"
                        >
                          {loadingAiHint ? 'Thinking…' : 'AI Tailored Hint'}
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
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
                      {verdict && !verdict.passed && (
                        <div
                          className={`rounded border px-3 py-2 text-sm ${
                            'text-red-400 border-red-400/30 bg-red-400/5'
                          }`}
                        >
                          <p className="text-[10px] uppercase tracking-[0.18em] mb-1">
                            Try again
                          </p>
                          <p className="text-foreground/90">{verdict.message}</p>
                        </div>
                      )}

                      <p className="text-[11px] text-muted-foreground">
                        Static hints are fixed clues. AI hints analyze your current patch against
                        the learning rubric and get more specific as you get closer.
                      </p>

                      {aiHint && (
                        <div className="rounded border border-sky-400/30 bg-sky-400/5 px-3 py-2 text-sm">
                          <p className="text-[10px] uppercase tracking-[0.18em] mb-1 text-sky-200">
                            AI hint
                            {aiHintProgress ? ` · ${aiHintProgress}` : ''}
                          </p>
                          <p className="text-foreground/90 whitespace-pre-wrap">{aiHint}</p>
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
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </section>

            <section className="min-w-0 min-h-0 overflow-hidden flex flex-col bg-background">
              <div className="px-5 py-3 border-b border-border/80 bg-background/35 flex-shrink-0">
                <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/85 font-semibold">
                  Your Patch
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Edit freely — submission runs locally against the rubric.
                </p>
                <div className="flex items-center gap-4 flex-wrap mt-2">
                  {reviewChallenge.variants.length > 1 && (
                    <div
                      role="tablist"
                      aria-label="Language"
                      className="flex items-center gap-0.5 border border-border/70 rounded p-0.5 bg-background/60"
                    >
                      {reviewChallenge.variants.map((v) => {
                        const isActive = v.language === activeLanguage;
                        return (
                          <button
                            key={v.language}
                            type="button"
                            role="tab"
                            aria-selected={isActive}
                            onClick={() => handleLanguageSwitch(v.language)}
                            className={`px-2 py-1 text-[11px] uppercase tracking-wider rounded transition-colors ${
                              isActive
                                ? 'bg-accent text-accent-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                            }`}
                          >
                            {v.display_language}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <span
                    className={`ml-auto text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border ${
                      verdict?.passed
                        ? 'text-green-300 border-green-300/40 bg-green-300/5'
                        : dirty
                        ? 'text-amber-300 border-amber-300/40 bg-amber-300/5'
                        : 'text-muted-foreground border-border/70 bg-background/40'
                    }`}
                  >
                    {verdict?.passed ? 'Passed' : dirty ? 'In Progress' : 'Not Started'}
                  </span>
                </div>
              </div>
              <div className="flex-1 min-h-0 p-4">
                <div className="h-full min-h-[320px] overflow-hidden rounded border border-border/80 bg-background shadow-[0_0_0_1px_rgba(255,255,255,0.025)]">
                  <Editor
                    key={`${reviewChallenge.summary.id}:${variant.language}`}
                    height="100%"
                    language={variant.language}
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

      {showSuccessModal && verdict?.passed && (
        <CodeReviewSuccessModal
          challengeName={challenge.name}
          feedback={verdict.message}
          scoreAwarded={scoreAwarded}
          persistError={persistError}
          onReturnToDashboard={onExit}
          onDismiss={() => setShowSuccessModal(false)}
        />
      )}
    </div>
  );
}

interface CodeReviewSuccessModalProps {
  challengeName: string;
  feedback: string;
  scoreAwarded: number | null;
  persistError: string | null;
  onReturnToDashboard: () => void;
  onDismiss: () => void;
}

function CodeReviewSuccessModal({
  challengeName,
  feedback,
  scoreAwarded,
  persistError,
  onReturnToDashboard,
  onDismiss,
}: CodeReviewSuccessModalProps) {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="code-review-success-title"
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm cursor-default"
      />
      <div className="relative w-full max-w-lg border border-green-400/40 rounded-lg bg-card shadow-[0_0_60px_-15px_rgba(74,222,128,0.45)] overflow-hidden animate-fadeInUp">
        <div className="px-6 pt-6 pb-4 border-b border-border/70 bg-green-400/5">
          <p className="text-[10px] uppercase tracking-[0.25em] text-green-400 font-semibold">
            Challenge Passed
          </p>
          <h3
            id="code-review-success-title"
            className="text-xl text-foreground mt-2"
          >
            Congratulations, Challenge Passed!
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            You successfully completed{' '}
            <span className="text-foreground">{challengeName}</span>.
          </p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="rounded border border-green-400/25 bg-green-400/5 px-4 py-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-green-300 mb-2">
              Graded Feedback
            </p>
            <p className="text-sm text-foreground/90">{feedback}</p>
          </div>
          {scoreAwarded !== null && (
            <div
              className={`rounded border px-4 py-3 ${
                scoreAwarded > 0
                  ? 'border-amber-300/40 bg-amber-300/5'
                  : 'border-border/70 bg-background/40'
              }`}
            >
              <p className="text-[10px] uppercase tracking-[0.18em] text-amber-300 mb-1">
                Score
              </p>
              <p className="text-sm text-foreground/90">
                {scoreAwarded > 0
                  ? `+${scoreAwarded} pts added to your total.`
                  : 'Already solved earlier — no additional points awarded.'}
              </p>
            </div>
          )}
          {persistError && (
            <div className="rounded border border-red-400/40 bg-red-400/5 px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-red-300 mb-1">
                Score Not Saved
              </p>
              <p className="text-sm text-foreground/90">{persistError}</p>
            </div>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="px-4 py-2 text-xs uppercase tracking-wider border border-border rounded text-foreground hover:border-accent hover:text-accent transition-colors"
            >
              Keep Reviewing
            </button>
            <button
              type="button"
              onClick={onReturnToDashboard}
              className="px-4 py-2 text-xs uppercase tracking-wider rounded bg-accent text-accent-foreground hover:bg-accent/90 transition-colors"
            >
              Return to Dashboard
            </button>
          </div>
        </div>
      </div>
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
