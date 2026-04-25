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

export interface HintTier {
  tier: number;
  text: string;
}

export interface ChallengeDetail extends ChallengeSummary {
  scenario: string;
  code_files: Record<string, string>;
  hint_tiers: HintTier[];
  has_attack_phase: boolean;
  has_defend_phase: boolean;
}

export interface AttackSession {
  status: string;
  challenge_id: string;
  port: number;
  proxy_base: string;
}

export interface FlagResult {
  accepted: boolean;
  message: string;
}

export interface AttackHint {
  hint: string;
  analysis: string;
  attempts_analyzed: number;
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
  challenge: (id: string) =>
    request<ChallengeDetail>(`/api/challenges/${encodeURIComponent(id)}`),
  startAttack: (id: string) =>
    request<AttackSession>(`/api/attack/${encodeURIComponent(id)}/start`, {
      method: 'POST',
    }),
  stopAttack: (id: string) =>
    request<{ status: string }>(`/api/attack/${encodeURIComponent(id)}/stop`, {
      method: 'POST',
    }),
  submitFlag: (id: string, flag: string) =>
    request<FlagResult>(`/api/attack/${encodeURIComponent(id)}/flag`, {
      method: 'POST',
      body: JSON.stringify({ flag }),
    }),
  attackHint: (id: string) =>
    request<AttackHint>(`/api/attack/${encodeURIComponent(id)}/hint`, {
      method: 'POST',
    }),
  proxyUrl: (id: string, path = '') =>
    `${API_BASE}/api/attack/${encodeURIComponent(id)}/proxy/${path.replace(/^\//, '')}`,
};
