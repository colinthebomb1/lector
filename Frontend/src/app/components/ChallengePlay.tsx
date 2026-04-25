import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api,
  type AttackPayloadRecord,
  type ChallengeDetail,
  type CurrentUser,
  type SubmissionHistory,
  type SubmissionRecord,
} from '../lib/api';
import { CodeSnippet } from './CodeSnippet';

interface ChallengePlayProps {
  challengeId: string;
  user: CurrentUser;
  onExit: () => void;
  onCompleted: () => void;
  onProfileClick: () => void;
  onLoggedOut: () => void;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'overview' }
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

const MIN_PANE_PERCENT = 20;
const MAX_PANE_PERCENT = 80;

export function ChallengePlay({
  challengeId,
  user,
  onExit,
  onCompleted,
  onProfileClick,
  onLoggedOut,
}: ChallengePlayProps) {
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [flag, setFlag] = useState('');
  const [flagFeedback, setFlagFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [submittingFlag, setSubmittingFlag] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [loadingHint, setLoadingHint] = useState(false);
  const [splitPercent, setSplitPercent] = useState(45);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<SubmissionHistory | null>(null);
  const [payloads, setPayloads] = useState<AttackPayloadRecord[]>([]);

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const stoppedRef = useRef(false);

  const refreshOverviewData = useCallback(async () => {
    const [historyResult, payloadHistory] = await Promise.all([
      api.submissionHistory(challengeId),
      api.attackPayloads(challengeId),
    ]);
    setHistory(historyResult);
    setPayloads(payloadHistory.payloads);
  }, [challengeId]);

  const stopSession = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    try {
      await api.stopAttack(challengeId);
    } catch {
      // best-effort cleanup
    }
  }, [challengeId]);

  useEffect(() => {
    let cancelled = false;
    stoppedRef.current = false;

    (async () => {
      try {
        setStatus({ kind: 'loading' });
        const [detail, historyResult, payloadHistory] = await Promise.all([
          api.challenge(challengeId),
          api.submissionHistory(challengeId),
          api.attackPayloads(challengeId),
        ]);
        if (cancelled) return;
        setChallenge(detail);
        setHistory(historyResult);
        setPayloads(payloadHistory.payloads);
        const fileNames = Object.keys(detail.code_files);
        if (fileNames.length > 0) setActiveFile(fileNames[0]);
        setStatus({ kind: 'overview' });
      } catch (err) {
        if (!cancelled) {
          setStatus({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Failed to start challenge',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      void stopSession();
    };
  }, [challengeId, stopSession]);

  const handleLaunchWorkspace = useCallback(async () => {
    setHint(null);
    setFlagFeedback(null);
    setStatus({ kind: 'starting' });
    try {
      await api.startAttack(challengeId);
      setProxyUrl(api.proxyUrl(challengeId));
      setIframeKey((k) => k + 1);
      setStatus({ kind: 'ready' });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Failed to start challenge',
      });
    }
  }, [challengeId]);

  const handleExit = useCallback(async () => {
    await stopSession();
    onExit();
  }, [onExit, stopSession]);

  const handleSubmitFlag = useCallback(async () => {
    if (!flag.trim()) return;
    setSubmittingFlag(true);
    setFlagFeedback(null);
    try {
      const result = await api.submitFlag(challengeId, flag.trim());
      setFlagFeedback({ ok: result.accepted, message: result.message });
      await refreshOverviewData();
      if (result.accepted) onCompleted();
    } catch (err) {
      setFlagFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Submission failed',
      });
    } finally {
      setSubmittingFlag(false);
    }
  }, [challengeId, flag, onCompleted, refreshOverviewData]);

  const handleHint = useCallback(async () => {
    setLoadingHint(true);
    try {
      const result = await api.attackHint(challengeId);
      setHint(result.hint || result.analysis || 'No hint available right now.');
    } catch (err) {
      setHint(err instanceof Error ? err.message : 'Hint request failed.');
    } finally {
      setLoadingHint(false);
    }
  }, [challengeId]);

  // Drag-to-resize between source code and browser panes.
  useEffect(() => {
    if (!dragging) return;

    const handleMove = (e: MouseEvent) => {
      const container = splitContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const offset = e.clientX - rect.left;
      const percent = (offset / rect.width) * 100;
      const clamped = Math.max(MIN_PANE_PERCENT, Math.min(MAX_PANE_PERCENT, percent));
      setSplitPercent(clamped);
    };
    const handleUp = () => setDragging(false);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  const handleDoubleClickDivider = useCallback(() => setSplitPercent(45), []);

  const codeFileNames = useMemo(
    () => (challenge ? Object.keys(challenge.code_files) : []),
    [challenge],
  );

  const recentSubmissions = history?.submissions.slice(0, 6) ?? [];
  const recentPayloads = payloads.slice(-6).reverse();
  const progress = history?.progress;

  return (
    <div className="h-screen bg-background text-foreground flex flex-col overflow-hidden">
      <header className="relative z-50 flex-shrink-0 bg-background/85 backdrop-blur border-b border-border">
        <div className="px-4 md:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={handleExit}
              className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
            >
              ← Dashboard
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono text-xs text-muted-foreground truncate">{challengeId}</span>
            <span className="text-foreground truncate">{challenge?.name ?? 'Loading...'}</span>
          </div>
          <div className="flex items-center gap-2">
            {status.kind === 'ready' || status.kind === 'starting' ? (
              <button
                type="button"
                onClick={async () => {
                  try {
                    await refreshOverviewData();
                  } catch {
                    // Keep the workspace usable even if overview refresh fails.
                  }
                  setFlag('');
                  setHint(null);
                  setFlagFeedback(null);
                  setStatus({ kind: 'overview' });
                }}
                className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:border-accent hover:text-accent transition-colors"
                title="Back to challenge overview"
              >
                Back to Overview
              </button>
            ) : null}
            <span
              className={`text-[10px] uppercase tracking-wider px-2 py-1 border rounded ${
                status.kind === 'ready'
                  ? 'text-green-400 border-green-400/40 bg-green-400/5'
                  : status.kind === 'error'
                  ? 'text-red-400 border-red-400/40 bg-red-400/5'
                  : status.kind === 'overview'
                  ? 'text-blue-400 border-blue-400/40 bg-blue-400/5'
                  : 'text-yellow-400 border-yellow-400/40 bg-yellow-400/5'
              }`}
            >
              {status.kind === 'ready'
                ? 'Live'
                : status.kind === 'error'
                ? 'Error'
                : status.kind === 'overview'
                ? 'Overview'
                : status.kind === 'starting'
                ? 'Starting container...'
                : 'Loading...'}
            </span>
            {status.kind === 'ready' ? (
              <button
                type="button"
                onClick={() => setIframeKey((k) => k + 1)}
                disabled={status.kind !== 'ready'}
                className="text-xs uppercase tracking-wider px-3 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ backgroundColor: '#0ea5e9', color: '#082f49' }}
              >
                Reload
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleLaunchWorkspace()}
                disabled={status.kind === 'loading' || status.kind === 'starting'}
                className="text-xs uppercase tracking-wider px-3 py-1.5 rounded bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {status.kind === 'starting' ? 'Opening...' : 'Open Workspace'}
              </button>
            )}
            <UserMenu
              user={user}
              onProfileClick={async () => {
                await stopSession();
                onProfileClick();
              }}
              onLoggedOut={async () => {
                await stopSession();
                onLoggedOut();
              }}
            />
          </div>
        </div>
      </header>

      <main className="flex-1 min-h-0">
        {status.kind === 'ready' || status.kind === 'starting' || (status.kind === 'error' && proxyUrl) ? (
          <div className="h-full flex min-h-0">
            <div ref={splitContainerRef} className="flex-1 flex min-w-0 relative">
              <div
                className="flex flex-col min-w-0 border-r border-border"
                style={{ width: `${splitPercent}%` }}
              >
                <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground flex-shrink-0">
                  <span className="uppercase tracking-wider">Source</span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {codeFileNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setActiveFile(name)}
                        className={`text-[11px] font-mono px-2 py-0.5 rounded border transition-colors ${
                          activeFile === name
                            ? 'border-accent text-accent bg-accent/10'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-card/30">
                  {activeFile && challenge ? (
                    <CodeSnippet code={challenge.code_files[activeFile] ?? ''} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No source files loaded.</p>
                  )}
                </div>
              </div>

              <div
                role="separator"
                aria-orientation="vertical"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDoubleClick={handleDoubleClickDivider}
                className={`relative flex-shrink-0 w-1.5 cursor-col-resize group ${
                  dragging ? 'bg-accent' : 'bg-border hover:bg-accent/60'
                } transition-colors`}
                title="Drag to resize • double-click to reset"
              >
                <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-0.5 pointer-events-none">
                  <span className="block w-0.5 h-1 bg-background/80 rounded" />
                  <span className="block w-0.5 h-1 bg-background/80 rounded" />
                  <span className="block w-0.5 h-1 bg-background/80 rounded" />
                </span>
              </div>

              <div
                className="flex flex-col min-w-0"
                style={{ width: `${100 - splitPercent}%` }}
              >
                <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground flex-shrink-0 gap-3">
                  <span className="font-mono truncate">{proxyUrl ?? 'about:blank'}</span>
                  <span className="uppercase tracking-wider flex-shrink-0">Target app</span>
                </div>
                <div className="relative bg-black flex-1 min-h-0">
                  {dragging && <div className="absolute inset-0 z-10" />}
                  {status.kind !== 'ready' && (
                    <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                      {status.kind === 'error' ? status.message : 'Spinning up sandbox container...'}
                    </div>
                  )}
                  {status.kind === 'ready' && proxyUrl && (
                    <iframe
                      key={iframeKey}
                      src={proxyUrl}
                      title="Vulnerable application"
                      className="w-full h-full block"
                      style={{ border: 'none' }}
                      sandbox="allow-forms allow-scripts allow-same-origin"
                    />
                  )}
                </div>

                <div className="flex-shrink-0 border-t border-border bg-card/40 px-4 py-3 space-y-2 max-h-[40%] overflow-auto">
                  <div className="flex gap-2 items-center">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex-shrink-0">
                      Flag
                    </span>
                    <input
                      type="text"
                      value={flag}
                      onChange={(e) => setFlag(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSubmitFlag();
                      }}
                      placeholder="FLAG{...}"
                      className="flex-1 min-w-0 bg-background border border-border rounded px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSubmitFlag()}
                      disabled={submittingFlag || !flag.trim()}
                      className="px-3 py-1.5 text-xs uppercase tracking-wider bg-accent text-accent-foreground hover:bg-accent/90 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                      {submittingFlag ? '...' : 'Submit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleHint()}
                      disabled={loadingHint || status.kind !== 'ready'}
                      className="px-3 py-1.5 text-xs uppercase tracking-wider border border-border rounded hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                      {loadingHint ? '...' : 'Hint'}
                    </button>
                  </div>
                  {flagFeedback && (
                    <p
                      className={`text-xs px-3 py-1.5 rounded border ${
                        flagFeedback.ok
                          ? 'text-green-400 border-green-400/30 bg-green-400/5'
                          : 'text-red-400 border-red-400/30 bg-red-400/5'
                      }`}
                    >
                      {flagFeedback.message}
                    </p>
                  )}
                  {hint && (
                    <p className="text-xs text-foreground/80 bg-background border border-border rounded px-3 py-2 whitespace-pre-wrap">
                      {hint}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <OverviewStage
            challenge={challenge}
            history={history}
            payloads={recentPayloads}
            onOpenWorkspace={() => void handleLaunchWorkspace()}
            opening={status.kind === 'starting'}
            error={status.kind === 'error' ? status.message : null}
          />
        )}
      </main>
    </div>
  );
}

interface OverviewStageProps {
  challenge: ChallengeDetail | null;
  history: SubmissionHistory | null;
  payloads: AttackPayloadRecord[];
  onOpenWorkspace: () => void;
  opening: boolean;
  error: string | null;
}

function OverviewStage({
  challenge,
  history,
  payloads,
  onOpenWorkspace,
  opening,
  error,
}: OverviewStageProps) {
  const progress = history?.progress;
  const recentSubmissions = history?.submissions.slice(0, 5) ?? [];
  const derivedScore =
    (progress?.attack_captured ? 50 : 0) +
    (progress?.defend_passed ? 100 : 0);
  const displayScore = Math.max(progress?.total_score_awarded ?? 0, derivedScore);

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-[1440px] mx-auto px-4 md:px-8 py-8">
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_420px] gap-6">
          <section className="min-w-0 border border-border/80 rounded-lg bg-card/40 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
            <div className="px-5 py-3 border-b border-border/80 bg-background/30 flex items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  Challenge Overview
                </p>
                <h2 className="text-xl md:text-2xl text-foreground mt-1">
                  {challenge?.name ?? 'Loading challenge...'}
                </h2>
              </div>
              <button
                type="button"
                onClick={onOpenWorkspace}
                disabled={opening || !challenge}
                className="px-4 py-2 text-xs uppercase tracking-wider bg-accent text-accent-foreground hover:bg-accent/90 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {opening ? 'Opening…' : 'Open Code + Browser'}
              </button>
            </div>

            <div className="px-5 py-5 space-y-6">
              {error && (
                <div className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-3 py-2">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <InfoChip label="Track" value={challenge?.track ?? '—'} />
                <InfoChip label="Difficulty" value={challenge?.difficulty ?? '—'} />
                <InfoChip label="Category" value={challenge?.category ?? '—'} />
                <InfoChip
                  label="Estimate"
                  value={challenge ? `~${challenge.estimated_minutes}m` : '—'}
                />
              </div>

              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
                  Scenario
                </p>
                <ScenarioBody text={challenge?.scenario ?? ''} />
              </div>

              {challenge?.hint_tiers && challenge.hint_tiers.length > 0 && (
                <div>
                  <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground mb-3">
                    Hints
                  </p>
                  <div className="space-y-3">
                    {challenge.hint_tiers.map((hintTier) => (
                      <details
                        key={hintTier.tier}
                    className="border border-border/70 rounded bg-background/75 overflow-hidden group"
                      >
                        <summary className="list-none cursor-pointer px-3 py-3 flex items-center justify-between gap-3">
                          <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/90 font-semibold">
                            Hint {hintTier.tier}
                          </span>
                          <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
                            ▾
                          </span>
                        </summary>
                        <div className="px-3 pb-3 border-t border-border">
                          <p className="text-sm text-foreground/80 pt-3">{hintTier.text}</p>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="min-w-0 space-y-4">
            <section className="border border-border/80 rounded-lg bg-card/55 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.025)]">
              <div className="px-4 py-3 border-b border-border/80 bg-background/35">
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground font-semibold">
                  Progress
                </p>
              </div>
              <div className="px-4 py-4 grid grid-cols-2 gap-3">
                <ProgressTile
                  label="Reading Summary"
                  value={progress?.summary_passed ? 'Passed' : 'Pending'}
                />
                <ProgressTile label="Attack" value={progress?.attack_captured ? 'Captured' : 'Pending'} />
                <ProgressTile label="Defend" value={progress?.defend_passed ? 'Passed' : 'Pending'} />
                <ProgressTile label="Attempts" value={String(progress?.attempt_count ?? 0)} />
              </div>
              <div className="px-4 pb-4 text-xs text-muted-foreground space-y-1">
                <p>
                  Reading Summary tracks whether you passed the short comprehension check for
                  this challenge before diving into attack or defense.
                </p>
                {progress ? (
                  <>
                  <p>Total score awarded here: {displayScore}</p>
                  <p>
                    Last activity:{' '}
                    {progress.last_submission_at
                      ? new Date(progress.last_submission_at).toLocaleString()
                      : 'No submissions yet'}
                  </p>
                  </>
                ) : (
                  <p>No submissions yet.</p>
                )}
              </div>
            </section>

            <section className="border border-border/80 rounded-lg bg-card/55 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.025)]">
              <div className="px-4 py-3 border-b border-border/80 bg-background/35 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground font-semibold">
                  Submission History
                </p>
                <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/80 font-semibold">
                  {recentSubmissions.length} recent
                </span>
              </div>
              <div className="max-h-[280px] overflow-auto divide-y divide-border">
                {recentSubmissions.length > 0 ? (
                  recentSubmissions.map((submission, index) => (
                    <SubmissionRow key={`${submission.created_at}-${index}`} submission={submission} />
                  ))
                ) : (
                  <EmptyState text="No submission history for this challenge yet." />
                )}
              </div>
            </section>

            <section className="border border-border/80 rounded-lg bg-card/55 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.025)]">
              <div className="px-4 py-3 border-b border-border/80 bg-background/35 flex items-center justify-between gap-3">
                <p className="text-[11px] uppercase tracking-[0.2em] text-foreground font-semibold">
                  Recent Payloads
                </p>
                <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/80 font-semibold">
                  {payloads.length} captured
                </span>
              </div>
              <div className="max-h-[240px] overflow-auto divide-y divide-border">
                {payloads.length > 0 ? (
                  payloads.map((payload, index) => (
                    <PayloadRow key={`${payload.timestamp}-${index}`} payload={payload} />
                  ))
                ) : (
                  <EmptyState text="No recorded attack attempts yet." />
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/70 rounded px-3 py-3 bg-background/72">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

function ProgressTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-border/70 rounded px-3 py-3 bg-background/72">
      <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/90 font-semibold mb-1">{label}</p>
      <p className="text-sm text-foreground">{value}</p>
    </div>
  );
}

function SubmissionRow({ submission }: { submission: SubmissionRecord }) {
  return (
    <div className="px-4 py-3 bg-background/55">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-foreground font-semibold">
          {submission.phase}
        </p>
        <span
          className={`text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border ${
            submission.result?.status === 'passed'
              ? 'text-green-400 border-green-400/30 bg-green-400/5'
              : submission.result?.status === 'failed'
              ? 'text-red-400 border-red-400/30 bg-red-400/5'
              : 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5'
          }`}
        >
          {submission.result?.status ?? 'pending'}
        </span>
      </div>
      <p className="text-sm text-foreground mt-2">
        {submission.result?.message || `Submitted ${submission.submission_type}.`}
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        {new Date(submission.created_at).toLocaleString()}
        {submission.score_awarded ? ` • +${submission.score_awarded} pts` : ''}
      </p>
    </div>
  );
}

function PayloadRow({ payload }: { payload: AttackPayloadRecord }) {
  const fields = Object.entries(payload.form_data || {});
  const statusClass =
    payload.response_status >= 400
      ? 'text-red-400 border-red-400/30 bg-red-400/5'
      : payload.response_status >= 300
      ? 'text-sky-400 border-sky-400/30 bg-sky-400/5'
      : 'text-green-400 border-green-400/30 bg-green-400/5';

  return (
    <div className="px-4 py-3 bg-background/55">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-foreground font-semibold">
          {payload.method} /{payload.path}
        </p>
        <span className={`text-[10px] uppercase tracking-[0.18em] px-2 py-1 rounded border ${statusClass}`}>
          {payload.response_status}
        </span>
      </div>
      {fields.length > 0 && (
        <div className="mt-2 space-y-1">
          {fields.map(([key, value]) => (
            <p key={key} className="text-xs text-foreground/80 font-mono break-all">
              <span className="text-muted-foreground">{key}=</span>
              {value}
            </p>
          ))}
        </div>
      )}
      <p className="text-xs text-muted-foreground mt-2">
        {new Date(payload.timestamp).toLocaleString()}
      </p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-4 py-6 text-sm text-muted-foreground">{text}</div>;
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
        <span className="hidden md:inline max-w-[120px] truncate">{displayName}</span>
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

function ScenarioBody({ text }: { text: string }) {
  if (!text.trim()) {
    return <p className="text-sm text-muted-foreground">No scenario provided.</p>;
  }
  return (
    <div className="prose prose-invert prose-sm max-w-none text-foreground/90 space-y-2">
      {text.split(/\n{2,}/).map((para, i) => {
        if (para.startsWith('## ')) {
          return (
            <h3 key={i} className="text-sm uppercase tracking-wider text-foreground mt-4">
              {renderInline(para.replace(/^##\s+/, ''))}
            </h3>
          );
        }
        if (para.startsWith('# ')) {
          return (
            <h2 key={i} className="text-base text-foreground mt-4">
              {renderInline(para.replace(/^#\s+/, ''))}
            </h2>
          );
        }
        if (/^[-*]\s+/m.test(para)) {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 text-sm text-foreground/80">
              {para
                .split('\n')
                .filter((l) => /^[-*]\s+/.test(l))
                .map((l, j) => (
                  <li key={j}>{renderInline(l.replace(/^[-*]\s+/, ''))}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed">
            {renderInline(para)}
          </p>
        );
      })}
    </div>
  );
}

// Minimal inline markdown: **bold**, *italic*, `code`. Order matters —
// bold must be matched before italic, otherwise '*' from '**' gets eaten first.
const INLINE_MD_RE =
  /(\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g;

function renderInline(text: string): ReactNode {
  if (!text) return null;
  const parts = text.split(INLINE_MD_RE);
  return parts.map((part, i) => {
    if (!part) return null;
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'))) {
      return (
        <strong key={i} className="text-foreground font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={i}
          className="font-mono text-[0.85em] px-1 py-0.5 rounded bg-foreground/10 text-foreground"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <span key={i}>{part}</span>;
  });
}
