#!/bin/bash
# Fast typecheck of just the changed file.
set -euo pipefail
INPUT=$(cat || true)
FILE_PATH=$(python3 -c "import sys,json
try:
  d = json.loads(sys.stdin.read() or '{}')
  print((d.get('tool_input') or {}).get('file_path') or '')
except Exception:
  print('')" <<< "$INPUT")

if [[ "$FILE_PATH" == *.ts || "$FILE_PATH" == *.tsx ]]; then
  cd "$(dirname "$0")/../.."
  # Fast, non-blocking: tsc --noEmit on the single file; errors inform but don't block.
  npx tsc --noEmit --skipLibCheck "$FILE_PATH" 2>&1 | head -20 || true
fi
exit 0
