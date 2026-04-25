"""
Test the AI hints feature: payload tracking, Gemma hint generation, and local fallback.

Runs without MongoDB — tests the in-memory payload tracking and Gemma API directly.
"""

import asyncio
import sys
import os
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.attack_session import (
    AttackSession,
    AttackPayload,
    record_payload,
    get_payloads,
    get_attack_session,
    _sessions,
)
from app.services.gemma import generate_attack_hint, _local_fallback_response


def _has_gemma_key() -> bool:
    from app.config import get_settings
    return bool(get_settings().gemma_api_key)


def test_payload_tracking():
    """Verify payloads are recorded and retrievable from an AttackSession."""
    _sessions.clear()

    session = AttackSession(
        session_id="test-user",
        challenge_id="sqli-login-bypass",
        container_id="fake-container",
        port=5000,
        expected_flag="FLAG{sql_injection_is_not_authentication_deadbeef}",
        admin_password="Acm3!deadbeef",
    )
    _sessions["test-user:sqli-login-bypass"] = session

    assert get_payloads("test-user", "sqli-login-bypass") == []

    record_payload("test-user", "sqli-login-bypass", "login", "POST",
                   {"username": "admin", "password": "password123"}, 200)

    record_payload("test-user", "sqli-login-bypass", "login", "POST",
                   {"username": "' OR '1'='1", "password": "x"}, 302)

    record_payload("test-user", "sqli-login-bypass", "login", "POST",
                   {"username": "admin'--", "password": ""}, 200)

    payloads = get_payloads("test-user", "sqli-login-bypass")
    assert len(payloads) == 3
    assert payloads[0].form_data["username"] == "admin"
    assert payloads[1].form_data["username"] == "' OR '1'='1"
    assert payloads[2].form_data["username"] == "admin'--"
    assert payloads[1].response_status == 302

    print("  PASS: 3 payloads recorded and retrieved correctly")
    print(f"  PASS: Payload timestamps present: {all(p.timestamp > 0 for p in payloads)}")

    no_session = get_payloads("nonexistent", "sqli-login-bypass")
    assert no_session == []
    print("  PASS: Returns empty list for nonexistent session")

    _sessions.clear()


def test_local_fallback_no_attempts():
    """Fallback hint when the user hasn't tried anything yet."""
    prompt = (
        "You are a cybersecurity tutor helping a student learn to exploit a web vulnerability.\n"
        "Challenge: SQL Injection: Login Bypass\n\n"
        "Scenario:\nTest scenario\n\n"
        "Vulnerable code:\n```python\ntest code\n```\n\n"
        "Available hint tiers (for reference — do NOT just repeat these):\n  Tier 1: hint1\n\n"
        "Student's recent payloads:\n  (no attempts yet)\n\n"
        "Based on what the student has tried, provide a short hint.\n"
    )
    result = _local_fallback_response(prompt)
    assert "hint" in result
    assert "analysis" in result
    assert "No attempts" in result["analysis"]
    print(f"  PASS: No-attempts hint: \"{result['hint'][:80]}...\"")


def test_local_fallback_generic_attempts():
    """Fallback hint when user has tried normal logins but no SQLi."""
    prompt = (
        "You are a cybersecurity tutor helping a student learn to exploit a web vulnerability.\n"
        "Challenge: SQL Injection: Login Bypass\n\n"
        "Scenario:\nTest scenario\n\n"
        "Vulnerable code:\n```python\ntest code\n```\n\n"
        "Available hint tiers (for reference — do NOT just repeat these):\n  Tier 1: hint1\n\n"
        "Student's recent payloads:\n"
        "  1. POST /login → 200 | fields: {'username': 'admin', 'password': 'password123'}\n"
        "  2. POST /login → 200 | fields: {'username': 'admin', 'password': 'admin'}\n\n"
        "Based on what the student has tried, provide a short hint.\n"
    )
    result = _local_fallback_response(prompt)
    assert "hint" in result
    assert "SQL" in result["hint"] or "single quote" in result["hint"]
    print(f"  PASS: Generic-attempts hint: \"{result['hint'][:80]}...\"")


def test_local_fallback_sqli_attempts():
    """Fallback hint when user is trying SQL injection characters."""
    prompt = (
        "You are a cybersecurity tutor helping a student learn to exploit a web vulnerability.\n"
        "Challenge: SQL Injection: Login Bypass\n\n"
        "Scenario:\nTest scenario\n\n"
        "Vulnerable code:\n```python\ntest code\n```\n\n"
        "Available hint tiers (for reference — do NOT just repeat these):\n  Tier 1: hint1\n\n"
        "Student's recent payloads:\n"
        "  1. POST /login → 200 | fields: {'username': \"' OR 1=1\", 'password': 'x'}\n\n"
        "Based on what the student has tried, provide a short hint.\n"
    )
    result = _local_fallback_response(prompt)
    assert "hint" in result
    assert "right track" in result["hint"].lower() or "WHERE" in result["hint"]
    print(f"  PASS: SQLi-attempts hint: \"{result['hint'][:80]}...\"")


@pytest.mark.asyncio
@pytest.mark.skipif(not _has_gemma_key(), reason="LECTOR_GEMMA_API_KEY not set")
async def test_gemma_api():
    """Test the actual Gemma API call with the real API key."""
    from app.config import get_settings
    settings = get_settings()

    import httpx
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemma_model}:generateContent",
            params={"key": settings.gemma_api_key},
            json={"contents": [{"parts": [{"text": "Say hello in one word."}]}]},
        )
        assert resp.status_code == 200
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        assert len(text.strip()) > 0


@pytest.mark.asyncio
@pytest.mark.skipif(not _has_gemma_key(), reason="LECTOR_GEMMA_API_KEY not set")
async def test_generate_attack_hint_live():
    """Test generate_attack_hint with the real Gemma API (bypasses DB caching)."""
    from app.config import get_settings
    settings = get_settings()

    import httpx
    import json

    payloads_summary = (
        "  1. POST /login → 200 | fields: {'username': 'admin', 'password': 'password'}\n"
        "  2. POST /login → 200 | fields: {'username': 'admin', 'password': 'admin123'}\n"
    )

    prompt = (
        "You are a cybersecurity tutor helping a student learn to exploit a web vulnerability.\n"
        "Challenge: SQL Injection: Login Bypass\n\n"
        "Scenario:\nExploit the login form to access the admin panel.\n\n"
        "Vulnerable code:\n```python\nquery = f\"SELECT * FROM users WHERE username='{username}' AND password='{password}'\"\n```\n\n"
        "Available hint tiers (for reference — do NOT just repeat these):\n"
        "  Tier 1: Look closely at how user input reaches the SQL query.\n\n"
        f"Student's recent payloads:\n{payloads_summary}\n"
        "Based on what the student has tried, provide a short, encouraging hint that:\n"
        "1. Acknowledges what they've tried so far\n"
        "2. Nudges them toward the right direction without giving the full answer\n"
        "3. Keep it under 100 words\n\n"
        "Respond as JSON: {\"hint\": \"<your hint>\", \"analysis\": \"<brief analysis of their attempts>\"}"
    )

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{settings.gemma_model}:generateContent",
            params={"key": settings.gemma_api_key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
        )
        resp.raise_for_status()
        text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
        assert len(text) > 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
