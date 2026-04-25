import { useEffect, useRef, useState } from 'react';
import {
  api,
  attackProxyUrl,
  type ChallengeDetail,
  type ChallengeSummary,
  type Difficulty,
} from '../lib/api';

interface PlayerProps {
  challenge: ChallengeSummary;
  onBack: () => void;
  onSolved?: () => void;
}

const DIFFICULTY_TONE: Record<Difficulty, string> = {
  easy: 'text-green-400 border-green-400/30 bg-green-400/5',
  medium: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5',
  hard: 'text-red-400 border-red-400/30 bg-red-400/5',
};

type SessionState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export function Player({ challenge, onBack, onSolved }: PlayerProps) {
  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [iframeKey, setIframeKey] = useState(0);

  const [flag, setFlag] = useState('');
  const [flagFeedback, setFlagFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [submittingFlag, setSubmittingFlag] = useState(false);

  const [showHint, setShowHint] = useState(0);
  const stoppedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    api
      .challenge(challenge.id)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setDetailError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [challenge.id]);

  useEffect(() => {
    return () => {
      if (sessionState === 'running' && !stoppedRef.current) {
        stoppedRef.current = true;
        api.stopAttack(challenge.id).catch(() => {
          // best-effort cleanup
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge.id, sessionState]);

  async function handleStart() {
    setSessionError(null);
    setFlagFeedback(null);
    setSessionState('starting');
    try {
      await api.startAttack(challenge.id);
      stoppedRef.current = false;
      setIframeKey((k) => k + 1);
      setSessionState('running');
    } catch (err) {
      setSessionError((err as Error).message);
      setSessionState('error');
    }
  }

  async function handleStop() {
    setSessionState('stopping');
    try {
      await api.stopAttack(challenge.id);
      stoppedRef.current = true;
    } catch (err) {
      setSessionError((err as Error).message);
    } finally {
      setSessionState('idle');
    }
  }

  async function handleSubmitFlag(e: React.FormEvent) {
    e.preventDefault();
    if (!flag.trim() || submittingFlag) return;
    setSubmittingFlag(true);
    setFlagFeedback(null);
    try {
      const res = await api.submitFlag(challenge.id, flag.trim());
      setFlagFeedback({ ok: res.accepted, message: res.message });
      if (res.accepted) onSolved?.();
    } catch (err) {
      setFlagFeedback({ ok: false, message: (err as Error).message });
    } finally {
      setSubmittingFlag(false);
    }
  }

  const proxyUrl = attackProxyUrl(challenge.id, '/');
  const isRunning = sessionState === 'running';
  const isStarting = sessionState === 'starting';

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1480px] mx-auto px-4 md:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={onBack}
              className="text-sm text-muted-foreground hover:text-accent transition-colors"
            >
              ← Dashboard
            </button>
            <span className="text-muted-foreground">/</span>
            <span className="font-mono text-xs text-muted-foreground truncate">{challenge.id}</span>
            <span className="hidden md:inline text-foreground truncate">{challenge.name}</span>
            <span
              className={`text-[10px] uppercase tracking-wider border rounded px-2 py-0.5 ${DIFFICULTY_TONE[challenge.difficulty]}`}
            >
              {challenge.difficulty}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {!isRunning && (
              <button
                type="button"
                onClick={handleStart}
                disabled={isStarting}
                className="px-4 py-2 bg-accent text-accent-foreground text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
              >
                {isStarting ? 'Starting…' : sessionState === 'error' ? 'Retry' : 'Start Challenge'}
              </button>
            )}
            {isRunning && (
              <button
                type="button"
                onClick={handleStop}
                className="px-4 py-2 border border-border text-sm hover:border-red-400 hover:text-red-400 transition-colors"
              >
                Stop
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-[1480px] w-full mx-auto px-4 md:px-8 py-6 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6">
        <section className="flex flex-col gap-4 min-w-0">
          <div className="border border-border rounded overflow-hidden bg-card flex-1 min-h-[520px] flex flex-col">
            {!isRunning && !isStarting && (
              <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16 gap-4">
                <h2 className="text-xl">Ready when you are.</h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  Click <span className="text-accent">Start Challenge</span> to spin up the
                  vulnerable app. The first launch builds the container image and can take ~30
                  seconds.
                </p>
                {sessionError && (
                  <p className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-3 py-2 max-w-md">
                    {sessionError}
                  </p>
                )}
              </div>
            )}

            {isStarting && (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Building image &amp; starting container…
              </div>
            )}

            {isRunning && (
              <iframe
                key={iframeKey}
                src={proxyUrl}
                title={`${challenge.name} target`}
                className="flex-1 w-full bg-white"
                sandbox="allow-forms allow-scripts allow-same-origin"
              />
            )}
          </div>

          <form
            onSubmit={handleSubmitFlag}
            className="border border-border rounded p-4 flex flex-col sm:flex-row gap-3"
          >
            <input
              type="text"
              value={flag}
              onChange={(e) => setFlag(e.target.value)}
              placeholder="FLAG{...}"
              className="flex-1 bg-background border border-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="submit"
              disabled={!flag.trim() || submittingFlag}
              className="px-4 py-2 bg-accent text-accent-foreground text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              {submittingFlag ? 'Checking…' : 'Submit Flag'}
            </button>
          </form>

          {flagFeedback && (
            <p
              className={`text-sm rounded px-3 py-2 border ${
                flagFeedback.ok
                  ? 'text-green-400 border-green-400/30 bg-green-400/5'
                  : 'text-red-400 border-red-400/30 bg-red-400/5'
              }`}
            >
              {flagFeedback.message}
            </p>
          )}
        </section>

        <aside className="flex flex-col gap-4 min-w-0">
          <div className="border border-border rounded p-4">
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">
              Scenario
            </h2>
            {detailError && <p className="text-sm text-red-400">{detailError}</p>}
            {!detail && !detailError && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {detail && (
              <div className="text-sm text-foreground/90 whitespace-pre-wrap leading-relaxed">
                {detail.scenario}
              </div>
            )}
          </div>

          {detail && detail.code_files && Object.keys(detail.code_files).length > 0 && (
            <details className="border border-border rounded">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm uppercase tracking-wider text-muted-foreground hover:text-accent">
                Source Code ({Object.keys(detail.code_files).length} file
                {Object.keys(detail.code_files).length === 1 ? '' : 's'})
              </summary>
              <div className="px-4 pb-4 space-y-3">
                {Object.entries(detail.code_files).map(([name, content]) => (
                  <div key={name}>
                    <p className="text-xs font-mono text-muted-foreground mb-1">{name}</p>
                    <pre className="text-xs bg-background border border-border rounded p-3 overflow-x-auto max-h-72">
                      <code>{content}</code>
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          )}

          {detail && detail.hint_tiers.length > 0 && (
            <div className="border border-border rounded p-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Hints</h2>
                {showHint < detail.hint_tiers.length && (
                  <button
                    type="button"
                    onClick={() => setShowHint((n) => n + 1)}
                    className="text-xs text-accent hover:underline"
                  >
                    Reveal hint {showHint + 1}
                  </button>
                )}
              </div>
              <ol className="space-y-2 list-decimal list-inside">
                {detail.hint_tiers.slice(0, showHint).map((h) => (
                  <li key={h.tier} className="text-sm text-foreground/80">
                    {h.text}
                  </li>
                ))}
                {showHint === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Stuck? Reveal hints one at a time.
                  </p>
                )}
              </ol>
            </div>
          )}
        </aside>
      </main>
    </div>
  );
}
