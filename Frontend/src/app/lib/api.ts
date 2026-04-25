export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ||
  `${window.location.protocol}//${window.location.hostname}:8000`;

export type Difficulty = 'easy' | 'medium' | 'hard';
export type Track = 'security' | 'code-review';

export interface ChallengeSummary {
  id: string;
  display_number?: number;
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

export interface CodeReviewAiHint {
  hint: string;
  analysis: string;
  progress: 'early' | 'partial' | 'near' | string;
}

export interface CodeReviewSubmissionResult {
  passed: boolean;
  message: string;
  score_awarded: number;
}

export interface PatchResult {
  status: 'pending' | 'running' | 'passed' | 'failed' | 'error';
  message?: string;
  functional_passed?: boolean | null;
  track_test_passed?: boolean | null;
  output?: string;
  elapsed_seconds?: number;
  score_awarded?: number;
}

export interface AttackPayloadRecord {
  path: string;
  method: string;
  form_data: Record<string, string>;
  response_status: number;
  timestamp: string;
}

export interface AttackPayloadHistory {
  challenge_id: string;
  count: number;
  payloads: AttackPayloadRecord[];
}

export interface SubmissionRecord {
  challenge_id: string;
  submission_type: 'summary' | 'flag' | 'patch' | 'annotation';
  phase: 'read' | 'attack' | 'defend' | 'review';
  payload: Record<string, unknown>;
  result: {
    status: 'pending' | 'running' | 'passed' | 'failed' | 'error';
    message?: string;
    functional_passed?: boolean | null;
    track_test_passed?: boolean | null;
    output?: string;
    elapsed_seconds?: number;
  } | null;
  score_awarded?: number;
  created_at: string;
}

export interface SubmissionHistoryProgress {
  summary_passed: boolean;
  attack_captured: boolean;
  defend_passed: boolean;
  review_fixed: boolean;
  attempt_count: number;
  total_score_awarded: number;
  last_submission_at: string | null;
}

export interface SubmissionHistory {
  challenge_id: string;
  submissions: SubmissionRecord[];
  progress: SubmissionHistoryProgress;
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
  codeReviewHint: (payload: {
    challenge_id: string;
    challenge_name: string;
    challenge_prompt: string;
    language: string;
    starter_code: string;
    current_code: string;
    rubric_items: string[];
    static_hints: string[];
    prior_hints: string[];
  }) =>
    request<CodeReviewAiHint>('/api/gemma/code-review-hint', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  submitCodeReview: (payload: {
    challenge_id: string;
    language: string;
    code: string;
    passed: boolean;
    message: string;
  }) =>
    request<CodeReviewSubmissionResult>('/api/submissions/code-review', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  attackPayloads: (id: string) =>
    request<AttackPayloadHistory>(`/api/attack/${encodeURIComponent(id)}/payloads`),
  submissionHistory: (id: string) =>
    request<SubmissionHistory>(`/api/submissions/history/${encodeURIComponent(id)}`),
  submitPatch: (id: string, patch: string) =>
    request<PatchResult>('/api/submissions/patch', {
      method: 'POST',
      body: JSON.stringify({ challenge_id: id, patch }),
    }),
  proxyUrl: (id: string, path = '') =>
    `${API_BASE}/api/attack/${encodeURIComponent(id)}/proxy/${path.replace(/^\//, '')}`,
};
