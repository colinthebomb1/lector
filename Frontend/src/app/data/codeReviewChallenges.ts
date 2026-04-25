import type { ChallengeSummary } from '../lib/api';

/**
 * Static data for the code-review track.
 *
 * Code-review challenges are not (yet) backed by the FastAPI/grader pipeline,
 * so the editor, hints, and verdict are evaluated entirely on the client.
 *
 * Each challenge can be solved in multiple languages. The user picks a
 * language inside the challenge view; that selection swaps the source code,
 * the prompt, the hints, the AI hint rubric, and the solution check — but
 * keeps the same dashboard summary so progress and routing don't fragment.
 */
export interface CodeReviewVariant {
  /** Monaco language id (e.g. "javascript", "python", "java", "c"). */
  language: string;
  /** User-facing label shown in the language picker. */
  display_language: string;
  /** Short blurb shown above the source on the play screen. */
  prompt: string;
  /** Read-only source the learner is reviewing. */
  original_code: string;
  /** Starter content for the editable editor (usually identical to `original_code`). */
  default_code: string;
  /** Ordered tiers of hints, revealed one at a time. */
  hints: string[];
  /** Pure rubric items handed to the AI hint backend so it can grade progress. */
  aiHintRubric: string[];
  /** Pure function that decides whether the user's edit fixes the issue. */
  solutionCheck: (code: string) => SolutionVerdict;
}

export interface CodeReviewChallenge {
  summary: ChallengeSummary;
  /** Language id of the variant shown by default when the challenge opens. */
  default_language: string;
  variants: CodeReviewVariant[];
}

export interface SolutionVerdict {
  passed: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Division Factory — closure that captures a divisor.
// ---------------------------------------------------------------------------

const DIVISION_FACTORY_JS_SOURCE = `function createDivider(divisor) {
  return function divide(value) {
    return value / divisor;
  };
}

const half = createDivider(2);
const broken = createDivider(0);

console.log(half("ten"));   // expected: a number, got: NaN
console.log(broken(5));     // expected: graceful failure, got: Infinity
`;

const DIVISION_FACTORY_PY_SOURCE = `def create_divider(divisor):
    def divide(value):
        return value / divisor
    return divide


half = create_divider(2)
broken = create_divider(0)

# Both factories are constructed silently. The errors only surface
# when divide() is called, far from the original mistake.
print(half("ten"))  # TypeError: unsupported operand type(s) for /: 'str' and 'int'
print(broken(5))    # ZeroDivisionError: division by zero
`;

const DIVISION_FACTORY_JAVA_SOURCE = `import java.util.function.DoubleUnaryOperator;

public class DividerFactory {
    public static DoubleUnaryOperator createDivider(double divisor) {
        return value -> value / divisor;
    }

    public static void main(String[] args) {
        DoubleUnaryOperator half = createDivider(2.0);
        DoubleUnaryOperator broken = createDivider(0.0);

        // Java does not throw on either of these; both calls silently
        // produce NaN / Infinity rather than failing.
        System.out.println(half.applyAsDouble(Double.NaN));   // NaN
        System.out.println(broken.applyAsDouble(5.0));        // Infinity
    }
}
`;

// ---------------------------------------------------------------------------
// What Are You Pointing At? — lifetime / aliasing of returned data.
// ---------------------------------------------------------------------------

const POINTER_C_SOURCE = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char *make_greeting(const char *name) {
    char buffer[32];
    sprintf(buffer, "Hello, %s!", name);
    return buffer;
}

int main(void) {
    const char *greeting = make_greeting("world");
    printf("%s\\n", greeting);
    return 0;
}
`;

const POINTER_JAVA_SOURCE = `public class GreetingFactory {
    private final StringBuilder shared = new StringBuilder();

    public StringBuilder makeGreeting(String name) {
        shared.setLength(0);
        shared.append("Hello, ").append(name).append("!");
        return shared;
    }

    public static void main(String[] args) {
        GreetingFactory factory = new GreetingFactory();
        StringBuilder first = factory.makeGreeting("world");
        StringBuilder second = factory.makeGreeting("everyone");

        // Expected: two distinct greetings.
        // Actual: both reference the same buffer; first now reads "Hello, everyone!".
        System.out.println(first);
        System.out.println(second);
    }
}
`;

const POINTER_PY_SOURCE = `_buffer = bytearray(32)


def make_greeting(name, buffer=_buffer):
    buffer[:] = b"\\x00" * len(buffer)
    greeting = f"Hello, {name}!".encode()
    n = min(len(greeting), len(buffer))
    buffer[:n] = greeting[:n]
    return buffer


first = make_greeting("world")
second = make_greeting("everyone")

# Both names land in the same module-level _buffer, so 'first' now
# also reads "Hello, everyone!" after the second call mutates it.
print(bytes(first).rstrip(b"\\x00").decode())
print(bytes(second).rstrip(b"\\x00").decode())
`;

const CHALLENGES: CodeReviewChallenge[] = [
  {
    summary: {
      id: 'code-review-division-factory',
      name: 'Division Factory',
      track: 'code-review',
      category: 'code review',
      difficulty: 'medium',
      description:
        'A small factory that produces division closures. It silently misbehaves on bad input.',
      estimated_minutes: 18,
    },
    default_language: 'javascript',
    variants: [
      {
        language: 'javascript',
        display_language: 'JavaScript',
        prompt:
          'createDivider returns a closure that captures a divisor and applies it later. Review the implementation and look for potential improvements.',
        original_code: DIVISION_FACTORY_JS_SOURCE,
        default_code: DIVISION_FACTORY_JS_SOURCE,
        hints: [
          'Trace the two sample calls and focus on why JavaScript allows both of them to run without throwing.',
          'There are two different validation points here: one when the divider is created, and one when it is used later.',
          'Ask what assumptions must be true for division to produce a meaningful result. Guard those assumptions explicitly, and surface invalid input with a real error or other clear failure path.',
        ],
        aiHintRubric: [
          'Creation-time validation: reject divisors that should never produce a meaningful result, including zero and other non-finite values.',
          'Use-time validation: reject values passed into the returned divider when they are not valid numeric inputs.',
          'Failure mode: make invalid input fail explicitly instead of silently returning NaN or Infinity.',
        ],
        solutionCheck: (code) => {
          const guardsZero =
            /\bdivisor\s*===\s*0\b/.test(code) ||
            /\bdivisor\s*==\s*0\b/.test(code) ||
            /!\s*divisor\b/.test(code) ||
            /Number\.isFinite\s*\(\s*divisor\s*\)/.test(code) ||
            /isFinite\s*\(\s*divisor\s*\)/.test(code);
          const guardsValue =
            /\bisNaN\s*\(/.test(code) ||
            /Number\.isFinite\s*\(\s*value\s*\)/.test(code) ||
            /typeof\s+value\s*!==\s*['"]number['"]/.test(code) ||
            /typeof\s+value\s*===\s*['"]number['"]/.test(code);
          const surfacesError = /\bthrow\b/.test(code) || /\breturn\s+null\b/.test(code);

          if (guardsZero && guardsValue && surfacesError) {
            return {
              passed: true,
              message:
                'Looks good — divisor is rejected on zero/non-finite, value is type-checked, and bad inputs surface a real error instead of NaN/Infinity.',
            };
          }
          if (!guardsZero) {
            return {
              passed: false,
              message:
                'Still vulnerable: a zero divisor will produce Infinity/NaN. Reject divisor === 0 (or !Number.isFinite(divisor)) before returning the closure.',
            };
          }
          if (!guardsValue) {
            return {
              passed: false,
              message:
                'Still vulnerable: a non-numeric value (e.g. "ten") silently becomes NaN. Validate value inside the inner divide function.',
            };
          }
          return {
            passed: false,
            message:
              'Almost there — make the failure mode explicit (throw an Error, or return null) instead of silently producing NaN/Infinity.',
          };
        },
      },
      {
        language: 'python',
        display_language: 'Python',
        prompt:
          'create_divider returns a nested function that divides by a captured divisor. Both example calls succeed at construction time and only blow up when used. Review the implementation and tighten the boundaries.',
        original_code: DIVISION_FACTORY_PY_SOURCE,
        default_code: DIVISION_FACTORY_PY_SOURCE,
        hints: [
          'Trace what happens when create_divider(0) runs — it succeeds. The bad divisor is captured silently and only blows up much later, far from the call site.',
          'There are two validation points to consider: when the divider is built, and when it is called. Both should reject inputs that cannot produce a meaningful answer.',
          'Make the failure explicit and close to the call site — raise a clear ValueError/TypeError instead of letting ZeroDivisionError or a low-level TypeError leak out of the closure.',
        ],
        aiHintRubric: [
          'Creation-time validation: reject divisors that cannot produce a meaningful result (zero, None, non-numeric).',
          'Use-time validation: reject `value` arguments that are not numeric.',
          'Failure mode: raise an explicit, intentional exception (ValueError / TypeError) instead of letting the implementation detail (ZeroDivisionError, TypeError from /) leak.',
        ],
        solutionCheck: (code) => {
          const guardsZero =
            /\bdivisor\s*==\s*0\b/.test(code) ||
            /\bif\s+not\s+divisor\b/.test(code) ||
            /isinstance\s*\(\s*divisor\s*,/.test(code) ||
            /\bdivisor\s+is\s+None\b/.test(code) ||
            /math\.isfinite\s*\(\s*divisor\s*\)/.test(code) ||
            /not\s+math\.isfinite\s*\(\s*divisor\s*\)/.test(code);
          const guardsValue =
            /isinstance\s*\(\s*value\s*,/.test(code) ||
            /\btype\s*\(\s*value\s*\)/.test(code) ||
            /\bvalue\s+is\s+None\b/.test(code) ||
            /math\.isfinite\s*\(\s*value\s*\)/.test(code);
          const surfacesError = /\braise\b/.test(code);

          if (guardsZero && guardsValue && surfacesError) {
            return {
              passed: true,
              message:
                'Nice — divisor is validated up front, value is type-checked, and bad inputs raise a real exception at the call site.',
            };
          }
          if (!guardsZero) {
            return {
              passed: false,
              message:
                'Still buggy: create_divider(0) is accepted silently. Validate divisor when the divider is built (e.g. `if divisor == 0` or `isinstance(divisor, (int, float))`) before returning the closure.',
            };
          }
          if (!guardsValue) {
            return {
              passed: false,
              message:
                'Still buggy: passing a non-numeric value still leaks a raw TypeError from `/`. Add an isinstance / None check on value inside divide().',
            };
          }
          return {
            passed: false,
            message:
              'Almost there — surface the failure with `raise ValueError(...)` (or TypeError) instead of relying on division to blow up.',
          };
        },
      },
      {
        language: 'java',
        display_language: 'Java',
        prompt:
          'createDivider returns a DoubleUnaryOperator that divides by the captured divisor. Both example calls silently produce NaN / Infinity instead of failing. Tighten the boundaries.',
        original_code: DIVISION_FACTORY_JAVA_SOURCE,
        default_code: DIVISION_FACTORY_JAVA_SOURCE,
        hints: [
          'Java does not throw on `5.0 / 0.0` or `NaN / 2.0` — it returns Infinity/NaN. The bug is silent.',
          'There are two validation points: when the divider is built, and when it is invoked. Reject inputs that cannot produce a meaningful answer at each one.',
          'Make the failure explicit. `Double.isFinite` and `IllegalArgumentException` (or ArithmeticException) are your friends.',
        ],
        aiHintRubric: [
          'Creation-time validation: reject divisors that produce no meaningful result (zero, NaN, infinite).',
          'Use-time validation: reject inputs that are not finite numbers.',
          'Failure mode: throw an explicit unchecked exception instead of returning Infinity/NaN.',
        ],
        solutionCheck: (code) => {
          const guardsZero =
            /\bdivisor\s*==\s*0(?:\.0)?\b/.test(code) ||
            /Double\.isFinite\s*\(\s*divisor\s*\)/.test(code) ||
            /!\s*Double\.isFinite\s*\(\s*divisor\s*\)/.test(code) ||
            /Double\.isNaN\s*\(\s*divisor\s*\)/.test(code);
          const guardsValue =
            /Double\.isFinite\s*\(\s*value\s*\)/.test(code) ||
            /Double\.isNaN\s*\(\s*value\s*\)/.test(code) ||
            /!\s*Double\.isFinite\s*\(\s*value\s*\)/.test(code);
          const surfacesError = /\bthrow\s+new\s+\w+/.test(code);

          if (guardsZero && guardsValue && surfacesError) {
            return {
              passed: true,
              message:
                'Solid — divisor and value are both validated for finiteness, and bad inputs throw an explicit exception instead of leaking Infinity/NaN.',
            };
          }
          if (!guardsZero) {
            return {
              passed: false,
              message:
                'Still buggy: createDivider(0.0) is accepted silently. Reject divisor at construction (e.g. `divisor == 0.0` or `!Double.isFinite(divisor)`).',
            };
          }
          if (!guardsValue) {
            return {
              passed: false,
              message:
                'Still buggy: NaN passes through `value / divisor` and silently propagates. Validate value inside the lambda (Double.isFinite / Double.isNaN).',
            };
          }
          return {
            passed: false,
            message:
              'Almost there — throw an explicit exception (e.g. IllegalArgumentException) so callers actually see the failure instead of NaN/Infinity.',
          };
        },
      },
    ],
  },
  {
    summary: {
      id: 'code-review-what-are-you-pointing-at',
      name: 'What Are You Pointing At?',
      track: 'code-review',
      category: 'code review',
      difficulty: 'hard',
      description:
        'A helper builds a greeting and returns it. It runs cleanly but is broken in two distinct ways.',
      estimated_minutes: 22,
    },
    default_language: 'c',
    variants: [
      {
        language: 'c',
        display_language: 'C',
        prompt:
          'make_greeting returns a pointer that the caller dereferences. Identify the lifetime issue and the unbounded-format issue, and rewrite the function so the returned pointer is safe to use.',
        original_code: POINTER_C_SOURCE,
        default_code: POINTER_C_SOURCE,
        hints: [
          'The caller still uses `greeting` after make_greeting returns. Where does `buffer` actually live?',
          'sprintf has no length awareness. A long `name` will scribble past the end of `buffer` long before any pointer issue matters.',
          'A correct fix typically uses snprintf into a heap-allocated buffer (malloc/strdup) — or a caller-provided buffer — so the lifetime extends past the function and the size is bounded.',
        ],
        aiHintRubric: [
          'Returned data must remain valid after the function returns, so the implementation cannot hand back a pointer to expired stack storage.',
          'Writes into the greeting buffer must be length-bounded so long names do not overflow it.',
          'The final design should make ownership or buffer responsibility clear to the caller.',
        ],
        solutionCheck: (code) => {
          const usesSnprintf = /\bsnprintf\s*\(/.test(code);
          const stillSprintf = /\bsprintf\s*\(/.test(code);
          // Either heap-allocate, use static storage, or rewrite the signature so
          // the caller owns the buffer (a second char* param into make_greeting).
          const escapesStack =
            /\bmalloc\s*\(/.test(code) ||
            /\bstrdup\s*\(/.test(code) ||
            /\bcalloc\s*\(/.test(code) ||
            /\bstatic\s+char\b/.test(code) ||
            /\bmake_greeting\s*\(\s*[^)]*char\s*\*[^)]*,\s*[^)]+\)/.test(code);

          if (!stillSprintf && usesSnprintf && escapesStack) {
            return {
              passed: true,
              message:
                'Nice — snprintf bounds the write and the returned pointer no longer references a stack buffer that vanishes at function exit.',
            };
          }
          if (stillSprintf) {
            return {
              passed: false,
              message:
                'sprintf is still in the function. A long `name` overflows the 32-byte buffer; switch to snprintf with an explicit size.',
            };
          }
          if (!escapesStack) {
            return {
              passed: false,
              message:
                'You patched the format, but the returned pointer still points at a stack buffer that disappears when the function returns. Allocate on the heap (malloc/strdup) or take a caller-provided buffer.',
            };
          }
          return {
            passed: false,
            message:
              'Replace sprintf with snprintf so the format is bounded by the buffer size.',
          };
        },
      },
      {
        language: 'java',
        display_language: 'Java',
        prompt:
          'makeGreeting returns a StringBuilder that callers print later. Two consecutive calls produce surprising output because they share state. Make every caller see their own greeting.',
        original_code: POINTER_JAVA_SOURCE,
        default_code: POINTER_JAVA_SOURCE,
        hints: [
          'Both `first` and `second` come from the same makeGreeting. What does each one actually point at?',
          '`shared` is a field on the factory. Returning it directly leaks internal mutable state to every caller, who keeps a live reference.',
          'A safer design returns an immutable snapshot per call — a String, or a fresh StringBuilder — so each caller owns their copy and is unaffected by later calls.',
        ],
        aiHintRubric: [
          'Each call must return a value that is independent of internal mutable state, so subsequent calls cannot change earlier results.',
          'Prefer an immutable return type (String) when callers do not need to mutate the result.',
          'If a mutable type is required, return a fresh instance per call rather than handing back an internal field.',
        ],
        solutionCheck: (code) => {
          const stillReturnsField = /return\s+shared\s*;/.test(code);
          const referencesName = /\bname\b/.test(code);
          const returnsString = /public\s+String\s+makeGreeting\s*\(/.test(code);
          const returnsFreshBuilder =
            /return\s+new\s+StringBuilder/.test(code) ||
            /return\s+new\s+StringBuffer/.test(code);
          const buildsResultFresh =
            returnsString ||
            returnsFreshBuilder ||
            /String\.format\s*\(/.test(code);

          if (!stillReturnsField && referencesName && buildsResultFresh) {
            return {
              passed: true,
              message:
                'Solid — each call now produces its own value (String or fresh StringBuilder) instead of aliasing an internal field, so earlier callers are unaffected by later calls.',
            };
          }
          if (stillReturnsField) {
            return {
              passed: false,
              message:
                'Still aliased: the method still returns `shared`, so every caller ends up holding the same mutable buffer. Build the result locally and return that instead.',
            };
          }
          if (!buildsResultFresh) {
            return {
              passed: false,
              message:
                'Build the result fresh per call — return a `String` (e.g. "Hello, " + name + "!") or a `new StringBuilder` so callers each get their own value.',
            };
          }
          return {
            passed: false,
            message:
              'Make sure the greeting actually contains `name` so callers get the expected output.',
          };
        },
      },
      {
        language: 'python',
        display_language: 'Python',
        prompt:
          'make_greeting returns a bytearray, but two calls in a row produce the same bytes because they share state in two different ways. Find both issues and return a fresh greeting per call.',
        original_code: POINTER_PY_SOURCE,
        default_code: POINTER_PY_SOURCE,
        hints: [
          'Both `first` and `second` reference the same `_buffer`. What happens to `first` after the second call mutates the buffer?',
          'Mutable default arguments are evaluated once. `buffer=_buffer` does not copy — every call shares the same bytearray.',
          'A clean fix: drop the mutable default + module-level buffer, just return a fresh `f"Hello, {name}!"` (or fresh bytes) per call.',
        ],
        aiHintRubric: [
          'Each call must produce its own, independent value — no shared module-level mutable state, no mutable default argument.',
          'Long inputs should not silently truncate; either size the result to the input or surface a real error.',
          'A clean implementation typically just returns f"Hello, {name}!" or builds and returns a fresh bytes object each call.',
        ],
        solutionCheck: (code) => {
          const usesSharedBuffer = /\b_buffer\b/.test(code);
          const mutableDefault =
            /def\s+make_greeting\s*\([^)]*=\s*_buffer/.test(code) ||
            /def\s+make_greeting\s*\([^)]*=\s*bytearray\s*\(/.test(code) ||
            /def\s+make_greeting\s*\([^)]*=\s*\[\s*\]/.test(code);
          const referencesName = /\bname\b/.test(code);
          const returnsFresh =
            /return\s+f["'][^"']*\{name\}/.test(code) ||
            /return\s+["'][^"']*["']\s*\.format\s*\(/.test(code) ||
            /return\s+bytes\s*\(/.test(code) ||
            /return\s+bytearray\s*\(/.test(code) ||
            /return\s+["'][^"']*["']\s*\+\s*name/.test(code);

          if (!usesSharedBuffer && !mutableDefault && referencesName && returnsFresh) {
            return {
              passed: true,
              message:
                'Nice — no shared module-level state, no mutable default argument, and each call now returns its own greeting.',
            };
          }
          if (usesSharedBuffer) {
            return {
              passed: false,
              message:
                'Still aliased: the function still mutates `_buffer`, so every caller ends up sharing the same bytes. Drop the module-level buffer and build the result locally.',
            };
          }
          if (mutableDefault) {
            return {
              passed: false,
              message:
                'Still buggy: `buffer=_buffer` (or any mutable default) is evaluated once and shared by every call. Remove the mutable default argument.',
            };
          }
          if (!returnsFresh) {
            return {
              passed: false,
              message:
                'Return a fresh value built around `name` — e.g. `return f"Hello, {name}!"` — instead of mutating shared state.',
            };
          }
          return {
            passed: false,
            message:
              'Make sure the returned value contains `name` so callers see the expected greeting.',
          };
        },
      },
    ],
  },
];

export function listCodeReviewChallenges(): CodeReviewChallenge[] {
  return CHALLENGES;
}

export function getCodeReviewChallenge(id: string): CodeReviewChallenge | undefined {
  return CHALLENGES.find((c) => c.summary.id === id);
}

/**
 * Pick a variant for a challenge, defaulting to its declared default language
 * when no language is supplied or the requested language is not offered.
 */
export function getCodeReviewVariant(
  challengeId: string,
  language?: string,
): CodeReviewVariant | undefined {
  const challenge = getCodeReviewChallenge(challengeId);
  if (!challenge) return undefined;
  if (language) {
    const match = challenge.variants.find((v) => v.language === language);
    if (match) return match;
  }
  return (
    challenge.variants.find((v) => v.language === challenge.default_language) ??
    challenge.variants[0]
  );
}
