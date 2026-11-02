# Environment (Day 0 verification record)

**Date verified:** 2026-11-02
**Build host:** this cloud session (Claude Code container)
**Verified by:** autonomous Day 0 pass

## Runtime
- Node: v22.23.4
- npm: 10.9.9
- git: 2.43.0
- gh: 2.89.0

## Pinned versions
- three: ^0.187.0 (current stable per `npm view three version`)
- vite: ^8.3.5
- vitest: ^5.1.0
- @playwright/test: ^1.64.1
- Chromium: pre-installed in container at /opt/playwright-browsers; `playwright install` not needed

## Claude Code features
This container uses standard Claude Code with autonomous subagents. For a future local run on Jon's Mac, re-verify these per `07_DAY_0_TOOLING_VERIFICATION.md`:
- `/goal` loop: not required for this cloud session (orchestrator model drives directly)
- `--worktree` flag: not used (serialized subagent work here)
- Agent frontmatter: standard `name/description/tools/model` fields only; hooks live in `.claude/settings.json`
- MCP: `.mcp.json` declares Playwright; add others as needed
- Fallback mode: reviewer-subagent audit for scope enforcement; see `.claude/hooks/scope-guard.sh`

## MCP connectors available in this session
- Apify, Gmail, Google Calendar, Drive, Sheets, Granola, Tavily, Racecraft (not needed for this build)

## MCP not connected (will add if/when needed)
- GitHub: using `gh` CLI + user PAT (works)
- Cloudflare: using Wrangler CLI + user API token (works)
- Supabase: deferred to L5
- Playwright MCP: declared in `.mcp.json`; CLI alternative sufficient for the headless flow we use

## Fixed-seed convention
`src/debug/seeds.ts`:
- `DEV_SEED = "chunksmith-dev-001"` — all dev chunks
- `E2E_SEED = "chunksmith-e2e-fixed"` — all Playwright tests
- `DEMO_SEED = "chunksmith-demo-v1"` — the shipped demo world (stable URL)

## Deployment target
Cloudflare Pages via Wrangler CLI (CLOUDFLARE_API_TOKEN env var).

## Known limits
- No in-chat browser I can "look at" the game with — all visual verification via Playwright screenshots + Jon's manual playtests at Day 3/5/7.
- Container is ephemeral; the GitHub remote is the source of truth.
