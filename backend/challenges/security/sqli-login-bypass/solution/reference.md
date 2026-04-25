# Reference Summary

This is a Flask web application that implements a login system backed by a SQLite database. The `/login` route accepts a username and password via POST, constructs a SQL query using Python f-string formatting, and checks if a matching user exists. If found, the user's session is set and they're redirected to `/admin`, which displays a dashboard with a confidential flag.

## Vulnerability

The SQL query in the login route is built via string interpolation:
```python
query = f"SELECT * FROM users WHERE username='{username}' AND password='{password}'"
```

This is a classic SQL injection vulnerability. User input is embedded directly into the SQL query without sanitization or parameterization, allowing an attacker to manipulate the query logic.

## Exploit

Entering `' OR '1'='1` as the username (with any password) transforms the query into:
```sql
SELECT * FROM users WHERE username='' OR '1'='1' AND password='anything'
```

This returns the first user in the table (admin), bypassing authentication entirely.

## Fix

Replace the f-string query with parameterized queries:
```python
query = "SELECT * FROM users WHERE username=? AND password=?"
user = conn.execute(query, (username, password)).fetchone()
```
