import type { ChallengeSummary } from '../lib/api';

/**
 * Static data for the code-review track.
 *
 * Code-review challenges are not (yet) backed by the FastAPI/grader pipeline,
 * so the editor, hints, and verdict are evaluated entirely on the client.
 * Each entry exposes:
 *  - `summary`: shape used by the dashboard list (track is always `code-review`).
 *  - `prompt`: short blurb shown above the source on the play screen.
 *  - `language`: Monaco language id for the editor.
 *  - `original_code`: the read-only source the learner is reviewing.
 *  - `default_code`: starter content for the editable editor (usually identical
 *    to `original_code` so users patch in place).
 *  - `hints`: ordered tiers of hints, revealed one at a time.
 *  - `solutionCheck`: pure function that inspects the user's edited code and
 *    decides whether the issue has been addressed.
 */
export interface CodeReviewChallenge {
  summary: ChallengeSummary;
  prompt: string;
  language: string;
  original_code: string;
  default_code: string;
  hints: string[];
  aiHintRubric: string[];
  solutionCheck: (code: string) => SolutionVerdict;
}

export interface SolutionVerdict {
  passed: boolean;
  message: string;
}

const DIVISION_FACTORY_SOURCE = `function createDivider(divisor) {
  return function divide(value) {
    return value / divisor;
  };
}

const half = createDivider(2);
const broken = createDivider(0);

console.log(half("ten"));   // expected: a number, got: NaN
console.log(broken(5));     // expected: graceful failure, got: Infinity
`;

const POINTER_SOURCE = `#include <stdio.h>
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
    prompt:
      'createDivider returns a closure that captures a divisor and applies it later. Review the implementation and look for potential improvements.',
    language: 'javascript',
    original_code: DIVISION_FACTORY_SOURCE,
    default_code: DIVISION_FACTORY_SOURCE,
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
    summary: {
      id: 'code-review-what-are-you-pointing-at',
      name: 'What Are You Pointing At?',
      track: 'code-review',
      category: 'code review',
      difficulty: 'hard',
      description:
        'A C helper builds a greeting and returns a pointer. It compiles cleanly but is broken in two distinct ways.',
      estimated_minutes: 22,
    },
    prompt:
      'make_greeting returns a pointer that the caller dereferences. Identify the lifetime issue and the unbounded-format issue, and rewrite the function so the returned pointer is safe to use.',
    language: 'c',
    original_code: POINTER_SOURCE,
    default_code: POINTER_SOURCE,
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
];

export function listCodeReviewChallenges(): CodeReviewChallenge[] {
  return CHALLENGES;
}

export function getCodeReviewChallenge(id: string): CodeReviewChallenge | undefined {
  return CHALLENGES.find((c) => c.summary.id === id);
}
