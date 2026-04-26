"""
Gemma AI integration for reading comprehension, hints, and explanation grading.

All responses are cached by prompt hash in MongoDB to save API cost and handle flakiness.
"""

import hashlib
import json
import logging
from datetime import datetime, timezone

import httpx

from app.config import get_settings
from app.database import get_db, is_db_connected

logger = logging.getLogger(__name__)

# Treat obviously-fake API keys as "not configured" so the local fallback
# kicks in instead of sending a doomed request to Google.
_PLACEHOLDER_API_KEYS = {
    "",
    "your-google-ai-studio-key",
    "your-api-key-here",
    "changeme",
    "todo",
}


def _is_real_api_key(value: str) -> bool:
    return bool(value) and value.strip().lower() not in _PLACEHOLDER_API_KEYS


async def check_reading_comprehension(
    user_summary: str, reference_summary: str
) -> dict:
    """
    Compare user's summary against the reference.
    Returns { passed: bool, feedback: str, missing_points: list[str] }
    """
    prompt = (
        "You are a supportive cybersecurity tutor speaking directly to the learner.\n"
        "Grade whether their reading summary shows they understand the code before attacking it.\n\n"
        f"Reference summary:\n{reference_summary}\n\n"
        f"Student summary:\n{user_summary}\n\n"
        "Check only these three reading-comprehension points:\n"
        "1. purpose: what the application or code is for\n"
        "2. main_flow: how a normal request or user action moves through the code\n"
        "3. public_surface: the route, endpoint, input, command, or UI action exposed to users\n\n"
        "Feedback rules:\n"
        "- Address the learner as \"you\"; never say \"the student\".\n"
        "- Be brief, kind, and concrete.\n"
        "- Do not reveal exploit payloads, fixes, or details from the reference summary that the learner did not mention.\n"
        "- For missing_points, use only these exact labels: purpose, main_flow, public_surface.\n\n"
        "Respond as JSON: {\"passed\": bool, \"feedback\": str, \"missing_points\": [str]}"
    )
    return _shape_reading_result(await _gemma_request(prompt))


async def get_hint(challenge_id: str, tier: int, user_context: str = "") -> str:
    """
    Return a progressive hint for a challenge.
    Tier 1 = nudge, Tier 2 = concept (personalized), Tier 3 = near-solution.
    """
    prompt = (
        f"Provide a tier {tier} hint for challenge {challenge_id}.\n"
        f"Tier 1 = subtle nudge, Tier 2 = name the concept, Tier 3 = near-solution.\n"
    )
    if user_context:
        prompt += f"Student's previous attempts:\n{user_context}\n"
    prompt += "Respond with just the hint text."

    result = await _gemma_request(prompt)
    return result.get("text", str(result))


async def generate_attack_hint(
    challenge_name: str,
    scenario: str,
    vulnerable_code: str,
    hint_tiers: list[dict],
    attempted_payloads: list[dict],
) -> dict:
    """
    Analyze the user's attempted payloads and generate a contextual hint.

    Returns { hint: str, analysis: str }
    """
    payloads_summary = ""
    if attempted_payloads:
        for i, p in enumerate(attempted_payloads[-10:], 1):
            form = p.get("form_data", {})
            status = p.get("response_status", "?")
            payloads_summary += f"  {i}. POST /{p.get('path', '?')} → {status} | fields: {form}\n"
    else:
        payloads_summary = "  (no attempts yet)\n"

    tiers_text = ""
    for t in hint_tiers:
        tiers_text += f"  Tier {t.get('tier', '?')}: {t.get('text', '')}\n"

    prompt = (
        "You are a cybersecurity tutor helping a student learn to exploit a web vulnerability.\n"
        f"Challenge: {challenge_name}\n\n"
        f"Scenario:\n{scenario}\n\n"
        f"Vulnerable code:\n```python\n{vulnerable_code}\n```\n\n"
        f"Available hint tiers (for reference — do NOT just repeat these):\n{tiers_text}\n"
        f"Student's recent payloads:\n{payloads_summary}\n"
        "Based on what the student has tried, provide a short, encouraging hint that:\n"
        "1. Acknowledges what they've tried so far\n"
        "2. Nudges them toward the right direction without giving the full answer\n"
        "3. If they are close, be more specific; if they haven't tried anything useful, be more general\n"
        "4. Keep it under 100 words\n\n"
        "Respond as JSON: {\"hint\": \"<your hint>\", \"analysis\": \"<brief analysis of their attempts>\"}"
    )
    return await _gemma_request(prompt)


async def generate_code_review_hint(
    challenge_name: str,
    challenge_prompt: str,
    language: str,
    starter_code: str,
    current_code: str,
    rubric_items: list[str],
    static_hints: list[str],
    prior_hints: list[str] | None = None,
) -> dict:
    """
    Analyze a learner's current code-review patch and generate an adaptive hint.

    Returns { hint: str, analysis: str, progress: str }
    """
    rubric_text = "\n".join(
        f"  {idx}. {item}" for idx, item in enumerate(rubric_items, start=1)
    )
    static_hint_text = "\n".join(
        f"  Hint {idx}: {hint}" for idx, hint in enumerate(static_hints, start=1)
    )
    prior_hint_text = "\n".join(
        f"  {idx}. {hint}" for idx, hint in enumerate(prior_hints or [], start=1)
    )
    if not prior_hint_text:
        prior_hint_text = "  (none yet)\n"

    prompt = (
        "You are a patient code-review tutor helping a student improve a small program.\n"
        f"Challenge: {challenge_name}\n"
        f"Language: {language}\n\n"
        f"Challenge prompt:\n{challenge_prompt}\n\n"
        f"Starter code:\n```{language}\n{starter_code}\n```\n\n"
        f"Student's current code:\n```{language}\n{current_code}\n```\n\n"
        f"Expected rubric:\n{rubric_text}\n\n"
        f"Static hints already available in the UI (for reference only, do not repeat them verbatim):\n{static_hint_text}\n\n"
        f"Prior AI hints already shown to the student:\n{prior_hint_text}\n\n"
        "Analyze how close the student is to the rubric. Then provide one short hint that:\n"
        "1. Starts broad if they are still far away\n"
        "2. Gets more specific when they have partially addressed the problem\n"
        "3. Guides them toward discovering the fix themselves\n"
        "4. Does not provide the full solution or paste corrected code\n"
        "5. Stays under 90 words\n\n"
        "Respond as JSON: {\"hint\": \"<hint>\", \"analysis\": \"<brief assessment>\", \"progress\": \"early|partial|near\"}"
    )
    return await _gemma_request(prompt)


async def grade_explanation(
    explanation: str, rubric: dict, challenge_context: str = ""
) -> dict:
    """
    Grade a free-text explanation against a structured rubric.
    Returns { score: int, max_score: int, rubric_results: [{item, met, evidence}] }
    """
    rubric_text = json.dumps(rubric, indent=2)
    prompt = (
        "Grade the following explanation against the rubric.\n\n"
        f"Rubric:\n{rubric_text}\n\n"
        f"Context:\n{challenge_context}\n\n"
        f"Student explanation:\n{explanation}\n\n"
        "For each rubric item, respond with JSON:\n"
        '{\"rubric_results\": [{\"item\": str, \"met\": bool, \"evidence\": str}], '
        '\"score\": int, \"max_score\": int}'
    )
    return await _gemma_request(prompt)


async def generate_post_solve_writeup(
    challenge_context: str, user_attempts: list[str], user_fix: str
) -> str:
    """Generate a personalized post-solve explanation."""
    prompt = (
        "Generate a short educational writeup for a student who just solved this challenge.\n\n"
        f"Challenge:\n{challenge_context}\n\n"
        f"Student's attempts:\n{json.dumps(user_attempts)}\n\n"
        f"Student's final fix:\n{user_fix}\n\n"
        "Reference OWASP or well-known resources where relevant. Keep it under 300 words."
    )
    result = await _gemma_request(prompt)
    return result.get("text", str(result))


async def _gemma_request(prompt: str) -> dict:
    """Send a request to Gemma, with MongoDB caching by prompt hash.

    Falls back to a deterministic local response when:
      - the API key is missing or a known placeholder, or
      - Gemma returns a non-2xx response, or
      - the network call fails / times out, or
      - the response shape is unexpected.

    The handler MUST NOT raise — every callsite expects a dict and an
    unhandled exception here turns into a 500 that escapes CORS handling
    and surfaces in the browser as "Failed to fetch".
    """
    cache_key = hashlib.sha256(prompt.encode()).hexdigest()
    db = get_db() if is_db_connected() else None

    if db is not None:
        try:
            cached = await db.gemma_cache.find_one({"_id": cache_key})
            if cached:
                return cached["response"]
        except Exception as exc:
            logger.warning("Gemma cache read failed: %s", exc)

    settings = get_settings()
    result: dict

    if not _is_real_api_key(settings.gemma_api_key):
        result = _local_fallback_response(prompt)
    else:
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemma_model}:generateContent",
                    params={"key": settings.gemma_api_key},
                    json={"contents": [{"parts": [{"text": prompt}]}]},
                )
                resp.raise_for_status()
                data = resp.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            try:
                result = json.loads(_strip_code_fences(text))
            except json.JSONDecodeError:
                result = {"text": text}
        except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
            logger.warning("Gemma API call failed (%s); using local fallback", exc)
            result = _local_fallback_response(prompt)

    if db is not None:
        try:
            await db.gemma_cache.update_one(
                {"_id": cache_key},
                {
                    "$set": {
                        "response": result,
                        "prompt": prompt[:500],
                        "created_at": datetime.now(timezone.utc),
                    }
                },
                upsert=True,
            )
        except Exception as exc:
            logger.warning("Gemma cache write failed: %s", exc)

    return result


_READING_MISSING_POINT_LABELS = {
    "purpose": "Purpose: what the code is for.",
    "main_flow": "Main flow: how a normal request or user action moves through the code.",
    "public_surface": "Public surface: what users can interact with.",
}


def _shape_reading_result(result: dict) -> dict:
    """Keep reading-check responses learner-facing and non-spoilery."""
    passed = bool(result.get("passed"))
    raw_missing = result.get("missing_points", [])
    if not isinstance(raw_missing, list):
        raw_missing = []

    missing_keys: list[str] = []
    for point in raw_missing:
        normalized = str(point).lower().replace("-", "_").replace(" ", "_")
        if "purpose" in normalized:
            key = "purpose"
        elif "flow" in normalized:
            key = "main_flow"
        elif "surface" in normalized or "api" in normalized or "route" in normalized or "endpoint" in normalized:
            key = "public_surface"
        else:
            continue
        if key not in missing_keys:
            missing_keys.append(key)

    if not missing_keys and not passed:
        missing_keys = ["purpose", "main_flow", "public_surface"]

    return {
        "passed": passed,
        "feedback": (
            "Nice work. Your summary shows enough understanding to start exploring the workspace."
            if passed
            else "You are on the right track. Add a little more about what the code is for, how a normal request moves through it, and what users can interact with."
        ),
        "missing_points": [
            _READING_MISSING_POINT_LABELS[key]
            for key in missing_keys
            if key in _READING_MISSING_POINT_LABELS
        ],
    }


def _local_fallback_response(prompt: str) -> dict:
    """Deterministic local fallback that preserves the product gates."""
    if "Reference summary:" in prompt and "Student summary:" in prompt:
        reference = _extract_section(prompt, "Reference summary:\n", "\n\nStudent summary:")
        student = _extract_section(
            prompt, "Student summary:\n", "\n\nCheck only these three reading-comprehension points:"
        )
        reference_terms = {word for word in _tokenize(reference) if len(word) > 4}
        student_terms = set(_tokenize(student))
        overlap = sorted(reference_terms & student_terms)

        if len(overlap) >= min(3, len(reference_terms) or 3):
            return {
                "passed": True,
                "feedback": "Nice work. Your summary shows enough understanding to start exploring the workspace.",
                "missing_points": [],
            }

        return {
            "passed": False,
            "feedback": "You are on the right track. Add a little more about what the code is for, how a normal request moves through it, and what users can interact with.",
            "missing_points": ["purpose", "main_flow", "public_surface"],
        }

    if "cybersecurity tutor" in prompt and "Student's recent payloads:" in prompt:
        payloads_section = _extract_section(prompt, "Student's recent payloads:\n", "\nBased on what")
        has_attempts = "(no attempts yet)" not in payloads_section
        if not has_attempts:
            return {
                "hint": "Start by trying to log in with some test credentials. Pay attention to how the application responds — error messages can reveal a lot about what's happening behind the scenes.",
                "analysis": "No attempts recorded yet.",
            }
        if "' " in payloads_section or "OR" in payloads_section.upper():
            return {
                "hint": "You're on the right track with special characters! Think about how a single quote interacts with the SQL query structure. Can you make the WHERE clause always evaluate to true?",
                "analysis": "Student is experimenting with SQL-related characters.",
            }
        return {
            "hint": "Look at how the login form data gets placed into the SQL query. What would happen if your input contained characters that have special meaning in SQL, like a single quote?",
            "analysis": "Student has made attempts but hasn't tried SQL injection payloads yet.",
        }

    if "patient code-review tutor" in prompt and "Student's current code:" in prompt:
        challenge_name = _extract_section(prompt, "Challenge: ", "\nLanguage:")
        starter_code = _extract_section(
            prompt, "Starter code:\n```", "```\n\nStudent's current code:"
        )
        current_code = _extract_section(
            prompt, "Student's current code:\n```", "```\n\nExpected rubric:"
        )

        current_lower = current_code.lower()
        starter_lower = starter_code.lower()
        changed = current_lower.strip() != starter_lower.strip()

        if "division factory" in challenge_name.lower():
            guards_zero = (
                "divisor === 0" in current_code
                or "divisor == 0" in current_code
                or "number.isfinite(divisor)" in current_lower
                or "isfinite(divisor)" in current_lower
            )
            guards_value = (
                "number.isfinite(value)" in current_lower
                or "typeof value !== 'number'" in current_lower
                or 'typeof value !== "number"' in current_lower
                or "isnan(" in current_lower
            )
            explicit_failure = "throw" in current_lower or "return null" in current_lower

            score = sum([guards_zero, guards_value, explicit_failure])
            if score >= 3:
                return {
                    "hint": "You have the key safeguards in place. Make one last pass on edge cases and check whether every invalid path fails deliberately rather than slipping through with a misleading numeric result.",
                    "analysis": "Student appears very close to the expected safeguards.",
                    "progress": "near",
                }
            if score == 2:
                missing = (
                    "how invalid inputs surface to the caller"
                    if not explicit_failure
                    else "the remaining input path that still assumes valid numbers"
                )
                return {
                    "hint": f"You're close. One assumption is still unchecked: focus on {missing}, and decide what the function should do when that assumption is violated.",
                    "analysis": "Student has partially covered the rubric and needs one more guard.",
                    "progress": "partial",
                }
            if score == 1:
                return {
                    "hint": "Nice start. There are two moments to reason about here: when the divider is created, and when it is later used. Compare the assumptions at both points and look for the one you have not defended yet.",
                    "analysis": "Student has begun adding a guard but has not covered the whole flow.",
                    "progress": "partial",
                }
            if changed:
                return {
                    "hint": "Look less at syntax and more at assumptions. Ask what must be true about both numbers involved for division to produce a meaningful result, then decide where each assumption belongs.",
                    "analysis": "Student changed the code but has not yet addressed the core rubric items.",
                    "progress": "early",
                }
            return {
                "hint": "Start by tracing the sample calls and writing down why JavaScript accepts both of them. Which inputs create results that technically compute, but should probably be treated as invalid in a safer design?",
                "analysis": "No substantive edits yet.",
                "progress": "early",
            }

        if "pointing at" in challenge_name.lower():
            uses_snprintf = "snprintf(" in current_lower
            avoids_sprintf = "sprintf(" not in current_lower
            safe_lifetime = any(
                token in current_lower
                for token in ["malloc(", "calloc(", "strdup(", "static char"]
            ) or ("char *" in current_code and current_code.count("char *") > starter_code.count("char *"))
            score = sum([uses_snprintf and avoids_sprintf, safe_lifetime, changed])
            if uses_snprintf and avoids_sprintf and safe_lifetime:
                return {
                    "hint": "This is nearly there. Double-check that the caller can tell who owns the returned memory and that every write respects the actual buffer size.",
                    "analysis": "Student appears close to a correct lifetime and bounds fix.",
                    "progress": "near",
                }
            if safe_lifetime or uses_snprintf:
                return {
                    "hint": "You fixed one side of the problem. Now inspect the other: one issue is about how long the returned data remains valid, and the other is about how much data can be written into a fixed-size buffer.",
                    "analysis": "Student has partially addressed either lifetime or bounds, but not both.",
                    "progress": "partial",
                }
            return {
                "hint": "Ignore the fact that the program compiles. Instead, ask two review questions: where does the returned memory live after the function exits, and what stops a long name from writing past the available space?",
                "analysis": "Student has not yet addressed the main pointer-safety concerns.",
                "progress": "early",
            }

        if not changed:
            return {
                "hint": "Start with the observable behavior and list the assumptions the original code is making. A good first improvement usually comes from defending one assumption the code currently trusts too much.",
                "analysis": "No substantive edits yet.",
                "progress": "early",
            }

        return {
            "hint": "Compare your current patch against the rubric and ask which expectation is still only implied rather than enforced. Tighten the code around that gap rather than making the fix broader.",
            "analysis": "Student has made edits, but the fallback cannot determine exact progress.",
            "progress": "partial",
        }

    return {"text": "[Gemma API key not configured - using local fallback]"}


def _strip_code_fences(text: str) -> str:
    """Strip markdown code fences (```json ... ```) that Gemma often wraps around JSON."""
    import re
    match = re.search(r"```(?:json)?\s*\n?(.*?)```", text, re.DOTALL)
    return match.group(1).strip() if match else text.strip()


def _extract_section(text: str, start_marker: str, end_marker: str) -> str:
    start = text.find(start_marker)
    if start == -1:
        return ""
    start += len(start_marker)
    end = text.find(end_marker, start)
    if end == -1:
        end = len(text)
    return text[start:end].strip()


def _tokenize(text: str) -> list[str]:
    cleaned = "".join(ch.lower() if ch.isalnum() else " " for ch in text)
    return [word for word in cleaned.split() if word]
