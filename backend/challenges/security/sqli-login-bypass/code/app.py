import sqlite3
import os
from pathlib import Path
from flask import Flask, request, redirect, session, render_template_string

app = Flask(__name__)
app.secret_key = "acme-internal-secret"

DATABASE = "acme.db"
SECRETS_DIR = Path("/app/secret")


def read_secret(name: str, env_var: str | None = None) -> str:
    if env_var:
        value = os.environ.get(env_var)
        if value:
            return value
    return (SECRETS_DIR / name).read_text(encoding="utf-8").strip()


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    admin_password = read_secret("admin_password.txt", "LECTOR_ADMIN_PASSWORD")
    conn = get_db()
    conn.execute(
        "CREATE TABLE IF NOT EXISTS users "
        "(id INTEGER PRIMARY KEY, username TEXT, password TEXT, role TEXT)"
    )
    conn.execute("DELETE FROM users")
    conn.execute(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        ("admin", admin_password, "admin"),
    )
    conn.execute(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        ("guest", "guest123", "user"),
    )
    conn.commit()
    conn.close()


LOGIN_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Acme Corp - Login</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
        .login-container { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2.5rem; width: 100%%; max-width: 400px; }
        .logo { text-align: center; margin-bottom: 1.5rem; }
        .logo h1 { font-size: 1.5rem; color: #38bdf8; }
        .logo p { color: #94a3b8; font-size: 0.875rem; margin-top: 0.25rem; }
        .form-group { margin-bottom: 1rem; }
        label { display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 0.375rem; }
        input { width: 100%%; padding: 0.625rem 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 0.875rem; }
        input:focus { outline: none; border-color: #38bdf8; }
        button { width: 100%%; padding: 0.625rem; background: #38bdf8; color: #0f172a; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-top: 0.5rem; }
        button:hover { background: #7dd3fc; }
        .error { background: #451a2b; border: 1px solid #f87171; color: #fca5a5; padding: 0.625rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.8rem; }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <h1>Acme Corp</h1>
            <p>Internal Admin Panel</p>
        </div>
        {% if error %}
        <div class="error">{{ error }}</div>
        {% endif %}
        <form method="POST" action="/login">
            <div class="form-group">
                <label>Username</label>
                <input type="text" name="username" placeholder="Enter username" autofocus>
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" name="password" placeholder="Enter password">
            </div>
            <button type="submit">Sign In</button>
        </form>
    </div>
</body>
</html>
"""

ADMIN_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Acme Corp - Admin Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
        .topbar { background: #1e293b; border-bottom: 1px solid #334155; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .topbar h1 { font-size: 1.125rem; color: #38bdf8; }
        .topbar a { color: #94a3b8; text-decoration: none; font-size: 0.875rem; }
        .dashboard { padding: 2rem; max-width: 800px; margin: 0 auto; }
        .welcome { margin-bottom: 2rem; }
        .welcome h2 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .welcome p { color: #94a3b8; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
        .card h3 { color: #38bdf8; margin-bottom: 0.5rem; }
        .flag-box { background: #022c22; border: 1px solid #10b981; border-radius: 8px; padding: 1.5rem; margin-top: 1.5rem; text-align: center; }
        .flag-box h3 { color: #10b981; margin-bottom: 0.75rem; font-size: 1.125rem; }
        .flag { font-family: 'Courier New', monospace; font-size: 1.25rem; color: #34d399; background: #064e3b; padding: 0.75rem 1.5rem; border-radius: 6px; display: inline-block; letter-spacing: 1px; }
    </style>
</head>
<body>
    <div class="topbar">
        <h1>Acme Corp Admin</h1>
        <a href="/logout">Logout</a>
    </div>
    <div class="dashboard">
        <div class="welcome">
            <h2>Welcome, {{ username }}</h2>
            <p>Role: {{ role }}</p>
        </div>
        <div class="card">
            <h3>System Status</h3>
            <p>All services operational. Last backup: 2 hours ago.</p>
        </div>
        <div class="card">
            <h3>Recent Activity</h3>
            <p>3 failed login attempts in the last hour.</p>
        </div>
        <div class="flag-box">
            <h3>🚩 Confidential Token</h3>
            <div class="flag">{{ flag }}</div>
        </div>
    </div>
</body>
</html>
"""

USER_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Acme Corp - Employee Portal</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
        .topbar { background: #1e293b; border-bottom: 1px solid #334155; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
        .topbar h1 { font-size: 1.125rem; color: #38bdf8; }
        .topbar a { color: #94a3b8; text-decoration: none; font-size: 0.875rem; }
        .dashboard { padding: 2rem; max-width: 800px; margin: 0 auto; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1.5rem; margin-bottom: 1rem; }
        .card h3 { color: #38bdf8; margin-bottom: 0.5rem; }
        .notice { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1rem 1.25rem; color: #94a3b8; }
    </style>
</head>
<body>
    <div class="topbar">
        <h1>Acme Corp Portal</h1>
        <a href="/logout">Logout</a>
    </div>
    <div class="dashboard">
        <div class="card">
            <h3>Welcome, {{ username }}</h3>
            <p>Role: {{ role }}</p>
        </div>
        <div class="notice">
            Your account does not have access to the admin dashboard.
        </div>
    </div>
</body>
</html>
"""


@app.route("/")
def index():
    if session.get("logged_in"):
        return redirect("/admin" if session.get("role") == "admin" else "/portal")
    return redirect("/login")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        return render_template_string(LOGIN_PAGE, error=None)

    username = request.form.get("username", "")
    password = request.form.get("password", "")

    conn = get_db()
    query = f"SELECT * FROM users WHERE username='{username}' AND password='{password}'"
    user = conn.execute(query).fetchone()
    conn.close()

    if user:
        session["logged_in"] = True
        session["username"] = user["username"]
        session["role"] = user["role"]
        return redirect("/admin" if user["role"] == "admin" else "/portal")

    return render_template_string(LOGIN_PAGE, error="Invalid credentials")


@app.route("/admin")
def admin():
    if not session.get("logged_in"):
        return redirect("/login")
    if session.get("role") != "admin":
        return redirect("/portal")
    return render_template_string(
        ADMIN_PAGE,
        username=session.get("username", "unknown"),
        role=session.get("role", "unknown"),
        flag=read_secret("flag.txt", "LECTOR_FLAG"),
    )


@app.route("/portal")
def portal():
    if not session.get("logged_in"):
        return redirect("/login")
    return render_template_string(
        USER_PAGE,
        username=session.get("username", "unknown"),
        role=session.get("role", "unknown"),
    )


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000)
