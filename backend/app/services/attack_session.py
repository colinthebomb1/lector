"""
Attack session manager — spins up vulnerable app containers for the attack phase.

Unlike the grader (which spawns ephemeral containers for patch testing), attack
sessions keep containers alive so users can interact with the running app via
a proxied browser view.
"""

import asyncio
import logging
import time
from dataclasses import dataclass, field

import docker
from docker.models.containers import Container

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class AttackSession:
    session_id: str
    challenge_id: str
    container_id: str
    port: int
    created_at: float = field(default_factory=time.time)


_sessions: dict[str, AttackSession] = {}
_client: docker.DockerClient | None = None


def _get_docker() -> docker.DockerClient:
    global _client
    if _client is None:
        settings = get_settings()
        _client = docker.from_env(timeout=settings.container_timeout)
    return _client


async def start_attack_session(
    user_session_id: str,
    challenge_id: str,
    challenge_base_path: str,
) -> AttackSession:
    """Build and start the vulnerable app container, return an AttackSession."""
    session_key = f"{user_session_id}:{challenge_id}"
    if session_key in _sessions:
        existing = _sessions[session_key]
        try:
            c = _get_docker().containers.get(existing.container_id)
            if c.status == "running":
                return existing
        except docker.errors.NotFound:
            pass
        del _sessions[session_key]

    client = _get_docker()
    image_tag = f"lector-challenge-{challenge_id}:latest"
    loop = asyncio.get_event_loop()

    try:
        await loop.run_in_executor(None, lambda: client.images.get(image_tag))
    except docker.errors.ImageNotFound:
        logger.info("Building image %s from %s", image_tag, challenge_base_path)
        await loop.run_in_executor(
            None,
            lambda: client.images.build(path=challenge_base_path, tag=image_tag, rm=True),
        )

    container = await loop.run_in_executor(
        None,
        lambda: client.containers.run(
            image_tag,
            detach=True,
            ports={"5000/tcp": None},
            mem_limit="256m",
            cpu_period=100000,
            cpu_quota=50000,
            pids_limit=64,
            auto_remove=True,
        ),
    )

    container.reload()
    port_bindings = container.attrs["NetworkSettings"]["Ports"].get("5000/tcp")
    if not port_bindings:
        raise RuntimeError("Container started but no port binding found")
    host_port = int(port_bindings[0]["HostPort"])

    await _wait_for_ready(host_port, timeout=15)

    attack_session = AttackSession(
        session_id=user_session_id,
        challenge_id=challenge_id,
        container_id=container.id,
        port=host_port,
    )
    _sessions[session_key] = attack_session
    logger.info(
        "Attack session started: user=%s challenge=%s port=%d container=%s",
        user_session_id, challenge_id, host_port, container.short_id,
    )
    return attack_session


async def _wait_for_ready(port: int, timeout: int = 15) -> None:
    """Poll the container until it responds on the mapped port."""
    import httpx

    deadline = time.time() + timeout
    async with httpx.AsyncClient() as client:
        while time.time() < deadline:
            try:
                r = await client.get(f"http://localhost:{port}/login", timeout=2)
                if r.status_code in (200, 302):
                    return
            except Exception:
                pass
            await asyncio.sleep(0.5)
    raise TimeoutError(f"Container on port {port} not ready within {timeout}s")


def get_attack_session(user_session_id: str, challenge_id: str) -> AttackSession | None:
    return _sessions.get(f"{user_session_id}:{challenge_id}")


async def stop_attack_session(user_session_id: str, challenge_id: str) -> bool:
    session_key = f"{user_session_id}:{challenge_id}"
    attack_session = _sessions.pop(session_key, None)
    if not attack_session:
        return False

    client = _get_docker()
    loop = asyncio.get_event_loop()
    try:
        container = await loop.run_in_executor(
            None, lambda: client.containers.get(attack_session.container_id)
        )
        await loop.run_in_executor(None, lambda: container.kill())
    except Exception:
        pass
    return True


async def cleanup_all_sessions() -> None:
    """Kill all attack containers — called on shutdown."""
    for key in list(_sessions.keys()):
        parts = key.split(":", 1)
        if len(parts) == 2:
            await stop_attack_session(parts[0], parts[1])
