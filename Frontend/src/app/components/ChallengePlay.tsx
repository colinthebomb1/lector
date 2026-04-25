import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import {
  api,
  type AttackPayloadRecord,
  type ChallengeDetail,
  type CurrentUser,
  type PatchResult,
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

type WorkspaceMode = 'attack' | 'defend';

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
  const [defendReferenceFile, setDefendReferenceFile] = useState<string | null>(null);
  const [defendEditorFile, setDefendEditorFile] = useState<string | null>(null);
  const [flag, setFlag] = useState('');
  const [flagFeedback, setFlagFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [submittingFlag, setSubmittingFlag] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [loadingHint, setLoadingHint] = useState(false);
  const [splitPercent, setSplitPercent] = useState(45);
  const [dragging, setDragging] = useState(false);
  const [history, setHistory] = useState<SubmissionHistory | null>(null);
  const [payloads, setPayloads] = useState<AttackPayloadRecord[]>([]);
  const [showCaptureModal, setShowCaptureModal] = useState(false);
  const [showHintConfirmModal, setShowHintConfirmModal] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode | null>(null);
  const [editedFiles, setEditedFiles] = useState<Record<string, string>>({});
  const [submittingPatch, setSubmittingPatch] = useState(false);
  const [patchResult, setPatchResult] = useState<PatchResult | null>(null);

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
        if (fileNames.length > 0) {
          setActiveFile(fileNames[0]);
          setDefendReferenceFile(fileNames[0]);
          setDefendEditorFile(fileNames[0]);
        }
        setEditedFiles(detail.code_files);
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
    setWorkspaceMode('attack');
    setHint(null);
    setFlagFeedback(null);
    setStatus({ kind: 'starting' });
    try {
      await api.startAttack(challengeId);
      setProxyUrl(api.proxyUrl(challengeId));
      setIframeKey((k) => k + 1);
      setStatus({ kind: 'ready' });
    } catch (err) {
      setWorkspaceMode(null);
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
      if (result.accepted) {
        onCompleted();
        setShowCaptureModal(true);
      }
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

  const handleConfirmHint = useCallback(async () => {
    setShowHintConfirmModal(false);
    await handleHint();
  }, [handleHint]);

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

  const handleContinueToDefend = useCallback(async () => {
    setShowCaptureModal(false);
    try {
      await refreshOverviewData();
    } catch {
      // Best-effort refresh; still surface the overview where defend lives.
    }
    await stopSession();
    stoppedRef.current = false;
    setFlag('');
    setHint(null);
    setFlagFeedback(null);
    setProxyUrl(null);
    setPatchResult(null);
    setWorkspaceMode('defend');
    setStatus({ kind: 'ready' });
  }, [refreshOverviewData, stopSession]);

  const handleOpenDefendWorkspace = useCallback(() => {
    setPatchResult(null);
    setProxyUrl(null);
    setWorkspaceMode('defend');
    setStatus({ kind: 'ready' });
  }, []);

  const handleSubmitPatch = useCallback(async () => {
    if (!challenge) return;
    const generatedPatch = buildUnifiedDiff(challenge.code_files, editedFiles);
    if (!generatedPatch) {
      setPatchResult({
        status: 'error',
        message: 'No code changes to submit yet.',
      });
      return;
    }
    setSubmittingPatch(true);
    setPatchResult(null);
    try {
      const result = await api.submitPatch(challengeId, generatedPatch);
      setPatchResult(result);
      await refreshOverviewData();
      if (result.status === 'passed') onCompleted();
    } catch (err) {
      setPatchResult({
        status: 'error',
        message: err instanceof Error ? err.message : 'Patch submission failed',
      });
    } finally {
      setSubmittingPatch(false);
    }
  }, [challenge, challengeId, editedFiles, onCompleted, refreshOverviewData]);

  const handleBackToDashboardFromModal = useCallback(async () => {
    setShowCaptureModal(false);
    await handleExit();
  }, [handleExit]);

  const codeFileNames = useMemo(
    () => (challenge ? Object.keys(challenge.code_files) : []),
    [challenge],
  );

  const recentSubmissions = history?.submissions.slice(0, 6) ?? [];
  const recentPayloads = payloads.slice(-6).reverse();
  const progress = history?.progress;
  const defendHints = useMemo(() => buildDefendHints(challenge), [challenge]);

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
                  if (workspaceMode === 'attack') {
                    try {
                      await refreshOverviewData();
                    } catch {
                      // Keep the workspace usable even if overview refresh fails.
                    }
                    setFlag('');
                    setHint(null);
                    setFlagFeedback(null);
                    setProxyUrl(null);
                  } else {
                    try {
                      await refreshOverviewData();
                    } catch {
                      // Keep the overview available even if refresh fails.
                    }
                    setPatchResult(null);
                  }
                  setWorkspaceMode(null);
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
            {status.kind === 'ready' && workspaceMode === 'attack' ? (
              <button
                type="button"
                onClick={() => setIframeKey((k) => k + 1)}
                disabled={status.kind !== 'ready'}
                className="text-xs uppercase tracking-wider px-3 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ backgroundColor: '#0ea5e9', color: '#082f49' }}
              >
                Reload
              </button>
            ) : workspaceMode !== 'defend' ? (
              <button
                type="button"
                onClick={() => void handleLaunchWorkspace()}
                disabled={status.kind === 'loading' || status.kind === 'starting'}
                className="text-xs uppercase tracking-wider px-3 py-1.5 rounded bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {status.kind === 'starting' ? 'Opening...' : 'Open Workspace'}
              </button>
            ) : null}
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

      <main className="flex-1 min-h-0 overflow-hidden">
        {workspaceMode === 'attack' &&
        (status.kind === 'ready' || status.kind === 'starting' || (status.kind === 'error' && proxyUrl)) ? (
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
                      onClick={() => setShowHintConfirmModal(true)}
                      disabled={loadingHint || status.kind !== 'ready'}
                      className="px-3 py-1.5 text-xs uppercase tracking-wider border border-orange-400/50 text-orange-300 bg-orange-400/10 rounded hover:bg-orange-400/15 hover:border-orange-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
                    >
                      {loadingHint ? '...' : 'AI Hint'}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Static hints are fixed challenge clues. AI hints analyze your recent attack
                    attempts in this run.
                  </p>
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
                  {challenge?.hint_tiers && challenge.hint_tiers.length > 0 && (
                    <div className="pt-2 border-t border-border/70 space-y-2">
                      <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/90 font-semibold">
                        Static Attack Hints
                      </p>
                      <div className="space-y-2">
                        {challenge.hint_tiers.map((hintTier) => (
                          <details
                            key={hintTier.tier}
                            className="border border-border/70 rounded bg-background/75 overflow-hidden group"
                          >
                            <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
                              <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/90 font-semibold">
                                Hint {hintTier.tier}
                              </span>
                              <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
                                ▾
                              </span>
                            </summary>
                            <div className="px-3 pb-3 border-t border-border/70">
                              <p className="text-sm text-foreground/80 pt-2">{hintTier.text}</p>
                            </div>
                          </details>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : workspaceMode === 'defend' && status.kind === 'ready' ? (
          <DefendWorkspace
            challenge={challenge}
            referenceFile={defendReferenceFile}
            editorFile={defendEditorFile}
            codeFileNames={codeFileNames}
            onReferenceFileSelect={setDefendReferenceFile}
            onEditorFileSelect={setDefendEditorFile}
            editedFiles={editedFiles}
            onFileChange={(name, value) =>
              setEditedFiles((current) => ({ ...current, [name]: value }))
            }
            onResetFile={(name) => {
              if (!challenge) return;
              setEditedFiles((current) => ({
                ...current,
                [name]: challenge.code_files[name] ?? '',
              }));
            }}
            onSubmitPatch={() => void handleSubmitPatch()}
            submittingPatch={submittingPatch}
            patchResult={patchResult}
            recentSubmissions={recentSubmissions}
            defendHints={defendHints}
          />
        ) : (
          <OverviewStage
            challenge={challenge}
            history={history}
            payloads={recentPayloads}
            onOpenWorkspace={() => void handleLaunchWorkspace()}
            onOpenDefendWorkspace={handleOpenDefendWorkspace}
            opening={status.kind === 'starting'}
            error={status.kind === 'error' ? status.message : null}
          />
        )}
      </main>

      {showCaptureModal && (
        <CaptureSuccessModal
          challengeName={challenge?.name ?? 'this challenge'}
          hasDefendPhase={challenge?.has_defend_phase ?? false}
          onContinueToDefend={() => void handleContinueToDefend()}
          onBackToDashboard={() => void handleBackToDashboardFromModal()}
          onDismiss={() => setShowCaptureModal(false)}
        />
      )}

      {showHintConfirmModal && (
        <HintConfirmModal
          onDismiss={() => setShowHintConfirmModal(false)}
          onConfirm={() => void handleConfirmHint()}
        />
      )}
    </div>
  );
}

interface HintConfirmModalProps {
  onDismiss: () => void;
  onConfirm: () => void;
}

function HintConfirmModal({ onDismiss, onConfirm }: HintConfirmModalProps) {
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
      aria-labelledby="hint-confirm-title"
      className="fixed inset-0 z-[110] flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm cursor-default"
      />
      <div className="relative w-full max-w-md border border-orange-400/50 rounded-lg bg-card shadow-[0_0_45px_-15px_rgba(251,146,60,0.45)] overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-border/70 bg-orange-400/8">
          <p className="text-[10px] uppercase tracking-[0.22em] text-orange-300 font-semibold">
            Confirm AI hint
          </p>
          <h3 id="hint-confirm-title" className="text-lg text-foreground mt-2">
            Request an AI-generated attack hint?
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            AI hints use your recent attack attempts to suggest the next direction. Continue?
          </p>
        </div>
        <div className="px-6 py-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onDismiss}
            className="px-4 py-2 text-xs uppercase tracking-wider border border-border rounded text-foreground hover:border-accent hover:text-accent transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 text-xs uppercase tracking-wider rounded border border-orange-400/50 text-orange-200 bg-orange-400/15 hover:bg-orange-400/20 hover:border-orange-300 transition-colors"
          >
            Get AI Hint
          </button>
        </div>
      </div>
    </div>
  );
}

interface CaptureSuccessModalProps {
  challengeName: string;
  hasDefendPhase: boolean;
  onContinueToDefend: () => void;
  onBackToDashboard: () => void;
  onDismiss: () => void;
}

function CaptureSuccessModal({
  challengeName,
  hasDefendPhase,
  onContinueToDefend,
  onBackToDashboard,
  onDismiss,
}: CaptureSuccessModalProps) {
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
      aria-labelledby="capture-success-title"
      className="fixed inset-0 z-[100] flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        className="absolute inset-0 bg-background/80 backdrop-blur-sm cursor-default"
      />
      <div className="relative w-full max-w-md border border-green-400/40 rounded-lg bg-card shadow-[0_0_60px_-15px_rgba(74,222,128,0.45)] overflow-hidden animate-fadeInUp">
        <div className="px-6 pt-6 pb-4 border-b border-border/70 bg-green-400/5">
          <p className="text-[10px] uppercase tracking-[0.25em] text-green-400 font-semibold">
            Flag captured
          </p>
          <h3
            id="capture-success-title"
            className="text-xl text-foreground mt-2"
          >
            Attack complete — nice work.
          </h3>
          <p className="text-sm text-muted-foreground mt-2">
            You exploited <span className="text-foreground">{challengeName}</span>{' '}
            and pulled the flag. Want to keep going and patch the vulnerability,
            or head back to the dashboard?
          </p>
        </div>
        <div className="px-6 py-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onBackToDashboard}
            className="px-4 py-2 text-xs uppercase tracking-wider border border-border rounded text-foreground hover:border-accent hover:text-accent transition-colors"
          >
            Back to Dashboard
          </button>
          <button
            type="button"
            onClick={onContinueToDefend}
            disabled={!hasDefendPhase}
            title={
              hasDefendPhase
                ? 'Move on to defending this challenge'
                : 'This challenge has no defend phase'
            }
            className="px-4 py-2 text-xs uppercase tracking-wider rounded bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {hasDefendPhase ? 'Continue to Defend →' : 'No Defend Phase'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface OverviewStageProps {
  challenge: ChallengeDetail | null;
  history: SubmissionHistory | null;
  payloads: AttackPayloadRecord[];
  onOpenWorkspace: () => void;
  onOpenDefendWorkspace: () => void;
  opening: boolean;
  error: string | null;
}

function OverviewStage({
  challenge,
  history,
  payloads,
  onOpenWorkspace,
  onOpenDefendWorkspace,
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
              <div className="flex flex-wrap gap-2 justify-end">
                <button
                  type="button"
                  onClick={onOpenWorkspace}
                  disabled={opening || !challenge}
                  className="px-4 py-2 text-xs uppercase tracking-wider bg-accent text-accent-foreground hover:bg-accent/90 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {opening ? 'Opening…' : 'Open Attack Workspace'}
                </button>
                <button
                  type="button"
                  onClick={onOpenDefendWorkspace}
                  disabled={!challenge?.has_defend_phase}
                  className="px-4 py-2 text-xs uppercase tracking-wider border border-border rounded text-foreground hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Open Defend Workspace
                </button>
              </div>
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
                  value={progress?.summary_passed ? 'Passed' : 'In Progress'}
                />
                <ProgressTile
                  label="Attack"
                  value={progress?.attack_captured ? 'Exploit Executed' : 'In Progress'}
                />
                <ProgressTile
                  label="Defend"
                  value={progress?.defend_passed ? 'Vulnerability Patched' : 'In Progress'}
                />
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
              <div className="max-h-[280px] overflow-auto divide-y divide-border/80">
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
              <div className="max-h-[240px] overflow-auto divide-y divide-border/80">
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

interface DefendWorkspaceProps {
  challenge: ChallengeDetail | null;
  referenceFile: string | null;
  editorFile: string | null;
  codeFileNames: string[];
  onReferenceFileSelect: (name: string) => void;
  onEditorFileSelect: (name: string) => void;
  editedFiles: Record<string, string>;
  onFileChange: (name: string, value: string) => void;
  onResetFile: (name: string) => void;
  onSubmitPatch: () => void;
  submittingPatch: boolean;
  patchResult: PatchResult | null;
  recentSubmissions: SubmissionRecord[];
  defendHints: string[];
}

function DefendWorkspace({
  challenge,
  referenceFile,
  editorFile,
  codeFileNames,
  onReferenceFileSelect,
  onEditorFileSelect,
  editedFiles,
  onFileChange,
  onResetFile,
  onSubmitPatch,
  submittingPatch,
  patchResult,
  recentSubmissions,
  defendHints,
}: DefendWorkspaceProps) {
  const selectedReferenceFile = referenceFile ?? codeFileNames[0] ?? '';
  const selectedEditorFile = editorFile ?? codeFileNames[0] ?? '';
  const selectedEditorValue = selectedEditorFile ? editedFiles[selectedEditorFile] ?? '' : '';
  const selectedReferenceValue =
    selectedReferenceFile && challenge ? challenge.code_files[selectedReferenceFile] ?? '' : '';
  const selectedEditorOriginalValue =
    selectedEditorFile && challenge ? challenge.code_files[selectedEditorFile] ?? '' : '';
  const changedFileCount = challenge
    ? Object.keys(challenge.code_files).filter((name) => editedFiles[name] !== challenge.code_files[name]).length
    : 0;
  const selectedEditorFileChanged = selectedEditorValue !== selectedEditorOriginalValue;
  const editorLanguage = languageForFile(selectedEditorFile);
  const handleEditorMount: OnMount = (editor, monaco) => {
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onSubmitPatch();
    });
  };

  return (
    <div className="h-full min-h-0 overflow-hidden flex bg-background">
      <div className="w-[38%] min-w-0 min-h-0 overflow-hidden border-r border-border/80 bg-card/40 flex flex-col shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
        <div className="px-4 py-3 border-b border-border/80 bg-background/35 flex-shrink-0">
          <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/85 font-semibold mb-2">
            Reference
          </p>
          <div className="flex items-center gap-2">
            <select
              value={selectedReferenceFile}
              onChange={(e) => onReferenceFileSelect(e.target.value)}
              className="min-w-0 flex-1 rounded border border-border/80 bg-background/85 px-3 py-2 font-mono text-xs text-foreground focus:outline-none focus:border-accent"
            >
              {codeFileNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 bg-background/45">
          {selectedReferenceFile && challenge ? (
            <CodeSnippet code={selectedReferenceValue} />
          ) : (
            <p className="text-sm text-muted-foreground">No source files loaded.</p>
          )}
        </div>
      </div>

      <div className="flex-1 min-w-0 min-h-0 overflow-hidden grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 min-h-0 overflow-hidden flex flex-col border-r border-border/80 bg-card/45 shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
          <div className="px-5 py-4 border-b border-border/80 bg-background/35 flex-shrink-0">
            <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/85 font-semibold">
              Defend Workspace
            </p>
            <h2 className="text-lg text-foreground mt-1">Patch the vulnerability</h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Edit the source directly. We will package your changed files into a patch
              before sending them to the grader.
            </p>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            <div className="px-4 py-2 border-b border-border/80 bg-background/35 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1 max-w-sm">
                <p className="text-xs text-foreground/85 font-semibold uppercase tracking-wider">
                  Editor
                </p>
                <select
                  value={selectedEditorFile}
                  onChange={(e) => onEditorFileSelect(e.target.value)}
                  className="mt-1 w-full rounded border border-border/80 bg-background/85 px-3 py-1.5 font-mono text-xs text-foreground focus:outline-none focus:border-accent"
                  title="Editor file"
                >
                  {codeFileNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {changedFileCount === 1
                    ? '1 file changed'
                    : `${changedFileCount} files changed`}
                </span>
                <button
                  type="button"
                  onClick={() => selectedEditorFile && onResetFile(selectedEditorFile)}
                  disabled={!selectedEditorFile || !selectedEditorFileChanged}
                  className="px-3 py-1.5 text-[10px] uppercase tracking-wider border border-red-400/40 text-red-300 rounded hover:border-red-300 hover:bg-red-400/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  Reset File
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-4">
              <div className="h-full min-h-[320px] overflow-hidden rounded border border-border/80 bg-background shadow-[0_0_0_1px_rgba(255,255,255,0.025)]">
                {selectedEditorFile ? (
                  <Editor
                    key={selectedEditorFile}
                    height="100%"
                    language={editorLanguage}
                    path={selectedEditorFile}
                    theme="vs-dark"
                    value={selectedEditorValue}
                    onChange={(value) => onFileChange(selectedEditorFile, value ?? '')}
                    onMount={handleEditorMount}
                    options={{
                      minimap: { enabled: false },
                      fontFamily: '"IBM Plex Mono", "SFMono-Regular", Consolas, monospace',
                      fontSize: 13,
                      lineHeight: 20,
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      automaticLayout: true,
                      tabSize: 4,
                      padding: { top: 12, bottom: 12 },
                    }}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                    No file selected
                  </div>
                )}
              </div>
            </div>
            <div className="px-4 pb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Submit when your file changes are ready to grade.
              </p>
              <button
                type="button"
                onClick={onSubmitPatch}
                disabled={submittingPatch || changedFileCount === 0}
                className="px-4 py-2 text-xs uppercase tracking-wider bg-accent text-accent-foreground hover:bg-accent/90 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submittingPatch ? 'Grading...' : 'Submit Changes'}
              </button>
            </div>
          </div>
        </div>

        <aside className="min-w-0 min-h-0 overflow-hidden flex flex-col bg-card/45 shadow-[0_0_0_1px_rgba(255,255,255,0.025)]">
          <section className="min-h-0 flex-[0.95] overflow-hidden flex flex-col">
              <div className="px-4 py-2 border-b border-border/80 bg-background/35 text-xs text-foreground/85 font-semibold uppercase tracking-wider flex-shrink-0">
                Defend Result
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto p-4">
                {submittingPatch ? (
                  <div className="rounded border border-accent/30 bg-accent/5 px-4 py-5 flex items-center gap-3">
                    <span className="h-5 w-5 rounded-full border-2 border-accent/30 border-t-accent animate-spin" />
                    <div>
                      <p className="text-sm text-foreground">Grading your changes...</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Running functional checks and the exploit replay.
                      </p>
                    </div>
                  </div>
                ) : patchResult ? (
                  <div className="space-y-3">
                    <div
                      className={`rounded border px-3 py-2 text-xs uppercase tracking-[0.18em] ${
                        patchResult.status === 'passed'
                          ? 'text-green-400 border-green-400/30 bg-green-400/5'
                          : patchResult.status === 'failed' || patchResult.status === 'error'
                          ? 'text-red-400 border-red-400/30 bg-red-400/5'
                          : 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5'
                      }`}
                    >
                      {patchResult.status}
                    </div>
                    <p className="text-sm text-foreground">
                      {displayPatchMessage(patchResult)}
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <ProgressTile
                        label="Functional Check"
                        value={
                          patchResult.functional_passed == null
                            ? '—'
                            : patchResult.functional_passed
                            ? 'Passed'
                            : 'Failed'
                        }
                      />
                      <ProgressTile
                        label="Vulnerability Test"
                        value={
                          patchResult.track_test_passed == null
                            ? '—'
                            : patchResult.track_test_passed
                            ? 'Passed'
                            : 'Failed'
                        }
                      />
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>Elapsed: {patchResult.elapsed_seconds?.toFixed(2) ?? '—'}s</p>
                      <p>Score awarded: {patchResult.score_awarded ?? 0}</p>
                    </div>
                    {patchResult.track_test_passed != null && patchResult.functional_passed !== false ? (
                      <ExploitAttemptSummary passed={patchResult.track_test_passed} />
                    ) : null}
                  </div>
                ) : (
                  <EmptyState text="No patch grade yet. Submit changes to see the verdict." />
                )}
              </div>
          </section>

          <section className="min-h-0 flex-[0.75] overflow-hidden flex flex-col border-t border-border/80">
            <div className="px-4 py-2 border-b border-border/80 bg-background/35 text-xs text-foreground/85 font-semibold uppercase tracking-wider flex-shrink-0">
              Defense Hints
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                These are static defend hints. AI hints are attack-only and generated from your
                recent exploit attempts.
              </p>
              <div className="space-y-2">
                {defendHints.map((hintText, index) => (
                  <details
                    key={`${index}-${hintText}`}
                    className="border border-border/70 rounded bg-background/75 overflow-hidden group"
                  >
                    <summary className="list-none cursor-pointer px-3 py-2 flex items-center justify-between gap-3">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/90 font-semibold">
                        Hint {index + 1}
                      </span>
                      <span className="text-xs text-muted-foreground transition-transform group-open:rotate-180">
                        ▾
                      </span>
                    </summary>
                    <div className="px-3 pb-3 border-t border-border/70">
                      <p className="text-sm text-foreground/85 pt-2">{hintText}</p>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </section>

          <section className="min-h-0 flex-[0.9] overflow-hidden flex flex-col border-t border-border/80">
              <div className="px-4 py-2 border-b border-border/80 bg-background/35 text-xs text-foreground/85 font-semibold uppercase tracking-wider flex-shrink-0">
                Submission History
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto divide-y divide-border/80">
                {recentSubmissions.length > 0 ? (
                  recentSubmissions.map((submission, index) => (
                    <SubmissionRow key={`${submission.created_at}-${index}`} submission={submission} />
                  ))
                ) : (
                  <EmptyState text="No submission history for this challenge yet." />
                )}
              </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function buildUnifiedDiff(originalFiles: Record<string, string>, editedFiles: Record<string, string>) {
  const patches: string[] = [];

  Object.entries(originalFiles).forEach(([fileName, originalContent]) => {
    const editedContent = editedFiles[fileName] ?? '';
    if (editedContent === originalContent) return;

    const oldLines = splitForDiff(originalContent);
    const newLines = splitForDiff(editedContent);
    const oldCount = Math.max(oldLines.length, 1);
    const newCount = Math.max(newLines.length, 1);
    const hunkLines = [
      ...oldLines.map((line) => `-${line}`),
      ...newLines.map((line) => `+${line}`),
    ];

    patches.push(
      [
        `diff --git a/${fileName} b/${fileName}`,
        `--- a/${fileName}`,
        `+++ b/${fileName}`,
        `@@ -1,${oldCount} +1,${newCount} @@`,
        ...hunkLines,
      ].join('\n'),
    );
  });

  return patches.length > 0 ? `${patches.join('\n')}\n` : '';
}

function splitForDiff(content: string) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized === '') return [];
  if (normalized.endsWith('\n')) return normalized.slice(0, -1).split('\n');
  return normalized.split('\n');
}

function ExploitAttemptSummary({ passed }: { passed: boolean }) {
  return (
    <section className="rounded border border-border/80 bg-background/88 overflow-hidden shadow-[0_0_0_1px_rgba(255,255,255,0.02)]">
      <div className="px-3 py-2 border-b border-border/80 bg-background/40 text-[10px] uppercase tracking-[0.18em] text-foreground/90 font-semibold">
        Malicious Exploits Attempted
      </div>
      <div className="px-3 py-2 flex items-center justify-between gap-3">
        <span className="text-xs text-muted-foreground">Known attack replay</span>
        <span
          className={`flex-shrink-0 text-[10px] uppercase tracking-[0.16em] rounded border px-2 py-1 ${
            passed
              ? 'text-green-400 border-green-400/30 bg-green-400/5'
              : 'text-red-400 border-red-400/30 bg-red-400/5'
          }`}
        >
          {passed ? 'Passed' : 'Failed'}
        </span>
      </div>
    </section>
  );
}

function displayPatchMessage(result: PatchResult) {
  if (result.functional_passed === false) {
    return 'Functional check failed. The app behavior changed; review your patch and try again.';
  }
  if (result.track_test_passed === false) {
    return 'Vulnerability still present. The known attack is still working.';
  }
  return result.message ?? 'No grading message returned.';
}

function languageForFile(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'py':
      return 'python';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'sql':
      return 'sql';
    case 'sh':
      return 'shell';
    default:
      return 'plaintext';
  }
}

function InfoChip({ label, value }: { label: string; value: string }) {
  const normalizedValue = value.toLowerCase();
  const valueTone =
    label === 'Track'
      ? 'text-sky-400'
      : label === 'Difficulty'
      ? normalizedValue === 'easy'
        ? 'text-green-400'
        : normalizedValue === 'medium'
        ? 'text-orange-400'
        : normalizedValue === 'hard'
        ? 'text-red-400'
        : 'text-foreground'
      : 'text-foreground';

  return (
    <div className="border border-border/70 rounded px-3 py-3 bg-background/72">
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">{label}</p>
      <p className={`text-sm ${valueTone}`}>{value}</p>
    </div>
  );
}

function ProgressTile({ label, value }: { label: string; value: string }) {
  const valueTone =
    value === 'Passed' || value === 'Exploit Executed' || value === 'Vulnerability Patched'
      ? 'text-green-400'
      : value === 'In Progress'
      ? 'text-orange-400'
      : value === 'Failed'
      ? 'text-red-400'
      : 'text-foreground';

  return (
    <div className="border border-border/70 rounded px-3 py-3 bg-background/72">
      <p className="text-[10px] uppercase tracking-[0.2em] text-foreground/90 font-semibold mb-1">{label}</p>
      <p className={`text-sm ${valueTone}`}>{value}</p>
    </div>
  );
}

function SubmissionRow({ submission }: { submission: SubmissionRecord }) {
  const message = submission.result
    ? displaySubmissionMessage(submission.result)
    : `Submitted ${submission.submission_type}.`;

  return (
    <div className="px-4 py-3 bg-background/65">
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
        {message}
      </p>
      <p className="text-xs text-muted-foreground mt-2">
        {new Date(submission.created_at).toLocaleString()}
        {submission.score_awarded ? ` • +${submission.score_awarded} pts` : ''}
      </p>
    </div>
  );
}

function displaySubmissionMessage(result: SubmissionRecord['result']) {
  if (!result) return 'Submission recorded.';
  if (result.functional_passed === false) {
    return 'Functional check failed. The app behavior changed; review your patch and try again.';
  }
  if (result.track_test_passed === false) {
    return 'Vulnerability still present. The known attack is still working.';
  }
  return result.message || 'Submission recorded.';
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
    <div className="px-4 py-3 bg-background/65">
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

function buildDefendHints(challenge: ChallengeDetail | null): string[] {
  if (!challenge) {
    return [
      'Keep functionality intact while neutralizing the exploit path.',
      'Validate and sanitize user input before it reaches sensitive operations.',
      'Prefer safe APIs (like parameterized queries) over string-built commands.',
    ];
  }

  const id = challenge.id.toLowerCase();
  const category = challenge.category.toLowerCase();

  if (id.includes('sqli') || category.includes('injection')) {
    return [
      'Replace string interpolation in SQL with parameterized queries.',
      'Treat both username and password as untrusted input end-to-end.',
      'Retest valid login behavior after fixing injection to avoid regressions.',
    ];
  }

  return [
    'Fix the vulnerable code path first, then rerun normal user flows.',
    'Use allow-lists, strict parsing, or safe library primitives for untrusted input.',
    'Keep authorization checks server-side and independent from client-controlled data.',
  ];
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
