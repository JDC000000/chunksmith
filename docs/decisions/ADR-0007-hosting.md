# ADR-0007: Hosting — Cloudflare Pages via GitHub integration
**Status:** Accepted
**Date:** 2026-11-02

## Context
L2 ships to a public URL. Options: Vercel, Netlify, Cloudflare Pages, GitHub Pages. We also want preview URLs per PR, and headroom to add PartyKit (Cloudflare Durable Objects) for L5 multiplayer. The cloud session that builds this project cannot reach `api.cloudflare.com` through its agent proxy, so any deploy via `wrangler` CLI from this session is blocked.

## Decision
**Cloudflare Pages, connected to the GitHub repo via Pages' built-in Git integration. Builds and deploys run on Cloudflare's infrastructure, triggered by every push to `main` (production) or any PR (preview URL per branch).**

Setup is a one-time 3-minute click-through on Cloudflare's dashboard — see `docs/DEPLOY.md`.

## Consequences
**Positive**
- Zero deploy credentials in CI or in this cloud session — Cloudflare owns the token
- Preview URLs per PR for free → external playtesters get isolated builds
- Global edge, generous free tier, same org we'd use for PartyKit at L5
- COOP/COEP via `public/_headers` — SharedArrayBuffer in L3+ workers works without extra config
- Rollback is one click in the Pages dashboard

**Negative**
- Jon has to click once in CF dashboard to connect the repo (3 min) — not fully hands-off on day 7
- Build runs on CF infra, not ours → debug happens via CF logs (less convenient than local)
- `wrangler pages deploy` from this session is blocked by proxy; if we need it later, Jon has to allowlist `api.cloudflare.com` in claude.ai Settings → Capabilities

## Rejected alternatives

### Vercel
- Comparable features, has an MCP server
- No cost advantage over CF Pages
- CF Pages ties better into our L5 PartyKit plan
- Rejected on org-consistency grounds

### Netlify
- Fine third option
- No L5 multiplayer story equivalent
- Rejected

### GitHub Pages
- Free, no extra account
- No `_headers` file support → cannot set COOP/COEP → `SharedArrayBuffer` is undefined → L3 worker meshing falls back to Transferable copies (slower)
- No per-PR preview URLs
- Rejected on the COOP/COEP constraint

### Deploy from this cloud session via wrangler CLI
- Blocked: agent proxy denies `api.cloudflare.com:443` (403 on CONNECT)
- Jon could unblock it in Settings → Capabilities, but then every voxel deploy needs this session alive and connected to his CF account
- Rejected

## Verification
Day 7 acceptance:
- `main` branch deploy succeeds on CF Pages → public URL loads
- Preview URL exists for the Day 7 PR
- COOP/COEP headers present at the root (`curl -I https://chunksmith.pages.dev` shows both)
- Full Playwright suite passes against the deployed URL (not just localhost)

## Cost of change
Switching to Vercel or Netlify later = 5 min of dashboard clicks. The `public/_headers` file format differs (Netlify uses `netlify.toml`; Vercel uses `vercel.json`) — add the matching file, remove `_headers`, repoint DNS. No code changes.
