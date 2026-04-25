# Path Traversal: Log Export

## Background

You're reviewing **Acme Corp's Operations Console**, an internal tool ops staff use to browse and download server log files for incident investigation. After signing in, the dashboard lists each available log file with an "Export" link that downloads its contents.

The deployment notes say this service runs from `/app`, stores exportable logs in `/app/logs`, and mounts application secrets at `/secrets/super-secret/flag.txt`.

## Your Mission

**Attack Phase**: Use the export feature to read a file *outside* the logs directory and capture the flag.

**Defend Phase** *(optional, after attack)*: Patch the source so the export route stays inside the logs directory, without breaking normal exports.

## What You're Looking At

The vulnerable application is a small Flask app. Start in `app.py` and find the route that handles file exports — pay close attention to how it builds the path it ultimately opens.

## Tips

- The export endpoint takes a `file` query parameter — try `/export?file=app.log` first to see normal behavior
- Think about what `Path(base) / user_input` does when `user_input` names a file outside the expected directory
- Once you suspect the bug, use the deployment notes to build a path from the logs directory to `/secrets/super-secret/flag.txt`
