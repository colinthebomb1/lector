import sys
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import main


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(main, "connect_db", AsyncMock())
    monkeypatch.setattr(main, "close_db", AsyncMock())
    monkeypatch.setattr(main, "load_challenges", lambda: {})

    with TestClient(main.app) as test_client:
        yield test_client
