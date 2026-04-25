"""
Acme Corp Customer Feedback — Comment Preview.

A small public feedback form. Users type a comment and click "Preview"
to see how it will render before submitting. The preview page reflects
the comment back as HTML so customers can use simple formatting like
<b>bold</b> or <i>italic</i> in their feedback.

There is also an "internal" debug page that the team uses to QA the
preview tool — it loads the latest internal release notes via a small
inline JavaScript snippet.
"""

from flask import Flask, redirect, render_template_string, request
from markupsafe import Markup

from secrets_reader import read_secret
from templates import HOME_PAGE, PREVIEW_PAGE

app = Flask(__name__)
app.secret_key = "acme-feedback-secret"


@app.route("/")
def index():
    return render_template_string(HOME_PAGE, comment="")


@app.route("/preview", methods=["GET", "POST"])
def preview():
    """Render the user's comment exactly as they wrote it, plus a small JS
    block that pulls in internal release notes for the QA team."""

    comment = request.values.get("comment", "")

    # ⚠ The bug: `Markup` tells Jinja "this string is already safe HTML",
    # so it's rendered without escaping. Anything the user types — including
    # <script> tags or event-handler attributes — ends up in the DOM verbatim.
    rendered = Markup(comment)

    # Internal release notes that the QA team checks via the preview page.
    # Read at request time so the value reflects whatever's currently
    # configured for this deployment.
    internal_notes = read_secret("flag.txt", "LECTOR_FLAG")

    return render_template_string(
        PREVIEW_PAGE,
        rendered_comment=rendered,
        raw_comment=comment,
        internal_notes=internal_notes,
    )


@app.route("/submit", methods=["POST"])
def submit():
    # Real submission would email the team; for the challenge we just
    # bounce back to the home page with a thank-you query param.
    return redirect("/?submitted=1")


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
