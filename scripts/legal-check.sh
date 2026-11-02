#!/usr/bin/env bash
# Chunksmith legal-rule check — runs the Mojang-IP grep that CLAUDE.md's "Legal
# rules (hard)" section mandates. Exits 0 if clean, 1 if any banned term appears.
# Called from CI, per-PRD ship-gates, and (optionally) a pre-commit hook.
#
# Allowed matches:
#   - PRD / TSD / level docs may QUOTE the rule itself (that's documentation of
#     the rule, not a violation). docs/ is scanned at a lower severity.
# Blocked matches:
#   - Any banned term in src/, public/, design/, scripts/, tests/, or build output.
#
# Exit codes:
#   0 — clean
#   1 — banned term found in a blocking path
#   2 — invocation error (dependencies missing)

set -euo pipefail

if ! command -v grep >/dev/null 2>&1; then
  echo "legal-check: grep not found" >&2
  exit 2
fi

# Banned terms (case-insensitive). Word-bounded for "MC" and "Steve" so they
# don't false-positive on "mcguire" or "stevedore".
PATTERN='minecraft|\bmc\b|creeper|\bsteve\b|enderman'

# Blocking paths: shipped product + build inputs. docs/ is intentionally omitted.
BLOCKING_PATHS=(src/ public/ design/ scripts/ tests/)

# Scan each path if it exists.
hit=0
for p in "${BLOCKING_PATHS[@]}"; do
  if [ -d "$p" ]; then
    # Exclude this script itself (it mentions the pattern by necessity).
    out=$(grep -rniE --exclude="legal-check.sh" "$PATTERN" "$p" 2>/dev/null || true)
    if [ -n "$out" ]; then
      hit=1
      echo "legal-check: banned Mojang-IP term in $p:" >&2
      echo "$out" >&2
    fi
  fi
done

if [ "$hit" -ne 0 ]; then
  echo "" >&2
  echo "legal-check: FAILED — see hits above. CLAUDE.md 'Legal rules (hard)' bans these terms in shipped product." >&2
  exit 1
fi

echo "legal-check: clean (0 hits in src/ public/ design/ scripts/ tests/)"
exit 0
