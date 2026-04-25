export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  'http://localhost:8000';

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Track = 'security' | 'code-review';

export interface ChallengeSummary {
  id: string;
  name: string;
  track: Track;
  difficulty: Difficulty;
  category: string;
  description: string;
  estimated_minutes: number;
}

export interface CurrentUser {
  authenticated: boolean;
  nickname?: string;
  name?: string | null;
  email?: string | null;
  challenges_completed?: string[];
  total_score?: number;
  streak?: number;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  me: () => request<CurrentUser>('/api/auth/me'),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  challenges: (category?: string) =>
    request<ChallengeSummary[]>(
      `/api/challenges${category ? `?category=${encodeURIComponent(category)}` : ''}`,
    ),
  categories: () => request<{ categories: string[] }>('/api/challenges/categories'),
};
