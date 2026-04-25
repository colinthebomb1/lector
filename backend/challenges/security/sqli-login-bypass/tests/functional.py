"""Functional tests: verify the app works correctly for normal users."""

import subprocess
import time
import requests
import pytest

BASE = "http://localhost:5000"


@pytest.fixture(scope="module", autouse=True)
def start_server():
    proc = subprocess.Popen(["python", "app.py"], cwd="/app")
    time.sleep(2)
    yield
    proc.terminate()
    proc.wait(timeout=5)


def test_login_page_loads():
    r = requests.get(f"{BASE}/login")
    assert r.status_code == 200
    assert "Acme Corp" in r.text


def test_valid_login():
    s = requests.Session()
    r = s.post(f"{BASE}/login", data={"username": "admin", "password": "S3cur3P@ssw0rd!"})
    assert r.status_code == 200
    assert "Admin Dashboard" in r.text or r.url.endswith("/admin")


def test_invalid_login_rejected():
    s = requests.Session()
    r = s.post(f"{BASE}/login", data={"username": "admin", "password": "wrongpassword"})
    assert "Invalid credentials" in r.text


def test_admin_requires_auth():
    r = requests.get(f"{BASE}/admin", allow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers.get("Location", "")


def test_logout_clears_session():
    s = requests.Session()
    s.post(f"{BASE}/login", data={"username": "admin", "password": "S3cur3P@ssw0rd!"})
    s.get(f"{BASE}/logout")
    r = s.get(f"{BASE}/admin", allow_redirects=False)
    assert r.status_code == 302
