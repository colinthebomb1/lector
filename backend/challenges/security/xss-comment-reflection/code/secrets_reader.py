import os
from pathlib import Path

SECRETS_DIR = Path("/app/secret")


def read_secret(name: str, env_var: str | None = None) -> str:
    if env_var:
        value = os.environ.get(env_var)
        if value:
            return value
    return (SECRETS_DIR / name).read_text(encoding="utf-8").strip()
