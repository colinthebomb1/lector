from types import SimpleNamespace
from unittest.mock import Mock

import docker
import pytest

from app.services.container import ContainerManager


class FakeImages:
    def __init__(self, *, image_exists: bool = True):
        self.image_exists = image_exists
        self.build_calls = []
        self.get_calls = []

    def build(self, **kwargs):
        self.build_calls.append(kwargs)
        return (object(), [])

    def get(self, tag):
        self.get_calls.append(tag)
        if not self.image_exists:
            raise docker.errors.ImageNotFound("missing")
        return object()


class FakeContainers:
    def __init__(self):
        self.run_calls = []

    def run(self, *args, **kwargs):
        self.run_calls.append((args, kwargs))
        return {"container": "ok"}


@pytest.mark.asyncio
async def test_ensure_challenge_image_builds_missing_image(monkeypatch):
    fake_images = FakeImages(image_exists=False)
    fake_client = SimpleNamespace(images=fake_images, containers=FakeContainers())

    monkeypatch.setattr("app.services.container.docker.from_env", lambda timeout: fake_client)

    manager = ContainerManager()
    tag = await manager.ensure_challenge_image("sec-1", "/tmp/sec-1")

    assert tag == "lector-challenge-sec-1:latest"
    assert fake_images.get_calls == ["lector-challenge-sec-1:latest"]
    assert fake_images.build_calls == [
        {"path": "/tmp/sec-1", "tag": "lector-challenge-sec-1:latest", "rm": True}
    ]


@pytest.mark.asyncio
async def test_ensure_challenge_image_skips_lookup_when_cached(monkeypatch):
    fake_images = FakeImages(image_exists=False)
    fake_client = SimpleNamespace(images=fake_images, containers=FakeContainers())

    monkeypatch.setattr("app.services.container.docker.from_env", lambda timeout: fake_client)

    manager = ContainerManager()
    manager._built_images.add("lector-challenge-sec-1:latest")

    tag = await manager.ensure_challenge_image("sec-1", "/tmp/sec-1")

    assert tag == "lector-challenge-sec-1:latest"
    assert fake_images.get_calls == []
    assert fake_images.build_calls == []


@pytest.mark.asyncio
async def test_spawn_container_uses_sandbox_limits(monkeypatch):
    fake_containers = FakeContainers()
    fake_client = SimpleNamespace(images=FakeImages(), containers=fake_containers)

    monkeypatch.setattr("app.services.container.docker.from_env", lambda timeout: fake_client)

    manager = ContainerManager()
    container = await manager.spawn_container("lector-challenge-sec-1:latest")

    assert container == {"container": "ok"}
    args, kwargs = fake_containers.run_calls[0]
    assert args == ("lector-challenge-sec-1:latest",)
    assert kwargs["detach"] is True
    assert kwargs["network_mode"] == "none"
    assert kwargs["mem_limit"] == "256m"
    assert kwargs["cpu_quota"] == 50000
    assert kwargs["pids_limit"] == 64
