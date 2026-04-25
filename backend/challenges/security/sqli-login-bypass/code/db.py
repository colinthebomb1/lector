import sqlite3

from secrets_reader import read_secret

DATABASE = "acme.db"


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


def get_user_by_credentials(username: str, password: str):
    conn = get_db()
    query = f"SELECT * FROM users WHERE username='{username}' AND password='{password}'"
    user = conn.execute(query).fetchone()
    conn.close()
    return user
