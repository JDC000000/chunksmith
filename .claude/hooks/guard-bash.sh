#!/bin/bash
# Block destructive commands before they execute.
set -euo pipefail
INPUT=$(cat || true)
COMMAND=$(python3 -c "import sys,json
try:
  d = json.loads(sys.stdin.read() or '{}')
  print((d.get('tool_input') or {}).get('command') or '')
except Exception:
  print('')" <<< "$INPUT")

if echo "$COMMAND" | grep -qE 'rm -rf /|rm -rf \~|rm -rf \*|git reset --hard origin|git push -f +|git push --force|chmod -R 777|:(){ :\|:& };:|dd if='; then
  echo "guard-bash: refusing dangerous command" >&2
  exit 2
fi
exit 0
