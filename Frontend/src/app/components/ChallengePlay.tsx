import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ChallengeDetail, type CurrentUser } from '../lib/api';
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
  const [scenarioOpen, setScenarioOpen] = useState(true);
  const [splitPercent, setSplitPercent] = useState(45);
  const [dragging, setDragging] = useState(false);

  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const stoppedRef = useRef(false);

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
        const detail = await api.challenge(challengeId);
        if (cancelled) return;
        setChallenge(detail);
        const fileNames = Object.keys(detail.code_files);
        if (fileNames.length > 0) setActiveFile(fileNames[0]);

        setStatus({ kind: 'starting' });
        await api.startAttack(challengeId);
        if (cancelled) return;
        setProxyUrl(api.proxyUrl(challengeId, '/login'));
        setStatus({ kind: 'ready' });
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
      if (result.accepted) onCompleted();
    } catch (err) {
      setFlagFeedback({
        ok: false,
        message: err instanceof Error ? err.message : 'Submission failed',
      });
    } finally {
      setSubmittingFlag(false);
    }
  }, [challengeId, flag, onCompleted]);

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
            <button
              type="button"
              onClick={() => setScenarioOpen((s) => !s)}
              className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:border-accent hover:text-accent transition-colors"
              title="Toggle scenario panel"
            >
              {scenarioOpen ? 'Hide scenario' : 'Show scenario'}
            </button>
            <span
              className={`text-[10px] uppercase tracking-wider px-2 py-1 border rounded ${
                status.kind === 'ready'
                  ? 'text-green-400 border-green-400/40 bg-green-400/5'
                  : status.kind === 'error'
                  ? 'text-red-400 border-red-400/40 bg-red-400/5'
                  : 'text-yellow-400 border-yellow-400/40 bg-yellow-400/5'
              }`}
            >
              {status.kind === 'ready'
                ? 'Live'
                : status.kind === 'error'
                ? 'Error'
                : status.kind === 'starting'
                ? 'Starting container...'
                : 'Loading...'}
            </span>
            <button
              type="button"
              onClick={() => setIframeKey((k) => k + 1)}
              disabled={status.kind !== 'ready'}
              className="text-xs uppercase tracking-wider px-3 py-1.5 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: '#0ea5e9', color: '#082f49' }}
            >
              Reload
            </button>
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

      <main className="flex-1 flex min-h-0">
        <ScenarioSidebar
          open={scenarioOpen}
          challenge={challenge}
          onToggle={() => setScenarioOpen((s) => !s)}
        />

        <div ref={splitContainerRef} className="flex-1 flex min-w-0 relative">
          {/* Source code pane */}
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

          {/* Drag handle */}
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

          {/* Browser + flag pane */}
          <div
            className="flex flex-col min-w-0"
            style={{ width: `${100 - splitPercent}%` }}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground flex-shrink-0 gap-3">
              <span className="font-mono truncate">{proxyUrl ?? 'about:blank'}</span>
              <span className="uppercase tracking-wider flex-shrink-0">Target app</span>
            </div>
            <div className="relative bg-black flex-1 min-h-0">
              {/* Block iframe pointer events while dragging so the iframe doesn't swallow mousemove */}
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
      </main>
    </div>
  );
}

interface ScenarioSidebarProps {
  open: boolean;
  challenge: ChallengeDetail | null;
  onToggle: () => void;
}

function ScenarioSidebar({ open, challenge, onToggle }: ScenarioSidebarProps) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex-shrink-0 w-9 border-r border-border bg-card/40 hover:bg-card/60 hover:text-accent text-muted-foreground transition-colors flex items-center justify-center"
        title="Show scenario"
        aria-label="Show scenario"
      >
        <span className="rotate-180" style={{ writingMode: 'vertical-rl' }}>
          ◀ Scenario
        </span>
      </button>
    );
  }

  return (
    <aside className="flex-shrink-0 w-[340px] border-r border-border bg-card/30 flex flex-col min-h-0">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border flex-shrink-0">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Scenario</span>
        <button
          type="button"
          onClick={onToggle}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Hide scenario"
          aria-label="Hide scenario"
        >
          ◀
        </button>
      </div>
      <div className="flex-1 overflow-auto px-4 py-4">
        <h2 className="text-base text-foreground mb-3">{challenge?.name ?? '...'}</h2>
        <ScenarioBody text={challenge?.scenario ?? ''} />

        {challenge?.hint_tiers && challenge.hint_tiers.length > 0 && (
          <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground">
              Static hints ({challenge.hint_tiers.length})
            </summary>
            <ol className="mt-3 space-y-3 list-decimal list-inside text-foreground/80 text-sm">
              {challenge.hint_tiers.map((h) => (
                <li key={h.tier}>{h.text}</li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </aside>
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
              {para.replace(/^##\s+/, '')}
            </h3>
          );
        }
        if (para.startsWith('# ')) {
          return (
            <h2 key={i} className="text-base text-foreground mt-4">
              {para.replace(/^#\s+/, '')}
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
                  <li key={j}>{l.replace(/^[-*]\s+/, '')}</li>
                ))}
            </ul>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed">
            {para}
          </p>
        );
      })}
    </div>
  );
}
