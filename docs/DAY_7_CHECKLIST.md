# Day 7 — Public deploy checklist (Jon's 15 min)

Everything you need to do once, in order, to put Chunksmith on a public URL and start the external-tester clock.

## Prereqs
- [ ] You've played locally ≥ 10 min per `docs/PLAY_LOCALLY.md`
- [ ] Day 6b (texture atlas) has landed and been committed — chunks are textured not flat green
- [ ] CI badge on the repo README is green on `main` (optional)

## Step 1 — Connect Cloudflare Pages to the repo (3 min)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** (left sidebar)
2. **Create application** → **Pages** → **Connect to Git**
3. Authorize the Cloudflare GitHub app (first time only — approve for `JDC000000`)
4. Pick repo: **`JDC000000/chunksmith`**
5. Build settings:
   - **Project name:** `chunksmith` (gives you `chunksmith.pages.dev`)
   - **Production branch:** `main`
   - **Framework preset:** `Vite`
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** blank
   - **Environment variables** → **Add variable**:
     - `NODE_VERSION` = `22`
6. **Save and Deploy**

The first build takes 1-2 min. When it's done you'll see a success banner with your URL.

## Step 2 — Smoke-test the live URL (2 min)

Open `https://chunksmith.pages.dev` in a fresh tab (incognito/private window is better — proves no local cache cheating).

Check:
- [ ] Loads in <2 sec
- [ ] Scene renders, no visible errors
- [ ] Click → pointer locks (yes, this works on `.pages.dev`)
- [ ] WASD works
- [ ] Place + break blocks works
- [ ] Hotbar 1/2/3 works
- [ ] Open DevTools Console — zero red errors

If anything's broken: the preview URL for the main branch gets a build log in CF Pages. Dig in there.

## Step 3 — Share for playtest (~10 min of your attention over the week)

Pick 3-10 trusted contacts. Send a one-liner:
> I'm learning agentic game dev — built this voxel sandbox autonomously with Claude Code subagents over an afternoon. 10 min? https://chunksmith.pages.dev

Record each tester's reaction in `docs/playtest/YYYY-MM-DD-<name>.md`. Use the `docs/playtest/checklist.md` template.

**Stop clock on L2 ship when:**
- ≥ 3 external testers × ≥ 10 min each
- No P0 bugs in last 7 days (crash, data loss, controls broken, visual corruption, security)

## Step 4 — Decide L3

End of week — write `docs/retros/L2-public.md`:
- What external testers said (verbatim quotes)
- What surprised you
- Did you want to keep building or move on?

If YES to L3: write L3 PRD + TSD + Workplan (planner subagent — reuse the Day 1 kickoff pattern). L3 scope per `01_TEACHING_LADDER.md`: procedural terrain, caves, day/night, gravity+jump+collision, IDB persistence. Est 80-160 focus hours over ~1 month.

If NO to L3: branch into something else. L2 remains a shippable artifact and a reference repo for how to orchestrate Claude Code agents.

## Troubleshooting

**CF build fails:**
- Look at the CF build log for the exact npm error
- 99% of the time it's `NODE_VERSION` not set to 22 — fix in CF Pages → Settings → Environment Variables

**Preview URL for PRs:**
- CF Pages gives each PR a URL like `https://<hash>.chunksmith.pages.dev` — share for isolated playtests before merging to main

**Rolling back a bad deploy:**
- CF Pages → Chunksmith → Deployments → find the last-good one → **Rollback to this deployment**. 10 seconds, reverts the URL.

**Custom domain (later):**
- CF Pages → Chunksmith → Custom domains → Set up. Walk-through handles DNS.

## What this unblocks

Once CF Pages is connected, every `git push origin main` from any machine triggers an auto-build and auto-deploy. **The next time you say "ship it" there's no setup — I push, it's live.**

If you want to allow the cloud session to deploy directly via Wrangler (no GitHub-integration), add `api.cloudflare.com` to your Claude settings → Capabilities → allowed domains. Not required.
