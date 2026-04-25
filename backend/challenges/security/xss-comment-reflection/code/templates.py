_BASE_STYLE = """
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
a { color: #38bdf8; text-decoration: none; }
a:hover { text-decoration: underline; }
.topbar { background: #1e293b; border-bottom: 1px solid #334155; padding: 1rem 2rem; display: flex; justify-content: space-between; align-items: center; }
.topbar h1 { font-size: 1.125rem; color: #38bdf8; }
.topbar .meta { color: #94a3b8; font-size: 0.875rem; }
.container { padding: 2rem; max-width: 760px; margin: 0 auto; }
.card { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.25rem; }
.card h3 { color: #38bdf8; margin-bottom: 0.75rem; font-size: 1rem; text-transform: uppercase; letter-spacing: 0.05em; }
label { display: block; font-size: 0.875rem; color: #94a3b8; margin-bottom: 0.375rem; }
textarea, input { width: 100%; padding: 0.625rem 0.75rem; background: #0f172a; border: 1px solid #334155; border-radius: 6px; color: #e2e8f0; font-size: 0.875rem; font-family: inherit; }
textarea:focus, input:focus { outline: none; border-color: #38bdf8; }
button, .btn { padding: 0.625rem 1.25rem; background: #38bdf8; color: #0f172a; border: none; border-radius: 6px; font-size: 0.875rem; font-weight: 600; cursor: pointer; display: inline-block; }
button:hover, .btn:hover { background: #7dd3fc; text-decoration: none; }
.btn-secondary { background: transparent; color: #94a3b8; border: 1px solid #334155; }
.btn-secondary:hover { color: #e2e8f0; border-color: #475569; background: transparent; }
.success { background: #064e3b; border: 1px solid #10b981; color: #6ee7b7; padding: 0.625rem 0.875rem; border-radius: 6px; margin-bottom: 1rem; font-size: 0.85rem; }
"""


HOME_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Acme Feedback</title>
    <style>
        """ + _BASE_STYLE + """
        .hero { margin-bottom: 1.5rem; }
        .hero h2 { font-size: 1.5rem; margin-bottom: 0.5rem; }
        .hero p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
        .formatting-help { font-size: 0.78rem; color: #64748b; margin-top: 0.5rem; }
        .formatting-help code { background: #0f172a; padding: 0.1rem 0.35rem; border-radius: 3px; color: #7dd3fc; font-family: 'Courier New', monospace; }
        .actions { display: flex; gap: 0.75rem; margin-top: 1rem; }
    </style>
</head>
<body>
    <div class="topbar">
        <h1>Acme Feedback</h1>
        <span class="meta">Customer voice portal</span>
    </div>

    <div class="container">
        <div class="hero">
            <h2>Tell us what you think</h2>
            <p>Your feedback helps us prioritize what we build next. Use the form
            below to share a comment — you can preview it before submitting.</p>
        </div>

        {% if request.args.get('submitted') %}
        <div class="success">Thanks! Your feedback was submitted.</div>
        {% endif %}

        <div class="card">
            <h3>Leave a comment</h3>
            <form method="POST" action="/preview">
                <label>Your comment</label>
                <textarea name="comment" rows="6" placeholder="What's on your mind?" autofocus>{{ comment }}</textarea>
                <p class="formatting-help">
                    Light HTML formatting allowed: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;u&gt;</code>.
                </p>
                <div class="actions">
                    <button type="submit">Preview →</button>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
"""


# The preview page deliberately exposes the flag as a JS global named
# `__INTERNAL_NOTES`. The narrative is "QA team uses the preview page to
# check release-notes formatting"; in reality it's just the flag sitting
# in window scope, accessible to any script that runs on the page.
PREVIEW_PAGE = """
<!DOCTYPE html>
<html>
<head>
    <title>Acme Feedback - Preview</title>
    <style>
        """ + _BASE_STYLE + """
        .preview-box { background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 1.25rem; min-height: 100px; line-height: 1.6; }
        .preview-box.empty { color: #64748b; font-style: italic; }
        .raw-box { background: #020617; border: 1px solid #1e293b; border-radius: 6px; padding: 0.75rem 1rem; font-family: 'Courier New', monospace; font-size: 0.8rem; color: #94a3b8; white-space: pre-wrap; word-break: break-word; max-height: 160px; overflow-y: auto; }
        .actions { display: flex; gap: 0.75rem; margin-top: 1.25rem; }
        .debug-banner { background: #082f49; border: 1px solid #0369a1; color: #7dd3fc; padding: 0.625rem 0.875rem; border-radius: 6px; font-size: 0.78rem; margin-bottom: 1.25rem; }
    </style>
    <script>
        // QA helper: expose the current internal release notes for the preview-page
        // smoke check. Loaded at render time from the server-side config.
        window.__INTERNAL_NOTES = {{ internal_notes | tojson }};
    </script>
</head>
<body>
    <div class="topbar">
        <h1>Acme Feedback</h1>
        <span class="meta">Comment preview</span>
    </div>

    <div class="container">
        <div class="debug-banner">
            <strong>Preview mode</strong> — this is how your comment will render to other readers.
        </div>

        <div class="card">
            <h3>Rendered Output</h3>
            <div class="preview-box {% if not raw_comment %}empty{% endif %}">
                {% if raw_comment %}{{ rendered_comment }}{% else %}(empty preview){% endif %}
            </div>
        </div>

        <div class="card">
            <h3>Source</h3>
            <div class="raw-box">{{ raw_comment }}</div>
            <form method="POST" action="/submit">
                <input type="hidden" name="comment" value="{{ raw_comment }}">
                <div class="actions">
                    <button type="submit">Submit Feedback</button>
                    <a href="/" class="btn btn-secondary">← Edit</a>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
"""
