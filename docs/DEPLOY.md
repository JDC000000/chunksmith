# Deploy to Cloudflare Pages (Jon's one-time setup, ~3 min)

The cloud session can't reach `api.cloudflare.com` through the agent proxy, so the deploy pipeline uses Cloudflare Pages' built-in **GitHub integration** (auto-deploys on every push). You set this up once; from then on it's zero-touch.

## One-time setup

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorize the Cloudflare GitHub app on your account.
3. Pick the `JDC000000/chunksmith` repo.
4. Build settings:
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Node version:** 22 (set under Environment Variables → `NODE_VERSION=22`)
   - **Root directory:** leave blank (repo root)
5. Click **Save and Deploy**.

Cloudflare will build your site on their infrastructure and give you a URL like `chunksmith.pages.dev`. Every subsequent `git push origin main` auto-triggers a new build.

## What's already configured for you
- `public/_headers` — COOP/COEP headers for SharedArrayBuffer (L3+ worker meshing)
- `.github/workflows/ci.yml` — CI runs on every PR + push (typecheck + unit + E2E + build)
- `npm run build` outputs to `dist/` (standard Vite behaviour)

## Preview URLs
Every PR gets its own preview URL automatically (Pages generates them per branch). Great for playtest before merging.

## Rolling back
Cloudflare Pages → your project → **Deployments** → find the last-good deploy → **Rollback to this deployment**. 10 seconds.

## Custom domain (later, if you want)
Pages project → **Custom domains** → **Set up a custom domain** → type any domain you own → Cloudflare walks you through DNS. You don't have to own one for the demo — the `.pages.dev` URL is public and shareable.

## Why not Wrangler CLI?
The cloud session running this build can't reach `api.cloudflare.com` through its agent proxy (403 on CONNECT). GitHub-integration keeps everything hands-off. If you want to allow it later, go to **claude.ai → Settings → Capabilities** and add `api.cloudflare.com` to allowed domains.
