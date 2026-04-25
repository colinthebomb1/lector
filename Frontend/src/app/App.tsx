import { useCallback, useEffect, useState } from 'react';
import { Nav } from './components/Nav';
import { BlinkingCursor } from './components/BlinkingCursor';
import { Feature } from './components/Feature';
import { CodeSnippet } from './components/CodeSnippet';
import { Auth } from './components/Auth';
import { Dashboard } from './components/Dashboard';
import { Profile } from './components/Profile';
import { api, type CurrentUser } from './lib/api';

type View = 'home' | 'auth' | 'dashboard' | 'profile';

export default function App() {
  const [view, setView] = useState<View>('home');
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [bootChecked, setBootChecked] = useState(false);

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
  if (showAuth) {
    return (
      <Auth
        onBackToHome={() => setShowAuth(false)}
        onAuthenticated={() => setShowAuth(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav onAuthClick={() => setView(user ? 'dashboard' : 'auth')} />

      {/* Hero Section */}
      <section className="min-h-screen flex flex-col items-center justify-center px-4 md:px-8 relative overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
        <div className="absolute inset-0 bg-gradient-radial from-transparent via-transparent to-background/50"></div>
        <div className="max-w-4xl mx-auto text-center relative z-10">
          <h1 className="flex items-center justify-center mb-6 animate-fadeInUp" style={{ fontSize: 'clamp(48px, 8vw, 120px)', lineHeight: '1.1' }}>
            Lector
            <BlinkingCursor />
          </h1>
          <p className="text-base md:text-xl tracking-wide text-foreground/60 mb-12 max-w-2xl mx-auto animate-fadeInUp animate-delay-100">
            Learn to read code. Learn to think like a debugger.
          </p>
          <div className="flex gap-4 justify-center flex-wrap animate-fadeInUp animate-delay-200">
            <button
              onClick={() => setView(user ? 'dashboard' : 'auth')}
              className="px-6 md:px-8 py-3 bg-accent text-accent-foreground hover:bg-accent/90 transition-all hover:scale-105"
            >
              {user ? 'Open Dashboard →' : 'Start Reading →'}
            </button>
            <button className="px-6 md:px-8 py-3 border border-foreground/20 text-foreground hover:bg-foreground/10 transition-all hover:border-foreground/40">
              See an Example
            </button>
          </div>
        </div>
      </section>

      {/* Feature Strip */}
      <section className="py-16 md:py-24 px-4 md:px-8 border-t border-border">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12">
            <Feature
              title="Read Code"
              description="Develop the skill to parse unfamiliar codebases quickly and build accurate mental models."
              code={`def trace(fn):\n    def wrapped(*args, **kwargs):\n        print(f"calling {fn.__name__}", args, kwargs)\n        return fn(*args, **kwargs)\n\n    return wrapped`}
            />
            <Feature
              title="Trace Bugs"
              description="Follow execution paths, spot edge cases, and understand why code breaks before running it."
              code={`if user is not None and user.role == "admin":\n    # What if user.role is missing?\n    # What if role is None?\n    return render_dashboard()`}
            />
            <Feature
              title="Build Intuition"
              description="Move beyond syntax to understand patterns, trade-offs, and architectural decisions."
              code={`from datetime import datetime\n\n# Why use a factory?\ndef create_user(data):\n    return {\n        **data,\n        "created_at": datetime.utcnow(),\n    }`}
            />
          </div>
        </div>
      </section>

      {/* Example Block */}
      <section className="py-16 md:py-24 px-4 md:px-8 bg-card border-t border-border">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl mb-8 md:mb-12 text-center">How It Works</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div>
              <h3 className="text-sm uppercase tracking-wider text-muted-foreground mb-4">
                The Code
              </h3>
              <CodeSnippet
                code={`async def fetch_user(user_id, client):\n    response = await client.get(f"/api/users/{user_id}")\n\n    if response.status_code != 200:\n        raise RuntimeError(f"request failed: {response.status_code}")\n\n    return response.json()`}
              />
            </div>
            <div className="flex flex-col gap-6">
              <h3 className="text-sm uppercase tracking-wider text-muted-foreground">
                Guided Questions
              </h3>
              <div className="space-y-4">
                <div className="p-4 bg-background border border-border rounded hover:border-accent/50 transition-colors">
                  <p className="text-sm text-foreground/80">
                    <span className="text-accent mr-2">→</span>
                    What happens if the network request times out?
                  </p>
                </div>
                <div className="p-4 bg-background border border-border rounded hover:border-accent/50 transition-colors">
                  <p className="text-sm text-foreground/80">
                    <span className="text-accent mr-2">→</span>
                    Why does this function need to be async in Python?
                  </p>
                </div>
                <div className="p-4 bg-background border border-border rounded hover:border-accent/50 transition-colors">
                  <p className="text-sm text-foreground/80">
                    <span className="text-accent mr-2">→</span>
                    What error information is lost in this raised exception?
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-8 border-t border-border">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-1">
            <span className="text-accent">L</span>
            <span className="text-accent">_</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © 2026 Lector
          </p>
        </div>
      </footer>
    </div>
  );
}
