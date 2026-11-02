#!/bin/bash
# Usage: scope-guard.sh <agent-name>
# Reads JSON tool input from stdin, exits 2 if file_path is outside the agent's scope.
set -euo pipefail
AGENT=${1:-${CLAUDE_SUBAGENT_NAME:-unknown}}
INPUT=$(cat || true)
FILE_PATH=$(python3 -c "import sys,json
try:
  d = json.loads(sys.stdin.read() or '{}')
  print((d.get('tool_input') or {}).get('file_path') or '')
except Exception:
  print('')" <<< "$INPUT")

# Empty path = can't inspect; allow through, let tool handle it.
if [ -z "$FILE_PATH" ]; then exit 0; fi

case "$AGENT" in
  planner)         ALLOWED='docs/' ;;
  game-designer)   ALLOWED='design/' ;;
  qa-playtester)   ALLOWED='tests/|docs/playtest/' ;;
  voxel-engine-dev) ALLOWED='src/world/|src/mesh/|src/render/|tests/unit/(chunk|mesher|world)' ;;
  terrain-generator) ALLOWED='src/gen/|src/core/rng|tests/unit/(terrain|rng)' ;;
  physics-dev)     ALLOWED='src/player/|tests/unit/(player|collision|raycast)' ;;
  ui-dev)          ALLOWED='src/ui/|tests/unit/ui|tests/e2e/ui' ;;
  reviewer)        ALLOWED='^$' ;; # read-only; block all writes
  perf-tuner)      ALLOWED='\.claude/agent-memory/perf-tuner/|docs/perf/' ;;
  asset-pipeline)  ALLOWED='public/|src/render/loaders/' ;;
  devops)          ALLOWED='vercel\.json|wrangler\.toml|public/_headers|public/manifest|public/sw|vite\.config' ;;
  *)
    echo "scope-guard: unknown agent '$AGENT' — allowing (configure in .claude/hooks/scope-guard.sh)" >&2
    exit 0
    ;;
esac

if echo "$FILE_PATH" | grep -qE "$ALLOWED"; then
  exit 0
else
  echo "scope-guard: subagent '$AGENT' cannot write '$FILE_PATH' (allowed pattern: $ALLOWED)" >&2
  exit 2
fi
