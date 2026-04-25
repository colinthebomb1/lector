"""
Docker container orchestration for sandboxed challenge execution.

Handles: build, spawn, patch application, test execution, cleanup.
"""

import asyncio
import logging
import tempfile
from pathlib import Path
from dataclasses import dataclass

import docker
from docker.models.containers import Container

from app.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class TestResult:
    passed: bool
    output: str
    exit_code: int
    elapsed_seconds: float = 0.0


class ContainerManager:
    def __init__(self) -> None:
        settings = get_settings()
        self._client = docker.from_env(timeout=settings.container_timeout)
        self._built_images: set[str] = set()

    def build_challenge_image(self, challenge_id: str, challenge_dir: str) -> str:
        """Build (or cache) the Docker image for a challenge. Returns image tag."""
        tag = f"lector-challenge-{challenge_id}:latest"
        self._client.images.build(path=challenge_dir, tag=tag, rm=True)
        self._built_images.add(tag)
        return tag

    async def ensure_challenge_image(self, challenge_id: str, challenge_dir: str) -> str:
        """Ensure the image exists before a grading run."""
        tag = f"lector-challenge-{challenge_id}:latest"
        if tag in self._built_images:
            return tag

        loop = asyncio.get_event_loop()

        try:
            await loop.run_in_executor(None, lambda: self._client.images.get(tag))
        except docker.errors.ImageNotFound:
            logger.info("Building challenge image %s", tag)
            await loop.run_in_executor(
                None, lambda: self.build_challenge_image(challenge_id, challenge_dir)
            )
        else:
            self._built_images.add(tag)

        return tag

    async def spawn_container(self, image_tag: str) -> Container:
        """Spin up a fresh container from a challenge image."""
        loop = asyncio.get_event_loop()
        container = await loop.run_in_executor(
            None,
            lambda: self._client.containers.run(
                image_tag,
                detach=True,
                network_mode="none",
                mem_limit="256m",
                cpu_period=100000,
                cpu_quota=50000,  # 50% of one core
                pids_limit=64,
            ),
        )
        return container

    async def apply_patch(self, container: Container, patch: str) -> bool:
        """Apply a unified diff patch inside the container."""
        with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
            f.write(patch)
            f.flush()
            patch_path = f.name

        loop = asyncio.get_event_loop()

        await loop.run_in_executor(
            None,
            lambda: container.put_archive("/tmp", _make_tar(patch_path, "fix.patch")),
        )

        exit_code, output = await loop.run_in_executor(
            None,
            lambda: container.exec_run("git apply /tmp/fix.patch", workdir="/app"),
        )

        Path(patch_path).unlink(missing_ok=True)
        return exit_code == 0

    async def run_test(
        self, container: Container, test_path: str, timeout: int = 10
    ) -> TestResult:
        """Run a pytest file inside the container and return results."""
        import time

        loop = asyncio.get_event_loop()
        start = time.monotonic()

        try:
            exit_code, output = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: container.exec_run(
                        f"python -m pytest {test_path} -v --tb=short",
                        workdir="/app",
                    ),
                ),
                timeout=timeout,
            )
        except asyncio.TimeoutError:
            return TestResult(
                passed=False,
                output="Test timed out",
                exit_code=-1,
                elapsed_seconds=timeout,
            )

        elapsed = time.monotonic() - start
        return TestResult(
            passed=exit_code == 0,
            output=output.decode("utf-8", errors="replace") if isinstance(output, bytes) else str(output),
            exit_code=exit_code,
            elapsed_seconds=elapsed,
        )

    async def restart_app(self, container: Container) -> None:
        """Restart the application process inside the container."""
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: container.restart(timeout=5))

    async def kill_container(self, container: Container) -> None:
        """Kill and remove a container."""
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, container.kill)
        except Exception:
            pass
        try:
            await loop.run_in_executor(None, lambda: container.remove(force=True))
        except Exception:
            pass


def _make_tar(file_path: str, arcname: str) -> bytes:
    """Create an in-memory tar archive from a single file."""
    import io
    import tarfile

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        tar.add(file_path, arcname=arcname)
    buf.seek(0)
    return buf.read()


_manager: ContainerManager | None = None


def get_container_manager() -> ContainerManager:
    global _manager
    if _manager is None:
        _manager = ContainerManager()
    return _manager
