# SQL Injection: Login Bypass

## Background

You're reviewing a small internal admin panel for a company called **Acme Corp**. The application has a login page that authenticates users against a SQLite database.

## Your Mission

**Attack Phase**: Exploit the login form to gain access to the admin panel without knowing any valid credentials. Once you're in, you'll find a flag on the admin dashboard.

**Defend Phase** *(optional, after attack)*: Fix the vulnerability in the source code so the exploit no longer works, without breaking normal login functionality.

## What You're Looking At

The application is a small Flask web app split across a few files. Start with `app.py` to follow the login route, then inspect the database helper it calls to see how credentials are checked.

## Tips

- Read the code on the left carefully before trying anything
- Think about what happens when user input is placed directly into a SQL query
- The admin panel is at `/admin` — but you need to be logged in first
