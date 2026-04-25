import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type ChallengeDetail } from '../lib/api';
import { CodeSnippet } from './CodeSnippet';

interface ChallengePlayProps {
  challengeId: string;
  onExit: () => void;
  onCompleted: () => void;
}

type Status =
  | { kind: 'loading' }
  | { kind: 'starting' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

export function ChallengePlay({ challengeId, onExit, onCompleted }: ChallengePlayProps) {
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
  const [showCode, setShowCode] = useState(true);
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

  const codeFileNames = useMemo(
    () => (challenge ? Object.keys(challenge.code_files) : []),
    [challenge],
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-20 bg-background/85 backdrop-blur border-b border-border">
        <div className="max-w-[1600px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4">
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
              className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1600px] w-full mx-auto px-4 md:px-8 py-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="flex flex-col gap-4 min-w-0">
          <div className="border border-border rounded p-5 bg-card/40">
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
              Scenario
            </h2>
            <ScenarioBody text={challenge?.scenario ?? ''} />
          </div>

          {codeFileNames.length > 0 && (
            <div className="border border-border rounded bg-card/40">
              <button
                type="button"
                onClick={() => setShowCode((s) => !s)}
                className="w-full flex items-center justify-between px-5 py-3 text-sm uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              >
                <span>Source code</span>
                <span className="text-xs">{showCode ? 'Hide ▾' : 'Show ▸'}</span>
              </button>
              {showCode && (
                <div className="px-5 pb-5">
                  <div className="flex flex-wrap gap-1 mb-3">
                    {codeFileNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setActiveFile(name)}
                        className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
                          activeFile === name
                            ? 'border-accent text-accent bg-accent/10'
                            : 'border-border text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  {activeFile && (
                    <div className="max-h-[420px] overflow-auto">
                      <CodeSnippet code={challenge!.code_files[activeFile] ?? ''} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {challenge?.hint_tiers && challenge.hint_tiers.length > 0 && (
            <details className="border border-border rounded p-4 bg-card/40 text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Static hints ({challenge.hint_tiers.length} tier
                {challenge.hint_tiers.length === 1 ? '' : 's'})
              </summary>
              <ol className="mt-3 space-y-3 list-decimal list-inside text-foreground/80">
                {challenge.hint_tiers.map((h) => (
                  <li key={h.tier}>{h.text}</li>
                ))}
              </ol>
            </details>
          )}
        </section>

        <section className="flex flex-col gap-4 min-w-0">
          <div className="border border-border rounded overflow-hidden bg-card/40 flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border text-xs text-muted-foreground">
              <span className="font-mono truncate">{proxyUrl ?? 'about:blank'}</span>
              <span className="uppercase tracking-wider">target app</span>
            </div>
            <div className="relative bg-black" style={{ minHeight: '460px' }}>
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
                  style={{ minHeight: '460px', border: 'none' }}
                  sandbox="allow-forms allow-scripts allow-same-origin"
                />
              )}
            </div>
          </div>

          <div className="border border-border rounded p-5 bg-card/40 space-y-3">
            <div>
              <h3 className="text-sm uppercase tracking-wider text-muted-foreground mb-1">
                Capture the flag
              </h3>
              <p className="text-xs text-muted-foreground">
                Once you've broken in, paste the flag from the admin dashboard here.
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={flag}
                onChange={(e) => setFlag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSubmitFlag();
                }}
                placeholder="FLAG{...}"
                className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
              />
              <button
                type="button"
                onClick={() => void handleSubmitFlag()}
                disabled={submittingFlag || !flag.trim()}
                className="px-4 py-2 text-xs uppercase tracking-wider bg-accent text-accent-foreground hover:bg-accent/90 rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {submittingFlag ? 'Checking...' : 'Submit'}
              </button>
            </div>
            {flagFeedback && (
              <p
                className={`text-xs px-3 py-2 rounded border ${
                  flagFeedback.ok
                    ? 'text-green-400 border-green-400/30 bg-green-400/5'
                    : 'text-red-400 border-red-400/30 bg-red-400/5'
                }`}
              >
                {flagFeedback.message}
              </p>
            )}

            <div className="pt-2 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Stuck?
                </span>
                <button
                  type="button"
                  onClick={() => void handleHint()}
                  disabled={loadingHint || status.kind !== 'ready'}
                  className="text-xs uppercase tracking-wider px-3 py-1.5 border border-border rounded hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {loadingHint ? 'Thinking...' : 'Ask for a hint'}
                </button>
              </div>
              {hint && (
                <p className="text-xs text-foreground/80 bg-background border border-border rounded px-3 py-2 whitespace-pre-wrap">
                  {hint}
                </p>
              )}
            </div>
          </div>
        </section>
      </main>
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
            <h3 key={i} className="text-base text-foreground mt-3">
              {para.replace(/^##\s+/, '')}
            </h3>
          );
        }
        if (para.startsWith('# ')) {
          return (
            <h2 key={i} className="text-lg text-foreground mt-3">
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
