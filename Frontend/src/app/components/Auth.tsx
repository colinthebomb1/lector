import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { BlinkingCursor } from './BlinkingCursor';
import { API_BASE } from '../lib/api';

interface AuthProps {
  onBackToHome?: () => void;
  onAuthenticated?: (user: { nickname: string; email: string | null }) => void;
}

interface GoogleCredentialResponse {
  credential: string;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: GoogleCredentialResponse) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: {
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              width?: number;
            },
          ) => void;
        };
      };
    };
  }
}

export function Auth({ onBackToHome, onAuthenticated }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);
  const [googleLibraryReady, setGoogleLibraryReady] = useState(false);
  const googleButtonRef = useRef<HTMLDivElement | null>(null);

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setError(null);
    setSuccess(null);
  };

  useEffect(() => {
    let isActive = true;

    async function loadGoogleClientId() {
      try {
        const response = await fetch(`${API_BASE}/api/auth/google/client-id`, {
          credentials: 'include',
        });
        const data = await response.json().catch(() => ({}));

        if (!isActive) {
          return;
        }

        if (!response.ok) {
          throw new Error(
            (typeof data?.detail === 'string' && data.detail) ||
              'Could not load Google sign-in configuration.',
          );
        }

        if (data.configured && typeof data.client_id === 'string') {
          setGoogleClientId(data.client_id);
        }
      } catch {
        if (isActive) {
          setGoogleClientId(null);
        }
      }
    }

    loadGoogleClientId();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (window.google?.accounts.id) {
      setGoogleLibraryReady(true);
      return;
    }

    const intervalId = window.setInterval(() => {
      if (window.google?.accounts.id) {
        setGoogleLibraryReady(true);
        window.clearInterval(intervalId);
      }
    }, 250);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!googleClientId || !googleLibraryReady || !googleButtonRef.current || !window.google?.accounts.id) {
      return;
    }

    const buttonRoot = googleButtonRef.current;
    buttonRoot.innerHTML = '';

    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async ({ credential }) => {
        setSubmitting(true);
        setError(null);
        setSuccess(null);

        try {
          const response = await fetch(`${API_BASE}/api/auth/google`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential }),
          });

          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            const detail =
              (typeof data?.detail === 'string' && data.detail) ||
              'Google sign-in failed. Please try again.';
            setError(detail);
            return;
          }

          setSuccess(`Signed in as ${data.nickname ?? data.email ?? 'reader'}.`);
          onAuthenticated?.({ nickname: data.nickname, email: data.email ?? null });
        } catch {
          setError('Could not reach the server. Is the backend running?');
        } finally {
          setSubmitting(false);
        }
      },
    });

    window.google.accounts.id.renderButton(buttonRoot, {
      theme: 'outline',
      size: 'large',
      text: isLogin ? 'signin_with' : 'signup_with',
      shape: 'rectangular',
      width: 320,
    });
  }, [googleClientId, googleLibraryReady, isLogin, onAuthenticated]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!email.trim() || !password) {
      setError('Email and password are required.');
      return;
    }
    if (!isLogin && !name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!isLogin && password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/signup';
    const payload = isLogin
      ? { email: email.trim(), password }
      : { name: name.trim(), email: email.trim(), password };

    setSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail =
          (typeof data?.detail === 'string' && data.detail) ||
          (Array.isArray(data?.detail) && data.detail[0]?.msg) ||
          (response.status === 409
            ? 'An account with that email already exists.'
            : response.status === 401
              ? 'Invalid email or password.'
              : 'Something went wrong. Please try again.');
        setError(detail);
        return;
      }

      setSuccess(
        isLogin
          ? `Welcome back, ${data.nickname ?? 'reader'}.`
          : `Account created for ${data.email ?? email.trim()}.`,
      );
      setPassword('');
      onAuthenticated?.({ nickname: data.nickname, email: data.email ?? null });
    } catch (err) {
      setError('Could not reach the server. Is the backend running?');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-grid-pattern opacity-5"></div>
      <div className="absolute inset-0 bg-gradient-radial"></div>

      <div className="max-w-md w-full relative z-10">
        <div className="text-center mb-12">
          <h1
            className="flex items-center justify-center mb-4"
            style={{ fontSize: '64px', lineHeight: '1.1' }}
          >
            Lector
            <BlinkingCursor />
          </h1>
          <p className="text-muted-foreground text-sm tracking-wide">
            {isLogin ? 'Welcome back' : 'Begin your journey'}
          </p>
        </div>

        <div className="bg-card border border-border rounded p-8">
          <div className="flex gap-4 mb-8 border-b border-border">
            <button
              type="button"
              onClick={() => switchMode(true)}
              className={`pb-3 px-1 transition-colors relative ${
                isLogin ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              Login
              {isLogin && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"></div>}
            </button>
            <button
              type="button"
              onClick={() => switchMode(false)}
              className={`pb-3 px-1 transition-colors relative ${
                !isLogin ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              Sign Up
              {!isLogin && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"></div>}
            </button>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            {!isLogin && (
              <div>
                <label htmlFor="name" className="block text-sm mb-2 text-foreground/80">
                  Name
                </label>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="w-full bg-background border border-border rounded px-4 py-3 text-foreground focus:outline-none focus:border-accent transition-colors"
                  placeholder="your_name"
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-sm mb-2 text-foreground/80">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="w-full bg-background border border-border rounded px-4 py-3 text-foreground focus:outline-none focus:border-accent transition-colors"
                placeholder="user@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm mb-2 text-foreground/80">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                minLength={isLogin ? undefined : 8}
                className="w-full bg-background border border-border rounded px-4 py-3 text-foreground focus:outline-none focus:border-accent transition-colors"
                placeholder="••••••••"
              />
            </div>

            {isLogin && (
              <div className="flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 text-foreground/60 cursor-pointer">
                  <input
                    type="checkbox"
                    className="w-4 h-4 bg-background border border-border rounded accent-accent cursor-pointer"
                  />
                  Remember me
                </label>
                <a href="#forgot" className="text-accent hover:underline">
                  Forgot password?
                </a>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-400 border border-red-400/30 bg-red-400/5 rounded px-3 py-2">
                {error}
              </div>
            )}
            {success && !error && (
              <div className="text-sm text-accent border border-accent/30 bg-accent/5 rounded px-3 py-2">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-accent text-accent-foreground py-3 rounded hover:bg-accent/90 transition-all hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {submitting
                ? isLogin
                  ? 'Logging in...'
                  : 'Creating account...'
                : isLogin
                  ? 'Login →'
                  : 'Create Account →'}
            </button>
          </form>

          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-border"></div>
            <span className="text-muted-foreground text-sm">or</span>
            <div className="flex-1 h-px bg-border"></div>
          </div>

          <div className="space-y-3">
            {googleClientId ? (
              <div className="flex justify-center">
                <div ref={googleButtonRef} />
              </div>
            ) : (
              <button
                type="button"
                disabled
                className="w-full bg-background border border-border py-3 rounded opacity-60 cursor-not-allowed flex items-center justify-center gap-2"
              >
                Continue with Google
              </button>
            )}
          </div>
        </div>

        <div className="text-center mt-8">
          <button
            onClick={onBackToHome}
            className="text-muted-foreground text-sm hover:text-accent transition-colors"
          >
            ← Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
