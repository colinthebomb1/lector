"""
Acme Corp Operations Console — Log Export.

Logged-in operations staff can browse and download server log files for
debugging. The export route joins the requested filename onto the logs
directory before opening the file.
"""

from pathlib import Path

from flask import Flask, abort, redirect, render_template_string, request, session

from templates import DASHBOARD_PAGE, LOGIN_PAGE

app = Flask(__name__)
app.secret_key = "acme-ops-console-secret"

# The logs directory the export feature is scoped to.
LOGS_DIR = Path(__file__).parent / "logs"


# A handful of mock log files so the dashboard isn't empty.
SAMPLE_LOGS = {
    "app.log": (
        "2026-04-25T10:14:02Z INFO  app started, pid=1\n"
        "2026-04-25T10:14:03Z INFO  listening on 0.0.0.0:5000\n"
        "2026-04-25T10:18:11Z INFO  /login 200 user=guest\n"
        "2026-04-25T10:21:48Z WARN  slow query (812ms): SELECT * FROM orders\n"
        "2026-04-25T10:24:30Z INFO  /logout 302 user=guest\n"
    ),
    "access.log": (
        "10.0.0.4 - - [25/Apr/2026:10:18:11] \"GET /login HTTP/1.1\" 200 1284\n"
        "10.0.0.4 - - [25/Apr/2026:10:18:14] \"POST /login HTTP/1.1\" 302 0\n"
        "10.0.0.4 - - [25/Apr/2026:10:18:14] \"GET /portal HTTP/1.1\" 200 942\n"
        "10.0.0.7 - - [25/Apr/2026:10:21:00] \"GET /api/health HTTP/1.1\" 200 17\n"
    ),
    "auth.log": (
        "2026-04-25T10:14:00Z auth: pam_unix(sshd:session): session opened for user ops\n"
        "2026-04-25T10:18:14Z auth: login success user=guest method=password\n"
        "2026-04-25T10:24:30Z auth: logout user=guest\n"
    ),
}


def ensure_sample_logs() -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    for name, body in SAMPLE_LOGS.items():
        path = LOGS_DIR / name
        if not path.exists():
            path.write_text(body, encoding="utf-8")


@app.route("/")
def index():
    if not session.get("logged_in"):
        return redirect("/login")
    return redirect("/dashboard")


@app.route("/login", methods=["GET", "POST"])
def login():
    """Tiny login page so the dashboard isn't anonymous. Not the bug under test."""
    if request.method == "GET":
        return render_template_string(LOGIN_PAGE, error=None)

    username = request.form.get("username", "")
    password = request.form.get("password", "")
    # Hardcoded ops account — credentials are visible on the login page.
    if username == "ops" and password == "ops123":
        session["logged_in"] = True
        session["username"] = username
        return redirect("/dashboard")
    return render_template_string(LOGIN_PAGE, error="Invalid credentials")


@app.route("/logout")
def logout():
    session.clear()
    return redirect("/login")


@app.route("/dashboard")
def dashboard():
    if not session.get("logged_in"):
        return redirect("/login")
    log_files = sorted(p.name for p in LOGS_DIR.iterdir() if p.is_file())
    return render_template_string(
        DASHBOARD_PAGE,
        username=session.get("username", "ops"),
        log_files=log_files,
    )


@app.route("/export")
def export_log():
    """Stream the contents of a requested log file."""
    if not session.get("logged_in"):
        return redirect("/login")

    requested = request.args.get("file", "")
    if not requested:
        abort(400, "Missing file parameter")
    if Path(requested).is_absolute():
        abort(400, "Absolute paths are not valid log names")

    cleaned = requested.replace("../", "")

    # Build the path for the requested export under the logs directory.
    target = LOGS_DIR / cleaned

    try:
        contents = target.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError:
        abort(404, f"Log file not found: {requested}")
    except IsADirectoryError:
        abort(400, "Cannot export a directory")
    except PermissionError:
        abort(403, "Permission denied")

    return contents, 200, {"Content-Type": "text/plain; charset=utf-8"}


if __name__ == "__main__":
    ensure_sample_logs()
    app.run(host="0.0.0.0", port=5000)
