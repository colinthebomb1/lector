# Agent Integration

Lector exposes its existing grader as both:

- an MCP server for agent tool use
- a tiny CLI wrapper for local verification demos

This repo also includes a ready-to-use `mcp.json` at the repo root.

## MCP server

Install backend dependencies, then run the MCP server from the `backend/` directory:

```bash
./.venv/bin/python -m app.mcp_server
```

Available tools:

- `list_lector_challenges(track?)`
- `lector_verify(challenge_id, patch)`

`lector_verify` accepts a challenge ID plus a unified diff patch string and returns the same grading result shape used by the app backend.

### Repo config

The repo root includes an `mcp.json` entry named `lector` that launches:

```bash
./.venv/bin/python -m app.mcp_server
```

with `cwd` set to `./backend` so challenge loading and env-file resolution work as expected without hardcoding a local machine path.

## CLI wrapper

For local terminal demos, run:

```bash
cd backend
./.venv/bin/python -m app.verify_cli verify \
  --challenge sqli-login-bypass \
  --patch-file /tmp/fix.diff
```

Exit codes:

- `0`: patch passed
- `1`: patch graded but failed
- `2`: bad input, such as a missing patch file
