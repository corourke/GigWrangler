# Deployment

**Purpose**: Single source of truth for how GigWrangler reaches production — the pipeline, every third-party service involved, the complete configuration inventory, and how to recover when something goes wrong.

**Last Updated**: 2026-10-10

> For *local development* setup, see [setup-guide.md](./setup-guide.md). This document covers production only.

---

## Table of Contents

1. [Topology](#topology)
2. [The Production Deploy](#the-production-deploy)
3. [Dev Deploys](#dev-deploys)
4. [Continuous Integration](#continuous-integration)
5. [Service Reference](#service-reference)
6. [Configuration Inventory](#configuration-inventory)
7. [Rollback and Recovery](#rollback-and-recovery)
8. [Rebuilding Production From Scratch](#rebuilding-production-from-scratch)
9. [Known Gaps](#known-gaps)

---

## Topology

```
                          gigwrangler.com
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │  Cloudflare Pages      │   project: gigwrangler
                    │  static SPA + CDN      │   build/ (Vite output)
                    │  SPA fallback + 404s   │   HTTPS + custom domain
                    └───────────┬────────────┘
                                │  VITE_* baked in at BUILD time
                                │  (from the local env file)
                                ▼
                    ┌────────────────────────┐
                    │  Supabase (prod)       │   ref: hqnnhtxcxedisasvtbqv
                    │  hqnnhtxcxedisasvtbqv  │
                    ├────────────────────────┤
                    │ Postgres 17 + RLS      │
                    │ Auth (email + Google)  │
                    │ Storage                │
                    │ Edge Functions (Deno)  │──┐
                    └────────────────────────┘  │
                                                │ secrets set via CLI
                        ┌───────────────────────┼───────────────────────┐
                        ▼           ▼           ▼           ▼           ▼
                    Google       Google      Anthropic    Resend      Sentry
                    Places      Calendar     (ai-scan)   (email)    (errors)
```

**At a glance**

| Concern | Answer |
|---|---|
| Web host | Cloudflare Pages, project `gigwrangler` |
| Domain | `gigwrangler.com` (HTTPS via Cloudflare) |
| DNS | Cloudflare — same account as Pages |
| Backend | Supabase project `hqnnhtxcxedisasvtbqv` (Pro plan) |
| Build tool | Vite 6 → `build/` |
| Deploy trigger | **Manual** — a human runs `./deploy_prod.sh` from `main` |
| Automated CD | **None.** GitHub Actions runs quality gates only, never deploys |
| Vercel / Netlify | **Not used.** Evaluated and rejected — see [Why Cloudflare Pages](#why-cloudflare-pages) |
| Staging environment | **None.** Two environments only: dev and prod |
| `website/index.html` | An unreleased marketing-page experiment. Deliberately not wired into the build and not deployed — ignore it when reasoning about production |

---

## The Production Deploy

Everything is orchestrated by [`deploy_prod.sh`](../../deploy_prod.sh) at the repo root. It is the authoritative runbook; this section explains what it does and why.

```bash
./deploy_prod.sh
```

The script mirrors all output to a timestamped log at `./backups/deploy-<timestamp>.log` for post-mortems.

### Stage 1 — Pre-flight gates (nothing is touched yet)

| Gate | Rationale |
|---|---|
| `git status --porcelain` is empty | You deploy what is committed, not what is on your disk |
| Current branch is `main` | Production only ever ships `main` |
| Local `HEAD == origin/main` | Prevents shipping a commit nobody else has seen, or missing one |
| CI concluded `success` for that exact SHA | Reuses the GitHub Actions run rather than trusting local state |
| `npm ci` | Installs from the lockfile, not whatever `node_modules` happens to hold |
| `npm run typecheck && lint && test:run` | Local belt to CI's braces |

All gates run **before** the Supabase CLI is linked to prod, so a gate failure never leaves the CLI pointed at production.

### Stage 2 — Target prod and confirm

Links to `hqnnhtxcxedisasvtbqv`, then **hard-verifies** the link by reading `supabase/.temp/project-ref` back and comparing. This is the ritual mandated by [AGENTS.md](../../AGENTS.md) — never trust that `supabase link` did what you asked. The script then prints pending migrations and requires the operator to type `deploy`.

### Stage 3 — Backups

Requires Docker (the script will start Docker Desktop on macOS and wait up to 60s). Two dumps land in `./backups/` (git-ignored):

- `prod-schema-backup-<timestamp>.sql` — `public` + `auth` schemas
- `prod-data-backup-<timestamp>.sql` — data only, `--use-copy`

Both are size-checked; an empty dump aborts the deploy before anything mutates.

### Stage 4 — Deploy, in this order

1. **Migrations** — `supabase db push --yes`
2. **Edge functions** — `supabase functions deploy`
3. **Frontend** — `npm run build` then `npx wrangler pages deploy build/ --project-name gigwrangler`

> **Migrations ship before code, which imposes a hard constraint:** every migration in a release must be backward-compatible with the *currently deployed* code. Expand-only — add nullable columns and new tables freely, but no drops, renames, or `NOT NULL` tightening in the same release as the code that depends on them. This ordering means a failed `db push` never leaves new code running against an old schema. Contracting changes go in a *follow-up* release, after the code that stopped using the old shape is live.

### Stage 5 — Smoke check

Polls `https://gigwrangler.com` up to 6 times (10s apart) for HTTP 200. Then [`scripts/check-deployed-assets.mjs`](../../scripts/check-deployed-assets.mjs) fetches the live `index.html`, follows every JS/CSS build file it loads and, recursively, the lazy chunks those files name, and fails if any is not 200 or comes back as `text/html` (the SPA fallback). It also requests a made-up `/static/deploy-check-missing-<time>.js` and requires a 404. It retries for about 60 seconds so the CDN can finish propagating. A failure here is loud but late — the deploy has already completed, so the message tells you to verify production manually. See [Missing build files return 404](#missing-build-files-return-404).

### Always — the exit trap

A single `trap ... EXIT` registered before any other logic guarantees that **every** exit path (success, `die`, a failed command under `set -e`, Ctrl-C) relinks the Supabase CLI back to dev. On failure it also reports blast radius: whether production was mutated, and the paths of both backups.

### Escape hatches

All opt-in, all documented in the script header. Use sparingly and know why:

| Variable | Effect |
|---|---|
| `SKIP_CI_CHECK=1` | Skip the "CI is green for HEAD" gate |
| `SKIP_NPM_CI=1` | Reuse existing `node_modules` instead of `npm ci` |
| `SKIP_LOCAL_GATES=1` | Skip local typecheck/lint/tests (rely on CI green) |
| `SKIP_HEALTHCHECK=1` | Skip the post-deploy smoke check (both the 200 poll and the build-file check) |
| `AUTO_CONFIRM=yes` | Skip the interactive confirmation prompt |
| `PROD_URL=<url>` | Override the smoke-check URL |

---

## Dev Deploys

[`deploy_dev.sh`](../../deploy_dev.sh) pushes migrations and edge functions to the **dev** Supabase project (`qcrzwsazasaojqoqxwnr`). It encodes the same link → hard-verify → deploy ritual, and its exit trap likewise guarantees the CLI is left on dev.

```bash
./deploy_dev.sh           # link, verify, db push, functions deploy
./deploy_dev.sh --check   # dry run: verify link, list pending migrations
                          # and functions, deploy nothing
```

No branch/cleanliness/test gates and no backups — dev is where unmerged work lands and its data is disposable. The script refuses to continue if the verified ref is prod or anything other than dev.

**There is no dev frontend deploy.** Dev frontend work runs locally via `npm run dev` against the dev Supabase project.

---

## Continuous Integration

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs two jobs on every push and pull request to `main`.

**`ci`**:

1. `npm ci`
2. `npm run typecheck` — TypeScript strict mode
3. `npm run lint` — ESLint flat config
4. `npm run test:run` — full Vitest suite
5. `npm run build` — production Vite build

**`rls`**: applies every migration to a throwaway Postgres 17 service container and runs the tenant-isolation tests in
[`supabase/tests/rls/`](../../supabase/tests/rls/README.md) (`supabase/tests/rls/run.sh`). Any new org-private table
or policy change needs a test there.

**CI never deploys.** Its only relationship to production is that `deploy_prod.sh` refuses to run unless CI concluded `success` for the exact commit being deployed.

No repository secrets are required: the build step uses obviously-fake placeholders for `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. The client validates only their *presence* at runtime, and nothing contacts Supabase during a build.

---

## Service Reference

### Cloudflare Pages

Hosts the built SPA, terminates HTTPS, serves the CDN, and owns the custom domain.

| Setting | Value |
|---|---|
| Project name | `gigwrangler` |
| Build command | `npm run build` |
| Build output directory | `build` |
| Custom domain | `gigwrangler.com` |
| DNS | Cloudflare, same account |
| SPA routing | Built in: there is no top-level `404.html`, so Pages serves `index.html` for any path without a file |
| Missing build files | [`public/static/404.html`](../../public/static/404.html) → a real 404 for a missing `/static/*` file |

**SPA routing needs no `_redirects`.** Cloudflare's [Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/) docs: "If your project does not include a top-level `404.html` file, Pages assumes that you are deploying a single-page application" and serves `/` for every path without a file, so client-side routes (`/gigs/123`, `/settings`, …) survive a hard refresh or deep link. The old `public/_redirects` rule `/*  /index.html  200` never did anything: Wrangler drops it with "Infinite loop detected in this rule and has been ignored", so it was removed on 2026-10-10. Don't add a top-level `404.html`: that switches SPA mode off and every client route would 404.

#### Missing build files return 404

**The problem (10-10 incident).** In SPA mode, a request for a build file that doesn't exist also got `index.html` with status 200. Right after a deploy, a lazy chunk (`ItemDetailScreen-<hash>.js`) was briefly missing at the CDN, so the browser got HTML for it ("Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of text/html", "Failed to fetch dynamically imported module"). Worse, that HTML was cached under the chunk's URL: by the browser (the zone sends `max-age=14400` for `.js`) and possibly by the service worker's precache, which accepts any 200. A hard reload didn't help, because the import happens after load.

**The fix has three parts:**

1. **A real 404 for a missing build file.** Vite writes hashed JS/CSS to `build/static/` (`build.assetsDir: 'static'` in `vite.config.ts`; not Vite's default `assets/`, because `/assets/...` are the app's equipment routes). [`public/static/404.html`](../../public/static/404.html) is the "closest 404.html" that Pages serves for a missing file under `/static/` (it "will continue to look up the directory tree for a matching `404.html` file"), with status 404 and (from Pages' asset server, as `wrangler pages dev` shows) `Cache-Control: no-store`, so nothing should cache it. With no top-level `404.html`, every other path keeps the SPA fallback. This is static: no Pages Function, so nothing counts against the Workers request quota. Checked with `npx wrangler pages dev build/`: an existing chunk is 200 JS, `/static/x.js` is 404, and `/gigs/123`, `/assets/new` and `/assets/<id>/edit` are 200 `index.html`.
2. **Self-repair in the app.** When a lazy screen fails to load, [`ChunkLoadBoundary`](../../src/routes/ChunkLoadBoundary.tsx) automatically deletes every Cache Storage cache (the Workbox precache included), unregisters the service worker and reloads ([`chunkRecovery.ts`](../../src/routes/chunkRecovery.ts)). It does this once per tab session (a `sessionStorage` flag, `gw.chunkReloadAttempted`). If the screen still fails after that, it shows "This screen couldn't load… Reload", and the Reload button does the same repair. If `sessionStorage` is blocked there is no automatic reload, since nothing could stop a loop. A failed landing-screen prefetch is swallowed and never triggers it. The browser's HTTP cache can't be cleared from script, so a chunk URL already cached as HTML before this fix shipped stays broken for up to 4 hours (the zone's `max-age=14400`).
3. **The deploy check** (Stage 5 above) catches a missing or HTML-served chunk on the live site.

**The service worker can't cache the HTML any more.** Workbox's precache install only stores responses with status below 400 and fails the whole install on anything else (`bad-precaching-response`); the old service worker stays in charge and the browser retries the install at its next update check. So a 404 makes the install fail safely instead of caching HTML. Rejecting a 200 `text/html` for a `.js` URL in the precache itself would need a custom service worker (`injectManifest`), which isn't worth it now that the server can't send one. `static/404.html` is excluded from the precache (`globIgnores`).

DNS for `gigwrangler.com` is managed in Cloudflare alongside the Pages project, so the custom domain binds without any external nameserver change and HTTPS is issued automatically. One account is therefore the single point of failure for hosting, DNS, and TLS — losing access to it takes the site down with no independent lever to recover.

Deploys are pushed from a developer machine with the Wrangler CLI:

```bash
npm run build
npx wrangler pages deploy build/ --project-name gigwrangler
```

**There is no committed `wrangler.toml`.** The Pages configuration that matters (custom domain, project settings) lives in the Cloudflare dashboard. See [Known Gaps](#known-gaps).

**The dashboard's build settings and environment variables are not used by this pipeline.** `wrangler pages deploy` is a *direct upload* of the `build/` directory that `deploy_prod.sh` has already built on the deploying machine; Cloudflare never runs a build, so dashboard env vars never reach the bundle. `VITE_*` values are inlined by Vite at build time from the local env files (`.env`, `.env.local`, `.env.production`, `.env.production.local`) and the shell environment of that machine. Put them in `.env.production.local` (git-ignored); **a change takes effect at the next `./deploy_prod.sh` run**. See the [Configuration Inventory](#configuration-inventory) for the full list.

#### Why Cloudflare Pages

Chosen over Vercel and Netlify during the original production bring-up:

- Free tier with unlimited bandwidth and no monthly build-minute cap (Netlify's free tier caps at 300 min/mo; Vercel enforces 100 GB bandwidth/mo)
- Native custom domains with automatic HTTPS via Cloudflare's CDN
- Manual deploys supported via `wrangler pages deploy` or dashboard upload

**Vercel is not part of this stack.** It appears in the repo only as a rejected alternative.

#### Security headers

[`public/_headers`](../../public/_headers) is copied into `build/` and applied by Pages to every response (`/*`):

| Header | Value | Why |
|---|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | HTTPS only, for a year, on every subdomain. No `preload` yet: that's hard to undo. |
| `X-Frame-Options` | `DENY` | The app can't be framed (older browsers). |
| `Content-Security-Policy` | `frame-ancestors 'none'` | The same for current browsers. It's enforced on its own because `frame-ancestors` is ignored in a report-only policy. |
| `X-Content-Type-Options` | `nosniff` | Files are only used as their declared type. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Other sites see only the origin, never the path. |
| `Permissions-Policy` | `camera=(self), geolocation=(), microphone=()` | The camera for scanning receipts; no location or microphone. |
| `Content-Security-Policy-Report-Only` | see the file | Reports, without blocking, anything outside the app's own sources and services. |

**The report-only policy** allows:
- **Scripts:** `'self'` only. The build has no inline script: `registerSW.js` and the chunks are files.
- **Styles:** `'self' 'unsafe-inline'`, for the style attributes React and Radix set.
- **Connections:** `'self'`, both Supabase projects (`https://` and `wss://` for realtime; dev `qcrzwsazasaojqoqxwnr`, prod `hqnnhtxcxedisasvtbqv`) and Sentry ingest (`*.ingest.sentry.io`, `*.ingest.us.sentry.io`, `*.ingest.de.sentry.io`).
- **Images:** `'self' data: blob:`, the two Supabase hosts (storage) and `*.googleusercontent.com` (Google profile pictures).
- **Frames:** `'self' blob:` and the Supabase hosts, for PDF previews.
- **Workers:** `'self' blob:`, for the service worker and the PDF worker.
- **Everything else:** `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.

Google sign-in and calendar authorization are navigations, not requests, so they need no entry.

**Checked on 11-07 (PR "Add security headers"):** the dev build was served with this policy **enforced** and loaded in Chromium (Playwright). The app rendered with no violations. Requests to both Supabase hosts (`https` and `wss`), a Sentry ingest host and a storage image were allowed; a request to an unlisted host was blocked.

**Switching to enforce.** After a deploy, open the browser console on prod and use the app: sign in, gigs, purchases with a document preview, the mobile view. Any line saying "[Report Only] Refused to …" names a source the policy would block. Once there are none, rename the header to `Content-Security-Policy`. Keep `frame-ancestors 'none'` in it, and drop the separate one.

**Caching:** `/` and `/index.html` are sent with `Cache-Control: no-cache`, like `sw.js`, `registerSW.js` and `version.json`, so a deploy is picked up on the next load. A client-side route such as `/gigs/123` is served `index.html` by the SPA fallback with Pages' default caching for HTML.

**Check after a deploy:** `curl -sI https://gigwrangler.com/ | grep -iE 'strict-transport|x-frame|content-security|referrer|permissions|nosniff|cache-control'`.

### Supabase

Provides Postgres, Auth, Storage, and Edge Functions. Two projects, no staging:

| Environment | Project Ref | Consumed by |
|---|---|---|
| Development | `qcrzwsazasaojqoqxwnr` | `npm run dev` via `.env.development.local` |
| Production | `hqnnhtxcxedisasvtbqv` | `./deploy_prod.sh` build, via `.env.production.local` |

> ⚠️ **Verify the linked project before ANY remote Supabase command.** `supabase db push`, `functions deploy`, and `secrets set` all act on whatever is linked, with no confirmation of their own.
>
> ```bash
> cat supabase/.temp/project-ref
> ```
>
> Both deploy scripts do this automatically. Do it by hand for one-off commands.

**Auth URL configuration** (dashboard → Authentication → URL Configuration):
- Site URL: `https://gigwrangler.com`
- Redirect URLs include: `https://gigwrangler.com/**`

**Edge functions** deployed to prod: `server` (the consolidated API — users, organizations, gigs, dashboard, Google integrations, WebAuthn, email), `ai-scan` (receipt/invoice extraction), and `health-check` (the daily API health check, called only by `pg_cron`; see [below](#daily-health-check--one-time-setup-issue-52)). `_shared/` holds CORS and Sentry helpers and is not itself a function.

**Backups** are two-layered:
- Supabase-managed: automated daily backups, and optionally PITR, configured in dashboard → Database → Backups
- Deploy-time: schema and data dumps into `./backups/` before every prod migration, taken by `deploy_prod.sh`

### Vite

The build tool. [`vite.config.ts`](../../vite.config.ts) configures:

- `@vitejs/plugin-react-swc` and the Tailwind v4 Vite plugin
- `vite-plugin-pwa` with `registerType: 'autoUpdate'`, workbox `skipWaiting` + `clientsClaim`, and a `navigateFallbackAllowlist` of `/^(?!\/api\/).*/` so every client-side react-router route falls back to `index.html` instead of being rejected by the service worker
- `build.outDir: 'build'`, `build.target: 'esnext'`, `build.assetsDir: 'static'` (see [Missing build files return 404](#missing-build-files-return-404)); workbox `globIgnores` keeps `static/404.html` out of the precache
- `define.__BUILD_TIMESTAMP__` — injected at build time and used as the Sentry release identifier

Environment variables must be prefixed `VITE_` to be exposed to client code, and are **inlined at build time** — they are not runtime configuration. [`src/utils/supabase/info.tsx`](../../src/utils/supabase/info.tsx) throws on startup if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, which turns a misconfigured deploy into an immediate visible failure rather than silent connection to the wrong database.

### Sentry

Error monitoring across three surfaces. **All three no-op when their DSN env var is unset**, so local dev and tests are unaffected.

| Surface | Init location | Env vars |
|---|---|---|
| Web app | [`src/main.tsx`](../../src/main.tsx) — `Sentry.init` + top-level `Sentry.ErrorBoundary` | `VITE_SENTRY_DSN` |
| `server` edge function | [`supabase/functions/_shared/sentry.ts`](../../supabase/functions/_shared/sentry.ts), captured in the top-level catch | `SENTRY_DSN`, `SENTRY_ENVIRONMENT` |
| `ai-scan` edge function | same shared helper | `SENTRY_DSN`, `SENTRY_ENVIRONMENT` |

The web app tags events with `environment` (Vite mode) and `release` (`gigwrangler@<build timestamp>`), and sets `sendDefaultPii: false`. Edge functions flush explicitly before responding, because Deno isolates can terminate the moment a response is returned. The Sentry Deno import is version-pinned so `functions deploy` is reproducible.

**Two Sentry projects, two DSNs** — one per runtime. A **JavaScript React** project for the web app, and a **Deno** project for the edge functions. Each DSN comes from its own project's **Settings → Client Keys (DSN)**, and looks like `https://abc123@o123456.ingest.sentry.io/789`.

#### Activating it

**Web app** — add `VITE_SENTRY_DSN=https://<key>@o<org>.ingest.us.sentry.io/<project>` (React project DSN) to `.env.production.local` on the machine that runs `./deploy_prod.sh`. It is baked into the bundle at build time, so **a new deploy is required** before it takes effect; run `./deploy_prod.sh`. Do not set it in the Cloudflare Pages dashboard — deploys are a direct upload of a locally built `build/`, so dashboard env vars never reach the bundle.

**Edge functions** — use the Deno project DSN:

```bash
cat supabase/.temp/project-ref   # verify the target first
supabase secrets set SENTRY_DSN="https://…" SENTRY_ENVIRONMENT="production"
```

Secrets take effect immediately; no function redeploy is needed. Without `SENTRY_ENVIRONMENT`, events default to `development` and get filtered out of production dashboards — which looks identical to Sentry not working.

#### Verifying

To confirm a `VITE_*` value was baked in, search the deployed bundle for the Sentry ingest host from your DSN: find the script path with `curl -s https://gigwrangler.com/ | grep -o 'static/[^"]*\.js'`, then `curl -s https://gigwrangler.com/<path> | grep -c '<org>.ingest'` (0 matches in every script means the value did not make it in). Or, on the deployed site, open DevTools → Network and filter for `sentry.io`; a session request should appear within seconds. `window.__SENTRY__` being defined in the console confirms init. For a real end-to-end check, run `throw new Error("Sentry test — delete me")` in the console and confirm it lands in **Issues** within ~30s, then delete it.

#### What is and isn't captured

Captured: React render errors via the `ErrorBoundary`, unhandled rejections and uncaught exceptions (auto-instrumented), and every unhandled throw in both edge functions.

Deliberately **not** captured: expected HTTP errors returned as responses (401, 403, 429) — they are returned, not thrown; performance traces (`tracesSampleRate: 0` on edge functions); and PII (`sendDefaultPii: false`).

#### Known limitation — no source maps

Stack traces point at minified filenames (`index-XXXXXXXX.js`) rather than real source locations, which makes production errors materially harder to read. Fixing it means adding [`@sentry/vite-plugin`](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/) to `vite.config.ts` and providing a `SENTRY_AUTH_TOKEN` at build time.

### Google

Three separate integrations, each with its own credentials.

**1. Google OAuth (sign-in)** — configured entirely in Supabase, not in app code.
- Google Cloud Console: OAuth consent screen (External) + OAuth 2.0 Client ID (Web Application)
- Authorized redirect URI: `https://hqnnhtxcxedisasvtbqv.supabase.co/auth/v1/callback`
- Supabase dashboard → Authentication → Providers → Google: enable, paste Client ID + Secret

**2. Google Places API (New)** — address search and place details in the `server` function.
- Google Cloud API key with "Places API (New)" enabled
- Edge function secret: `GOOGLE_PLACES_API_KEY`

**3. Google Calendar** — gig sync, OAuth 2.0 with a token exchange in the edge function.
- Google Calendar API enabled; OAuth 2.0 Client ID (Web Application)
- Authorized JavaScript origins: `http://localhost:3000`, `https://gigwrangler.com`
- Authorized redirect URIs: `http://localhost:3000/auth/google-calendar/callback`, `https://gigwrangler.com/auth/google-calendar/callback`
- Frontend build-time var: `VITE_GOOGLE_CLIENT_ID`
- Edge function secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

> **Support note:** OAuth scope and per-calendar sharing are independent permission layers. A user can be "Connected" with a calendar selected while holding only *read* access on it, and every sync then fails with `403 / "You need to have writer access to this calendar."` The picker only offers calendars Google reports as `writer` or `owner`, but cannot fix sharing that was never granted. Full detail in [setup-guide.md](./setup-guide.md#3-google-calendar-integration).

### Anthropic

The `ai-scan` edge function uses Claude to extract structured data from invoices and receipts.

- Edge function secret: `ANTHROPIC_API_KEY`
- PDF scanning requires a **Tier 1+** Anthropic account; Tier 0 supports images only and the UI falls back to manual entry
- No connectivity diagnostic: the old unauthenticated `x-diagnostic: true` mode was removed in June 2026 (see [security-scheme.md](./security-scheme.md)). To check the key, call the Anthropic API directly as shown in [setup-guide.md](./setup-guide.md#2-ai-scanning-configuration-anthropic).

### Resend

Transactional email (organization invitations) from the `server` function, via a raw `fetch` rather than an SDK.

- Edge function secrets: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- **Both are set in dev and prod, and delivery is confirmed working.**
- Sends are **best-effort**: if `RESEND_API_KEY` is unset the call logs a warning and returns `{ sent: false }` rather than failing the request that triggered it. An unconfigured environment drops invitation emails silently — which is why `RESEND_API_KEY` belongs on any post-deploy verification pass.
- `RESEND_FROM_EMAIL` must stay set. Its code fallback in [`lib/email.ts`](../../supabase/functions/server/lib/email.ts) is `GigManager <onboarding@resend.dev>` — Resend's sandbox sender, which only delivers to the account owner's verified address, and which still carries the pre-rebrand name. Unsetting the secret would therefore both break delivery and regress branding, with no error.

### WebAuthn / passkeys

The `server` function's passkey routes read relying-party config from [`supabase/functions/server/lib/webauthnConfig.ts`](../../supabase/functions/server/lib/webauthnConfig.ts), which **defaults to localhost values**:

```ts
export const RP_NAME = Deno.env.get('RP_NAME')  || 'GigWrangler';
export const RP_ID   = Deno.env.get('RP_ID')    || 'localhost';
export const ORIGIN  = Deno.env.get('ORIGIN')   || 'http://localhost:3000';
```

> ⚠️ In production `RP_ID` must be `gigwrangler.com` and `ORIGIN` must be `https://gigwrangler.com`. If they are left at their defaults, registration and authentication fail origin/RPID validation — **passkeys break with no startup error and no deploy-time warning.** These are the only production secrets whose absence degrades a feature silently rather than loudly.

---

## Configuration Inventory

Derived from the code that actually reads each value, not from any prior checklist. This is the definitive list.

### Frontend — build-time (`VITE_*`)

Set in the local env file the prod build reads, normally `.env.production.local` (git-ignored), on the machine that runs `./deploy_prod.sh`. Inlined by Vite at build time; **a change takes effect at the next `./deploy_prod.sh` run.** Cloudflare Pages dashboard env vars are not used (direct upload).

| Variable | Required | Read by | Effect if missing |
|---|---|---|---|
| `VITE_SUPABASE_URL` | **Yes** | `src/utils/supabase/info.tsx` | App throws on startup |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | `src/utils/supabase/info.tsx` | App throws on startup |
| `VITE_GOOGLE_CLIENT_ID` | For Calendar | Calendar integration components | Google Calendar connect flow unavailable |
| `VITE_SENTRY_DSN` | Optional | `src/main.tsx` | Sentry no-ops; no error reporting |

For development, put the same variables in `.env.development.local` (git-ignored), which only `npm run dev` reads. Avoid `.env.local`: Vite loads it in every mode, including the prod build, so a variable missing from `.env.production.local` would silently fall back to its dev value in the production bundle. [`.env.example`](../../.env.example) documents the shape with placeholder values.

`VITE_GOOGLE_CLIENT_ID` must be the same OAuth client as the `GOOGLE_CLIENT_ID` edge-function secret in the same Supabase project: the browser obtains the authorization code with one, and the `server` function exchanges it with the other. A mismatch fails the Calendar connect flow at token exchange. Dev and prod use separate OAuth clients.

### Edge functions — Supabase secrets

Set with `supabase secrets set NAME=VALUE` against the **verified** target project. List with `supabase secrets list`.

| Secret | Required | Used by | Effect if missing |
|---|---|---|---|
| `GOOGLE_PLACES_API_KEY` | For address search | `server` → places routes | Place search returns errors |
| `GOOGLE_CLIENT_ID` | For Calendar | `server` → calendar token exchange | Calendar OAuth fails |
| `GOOGLE_CLIENT_SECRET` | For Calendar | `server` → calendar token exchange | Calendar OAuth fails |
| `ANTHROPIC_API_KEY` | For AI scan | `ai-scan` | Receipt/invoice scanning fails |
| `RESEND_API_KEY` | For email | `server` → `lib/email.ts` | **Silent** — invitation emails skipped |
| `RESEND_FROM_EMAIL` | For real delivery | `server` → `lib/email.ts` | Falls back to Resend sandbox sender |
| `RP_ID` | **Yes in prod** | `server` → webauthn | **Silent** — defaults to `localhost`, passkeys break |
| `ORIGIN` | **Yes in prod** | `server` → webauthn | **Silent** — defaults to `http://localhost:3000`, passkeys break |
| `RP_NAME` | Optional | `server` → webauthn | Defaults to `GigWrangler` (correct) |
| `SENTRY_DSN` | Optional | `_shared/sentry.ts` | Sentry no-ops in functions |
| `SENTRY_ENVIRONMENT` | Optional | `_shared/sentry.ts` | Defaults to `development` — set to `production` |
| `HEALTH_CHECK_CRON_SECRET` | For the daily health check | `health-check` | Cron's calls 401; no health checks run |
| `SENTRY_API_TOKEN` | Optional | `health-check` | Health check reports the Sentry check as "not configured" |
| `SENTRY_ORG_SLUG` | Optional (with `SENTRY_API_TOKEN`) | `health-check` | Same — Sentry check reports "not configured" |
| `SENTRY_PROJECT_SLUG` | Optional (with `SENTRY_API_TOKEN`) | `health-check` | Same — Sentry check reports "not configured" |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are **injected automatically by the Supabase platform**. Do not set them by hand.

#### Daily health check — one-time setup (issue #52)

The `daily-health-check` cron job (migration `20260919000000_health_check_schedule.sql`) runs at 13:00 UTC and
POSTs to the `health-check` edge function. It reads the function's URL and a bearer token from Supabase Vault at
call time, so nothing secret is in git and dev and prod each have their own values.

`health-check` is the one function deployed with `verify_jwt = false` (`[functions.health-check]` in
`supabase/config.toml`). The cron's token is not a Supabase JWT, and with the default the gateway rejects it with
`401 UNAUTHORIZED_INVALID_JWT_FORMAT` before the function runs. The function checks the token itself against
`HEALTH_CHECK_CRON_SECRET`, and refuses every request while that secret is unset.

Do this once per project, dev first. The token never goes into git, an issue, or a PR; it is pasted into exactly
two places: the Vault (step 2) and the edge-function secrets (step 3).

1. **Generate a token** in your terminal and keep it in a shell variable for the steps below:

   ```bash
   export T=$(openssl rand -hex 32)
   echo $T    # copy this for step 2
   ```

2. **Store it and the URL in Vault.** Open the project's SQL Editor
   (dev: `https://supabase.com/dashboard/project/qcrzwsazasaojqoqxwnr/sql`) and run, pasting the token:

   ```sql
   select vault.create_secret('<PASTE TOKEN>', 'health_check_cron_secret', 'Bearer token the daily health-check cron sends to the edge function');
   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/health-check', 'health_check_function_url', 'URL the daily health-check cron calls');
   ```

   If a secret with that name already exists (for example, from an earlier attempt at the old
   `/server/internal/health-check` URL), update it instead:
   `select vault.update_secret((select id from vault.secrets where name = 'health_check_function_url'), 'https://<project-ref>.supabase.co/functions/v1/health-check');`

3. **Set the same token on the edge functions and deploy** (from the repo root):

   ```bash
   cat supabase/.temp/project-ref            # must print the intended project ref
   supabase secrets set HEALTH_CHECK_CRON_SECRET="$T"
   ./deploy_dev.sh                           # dev; prod goes through ./deploy_prod.sh
   ```

   The deploy applies the cron migration (if it is not already applied) and deploys `health-check`.

4. **Verify.** Call it by hand; expect HTTP 200 and a JSON `results` array with `supabase` and `google_places`
   `ok`, and `sentry` `not_configured`:

   ```bash
   curl -sS -X POST -H "Authorization: Bearer $T" https://<project-ref>.supabase.co/functions/v1/health-check
   ```

   A `401 {"error":"Unauthorized"}` means the token doesn't match `HEALTH_CHECK_CRON_SECRET`. A
   `401 ... Invalid JWT` means the function was deployed without the `config.toml` setting. After the next
   13:00 UTC run, confirm the cron fired and the call succeeded:

   ```sql
   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
   select status_code, content from net._http_response order by created desc limit 5;
   ```

5. `unset T` when done.

The Sentry round-trip check additionally needs `SENTRY_API_TOKEN` (a Sentry auth token with API read access),
`SENTRY_ORG_SLUG`, and `SENTRY_PROJECT_SLUG`, set the same way with `supabase secrets set`. Until then it reports
"not configured", which is a valid steady state and does not raise an alert.

Audit both projects with:

```bash
cat supabase/.temp/project-ref   # confirm which project you are looking at
supabase secrets list
```

### Audit results — 2026-09-08

**`RP_ID`, `ORIGIN` and `RP_NAME` are absent from prod.** Passkey registration and authentication have therefore been running against the code defaults (`localhost`, `http://localhost:3000`) in production, which fail WebAuthn's origin and RPID validation. Fix:

```bash
supabase secrets set RP_ID=gigwrangler.com ORIGIN=https://gigwrangler.com
```

They are absent from dev too, and should stay that way — the `localhost` defaults are correct there, since the dev project is only ever reached from a local dev server. That asymmetry is exactly why this went unnoticed: passkeys work locally and fail only in production, silently.

`ORIGIN` is a single exact-match string, so passkeys will not work on Cloudflare Pages preview URLs (`*.pages.dev`) even after the fix. `RP_ID` is a registrable domain suffix, so it does cover subdomains of `gigwrangler.com`.

Three further observations from the same audit:

| Finding | Assessment |
|---|---|
| `RESEND_API_KEY` and `RESEND_FROM_EMAIL` have **identical digests in dev and prod** — one Resend key and sender shared by both | Test sends from dev leave as production-branded mail, count against the same quota, and affect the same domain sending reputation. Worth splitting into a separate dev key. |
| `SENTRY_DSN` is **shared** across dev and prod, but `SENTRY_ENVIRONMENT` **differs** | Correct as-is. This is Sentry's intended pattern: one project, environments separated by tag rather than by DSN. |
| `GOOGLE_MAPS_API_KEY` exists on **dev only**, with the same digest as that project's `GOOGLE_PLACES_API_KEY`, and is read nowhere in the codebase | Orphan. Safe to unset: `supabase secrets unset GOOGLE_MAPS_API_KEY` against dev. |

---

## Rollback and Recovery

### Frontend rollback

Cloudflare Pages keeps every deployment. Roll back in **dashboard → Deployments → (a previous build) → Rollback**. This is instant and requires no local tooling — the fastest lever when a bad frontend ships.

Note that a rollback restores the *frontend only*. If the bad release also migrated the database, see below.

### Database rollback

There is no automatic down-migration. Recovery options, in order of preference:

1. **Roll forward** — write a corrective migration. Almost always right for a schema mistake.
2. **Supabase PITR**, *if enabled* — dashboard → Database → Backups.

   **PITR (Point-In-Time Recovery)** continuously archives the database's write-ahead log, so you can restore to *any moment* inside a retention window — "09:42, just before the bad migration" — rather than only to the last nightly snapshot. Without it, the worst case is losing up to a full day of writes; with it, roughly the last few minutes.

   It is a **paid add-on** on top of Pro, not something Pro includes, so it is off unless someone deliberately turned it on. **Whether it is enabled for this project has not been confirmed** — check the dashboard before relying on this step. If it is off, the deploy-time dumps below are the only fine-grained recovery path, and they only exist for migrations run through `deploy_prod.sh`.
3. **Deploy-time dumps** — `./backups/prod-schema-backup-<ts>.sql` and `prod-data-backup-<ts>.sql`, taken immediately before the migrations that shipped.

Restoring a data-only dump trips foreign-key checks, because rows are inserted in dump order rather than dependency order. Wrap the import:

```sql
SET session_replication_role = 'replica';
-- [dump contents]
SET session_replication_role = 'origin';
```

### Edge function rollback

Redeploy from an earlier commit:

```bash
git checkout <good-sha>
cat supabase/.temp/project-ref   # verify prod before proceeding
supabase functions deploy
git checkout main
```

---

## Rebuilding Production From Scratch

The one-time bring-up, should production ever need to be recreated. This section is now the authoritative version; it was originally executed as `.zenflow/tasks/production-setup-b686/`, a historical artifact of the retired Zenflow tooling that is kept only for provenance and may be deleted without loss.

**1. Supabase project**
- Create a project on the **Pro plan**; note the new ref and DB password. PITR is a separate paid add-on on top of Pro — enable it deliberately if you want sub-daily recovery
- `supabase link --project-ref <new-ref>` → verify → `supabase db push`
- `supabase functions deploy`
- Set the secrets. The three site-identity values are not credentials and are the same on every rebuild, so they can be pasted verbatim — the rest come from their respective service dashboards:

  ```bash
  cat supabase/.temp/project-ref   # verify the target before every secrets command

  # Site identity — WebAuthn relying party. Fixed values; no secret to look up.
  # Omitting these is silent: the code falls back to localhost defaults and
  # passkeys fail in production with no error anywhere.
  supabase secrets set \
    RP_ID=gigwrangler.com \
    ORIGIN=https://gigwrangler.com \
    RP_NAME=GigWrangler

  # Third-party credentials — fetch each from its own console
  supabase secrets set \
    GOOGLE_PLACES_API_KEY=… \
    GOOGLE_CLIENT_ID=… \
    GOOGLE_CLIENT_SECRET=… \
    ANTHROPIC_API_KEY=… \
    RESEND_API_KEY=… \
    RESEND_FROM_EMAIL="GigWrangler <noreply@…>" \
    SENTRY_DSN=… \
    SENTRY_ENVIRONMENT=production

  supabase secrets list   # confirm all eleven are present
  ```

  Then do the [daily health check setup](#daily-health-check--one-time-setup-issue-52): it adds
  `HEALTH_CHECK_CRON_SECRET` and two Vault entries, without which the cron's calls are refused.

  `RP_NAME` is included even though its code default is already correct, so that every value the relying party depends on is explicit in one place rather than half-configured and half-inherited.

- Authentication → URL Configuration: Site URL `https://gigwrangler.com`, redirect `https://gigwrangler.com/**`
- Authentication → Providers → Google: enable, paste Client ID + Secret
- Database → Backups: confirm daily backups are active and note the retention window; enable PITR if sub-daily recovery is wanted

**2. Google Cloud Console**
- OAuth consent screen (External)
- OAuth 2.0 Client ID with the origins and redirect URIs listed under [Google](#google)
- Enable Places API (New) and Google Calendar API; issue the Places API key

**3. Cloudflare Pages**
- Create project `gigwrangler`; build command `npm run build`, output directory `build`
- Put all four `VITE_*` variables from the [inventory](#frontend--build-time-vite_) in `.env.production.local` on the deploying machine (not in the dashboard — direct uploads ignore dashboard env vars)
- Add custom domain `gigwrangler.com`; verify HTTPS is active. DNS is already managed in the same Cloudflare account, so no external nameserver change is needed and the certificate issues automatically

**4. First deploy**
- Update `PROD_REF` in both `deploy_prod.sh` and `deploy_dev.sh` if the ref changed
- `./deploy_prod.sh`

**5. Verify**
- `https://gigwrangler.com` loads; tab title reads "GigWrangler"
- Sign-in completes and the user appears in the prod Supabase dashboard → Auth → Users
- A deep link (e.g. `https://gigwrangler.com/gigs`, `https://gigwrangler.com/assets/new`) survives a hard refresh — confirms SPA mode (no top-level `404.html`)
- `curl -sI https://gigwrangler.com/static/nope.js` returns 404 — confirms `static/404.html` shipped
- Passkey registration succeeds — confirms `RP_ID` / `ORIGIN` are set
- An organization invitation email arrives — confirms Resend
- A deliberate client error appears in Sentry

---

## Known Gaps

Tracked here rather than lost. None of these block a deploy today; all of them would slow down an incident or a rebuild.

| Gap | Impact |
|---|---|
| **Cloudflare dashboard config is not in the repo** — no `wrangler.toml`; and the prod `VITE_*` values live only in the deploying machine's git-ignored `.env.production.local` | Rebuilding the Pages project or switching deploy machines means reconstructing settings from this doc and hoping it is current. Drift is undetectable. |
| **`RP_ID` / `ORIGIN` missing from prod** — confirmed 2026-09-08 | Passkeys are broken in production and produce no error anywhere. Fix in [Audit results](#audit-results--2026-09-08). |
| **Dev and prod share one Resend key and sender** | Dev test sends go out as production-branded mail on the same quota and sending reputation |
| **Single-account blast radius** — hosting, DNS, and TLS all live in one Cloudflare account | Loss of access to that account takes the site down with no independent recovery path |
| **No staging environment** | Migrations are first exercised against production data during the prod deploy itself. Dev is the only rehearsal, and its data is not representative. |
| **No automated CD** | Every production release depends on one person with a working local toolchain, Docker running, and `gh` authenticated |
| **Prod PITR and retention not confirmed** | The rollback procedure offers PITR as an option without anyone having verified it is switched on. PITR is a paid add-on, so the default answer is "off". |

---

## Related Documentation

- [setup-guide.md](./setup-guide.md) — local development setup, plus per-service configuration detail
- [tech-stack.md](./tech-stack.md) — technology choices and rationale
- [database.md](./database.md) — schema, RLS policies, migrations
- [security-scheme.md](./security-scheme.md) — authorization model
- [AGENTS.md](../../AGENTS.md) — Supabase environment table and the verify-before-remote-command ritual
- [`deploy_prod.sh`](../../deploy_prod.sh) / [`deploy_dev.sh`](../../deploy_dev.sh) — the executable runbooks
