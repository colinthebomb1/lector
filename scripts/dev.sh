#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/Frontend"
BACKEND_ENV="$BACKEND_DIR/.env"

MONGO_CONTAINER="${MONGO_CONTAINER:-lector-local-mongo}"
MONGO_PORT="${MONGO_PORT:-27017}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-80}"

PUBLIC_HOST="${PUBLIC_HOST:-${LOCAL_HOST:-lector.work}}"
BACKEND_BIND_HOST="${BACKEND_BIND_HOST:-localhost}"
BACKEND_URL="http://${PUBLIC_HOST}:${BACKEND_PORT}"
FRONTEND_URL="http://${PUBLIC_HOST}:${FRONTEND_PORT}"

BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
  if [[ -n "$FRONTEND_PID" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

env_mongo_url() {
  if [[ -n "${LECTOR_MONGO_URL:-}" ]]; then
    printf '%s\n' "$LECTOR_MONGO_URL"
    return 0
  fi

  if [[ -f "$BACKEND_ENV" ]]; then
    sed -n 's/^LECTOR_MONGO_URL=[[:space:]]*//p' "$BACKEND_ENV" | tail -n 1 | tr -d '"'
  fi
}

uses_remote_mongo() {
  local mongo_url
  mongo_url="$(env_mongo_url)"
  [[ "$mongo_url" == mongodb+srv://* || "$mongo_url" == *mongodb.net* ]]
}

frontend_dev_command() {
  if (( FRONTEND_PORT < 1024 )) && [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    require_cmd sudo
    echo "Port ${FRONTEND_PORT} needs elevated bind permission; sudo will be used for the frontend only."
    sudo env \
      "PATH=$PATH" \
      "HOME=$HOME" \
      "VITE_API_URL=$BACKEND_URL" \
      npm run dev -- --strictPort
  else
    VITE_API_URL="$BACKEND_URL" npm run dev -- --strictPort
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  for _ in {1..60}; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$label is ready: $url"
      return 0
    fi
    sleep 0.5
  done
  echo "$label did not become ready: $url" >&2
  return 1
}

stop_port() {
  local port="$1"
  local label="$2"
  local pids=""

  if command -v fuser >/dev/null 2>&1; then
    pids="$(fuser -n tcp "$port" 2>/dev/null || true)"
  elif command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  fi

  if [[ -z "$pids" ]]; then
    return 0
  fi

  echo "Stopping existing ${label} process on port ${port}: ${pids}"
  for pid in $pids; do
    if [[ "$pid" != "$$" ]]; then
      kill "$pid" 2>/dev/null || true
    fi
  done

  for _ in {1..20}; do
    if ! ss -ltn 2>/dev/null | grep -q ":${port} "; then
      return 0
    fi
    sleep 0.2
  done

  echo "Force-stopping stubborn ${label} process on port ${port}: ${pids}"
  for pid in $pids; do
    if [[ "$pid" != "$$" ]]; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
}

start_local_mongo() {
  require_cmd docker

  if ! docker ps --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
    if docker ps -a --format '{{.Names}}' | grep -qx "$MONGO_CONTAINER"; then
      echo "Starting existing MongoDB container: $MONGO_CONTAINER"
      docker start "$MONGO_CONTAINER" >/dev/null
    else
      echo "Creating MongoDB container: $MONGO_CONTAINER"
      docker run -d \
        --name "$MONGO_CONTAINER" \
        -p "127.0.0.1:${MONGO_PORT}:27017" \
        mongo:7 >/dev/null
    fi
  else
    echo "MongoDB container already running: $MONGO_CONTAINER"
  fi

  echo "Waiting for MongoDB on localhost:${MONGO_PORT}..."
  for _ in {1..60}; do
    if docker exec "$MONGO_CONTAINER" mongosh --quiet --eval 'db.runCommand({ ping: 1 }).ok' >/dev/null 2>&1; then
      echo "MongoDB is ready."
      return 0
    fi
    sleep 0.5
  done

  echo "MongoDB did not become ready on localhost:${MONGO_PORT}" >&2
  return 1
}

require_cmd curl

if [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
fi
require_cmd node
require_cmd npm

stop_port "$BACKEND_PORT" "backend"
stop_port "$FRONTEND_PORT" "frontend"

if uses_remote_mongo; then
  echo "Using configured remote MongoDB/Atlas URL from environment or backend/.env."
else
  start_local_mongo
fi

echo "Starting backend on ${BACKEND_URL}"
(
  cd "$BACKEND_DIR"
  LECTOR_CHALLENGES_DIR="challenges" \
  "$BACKEND_DIR/.venv/bin/python" -m uvicorn app.main:app \
    --host "$BACKEND_BIND_HOST" \
    --port "$BACKEND_PORT" \
    --reload
) &
BACKEND_PID="$!"

wait_for_url "${BACKEND_URL}/api/health" "Backend"

echo "Starting frontend on ${FRONTEND_URL}"
(
  cd "$FRONTEND_DIR"
  frontend_dev_command
) &
FRONTEND_PID="$!"

wait_for_url "$FRONTEND_URL" "Frontend"

echo
echo "Lector dev stack is running."
echo "Frontend: $FRONTEND_URL"
echo "Backend:  $BACKEND_URL"
if uses_remote_mongo; then
  echo "MongoDB:  configured remote MongoDB/Atlas connection"
else
  echo "MongoDB:  mongodb://localhost:${MONGO_PORT}"
fi
echo
echo "Press Ctrl+C to stop backend and frontend. Local MongoDB, if used, stays running for reuse."

wait
