"""
Attack phase endpoints — manage attack sessions and proxy to vulnerable app containers.

Flow:
1. POST /api/attack/{challenge_id}/start  → spin up container, return session info
2. ANY  /api/attack/{challenge_id}/proxy  → proxy requests to the running container
3. POST /api/attack/{challenge_id}/flag   → validate the captured flag
4. POST /api/attack/{challenge_id}/stop   → tear down the container
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app.database import get_db, is_db_connected
from app.models import Submission, SubmissionType, GradeResult, GradeStatus
from app.routers.auth import require_session
from app.services.attack_session import (
    start_attack_session,
    get_attack_session,
    stop_attack_session,
    record_payload,
    get_payloads,
)
from app.services.challenge_loader import get_challenge
from app.services.gemma import generate_attack_hint

router = APIRouter(prefix="/api/attack", tags=["attack"])


class FlagSubmitRequest(BaseModel):
    flag: str


@router.post("/{challenge_id}/start")
async def start_attack(challenge_id: str, user: dict = Depends(require_session)):
    """Start an attack session — spins up the vulnerable app container."""
    challenge = get_challenge(challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    if not challenge.base_path:
        raise HTTPException(status_code=400, detail="Challenge has no container config")

    try:
        session = await start_attack_session(
            user_session_id=user["session_id"],
            challenge_id=challenge_id,
            challenge_base_path=challenge.base_path,
        )
    except TimeoutError:
        raise HTTPException(status_code=504, detail="Container failed to start in time")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to start attack session: {e}")

    return {
        "status": "running",
        "challenge_id": challenge_id,
        "port": session.port,
        "proxy_base": f"/api/attack/{challenge_id}/proxy",
    }


@router.post("/{challenge_id}/stop")
async def stop_attack(challenge_id: str, user: dict = Depends(require_session)):
    """Stop an attack session — tears down the container."""
    stopped = await stop_attack_session(user["session_id"], challenge_id)
    if not stopped:
        raise HTTPException(status_code=404, detail="No active attack session")
    return {"status": "stopped"}


@router.post("/{challenge_id}/flag")
async def submit_flag(
    challenge_id: str, body: FlagSubmitRequest, user: dict = Depends(require_session)
):
    """Validate a captured flag."""
    challenge = get_challenge(challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    expected_flag = challenge.metadata.flag
    if not expected_flag:
        raise HTTPException(status_code=400, detail="Challenge has no flag configured")

    passed = body.flag.strip() == expected_flag.strip()

    if is_db_connected():
        submission = Submission(
            user_id=user["session_id"],
            challenge_id=challenge_id,
            submission_type=SubmissionType.FLAG,
            payload={"flag": body.flag},
            result=GradeResult(
                status=GradeStatus.PASSED if passed else GradeStatus.FAILED,
                message="Flag accepted!" if passed else "Incorrect flag.",
            ),
        )
        db = get_db()
        await db.submissions.insert_one(submission.model_dump())

        if passed:
            await db.users.update_one(
                {"session_id": user["session_id"]},
                {
                    "$addToSet": {"challenges_completed": f"{challenge_id}:attack"},
                    "$inc": {"total_score": 50},
                },
            )

    return {
        "accepted": passed,
        "message": "Flag accepted! You've exploited the vulnerability." if passed else "Incorrect flag. Keep trying!",
    }


@router.post("/{challenge_id}/hint")
async def request_attack_hint(
    challenge_id: str, user: dict = Depends(require_session)
):
    """Generate an AI hint based on the user's attempted payloads."""
    challenge = get_challenge(challenge_id)
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")

    session = get_attack_session(user["session_id"], challenge_id)
    if not session:
        raise HTTPException(
            status_code=404,
            detail="No active attack session. Start one first.",
        )

    payloads = get_payloads(user["session_id"], challenge_id)
    payload_dicts = [
        {
            "path": p.path,
            "method": p.method,
            "form_data": p.form_data,
            "response_status": p.response_status,
        }
        for p in payloads
    ]

    vuln_code = ""
    for filename, content in challenge.code_files.items():
        vuln_code += f"# --- {filename} ---\n{content}\n\n"

    hint_tiers = [t.model_dump() for t in challenge.metadata.hint_tiers]

    result = await generate_attack_hint(
        challenge_name=challenge.metadata.name,
        scenario=challenge.scenario,
        vulnerable_code=vuln_code,
        hint_tiers=hint_tiers,
        attempted_payloads=payload_dicts,
    )

    return {
        "hint": result.get("hint", result.get("text", "")),
        "analysis": result.get("analysis", ""),
        "attempts_analyzed": len(payload_dicts),
    }


@router.get("/{challenge_id}/payloads")
async def get_payload_history(
    challenge_id: str, user: dict = Depends(require_session)
):
    """Return the user's attempted payloads for this attack session."""
    payloads = get_payloads(user["session_id"], challenge_id)
    return {
        "challenge_id": challenge_id,
        "count": len(payloads),
        "payloads": [
            {
                "path": p.path,
                "method": p.method,
                "form_data": p.form_data,
                "response_status": p.response_status,
                "timestamp": p.timestamp,
            }
            for p in payloads
        ],
    }


@router.api_route(
    "/{challenge_id}/proxy/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_to_container(
    challenge_id: str, path: str, request: Request, user: dict = Depends(require_session)
):
    """Reverse-proxy requests to the vulnerable app container."""
    session = get_attack_session(user["session_id"], challenge_id)
    if not session:
        raise HTTPException(
            status_code=404,
            detail="No active attack session. Start one first via POST /api/attack/{challenge_id}/start",
        )

    target_url = f"http://localhost:{session.port}/{path}"
    if request.url.query:
        target_url += f"?{request.url.query}"

    body = await request.body()
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "connection", "transfer-encoding")
    }

    async with httpx.AsyncClient(follow_redirects=False, timeout=10) as client:
        try:
            resp = await client.request(
                method=request.method,
                url=target_url,
                headers=headers,
                content=body,
            )
        except httpx.ConnectError:
            raise HTTPException(status_code=502, detail="Container app not responding")

    if request.method == "POST" and body:
        content_type = request.headers.get("content-type", "")
        form_data: dict[str, str] = {}
        if "application/x-www-form-urlencoded" in content_type:
            from urllib.parse import parse_qs
            for k, v in parse_qs(body.decode("utf-8", errors="replace")).items():
                form_data[k] = v[0] if v else ""
        elif "application/json" in content_type:
            import json
            try:
                form_data = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                pass
        if form_data:
            record_payload(
                user["session_id"], challenge_id, path, request.method,
                form_data, resp.status_code,
            )

    excluded_headers = {"transfer-encoding", "content-encoding", "content-length"}
    response_headers = {
        k: v for k, v in resp.headers.items()
        if k.lower() not in excluded_headers
    }

    if resp.status_code in (301, 302, 303, 307, 308):
        location = resp.headers.get("location", "")
        if location.startswith("/"):
            location = f"/api/attack/{challenge_id}/proxy{location}"
        response_headers["location"] = location

    return Response(
        content=resp.content,
        status_code=resp.status_code,
        headers=response_headers,
    )


@router.api_route("/{challenge_id}/proxy", methods=["GET", "POST"])
async def proxy_root(
    challenge_id: str, request: Request, user: dict = Depends(require_session)
):
    """Proxy to the container root path."""
    return await proxy_to_container(challenge_id, "", request, user)
