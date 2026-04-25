"""
Docker container orchestration for sandboxed challenge execution.

Handles: build, spawn, patch application, test execution, cleanup.
"""

import asyncio
import logging
import tempfile
import re
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

    async def apply_patch(
        self, container: Container, patch: str, challenge_dir: str
    ) -> bool:
        """Apply a unified diff patch by patching source files on the host and copying them in."""
        try:
            updated_files = _apply_unified_diff(
                patch,
                Path(challenge_dir) / "code",
            )
        except Exception as exc:
            logger.warning("Failed to parse/apply patch: %s", exc)
            return False

        if not updated_files:
            logger.warning("Patch produced no file updates")
            return False

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: container.put_archive("/app", _make_tar_from_files(updated_files)),
        )
        return True

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


def _make_tar_from_files(files: dict[str, str]) -> bytes:
    import io
    import tarfile

    data = io.BytesIO()
    with tarfile.open(fileobj=data, mode="w") as tar:
        for relative_path, content in files.items():
            encoded = content.encode("utf-8")
            info = tarfile.TarInfo(name=relative_path)
            info.size = len(encoded)
            tar.addfile(info, io.BytesIO(encoded))
    data.seek(0)
    return data.read()


def _apply_unified_diff(patch: str, source_dir: Path) -> dict[str, str]:
    files: dict[str, list[tuple[int, list[str]]]] = {}
    current_file: str | None = None
    current_hunks: list[tuple[int, list[str]]] = []
    current_hunk_lines: list[str] = []
    current_old_start: int | None = None

    for line in patch.splitlines():
        if line.startswith("diff --git "):
            if current_file is not None:
                if current_old_start is not None:
                    current_hunks.append((current_old_start, current_hunk_lines))
                files[current_file] = current_hunks
            parts = line.split()
            current_file = parts[2][2:]
            current_hunks = []
            current_hunk_lines = []
            current_old_start = None
            continue

        if line.startswith("@@"):
            if current_old_start is not None:
                current_hunks.append((current_old_start, current_hunk_lines))
            match = re.match(r"@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@", line)
            if not match:
                raise ValueError(f"Unsupported hunk header: {line}")
            current_old_start = int(match.group(1))
            current_hunk_lines = []
            continue

        if current_old_start is not None and line[:1] in {" ", "+", "-"}:
            current_hunk_lines.append(line)

    if current_file is not None:
        if current_old_start is not None:
            current_hunks.append((current_old_start, current_hunk_lines))
        files[current_file] = current_hunks

    updated_files: dict[str, str] = {}
    for relative_path, hunks in files.items():
        resolved = (source_dir / relative_path).resolve()
        if source_dir.resolve() not in resolved.parents and resolved != source_dir.resolve():
            raise ValueError(f"Patch escapes challenge directory: {relative_path}")
        original_lines = resolved.read_text().splitlines()
        new_lines: list[str] = []
        cursor = 0

        for old_start, hunk_lines in hunks:
            target_index = old_start - 1
            new_lines.extend(original_lines[cursor:target_index])
            cursor = target_index

            for hunk_line in hunk_lines:
                marker = hunk_line[0]
                content = hunk_line[1:]
                if marker == " ":
                    if cursor >= len(original_lines) or original_lines[cursor] != content:
                        raise ValueError(f"Context mismatch while applying patch to {relative_path}")
                    new_lines.append(original_lines[cursor])
                    cursor += 1
                elif marker == "-":
                    if cursor >= len(original_lines) or original_lines[cursor] != content:
                        raise ValueError(f"Removal mismatch while applying patch to {relative_path}")
                    cursor += 1
                elif marker == "+":
                    new_lines.append(content)

        new_lines.extend(original_lines[cursor:])
        updated_files[relative_path] = "\n".join(new_lines) + "\n"

    return updated_files


_manager: ContainerManager | None = None


def get_container_manager() -> ContainerManager:
    global _manager
    if _manager is None:
        _manager = ContainerManager()
    return _manager
