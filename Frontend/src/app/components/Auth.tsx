import { useState } from 'react';
import type { FormEvent } from 'react';
import { BlinkingCursor } from './BlinkingCursor';
import { API_BASE } from '../lib/api';

interface AuthProps {
  onBackToHome?: () => void;
  onAuthenticated?: (user: { nickname: string; email: string | null }) => void;
}

export function Auth({ onBackToHome, onAuthenticated }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const switchMode = (login: boolean) => {
    setIsLogin(login);
    setError(null);
    setSuccess(null);
  };

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
            <button
              type="button"
              className="w-full bg-background border border-border py-3 rounded hover:bg-foreground/5 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
              Continue with GitHub
            </button>
            <button
              type="button"
              className="w-full bg-background border border-border py-3 rounded hover:bg-foreground/5 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Continue with Google
            </button>
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
