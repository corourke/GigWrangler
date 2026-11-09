# Tech Stack

**Purpose**: What GigWrangler is built from, and why each choice was made.

**Last Updated**: 2026-10-02

> Versions below are the constraints in [`package.json`](../../package.json), which is the source of truth. For how any of this reaches production, see [deployment.md](./deployment.md).

---

## Frontend

### Core

| Technology | Version | Role |
|---|---|---|
| **React** | 18.3.1 | Component-based UI |
| **TypeScript** | 5.9.3 | Strict mode, enforced by `npm run typecheck` in CI |
| **Vite** | 6.4.3 (pinned) | Build tool and dev server; outputs to `build/` |
| **react-router** | 7 | Client-side routing with real, deep-linkable URLs |
| **TanStack Query** | 5 | Server-state caching, invalidation, and refetching |

`react-router` and TanStack Query both arrived in the June 2026 remediation. Before that the app hand-rolled navigation in `App.tsx` and refetched imperatively, which meant no URL was shareable and no cache was shared between screens. Adopting them is what makes `/gigs/:id` bookmarkable and stops every screen re-querying the same rows.

### Styling and components

- **Tailwind CSS v4** via `@tailwindcss/vite` — utility-first, with design tokens in `src/styles/globals.css`. v4 needs no `tailwind.config.js`.
- **shadcn/ui** on **Radix UI** primitives — accessible components in `src/components/ui/`, owned in-tree rather than imported, so they can be customized without forking a dependency.
- **lucide-react** — icon set. **next-themes** — light/dark switching. **vaul** — mobile drawers.

### Forms, validation, data display

- **react-hook-form** + **zod** via `@hookform/resolvers` — uncontrolled forms with schema validation, wired into the shadcn `Form` components.
- **react-big-calendar** — calendar views (loaded only with the gig list screen). **react-day-picker** — date selection.
- **SmartDataTable** — the in-house sortable/filterable/column-customizable table. See [SmartDataTable.md](./SmartDataTable.md).
- **cmdk** — command palette. **sonner** — toasts. **react-resizable-panels**, **embla-carousel-react**, **input-otp**.
- **date-fns** — date maths throughout.

### Platform capabilities

| Technology | Purpose |
|---|---|
| **vite-plugin-pwa** (Workbox) | Installable PWA, service worker, `autoUpdate` registration |
| **idb** | IndexedDB wrapper backing offline storage |
| **@simplewebauthn/browser** | Passkey registration and authentication |
| **react-qr-barcode-scanner** | Camera barcode scanning for equipment workflows |
| **pdfjs-dist** | Client-side PDF rendering for receipts and attachments |
| **papaparse** | CSV parsing for gig and asset imports |
| **react-markdown** | Markdown rendering |
| **@sentry/react** | Error monitoring — no-op unless `VITE_SENTRY_DSN` is set |

---

## Backend — Supabase

Supabase provides the database, auth, storage, and serverless compute as one managed platform. For a solo-maintained product this removes most of the backend surface area that would otherwise need building and operating.

**PostgreSQL 17** with Row-Level Security as the multi-tenant isolation boundary — the single most important architectural decision in the system. Tenant separation is enforced by the database rather than by application code, so a missed check in a route handler cannot leak another organization's rows. See [database.md](./database.md) and [security-scheme.md](./security-scheme.md).

**Auth** — email/password plus Google OAuth, JWT sessions, with passkeys layered on via the WebAuthn routes.

**Storage** — one private `attachments` bucket for receipts, invoices and gig files; storage policies limit each file to its own organization.

**Realtime** — Postgres CDC over WebSockets for live updates.

**Auto-generated REST API** — consumed through `@supabase/supabase-js` for straightforward reads and writes; anything requiring secrets or multi-step logic goes through an edge function instead.

---

## Edge Functions

Three Deno functions under [`supabase/functions/`](../../supabase/functions/):

### `server` — the consolidated API

Built on **Hono 4** (`npm:hono@4`, re-exported through `deps.ts` so the version is pinned in one place). Hono supplies routing and middleware; auth and org-membership checks run as middleware rather than being repeated in every handler, which is what the June 2026 remediation replaced.

Routes are registered per domain from [`server/routes/`](../../supabase/functions/server/routes/):

| Route module | Responsibility |
|---|---|
| `users.ts` | User profile CRUD |
| `organizations.ts` | Org CRUD, membership, invitations |
| `accessRequests.ts` | Org claiming and access-request workflow |
| `gigs.ts` | Gig CRUD with participants and hierarchy |
| `calendar.ts` | Google Calendar OAuth exchange, listing, event sync |
| `notifications.ts` | The notification bell's unread feed and mark-as-read |
| `places.ts` | Google Places address search |
| `webauthn.ts` | Passkey registration and authentication |

Shared helpers live in `server/lib/`. Pure, dependency-free logic is deliberately split into `server/lib/pure/` so it can be unit-tested by the main Vitest suite — see `pure/authz.test.ts`.

### `ai-scan` — receipt and invoice extraction

Calls the **Anthropic API** (Claude, via `npm:@anthropic-ai/sdk`) to pull structured data out of uploaded receipts and invoices. The model and effort level are constants in `ai-scan/scanRequest.ts` (Claude Sonnet 5.5 at `low` effort since PR #113). PDF input requires a Tier 1+ Anthropic account; lower tiers handle images only.

### `health-check` — daily API health check

Called once a day by a `pg_cron` + `pg_net` job, not by users. It checks Supabase, Google Places and (when its secrets are set) Sentry, and sends each platform moderator a notification when a check fails (once per check until it is read). It is a separate function because the cron authenticates with its own bearer token rather than a Supabase JWT, so JWT verification is switched off for this function alone. Setup is in [deployment.md](./deployment.md).

### Shared

[`_shared/`](../../supabase/functions/_shared/) holds `cors.ts` (pinned-origin CORS) and `sentry.ts` (error capture with explicit flush before the isolate tears down). It is not itself a deployable function.

**Transactional email** goes out through **Resend**, called with a raw `fetch` from `server/lib/email.ts` rather than pulling in an SDK — matching how the Google Places call is written.

---

## Testing

- **Vitest 4** with **jsdom** — `npm run test:run` in CI.
- **@testing-library/react** + **user-event** — component tests driven through the DOM rather than through internals.
- Test files are co-located (`*.test.ts[x]`). The include glob is repo-wide, so edge-function tests under `supabase/functions/server/lib/pure/` run in the same suite as frontend tests.
- **ESLint 10** flat config (`eslint.config.js`) and **TypeScript strict mode**, both gating CI and `deploy_prod.sh`.

See [testing.md](../development/testing.md).

---

## Hosting

Cloudflare Pages for the frontend, Supabase for everything server-side, DNS in the same Cloudflare account. Deploys are manual via `./deploy_prod.sh`. Full detail — pipeline, environment variables, secrets, rollback — in [deployment.md](./deployment.md).

---

## Repository Layout

```
src/
├── App.tsx              # Root component
├── main.tsx             # Entry: Sentry init, QueryClient, AuthProvider
├── routes/              # react-router route definitions
├── components/
│   ├── ui/              # shadcn/ui primitives — avoid restructuring
│   ├── mobile/          # Mobile-specific screens
│   └── *.tsx            # Feature screens
├── contexts/            # Auth, navigation
├── hooks/               # Custom hooks, incl. TanStack Query wrappers
├── services/            # *.service.ts — API and business logic
├── lib/                 # queryClient and shared setup
├── utils/               # Helpers, Supabase client, IndexedDB
├── types/               # Shared TypeScript types
├── config/              # Config and seed data
├── styles/globals.css   # Tailwind v4 tokens
└── test/                # Vitest setup and helpers

supabase/
├── functions/           # Deno edge functions
├── migrations/          # SQL migrations — never edit a committed one
└── seed.sql             # Local dev seed data
```

---

## Related Documentation

- [deployment.md](./deployment.md) — how all of this ships to production
- [database.md](./database.md) — schema, RLS policies, migrations
- [security-scheme.md](./security-scheme.md) — authorization model
- [server-endpoint-inventory.md](./server-endpoint-inventory.md) — `server` edge function endpoints and their authorization
- [coding-guide.md](../development/coding-guide.md) — conventions and patterns
