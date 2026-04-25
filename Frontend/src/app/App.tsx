import { useCallback, useEffect, useState } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { Profile } from './components/Profile';
import { ChallengePlay } from './components/ChallengePlay';
import { Landing } from './components/Landing';
import { api, type CurrentUser } from './lib/api';

type View = 'home' | 'auth' | 'dashboard' | 'profile' | 'play';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [bootChecked, setBootChecked] = useState(false);
  const [activeChallengeId, setActiveChallengeId] = useState<string | null>(null);

  const refreshUser = useCallback(async () => {
    try {
      const me = await api.me();
      if (me.authenticated) {
        setUser(me);
        return me;
      }
    } catch {
      // network/server hiccup — treat as logged-out
    }
    setUser(null);
    return null;
  }, []);

  useEffect(() => {
    refreshUser().then((me) => {
      if (me) setView('dashboard');
      setBootChecked(true);
    });
  }, [refreshUser]);

  if (!bootChecked) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading...</span>
      </div>
    );
  }

  if (view === 'auth') {
    return (
      <Auth
        onBackToHome={() => setView('home')}
        onAuthenticated={async () => {
          await refreshUser();
          setView('dashboard');
        }}
      />
    );
  }

  if (view === 'dashboard' && user) {
    return (
      <Dashboard
        user={user}
        onProfileClick={() => setView('profile')}
        onSelectChallenge={(c) => {
          setActiveChallengeId(c.id);
          setView('play');
        }}
      />
    );
  }

  if (view === 'play' && user && activeChallengeId) {
    return (
      <ChallengePlay
        challengeId={activeChallengeId}
        user={user}
        onExit={() => {
          setActiveChallengeId(null);
          setView('dashboard');
        }}
        onCompleted={() => {
          void refreshUser();
        }}
        onProfileClick={() => {
          setActiveChallengeId(null);
          setView('profile');
        }}
        onLoggedOut={() => {
          setActiveChallengeId(null);
          setUser(null);
          setView('home');
        }}
      />
    );
  }

  if (view === 'profile' && user) {
    return (
      <Profile
        user={user}
        onBack={() => setView('dashboard')}
        onLoggedOut={() => {
          setUser(null);
          setView('home');
        }}
      />
    );
  }

  return <Landing user={user} onPrimaryClick={() => setView(user ? 'dashboard' : 'auth')} />;
}
