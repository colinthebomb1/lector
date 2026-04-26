import { useCallback, useEffect, useState } from 'react';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { Profile } from './components/Profile';
import { ChallengePlay } from './components/ChallengePlay';
import { CodeReviewPlay } from './components/CodeReviewPlay';
import { Landing } from './components/Landing';
import { getCodeReviewChallenge } from './data/codeReviewChallenges';
import { api, type ChallengeSummary, type CurrentUser } from './lib/api';

type View = 'home' | 'auth' | 'dashboard' | 'profile' | 'play';
type ChallengeMode = 'overview' | 'attack' | 'defend';
type Route =
  | { view: Exclude<View, 'play'> }
  | { view: 'play'; challengeId: string; mode: ChallengeMode };

function readRoute(): Route {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const challengeMatch = pathname.match(/^\/challenges\/([^/]+)(?:\/(attack|defend))?$/);

  if (challengeMatch) {
    return {
      view: 'play',
      challengeId: decodeURIComponent(challengeMatch[1]),
      mode: (challengeMatch[2] as ChallengeMode | undefined) ?? 'overview',
    };
  }
  if (pathname === '/login' || pathname === '/auth') return { view: 'auth' };
  if (pathname === '/dashboard') return { view: 'dashboard' };
  if (pathname === '/profile') return { view: 'profile' };
  return { view: 'home' };
}

function routePath(route: Route): string {
  if (route.view === 'play') {
    const base = `/challenges/${encodeURIComponent(route.challengeId)}`;
    return route.mode === 'overview' ? base : `${base}/${route.mode}`;
  }
  if (route.view === 'auth') return '/login';
  if (route.view === 'dashboard') return '/dashboard';
  if (route.view === 'profile') return '/profile';
  return '/';
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => readRoute());
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [bootChecked, setBootChecked] = useState(false);
  const [activeChallenge, setActiveChallenge] = useState<ChallengeSummary | null>(null);
  const view = route.view;

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

  const navigate = useCallback((nextRoute: Route, options: { replace?: boolean } = {}) => {
    const nextPath = routePath(nextRoute);
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentPath !== nextPath) {
      const method = options.replace ? 'replaceState' : 'pushState';
      window.history[method]({}, '', nextPath);
    }
    setRoute(nextRoute);
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(readRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    refreshUser().then((me) => {
      const currentRoute = readRoute();
      if (me) {
        setRoute(currentRoute);
      } else if (currentRoute.view !== 'home' && currentRoute.view !== 'auth') {
        navigate({ view: 'home' }, { replace: true });
      } else {
        setRoute(currentRoute);
      }
      setBootChecked(true);
    });
  }, [navigate, refreshUser]);

  useEffect(() => {
    if (!bootChecked || !user || route.view !== 'play') {
      setActiveChallenge(null);
      return;
    }

    if (activeChallenge?.id === route.challengeId) return;

    const codeReviewChallenge = getCodeReviewChallenge(route.challengeId);
    if (codeReviewChallenge) {
      setActiveChallenge(codeReviewChallenge.summary);
      return;
    }

    let cancelled = false;
    setActiveChallenge(null);
    api.challenge(route.challengeId)
      .then((challenge) => {
        if (!cancelled) setActiveChallenge(challenge);
      })
      .catch(() => {
        if (!cancelled) navigate({ view: 'dashboard' }, { replace: true });
      });

    return () => {
      cancelled = true;
    };
  }, [activeChallenge?.id, bootChecked, navigate, route, user]);

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
        onBackToHome={() => navigate({ view: 'home' })}
        onAuthenticated={async (authenticatedUser) => {
          setUser({ authenticated: true, ...authenticatedUser });
          navigate({ view: 'dashboard' }, { replace: true });
          void refreshUser();
        }}
      />
    );
  }

  if (view === 'dashboard' && user) {
    return (
      <Dashboard
        user={user}
        onProfileClick={() => navigate({ view: 'profile' })}
        onSelectChallenge={(c) => {
          setActiveChallenge(c);
          navigate({ view: 'play', challengeId: c.id, mode: 'overview' });
        }}
      />
    );
  }

  if (view === 'play' && user && !activeChallenge) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <span className="text-muted-foreground text-sm">Loading challenge...</span>
      </div>
    );
  }

  if (view === 'play' && user && activeChallenge) {
    if (activeChallenge.track === 'code-review') {
      return (
        <CodeReviewPlay
          challenge={activeChallenge}
          user={user}
          onExit={() => {
            setActiveChallenge(null);
            navigate({ view: 'dashboard' });
          }}
          onCompleted={() => {
            void refreshUser();
          }}
          onProfileClick={() => {
            setActiveChallenge(null);
            navigate({ view: 'profile' });
          }}
          onLoggedOut={() => {
            setActiveChallenge(null);
            setUser(null);
            navigate({ view: 'home' }, { replace: true });
          }}
        />
      );
    }
    return (
      <ChallengePlay
        challenge={activeChallenge}
        challengeId={activeChallenge.id}
        routeWorkspaceMode={route.view === 'play' && route.mode !== 'overview' ? route.mode : null}
        user={user}
        onWorkspaceModeChange={(mode) => {
          navigate({
            view: 'play',
            challengeId: activeChallenge.id,
            mode: mode ?? 'overview',
          });
        }}
        onExit={() => {
          setActiveChallenge(null);
          navigate({ view: 'dashboard' });
        }}
        onCompleted={() => {
          void refreshUser();
        }}
        onProfileClick={() => {
          setActiveChallenge(null);
          navigate({ view: 'profile' });
        }}
        onLoggedOut={() => {
          setActiveChallenge(null);
          setUser(null);
          navigate({ view: 'home' }, { replace: true });
        }}
      />
    );
  }

  if (view === 'profile' && user) {
    return (
      <Profile
        user={user}
        onBack={() => navigate({ view: 'dashboard' })}
        onLoggedOut={() => {
          setUser(null);
          navigate({ view: 'home' }, { replace: true });
        }}
      />
    );
  }

  return (
    <Landing
      user={user}
      onPrimaryClick={() => navigate(user ? { view: 'dashboard' } : { view: 'auth' })}
    />
  );
}
