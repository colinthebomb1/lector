# Lector

> Practice the security and software engineering skill that comes before every exploit or fix: reading the code.

Lector is a CTF-style learning platform for security-minded software engineers. It teaches learners to read unfamiliar code, trace user-controlled input, understand application behavior, exploit real vulnerabilities in isolated sandboxes, and then patch the bug without breaking normal functionality.

The core idea is simple: no skipping straight to payloads. Each challenge starts with a short reading check, then unlocks either a sandboxed attack workspace or a code-review editor, and finally asks the learner to defend the code with a tested fix.

Built for **LA Hacks** under the **Light the Way (Education)** track.

---

## Table of Contents

- [Why Lector](#why-lector)
- [The Three-Stage Flow](#the-three-stage-flow)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Repository Layout](#repository-layout)
- [Running Locally](#running-locally)
- [Environment Variables](#environment-variables)
- [Challenge Package Format](#challenge-package-format)
- [Tracks: Security and Code Review](#tracks-security-and-code-review)
- [Grading Pipeline](#grading-pipeline)
- [REST API Surface](#rest-api-surface)
- [Agent Integration: MCP Server and CLI](#agent-integration-mcp-server-and-cli)
- [Data Model and Scoring](#data-model-and-scoring)
- [Testing](#testing)
- [LA Hacks Submission](#la-hacks-submission)
- [What's Next](#whats-next)

---

## Why Lector

Most security training platforms reward only the final payload or patch. The actual engineering skill, reading unfamiliar code, tracing data flow, and recognizing where users touch the system, is treated as background knowledge. Beginners can paste payloads from writeups without understanding what made them work, and experienced developers rarely get structured practice connecting a vulnerable line of code to a real consequence.

Lector makes that reading step explicit. Every challenge starts behind a **reading gate**: the learner writes a short summary that names the code's purpose, main flow, and public surface area. Only after that check passes does the workspace open. By the time the learner is sending payloads or rewriting functions, they have already built a mental model of the application.

---

## The Three-Stage Flow

Each challenge moves a learner through a deliberate progression:

### 1. Read

The learner sees the challenge source files in a Monaco editor and writes a short reading summary. The summary is graded against a fixed three-point rubric (`purpose`, `main_flow`, `public_surface`) by Gemma. Feedback is written for the student and avoids leaking exploit details from the reference summary.

### 2. Attack or Review

For **security** challenges, the platform spins up a per-user Docker container running the vulnerable app and serves it back through a reverse proxy embedded in an in-page iframe. The learner browses the target, tests hypotheses, submits payloads, and captures the flag. Every relevant request is saved as payload history for contextual hints.

For **code-review** challenges, there is no container. The learner edits a buggy snippet (JavaScript, Python, Java, or C, depending on the challenge) directly in the browser. A backend grader runs language-specific test harnesses against the submitted code in a temporary directory.

### 3. Defend

After capturing the flag (security) or passing review (code-review), learners enter the defend phase: patch the source so the original exploit no longer works, **without breaking the functional tests**. The grader spins up a fresh container, applies the unified diff, restarts the app, runs `tests/functional.py` (must pass), then runs `tests/exploit.py` (must fail - exploit no longer works). Both have to come out the right way for the patch to grade green.

---

## Key Features

- **Reading-comprehension gate** powered by Gemma, with a fixed three-point rubric and learner-facing feedback that avoids spoiling the exploit.
- **Per-user Docker sandboxes** for security challenges with a 256 MB memory cap, 50% CPU quota, `pids_limit=64`, ephemeral containers, and `auto_remove=True`.
- **Reverse-proxy attack iframe** that rewrites root-relative URLs (`href`, `src`, `action`, `formaction`) to stay inside the proxy and injects a `postMessage` navigation bridge so the parent UI can track iframe clicks and form submits in real time.
- **Per-session flag and admin password** - every attack session mints a fresh `FLAG{<base>_<random>}` and `Acm3!<random>` admin password, injected as `LECTOR_FLAG` and `LECTOR_ADMIN_PASSWORD` environment variables. Two learners on the same challenge see different flags; replay-sharing is impossible.
- **Custom unified-diff applier** with path-traversal protection - patches that try to escape the challenge's `code/` directory are rejected.
- **Multi-language code-review grader** running `node`, `python3`, `javac`/`java`, and `gcc` against learner-submitted code with per-language test harnesses.
- **Three auth providers**: anonymous nickname session (UUID), email + password (pbkdf2_sha256), and Google Identity Services (ID-token verification on the backend).
- **Persistent payload history** - every proxied request the user makes during an attack session is stored in MongoDB and can be replayed for hint generation across sessions.
- **Contextual hint system** with tiers (1 = nudge, 2 = name the concept, 3 = near-solution) plus adaptive hints based on the learner's recent payloads and progress.
- **Daily streak tracking** that survives one missed day so a single skipped attempt doesn't reset progress.
- **Leaderboard** ranked by total score across both tracks.
- **MCP server** exposing the grader as agent-callable tools (`list_lector_challenges`, `lector_verify`) - Claude, ChatGPT, Cursor, etc. can grade patches without an API account.
- **CLI wrapper** (`python -m app.verify_cli verify`) for terminal demos and CI.
- **Resilient Gemma integration** - local fallback when the API key is missing or matches a known placeholder, on any HTTP error, and on unexpected response shapes. Cached responses live in `gemma_cache` keyed by SHA-256 of the prompt with a 7-day TTL.

---

## Architecture

```
┌──────────────────────────┐    ┌──────────────────────────────────────┐
│  Frontend (Vite + React) │    │              Backend (FastAPI)        │
│                          │    │                                       │
│  Landing / Auth          │    │  /api/auth        ── session, signup, │
│  Dashboard               │    │                      Google OAuth     │
│  Challenge Play  ◄─iframe┼────┤  /api/attack      ── start/stop, flag,│
│  Code Review Play        │    │                      hint, proxy      │
│  Profile                 │    │  /api/challenges  ── list, detail     │
│  Leaderboard             │    │  /api/submissions ── summary, patch,  │
│                          │    │                      code-review,     │
│                          │    │                      annotation, hist │
│                          │    │  /api/gemma       ── hints, writeup,  │
│                          │    │                      grade-explanation│
│                          │    │  /api/leaderboard ── top users        │
└──────────────────────────┘    └────────┬──────────────────────────────┘
                                         │
                ┌────────────────────────┼────────────────────────────┐
                │                        │                            │
                ▼                        ▼                            ▼
        ┌──────────────┐     ┌──────────────────────┐      ┌────────────────┐
        │   MongoDB    │     │   Docker daemon      │      │  Gemma API     │
        │              │     │                      │      │                │
        │  users       │     │  Per-attack sessions │      │  Reading check │
        │  submissions │     │  Per-grade ephemeral │      │  Hints         │
        │  attack_     │     │  containers          │      │  Writeups      │
        │   payloads   │     │                      │      │                │
        │  gemma_cache │     │  Network: none for   │      │  (cached;      │
        │   (TTL 7d)   │     │  grading; bridge for │      │   local        │
        │              │     │  attack iframe       │      │   fallback)    │
        └──────────────┘     └──────────────────────┘      └────────────────┘

                                    ┌───────────────────────────────┐
                                    │    Standalone MCP server      │
                                    │    (python -m app.mcp_server) │
                                    │                               │
                                    │    list_lector_challenges     │
                                    │    lector_verify              │
                                    └───────────────────────────────┘
```

The MCP server reuses the same `grade_submission` and `challenge_loader` modules as the HTTP backend - there is one grading code path, exposed two ways.

---

## Tech Stack

**Frontend**

- React 18 + TypeScript
- Vite 6
- Tailwind CSS 4 (`@tailwindcss/vite`)
- Monaco Editor for code display and editing
- shadcn/ui + Radix primitives (full component library under `src/app/components/ui/`)
- `motion` (formerly framer-motion) for animations
- `canvas-confetti` for completion celebrations
- Hand-rolled History API router in `App.tsx` (no `react-router-dom` despite the dependency listing)
- Playwright for smoke tests

**Backend**

- FastAPI + Uvicorn
- Pydantic v2 + `pydantic-settings`
- Motor (async MongoDB driver) + PyMongo
- `docker` Python SDK for container orchestration
- `httpx` for outbound calls (Gemma, attack proxy)
- `passlib[pbkdf2_sha256]` for password hashing
- `google-auth` for Google ID token verification
- `mcp[cli]` for the MCP server
- `pytest` + `pytest-asyncio` for tests

**Sandbox**

- Docker (one image per challenge, tagged `lector-challenge-<id>:latest`)
- Per-grade containers run with `network_mode="none"`, `mem_limit="256m"`, `cpu_quota=50000`, `pids_limit=64`, ephemeral
- Per-attack containers expose port 5000 with a random host binding and `auto_remove=True`

**AI**

- Google AI Studio Gemma (default: `gemma-3-27b-it`) via the `generativelanguage.googleapis.com/v1beta` REST endpoint
- SHA-256 prompt-keyed response cache in MongoDB with a 7-day TTL index
- Deterministic local fallback when the API key is missing/placeholder or any error occurs

---

## Repository Layout

```text
.
├── Frontend/                        # Vite + React app
│   ├── src/app/
│   │   ├── App.tsx                  # Router + auth-aware view switch
│   │   ├── components/
│   │   │   ├── Auth.tsx             # Login / signup / Google sign-in
│   │   │   ├── Landing.tsx          # Marketing landing page
│   │   │   ├── Dashboard.tsx        # Challenge picker
│   │   │   ├── ChallengePlay.tsx    # Read → Attack → Defend workspace
│   │   │   ├── CodeReviewPlay.tsx   # Read → Review workspace
│   │   │   ├── Profile.tsx          # User profile + completed challenges
│   │   │   ├── Nav.tsx
│   │   │   └── ui/                  # shadcn/ui primitives (~50 files)
│   │   ├── data/codeReviewChallenges.ts   # Code-review challenge data
│   │   └── lib/api.ts               # Typed HTTP client, every backend call
│   ├── tests/                       # Playwright smoke tests
│   ├── package.json
│   └── vite.config.ts
│
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app + CORS + lifespan
│   │   ├── config.py                # Settings (LECTOR_* env prefix)
│   │   ├── database.py              # MongoDB connect + index setup
│   │   ├── mcp_server.py            # Standalone MCP server entrypoint
│   │   ├── verify_cli.py            # CLI wrapper around the grader
│   │   ├── models/
│   │   │   ├── challenge.py         # Track, Difficulty, Challenge, HintTier
│   │   │   ├── submission.py        # Submission types/phases/results
│   │   │   └── user.py              # User document
│   │   ├── routers/
│   │   │   ├── auth.py              # Session, signup, login, Google, /me
│   │   │   ├── challenges.py        # List, categories, detail, single file
│   │   │   ├── submissions.py       # Summary, patch, code-review, annotation
│   │   │   ├── attack.py            # Start, stop, flag, hint, proxy, payloads
│   │   │   ├── gemma.py             # Hints, code-review hint, writeup, grade
│   │   │   └── leaderboard.py       # Top scorers
│   │   └── services/
│   │       ├── challenge_loader.py  # Walks challenges/ at startup
│   │       ├── container.py         # Docker orchestration + diff applier
│   │       ├── attack_session.py    # Per-user attack containers
│   │       ├── grader.py            # Unified backbone for both tracks
│   │       ├── code_review_grader.py# Language-specific harnesses
│   │       ├── gemma.py             # AI integration + cache + fallback
│   │       └── streak.py            # Daily streak math
│   ├── challenges/
│   │   └── security/                # 7 security challenges (see below)
│   ├── tests/                       # Backend test suite
│   ├── pytest.ini
│   └── requirements.txt
│
├── docs/AGENT_INTEGRATION.md        # MCP + CLI integration guide
├── scripts/dev.sh                   # One-shot dev stack runner
├── .github/workflows/               # CI: backend tests, frontend checks
├── mcp.json                         # Repo-root MCP server registration
└── README.md
```

---

## Running Locally

### Prerequisites

- **Docker** - required for challenge containers and for local MongoDB if you are not using Atlas
- **Python 3.11+** with `venv`
- **Node.js 18+** and `npm`
- A **Google AI Studio API key** (optional - without one, the local Gemma fallback kicks in and reading checks/hints still work, just deterministically)
- A **Google OAuth client ID** (optional - only needed if you want Google sign-in; email/password and anonymous sessions work without it)

### Quick start: one-shot dev script

The repo ships a helper that brings up the FastAPI backend and Vite frontend in one command. If `LECTOR_MONGO_URL` points at MongoDB Atlas, the script uses Atlas. Otherwise, it starts a local MongoDB container.

```bash
# From repo root
./scripts/dev.sh
```

It will:

1. Use the configured MongoDB Atlas URL from `backend/.env` or the shell when `LECTOR_MONGO_URL` is remote
2. Otherwise, start (or reuse) a `lector-local-mongo` Docker container bound to `127.0.0.1:27017`
3. Launch the backend with `--reload` on `localhost:8000`
4. Launch the frontend with `--strictPort` on port `80` (uses `sudo` only for the bind if needed)
5. Wait for both health checks before printing URLs

The script defaults to a public host of `lector.work` (matching the CORS allowlist and `vite.config.ts`'s `allowedHosts`). Override with environment variables:

```bash
PUBLIC_HOST=localhost FRONTEND_PORT=5173 ./scripts/dev.sh
```

Press Ctrl+C to stop the backend and frontend. The local MongoDB container, when used, stays up between runs so cached Gemma responses and submission history survive.

### Manual setup

If you'd rather run pieces individually:

**Backend**

```bash
cd backend
python -m venv .venv
./.venv/bin/pip install -r requirements.txt
./.venv/bin/python -m uvicorn app.main:app --host localhost --port 8000 --reload
```

**Frontend**

```bash
cd Frontend
npm install
VITE_API_URL=http://localhost:8000 npm run dev
```

By default the Vite config binds `0.0.0.0:80` with `strictPort: true` and only allows the host `lector.work`. For local dev on a different port/host, edit `vite.config.ts` or pass overrides to the dev script.

**MongoDB**

For the shared app, use MongoDB Atlas by setting `LECTOR_MONGO_URL` in `backend/.env`. For fully local development, run MongoDB in Docker:

```bash
docker run -d --name lector-local-mongo -p 127.0.0.1:27017:27017 mongo:7
```

---

## Environment Variables

All backend settings use the `LECTOR_` prefix and can be set in `backend/.env` or as environment variables. Defined in `app/config.py`:

| Variable                     | Default                          | Purpose                                                |
| ---------------------------- | -------------------------------- | ------------------------------------------------------ |
| `LECTOR_APP_NAME`            | `Lector`                         | Display name in `/api/health`                          |
| `LECTOR_DEBUG`               | `True`                           | Pydantic-settings debug flag                           |
| `LECTOR_MONGO_URL`           | `mongodb://localhost:27017`      | MongoDB connection string. Use a MongoDB Atlas `mongodb+srv://...` URL for the shared hosted database |
| `LECTOR_MONGO_DB`            | `lector`                         | Database name                                          |
| `LECTOR_GEMMA_API_KEY`       | `""`                             | Google AI Studio key. Empty/placeholder → local fallback |
| `LECTOR_GEMMA_MODEL`         | `gemma-3-27b-it`                 | Gemma model identifier                                 |
| `LECTOR_DOCKER_BASE_URL`     | `unix:///var/run/docker.sock`    | Docker daemon socket                                   |
| `LECTOR_CONTAINER_TIMEOUT`   | `25`                             | Seconds to wait on Docker operations                   |
| `LECTOR_CONTAINER_POOL_SIZE` | `4`                              | Reserved for future container pooling                  |
| `LECTOR_SESSION_SECRET`      | `change-me-in-production`        | Reserved for future signed-cookie sessions             |
| `LECTOR_SESSION_MAX_AGE`     | `86400`                          | Cookie max age in seconds (24h)                        |
| `LECTOR_GOOGLE_CLIENT_ID`    | `""`                             | Google OAuth client ID. Empty → Google sign-in returns 503 |
| `LECTOR_CHALLENGES_DIR`      | `challenges`                     | Path to challenge tree, relative to backend cwd        |

The Gemma key is treated as "not configured" if it matches any of: `""`, `"your-google-ai-studio-key"`, `"your-api-key-here"`, `"changeme"`, `"todo"`. In that case the backend silently uses `_local_fallback_response` so the app stays functional offline.

Example `backend/.env`:

```env
LECTOR_MONGO_URL=mongodb+srv://<user>:<password>@<cluster-host>/<database>?retryWrites=true&w=majority
LECTOR_MONGO_DB=lector
LECTOR_GEMMA_API_KEY=your-google-ai-studio-key
LECTOR_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

---

## Challenge Package Format

Challenges are loaded at startup by `services/challenge_loader.py` walking `backend/challenges/<track>/<challenge-id>/`. Each challenge directory looks like:

```text
sqli-login-bypass/
├── metadata.json          # Required. Challenge ID, name, track, difficulty, flag, hint tiers
├── scenario.md            # Markdown shown to the learner during the read phase
├── rubric.json            # Rubric used by /api/gemma/grade-explanation
├── Dockerfile             # Required for security challenges; builds the vulnerable app image
├── code/                  # Files shown in the editor + copied into the container at /app
│   ├── app.py
│   ├── db.py
│   └── templates.py
├── tests/
│   ├── exploit.py         # Pytest. Pass = vuln still present (FAIL grade)
│   └── functional.py      # Pytest. Must always pass for any valid patch
├── solution/
│   ├── reference.md       # Reference summary for reading-check comparison
│   └── expected.json      # Expected solution shape (used by tests)
└── secret/
    └── flag.txt           # Static fallback flag if not overridden by per-session env
```

`metadata.json` schema (validated as `ChallengeMetadata`):

```json
{
  "id": "sqli-login-bypass",
  "name": "SQL Injection: Login Bypass",
  "track": "security",
  "difficulty": "easy",
  "category": "injection",
  "description": "A login form builds its SQL query using string formatting...",
  "estimated_minutes": 20,
  "flag": "FLAG{sql_injection_is_not_authentication}",
  "hint_tiers": [
    {"tier": 1, "text": "Look closely at how user input reaches the SQL query..."},
    {"tier": 2, "text": "This is called SQL injection..."},
    {"tier": 3, "text": "Try entering ' OR '1'='1' --  as the username..."}
  ]
}
```

The challenge loader is forgiving: a directory without `metadata.json` is skipped, malformed JSON is skipped (not fatal), and binary files inside `code/` are logged and skipped instead of failing the whole load.

---

## Tracks: Security and Code Review

### Security track (7 challenges)

| ID                            | Name                                     | Difficulty | Category        |
| ----------------------------- | ---------------------------------------- | ---------- | --------------- |
| `sqli-login-bypass`           | SQL Injection: Login Bypass              | easy       | injection       |
| `xss-comment-reflection`      | Cross-Site Scripting: Comment Reflection | easy       | xss             |
| `csrf-profile-email-change`   | CSRF: Profile Email Change               | easy       | csrf            |
| `idor-invoice-download`       | IDOR: Invoice Download Endpoint          | medium     | access-control  |
| `path-traversal-log-export`   | Path Traversal: Log Export               | medium     | file-access     |
| `jwt-none-alg-bypass`         | JWT: none-alg Auth Bypass                | hard       | auth            |
| `ssrf-metadata-fetcher`       | SSRF: Metadata Fetcher                   | hard       | ssrf            |

`sqli-login-bypass`, `xss-comment-reflection`, and `path-traversal-log-export` ship with full Dockerfiles, code, exploit/functional test pairs, and reference solutions. The remaining four are scenario + metadata stubs ready for code and tests to be added.

### Code-review track

Code-review challenges live in the frontend (`Frontend/src/app/data/codeReviewChallenges.ts`) - they're language-specific snippets, not Docker images. The backend grader is registered per `(challenge_id, language)` pair in `code_review_grader.py`:

| Challenge                            | Languages              |
| ------------------------------------ | ---------------------- |
| `code-review-division-factory`       | JavaScript, Python, Java |
| `code-review-what-are-you-pointing-at` | Python, Java, C       |

Each grader writes the submission to a `TemporaryDirectory`, compiles or syntax-checks it (`node --check`, `python3 -c "compile(...)"`, `javac`, `gcc`), then runs a tailored harness that exercises the buggy contract. Failing tests come back with compact stdout/stderr the learner can act on.

---

## Grading Pipeline

### Security track (`grade_submission` → `_grade_security`)

1. Ensure the per-challenge image exists, building from the challenge `Dockerfile` if not (cached in `_built_images` after first build)
2. Spawn a fresh container with `network_mode="none"`, capped resources, `pids_limit=64`
3. Apply the unified diff via `_apply_unified_diff` - a custom parser that handles `diff --git` headers and `@@ -N,M @@` hunks, validates context lines, and rejects patches escaping `code/`
4. `tar` the patched files and `put_archive` them into `/app` inside the container
5. `container.restart()` to pick up the patched files
6. Run `tests/functional.py` (must pass - patch can't break normal app behavior)
7. Run `tests/exploit.py` (must **fail** - the original exploit must no longer work)
8. Tear down the container in a `finally` block

### Code-review track (`grade_code_review_submission`)

1. Look up the registered grader for `(challenge_id, language)`
2. Write the submission to a temporary file
3. Compile/syntax-check
4. Run the language-specific harness with an 8-second timeout
5. Map the result onto a `GradeResult` with status, message, and compact output

### Reading-summary check (`check_reading_comprehension`)

The Gemma prompt is locked to a three-point rubric - `purpose`, `main_flow`, `public_surface`. Missing-point labels outside that allowlist are filtered before reaching the learner. The grader is explicitly instructed not to reveal exploit payloads, fixes, or details from the reference summary that the learner didn't already mention.

---

## REST API Surface

All endpoints are mounted under `/api/`. Authenticated routes require a `session_id` cookie set by `/api/auth/session`, `/api/auth/signup`, `/api/auth/login`, or `/api/auth/google`.

**Auth** (`/api/auth`)

- `POST /session` - anonymous nickname session, returns and sets `session_id`
- `POST /signup` - email + password registration (pbkdf2_sha256)
- `POST /login` - email + password login
- `POST /google` - Google ID token verification + login/upsert
- `GET  /google/client-id` - public Google OAuth client ID (for the frontend)
- `POST /logout` - clears the session cookie
- `GET  /me` - current user, completed challenges, total score, daily streak

**Challenges** (`/api/challenges`)

- `GET /` - list challenges, filterable by `?track=`, `?difficulty=`, `?category=`
- `GET /categories` - distinct sorted category list
- `GET /{challenge_id}` - full detail: scenario, code files, hint tiers, phase availability
- `GET /{challenge_id}/code/{file_path}` - single file from the code package

**Submissions** (`/api/submissions`)

- `POST /summary` - reading summary, graded by Gemma against the three-point rubric
- `POST /patch` - unified diff patch, graded by the security or code-review grader
- `POST /code-review` - full-file code review submission for the code-review track
- `POST /annotation` - line-level annotations + optional fix patch
- `GET  /history/{challenge_id}` - normalized submission timeline + progress summary (`summary_passed`, `attack_captured`, `defend_passed`, `review_fixed`, `attempt_count`, `total_score_awarded`, `last_submission_at`)

**Attack** (`/api/attack`)

- `POST /{id}/start` - spin up the per-user vulnerable container, return host port + proxy base
- `POST /{id}/stop` - kill and remove the container
- `POST /{id}/flag` - validate captured flag (compared against the per-session expected flag)
- `POST /{id}/hint` - Gemma-generated hint based on the user's recent payloads
- `GET  /{id}/payloads` - persisted payload history for this user/challenge
- `ANY  /{id}/proxy/{path}` - reverse proxy to the running container with HTML URL rewriting + nav-bridge injection

**Gemma** (`/api/gemma`)

- `POST /hint` - tier-1/2/3 progressive hint
- `POST /code-review-hint` - adaptive hint with progress estimation (`early`/`partial`/`near`)
- `POST /grade-explanation` - free-text explanation graded against the challenge's `rubric.json`
- `POST /writeup` - personalized post-solve writeup combining the user's attempts and final patch

**Leaderboard** (`/api/leaderboard`)

- `GET /` - top users by `total_score` (capped at 100)

**Health**

- `GET /api/health` - app status and database connectivity

The fully typed frontend client (`Frontend/src/app/lib/api.ts`) covers every endpoint with TypeScript interfaces - it's the easiest spec to read alongside this list.

---

## Agent Integration: MCP Server and CLI

Lector exposes its grader two ways outside the HTTP API, so Claude, ChatGPT, Cursor, and other MCP-aware clients can grade patches without going through the web app. Both reuse the same `grade_submission` code path as the HTTP backend - there's no parallel implementation to drift out of sync.

### MCP server

```bash
cd backend
./.venv/bin/python -m app.mcp_server
```

Tools exposed:

- `list_lector_challenges(track?: "security" | "code-review")` - returns id, name, track, difficulty, category, description, estimated minutes
- `lector_verify(challenge_id: str, patch: str)` - grades a unified diff against a challenge and returns `{status, message, functional_passed, track_test_passed, output, elapsed_seconds}`

The repo root ships an `mcp.json` ready to drop into a client config:

```json
{
  "servers": {
    "lector": {
      "command": "./.venv/bin/python",
      "args": ["-m", "app.mcp_server"],
      "cwd": "./backend"
    }
  }
}
```

### CLI wrapper

For terminal demos and CI:

```bash
cd backend
./.venv/bin/python -m app.verify_cli verify \
  --challenge sqli-login-bypass \
  --patch-file /tmp/fix.diff
```

Exit codes: `0` patch passed, `1` patch graded but failed, `2` bad input (e.g., missing patch file). Output is `model_dump`-ed JSON - easy to pipe into `jq` or assert on in CI.

See [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md) for more.

---

## Data Model and Scoring

### MongoDB collections

- **`users`** - `session_id` (uuid, unique), `nickname`, `name`, `email` (partial-unique), `password_hash` (pbkdf2_sha256), `auth_provider` (`password` | `google`), `google_sub` (partial-unique), `avatar_url`, `created_at`, `challenges_completed: list[str]`, `total_score: int`
- **`submissions`** - `user_id`, `challenge_id`, `submission_type` (`summary` | `flag` | `patch` | `annotation` | `code_review`), `phase` (`read` | `attack` | `defend` | `review`), `payload`, `result: GradeResult`, `score_awarded: int`, `created_at`. Indexed on `created_at` and `(user_id, challenge_id, created_at desc)`
- **`attack_payloads`** - `user_id`, `challenge_id`, `path`, `method`, `form_data`, `response_status`, `timestamp`. Indexed on `(user_id, challenge_id, timestamp desc)`
- **`gemma_cache`** - `_id` = SHA-256 of prompt, `response`, `prompt` (truncated 500 chars), `created_at`. TTL index expires entries after 7 days

### Scoring rules

- **Flag capture** (security attack phase): **+50** points, awarded once per challenge via `challenges_completed: f"{challenge_id}:attack"`
- **Patch passed** (security defend phase): **+100** points, awarded once per challenge via `challenges_completed: challenge_id`
- **Code review passed**: **+100** points, awarded once per challenge via `challenges_completed: challenge_id`

Scoring is deduplicated using a MongoDB `$ne` filter on `challenges_completed`, so re-solving a challenge stores the new submission and shows it in history but never double-scores. The submission record's `score_awarded` reflects the actual points awarded for that specific submission (0 on a re-solve).

### Streaks

`services/streak.py` counts the number of consecutive UTC days, ending today **or yesterday**, on which the user has at least one passing submission. The "yesterday" tolerance is intentional - the streak survives across the day boundary until the user's next attempt, so a single missed day doesn't reset progress.

---

## Testing

### Backend

```bash
cd backend
./.venv/bin/pytest
```

Test suites cover:

- `test_api.py` - challenge listing, detail, single-file fetch
- `test_auth_api.py` - signup, login, session, /me
- `test_attack_api.py` + `test_attack_e2e.py` - attack session lifecycle, flag submission, payload history
- `test_defender_api.py` + `test_defender_e2e.py` - patch submission, grader integration
- `test_code_review_submission_api.py` - language-specific code-review grading
- `test_submission_history.py` - progress summary computation
- `test_ai_hints.py` - Gemma integration with stubbed responses
- `test_container_service.py` - diff applier, path-traversal rejection, tar packaging
- `test_mcp_server.py` - MCP tool surface

### Frontend

```bash
cd Frontend
npm run test:smoke
```

Playwright smoke tests live in `Frontend/tests/`.

### CI

GitHub Actions workflows under `.github/workflows/`:

- `backend-tests.yml` - pytest on the backend
- `frontend-checks.yml` - frontend build/test checks

---

## LA Hacks Submission

Lector is built for **LA Hacks** under the **Light the Way (Education)** track. It addresses a specific gap in security and software engineering education: the comprehension step that gets skipped between "see the challenge" and "fire the payload." Lector makes that step a first-class, gradeable phase that gates the rest of the workspace.

The platform combines:

- Rubric-based reading checks, contextual hints, and post-solve writeups that reinforce code comprehension before exploitation
- Production-grade engineering primitives, including per-user Docker sandboxes, safe diff application, and MCP integration
- A workflow that mirrors secure software engineering practice: read first, hypothesize, verify, then patch

---

## What's Next

- Flesh out the four stub challenges (`csrf-profile-email-change`, `idor-invoice-download`, `jwt-none-alg-bypass`, `ssrf-metadata-fetcher`) with full code, Dockerfiles, and exploit/functional test pairs
- Add more vulnerability classes: SSTI, deserialization, prototype pollution, race-condition TOCTOU, weak crypto
- Expand the code-review track to more languages (Go, Rust, Ruby, TypeScript) and more vulnerability classes per language
- Instructor mode: classroom dashboards, assignment due dates, per-student progress views
- Team rooms: live-event challenges with shared scoreboards
- Richer per-challenge rubrics so Gemma feedback can cite specific checklist items
- Replace the static `gemma-3-27b-it` model setting with a per-task model picker (cheaper models for hints, larger models for explanation grading)
- Progressive challenge unlocking based on prerequisite category mastery

---

## License & Attributions

See [`Frontend/ATTRIBUTIONS.md`](Frontend/ATTRIBUTIONS.md) for frontend attributions.
