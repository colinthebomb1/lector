import json
from pathlib import Path

from app.config import get_settings
from app.models import Challenge, ChallengeMetadata

_challenges: dict[str, Challenge] = {}


def load_challenges() -> dict[str, Challenge]:
    """Walk the challenges/ directory tree and load all challenges into memory."""
    global _challenges
    _challenges = {}

    base = Path(get_settings().challenges_dir)
    if not base.exists():
        return _challenges

    for track_dir in base.iterdir():
        if not track_dir.is_dir():
            continue
        for challenge_dir in track_dir.iterdir():
            if not challenge_dir.is_dir():
                continue
            meta_path = challenge_dir / "metadata.json"
            if not meta_path.exists():
                continue

            try:
                metadata = ChallengeMetadata(**json.loads(meta_path.read_text()))
            except Exception:
                continue

            scenario = ""
            scenario_path = challenge_dir / "scenario.md"
            if scenario_path.exists():
                scenario = scenario_path.read_text()

            code_files: dict[str, str] = {}
            code_dir = challenge_dir / "code"
            if code_dir.exists():
                for f in code_dir.rglob("*"):
                    if f.is_file() and f.suffix not in (".db", ".sqlite", ".sqlite3", ".pyc", ".so", ".o"):
                        try:
                            code_files[str(f.relative_to(code_dir))] = f.read_text()
                        except UnicodeDecodeError:
                            continue

            ref_summary = ""
            ref_path = challenge_dir / "solution" / "reference.md"
            if ref_path.exists():
                ref_summary = ref_path.read_text()

            dockerfile = ""
            df_path = challenge_dir / "Dockerfile"
            if df_path.exists():
                dockerfile = str(df_path)

            challenge = Challenge(
                metadata=metadata,
                scenario=scenario,
                code_files=code_files,
                reference_summary=ref_summary,
                dockerfile_path=dockerfile,
                base_path=str(challenge_dir),
            )
            _challenges[metadata.id] = challenge

    return _challenges


def get_challenge(challenge_id: str) -> Challenge | None:
    return _challenges.get(challenge_id)


def list_challenges() -> list[Challenge]:
    return list(_challenges.values())
