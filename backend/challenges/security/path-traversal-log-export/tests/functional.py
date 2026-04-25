"""Functional tests: verify normal log export behavior still works."""

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


def _login(session: requests.Session) -> None:
    r = session.post(
        f"{BASE}/login",
        data={"username": "ops", "password": "ops123"},
        allow_redirects=True,
    )
    assert r.status_code == 200


def test_login_page_loads():
    r = requests.get(f"{BASE}/login")
    assert r.status_code == 200
    assert "Acme Ops Console" in r.text


def test_login_required_for_dashboard():
    r = requests.get(f"{BASE}/dashboard", allow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers.get("Location", "")


def test_dashboard_lists_logs():
    s = requests.Session()
    _login(s)
    r = s.get(f"{BASE}/dashboard")
    assert r.status_code == 200
    # All seeded logs should appear on the dashboard.
    assert "app.log" in r.text
    assert "access.log" in r.text
    assert "auth.log" in r.text


def test_export_returns_log_contents():
    s = requests.Session()
    _login(s)
    r = s.get(f"{BASE}/export", params={"file": "app.log"})
    assert r.status_code == 200
    # Marker line from the seeded app.log.
    assert "app started" in r.text
    # And critically, normal exports don't leak the flag.
    assert "FLAG{" not in r.text


def test_export_other_seeded_logs_work():
    s = requests.Session()
    _login(s)
    for name in ("access.log", "auth.log"):
        r = s.get(f"{BASE}/export", params={"file": name})
        assert r.status_code == 200, f"Normal export of {name} broke after patch"
        assert "FLAG{" not in r.text


def test_missing_file_returns_404():
    s = requests.Session()
    _login(s)
    r = s.get(f"{BASE}/export", params={"file": "does-not-exist.log"})
    assert r.status_code == 404


def test_export_requires_login():
    r = requests.get(f"{BASE}/export?file=app.log", allow_redirects=False)
    assert r.status_code == 302
