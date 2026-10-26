# Tenant Isolation Architecture — Options Analysis

**Purpose**: Evaluate realistic architectures for giving each organization a *credible, verifiable guarantee that the operator (Cameron) cannot read its data*, while preserving a narrow cross‑org sharing layer (shared gig core + busy/free availability). Architecture exploration to inform a direction decision. **No implementation.**

**Status**: Decided 2026-09-25: hosted, shared database (see "Decision" below). The options analysis is kept for context.
**Last Updated**: 2026-09-25
**Figures are as of 2026-09-25** (checked against the code 2026-10-16): the repo now has 73 migrations (the text says 42), the `server` function has 8 route files (`accessRequests`, `calendar`, `gigs`, `notifications`, `organizations`, `places`, `users`, `webauthn`) rather than ~6, and there is a third edge function, `health-check`, beside `server` and `ai-scan`. Policy and call-site counts below have not been recounted. The analysis and the decision are unaffected.
**Related**: [security-scheme.md](./security-scheme.md), [database.md](./database.md), [tech-stack.md](./tech-stack.md), [server-endpoint-inventory.md](./server-endpoint-inventory.md), and [schema-verification-2026-09.md](./schema-verification-2026-09.md) — the committed write-up of the 2026‑09‑02 live-database verification that motivated this document (the confirmed `gig_financials`/staffing/kit-assignment cross-org leaks in §1's "requirement" are documented there in full, with the actual policy text).

---

## Decision (2026-09-25)

**GigWrangler stays a hosted-only platform on a shared, multi-tenant database: Option A (§5), shared DB + RLS
with the policies fixed.** Cameron decided this because a non-hosted product gives up too much functionality.
A future installable client may run against GigWrangler's APIs, but a hosted component and a hosted database stay
central. Options B–I and Tiers 2–3 are not being pursued. Tier 0 and Tier 1 remain available later as hardening
*on top of* the shared model; they are not alternatives to it.

What this means in practice:

- **Tenant isolation is RLS's job and has to be correct now.** §9 step 7 ("skip the in-place RLS fixes") no
  longer applies. The remaining #61 leaks are fixed in place.
- **Every table is either org-private or deliberately shared, never private by accident.**
  - An org-private table has a `NOT NULL organization_id`. Its policies check that org
    (`user_is_member_of_org` / `user_is_admin_or_manager_of_org`) and have no gig-participation fallback.
    Examples: `assets`, `kits`, `gig_financials`, staffing, kit assignments, `inventory_tracking`.
  - A shared table is visible to every participating org by design and says so in
    [security-scheme.md](./security-scheme.md). Examples: `gigs`, `gig_participants`, `gig_schedule_entries`.
- **Isolation is tested, not just asserted.** `supabase/tests/rls/` applies every migration to a throwaway Postgres
  and checks what each role in each org can see and do, including a second org on the same gig and an unrelated
  third org. A new private table, or any policy change, should come with a test there.
- **An installable client doesn't change this.** It talks to the same APIs as the web app, so the same RLS applies
  to it.

---

## Executive summary

**The reframe changes the question from "how separate" to "what guarantee, and can the org check it."** Every "operator can't read it" mechanism sits on a trust ladder: **level 1 — policy promise** ("we don't look"), undoable unilaterally and often invisibly by anyone with DB credentials and deploy rights — how essentially all SaaS runs; **level 2 — structural**, where access is still possible but leaves evidence or needs collusion (break‑glass workflows, externally‑held audit logs, SOC 2 controls an auditor checks yearly); **level 3 — cryptographic / hardware‑enforced**, where the operator doesn't hold the keys, or can only decrypt inside an environment it can't observe, or only with the customer's live, logged cooperation — the only level that survives a hostile operator with full infrastructure control. The requirement is asking for level 3, or a level‑2 arrangement the target customer actually believes. Almost every *topology* option on its own — shared DB, schema‑per‑tenant, database‑per‑tenant, project‑per‑tenant on Supabase — is **level 1**: physical separation under infrastructure Cameron runs still means Cameron holds the credentials. Separation alone doesn't deliver the guarantee; a mechanism from §3 has to be layered on top.

**The mechanisms that attack this directly, with honest costs:**

- **Client‑side E2E encryption, tenant‑held keys** — true level 3, verifiable by reading the client code. But Postgres can't index, filter, sort, join, or aggregate ciphertext, so concretely: financial totals and per‑gig P&L break (aggregation is SQL today), sorting/filtering lists by amount/vendor/notes breaks, full‑text search breaks, and **the AI receipt scan breaks by design** (it needs the image, returns plaintext). Plus a real key‑management system where a lost key means unrecoverable data. Not a bolt‑on — only viable if the product is repositioned around it.
- **Searchable field‑level encryption (CipherStash‑style), key in the org's KMS** — the practical middle. Encrypted values carry blind‑index metadata so equality/range queries, sorts, and joins still work server‑side; lists still sort and filter, foreign keys work. **Aggregates still break** (totals move client‑side), and the AI scan still needs plaintext. The org holds the key and audits every decrypt; disable the key and Cameron's copy is ciphertext. Best fit for "don't make the product unbuildable."
- **BYOK / hold‑your‑own‑key in the org's KMS** — real revocation and org‑held audit, but **it's level 2 dressed as crypto**: if Cameron's app decrypts to serve requests, plaintext is in Cameron's memory at decrypt time. Protects data at rest and gives a clean exit; does not blind the running operator.
- **Confidential computing / TEEs** — the only approach where the operator running the compute genuinely can't read it. Production‑grade primitives exist at all three major clouds, but the tooling assumes a team that can build reproducible enclave images and run attestation verifiers. Disproportionate for a solo/small‑team product unless operator‑exclusion becomes the entire pitch.
- **Escrow / split‑key** — a governance layer for "no single party can act alone," not a primary mechanism.
- **The boring answer — SOC 2 + DPA + immutable operator‑access logs + reputation** — level 1/2, and it's how Stripe, Salesforce, and QuickBooks hold financial data for millions of businesses. Legitimately enough if customers compare GigWrangler to other cloud SaaS. Not enough when a customer is a known competitor of another customer, or when the pitch is explicitly "unlike the others, we can't see your data."

**Federation gets harder under encryption, not easier.** If org A's data is under A's key and B's under B's, a shared gig row can't use either. The answer: draw the encryption boundary around the *private* data only and keep the shared core (dates, status, participants, explicitly‑shared attachments) as a small cleartext hub projection — it's the data multiple orgs see by definition, so nothing new leaks. Busy/free across encrypted stores is its own problem, solved the same way calendaring has solved it for decades (RFC 7953 / Exchange free/busy federation): each org's spoke computes a redacted "P is busy [range]" from its own locally‑decrypted data and publishes only that. Firm rule: *nothing tenant‑encrypted ever needs to federate; anything that must federate was never private.*

**Automatic provisioning is real but doesn't solve the read problem by itself.** Supabase's Management API creates projects programmatically; Neon is better built for per‑tenant fleets (scale‑to‑zero, a PostgREST‑compatible Data API so GigWrangler's 232 data‑layer calls would survive a move). But **if Cameron's automation creates the project under Cameron's account and stores the credentials, Cameron can read all of them** — provisioning just multiplies the problem. For provisioning to also deliver the guarantee, the project must live in the *org's own* cloud account with Cameron connecting via org‑issued revocable credentials (bring‑your‑own‑database, automated), or the data must be encrypted with keys Cameron never holds. Applying migrations to N projects needs a fleet migration runner with per‑project version tracking, canary rollout, and code that tolerates version skew — a failed migration partway through leaves the fleet in several schema versions at once.

**Recommendation — tiered, because the tiers stack:**

- **Tier 0 (now, everyone):** SOC 2 Type II + DPA + least‑privilege prod access + externally‑held immutable logs of every operator query. Clears the default market bar; prerequisite for selling anything stronger credibly.
- **Tier 1 (the recommended core investment):** searchable field‑level encryption on the sensitive columns with the key in the org's own KMS. Keeps the product buildable; costs server‑side financial aggregation and the AI scan in their current form. Guarantee: "operator can't read the DB, can only decrypt transiently in‑request with your audited key" — honestly level 2.5, not level 3.
- **Tier 2 (premium, for orgs that won't accept shared infra):** automated provisioning of a per‑tenant Neon/Supabase project *in the org's own account*, Cameron connecting via revocable credentials. Their cloud, their keys, their logs. Costs onboarding friction, roughly linear ops, and the fleet‑migration machinery.
- **Tier 3 (only if operator‑exclusion becomes the product):** confidential‑computing enclaves or trimmed client‑only E2EE. Defer.
- **Federation across all tiers:** hub‑and‑spoke; the hub holds only the minimized cleartext shared core + opt‑in busy/free projection; private data never crosses.

**Option H — locally‑installable app (§11), evaluated separately.** It solves the trust problem completely and for free (data never touches Cameron's infra; a skeptic verifies with a packet capture), but it changes the *product*: pure local‑install gives up multi‑user‑without‑setup, first‑class mobile field use, and backups the customer can't lose, and it needs a quarter‑plus of Supabase‑teardown work (data layer, auth, storage, realtime, the edge functions — keep Postgres + PostgREST so the 232 data‑layer calls survive). In‑org RBAC (Admin/Manager/Staff/Viewer) currently lives in RLS + the edge function; with no server it's either advisory or a local privileged process. Multi‑user, federation between sometimes‑asleep laptops, and backups all push a small always‑on relay back into the picture — a shrunk Option‑G hub that reintroduces a *bounded* trust surface (participant graph + busy/free, never financials). **Verdict:** a viable direction for a *smaller* product (solo operators), or as **H‑a** (local‑first + optional encrypted sync, à la Actual Budget — depends on a sync engine; PowerSync is the least‑risky 2026 bet) / **H‑c** (hybrid, two stacks forever). Not a drop‑in substitute for the tiers: Tier 1 reaches "we can't read your books" without giving up the hosted product's core value.

**Option I — self‑serve self‑hosting (§12): the strongest operator‑exclusion option for a team‑based product, and it appears to beat both Tier 1 and Option H.** The org creates and owns its own Supabase project (their account, billing, credentials); GigWrangler installs against it via a wizard; Cameron never has access. A separate **opt‑in** relay carries only a thin scheduling/busy‑free signal. The whole stack stays intact — RLS, Supabase Auth, Storage, Realtime, the 2 edge functions, the PWA, multi‑user‑within‑an‑org, server‑side reporting — because it all runs in the org's project. **Level‑3 guarantee by ownership, nothing to verify beyond the (source‑available) code, and no feature sacrifice.** The costs are real but bounded: (1) **onboarding friction** — the org must become a Supabase customer (account, card, Pro plan or the project pauses); a one‑click provisioning wizard + a Cameron‑hosted frontend (the anon‑key + RLS model means hosting the static frontend leaks nothing) get this close to a hosted signup. (2) **Cameron loses the single deploy** — 46 migrations must self‑apply across N unseen installs forever; every migration skip‑safe, a bounded‑skew policy like Home Assistant / OneUptime, an in‑app migration runner + compat gate. This is the biggest permanent tax. (3) **Support with zero access** — needs shipped diagnostics, redacted support bundles, preflight health checks, a docs site + forum. (4) **Revenue is indirect** — commercial license (BSL 1.1 or FSL — source visible for verifiability, competing hosted service blocked for a few years) + paid federation tier + the hosted convenience product. **Verdict:** make Option I the "self‑hosted tier" beside hosted Tier 0/1; it **subsumes Tier 2** (it *is* Tier 2 with the org owning the account outright). It dominates Option H for a multi‑user product — H only wins on "no internet at all." Realistic v1: **~5–7 months** solo, front‑loadable into a ~3‑month "self‑host without federation" milestone + a ~3‑month federation milestone — comparable to Tier 1's cost, with a strictly better guarantee and no lost features.

**The honest bottom line:** nothing here is free. Verifiable operator‑exclusion costs either features (Tier 1), onboarding friction and ops (Tier 2), or a disproportionate engineering investment (Tier 3). Tier 1 is the smallest thing that gives a target org a guarantee it would believe while keeping the product shippable.

**The questions that would most change the recommendation:** (1) Are server‑side financial aggregation and the AI receipt scan non‑negotiable? (2) Will target orgs connect their own cloud account / KMS? (3) Is the bar "better than the other cloud SaaS" or "provably can't see it, like a password manager"? (4) How many orgs, what size? (5) Is "Cameron cannot read it" truly hard, or is "not commingled, revocable, portable on exit" enough? (6) Are orgs *teams* with core mobile field use, or mostly solo‑at‑a‑desk? — the last decides whether Option H is even a candidate. See §10 for the full list.

---

## 1. The requirement, restated

The goal is **not** physical separation for its own sake. Cameron's framing:

> "If there was a reliable and verifiable way to keep me from being able to read their data, maybe we would not need tenants to spin up their own instance."

So separate instances are one *means*; the *end* is an operator‑exclusion guarantee an org would actually believe and could actually check. A pooled or shared architecture stays on the table if it can deliver that.

Two things still have to hold no matter which architecture wins:

1. **Narrow federation.** Even with the operator excluded:
   - **Shared gig core** — one logical gig several orgs participate in: dates, status, title, tags, hierarchy, and only the attachments/notes each participant explicitly marks shared. Participating orgs read; participating managers write.
   - **Availability signal** — "person P (or org O) is busy on range D," optionally "…for org O," with **no gig details**, potentially visible to orgs *not* on the gig.
   Encryption makes this *harder*, not easier (§4.2).

2. **Identity.** One person often works for several orgs. Today that's one `auth.users` row and one login. Splitting auth systems fractures that unless identity stays centralized.

### 1.1 The trust ladder — what a "guarantee" is actually worth

Every "Cameron can't read it" mechanism sits at one of three levels. **Be honest about which level each option delivers**, because a level‑1 promise dressed in security language is still a promise.

| Level | What it is | Can an operator with DB creds + deploy rights undo it? | Example |
|---|---|---|---|
| **1 — Policy promise** | "We don't look." Contract, privacy policy, internal access rules, "only two employees have prod access." | **Yes, unilaterally, often invisibly.** | How essentially all SaaS runs. |
| **2 — Structural / procedural** | Access is technically possible but leaves evidence or needs cooperation: break‑glass workflows, append‑only audit logs held off‑box / by a third party, separation of duties, SOC 2 controls checked yearly by an auditor. | **Yes, but not silently and usually not alone** (needs collusion or leaves a trail). | AWS/GCP internal access controls; SOC 2 Type II. |
| **3 — Cryptographic / hardware‑enforced** | The operator doesn't hold the keys, or holds them only inside an environment it can't observe (TEE + attestation), or can only decrypt with the customer's live, logged cooperation (HYOK/EKM). | **No** — undoing it means breaking crypto, compromising the customer's KMS, or defeating hardware attestation. | Client‑side E2EE; confidential computing with remote attestation; hold‑your‑own‑key. |

The requirement is asking for **level 3**, or a **level‑2 arrangement strong enough that the target customer believes it**. Most options in §3–§5 land at level 1 or 2 unless explicitly paired with a mechanism from §3.

### 1.2 Verification — the other half

A guarantee the org can't check is a nicer‑sounding policy promise. Verification paths, strongest first:

- **Hold your own key, watch your own KMS logs.** Every decryption is a line item in *the org's* audit log; the org can deny any unwrap. Self‑verifying by construction. (Level 3.)
- **Open source + reproducible build + runtime attestation** that the running binary is that source. The org (or a researcher) can verify without trusting the operator. (Level 3; see [AWS: reproducible builds + Nitro Enclaves](https://aws.amazon.com/blogs/web3/establishing-verifiable-security-reproducible-builds-and-aws-nitro-enclaves/), [Kettle / attestable builds](https://arxiv.org/pdf/2505.02521v1).)
- **Independent audit / SOC 2 Type II / pentest report.** You trust the auditor, not the operator. (Level 2.)
- **Published IaC + immutable, externally‑held operator‑access logs** the org can subscribe to. (Level 2.)
- **Run it yourself.** Verification by ownership — but that's the "spin up your own instance" path Cameron wants to avoid.

---

## 2. What GigWrangler is today (grounding for the estimates)

| Layer | Implementation | Coupling / portability |
|---|---|---|
| Frontend | React 18 + Vite → **Cloudflare Pages** (`wrangler pages deploy`) | Backend URL baked at build time (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`). One backend per build. |
| Data API | Supabase **PostgREST** — **232 `.from()` + ~20 `.rpc()` call sites across 16 service modules** | Portable to any PostgREST‑dialect endpoint (self‑hosted Supabase, Neon Data API). A rewrite to a SQL client otherwise. |
| Tenancy | **RLS: 61 policies, 43 SECURITY DEFINER functions**; `organization_members` = join + RBAC; `gig_participants` = gig↔org M:N | The product's security model. Collapses to near‑nothing in a one‑tenant‑per‑DB world; the *shared‑core* tables still need policies. |
| Auth | Supabase Auth — **42 call sites**, centralized in `src/contexts/AuthContext.tsx`; Google OAuth + email/password + magic link; JWT drives RLS via `auth.uid()` | **The lock‑in.** OAuth wiring + JWT issuance + `auth.users` are Supabase‑platform logic. Biggest single lift to replace. |
| Storage | Supabase Storage — **3 call sites**, one private bucket `attachments`, `{org_id}/{file}` paths, 1‑hour signed URLs | Light. An `AttachmentStore` interface over S3/R2/MinIO is days. |
| Realtime | `postgres_changes` — **2 subscriptions** (`AuthContext` user row, `useTeamData` org members) | Light. Droppable / pollable. |
| Edge functions | **2** Deno: `server` (Hono, service‑role, ~6 route groups, re‑implements the intersection check) and `ai-scan` (Anthropic receipt OCR proxy) | Portable to Deno Deploy / containers. |
| Migrations | **42**, linear, `supabase db push`. `deploy_prod.sh`: gate on CI‑green + `origin/main` sync → schema+data backup → `db push` (expand‑only) → `functions deploy` → Pages deploy → smoke check. **One target.** | Single‑target script; no fleet concept. |
| Schema | ~25 public tables, ~70 FKs, 17 enums. Every tenant table has `organization_id → organizations(id) ON DELETE CASCADE` (two nullable: `gig_financials`, `gig_staff_slots`). | Small. |

**Takeaways:** the data layer is portable *iff* a PostgREST endpoint is preserved. Auth is the lock‑in. Storage/realtime are noise. The ops machinery assumes exactly one backend. Nothing today encrypts anything above the disk — Supabase (and thus Cameron) can read every byte.

---

## 3. Operator‑exclusion approaches

These are mechanisms, not topologies. Any one can be layered onto the topologies in §5. Each is scored on the guarantee it gives, how an org verifies it, and what it costs GigWrangler concretely.

### 3.1 Client‑side / end‑to‑end encryption, tenant‑held keys

**Mechanism.** The frontend encrypts sensitive fields before they reach PostgREST, with a key the server never sees. The DB stores ciphertext. Edge functions and Cameron see ciphertext only.

**Guarantee / verification.** Level 3. Verifiable by reading the client code (which runs on the org's machines) and confirming keys never leave.

**What breaks in GigWrangler — concretely.** Postgres can't index, filter, sort, join, or aggregate ciphertext. Everything that relies on the database doing work on a *value* moves to the client or dies:

| Feature | Under naive E2EE | Path forward |
|---|---|---|
| Financial totals, per‑gig P&L, org Financials reporting (`gig_financials`/`purchases` SUM/GROUP BY, `create_purchase_transaction_v2`) | **Breaks.** Aggregation is SQL today. | Pull rows to client and total there (fine at 100s, bad at 10,000s), or maintain a client‑written encrypted running total. Conflicts with the [reporting‑gap](../product/reporting-gap-202608.md) roadmap, which wants *more* server aggregation. |
| Sort/filter lists by amount/category/vendor/notes | **Breaks for encrypted columns** (`.order()`, `.eq()`, range filters over PostgREST). | Dates/status/ids stay cleartext (low‑sensitivity, shared anyway); sensitive columns need client‑side sort/filter or searchable encryption (§3.2). |
| Full‑text search (vendor, description, notes) | **Breaks** — no `ilike`, no `tsvector`. | Client‑side search, or blind‑index equality via §3.2. |
| **AI receipt scan** (`ai-scan` → Anthropic) | **Breaks by design** — needs the image, returns plaintext fields. | Run fully client‑side (browser → Anthropic with the *org's own* API key, never touching Cameron's server), or make receipt‑scan an explicit plaintext‑in‑transit opt‑in. The sharpest "needs plaintext" example. |
| `server` intersection authz | **Survives** — checks ids/membership, not payloads. Ids stay cleartext. |
| Conflict detection | **Survives** — already client‑side, operates on ids + dates. |
| Realtime | **Survives** — notifications carry ids; client decrypts. |
| Google Calendar sync of gig title | **Partially breaks** — needs plaintext title server‑side unless sync moves client‑side. |

**Key management is the real project.** A tenant key only the org holds means solving: where it lives (admin password‑derived? key file every user imports? org KMS?), how new users get it (wrap the data key to each user's public key on invite), offboarding (rotate + re‑encrypt), and loss (**data is gone; Cameron cannot help** — that's the point and the liability). This is a cryptographic access‑control system, not a library call. Months, plus a permanent "we lost our key" support channel that ends in data loss.

**Verdict.** Real level‑3 guarantee. Costs server‑side reporting, search, and the AI scan in their current form, plus a key‑management system. Viable only if the product is *repositioned* around "encrypted, we genuinely can't see it" and the feature set is trimmed to match. Not a bolt‑on.

### 3.2 Searchable / queryable field‑level encryption (CipherStash‑style)

**Mechanism.** Fields encrypted at the app layer with per‑value keys, stored *with* searchable encrypted metadata (blind indexes, order‑revealing tokens) that let Postgres filter/sort/join without decrypting. Decryption only in the authorized client. **[CipherStash ships this for Postgres with a Supabase integration](https://supabase.com/blog/searchable-field-level-encryption-with-cipherstash)**; keys held in the org's own KMS ("ZeroKMS"). [MongoDB Queryable Encryption](https://www.mongodb.com/company/blog/product-release-announcements/queryable-encryption-expands-search-power) is the analogue (GA targeted 2026 — not production‑ready before then).

**Guarantee / verification.** Level 3 for confidentiality of the encrypted columns (server sees ciphertext + metadata, never plaintext), with a caveat: blind indexes leak *some* structure (equality patterns, order). Keys in the org's KMS → the org audits every key op.

**What survives vs §3.1.** Equality + range queries, sorts, and joins work on encrypted columns — gig/purchase lists still sort by amount server‑side, category filters work, FKs work. Full‑text is partial (blind‑index equality, not `ilike`). **Aggregates (SUM/AVG) still break** — order‑revealing metadata doesn't let the server add ciphertexts — so financial totals still move client‑side or to a client‑maintained rollup. The `ai-scan` problem is unchanged.

**Costs.** A Postgres proxy or client lib in the data path, per‑column encryption config, org‑KMS integration, added latency, and a dependency on a third‑party crypto product (or its OSS core).

**Verdict.** The most practical way to remove operator read access from the sensitive columns while keeping GigWrangler feeling like a normal app. Best fit for "don't make the product unbuildable."

### 3.3 Tenant‑managed keys in the org's KMS (BYOK / HYOK / EKM)

**Mechanism.** Data encrypted at rest with a key in a KMS the **org** controls — AWS KMS in their account, or an external HSM via [AWS XKS](https://cpl.thalesgroup.com/encryption/amazon-web-services-aws/external-key-store-xks) / [Google Cloud EKM](https://cloud.google.com/blog/ja/products/identity-security/hold-your-own-key-with-google-cloud-external-key-manager). Cameron's infra calls the org's KMS to decrypt. The org can rotate/disable/delete the key (killing access) and sees every unwrap **in its own logs**. Precedent: Salesforce Shield, Snowflake Tri‑Secret Secure.

**Guarantee / verification.** **Level 2 dressed as crypto — say this plainly.** BYOK/EKM protects data *at rest* and makes revocation + audit real and org‑held. But if Cameron's app decrypts to run queries / render pages / aggregate, the plaintext is in Cameron's memory at decrypt time, where a hostile operator could log it. It does **not** blind the running operator. To get level 3 from this, the decrypt must happen where Cameron can't observe → §3.4.

**Costs.** KMS integration, per‑request or per‑session unwrap latency, and it only bites if paired with app‑layer field encryption (BYOK on just the disk protects against a stolen disk, not against Cameron).

**Verdict.** Honest enterprise middle. Real value: revocability, org‑held audit, "the DB dump is useless without our key." Pair with §3.2 so the KMS key actually gates the sensitive data. Sells well to security teams who know exactly what it does and doesn't do.

### 3.4 Confidential computing / TEEs

**Mechanism.** Cameron's decrypt/query path (edge functions, or a small service) runs in a hardware enclave — [AWS Nitro Enclaves](https://aws.amazon.com/blogs/web3/establishing-verifiable-security-reproducible-builds-and-aws-nitro-enclaves/), Azure Confidential VMs, GCP Confidential Space. The enclave *attests* (proves which code image it runs) to the org's KMS, which releases the key only to a build the org has vetted. The host operator sees ciphertext in, ciphertext out, and an attestation quote — not plaintext, not keys.

**Guarantee / verification.** Level 3, and the only approach where "the operator running the compute still can't read it" is true. Verified via reproducible enclave image + attestation. Caveat: you still trust the CPU vendor and cloud; recent research ([SoK: a cloudy view on trust relationships of CVMs](https://arxiv.org/pdf/2503.08256)) argues public‑cloud CVMs fall short of the marketing.

**Maturity (2026), honestly.** Primitives are production‑grade at all three major clouds; overhead <5% ([backend confidential computing 2026](https://thebackenddevelopers.substack.com/p/confidential-computing-for-backends), [AWS/Azure/GCP guide](https://cloudandclear.uk/confidential-computing-aws-azure-gcp/)). But the tooling assumes a team that can build reproducible enclave images, run an attestation verifier, manage KMS release policy, and debug workloads with no shell and no persistent storage (Nitro Enclaves have no disk, no network by design). **For a solo/small‑team product this size, disproportionate** unless operator‑exclusion becomes *the* product.

**What still doesn't work.** Postgres isn't in the enclave. Either the DB stores ciphertext and the enclave is a decrypt/query gateway (back to §3.2's constraints for anything the DB must filter/sort/aggregate), or you run confidential Postgres and accept the operational strangeness. `ai-scan` from inside an enclave needs an attested outbound proxy — more plumbing.

**Verdict.** Right tool for a confidentiality‑is‑the‑pitch company. Premature here. Revisit if the market demands level 3 and §3.2 + §3.3 prove insufficient.

### 3.5 Escrow / split‑key / threshold

**Mechanism.** Shamir‑split the data key so decryption needs k‑of‑n parties (org + Cameron + independent escrow agent), or a neutral third party releases the key only under defined, logged conditions ("break‑glass").

**Guarantee / verification.** Governance layer, not a standalone answer. Gives "no single party, including Cameron, can act alone" and a business‑continuity path ("if the org disappears, a defined process recovers their data").

**Costs.** Legal + operational: who's the third party, what triggers release, who pays, what's the SLA.

**Verdict.** Worth it only for specific continuity/compliance demands. Layer onto §3.1–3.3; not primary.

### 3.6 The boring answer: contracts + audits + reputation

**Mechanism.** Level 1/2. A DPA legally barring data access except for defined support; **SOC 2 Type II** with an access‑control section a third party tests yearly; least‑privilege prod access with break‑glass; **immutable, externally‑held audit logs of every operator query**; annual pentest; cyber‑insurance.

**When it's legitimately enough.** This is how Stripe, Salesforce, QuickBooks, and essentially every vertical SaaS holds financial + operational data for millions of businesses. If GigWrangler's customers compare it to *other cloud SaaS* (not to self‑hosting), a credible SOC 2 + DPA + a clear access‑log story clears the bar for most of them.

**When it isn't.** When a customer is a known competitor of another customer (the scenario in the brief), when a large customer's security team runs a real vendor review, or when the pitch is explicitly "unlike the others, we can't see your data." Then level‑1/2 reads as "trust me" and loses to a competitor offering BYOK or self‑hosting.

**Verdict.** The right *first* move regardless — table stakes, unlocks most of the market. Necessary, not sufficient, for the orgs that triggered this requirement.

---

## 4. Federation

### 4.1 Federation primitives (the menu every topology picks from)

| # | Mechanism | Shape | Good for | Bad at |
|---|---|---|---|---|
| F1 | **Central shared table** — gig core in one DB all parties reach | Sync, single copy | Simplicity, strong consistency | That DB is an availability + trust chokepoint |
| F2 | **Replication / event stream** — authored in a "home" DB, CDC‑streamed to participants | Async, N copies | Local readable copy; survives hub outage for reads | Eventual consistency; must define the writer; schema changes don't replicate |
| F3 | **`postgres_fdw` foreign tables** — spokes mount hub gig‑core tables | Sync, transparent SQL | No app changes; joins "just work" | Cross‑DB joins over the internet are slow/fragile; pins spokes to hub uptime; Supabase pooler makes inbound FDW awkward |
| F4 | **API federation** — hub exposes REST/RPC; spokes call it | Async or sync, explicit | Portable, versionable, auditable, firewall‑friendly | Most code; you're building a mini‑protocol |
| F5 | **Free/busy publish‑subscribe** — each side publishes a redacted availability feed. Precedent: **[RFC 7953 Calendar Availability](https://www.rfc-editor.org/rfc/rfc7953.html)**, **[Microsoft Exchange federation trust](https://learn.microsoft.com/en-us/exchange/shared-free-busy)** for cross‑org free/busy | Async, redacted by construction | Exactly the availability requirement; mature, standardized | Solves availability only, not the shared gig core |

The availability layer maps almost perfectly onto **F5** — cross‑org free/busy has been a solved calendaring problem for 20 years. The shared gig core is the harder half and needs F1–F4.

### 4.2 Federation *under encryption* — the new hard part

Encryption makes federation worse. Two sub‑problems:

**Shared gig core.** If org A's data is under A's key and B's under B's key, a shared row can't be encrypted with either. Options:

- **Draw the encryption boundary around the private data only; the shared core stays cleartext** (or platform‑encrypted, protecting against outside attackers but not the hub operator). The shared fields are *by definition* the ones multiple orgs see — dates, status, title, participants, explicitly‑shared attachments — so this exposes nothing that wasn't already destined to be cross‑org. **Recommended.** Cost: the hub operator sees the participant graph + timing + shared titles (the residual disclosure — minimize with opaque gig ids and per‑participant titles kept spoke‑side).
- **Group encryption.** The shared row is encrypted to a key shared by exactly the participating orgs (key‑agreement when a participant joins). Hub stores ciphertext it can't read. Strong, but: re‑key on every participant change, the hub can't index or validate anything, and it's a real protocol to build and support. Overkill unless shared‑core confidentiality *from the hub operator* is itself a hard requirement.

**Busy/free across encrypted stores.** A non‑participating org can't query person P's home org's encrypted staffing table. Realistic approaches:

- **Each org publishes a redacted cleartext feed.** The home spoke computes "P busy [range], org=O (optional)" from its own locally‑decrypted data and pushes that minimal projection to the hub. This is the **F5 / RFC 7953** model and it sidesteps encryption entirely — the only thing crossing is the busy bit the org chose to publish. **Recommended.** Tradeoff: the hub sees a bare busy calendar (no details). Make it opt‑in per org, with a "publish busy without identity" mode.
- **Secure two‑party computation** ("do our calendars overlap" without revealing them). [Real academic protocols exist](https://encrypto.de/papers/KSS19.pdf); heavy, high‑latency, hard to operate at N‑org scale. Not warranted for a busy/free indicator.
- **Token‑scoped pull.** Home org exposes an authenticated endpoint; a consumer with a "considering booking P" token gets yes/no for a date range, rate‑limited and logged. Data stays home, no standing hub copy — but more moving parts and the home org must be online.

**The firm rule this yields:** *nothing tenant‑encrypted ever needs to be federated; anything that must be federated was never in the private set.* Keep the shared + availability layer a small, cleartext, opt‑in, minimized projection.

---

## 5. Topology options

Ordered least→most isolation. Each now carries an **operator‑read guarantee** line (what stops Cameron reading it, at which trust level) and a **skeptic's verification** line.

### A — Shared DB + RLS (status quo, policies fixed)

- **Isolation:** logical only. One Postgres, `organization_id` + 61 RLS policies.
- **Operator‑read guarantee:** **none / level 1.** Service‑role key and DB password give full read. RLS doesn't apply to Cameron.
- **Skeptic's verification:** nothing to verify — it's a policy promise.
- **Shared core / availability:** trivial, it's the current model; derived availability table with its own RLS.
- **Cost / burden / upgrades / auth / failure:** lowest / zero / one `db push` / unchanged / single blast radius.
- **Verdict:** correct + cheap for trust‑the‑vendor SaaS; fails the requirement outright. Baseline and likely the offering for orgs that don't care.

### B — Schema‑per‑tenant (one Postgres, one schema per org)

- **Isolation:** medium‑logical. `search_path` + `GRANT`s.
- **Operator‑read guarantee:** **level 1.** Superuser (Cameron, Supabase) still sees all schemas.
- **Skeptic's verification:** none.
- **Shared core / availability:** a `shared` schema, read directly (same DB); write gated by a membership function.
- **Cost / upgrades:** still one instance, but 42 migrations × N schemas with partial‑failure handling, and PostgREST per‑schema exposure fights Supabase's model.
- **Verdict:** weak middle — keeps every shared‑instance drawback, harder migrations, swims against Supabase. Most of B's isolation is also in C with real physical separation.

### C — Database‑per‑tenant on infra Cameron runs

- **Isolation:** strong, physical. One managed Postgres cluster, `CREATE DATABASE` per tenant.
- **Operator‑read guarantee:** **level 1** (Cameron runs the cluster and can connect) — *unless* combined with §3.2/§3.3 so the sensitive columns are ciphertext under the org's KMS key, which lifts it to level 2–3.
- **Skeptic's verification:** none by itself; with org‑KMS field encryption, the org's KMS logs.
- **Shared core:** separate `shared` DB, reached via F3 (FDW, all on one private network) or F4.
- **Availability:** `shared.availability` fed by F2/F4 (trigger → outbox → worker upserts redacted projection).
- **Cost:** linear‑ish per tenant (backups, monitoring, tuning, migrations, a provisioning service); you're the DBA. No Supabase platform fee.
- **Upgrades:** fleet migration runner, canary, per‑DB version tracking. Real but well‑trodden.
- **Auth:** central IdP (self‑hosted Supabase Auth, Ory, Auth0, Clerk); `auth.users` leaves the tenant DB.
- **Failure:** cluster outage = everyone (unless multi‑AZ); one tenant's runaway query is well‑isolated; `shared` down = degrade (no new shared gigs / stale availability), private data keeps working.
- **Supabase coupling:** drops the platform; must replace Auth (big), Storage/Realtime (small), run your own PostgREST (the 232 `.from()` calls survive).
- **Verdict:** strongest option that keeps Cameron operating everything centrally. **Only meets the guarantee when paired with §3.2/§3.3.**

### D — Project‑per‑tenant on Supabase (N projects under Cameron's org)

- **Isolation:** strong, physical (each project = dedicated Postgres + isolated Auth/Storage/Functions/Realtime).
- **Operator‑read guarantee:** **level 1.** All projects sit in Cameron's Supabase org; Cameron's account opens any of them; Cameron holds each service‑role key. Provisioning 50 readable DBs instead of one. *Only* rises above level 1 if the project is created **in the org's own Supabase account** (→ becomes F‑style) or the data is encrypted with keys Cameron never holds.
- **Skeptic's verification:** none, unless the project is in the org's account (then their console + logs).
- **Shared core:** no shared network; **inbound `postgres_fdw` to a Supabase project isn't supported** → F4 (a hub project/service holds gig core + participants + shared attachments; every tenant calls its API) or F2 (hub writes, tenants subscribe via hub Realtime/webhooks and cache).
- **Availability:** hub project holds `availability`; tenants push redacted updates on staffing change; F5.
- **Cost:** additional projects **~$10/mo each + usage** ([Supabase pricing](https://schematichq.com/blog/supabase-pricing)); ~$525+/mo at 50 tenants, linear; Neon's scale‑to‑zero is materially cheaper for a long tail.
- **Upgrades:** worst of the hosted options — 42 migrations × N via per‑project `link` + `db push`, no "all projects" command; functions deploy N times; frontend rebuilds per tenant or resolves backend at runtime.
- **Auth:** each project has its own `auth.users` + JWT keys → a 3‑org contractor has 3 accounts unless a central IdP fronts every project (custom JWT secret / JWKS) — which bypasses the reason to use Supabase Auth.
- **Failure:** excellent per‑tenant blast radius + managed backups/PITR per project; hub project is the federation SPOF; Supabase‑wide incidents hit all; a billing lapse pauses tenants.
- **Verdict:** sounds clean, provisioning is a documented API, but linear $ that scales badly, worst fleet‑migration ergonomics, forces a central IdP anyway. Viable for **tens**, not hundreds. See §6.

### E — Fully self‑hosted instances the org owns

- **Isolation:** maximal. Org runs the stack on its own cloud/hardware.
- **Operator‑read guarantee:** **level 3 by ownership.** Cameron has no access and no credentials.
- **Skeptic's verification:** the org runs it — nothing to take on trust. (Plus open source + reproducible build if Cameron wants third‑party verifiability of the *code*.)
- **Shared core / availability:** pure cross‑instance federation (F4 + F5) against a hub all instances trust; mutually authenticated (mTLS / signed tokens, like Exchange federation trust). No shared network, no shared credentials.
- **Cost:** low infra for Cameron (hub + release pipeline + docs); **high support** — every install a snowflake, "an afternoon bug fix becomes a coordinated rollout across dozens of independent deployments," and Cameron can't force upgrades.
- **Org burden:** **high, disqualifying for most.** Self‑hosting Supabase = no managed backups/PITR, DIY upgrades the Supabase team itself calls "very tedious" ([community: multi‑week upgrades](https://queryglow.com/blog/supabase-self-hosted), [is Supabase production‑ready](https://unicoconnect.com/blogs/is-supabase-production-ready)), you own hardening/monitoring/HA. Typical GigWrangler customer is a venue or production company, not a team with a platform engineer.
- **Upgrades:** Cameron publishes versioned releases; orgs apply on their own schedule; **skew is permanent and unbounded** → strict forward/backward‑compatible schema + API contracts forever.
- **Auth:** each instance's own auth → a multi‑org contractor has N logins unless the hub is also an **identity broker** (OIDC), which concentrates auth trust in the hub.
- **Failure:** one org's instance dying is fully contained (shared gigs with it go stale). Hub outage freezes new federation + availability, touches no private data. Big risk: **fleet fragmentation** — unsupportable version spread, unpatched installs.
- **Verdict:** the only model that meets the strong requirement with zero cryptography. Operationally the most expensive to *support*, hardest sell. Right for a **few large security‑motivated orgs**; wrong as the only model.

### F — Bring‑your‑own‑database (Cameron hosts the app; org supplies Postgres)

- **Isolation:** high at rest — the org's Postgres (their Neon/RDS/Cloud SQL/on‑prem) is the system of record; Cameron's app connects with an org‑issued, revocable credential.
- **Operator‑read guarantee:** **level 2** — the org can revoke access, audit queries on its side, hold backups. But Cameron's app tier decrypts/handles plaintext in memory to serve requests, so a hostile operator could log there. **Level 3 only if combined with §3.2 (searchable field encryption, org KMS) so the app never sees sensitive plaintext,** or §3.4.
- **Skeptic's verification:** the org's own DB logs (every statement Cameron's app runs); with org‑KMS field encryption, the org's KMS logs.
- **Shared core:** Cameron's multi‑tenant app writes the shared row to a hub DB and mirrors references into each participant's BYO DB (F4 inside the app boundary + F2 out). The app tier is the coordination point — it *transiently* sees cross‑tenant data, a real caveat.
- **Availability:** app computes the redacted projection from each BYO DB's staffing tables → hub; or each BYO DB runs a Cameron‑provided function emitting the feed.
- **Cost:** run the app + functions + hub + a **connection‑management layer** (per‑tenant pools, secret storage, health checks, migration runner reaching into DBs you don't own). No per‑tenant DB hosting cost. Migration complexity ≈ C, plus "their DB was unreachable during the window."
- **Org burden:** medium — a Postgres they'll expose to Cameron's app (network path, credentials, PostgREST‑or‑direct decision) and consent to schema migrations.
- **Auth:** central (Cameron's app owns it) — good for multi‑org identity, but `auth.users` lives in Cameron's tier.
- **Failure:** org's DB unreachable = that org down (+ messy mid‑migration states); others fine. App‑tier compromise is cross‑tenant (mitigate: per‑tenant creds, least privilege, no master key). Hub down = federation degrades.
- **Supabase coupling:** same re‑platforming as C; the 232 `.from()` calls survive **only if** every BYO DB is fronted by PostgREST.
- **Verdict:** pragmatic — strong "our data, our DB, revocable" without asking the org to run the app. Cost: app tier stays a cross‑tenant trust point; PostgREST‑everywhere is load‑bearing. Pairs naturally with **Neon** (org makes a Neon project, enables its Data API, shares a scoped key). **Automated, this is the most attainable path to a believable guarantee** (§6).

### G — Hub‑and‑spoke: thin shared coordination service + private spokes

Not a fourth isolation point — **the federation backbone that makes B/C/D/E/F work.** Spoke topology is a *per‑org* choice.

- **Spoke (per org):** all private data + the org's own copy of each gig it's on. Runs anywhere on the spectrum, with any §3 mechanism.
- **Hub (one, shared):** the minimum cross‑org data, API‑first (F4) + free/busy feed (F5).
- **Operator‑read guarantee:** the *spoke* carries the guarantee (per its topology + §3 mechanism). The *hub* holds only federation data and gives a guarantee only about that — and only if minimized/encrypted/neutrally governed.
- **Skeptic's verification:** per spoke. For the hub: open source + minimized dataset the org can inspect.

**Minimum hub dataset — the honest list:**

| Hub data | Why unavoidable | Disclosure |
|---|---|---|
| **Org registry** (id, name, public profile, federation endpoint + public key) | Spokes must discover + authenticate each other | Which orgs exist |
| **Gig core** (id, status, start/end/tz, tags, hierarchy) | Row co‑owned by ≥2 orgs; must be neutral or replicated from a home | A dated engagement exists |
| **Gig title** — *optional* | Hub‑side ⇒ hub reads it; spoke‑side ⇒ hub sees only an opaque id | Nature of the engagement (avoidable) |
| **Participants** (gig → {org, role, is_client}) | Inherently multi‑party; drives shared authz | **Who works with whom, and when** — the main residual leak |
| **Shared attachments/notes** (only explicitly‑shared) | Feature requires cross‑org visibility of these items | Contents of explicitly‑shared items only |
| **Availability projection** (subject, busy_range, org?) | The non‑participant busy/free lookup | A person/org is busy on a date (optionally for whom) |
| **Identity + membership** (if centralized here) | Shared authz needs "is U a manager of a participating org?"; multi‑org login needs one identity | Who belongs to which org |
| **Federation handshakes** (invites, accept/decline, revocations) | The join protocol | — |

**Does the hub reintroduce the trust problem?** Partially — say it plainly. The hub learns **which orgs collaborate, on which dates, and who is busy when**. For competitors that's real signal, though far less than today (no financials, staffing names/rates, kits, purchasing, or non‑shared documents). And **Cameron operates the hub**, so "don't want to share with the creator" isn't fully solved by G alone. Three ways to close it, increasing effort:

1. **Minimize** — opaque gig ids (titles spoke‑side), availability as bare busy/free with org identity opt‑in, shared attachments as client‑encrypted blobs the hub can't read. Hub → near‑zero‑knowledge relay. Residual: the participant graph + timing.
2. **Neutralize governance** — hub is open source, run by a neutral entity (industry association, customer consortium, non‑profit), not Cameron. Cameron ships code; someone else holds keys.
3. **Federate the hub too** — no central hub; spokes exchange shared‑core rows peer‑to‑peer with a shared discovery/identity root (like DNS/email or Exchange federation). Max decentralization, max protocol complexity, hardest identity story.

- **Cost:** build + run one small, well‑scoped service (hub API + free/busy endpoint + directory + identity broker) — not another GigWrangler. Plus the chosen spoke model's cost.
- **Upgrades:** two streams — hub (single deploy, **versioned, backward‑compatible API** because spokes upgrade independently) and the spoke fleet (per model).
- **Auth:** cleanest with the hub as OIDC identity broker (one identity per person; spokes trust hub tokens). Concentrates auth trust in the hub — acceptable if minimized/neutralized.
- **Failure:** hub down → no new shared gigs, stale availability, logins may fail if hub brokers auth (mitigate: cached tokens / long TTL) — **every spoke's private data keeps working.** Spoke down → that org dark; its shared gigs stale for others. No single breach exposes private data (hub never holds it).
- **Verdict:** the architecture that takes the requirements seriously — "shared" and "private" are different systems with different owners; size the shared one to the smallest thing that works. **Recommended target**, spoke model chosen per‑org.

### H — Locally‑installable / local‑first application

Desktop app (Tauri/Electron) with an on‑device database and optional AI hooks; data never touches Cameron's infrastructure. Not a tenancy model — "no tenancy, because there's no shared system." Full analysis in **§11**; scorecard here for parallelism.

- **Isolation:** maximal — the data is on the user's disk.
- **Operator‑read guarantee:** **level 3, and free** — nothing to verify because there is no server, no cloud DB, no operator access path. This is the entire appeal.
- **Skeptic's verification:** trivial — packet‑capture the app (nothing leaves except opt‑in federation + opt‑in AI) or run it air‑gapped; reproducible build makes "optional really is optional" checkable.
- **Shared core / availability:** the hard part — every peer is a laptop asleep half the time. Either a small always‑on relay (a shrunk Option‑G hub that reintroduces a *bounded* trust surface — §11.4) or P2P sync between intermittently‑connected clients. Neither is free.
- **Cost to Cameron:** ~$0 infra per tenant; **high engineering** to sever Supabase (§11.1) + build packaging/signing/update/telemetry; support with no access to the customer's DB or logs.
- **Org burden:** low for one user; **rises sharply with multiple users per org (§11.3) and mobile field use**, and the org now owns backups (§11.5).
- **Upgrades:** you ship builds; users run them whenever — schema skew is unbounded (§11.2).
- **Auth:** no server → no Supabase Auth; local password / OS keychain / device WebAuthn. Multi‑user and federation still need an identity anchor.
- **Failure:** dead laptop + no backup = total loss. Contained blast radius, catastrophic per‑incident severity.
- **Supabase coupling:** must be fully severed — the largest teardown of any option (§11.1).
- **Verdict:** solves the trust problem completely and for free, but trades away multi‑user‑without‑setup, first‑class mobile, painless updates, and backup‑by‑default. **Viable as a product; questionable as *this* product** without a sync tier that pulls most of that back. See §11.

### I — Self‑serve self‑hosting (the org owns its Supabase project)

The org creates and owns a Supabase project (their account, billing, credentials), installs GigWrangler against it via a wizard; Cameron never has access. Separately, an **opt‑in** federation relay carries only the thin scheduling/availability signal. Full analysis in **§12**.

- **Isolation:** maximal, by ownership — same as E, but the substrate is *managed Supabase in the org's account* rather than a Docker stack the org runs.
- **Operator‑read guarantee:** **level 3, nothing to verify** beyond the visible source. Cameron holds no credentials and no access path.
- **Skeptic's verification:** read the (source‑available) code, reproducible build, watch the network — the app talks only to *their* Supabase and the opt‑in relay.
- **Stack intact:** RLS, Supabase Auth, Storage, Realtime, the 2 edge functions, the PWA, multi‑user‑within‑an‑org, server‑side reporting — **all keep working**, because the whole stack runs in the org's project. No encryption tax, no local‑first rewrite, no sync engine. This is the key advantage over H.
- **Shared core / availability:** the opt‑in relay (§12.5) — a shrunk Option‑G hub holding blinded handles, participant graph, busy/free; per‑gig opt‑in; minimal retention.
- **Cost to Cameron:** ~$0 infra per org; **build + permanent tax** on: a provisioning wizard, an in‑app migration runner + compat gate (§12.3), zero‑access support tooling (§12.4), the relay, docs/forum.
- **Org burden:** must become a Supabase customer (account, card, **Pro plan or the project pauses**), run the wizard, keep the app updated. The wizard + a Cameron‑hosted frontend (§12.2) get this close to a hosted signup, but not to zero.
- **Upgrades:** Cameron controls neither schema nor deploy — 46 migrations self‑apply across N unseen installs; every migration skip‑safe forever; bounded‑skew policy like Home Assistant / OneUptime (§12.3). **The single biggest ongoing cost.**
- **Auth:** the org's own Supabase Auth. Google OAuth needs a manual Google Cloud client (no API to automate) → self‑host defaults to magic‑link/password; multi‑org identity needs the relay or two logins.
- **Failure:** the org's project down = that org down; others unaffected. Relay down = no new shared gigs / stale availability; private data unaffected. Backups are managed Supabase's job (Pro+ PITR).
- **Supabase coupling:** **kept, deliberately** — coupling is fine when it's the *org's* Supabase.
- **Verdict:** the strongest operator‑exclusion option for a team‑based product — level‑3 guarantee with the feature set intact. Costs onboarding friction, the single deploy, and higher‑touch support. **If self‑hosting is the direction, this is how, not Option H.** See §12.

---

## 6. Automatic provisioning — how real is it

**The mechanism exists.** Supabase Management API: [`POST /v1/projects`](https://supabase.com/docs/reference/api/v1-create-a-project) (PAT auth, [120 req/min per org](https://supabase.com/docs/guides/auth/rate-limits)). One org holds many projects. So "org signs up → project auto‑created" is a real, documented flow. **Neon's provisioning API is better‑suited** — designed for per‑tenant fleets, scale‑to‑zero, Terraform provider, a [PostgREST‑compatible Data API](https://neon.com/blog/a-postgrest-compatible-data-api-now-on-neon); [Retool reportedly runs 300k+ Neon projects with one engineer](https://neon.com/use-cases/database-per-tenant).

**Cost.** Supabase: ~$10/mo/project beyond the first + usage; paid‑org projects don't pause but still bill; ~$525+/mo floor at 50 tenants, linear. Neon: scale‑to‑zero makes idle tenants near‑free — much better for a long tail of small orgs.

**Applying the 42 migrations to a *new* project.** Create → wait for ready (minutes) → run the migration bundle (`supabase link && supabase db push` in a per‑project CI job, or execute SQL via the Management API query endpoint, or `psql` the files) → deploy the 2 edge functions → **register the project (ref, URL, keys) in a tenant registry** the app routes from.

**Applying a *new* migration to all existing projects.** No "push to all" command. Build a **fleet migration runner**: iterate the registry; per project apply pending migrations transactionally; record the new schema version; stop on failure; **canary** (1 → 5% → rest) with health checks between waves — the documented norm for per‑tenant fleets.

**Failed mid‑rollout.** Migration `0043` fails on project 27 of 50: projects 1–26 on v43, 27 half‑migrated (rolled back if the migration was transactional), 28–50 on v42, and v43‑expecting code is deploying. You need (a) **per‑project version in the registry** so the app serves the right behavior per tenant, (b) every migration wrapped so failure leaves the project cleanly on the prior version, (c) code that tolerates both versions during the window (expand‑only, feature‑flagged reads — a stricter `deploy_prod.sh`), (d) an alert + runbook to fix 27 and resume. Weeks to build well; permanent operational surface.

**When tenant 50 is three versions behind tenant 3.** The shared contract surfaces — hub API, edge‑function endpoints, the frontend if it's one build — must support a *range* of schema versions. Practically: (a) force‑upgrade on a bounded schedule (allow ≤ N versions of skew, then mandatory upgrade windows), (b) each tenant pins its own frontend + function versions to its schema (N deployments — the single‑tenant burden), or (c) version the contract and every consumer handles vN..vN‑3. Most teams pick (a) with a tight bound.

**Provisioning does not by itself solve the read problem.** If the automation creates the project under **Cameron's** Supabase org and stores the service‑role key + DB password in **Cameron's** registry, **Cameron can read every tenant** — now 50 readable DBs instead of one. For provisioning to *also* deliver operator‑exclusion, one must be true:

1. **The project lives in the org's own Supabase/Neon account.** Automation uses OAuth‑delegated, org‑scoped credentials to create it *in the customer's account*; Cameron's app connects with a key the customer issues and can revoke; Cameron never stores the DB password. Verifiable: the org sees the project in *their* console and every access in *their* logs. (This is **F, automated** — BYO‑database with the friction removed.)
2. **The sensitive data is encrypted with a key Cameron's automation never holds** (§3.1–3.3), so holding project credentials doesn't grant read access.
3. **Decryption happens only in an attested enclave** (§3.4).

Automated provisioning + (1) is the most attainable: it converts the guarantee from "trust Cameron's policy" to "you hold the keys to your own cloud project." Cost: onboarding now requires the org to connect a cloud account (or accept a project in their name) — more friction than "enter email, go" — and support gets harder (debugging in infra you don't own).

---

## 7. Postgres substrates

| Substrate | Fit | Notes |
|---|---|---|
| **Supabase (managed)** | A, D, hub | Best DX; Auth/Storage/Realtime bundled; per‑project pricing + fleet‑migration ergonomics cap D past tens of tenants. Management API provisioning is real. |
| **Supabase (self‑hosted)** | E | Afternoon to stand up, expensive to own; no multi‑project, no managed PITR, brutal upgrades. Only for orgs that insist on owning everything. |
| **Neon** | C, D, F, G, hub | Purpose‑built for database‑per‑tenant: API/Terraform provisioning, scale‑to‑zero, **PostgREST‑compatible Data API** (the 232 `.from()` calls could survive). No bundled Auth/Storage/Realtime. Strong spoke and/or hub substrate. |
| **RDS / Cloud SQL / Crunchy Bridge** | C | Boring, reliable, you're the DBA. No Data API — run PostgREST yourself. |
| **Plain Postgres on a VM** | E reference stack | Cheapest per unit, most ops. Viable as the "here's the bundle to self‑host" reference. |

**PostgREST is the portability pivot.** As long as every private DB is fronted by PostgREST (Supabase's, Neon's Data API, or self‑run), the frontend data layer is unchanged. Drop it and the 232 call sites become a query‑builder rewrite. Weight substrate choice on this. §3.2 (CipherStash) also runs as a Postgres proxy — compatible with this pivot.

---

## 8. Cross‑cutting consequences

**Auth is the fork.** A/B keep Supabase Auth. Everything else needs a **central IdP** (self‑hosted Supabase Auth used only for auth, Ory Hydra/Kratos, Auth0, Clerk, WorkOS) issuing JWTs all spokes + the hub trust via shared JWKS. Largest single work item past B: 42 `auth.*` call sites + RLS's `auth.uid()` dependency + OAuth re‑wiring. **Extract a thin `AuthProvider` interface over `AuthContext.tsx` first** — prerequisite for everything, worth doing regardless.

**RLS mostly goes away, then partly returns.** One‑tenant‑per‑DB: the 61 policies + intersection helpers collapse to "authenticated + a member." The **hub's** shared‑core tables need their own smaller policy set ("participant orgs read; participant managers write; availability returns busy/free only"). The prior report's Phase‑1 RLS fixes are only worth doing *in place* if A stays the near‑term reality.

**The migration pipeline must become fleet‑aware** for C/D/E/F: a tenant registry, a runner that iterates it with per‑target status + canary + rollback, and two schema streams (spoke, hub) with a compatibility contract. `deploy_prod.sh` is single‑target today — this is a new component, weeks not days.

**Frontend backend‑resolution.** B/C keep one URL. D/E/F need the frontend to resolve *which* backend per logged‑in org — per‑tenant build (env swap) or a post‑login bootstrap call to the hub returning the spoke endpoint. The latter is cleaner and hub‑native.

**Edge functions.** `server` and `ai-scan` are small and Deno‑portable. In G, `server`'s intersection checks *are* federation logic → move to the hub; `ai-scan` is stateless, lives anywhere (and under §3.1 moves client‑side).

---

## 9. Recommendation

**Frame the decision as: the minimum architecture that gives a target org a guarantee it would believe, without making the product unbuildable or unaffordable to run.** Tiered, because different customers need different levels and the tiers stack.

### Tier 0 — now, for everyone (necessary regardless)
SOC 2 Type II + DPA + least‑privilege prod access with break‑glass + **immutable, externally‑held audit logs of every operator query**. This is level 1/2 and it clears the default bar for a venue/production‑company market comparing GigWrangler to other cloud SaaS. Do this first; it unlocks most of the market and is a prerequisite for selling the higher tiers credibly.

### Tier 1 — the believable guarantee, most attainable (the recommended core investment)
**App‑layer searchable field‑level encryption (§3.2, CipherStash‑style) on the sensitive columns, with the data key in the org's own KMS (§3.3).** Cameron's servers can query (sort, filter, join) but the sensitive plaintext exists only in the authenticated client and transiently at decrypt; the org holds and audits the key; **revocation is real** (disable the key → Cameron's copy is ciphertext). Shared core + availability stay as a small **cleartext, minimized, opt‑in hub projection** (§4.2) — nothing encrypted ever needs to federate.

- **Keeps the product buildable:** lists still sort/filter server‑side, FKs work, realtime works.
- **Costs, stated as tradeoffs:**
  - **Server‑side financial aggregation** (totals, P&L) moves client‑side or to a client‑maintained encrypted rollup. If rich server‑side reporting is core to the product's value, Tier 1 costs a redesign there, not just a library.
  - **The AI receipt scan** runs client‑side with the org's own Anthropic key, or becomes an explicit plaintext‑in‑transit opt‑in.
  - **The guarantee is "operator can't read the DB and can only decrypt transiently in‑request with your audited key"** — much stronger than a promise, not as absolute as an enclave or client‑only E2EE. A security team will note plaintext exists in Cameron's process memory at decrypt time. Say so up front.
- **Verification:** the org's KMS logs every decrypt; the encryption client is open‑source and inspectable.

### Tier 2 — for orgs that won't accept shared infrastructure at all — *superseded by Option I*
The original Tier 2 was **automated provisioning of a per‑tenant Neon/Supabase project in the org's own account**, Cameron connecting via org‑issued revocable credentials (Option F, automated). **Option I (§12) is the better form of this same idea**: the org drives the provisioning and owns the account and credentials outright, so Cameron connects to *nothing* — a strictly stronger guarantee (level 3 vs level 2) for similar onboarding friction. Treat Option I as the self‑hosted tier; keep "Cameron provisions and operates it in the org's account" only as a **managed‑convenience** sub‑option, explicitly positioned as *not* zero‑knowledge.

### Tier 3 — only if operator‑exclusion becomes *the* product
**Confidential‑computing enclaves (§3.4)** for the decrypt/query path, or **client‑only E2EE (§3.1)** with the feature set trimmed to match. Defer until the market clearly demands level 3 *and* Tier 1 + Option I are both proven insufficient. Disproportionate to the current stage.

### Option I — self‑serve self‑hosting (§12): the self‑hosted tier
**The org owns its Supabase project; Cameron never has access; the whole stack stays intact.** Level‑3 guarantee by ownership, verifiable by reading the source, **with no feature sacrifice** — unlike Tier 1 (encryption tax, level 2.5) and Option H (feature loss, big rewrite). Costs: onboarding friction (the org becomes a Supabase customer — a provisioning wizard + Cameron‑hosted static frontend narrow this), the loss of Cameron's single deploy (46 migrations self‑apply across N unseen installs — a permanent migration/compat tax), higher‑touch zero‑access support, and indirect revenue (commercial license under BSL/FSL + paid federation tier + the hosted product). **Recommended shape of the product line: hosted Tier 0/1 for the ~94% who want convenience + Option I as the self‑hosted tier for the security‑motivated minority** (who would otherwise be non‑customers). Same codebase and schema; the hosted product is Cameron running the Option‑I path. Realistic v1 ≈ Tier 1's cost (~5–7 months, front‑loadable to a ~3‑month no‑federation milestone).

### Option H (local‑first) — off the tier ladder, not a substitute
The locally‑installable app (§11) delivers a **level‑3 guarantee for free with nothing to verify** — but it changes the *product*, not just the isolation mechanism, so it doesn't slot into the tiers. It trades away multi‑user‑without‑setup, first‑class mobile, and backups‑you‑can't‑lose, and it needs a quarter‑plus of Supabase‑teardown work. Pursue it only as (a) a **separate smaller product** for solo operators, or (b) **H‑a / H‑c** (local‑first with an optional encrypted sync tier / hybrid) — both large, both dependent on a sync engine (PowerSync is the least‑risky 2026 bet). For the security‑motivated orgs this document is about, **Tier 1 gets to "we can't read your books" without giving up the hosted product's core value**; H only wins when the bar is literally "nothing on anyone's server, and I'll verify with a packet capture" — and federation still forces a small relay back in.

### Federation, held constant across all tiers
**Hub‑and‑spoke (Option G).** The hub/relay holds only the minimized shared core + opt‑in busy/free projection with blinded handles; private data (encrypted per Tier 1, or wholly org‑owned per Option I) never crosses. Design the relay API + free/busy feed now (lean on RFC 7953 / Exchange‑federation prior art) — one design serves both Tier‑1 federation and Option I, and it's buildable and valuable even while every tenant is still one row in one database.

### Sequencing
1. **Tier 0** (SOC 2 groundwork, operator‑access audit logging) — start now; it also underpins the hosted half of an "offer both" line.
2. **Extract `AuthProvider`; decide magic‑link vs Google for self‑host** — on the path for Option I and every tier past status quo.
3. **Design the relay/hub** (API, free/busy feed, blinded handles, minimum dataset, per‑gig opt‑in) — independent of tier; the same design serves Tier‑1 federation and Option I.
4. **Decide the fork in the road:** Option I (self‑hosted tier, §12) vs Tier 1 (searchable field encryption). They cost about the same for v1; Option I gives the stronger guarantee with no feature loss but moves the deploy out of Cameron's hands. The deciding inputs are §10 Q2 (will orgs become Supabase customers?) and Q7 (team vs solo, mobile‑critical?).
5. **If Option I:** build Milestone 1 (provisioning wizard + hosted‑frontend split + in‑app migration runner/compat gate + zero‑access support tooling + BSL/FSL licensing) → ship to the security‑motivated segment → then Milestone 2 (federation relay + client). Make all 46 existing migrations skip‑safe and add a v1→vN replay test *before* the first external install.
6. **If Tier 1:** prototype searchable field encryption on `gig_financials` + `purchases` sensitive columns with an org‑KMS key; the make‑or‑break is whether the server‑side reporting + AI‑scan tradeoffs are acceptable.
7. Skip the prior report's in‑place Phase‑1 RLS fixes unless neither Option I nor a split lands within ~2 quarters.

### Where the honest answer is a tradeoff, not a solution
- Tier 1 removes operator DB read access but not operator process‑memory access at decrypt time. Level 2.5, not level 3. Costs current‑form server‑side financial reporting and the server‑side AI scan.
- **Option I gives the cleanest level‑3 guarantee and keeps every feature, but Cameron gives up the single deploy** — every schema change becomes a permanent fleet‑compatibility exercise across installs he can't see — and support becomes partly blind. Onboarding asks the org to become a Supabase customer.
- Option I's revenue is indirect (license + federation tier + hosted product); any model that needs to meter the org's usage from outside doesn't work.
- Option H trades away multi‑user‑without‑setup, first‑class mobile, and unlosable backups, and needs a Supabase teardown + sync‑engine bet. Option I dominates it for a team product.
- The relay still sees the collaboration graph + busy/free under every option that federates. Blinded handles + per‑gig opt‑in + minimal retention reduce it; a truly zero‑knowledge relay, or an org‑run/federated one, is the only full close.
- Nothing here is free. "Verifiable operator exclusion" costs features (Tier 1), the single deploy + higher‑touch support (Option I), a rewrite + feature loss (Option H), or a disproportionate engineering investment (Tier 3).

---

## 10. The questions that would most change this

1. **Which sensitive features are non‑negotiable — server‑side financial aggregation? the AI receipt scan as‑is?** If both, Tier 1 needs those redesigned, not just an encryption layer wrapped around them. This is the pivotal product question.
2. **Will target orgs connect their own cloud account / KMS?** Yes → Tier 1 and Tier 2 are viable. "Just let me sign up with an email" → you're capped at Tier 0 + platform‑managed encryption (level 2), and the strong guarantee isn't on the table.
3. **Is the bar "better than the other cloud SaaS" or "provably can't see it, like a password manager"?** The former is Tier 0 (+ maybe Tier 1); the latter is Tier 3 / client‑only E2EE. Different products, different roadmaps.
4. **How many orgs, and of what size?** ~20–50 mostly‑small → Tier 0 + Tier 1 is plenty and the hub stays minimal. Hundreds including large security‑driven orgs that will pay for isolation → Tier 2 fleet machinery (and maybe Tier 3) is justified. Changes the budget by an order of magnitude.
5. **Is "Cameron cannot read it" hard, or is "not commingled with competitors, revocable, portable on exit" enough?** The former eventually forces Tier 3; the latter is met by Tier 1 or Tier 2 at far lower cost and support load. Product/positioning decision, not technical.
6. **Long‑term shared surface — ever more than {dates, status, participants, explicitly‑shared attachments/notes, busy/free}?** Stable and small → thin relay, F5 carries it. Roadmap toward richer cross‑org collaboration (shared schedules/docs/messaging/joint settlements) → the relay grows toward a real shared database and the calculus shifts back toward a well‑isolated *shared* store with private extensions.
7. **Is GigWrangler used by *teams* within an org, and is mobile field use core?** If a typical org is one person at a desk → Option H (local‑first, §11) is genuinely viable. If it's an owner + managers + field staff who expect live shared state and on‑site mobile → H needs an always‑on sync/relay component that pulls it back toward Option F/G/I, and the "purely local, nothing on a server" pitch weakens. **This same answer decides whether Option I's federation relay is worth building at all.**
8. **Will the target org become a Supabase customer** — create an account, put a card on file, pay for the Pro plan, run a provisioning wizard? Yes → **Option I (§12)** is the strongest path and may replace Tier 2 entirely. No, they want email‑signup and nothing else → you're back to hosted Tier 0/1 with platform‑managed encryption, and the strong guarantee is off the table for them. This is *the* gating question for Option I.
9. **Can Cameron give up the single deploy?** Option I means 46 (and counting) migrations self‑applying across installs Cameron can't see, forever — a permanent expand‑only‑self‑contained constraint on every schema change plus a bounded‑skew upgrade policy. If the schema is still changing fast, that tax is heavy; if it's stabilizing, it's tolerable.

Secondary: must identity be one login per person across orgs (if not, Option I / Option D get easier)? What staleness is acceptable for the shared gig core — seconds (F2/F5) or immediate (F1/F4)? Does the trust claim need *visible source* (likely yes for the security‑motivated segment) → which forces a license decision (BSL/FSL recommended) and accepts a low fork risk?

---

## 11. Deep dive: the locally‑installable option (Option H)

Cameron's question: *"What if we make this a locally installable application with a local database and optional AI hooks?"* It's attractive because it solves the trust problem completely and for free — data never touches Cameron's infrastructure, so there is nothing to verify. The question is whether what it trades away is survivable.

### 11.1 What severing Supabase actually costs

| Layer (today) | Local equivalent | Rewrite size |
|---|---|---|
| **Data API** — Supabase PostgREST over hosted Postgres; **232 `.from()` + 22 `.rpc()` call sites**, ~20 of the RPC targets are `plpgsql`/`SECURITY DEFINER` functions (`create_gig_complex`, `search_users_secure`, contact mgmt, kit‑cycle checks, `reclassify_expense_as_asset`, `log_activity`) | (a) **bundle real Postgres** (embedded‑postgres binaries, production‑grade, ~30–50 MB/platform, child process) + run PostgREST locally; or (b) **PGlite** (in‑process WASM Postgres — keeps SQL/plpgsql/enums/`tsvector`, but **alpha, single‑connection, no durability warranty**, <100 MB comfort zone; maintainer Electric just joined Databricks → direction risk) + a PostgREST‑dialect shim; or (c) **SQLite** + rewrite the data layer and port/drop every plpgsql function | (a)/(b) **medium** and the 232 calls survive unchanged; (c) **large** — query‑layer rewrite + function port + loss of Postgres‑only features. **If H is pursued, keep Postgres + PostgREST.** |
| **RLS (61 policies) + `server` middleware** — the *authoritative* RBAC + tenancy layer. `src/utils/permissions.ts` is explicitly advisory ("mirrors the backend … at the UI layer") | Single‑org local install: **tenancy disappears** (one org per DB). **In‑org RBAC (Admin/Manager/Staff/Viewer) still needs enforcing**, and with a local DB the user can open in any SQL tool, *client‑side checks are not enforcement*. Options: **(i)** accept RBAC is advisory within one org on machines the org controls (threat model is "hide the delete button," not "Staff with a hex editor") — probably fine, but a documented posture change; **(ii)** the Tauri/Electron **main process is the only writer**, exposing an IPC API that checks roles — this is the `server` middleware ported to a local service; **(iii)** local Postgres with a real DB role per user + locally‑minted JWT — heavy | (i) free, posture change; (ii) **medium**, mostly a port of existing `server` code |
| **Auth** — Supabase Auth, 42 sites, `AuthContext.tsx`, Google OAuth + magic link + WebAuthn (mobile lock) | OS keychain + local password, or device‑bound WebAuthn (already in the codebase). Google OAuth needs a loopback/native‑app flow or is dropped. Multi‑user + federation still need an identity anchor (§11.3/11.4) | **medium** — rework `AuthProvider`, which §8 already recommends extracting regardless |
| **Storage** — `attachments` bucket, `{org_id}/{file}`, signed URLs, 3 sites | App data dir (`~/Library/Application Support/GigWrangler/attachments/…`), no signed URLs | **small** — an `AttachmentStore` interface + filesystem impl |
| **Realtime** — 2 `postgres_changes` subs (user row, org members) | Single process: in‑app event bus / Postgres `LISTEN`‑`NOTIFY` / query‑invalidation tick. Multi‑user: folds into the sync layer | **small–medium** |
| **Edge functions** — `server` (Hono, 6 route groups) + `ai-scan` | `places.ts` (Google Places, hides an API key) and `calendar.ts` (Google OAuth secret + Calendar sync) genuinely need a secret‑holding server **or the org's own keys entered locally**. Other `server` logic moves in‑process (option (ii) above). `ai-scan` → §11.6 | **medium**; Places autocomplete + Google Calendar degrade to BYO‑key or off |
| **Build/deploy** — Vite → Cloudflare Pages | Desktop packaging + signing + notarization + auto‑update (§11.7). The existing `vite-plugin-pwa` config is a partial asset | **medium**, ~2 focused weeks for the signing/notarization pipeline alone |

**Rough total: a quarter‑plus of focused platform work before feature parity**, concentrated in the data/auth/sync layer, competing directly with product roadmap.

### 11.2 Migrations on the user's machine

Today: 46 linear migrations, `supabase db push`, one target, expand‑only for one release. Local:

- The migration runner **ships inside the app**; on launch it opens the local DB, reads its schema version, applies pending migrations forward. `src/utils/idb/store.ts` already does exactly this (`DB_VERSION`, `upgrade()` steps) for the IndexedDB cache — the pattern exists, just for a trivial store.
- **Skipped versions:** a user who ran v20 in January opens v46 in December and applies 26 migrations on first launch. Fine *only if every migration is still runnable years later* — no dependency on a since‑removed function, no "backfill from an API" step. A stricter forever‑constraint than today's.
- **Old build, new data:** if two users on one org sync, a user on v40 must not receive rows shaped for v46. The sync protocol gates on schema version, or the app **refuses to sync across a version gap and forces an update** — which makes reliable auto‑update load‑bearing (§11.7).
- **Corruption / half‑applied migration:** no ops team to fix a customer laptop. Every migration transactional, leaves the DB on the prior version on failure, plus a "restore from last backup" path (§11.5).
- **No global cutover, ever again.** Analytics, support ("what version are you on?"), and bug repro all get harder.

### 11.3 Hard problem — multi‑user within one org (the one most likely to sink it)

A production company is an owner + a couple of managers + field staff who today share one database with live updates. Local‑install options:

1. **One machine is the server.** The owner's desktop runs the app + DB; others connect over LAN / Tailscale. This is **Option E in a desktop costume** — someone keeps that machine on, reachable, and backed up; no help for remote/field staff. Realistic only for a co‑located team with IT comfort.
2. **Each user a full replica + sync engine.** Real bidirectional sync with conflict resolution over a relational schema *with money in it* (§11.8 maturity). Transport is P2P (hard, §11.4) or a relay (trust surface, §11.4). The **Actual Budget** model — and Actual's whole engineering identity is that sync engine, for a *simpler, mostly single‑user* schema.
3. **Thin multi‑user: one always‑on instance, desktop app is a cache of it.** That's **Option F / self‑host** again; "local app" is now just a client.
4. **Accept single‑user.** GigWrangler becomes a tool for solo operators and the smallest shops — legitimate, but a different, smaller market.

**No local path gives "multiple users, no setup, works remotely, live updates"** — which the hosted product gives today for free. Every local path adds an always‑on component or a hard sync engine, or narrows the market.

### 11.4 Hard problem — federation between laptops

Shared gig core + busy/free must still cross org boundaries; each org is now one or more laptops asleep half the time.

- **Pure P2P:** NAT traversal, both parties online at once, a discovery/identity root. "Invite org B to a gig" can't complete until B's laptop wakes; a busy/free lookup may return *"unknown — their machine is asleep."* Poor scheduling UX.
- **Small always‑on relay (recommended if H is pursued):** a minimal service that store‑and‑forwards shared‑core changes + handshakes, holds the **opt‑in busy/free projection** so it's queryable when the source is offline, and is the identity/discovery root. This is **Option G's hub, shrunk** — and it **reintroduces the trust question for exactly §5‑G's "minimum hub dataset"**: participant graph, dated engagements, busy/free calendar. Private data (financials, staffing, kits) still never leaves the laptops, so the reintroduced trust surface is *bounded and far smaller than today* — but not zero, and "nothing on anyone's server" stops being literally true. Mitigations = §5‑G: minimize (opaque ids, identity‑optional availability, client‑encrypted shared blobs) and/or neutral governance.
- **Honest framing:** local‑install kills the trust problem for *private* data outright and shrinks it for *shared* data to a small relay — it doesn't eliminate the shared‑data relay unless the market accepts "federation only works when both parties are online."

### 11.5 Hard problem — backup and data loss

Today Cameron can't lose the org's data (Supabase PITR + daily backups). Locally, a dead laptop = total loss, and small production companies do not run backups. Responsible design is **all** of:

- **Automatic rolling local snapshots** in the app's data dir — covers "I broke something," not "laptop stolen."
- **One‑click encrypted backup to a location the org controls** — their iCloud/Dropbox/Drive folder or an S3 bucket they own, client‑encrypted so the destination can't read it. Prompted on first run, nagged when stale.
- **If any sync tier exists (§11.8), it doubles as off‑machine backup** — a strong argument for *always* shipping at least an optional relay/replica.
- **Portable export** — the repo's CSV export is a start; a full JSON/SQLite dump is better.
- Accept that some users still lose data, and say so in onboarding. A reputational risk the hosted product doesn't carry.

### 11.6 Hard problem — the AI hooks

Receipt scan must send an image somewhere. Three honest options:

1. **Org supplies its own API key**; the desktop client calls Anthropic/OpenAI/Gemini directly. Zero Cameron involvement, no server, today's frontier‑VLM quality, billing is the org's. **Best fit for "optional hooks."** Receipts still leave the machine to a third‑party AI — fine if disclosed and opt‑in, no worse than today.
2. **Local model.** A 7B‑class VLM (Qwen2.5‑VL‑7B, MiniCPM‑V) or a specialist (GLM‑OCR, PaddleOCR‑VL) on the user's machine. 2026 reality: competitive on *raw OCR benchmarks*, but for **crumpled phone photos with structured field extraction (vendor, date, line items, tax, total) and low hallucination** they lag the cloud frontier — more misreads, more manual correction ([LLM OCR vs traditional OCR, 2026 benchmark](https://parsli.co/blog/llm-ocr-vs-traditional-ocr), [best OCR models 2026](https://ofox.ai/blog/best-ai-model-for-ocr-2026/)). Practical cost: multi‑GB model download or a separate Ollama install, 4–8 GB RAM while running, slow without a GPU, plus a "which model, keep it current" burden. A "works offline, lower accuracy" fallback, not the primary path.
3. **Off.** Manual entry, always available.

Ship (1) as default + (3) always; treat (2) as a later offline‑mode nicety.

### 11.7 Hard problem — distribution and support

- **Packaging:** **Electron** (bundles Chromium, ~100 MB+, but electron‑builder/electron‑updater give differential updates, staged rollouts, and macOS notarization + Windows signing workflows that "just work") vs **Tauri v2** (OS WebView, ~10 MB bundles, the 2026 default for *new* apps, but younger release engineering; full‑binary updates). For a React app with a heavy data/sync layer where **reliable auto‑update is load‑bearing** (§11.2), Electron's maturity is the lower‑risk pick despite size. ([Tauri v2 vs Electron 2026](https://www.pkgpulse.com/guides/electron-vs-tauri-2026))
- **Cost:** ~2 focused weeks for the notarization + signing pipeline; Apple Developer account $99/yr; Windows code‑signing cert ~$100–400/yr (or Azure Trusted Signing).
- **Auto‑update** must be reliable — it's also what prevents schema skew (§11.2) and enforces sync‑compatible versions (§11.3). Staged rollout + kill switch for a bad release.
- **Support without the database:** no server logs, no querying the customer's data, no "log in as them." You need opt‑in diagnostic log export, an "export my database and send it to support" flow (with scrubbing), reproducible builds, and desktop crash reporting (Sentry). Every ticket is higher‑touch.
- **Telemetry:** you lose aggregate feature usage / error rates / adoption unless you add opt‑in analytics — which cuts against the privacy pitch, so most local‑first products fly partially blind.

### 11.8 Middle grounds (not all‑or‑nothing)

| Variant | Shape | Trust guarantee | Cost |
|---|---|---|---|
| **H‑a — Local‑first + optional encrypted sync** (Linear / Obsidian / Actual model) | Local DB is source of truth; an **optional** sync service (Cameron‑hosted or self‑hosted) replicates client‑encrypted changes between a user's devices and teammates | Level 3 for private data if sync payloads are client‑encrypted and Cameron holds no keys (relay sees ciphertext + timing); federation relay per §11.4 | The sync engine *is* the ballgame (maturity below). Backup comes nearly free. Mobile becomes possible as a thin client to the sync service |
| **H‑b — Self‑hosted server the org runs** (= Option E, packaged) | One binary/container on the org's box or cloud; desktop + mobile are thin clients | Level 3 by ownership; identical to §5‑E | Org needs IT to run + back up a server; Cameron supports N snowflakes |
| **H‑c — Hybrid: local default, cloud opt‑in per org** | Ship the desktop app; orgs wanting zero setup / mobile / multi‑user flip on a hosted backend (Tier 0/1/2) | Ranges from level 3 (stay local) to level 1–2.5 (opt into hosted) | Build + maintain **both** stacks, schemas and behavior in lockstep — highest total surface area, but each org self‑selects |

**Sync‑engine maturity, 2026 (load‑bearing for H‑a and any multi‑user H):**

- **PowerSync** — most mature / battle‑tested; SOC 2 + HIPAA (Jan 2026); one‑way Postgres→SQLite replication + write‑back path; assumes an upstream Postgres + the PowerSync service. Least‑risky bet, still a major build. ([sync‑engine comparison](https://stribog.com/blog/electricsql-powersync-automerge-local-first-sync-engine-sovereign))
- **ElectricSQL** — 1.0 GA March 2025, full active‑active ambition; practitioners still say "6–12 months" for production confidence; **Electric joined Databricks (Aug 2026)** → roadmap risk. ([local‑first architecture 2026](https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/))
- **Zero (Rocicorp)** — promising, very active, **still beta**, API instability. ([TanStack DB vs Electric vs Zero](https://kanopylabs.com/blog/tanstack-db-vs-electricsql-vs-zero-sync))
- **PGlite** — in‑process WASM Postgres; **alpha, single‑connection, no durability warranty**, <100 MB comfort zone; v0.4 (Mar 2026) added connection multiplexing + PostGIS. Usable as the local DB *with* real backups; don't bet unattended durability on it. ([PGlite about](https://pglite.dev/docs/about))
- **CRDTs (Yjs / Automerge)** — mature for documents/text; for a **relational schema with money**, last‑write‑wins per field + explicit domain rules (never auto‑merge a ledger) beats a general CRDT. Server‑authority conflict resolution is simpler and is what most business apps still pick. ([Ink & Switch local‑first](https://www.inkandswitch.com/essay/local-first/))
- **In the wild: Actual Budget** — local‑first, own CRDT sync engine, optional self‑hosted sync server, client‑side E2E encryption with a user key, official desktop + mobile. Proof the model works — but mostly single‑user, far simpler schema, and the sync engine *is* the product. ([Actual sync docs](https://actualbudget.org/docs/getting-started/sync/))

### 11.9 Feasibility verdict

- **As a direction for GigWrangler as it exists today — no, not on its own.** The hosted product's core value includes multi‑user‑with‑zero‑setup, first‑class mobile field use, and backups you can't lose. Pure local‑install trades away all three, and the Supabase teardown is a quarter‑plus of platform work to buy a guarantee that **Tier 1 / Tier 2 already deliver at lower cost without losing features**.
- **As a viable direction for a *smaller* product — yes.** A single‑operator / very‑small‑shop edition (solo production manager, one laptop, CSV export, AI scan via their own key) is a real, shippable product with a genuine "your data never leaves your machine" story. A different market segment, not a replacement.
- **As `H‑a` (local‑first + optional encrypted sync) or `H‑c` (hybrid) — the only genuinely interesting versions, and both are large.** `H‑a` lives or dies on a sync engine (PowerSync the least‑risky 2026 bet, still a major build and a hard dependency). `H‑c` means maintaining two full stacks forever.
- **The trap:** treating "just make it a local app" as a *simplification*. It removes a trust problem and a hosting bill and replaces them with a distribution problem, a sync problem, a backup problem, a support‑without‑logs problem, and a multi‑user problem — several harder than the Tier 1 encryption work.

**Versus the tiered recommendation:** Option H sits *off* the tier ladder because it changes the product, not just the isolation mechanism. Tier 1 (searchable field encryption, org‑held keys) gives a "we can't read your books" guarantee **while keeping one codebase, hosted multi‑user, mobile, and backups**. Tier 2 (auto‑provisioned DB in the org's own cloud) gives "your infrastructure, your keys" **without shipping a desktop app**. Option H only wins outright when the requirement is literally *"nothing on anyone's server, ever, and I'll verify with a packet capture"* — and even then, federation forces a small relay back in.

**What going local‑first gives up:**
- Multi‑user within an org without the org standing up a server or accepting a sync service.
- Mobile as it works today (responsive PWA on the same backend) → "thin online‑only client" or "wait for sync."
- Backups the customer cannot lose.
- Server‑side features and changing them without shipping a client build: cross‑org search, turnkey Places/Calendar, any future server‑side reporting.
- Visibility: usage analytics, aggregate error rates, looking at a row to answer a ticket.
- One codebase and one deploy — `deploy_prod.sh` becomes a signing + notarization + staged‑rollout pipeline, and schema changes are forever‑compatible or they strand users.

**What it gains:** the trust problem for private data disappears with nothing to verify, the hosting bill goes to ~zero, and "your financials never touch our servers" becomes literally true — a real differentiator for exactly the security‑motivated orgs that prompted this document.

---

## 12. Deep dive: self‑serve self‑hosting (Option I)

Cameron's framing: the org creates and owns its own Supabase project (their account, billing, credentials), installs GigWrangler against it, and Cameron never has access to anything. Separately, an **opt‑in** federation service carries only a thin scheduling/availability signal between orgs that choose to participate.

### 12.1 Does the "stack stays intact" claim hold? (mostly yes)

| Claim | Holds? | Why |
|---|---|---|
| RLS still works | **Yes** | The org's own Postgres; the 61 policies apply unchanged. In‑org RBAC (Admin/Manager/Staff/Viewer) is exactly what RLS + the `server` edge function enforce, and **both run in the org's project**. This is the decisive difference from Option H, which removes the server and RLS entirely. |
| No encryption tax | **Yes** | No field encryption, no searchable‑encryption proxy, no aggregate breakage. Financial totals, P&L, sort/filter, full‑text all run server‑side — because there *is* a server side, it's just the org's. |
| Mobile PWA still works | **Yes** | The PWA hits the org's Supabase URL with the same code. A managed Supabase project is internet‑reachable, so field use is unchanged. |
| Multi‑user within an org still works | **Yes** | One shared Postgres + Realtime, exactly like today, in the org's account. No sync engine. |
| Backups become Supabase's problem | **Mostly** | True on Pro+ (PITR, daily backups). On the free tier backups are minimal and **the project pauses after 7 days idle** — fatal for a weekly‑use app. The wizard must push Pro, or ship a scheduled `pg_dump` to the org's storage. |
| Level‑3 trust guarantee | **Yes, by ownership** | Cameron has no credentials, no access path. Verification = read the visible source. Same guarantee class as Option E / H‑b. |

**So the claim largely holds.** Option I ≈ Option E, with the specific choice that the substrate is *managed Supabase in the org's account* rather than a self‑run Docker stack — which is what dodges §5‑E's brutal self‑hosted‑Supabase upgrade story and hands backups/uptime to Supabase.

**What Cameron may be missing:**

1. **The upgrade problem doesn't vanish — it moves to the worst place.** Cameron controls neither the schema nor the deploy; 46 migrations must self‑apply, in order, across N projects Cameron can't see, some on year‑old builds (§12.3). This is the real cost.
2. **Support with zero access** is a genuine ongoing cost, not a footnote (§12.4).
3. **The org becomes a Supabase customer** — plan choice, project pausing, region, billing, and Supabase outages are now the org's problem and the org's ticket *to Supabase*. Onboarding must steer this.
4. **Auth config is the least automatable part** — Google OAuth client creation has no API; SMTP for real transactional email needs a provider (§12.2).
5. **The federation relay still needs someone to run it**, and it holds the participant graph + busy/free — bounded but nonzero (§12.5).
6. **Fleet version skew makes the federation protocol a compatibility problem** (§12.5).
7. **Revenue must come from somewhere the license can protect** (§12.6).

### 12.2 Onboarding — what "set up Supabase and install this" really involves

Manual path today, per org (from `setup-guide.md` + the deploy scripts):

1. Create a Supabase account + project; pick region; **pick Pro (~$25/mo) or the project pauses and has no PITR**.
2. Install Supabase CLI + Docker (for the `db push` shadow DB) — or use the dashboard SQL editor.
3. `supabase link` to the project.
4. `supabase db push` — applies 46 migrations; **creates the `attachments` storage bucket + policies** (they live in migrations — a real plus).
5. `supabase functions deploy` — deploys `server` + `ai-scan` (needs CLI + Deno).
6. `supabase secrets set` — up to 8 secrets, but only the auto‑injected `SUPABASE_*` are mandatory; `GOOGLE_*`, `ANTHROPIC_API_KEY`, `SENTRY_*` are optional‑integration secrets a minimal install skips.
7. Configure Auth: site URL, redirect URLs; for Google sign‑in, a Google Cloud OAuth client (ID + secret); SMTP provider (or accept Supabase's rate‑limited built‑in email — fine for 5 users, not 50).
8. Build the frontend with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (+ optional `VITE_GOOGLE_CLIENT_ID`, `VITE_SENTRY_DSN`); host it.
9. Add the frontend origin to the project's allowed redirect URLs.

**Realistic floor for a non‑technical production‑company owner doing this unaided: they can't.** Steps 2–6 assume a terminal, a package manager, Docker, and `supabase link` comfort — a developer's afternoon, not an owner's.

**What collapses into a wizard:**

- **One‑click Supabase provision.** Precedents exist: DigitalOcean ships a native Supabase template; database.build has one‑click deploy‑to‑Supabase; the community [`supafork`](https://github.com/chroxify/supafork) clones a project in one click. A GigWrangler installer can: OAuth the user into Supabase → create a project via the **Management API in the user's org** → apply the 46 migrations via the Management API query endpoint (no local Docker/CLI) → deploy the 2 functions via the API → set secrets → return URL + anon key. Removes steps 2–6 and 9.
- **Auth config** — site/redirect URLs push via `supabase config push` or the Management API. **Google OAuth client creation cannot be automated** (Google's console has no API for it) → self‑host defaults to **email/password + magic link**, which the wizard *can* fully configure; "Sign in with Google" becomes a documented optional manual step.
- **SMTP** — walk the user through pasting a Resend/SendGrid API key, or Cameron operates a transactional‑email relay (email addresses transit Cameron — minor, disclosable) or skip it (magic links via Supabase's default, accepting the rate limit).
- **Frontend** — the hosted‑frontend split (below).

**Hosted frontend + their database — does it leak anything? Essentially no.**
The frontend is a static bundle that talks to Supabase with the **anon key, which is public by design**; RLS is the only enforcement boundary. If Cameron hosts one frontend for all tenants and it's pointed per‑session at the org's `VITE_SUPABASE_URL` + anon key (pasted once at first run / embedded in a wizard deep link / resolved from a tiny per‑org config), the **browser talks straight to the org's Supabase and Cameron's servers never see org data**. The only thing Cameron could see is what the frontend phones home — Sentry errors, analytics — all opt‑in and strippable. The org adds `app.gigwrangler.com` to its allowed URLs (one wizard step). **The anon‑key + RLS model already treats the frontend as an untrusted client, so hosting it changes nothing about what Cameron can read.** Strongly recommended: it cuts onboarding from "build and host a frontend" to "paste your project URL and key."

**Best‑case onboarding with all of the above:** OAuth into Supabase → click "create my GigWrangler backend" → wait ~3–5 min (provision + migrate + deploy functions) → optionally paste a Resend key → open the Cameron‑hosted app via a deep link that carries the project URL + anon key. **Close to a hosted signup in effort.** The residual the owner can't skip: having/creating a Supabase account with a card, and paying for Pro.

### 12.3 Upgrades across instances Cameron doesn't control — the hardest part

46 migrations, N installs, users who skip versions or never update.

**Mechanism:** ship the migration bundle *inside* the app; on launch/schedule it compares its bundled version against the project's `supabase_migrations.schema_migrations` and applies pending migrations forward (via the Management API or a direct connection). The same forward‑only runner every self‑hosted product builds — the pattern already exists in this repo for the IndexedDB cache (`src/utils/idb/store.ts`, `DB_VERSION` + `upgrade()`).

**Permanent constraints it forces:**

- **Every migration stays runnable indefinitely.** No dependency on a table/function a later migration removes (or the ordering must keep the v10→v46 skip path valid); no migration calls an external service. Stricter than the repo's current "expand‑only for one release" (`deploy_prod.sh`) — it becomes *expand‑only, self‑contained, forever*.
- **Frontend ↔ schema compatibility window.** A year‑old frontend must not run against a v46 schema. With a Cameron‑hosted single frontend (§12.2), the clean answer: the frontend supports schema vN..vN‑k, and refuses + self‑updates outside that range.
- **No rollback on a customer project.** Every migration transactional, leaves the DB on the prior version on failure, surfaces "migration 43 failed — you're safely on 42, here's the log." Managed Supabase PITR (Pro+) is the backstop.
- **Bounded, enforced skew.** Publish "upgrade from any version in the last N months; older installs step through vX first," and keep + test those stepping stones.

**How the comparables actually do it:**

- **[Home Assistant](https://www.home-assistant.io/more-info/unsupported/home_assistant_core_version/)** — auto‑migrates on update; explicit rule to update in increments of **≤6 releases**; deprecation/migration shims kept ~6 months.
- **Discourse** — `./launcher rebuild` runs `rake db:migrate` every rebuild; formal safe‑migration policy, background + batched migrations for big data changes, strong "rebuild often" norm. Works because the app is one opinionated Docker image.
- **[Ghost](https://blog.laurahargreaves.com/ghost-v6/)** — `ghost update` runs migrations; major versions (v5→v6) need care and sometimes a stepping stone; Docker self‑hosters hit breakage on big jumps.
- **Plausible** — docker‑compose; migrations run on container start; majors have documented manual steps.
- **OneUptime** — documented "one major version at a time."
- **Actual Budget** — app carries its own migration list, applies on open; feasible because the schema is small and fully controlled.
- **Common thread:** an opinionated bundled updater + a documented max‑skew + tested stepping‑stone releases + transactional migrations + "back up first." Nobody solved it *elegantly*; everybody made it *routine* through discipline and tooling. ([release‑engineering guide](https://tech-champion.com/database/safe-database-migrations-for-self-hosted-applications-a-practical-release-engineering-guide/))

**Bottom line:** solved‑in‑practice, but a permanent tax on every schema change plus a body of updater/compat tooling to build and maintain — the single biggest ongoing cost of Option I.

### 12.4 Support with zero access

No logs, no DB query, no repro, no "log in as them." For solo‑sustainable support, ship:

- **Self‑service diagnostics screen** — schema version, migration history + last failure, per‑table row counts, project health (API/storage/auth reachable), frontend build version, browser/OS. One "Copy diagnostics" button.
- **Redacted support bundle** — schema‑only dump + migration log + last N app errors (PII scrubbed) + config with secrets masked. One "Download" button; the user emails it.
- **Preflight health checks** — on launch and on demand: project reachable? migrations current? storage bucket present? auth configured? plan about to pause? Catches the ~80% of tickets that are config/plan/connectivity, not code.
- **Opt‑in error reporting** — the Sentry DSN is already wired; point it at Cameron's Sentry (aggregate error visibility — a real asset) with clear scoping, or at an org‑run collector.
- **Reproducible builds + published checksums** so "which build / tampered?" is answerable.
- **Public docs + a community forum** (Discourse‑style) — a solo founder cannot do 1:1 support at scale.

A few weeks of product work plus an ongoing docs/forum commitment. It's the line between sustainable and a treadmill.

### 12.5 The federation layer

**Minimum data the relay holds** (same as §5‑G's hub, for the "instances Cameron can't see" case):

- **Instance registry** — instance ID, display name, public key, reachable endpoint (or "relay‑only").
- **Shared gig core, per federated gig** — a *random shared* gig ID (not the origin instance's PK), status, start/end/timezone, tags, hierarchy link. Title stays instance‑side; relay holds an opaque handle if title confidentiality matters.
- **Participants** — {shared gig ID → instance/org handle, role, is_client}. The irreducible disclosure: *who works with whom, and when*.
- **Availability projection** — {subject handle, busy range, org handle (optional)}. Derived and pushed by each instance; never gig details.
- **Handshakes** — invite / accept / decline / revoke.
- **Nothing else** — no financials, staffing names/rates, kits, purchasing; shared attachments only if a participant opts in, ideally client‑encrypted to the participant set.

**Authentication — to the relay and between instances:**

- Each instance generates a keypair at install; registers its public key with the relay under its instance ID (verified by a domain/email challenge or a Cameron‑issued invite code).
- Instance→relay calls are signed (instance‑key JWT or mTLS).
- Instance→instance (if direct): mutual key check against the registry; the relay is the discovery + key‑distribution root. This is the **Exchange federation trust / RFC 7953** model — independently owned servers, a federation root, redacted free/busy.
- A user spanning two orgs' instances: each instance has its own auth; a single identity needs the relay (or a separate IdP) to broker, or the user keeps two logins — tolerable for a busy/free‑only federation.

**Does Cameron have to run it?**

- **Cameron‑run relay** — simplest, most reliable, Cameron controls the protocol version; holds the bounded dataset above.
- **Peer‑to‑peer, no relay** — works for direct instance↔instance, but loses store‑and‑forward (an invite can't land while the peer is asleep) and still needs *a* discovery/key root; availability lookups fail when the source is unreachable.
- **Org‑hosted / federation‑of‑relays** — a customer consortium or association runs it; Cameron ships the relay open source. Removes Cameron from the trust question; adds governance overhead.

**Does Cameron holding the relay reintroduce the trust problem? Defensibly no, for this use case:**

- The relay never sees private operational data — only the participant graph, dated engagements, and busy/free. **Categorically less** than today's shared DB, and less than a competitor SaaS learns.
- Design choices that make "no" defensible: **blinded identifiers** (relay stores random handles; only participating instances hold the mapping — relay sees "handle A busy 2026‑11‑04", not a name); **opt‑in per gig** (nothing federates unless a manager shares that gig; default fully private); **busy/free only by default** (org identity on an availability record is opt‑in); **minimal retention** (availability records expire when the busy range passes; handshakes kept only while the gig is active); **client‑side encryption past busy/free** (shared notes/attachments encrypted to the participant set; relay stores ciphertext); **open‑source relay + published data schema** so an org can verify exactly what it holds.
- **Honest residual:** even fully blinded, the relay operator observes *that* two handles collaborate and *when* they're busy; long‑run traffic analysis can re‑identify (a handle busy on exactly the dates a known festival runs). Low‑stakes for a busy/free signal among production companies; if "who works with whom" is itself the sensitive thing, only an org‑run or federated relay fully closes it.

### 12.6 Business model

If the org pays Supabase directly, Cameron's revenue must come from something the deployment model and license allow:

| Model | Compatible with self‑hosting? | Notes |
|---|---|---|
| **Per‑seat / per‑org license** (paid key gating the app, or gating updates/support) | Yes | Enforceable via an in‑app license check; honesty‑based for pure OSS. The core commercial lever (Ghost, Sentry, GitLab pattern). |
| **Paid federation tier** | Yes — the natural one | The relay is Cameron‑run; charge per federated org or per active federated gig. Cost (Cameron runs infra) aligns with price; doesn't undermine self‑hosting because the private stack stays free/licensed. |
| **Paid support / SLA** | Yes | Classic OSS model; price high, expect low volume (solo founder). |
| **Hosted convenience option** (Cameron runs the whole thing = the hosted Tier 0/1/2 product) | Yes — this is "offer both" | The revenue workhorse for the ~94% who pick hosted. |
| **Managed self‑hosting** (Cameron provisions + operates the org's project in the org's account) | Yes | Blurs into Tier 2; Cameron has operational access unless tightly scoped, which dilutes the guarantee — position as "convenience, not zero‑knowledge." |
| **Open‑core paid modules** (advanced reporting, integrations) | Yes | Keep the trust‑critical core visible; gate peripheral value. |
| **Usage/volume fees on the app itself** | **No — quietly incompatible** | You can't meter an app in infrastructure you can't see. Anything needing an external count of gigs/users/storage must be self‑reported or license‑tier‑based. |
| **Ads / data monetization** | **No** | Destroys the trust pitch. |

**Clean combination:** source‑available core under a license that permits self‑hosting but forbids a competing hosted service → sell (1) a commercial license / support subscription, (2) the paid federation tier, (3) the hosted convenience product. Three revenue lines, all compatible.

### 12.7 License choice and the visibility question

**Is visible source required for the trust claim?** Largely yes. "Cameron can't read your data" rests on (a) *no credentials* — structural, true regardless — and (b) *the software does what it says and doesn't exfiltrate*. Claim (b) is only **verifiable** with visible source + reproducible builds. For the security‑motivated segment that prompts Option I, source‑available + reproducible builds is close to mandatory; a signed closed binary asks them to trust Cameron's word about the binary (weaker, though still far stronger than SaaS — no credentials).

| License | Effect | Fit |
|---|---|---|
| **AGPL‑3.0** | Copyleft incl. over‑a‑network; anyone may host but must publish modifications. OSI‑approved. | Good trust optics; **does not stop a competitor hosting it**. Fine if the moat is the federation network + brand, not the code. |
| **BSL 1.1** | Source‑visible; free to self‑host within a granted use ("internal production management, not a competing SaaS"); each release converts to an OSI license after ~4 years. | **Strong fit** — org reads every line and self‑hosts; Cameron reserves the hosted market per release for ~4 years. Used by Sentry, CockroachDB, HashiCorp (pre‑relicense). |
| **Elastic License v2** | Source‑visible; forbids offering the software "as a hosted or managed service" to third parties; no copyleft; no change‑date bookkeeping. | **Strong fit**, simpler than BSL. |
| **Functional Source License (FSL)** | Source‑available; anti‑competition for 2 years, then converts to MIT/Apache. | Fit; younger, designed for exactly this; less legal precedent. |
| **SSPL** | AGPL + must open‑source your entire service stack to offer it as a service. | Overkill, toxic optics, not OSI‑approved. Avoid. |
| **MIT / Apache‑2.0** | Permissive; anyone can run a closed competing service. | Only if Cameron doesn't care about a hosted competitor and wants max adoption. |

**Recommendation: BSL 1.1 or FSL** — source fully visible (satisfies verifiability), self‑hosting explicitly allowed, competing hosted service blocked for a few years, auto‑converts to true open source later. Elastic License v2 if BSL's change‑date bookkeeping feels heavy. ([source‑available licensing trends](https://www.goodwinlaw.com/en/insights/publications/2024/09/insights-practices-moving-away-from-open-source-trends-in-licensing))

**Fork / competition risk with visible source:**

- A **license‑stripping hard fork** is a copyright violation — the risk is enforcement/jurisdiction, not licensing. Real but low for a niche vertical tool.
- A **compliant fork** (self‑host, modify) is the point, not a threat.
- The **genuine risk**: a well‑resourced competitor rebuilds the federation relay and runs a compatible hosted network. BSL/ELv2/FSL block the *hosted* part for the protected window; the federation network effect + brand are the durable moat. For a market this size, ~zero serious forks is the likely outcome.
- **Upside of visible source:** trust, customer security audits, community integrations, and a differentiator vs closed competitors.

### 12.8 Who this is actually for

- **Cloud adoption is ~94%; roughly 6% of businesses deliberately self‑host** ([cloud vs self‑hosting](https://www.circadianrisk.com/resources/blog/cloud-vs-self-hosting-which-should-you-choose)), usually for regulation or a hard trust requirement. Option I targets that slice of GigWrangler's market, plus some who choose it on principle.
- **Can the target customer do it?** With the §12.2 wizard (one‑click provision + hosted frontend + magic‑link auth): a moderately capable owner can, *if* they'll create a Supabase account with a card. Unaided: no.
- **Drop‑off vs hosted signup:** every added step (Supabase account, card, plan choice, provisioning wait, paste a key) sheds users; expect a large majority to pick "hosted" when both exist. The self‑host path converts the minority who would otherwise be **zero** — and that minority is exactly the security‑motivated segment.
- **Offer both.** Hosted (Tier 0/1) for the ~94%; self‑hosted (Option I) for the don't‑trust‑it segment. **Same codebase, same schema** — the hosted product is just Cameron running the Option‑I path. The added cost is the wizard + updater/compat tooling (§12.3) + zero‑access support tooling (§12.4) + docs/forum, not a second application.

### 12.9 Verdict vs the tiered recommendation and Option H

**Option I is the strongest operator‑exclusion option in this document for a team‑based product**, and Cameron's read is largely correct: it keeps RLS, auth, storage, realtime, mobile, multi‑user, and server‑side features because it keeps the whole stack — it just runs in infrastructure the org owns. It delivers a **level‑3 guarantee by ownership** without the encryption tax (Tier 1), the Cameron‑operated fleet (Tier 2), the enclave complexity (Tier 3), or the local‑first rewrite / sync bet / multi‑user regression (Option H).

Where it's worse than the hosted tiers:

- **Onboarding friction** — the org must become a Supabase customer; the wizard narrows but doesn't close the gap to email‑signup.
- **Cameron loses the single deploy** — every schema change becomes a permanent fleet‑compatibility exercise (§12.3).
- **Support is higher‑touch and partly blind** (§12.4).
- **Revenue is indirect** — license/support/federation, not a clean per‑seat SaaS bill (§12.6).

**Vs Option H:** Option I dominates on nearly every axis for a multi‑user product. H wins only on "works with no internet at all" and "not even a Supabase project exists." I keeps the PWA, keeps multi‑user without a sync engine, keeps managed backups, and is a much smaller build (no Supabase teardown, no CRDT/sync bet, no desktop packaging + signing). **If self‑hosting is the direction, Option I is the way, not Option H.**

**Positioning:** Option I becomes the **"self‑hosted" tier** beside the hosted tiers — same code, org owns the Supabase project, opt‑in Cameron‑run (or federated) relay for scheduling. Hosted Tier 0/1 stays the default. **Tier 2 (auto‑provisioned DB in the org's cloud) is largely *subsumed by* Option I** — I is Tier 2 where the org drives provisioning and owns the account outright, which is cleaner and a stronger guarantee. A plausible final product line: **hosted Tier 0/1 + self‑hosted Option I**, with Tier 2 folded into I and Tier 3 reserved for a hypothetical future.

### 12.10 Realistic build estimate — first shippable version

Assumes the hosted product already exists. "Shippable v1" = a security‑motivated org can self‑onboard and run it, with basic federation.

| Work item | Rough size |
|---|---|
| **Provisioning wizard** — OAuth into Supabase, create project via Management API, apply 46 migrations via API, deploy 2 functions, set secrets, configure auth (site/redirect URLs, magic link), return URL + anon key | 3–5 weeks |
| **Hosted‑frontend multi‑backend support** — one deployed frontend that accepts an org's project URL + anon key (first‑run or deep link), validates, stores, handles per‑org Google client ID / Sentry opt‑in | 1–2 weeks |
| **In‑app migration runner + compat gate** — bundled migrations, version check vs the project, forward‑apply, transactional failure handling, "schema out of supported range" block + self‑update prompt; make all 46 migrations skip‑safe; add a v1→vN replay test | 3–4 weeks + a permanent tax |
| **Auth without Cameron's server** — decide: magic‑link‑only for self‑host vs documented manual Google client; keep the `server` edge function as‑is (it deploys fine to the org's project — **cheapest**) | 1–3 weeks |
| **Zero‑access support tooling** — diagnostics screen, redacted support‑bundle export, preflight health checks, opt‑in error reporting, reproducible‑build setup | 2–4 weeks |
| **Federation relay v1** — instance registry + keypair enrolment, signed instance→relay API, shared‑gig‑core push/pull, busy/free push + query, invite/accept handshake, blinded handles, per‑gig opt‑in, retention expiry | 6–10 weeks |
| **Federation client in the app** — "share gig", "invite an org", availability lookup UI, background sync of shared‑core changes, conflict handling for the shared row | 4–6 weeks |
| **Licensing + packaging** — pick BSL/FSL, license headers, license‑key check if commercial, docs site, install + upgrade guides, support forum | 2–3 weeks + ongoing |
| **Billing** (Stripe) for the federation tier / license | 1–2 weeks |

**Credible v1: ~5–7 months of focused solo work**, and front‑loadable:

- **Milestone 1 — "self‑host without federation"** (wizard + hosted‑frontend split + migration runner + support tooling + licensing): **~3 months**. Already shippable to the security‑motivated segment.
- **Milestone 2 — federation** (relay + client): **~3 months** more.

The migration/compat tax and the docs/support commitment are permanent, not one‑time.

**Comparison:** **Tier 1** (searchable field encryption) is a similar ~4–6 month build but adds a permanent query‑layer constraint and still leaves Cameron holding decryptable‑in‑memory data (level 2.5). **Option H** is ~6–9 months and gives up features. **Option I's v1 costs about the same as Tier 1, gives a strictly better guarantee, keeps every feature, and is worse only on onboarding friction and the loss of the single deploy.**
