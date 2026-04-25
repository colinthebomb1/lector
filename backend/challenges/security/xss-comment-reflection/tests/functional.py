"""Functional tests: verify normal preview/submit behavior still works."""

import subprocess
import time

import pytest
import requests

BASE = "http://localhost:5000"


@pytest.fixture(scope="module", autouse=True)
def start_server():
    proc = subprocess.Popen(["python", "app.py"], cwd="/app")
    time.sleep(2)
    yield
    proc.terminate()
    proc.wait(timeout=5)


def test_home_page_loads():
    r = requests.get(f"{BASE}/")
    assert r.status_code == 200
    assert "Acme Feedback" in r.text
    assert "Leave a comment" in r.text


def test_plain_comment_renders():
    """A plain text comment should appear in the preview."""
    r = requests.post(f"{BASE}/preview", data={"comment": "Hello there"})
    assert r.status_code == 200
    assert "Hello there" in r.text


def test_special_characters_dont_break_page():
    """Comments containing &, <, > characters should not crash the preview."""
    r = requests.post(
        f"{BASE}/preview",
        data={"comment": "5 < 10 & 10 > 5"},
    )
    assert r.status_code == 200
    # The page should still render fully.
    assert "Acme Feedback" in r.text
    assert "Comment preview" in r.text


def test_empty_comment_shows_empty_state():
    r = requests.post(f"{BASE}/preview", data={"comment": ""})
    assert r.status_code == 200
    assert "empty preview" in r.text


def test_submit_redirects_home():
    r = requests.post(
        f"{BASE}/submit",
        data={"comment": "anything"},
        allow_redirects=False,
    )
    assert r.status_code == 302
    assert "/" in r.headers.get("Location", "")
