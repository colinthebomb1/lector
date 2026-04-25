_BASE_STYLE = """
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
a { color: #38bdf8; text-decoration: none; }
a:hover { text-decoration: underline; }
.topbar { background: #1e293b; border-bottom: 1px solid #334155; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
.topbar h1 { font-size: 1.125rem; color: #38bdf8; }
.topbar .meta { color: #94a3b8; font-size: 0.875rem; }
"""


LOGIN_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Acme Ops Console - Sign In</title>
    <style>
        """ + _BASE_STYLE + """
        body { display: flex; align-items: center; justify-content: center; }
        .login-container { background: #1e293b; border: 1px solid #334155; border-radius: 12px; padding: 2.5rem; width: 100%; max-width: 400px; }
        .logo { text-align: center; margin-bottom: 1.5rem; }
        .logo h1 { font-size: 1.5rem; color: #38bdf8; }
        .logo p { color: #94a3b8; font-size: 0.875rem; margin-top: 0.25rem; }
        .form-group { margin-bottom: 1rem; }
        label { display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 0.375rem; }
        input { width: 100%; padding: 0.625rem 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 0.875rem; }
        input:focus { outline: none; border-color: #38bdf8; }
        button { width: 100%; padding: 0.625rem; background: #38bdf8; color: #0f172a; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-top: 0.5rem; }
        button:hover { background: #7dd3fc; }
        .error { background: #451a2b; border: 1px solid #f87171; color: #fca5a5; padding: 0.625rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.8rem; }
        .hint { background: #082f49; border: 1px solid #0369a1; color: #7dd3fc; padding: 0.625rem 0.75rem; border-radius: 6px; margin-top: 1rem; font-size: 0.75rem; font-family: 'Courier New', monospace; }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <h1>Acme Ops Console</h1>
            <p>Internal log review tool</p>
        </div>
        {% if error %}
        <div class="error">{{ error }}</div>
        {% endif %}
        <form method="POST" action="/login">
            <div class="form-group">
                <label>Username</label>
                <input type="text" name="username" placeholder="Enter username" autofocus value="ops">
            </div>
            <div class="form-group">
                <label>Password</label>
                <input type="password" name="password" placeholder="Enter password" value="ops123">
            </div>
            <button type="submit">Sign In</button>
        </form>
        <div class="hint">
            Service account: <strong>ops</strong> / <strong>ops123</strong>
        </div>
    </div>
</body>
</html>
"""


DASHBOARD_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Acme Ops Console - Log Export</title>
    <style>
        """ + _BASE_STYLE + """
        .container { padding: 2rem; max-width: 900px; margin: 0 auto; }
        .welcome { margin-bottom: 2rem; }
        .welcome h2 { font-size: 1.5rem; margin-bottom: 0.25rem; }
        .welcome p { color: #94a3b8; font-size: 0.875rem; }
        .card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
        .card h3 { color: #38bdf8; margin-bottom: 0.75rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
        .log-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .log-row { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; background: #0f172a; border: 1px solid #334155; border-radius: 6px; }
        .log-row .name { font-family: 'Courier New', monospace; color: #e2e8f0; }
        .log-row .actions a { padding: 0.375rem 0.875rem; background: #38bdf8; color: #0f172a; border-radius: 4px; font-size: 0.8rem; font-weight: 600; }
        .log-row .actions a:hover { background: #7dd3fc; text-decoration: none; }
        .manual { background: #082f49; border: 1px solid #0369a1; color: #cbd5e1; padding: 1rem 1.25rem; border-radius: 6px; font-size: 0.85rem; line-height: 1.55; }
        .manual code { background: #0f172a; padding: 0.125rem 0.4rem; border-radius: 3px; color: #7dd3fc; font-family: 'Courier New', monospace; font-size: 0.8rem; }
    </style>
</head>
<body>
    <div class="topbar">
        <h1>Acme Ops Console</h1>
        <div>
            <span class="meta">Signed in as <strong>{{ username }}</strong></span>
            &nbsp;·&nbsp;
            <a href="/logout">Logout</a>
        </div>
    </div>

    <div class="container">
        <div class="welcome">
            <h2>Log Export</h2>
            <p>Download server log files for incident review.</p>
        </div>

        <div class="card">
            <h3>Available Logs</h3>
            <div class="log-list">
                {% for name in log_files %}
                <div class="log-row">
                    <span class="name">{{ name }}</span>
                    <div class="actions">
                        <a href="/export?file={{ name }}">Export →</a>
                    </div>
                </div>
                {% endfor %}
            </div>
        </div>

        <div class="card">
            <h3>Notes from the previous on-call</h3>
            <div class="manual">
                The export endpoint takes a <code>file</code> query parameter and
                streams the matching log under <code>/app/logs</code>.
                If a customer needs a custom file outside the listed ones,
                construct the URL manually — e.g. <code>/export?file=app.log</code>.
            </div>
        </div>
    </div>
</body>
</html>
"""
