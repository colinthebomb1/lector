"""
Small local CLI wrapper around the shared Lector grader.

Run from the backend directory:
    python -m app.verify_cli verify --challenge sqli-login-bypass --patch-file /tmp/fix.diff
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.mcp_server import verify_patch


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="closeread")
    subparsers = parser.add_subparsers(dest="command", required=True)

    verify_parser = subparsers.add_parser(
        "verify",
        help="Grade a patch against a Lector challenge.",
    )
    verify_parser.add_argument(
        "--challenge",
        required=True,
        help="Challenge ID, for example sqli-login-bypass.",
    )
    verify_parser.add_argument(
        "--patch-file",
        required=True,
        help="Path to a unified diff patch file.",
    )
    return parser


async def _run_verify(challenge_id: str, patch_file: str) -> int:
    patch_path = Path(patch_file)
    if not patch_path.exists():
        print(f"Patch file not found: {patch_path}", file=sys.stderr)
        return 2

    result = await verify_patch(challenge_id, patch_path.read_text(encoding="utf-8"))
    print(json.dumps(result.model_dump(), indent=2))
    return 0 if result.status == "passed" else 1


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    if args.command == "verify":
        return asyncio.run(_run_verify(args.challenge, args.patch_file))

    parser.error(f"Unsupported command: {args.command}")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
