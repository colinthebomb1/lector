from types import SimpleNamespace

from passlib.hash import pbkdf2_sha256

from app.routers import auth


class FakeUsersCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    async def insert_one(self, doc):
        self.docs.append(doc)
        return SimpleNamespace(inserted_id=doc["session_id"])

    async def find_one(self, query):
        for doc in self.docs:
            if all(doc.get(key) == value for key, value in query.items()):
                return doc
        return None


class FakeDatabase:
    def __init__(self, docs=None):
        self.users = FakeUsersCollection(docs)


def test_signup_normalizes_email_sets_session_cookie_and_persists_user(client, monkeypatch):
    fake_db = FakeDatabase()
    monkeypatch.setattr(auth, "get_db", lambda: fake_db)

    response = client.post(
        "/api/auth/signup",
        json={
            "name": "Ada",
            "email": "  ADA@Example.COM  ",
            "password": "correct horse battery staple",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["nickname"] == "Ada"
    assert body["email"] == "ada@example.com"
    assert "session_id" in response.cookies

    stored_user = fake_db.users.docs[0]
    assert stored_user["email"] == "ada@example.com"
    assert stored_user["nickname"] == "Ada"
    assert stored_user["name"] == "Ada"
    assert pbkdf2_sha256.verify(
        "correct horse battery staple",
        stored_user["password_hash"],
    )


def test_signup_rejects_email_with_invalid_dot_sequence(client, monkeypatch):
    monkeypatch.setattr(auth, "get_db", lambda: FakeDatabase())

    response = client.post(
        "/api/auth/signup",
        json={
            "name": "Ada",
            "email": "ada..lovelace@example.com",
            "password": "correct horse battery staple",
        },
    )

    assert response.status_code == 422


def test_signup_rejects_duplicate_email(client, monkeypatch):
    fake_db = FakeDatabase(
        [
            {
                "session_id": "existing-session",
                "nickname": "Ada",
                "email": "ada@example.com",
                "password_hash": pbkdf2_sha256.hash("existing-password"),
            }
        ]
    )
    monkeypatch.setattr(auth, "get_db", lambda: fake_db)

    response = client.post(
        "/api/auth/signup",
        json={
            "name": "Ada",
            "email": "ADA@example.com",
            "password": "correct horse battery staple",
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Email already registered"
    assert len(fake_db.users.docs) == 1


def test_login_accepts_existing_email_and_password(client, monkeypatch):
    password_hash = pbkdf2_sha256.hash("correct horse battery staple")
    monkeypatch.setattr(
        auth,
        "get_db",
        lambda: FakeDatabase(
            [
                {
                    "session_id": "session-1",
                    "nickname": "Ada",
                    "email": "ada@example.com",
                    "password_hash": password_hash,
                }
            ]
        ),
    )

    response = client.post(
        "/api/auth/login",
        json={"email": "  ADA@example.com  ", "password": "correct horse battery staple"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "session_id": "session-1",
        "nickname": "Ada",
        "email": "ada@example.com",
    }
    assert response.cookies["session_id"] == "session-1"


def test_login_rejects_bad_password(client, monkeypatch):
    password_hash = pbkdf2_sha256.hash("correct horse battery staple")
    monkeypatch.setattr(
        auth,
        "get_db",
        lambda: FakeDatabase(
            [
                {
                    "session_id": "session-1",
                    "nickname": "Ada",
                    "email": "ada@example.com",
                    "password_hash": password_hash,
                }
            ]
        ),
    )

    response = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "wrong password"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"


def test_me_returns_authenticated_user_from_signup_session(client, monkeypatch):
    fake_db = FakeDatabase()
    monkeypatch.setattr(auth, "get_db", lambda: fake_db)

    signup_response = client.post(
        "/api/auth/signup",
        json={
            "name": "Ada",
            "email": "ada@example.com",
            "password": "correct horse battery staple",
        },
    )

    response = client.get("/api/auth/me")

    assert signup_response.status_code == 200
    assert response.status_code == 200
    assert response.json() == {
        "authenticated": True,
        "nickname": "Ada",
        "email": "ada@example.com",
        "challenges_completed": [],
        "total_score": 0,
    }
