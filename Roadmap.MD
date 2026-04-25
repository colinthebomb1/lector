Lector — LA Hacks 2026 Roadmap
A platform that teaches people to read code. Two tracks: Security (attack + defend) and Code Review (audit + fix). Both graded by replaying the actual consequence — does the exploit still work? do the tests still pass?


TL;DR
Reading code is the most-used skill in software engineering and almost nowhere teaches it deliberately. Lector is interactive reading practice with objective grading: you read a codebase, identify what's wrong, propose a fix, and the platform verifies you were right by actually executing the consequence. Two tracks share one backend, one grader, one UX — and the execution-based grader ships as an MCP tool so AI coding agents can validate their own changes.

Primary track: Light the Way (education). Sponsor stack: Cognition ($6k), Gemma, MongoDB, Vultr, GoDaddy.


Product Overview
The two tracks
Security Track: Attack → Defend

User exploits a vulnerable app running in a sandbox, captures a flag
User edits the source to patch the vulnerability
Grader rebuilds the container with the patch, replays the original exploit — if it fails now, the patch worked
Functional tests must still pass (user didn't break the app)

Code Review Track: Audit → Fix

User reads a file or short codebase containing one or more bugs
User annotates lines they think are buggy, picks a category (logic error, off-by-one, race condition, etc.), explains why
Optionally: user proposes a fix
Grader runs the test suite — if tests pass after applying the fix, the user fixed it correctly
Gemma grades the written explanation against a rubric
The reading-first pedagogy
Both tracks lead with a reading comprehension step before the active task. User reads the file, writes a 1-2 sentence summary of what it does, Gemma checks it against a reference. Only then do they move to finding bugs or writing exploits. This is the pedagogical differentiator — nobody else makes reading the explicit first step.

After every solve, users see an "expert path" replay showing how an experienced reviewer would have read the file (look at imports, identify public surface, trace user input, check boundaries). The meta-skill of how to read is taught, not just the skill of finding bugs.


Architecture
┌─────────────────┐

│  Next.js (FE)   │  Challenge browser, reader, Monaco editor, annotation UI,

└────────┬────────┘  terminal/iframe, leaderboard, results report

         │ REST + WebSocket (live container output during exploit)

┌────────▼────────┐

│  FastAPI (BE)   │  Auth (session cookie), challenge loader, submission

└──┬─────┬─────┬──┘  routing, grader dispatch, MCP tool endpoint

   │     │     │

   │     │     └──► Docker engine (sandboxed per-session containers)

   │     │           ├─ Patch verifier (security track)

   │     │           └─ Test runner (code review track)

   │     │

   │     └──► Gemma API (reading comprehension, hints, explanation grading,

   │                     post-solve feedback)

   │

   └──► MongoDB Atlas (challenges, users, submissions, annotations,

                       leaderboard, reading summaries)

Both graders share the same container orchestration layer. The only difference is what they run after applying the user's change — the security grader runs the exploit, the code review grader runs the tests.


Tech Stack
Layer
Choice
Why
Backend
Python 3.11 + FastAPI
Async, great Docker SDK, fastest to ship
Frontend
Next.js 14 (App Router) + TS + Tailwind
Cuts boilerplate, strong DX
Editor
Monaco
Diff view, annotations via decorations API, syntax highlighting
UI kit
shadcn/ui
Pre-built components, ship faster
Database
MongoDB Atlas
Sponsor checkbox, free tier is plenty
Containers
Docker + Python docker SDK
Skip Kubernetes — too much overhead for 36h
AI
Gemma 3 via Google AI Studio
Sponsor checkbox, free tier
Auth
Anonymous session cookie + nickname
No OAuth, demo-friendly
Hosting
Vultr (8GB instance, Docker preinstalled)
Sponsor checkbox
Domain
GoDaddy — closeread.dev or similar
Sponsor checkbox



Challenge Spec (unified format across both tracks)
challenges/<track>/<id>/

  metadata.json      # name, difficulty, category, track, hint tiers

  scenario.md        # user-facing context/instructions

  code/              # the files the user reads

  solution/

    reference.md     # reference summary for the reading comprehension step

    expected.json    # expected findings (line ranges, category, key concepts)

  Dockerfile         # how to build the running/testable environment

  tests/

    functional.py    # basic behavior (applies to both tracks)

    exploit.py       # security-only: runs the original exploit

    bug_tests.py     # code-review-only: tests that currently fail due to the bug

  rubric.json        # Gemma grading rubric for free-text explanations

The unified format lets the challenge loader be track-agnostic. Only the grader dispatches differently based on the track field.


Security Track Challenges
Aim for 3-4 challenges of escalating difficulty. All target web vulns — no binary exploitation (doesn't demo well to general judges).
SQLi Login Bypass (Easy, ~20 min target)
Vuln: cursor.execute(f"SELECT * FROM users WHERE name='{u}' AND pw='{p}'")
Attack: ' OR '1'='1 logs in as admin, flag visible on /admin
Patch: Parameterized query
Path Traversal (Easy-Medium, ~30 min)
Vuln: File viewer does open(f"./files/{user_input}")
Attack: ?file=../../../flag.txt
Patch: os.path.realpath() containment check
IDOR (Medium, ~45 min)
Vuln: GET /api/users/<id>/profile returns any user's profile; admin bio contains flag
Attack: Iterate IDs starting from 1
Patch: Check session user matches requested ID
Command Injection (Medium, ~45 min)
Vuln: Admin diagnostic runs os.system(f"ping -c 1 {host}")
Attack: 8.8.8.8; cat /flag.txt
Patch: subprocess.run([...]) with argument list + input validation
SSRF (Stretch goal, drop if behind)
Vuln: URL preview service fetches arbitrary URLs
Attack: Hit internal metadata endpoint
Patch: Block private IPs, prevent DNS rebinding


Code Review Track Challenges
Mix of formats and difficulties. Aim for 6-8 challenges total across the formats below. Authoring is cheaper than security challenges because no exploit design is needed — just plant a bug, write tests that catch it, provide a reference fix.
Format A: The PR Review (4-5 challenges)
Unified diff presented like on GitHub. User decides: does this introduce a bug, fix one, or neither? If it introduces one, annotate + explain.

Example bugs to plant:

Off-by-one in pagination (range(1, n) instead of range(1, n+1))
Cached permission check that doesn't invalidate on role change
async function whose return value is never awaited, swallowing errors silently
Regex that matches more than intended (e.g., . instead of \. in email validation)
Shared mutable default argument in Python function signature
Format B: Codebase Audit (1-2 challenges)
Small repo (5-15 files, ~500-1500 lines), N bugs planted. User finds all N. Much harder, more realistic.

Example: A Flask course management app with 3 bugs — an IDOR in grade viewing, a race condition in class drops that bypasses the deadline, and a mass-assignment flaw in profile updates.
Format C: Vulnerability Diff / Which Change Broke It (2-3 challenges)
Show original vs refactored version, refactor introduces one bug. User identifies the bad change.

Example: Original uses WHERE user_id = ?, refactor "modernizes" to an ORM .raw() call with f-string interpolation. Three changes total, one is the bug.
Bug variety to cover
Aim for breadth across categories so the track feels diverse:

Logic errors (off-by-one, wrong comparison, inverted condition)
Concurrency (race conditions, TOCTOU, unsynchronized shared state)
Error handling (swallowed exceptions, wrong error type, missing cleanup)
API design (mutable defaults, leaky abstractions, poor naming that causes misuse)
Performance (N+1 queries, unbounded loops, missing indexes)
Correctness (off-by-ones in slices, floating point comparison, timezone bugs)
Edge cases (empty input, null handling, overflow)


The Grader (shared backbone)
Both tracks use the same algorithm skeleton. The only difference is what runs after the patch is applied.

def grade_submission(challenge, submission, track):

    container = spawn_fresh_container(challenge.id)  # ~3-5 sec

    try:

        apply_patch(container, submission.patch)     # git apply

        restart_app(container)                       # ~2 sec

        # Functional test: did the user break basic behavior? (both tracks)

        functional = run_test(container, "tests/functional.py", timeout=10)

        if not functional.passed:

            return Failed("You broke the app: " + functional.output)

        if track == "security":

            # Does the original exploit still work?

            exploit = run_test(container, "tests/exploit.py", timeout=10)

            if exploit.passed:

                return Failed("Vulnerability still present")

            return Success("Exploit neutralized")

        elif track == "code-review":

            # Do the bug-exposing tests now pass?

            bug_tests = run_test(container, "tests/bug_tests.py", timeout=10)

            if not bug_tests.passed:

                return Failed("Bug still reproducible: " + bug_tests.output)

            return Success("Bug fixed")

    finally:

        container.kill()

Target: under 25 seconds per grade. Pre-warm containers during idle time to cut this further.
Why this works for both tracks
This is the whole product's technical spine. The grader doesn't care about why something is wrong — it only cares about consequence. Security = "exploit no longer works." Code review = "tests that exposed the bug now pass." Same mechanism, different signal. That symmetry is what makes the two tracks feel like one product.


Gemma Integration Points
Reading comprehension check (both tracks)
User writes a 1-2 sentence summary of what the file does before any active task. Gemma compares to the reference summary against a rubric (does it identify the purpose? the main flow? the public surface?). Missing key points triggers a nudge: "You didn't mention what happens when the input is empty — take another look."
Progressive hints (both tracks)
Three tiers per challenge, adaptive based on what the user has already tried:

Nudge: "Look closely at how user input reaches the query."
Concept: "This is a class of bug called SQL injection. Research parameterized queries."
Near-solution: "Replace string formatting with cursor.execute(query, (params,))."

Pre-write tier 1 and 3 per challenge; Gemma personalizes tier 2 based on user's submission history.
Free-text explanation grading (code review)
Don't ask "is this explanation good?" — that's vibes. Use a structured rubric per challenge:

Rubric items (yes/no each):

- Names the bug class (expected: race condition)

- Identifies the root cause (expected: unsynchronized access to shared counter)

- Describes the impact (expected: duplicate order processing under load)

Gemma answers per item with evidence from the user's text. Scoring is deterministic on top of rubric match.
Post-solve explanation (both tracks)
After a successful solve, Gemma generates a personalized writeup referencing:

The original bug
The user's specific attempts (you logged them)
The user's fix
Canonical references (OWASP for security, well-known writeups for code quality)
Expert reading replay (both tracks)
After solve, show "how an expert would have approached this file" — a sequence of highlighted regions with commentary ("Start with the imports — subprocess without shlex is worth flagging"). Can be pre-authored per challenge or Gemma-generated from the reference solution.


The Cognition MCP Angle
Expose the grader as an MCP tool so AI coding agents can call it:

cyberleet_verify(challenge_id, patch) -> GradeResult

This isn't a separate product — it's the same grader, exposed over MCP. An AI coding agent editing a file can use it to verify its own change before committing. Works for both tracks:

Security: "Did Claude's security patch actually block the exploit?"
Code review: "Did Claude's bug fix make the failing test pass without breaking others?"

Ship a CLI wrapper too: closeread verify --challenge <id> --patch x.diff. Document at docs/AGENT_INTEGRATION.md. Record a short clip of Claude Code calling it for the demo — this is the Cognition killshot.


Sponsor Integration Plan
Sponsor
Prize
Integration
Status
Light the Way (track)
Track prize
Primary submission. Pitch: "we teach the most-used, least-taught engineering skill."
Primary
Cognition — Augment the Agent
$6k cash + Devin ACUs + Windsurf Pro
Grader exposed as MCP tool so AI agents can verify their own changes (security patches AND bug fixes).
Primary secondary
Gemma (MLH)
Swag
Reading comprehension checks, adaptive hints, rubric-based explanation grading, post-solve writeups, expert reading replay
Built in
MongoDB Atlas (MLH)
M5Stack IoT kits
Challenges, users, submissions, annotations, leaderboard
Built in
Vultr (MLH)
Portable screens
Host entire platform + sandbox containers
Built in
GoDaddy (MLH)
Gift card
closeread.dev or similar
10 min task


Skipping: Cloudinary, Roblox, HHKB, Arista, ElevenLabs, Solana, ASUS, Zetic, Fetch.ai, World U, Figma. None fit without forced retrofitting.


36-Hour Timeline
Phase 0: Setup (0–3h)
Repo, branches, domain bought, DNS pointing at Vultr
MongoDB Atlas cluster provisioned, initial schemas defined
Gemma API key, Vultr instance live with hello world
Walking skeleton: challenge 1 (SQLi) end-to-end via curl — vulnerable app, Dockerfile, exploit test, patch verifier invocation. No UI yet. If this doesn't work by hour 6, everything else is in jeopardy.
API contract frozen: submission schema, challenge file format, grader response shape
Decide shared conventions: directory structure, naming, branch strategy
Phase 1: Grader + Backend Core (3–10h)
Container lifecycle: spawn / expose port / kill / health check / pre-warm pool
Unified grader (both track modes share the same entry point)
Challenge loader reads the challenges/ tree at startup
Submission API endpoints: reading summary, flag, patch, annotation, fix
WebSocket endpoint for live container output (optional, nice for demo)
Session cookie auth middleware

Milestone at hour 10: Backend can grade both a security submission (patch SQLi) and a code review submission (fix a seeded bug) via curl. No frontend yet.
Phase 2: Frontend Core (6–18h, starts in parallel with Phase 1)
Next.js app scaffolded, routing: home, challenge list, challenge page, results, leaderboard
Challenge browser with track toggle + filters (difficulty, category, status)
Challenge page layout: reader panel + editor panel + output panel (terminal for security, test runner for code review)
Monaco integration including diff view
Annotation system — click line numbers to annotate, findings list in side panel
Reading comprehension step UI (summary input before active task)
Submission flows for all input types (summary, flag, patch, annotation + fix)
Results/report page showing what was right, what was missed, Gemma feedback
Loading states for 20s+ grader waits (progress messages, not just spinners)

Milestone at hour 18: Full end-to-end flow works in browser for one security challenge and one code review challenge.
Phase 3: Content at Volume (14–26h, parallel with later Phase 2 work)
Author remaining security challenges (3-4 total)
Author code review challenges (6-8 total across Formats A/B/C)
Reference summaries + rubrics for each
Pre-authored hint tiers per challenge
Seed leaderboard with plausible fake users so it isn't empty at demo time
Sleep by hour 24. 4-6 hours of sleep on Saturday night is non-negotiable.
Phase 4: Gemma Integration (18–28h, parallel)
Reading comprehension endpoint
Hint endpoint (tier 1/2/3 progression)
Explanation grading endpoint (rubric-based)
Post-solve writeup endpoint
Expert reading replay (pre-authored per challenge, Gemma-personalized if time)
Cache all Gemma responses keyed on prompt hash — saves API cost and handles flakiness
Phase 5: Cognition MCP Hook (26–30h)
MCP tool wrapper around the grader
CLI: closeread verify --challenge <id> --patch x.diff
docs/AGENT_INTEGRATION.md with setup + usage
Record short clip of Claude Code calling the MCP tool for the demo
Phase 6: Polish + Demo (30–36h)
Visual polish: homepage hero, challenge page, success states, transitions
Full flow test in incognito — every challenge, both tracks, fresh session
Record demo video (see script below)
Write Devpost description
Pitch rehearsal: 60-second version + 3-minute version, timed
Arrive at judging table 15 min early


Demo Video Script (2:30 target)
Time
Beat
0:00–0:15
Hook. "Engineers spend more time reading code than writing it. Nothing teaches you how." Show a GitHub PR with 400 changed lines, someone typing "LGTM" as the only review comment. Cut.
0:15–0:35
The reading step. Open Lector, pick a code review challenge. User reads the file, writes a one-sentence summary. Gemma: "Almost — you didn't mention the function returns early on invalid input. Take another look." User revises, passes.
0:35–1:05
Code review track. User annotates a suspicious block, picks "race condition," writes a brief explanation. Proposes a fix in Monaco. Hit verify. Loader: ✓ Spawning container... ✓ Applying fix... ✓ Bug-exposing test now passes... ✓ Functional tests still pass. Solved.
1:05–1:45
Security track. Switch tracks. Pick SQLi challenge. Exploit the live login form with ' OR '1'='1, get the flag. Switch to defend mode. Parameterize the query. Hit verify. ✓ Original exploit blocked. Solved.
1:45–2:10
Expert reading replay. After solve, show the "how an expert reads this" walkthrough — highlights moving through the file with narrated commentary. "We don't just grade the answer. We teach the skill of how to look."
2:10–2:25
Cognition pitch. Terminal. Claude Code is editing a file, calls our MCP tool to verify its own fix. Tool reports "bug test still failing." Claude rewrites. Re-verifies. Passes. "AI agents can now grade their own understanding."
2:25–2:30
Logo + URL.



Risk Register & Cut Lines
Risks
Risk
Mitigation
Container orchestration flakes during demo
Pre-warm one container per challenge before judging; demo video as backup
Monaco diff/patch apply edge cases
Fallback to full file replacement instead of diff
Gemma rate limits / outage
Aggressive response caching; pre-written fallback hints
Grader too slow under judging-day load
Concurrent grade limit = 2; queue with visible "position"
Vultr deploy breaks Sunday morning
localhost + ngrok backup path ready
Code review challenges feel thin vs security
Author Format C (fast) first as filler, Format B (hero) last

Cut Lines (in order if behind)
SSRF security challenge (always optional)
Format B codebase audit challenges → replace with extra Format A
WebSocket live container output → poll instead
Real-time leaderboard → refresh on page load
Expert reading replay → static OWASP/blog links
Gemma-personalized explanations → static reference writeups
Cognition MCP live demo → pitch the concept, skip the Claude Code clip

Never cut: the reading-first pedagogy, at least 3 security + 4 code review challenges, the grader, the demo video.


Submission Checklist (Sunday morning)
Devpost page: description, tracks selected (Light the Way + all sponsor checkboxes), demo video embedded, GitHub link
GitHub repo: README with screenshots, setup, .env.example, license
Demo video on YouTube (unlisted), embedded in Devpost
Live deployed URL working in incognito
docs/AGENT_INTEGRATION.md for the Cognition pitch
Domain resolves to deployed app
Pitch rehearsed (60s + 3min versions)
Team at judging table 15 min early


Pitch (60-second version)
"Engineers spend most of their time reading code, not writing it — and almost nowhere teaches you how to do it well. Lector is interactive reading practice with two tracks: security challenges where you read to find exploits and patch them, and code review challenges where you read to catch bugs and fix them. Every submission is graded by actually running the consequence — does the exploit still work? do the tests still pass? — so the feedback is objective, not vibes. The same grader ships as an MCP tool, so AI coding agents can verify their own understanding the same way humans do. We built it because reading code is the most-used, least-taught skill in our field."

Three beats: the gap (reading is undertaught), the product (deliberate practice, two flavors), the spine (objective grading via execution, exposed to both humans and AI agents).

