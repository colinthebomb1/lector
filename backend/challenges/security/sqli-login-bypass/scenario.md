# SQL Injection: Login Bypass

## Background

You're reviewing a small internal admin panel for a company called **Acme Corp**. The application has a login page that authenticates users against a SQLite database.

## Your Mission

**Attack Phase**: Exploit the login form to gain access to the admin panel without knowing any valid credentials. Once you're in, you'll find a flag on the admin dashboard.

**Defend Phase** *(optional, after attack)*: Fix the vulnerability in the source code so the exploit no longer works, without breaking normal login functionality.

## What You're Looking At

The application is a Flask web app with a single `app.py` file. Pay attention to the `/login` route — specifically how the SQL query is constructed.

## Tips

- Read the code on the left carefully before trying anything
- Think about what happens when user input is placed directly into a SQL query
- The admin panel is at `/admin` — but you need to be logged in first
