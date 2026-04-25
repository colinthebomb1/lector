import sqlite3

from flask import Flask, redirect, render_template_string, request, session

from db import get_user_by_credentials, init_db
from secrets_reader import read_secret
from templates import ADMIN_PAGE, LOGIN_PAGE, USER_PAGE

app = Flask(__name__)
app.secret_key = "acme-internal-secret"


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
    try:
        user = get_user_by_credentials(username, password)
    except sqlite3.Error:
        return render_template_string(
            LOGIN_PAGE, error="SQLi error — please try again"
        )

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
