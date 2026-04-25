"""
Gemma AI integration for reading comprehension, hints, and explanation grading.

All responses are cached by prompt hash in MongoDB to save API cost and handle flakiness.
"""

import hashlib
import json
from datetime import datetime, timezone

import httpx

from app.config import get_settings
from app.database import get_db


async def check_reading_comprehension(
    user_summary: str, reference_summary: str
) -> dict:
    """
    Compare user's summary against the reference.
    Returns { passed: bool, feedback: str, missing_points: list[str] }
    """
    prompt = (
        "You are grading a student's summary of a code file.\n\n"
        f"Reference summary:\n{reference_summary}\n\n"
        f"Student summary:\n{user_summary}\n\n"
        "Does the student identify: (1) the purpose of the code, "
        "(2) the main flow, (3) the public surface/API?\n"
        "Respond as JSON: {\"passed\": bool, \"feedback\": str, \"missing_points\": [str]}"
    )
    return await _gemma_request(prompt)


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
    """Send a request to Gemma, with MongoDB caching by prompt hash."""
    cache_key = hashlib.sha256(prompt.encode()).hexdigest()
    db = get_db()
    cached = await db.gemma_cache.find_one({"_id": cache_key})
    if cached:
        return cached["response"]

    settings = get_settings()
    if not settings.gemma_api_key:
        result = _local_fallback_response(prompt)
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
        return result

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
        result = json.loads(text)
    except json.JSONDecodeError:
        result = {"text": text}

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
    return result


def _local_fallback_response(prompt: str) -> dict:
    """Deterministic local fallback that preserves the product gates."""
    if "Reference summary:" in prompt and "Student summary:" in prompt:
        reference = _extract_section(prompt, "Reference summary:\n", "\n\nStudent summary:")
        student = _extract_section(
            prompt, "Student summary:\n", "\n\nDoes the student identify:"
        )
        reference_terms = {word for word in _tokenize(reference) if len(word) > 4}
        student_terms = set(_tokenize(student))
        overlap = sorted(reference_terms & student_terms)

        if len(overlap) >= min(3, len(reference_terms) or 3):
            return {
                "passed": True,
                "feedback": "Local fallback accepted the summary based on keyword overlap.",
                "missing_points": [],
            }

        return {
            "passed": False,
            "feedback": "Gemma API key not configured. Local fallback requires more overlap with the reference summary.",
            "missing_points": sorted(reference_terms - student_terms)[:3],
        }

    return {"text": "[Gemma API key not configured - using local fallback]"}


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
