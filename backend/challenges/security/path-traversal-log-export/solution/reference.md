# Reference Summary

This is a small Flask web app that gives operations staff a UI for browsing and downloading server log files. After signing in with a hardcoded `ops` / `ops123` service account, the dashboard lists the files inside `code/logs/` and offers an "Export" link for each. The export route, `GET /export`, takes a `file` query parameter and streams the contents of the matching file under the logs directory.

## Vulnerability

The export route builds the target path by joining the user-controlled query parameter onto the base logs directory:

```python
target = LOGS_DIR / requested
contents = target.read_text(encoding="utf-8", errors="replace")
```

The route tries to clean the input by removing the literal substring `../`, but it still does not canonicalize the final path or check containment. A crafted segment like `....//` becomes `../` after that replacement, so the final path can still escape the logs directory.

## Exploit

The app runs from `/app`, the logs directory is `/app/logs`, and the deployment notes identify the flag location as `/secrets/super-secret/flag.txt`. Hitting `/export?file=....//....//secrets/super-secret/flag.txt` while logged in survives the replacement as `../../secrets/super-secret/flag.txt`, walks from `/app/logs` to `/`, and then returns the flag from the secrets mount.

## Fix

Canonicalize the candidate path and verify it stays under the allowed base directory before opening:

```python
candidate = (LOGS_DIR / requested).resolve()
base = LOGS_DIR.resolve()
if base != candidate and base not in candidate.parents:
    abort(403, "Forbidden path")
contents = candidate.read_text(encoding="utf-8", errors="replace")
```

Alternatives include checking `requested` against an explicit allow-list of known log filenames, or rejecting path separators and parent-directory segments before resolving the final path.
