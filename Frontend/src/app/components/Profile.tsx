import { useState } from 'react';
import { api, type CurrentUser } from '../lib/api';

interface ProfileProps {
  user: CurrentUser;
  onBack: () => void;
  onLoggedOut: () => void;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-border rounded p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      <div className="text-2xl text-foreground">{value}</div>
    </div>
  );
}

function humanizeChallengeId(id: string): string {
  return id
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

export function Profile({ user, onBack, onLoggedOut }: ProfileProps) {
  const [loggingOut, setLoggingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = user.name ?? user.nickname ?? 'reader';
  const initial = displayName.slice(0, 1).toUpperCase();
  const completedIds = user.challenges_completed ?? [];
  const completionRows = completedIds.map((entry) => {
    if (entry.endsWith(':attack')) {
      const challengeId = entry.slice(0, -':attack'.length);
      return {
        key: entry,
        challengeName: humanizeChallengeId(challengeId),
        phaseLabel: 'Attack',
        phaseTone: 'text-green-400 border-green-400/30 bg-green-400/5',
      };
    }

    if (entry.endsWith(':defend')) {
      const challengeId = entry.slice(0, -':defend'.length);
      return {
        key: entry,
        challengeName: humanizeChallengeId(challengeId),
        phaseLabel: 'Defend',
        phaseTone: 'text-emerald-300 border-emerald-300/30 bg-emerald-400/5',
      };
    }

    const hasAttackRecord = completedIds.includes(`${entry}:attack`);
    return {
      key: entry,
      challengeName: humanizeChallengeId(entry),
      phaseLabel: hasAttackRecord ? 'Defend' : 'Completed',
      phaseTone: hasAttackRecord
        ? 'text-emerald-300 border-emerald-300/30 bg-emerald-400/5'
        : 'text-blue-300 border-blue-300/30 bg-blue-400/5',
    };
  });

  const handleLogout = async () => {
    setError(null);
    setLoggingOut(true);
    try {
      await api.logout();
      onLoggedOut();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-sm border-b border-border">
        <div className="max-w-[1280px] mx-auto px-4 md:px-8 py-4 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-muted-foreground hover:text-accent transition-colors"
          >
            ← Back to dashboard
          </button>
          <div className="flex items-center gap-1 text-lg md:text-xl">
            <span className="text-accent">L</span>
            <span className="text-accent">_</span>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 md:px-8 py-12">
        <div className="flex items-center gap-4 mb-10">
          <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/40 flex items-center justify-center text-2xl text-accent">
            {initial}
          </div>
          <div>
            <h1 className="text-2xl">{displayName}</h1>
            <p className="text-sm text-muted-foreground">{user.email ?? 'no email'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-10">
          <Stat label="Streak" value={`${user.streak ?? 0}d`} />
          <Stat label="Score" value={user.total_score ?? 0} />
          <Stat label="Solved" value={(user.challenges_completed ?? []).length} />
        </div>

        {completionRows.length > 0 && (
          <div className="mb-10">
            <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">
              Completed challenges
            </h2>
            <div className="border border-border rounded divide-y divide-border">
              {completionRows.map((row) => (
                <div key={row.key} className="px-4 py-2 flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-muted-foreground truncate">
                    {row.challengeName}
                  </span>
                  <span
                    className={`text-[10px] uppercase tracking-wider border rounded px-2 py-0.5 flex-shrink-0 ${row.phaseTone}`}
                  >
                    {row.phaseLabel}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-3 py-2 mb-4">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="px-4 py-2 border border-border rounded text-sm hover:border-red-400/60 hover:text-red-400 transition-colors disabled:opacity-60"
        >
          {loggingOut ? 'Logging out...' : 'Log out'}
        </button>
      </main>
    </div>
  );
}
