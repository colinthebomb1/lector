import { useEffect, useState } from 'react';
import { Nav } from './Nav';
import { BlinkingCursor } from './BlinkingCursor';
import { CodeSnippet } from './CodeSnippet';
import type { CurrentUser } from '../lib/api';

interface LandingProps {
  user: CurrentUser | null;
  onPrimaryClick: () => void;
}

const BUG_TAGS = [
  'SQL injection',
  'path traversal',
  'IDOR',
  'command injection',
  'race condition',
  'off-by-one',
  'mutable default arg',
  'TOCTOU',
  'mass assignment',
  'N+1 query',
  'swallowed exception',
  'broken auth',
  'SSRF',
  'cache invalidation',
  'regex catastrophe',
  'timezone bug',
];

const GRADER_LINES = [
  { text: '$ lector verify --challenge sqli-login --patch fix.diff', tone: 'prompt' },
  { text: 'spawning fresh container ............... ok  (3.2s)', tone: 'log' },
  { text: 'applying patch ......................... ok', tone: 'log' },
  { text: 'restarting app ......................... ok  (1.8s)', tone: 'log' },
  { text: 'running functional/tests ............... 12 / 12 passed', tone: 'log' },
  { text: 'replaying original exploit ............. blocked', tone: 'log' },
  { text: '', tone: 'log' },
  { text: '✓ exploit neutralized — patch verified.', tone: 'success' },
  { text: '  graded in 21.4s · session sealed.', tone: 'muted' },
];

function useTypedLines(lines: typeof GRADER_LINES, charDelay = 14, lineDelay = 220) {
  const [shown, setShown] = useState<{ text: string; tone: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const out: { text: string; tone: string }[] = [];
      for (const line of lines) {
        if (cancelled) return;
        out.push({ text: '', tone: line.tone });
        for (let i = 1; i <= line.text.length; i++) {
          if (cancelled) return;
          out[out.length - 1] = { text: line.text.slice(0, i), tone: line.tone };
          setShown([...out]);
          await new Promise((r) => setTimeout(r, charDelay));
        }
        await new Promise((r) => setTimeout(r, lineDelay));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [lines, charDelay, lineDelay]);
  return shown;
}

function GraderTerminal() {
  const lines = useTypedLines(GRADER_LINES);
  return (
    <div className="relative group">
      <div className="absolute -inset-px bg-gradient-to-br from-accent/40 via-accent/0 to-cyan-400/30 rounded-lg blur-md opacity-60 group-hover:opacity-90 transition-opacity"></div>
      <div className="relative bg-[#0B0D13] border border-accent/20 rounded-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#14171F] border-b border-border/60">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/70"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/70"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/70"></span>
          </div>
          <div className="text-[11px] text-muted-foreground tracking-widest uppercase">grader · session #4f2a</div>
          <div className="text-[11px] text-accent">live</div>
        </div>
        <div className="relative p-5 font-mono text-[12.5px] leading-relaxed min-h-[280px] overflow-hidden">
          <div className="absolute inset-0 pointer-events-none opacity-40 bg-grid-pattern-fine"></div>
          <div className="absolute inset-x-0 h-24 bg-gradient-to-b from-accent/10 via-accent/0 to-transparent animate-scan pointer-events-none"></div>
          <div className="relative">
            {lines.map((line, i) => {
              const cls =
                line.tone === 'prompt'
                  ? 'text-foreground'
                  : line.tone === 'success'
                    ? 'text-accent glow-text-accent'
                    : line.tone === 'muted'
                      ? 'text-muted-foreground'
                      : 'text-foreground/70';
              return (
                <div key={i} className={cls}>
                  {line.text || '\u200b'}
                  {i === lines.length - 1 && <span className="inline-block w-1.5 h-3 bg-accent ml-0.5 align-middle animate-blink" />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function TrackCard({
  badge,
  title,
  punchline,
  steps,
  accentClass,
  borderClass,
  iconClass,
  glowClass,
}: {
  badge: string;
  title: string;
  punchline: string;
  steps: string[];
  accentClass: string;
  borderClass: string;
  iconClass: string;
  glowClass: string;
}) {
  return (
    <div className={`relative group rounded-lg border ${borderClass} bg-card/40 backdrop-blur-sm p-7 md:p-8 overflow-hidden transition-all hover:-translate-y-1`}> 
      <div className={`absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-30 group-hover:opacity-50 transition-opacity ${glowClass}`}></div>
      <div className="relative flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-2 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] border ${borderClass} ${accentClass} rounded-sm`}>
            <span className={`w-1.5 h-1.5 rounded-full ${iconClass} animate-pulse`}></span>
            {badge}
          </span>
          <span className="text-xs text-muted-foreground font-mono">track 0{badge === 'Security' ? '1' : '2'}</span>
        </div>
        <h3 className={`text-2xl md:text-3xl ${accentClass}`}>{title}</h3>
        <p className="text-sm md:text-base text-foreground/70 tracking-wide">{punchline}</p>
        <ol className="flex flex-col gap-2.5 mt-1">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3 text-sm text-foreground/80">
              <span className={`shrink-0 mt-0.5 inline-flex items-center justify-center w-6 h-6 text-[11px] border ${borderClass} ${accentClass} rounded-sm font-mono`}>{i + 1}</span>
              <span className="leading-relaxed">{s}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function PipelineStep({ index, title, body, code }: { index: string; title: string; body: string; code?: string }) {
  return (
    <div className="relative">
      <div className="flex items-start gap-4">
        <div className="shrink-0 flex flex-col items-center">
          <div className="w-10 h-10 rounded-md border border-accent/40 bg-accent/5 flex items-center justify-center text-accent font-mono text-sm animate-glow-pulse">
            {index}
          </div>
          <div className="w-px flex-1 bg-gradient-to-b from-accent/40 to-transparent mt-2 min-h-[40px]"></div>
        </div>
        <div className="flex-1 pb-10">
          <h4 className="text-lg md:text-xl mb-2">{title}</h4>
          <p className="text-sm md:text-base text-muted-foreground leading-relaxed mb-3">{body}</p>
          {code && (
            <div className="mt-3 max-w-xl">
              <CodeSnippet code={code} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function Landing({ user, onPrimaryClick }: LandingProps) {
  return (
    <div className="min-h-screen bg-background text-foreground relative overflow-hidden">
      <div className="pointer-events-none fixed inset-0 noise-overlay"></div>

      <Nav onAuthClick={onPrimaryClick} authenticated={!!user} />

      {/* HERO */}
      <section id="top" className="relative min-h-screen flex flex-col justify-center px-4 md:px-8 pt-24 md:pt-28 pb-20 overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.07]"></div>
        <div className="absolute inset-0 bg-radial-spotlight"></div>
        <div className="absolute top-1/3 -left-20 w-[420px] h-[420px] rounded-full bg-accent/10 blur-[120px] animate-float-slow"></div>
        <div className="absolute bottom-10 right-0 w-[360px] h-[360px] rounded-full bg-cyan-500/10 blur-[100px] animate-float"></div>

        <div className="relative z-10 max-w-7xl mx-auto w-full grid lg:grid-cols-[1.05fr_0.95fr] gap-12 lg:gap-16 items-center">
          <div className="flex flex-col gap-7">
            <div className="inline-flex items-center gap-2 self-start px-3 py-1.5 border border-accent/30 bg-accent/5 rounded-full text-[11px] uppercase tracking-[0.2em] text-accent animate-fadeInUp">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse"></span>
              Reading practice for engineers
            </div>

            <h1
              className="font-medium animate-fadeInUp animate-delay-100"
              style={{ fontSize: 'clamp(56px, 9vw, 132px)', lineHeight: 0.95, letterSpacing: '-0.02em' }}
            >
              <span className="text-gradient-accent">Lector</span>
              <BlinkingCursor />
            </h1>

            <p className="text-lg md:text-2xl text-foreground/80 max-w-2xl leading-snug animate-fadeInUp animate-delay-200">
              Reading code is the most-used skill in software engineering — and almost{' '}
              <span className="text-foreground/50 line-through">nowhere</span>{' '}
              <span className="text-accent glow-text-accent">here</span> teaches it deliberately.
            </p>

            <p className="text-sm md:text-base text-muted-foreground max-w-xl leading-relaxed animate-fadeInUp animate-delay-300">
              Two tracks. One spine. Read a codebase, find what's wrong, propose a fix — and we verify
              by <span className="text-foreground">actually running the consequence</span>. Does the
              exploit still work? Do the tests still pass?
            </p>

            <div className="flex gap-3 md:gap-4 flex-wrap animate-fadeInUp animate-delay-400">
              <button
                onClick={onPrimaryClick}
                className="group relative px-7 py-3.5 bg-accent text-accent-foreground font-medium overflow-hidden transition-all hover:scale-[1.02] animate-glow-pulse"
              >
                <span className="relative z-10">{user ? 'Open dashboard →' : 'Start reading →'}</span>
                <span className="absolute inset-0 bg-gradient-to-r from-cyan-300 to-accent opacity-0 group-hover:opacity-100 transition-opacity"></span>
              </button>
              <a
                href="#how-it-works"
                className="px-7 py-3.5 border border-foreground/20 text-foreground hover:bg-foreground/5 hover:border-foreground/40 transition-all"
              >
                See how grading works
              </a>
            </div>

            <div className="flex flex-wrap items-center gap-x-8 gap-y-3 mt-2 text-xs text-muted-foreground animate-fadeInUp animate-delay-500">
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                Sandboxed Docker grading
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                AI-graded reading checks
              </div>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
                MCP tool for AI agents
              </div>
            </div>
          </div>

          <div className="relative animate-fadeInUp animate-delay-300">
            <div className="absolute -top-6 -left-6 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
              ▢ live grader output
            </div>
            <GraderTerminal />
            <div className="mt-4 grid grid-cols-3 gap-3 text-center">
              {[
                { k: '<25s', v: 'avg grade' },
                { k: '2', v: 'tracks' },
                { k: '10+', v: 'challenges' },
              ].map((s) => (
                <div key={s.v} className="px-3 py-3 bg-card/40 border border-border rounded">
                  <div className="text-accent text-lg font-mono">{s.k}</div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* scroll cue */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground/60 flex flex-col items-center gap-2">
          <span>scroll</span>
          <span className="w-px h-8 bg-gradient-to-b from-muted-foreground/60 to-transparent"></span>
        </div>
      </section>

      {/* BUG MARQUEE */}
      <section className="relative py-10 border-y border-border bg-card/30 overflow-hidden">
        <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none"></div>
        <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none"></div>
        <div className="flex animate-marquee whitespace-nowrap will-change-transform">
          {[...BUG_TAGS, ...BUG_TAGS].map((tag, i) => (
            <span
              key={i}
              className="mx-4 inline-flex items-center gap-3 text-sm md:text-base text-foreground/60 font-mono"
            >
              <span className="text-accent">▸</span>
              {tag}
              <span className="text-accent/30 ml-4">/</span>
            </span>
          ))}
        </div>
      </section>

      {/* TWO TRACKS */}
      <section id="tracks" className="relative py-24 md:py-32 px-4 md:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col items-center text-center mb-14 md:mb-20">
            <span className="text-xs uppercase tracking-[0.3em] text-accent mb-4">// two tracks</span>
            <h2 className="text-3xl md:text-5xl mb-5 max-w-3xl leading-tight">
              Same grader. Two ways to <span className="text-accent">read with intent</span>.
            </h2>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl">
              Both tracks lead with reading comprehension. Only after you understand the file do you get
              to attack, defend, or refactor it.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 md:gap-8">
            <TrackCard
              badge="Security"
              title="Attack → Defend"
              punchline="Exploit a live, vulnerable app in a sandbox. Then patch the source so the same exploit no longer works."
              steps={[
                'Read the vulnerable app and write a 1-sentence summary',
                'Capture the flag using the live exploit surface',
                'Patch the vulnerability in Monaco',
                'Grader rebuilds + replays your attack — must fail',
              ]}
              accentClass="text-accent"
              borderClass="border-accent/30"
              iconClass="bg-accent"
              glowClass="bg-accent/30"
            />
            <TrackCard
              badge="Code Review"
              title="Audit → Fix"
              punchline="Read a file or codebase containing planted bugs. Annotate the bad lines, name the bug class, and ship a fix."
              steps={[
                'Read the file and summarize what it does',
                'Annotate suspicious lines with bug categories',
                'Propose a fix — diff or full file',
                'Grader runs the failing tests — must now pass',
              ]}
              accentClass="text-cyan-300"
              borderClass="border-cyan-400/30"
              iconClass="bg-cyan-400"
              glowClass="bg-cyan-500/30"
            />
          </div>
        </div>
      </section>

      {/* PIPELINE */}
      <section id="how-it-works" className="relative py-24 md:py-32 px-4 md:px-8 bg-card/40 border-y border-border">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.04]"></div>
        <div className="relative max-w-6xl mx-auto">
          <div className="flex flex-col items-center text-center mb-16">
            <span className="text-xs uppercase tracking-[0.3em] text-accent mb-4">// pipeline</span>
            <h2 className="text-3xl md:text-5xl mb-5 max-w-3xl">From <span className="text-accent">read</span> to <span className="text-accent">verified</span> in under 25 seconds.</h2>
            <p className="text-base md:text-lg text-muted-foreground max-w-2xl">
              Every submission walks the same path. The grader doesn't care <em>why</em> you think
              something is wrong — it cares about consequence.
            </p>
          </div>

          <div className="grid lg:grid-cols-[1fr_1.1fr] gap-12 items-start">
            <div>
              <PipelineStep
                index="01"
                title="Read"
                body="Open the file in the editor. Write a 1–2 sentence summary of what it does. The reading check compares it to the reference rubric — you can't move on until you actually understand the code."
              />
              <PipelineStep
                index="02"
                title="Identify"
                body="Click line numbers to drop annotations. Pick a bug class (off-by-one, race condition, SQLi, IDOR…). Explain why in your own words."
              />
              <PipelineStep
                index="03"
                title="Fix"
                body="Edit the source directly. Either ship a unified diff or replace the whole file."
                code={`- cursor.execute(f"SELECT * FROM users WHERE name='{u}' AND pw='{p}'")\n+ cursor.execute(\n+     "SELECT * FROM users WHERE name=? AND pw=?",\n+     (u, p),\n+ )`}
              />
              <PipelineStep
                index="04"
                title="Verify"
                body="A fresh container spins up, your patch is applied, the original exploit is replayed and the test suite re-runs. Pass = solved. Fail = useful, specific feedback."
              />
            </div>

            <div className="lg:sticky lg:top-28">
              <GraderTerminal />
              <div className="mt-6 grid grid-cols-2 gap-3">
                <div className="border border-border bg-background/60 rounded p-4">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">grader</div>
                  <div className="mt-2 text-sm text-foreground/80">Replays the original consequence in a sandboxed Docker container. Same spine for both tracks.</div>
                </div>
                <div className="border border-border bg-background/60 rounded p-4">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">coach</div>
                  <div className="mt-2 text-sm text-foreground/80">Reading checks, adaptive hints, rubric-graded explanations, and post-solve writeups.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* READING-FIRST PEDAGOGY */}
      <section className="relative py-24 md:py-32 px-4 md:px-8 overflow-hidden">
        <div className="absolute -top-32 right-0 w-[500px] h-[500px] rounded-full bg-accent/10 blur-[140px]"></div>

        <div className="relative max-w-6xl mx-auto grid lg:grid-cols-[0.9fr_1.1fr] gap-12 lg:gap-16 items-center">
          <div className="flex flex-col gap-5">
            <span className="text-xs uppercase tracking-[0.3em] text-accent">// pedagogy</span>
            <h2 className="text-3xl md:text-5xl leading-tight">
              We make you <span className="text-accent">read first</span>. Then you write.
            </h2>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              Most platforms hand you a problem and a blank function body. Lector is the inverse —
              you start by understanding code that already exists, the way every real engineering job
              actually goes.
            </p>
            <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
              After every solve we replay an <span className="text-accent">expert reading path</span>:
              imports first, identify the public surface, trace user input, check boundaries. The
              meta-skill of <em>how to look</em> is what we're really teaching.
            </p>
            <div className="mt-2 grid grid-cols-2 gap-3 max-w-md">
              <div className="border border-border bg-card/50 rounded p-4">
                <div className="text-2xl text-accent font-mono">1.</div>
                <div className="mt-1 text-sm text-foreground/80">Reading summary</div>
              </div>
              <div className="border border-border bg-card/50 rounded p-4">
                <div className="text-2xl text-accent font-mono">2.</div>
                <div className="mt-1 text-sm text-foreground/80">Annotate &amp; fix</div>
              </div>
              <div className="border border-border bg-card/50 rounded p-4">
                <div className="text-2xl text-accent font-mono">3.</div>
                <div className="mt-1 text-sm text-foreground/80">Execution-graded</div>
              </div>
              <div className="border border-border bg-card/50 rounded p-4">
                <div className="text-2xl text-accent font-mono">4.</div>
                <div className="mt-1 text-sm text-foreground/80">Expert replay</div>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-br from-accent/10 via-transparent to-cyan-500/10 rounded-xl blur-2xl"></div>
            <div className="relative bg-card border border-border rounded-lg overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-background/40">
                <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono">
                  <span className="w-2 h-2 rounded-full bg-accent"></span>
                  reading_check.py
                </div>
                <span className="text-[10px] uppercase tracking-[0.2em] text-accent">step 1 / 4</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr]">
                <div className="border-r border-border p-5">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mb-3">the file</div>
                  <CodeSnippet
                    code={`def transfer(src, dst, amount):\n    if amount <= 0:\n        return False\n    if src.balance >= amount:\n        src.balance -= amount\n        dst.balance += amount\n        return True\n    return False`}
                  />
                </div>
                <div className="p-5 flex flex-col gap-4">
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground">your summary</div>
                  <div className="bg-background border border-border rounded p-3 text-sm text-foreground/90 leading-relaxed">
                    Moves <span className="text-accent">amount</span> from one account to another if
                    funds are sufficient.
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-muted-foreground mt-2">reading check</div>
                  <div className="border border-yellow-400/30 bg-yellow-400/5 rounded p-3 text-sm text-yellow-200/90 leading-relaxed">
                    Almost — you didn't mention what happens with{' '}
                    <span className="text-yellow-300">concurrent</span> transfers. Re-read lines 4–6
                    before annotating.
                  </div>
                  <div className="flex gap-2 mt-auto">
                    <button className="flex-1 px-3 py-2 text-xs border border-foreground/20 text-foreground/80 hover:bg-foreground/5 rounded">
                      Re-read
                    </button>
                    <button className="flex-1 px-3 py-2 text-xs bg-accent/10 border border-accent/30 text-accent hover:bg-accent/20 rounded">
                      Try again
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MCP / AGENTS */}
      <section id="agents" className="relative py-24 md:py-32 px-4 md:px-8 bg-card/40 border-y border-border overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.04]"></div>
        <div className="relative max-w-6xl mx-auto">
          <div className="grid lg:grid-cols-[1fr_1fr] gap-12 lg:gap-16 items-center">
            <div>
              <span className="text-xs uppercase tracking-[0.3em] text-accent mb-4 block">// agents welcome</span>
              <h2 className="text-3xl md:text-5xl mb-5 leading-tight">
                The same grader, exposed as an <span className="text-accent">MCP tool</span>.
              </h2>
              <p className="text-base md:text-lg text-muted-foreground leading-relaxed mb-4">
                AI coding agents have the same problem humans do — they write a fix and have no
                objective way to know if it actually works. Lector ships the grader as an MCP tool
                so any agent can verify its own change before committing.
              </p>
              <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
                Did the security patch block the exploit? Did the bug fix make the failing test
                pass without breaking others? <span className="text-accent">Ask the grader</span>.
              </p>
              <div className="mt-6 inline-flex items-center gap-3 text-sm text-muted-foreground">
                <span className="px-2 py-0.5 border border-accent/30 text-accent text-[10px] uppercase tracking-widest">mcp</span>
                <span>Execution-grounded validation, on tap.</span>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -inset-2 bg-gradient-to-br from-accent/20 via-transparent to-cyan-500/20 rounded-xl blur-2xl"></div>
              <div className="relative bg-[#0B0D13] border border-accent/20 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-[#14171F] text-xs text-muted-foreground font-mono">
                  <span className="w-2 h-2 rounded-full bg-accent animate-pulse"></span>
                  agent · mcp · lector.verify
                </div>
                <div className="p-5 font-mono text-[12.5px] leading-relaxed">
                  <div className="text-foreground/60">// agent is editing auth/login.py</div>
                  <div className="mt-2 text-foreground">→ <span className="text-accent">lector.verify</span>(challenge=<span className="text-yellow-200">"sqli-login"</span>, patch=diff)</div>
                  <div className="mt-2 text-red-400/80">  ✗ vulnerability still present</div>
                  <div className="text-muted-foreground">    exploit response: 200 OK · admin flag returned</div>
                  <div className="mt-3 text-foreground/60">// agent rewrites the patch</div>
                  <div className="mt-2 text-foreground">→ <span className="text-accent">lector.verify</span>(challenge=<span className="text-yellow-200">"sqli-login"</span>, patch=diff_v2)</div>
                  <div className="mt-2 text-accent glow-text-accent">  ✓ exploit neutralized · 12 / 12 tests pass</div>
                  <div className="mt-3 text-muted-foreground">    graded in 18.7s · ready to commit.</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="relative py-24 md:py-32 px-4 md:px-8 overflow-hidden">
        <div className="absolute inset-0 bg-grid-pattern opacity-[0.05]"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full bg-accent/10 blur-[140px]"></div>
        <div className="relative max-w-4xl mx-auto text-center">
          <h2 className="text-4xl md:text-6xl mb-6 leading-tight">
            Stop skimming. <span className="text-gradient-accent">Start reading.</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-10">
            Spin up a session, pick a track, and prove you understood the code by changing what
            actually happens when it runs.
          </p>
          <div className="flex gap-3 md:gap-4 justify-center flex-wrap">
            <button
              onClick={onPrimaryClick}
              className="group relative px-8 py-4 bg-accent text-accent-foreground font-medium overflow-hidden hover:scale-[1.02] transition-all animate-glow-pulse"
            >
              <span className="relative z-10">{user ? 'Open dashboard →' : 'Create a session →'}</span>
            </button>
            <a
              href="#how-it-works"
              className="px-8 py-4 border border-foreground/20 text-foreground hover:bg-foreground/5 hover:border-foreground/40 transition-all"
            >
              Read the pipeline
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="relative py-12 px-4 md:px-8 border-t border-border bg-background">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row gap-6 md:gap-0 justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 text-lg">
              <span className="text-accent">L</span>
              <span className="text-accent">_</span>
            </div>
            <span className="text-xs text-muted-foreground">© 2026 Lector</span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <a href="#tracks" className="hover:text-foreground transition-colors">Tracks</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">Pipeline</a>
            <a href="#agents" className="hover:text-foreground transition-colors">For agents</a>
            <a href="#top" className="hover:text-foreground transition-colors">Back to top ↑</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
