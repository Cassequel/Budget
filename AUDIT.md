# Budget App Audit — Security, Performance, Roadmap

Date: June 9, 2026
Scope: full codebase (Express + Drizzle + Neon server, React + Vite client, Plaid integration, Render/Vercel deploy config)

## Summary

The app's bones are good. Plaid access tokens are encrypted at rest with AES-256-GCM, the `.env` file is gitignored and was never committed, deploy secrets use Render's `sync: false`, and CORS is locked to your client URL. That's better hygiene than most personal projects.

The two things that actually put your bank data at risk were the 4-character admin password with no rate limiting (anyone could brute-force "8080" in under a second) and an unauthenticated Plaid webhook. Both are addressed below, but the password itself you have to change.

I patched the critical issues directly in the code. The rest of this document covers what was fixed, what remains, and how to get to live MACU / credit card / Venmo tracking with self-updating goals.

---

## Part 1: Security

### Fixed in this pass

**1. No rate limiting on login (critical).**
`POST /api/auth/login` accepted unlimited guesses. With a 4-digit password, a script tries all 10,000 combinations in seconds and then has full access to your accounts, balances, and transaction history.
Fix: `express-rate-limit` added. Login is capped at 10 attempts per 15 minutes per IP; the whole API at 300 requests per minute. (`server/src/routes/auth.ts`, `server/src/index.ts`)

**2. Unverified Plaid webhook (critical).**
`POST /api/plaid/webhook` trusted any caller. Anyone who found the URL could fire it repeatedly to hammer your server and burn Plaid API quota.
Fix: webhooks are now verified against Plaid's signed JWT (`plaid-verification` header, ES256, body-hash check, 5-minute freshness window) per Plaid's official scheme. Unverified requests get a 401. (`server/src/plaid/webhookVerify.ts`, `server/src/routes/plaid.ts`)

**3. Timing-unsafe password comparison (medium).**
`password !== process.env.ADMIN_PASSWORD` leaks timing information. Replaced with a constant-time comparison via `crypto.timingSafeEqual`. (`server/src/routes/auth.ts`)

**4. No security headers (medium).**
Added `helmet` (HSTS, X-Content-Type-Options, frame protection, etc.) and a 1 MB JSON body limit. The server also now refuses to boot if `DATABASE_URL`, `JWT_SECRET`, `ADMIN_PASSWORD`, or `ENCRYPTION_KEY` is missing, and warns loudly if the password is under 12 characters. (`server/src/index.ts`)

### You must do these yourself

**1. Change `ADMIN_PASSWORD`.** It's currently `8080`. Rate limiting slows an attacker down but a 4-digit numeric password is still guessable through normal use. Use a long passphrase (12+ characters), update it in `.env` and in Render's dashboard.

**2. Rotate your Neon database password and Plaid secret.** Your `.env` lives in a OneDrive-synced folder, which means your database credentials and Plaid keys are replicated to Microsoft's cloud and any device signed into your account. The keys are currently sandbox-only so exposure is low, but rotate before switching to production, and consider moving this repo out of OneDrive (or excluding `.env` from sync).

**3. Run the new DB migration.** I added indexes to the schema (see Part 2). Generate and apply:

```bash
cd server
npm run db:generate
npm run db:migrate
```

**4. Install the new server dependencies.**

```bash
npm install
```

(New packages: `helmet`, `compression`, `express-rate-limit`, `@types/compression`.)

### Remaining risks, in priority order

**JWT stored in localStorage (medium).** Any XSS vulnerability lets an attacker read the token and impersonate you for up to 7 days. React's escaping plus helmet lowers the odds, but the stronger pattern is an httpOnly cookie with `SameSite=Strict`. Worth doing when you touch auth next. Related: logout only deletes the token client-side; the token stays valid until it expires. A token-version claim checked server-side would give you real revocation.

**No input validation (medium).** Route handlers cast `req.body` and trust it. `POST /api/savings/goals` without `targetAmount` throws a 500; nothing stops absurd values or wrong types. Add `zod` schemas per route. This matters more as you add features, since unvalidated input is where injection and corruption bugs come from.

**`decrypt()` crashes on malformed input (low).** `ciphertext.split(':')` assumes well-formed data. If a DB row is ever corrupted, sync throws an unhandled error. Wrap in a try/catch that marks the item as needing re-link.

**Plaid items have no owner column (low today, high later).** Everything is single-user by design ("admin"). Fine for you alone, but if you ever share the app, every table needs a `userId` and every query needs scoping. Build new features with this in mind.

### Future vulnerabilities to plan for

These aren't holes today, but they become real as the app grows:

When you move `PLAID_ENV` to production, the access tokens in your database unlock real bank data. At that point: rotate `ENCRYPTION_KEY` handling out of OneDrive, turn on Neon IP allowlisting if you keep a fixed egress, and make sure Render's env vars are the only production copy of secrets.

Dependencies rot. Express, jsonwebtoken, and Plaid's SDK all get CVEs eventually. Run `npm audit` monthly or enable GitHub Dependabot on the repo.

The webhook endpoint is now verified, but it still triggers a full sync. If Plaid sends a burst, the in-flight lock I added (see Part 2) prevents pile-ups. Keep that lock if you refactor sync.

The client bundle ships your API URL but no secrets. Keep it that way; anything prefixed `VITE_` ends up readable in the browser.

---

## Part 2: Performance

### Fixed in this pass

**1. N+1 queries during sync (the big one).**
Every synced transaction ran its own account lookup, then its own INSERT. Over Neon's HTTP driver, each query is a full network round trip, so importing 2 years of history meant thousands of sequential HTTP calls. The sync now loads all accounts into a map once, batch-inserts added transactions 200 at a time, deletes removed ones in a single statement, and runs modifications concurrently. Initial import should drop from minutes to seconds. (`server/src/plaid/sync.ts`)

**2. Overlapping syncs.**
A webhook arriving mid-sync started a second full sync in parallel. There's now an in-flight lock; concurrent callers share the running sync's result.

**3. No response compression.**
A 500-row transaction list is a few hundred KB of JSON. `compression` middleware now gzips it, which is roughly a 5–10x size cut on JSON.

**4. Missing indexes.**
Every dashboard, budget summary, and transaction filter scans the transactions table by `date`, `account_id`, or `category`, and none were indexed. Indexes added to the schema; run the migration above to apply them.

### Remaining inefficiencies, biggest first

**Render free-tier cold starts.** This is almost certainly the slowness you feel. Free Render instances spin down after 15 minutes idle and take 30–60 seconds to wake. Options: pay for an always-on instance (~$7/mo), or schedule an uptime ping (e.g., cron-job.org hitting `/api/health` every 10 minutes). Neon's free tier also suspends compute after inactivity, adding another second or two on first query; same ping fixes both.

**Auth check blocks first paint.** `App.tsx` renders "Loading…" until `GET /api/auth/me` returns, so a cold backend means staring at a blank screen for the full wake-up time. Render the app shell optimistically when a token exists and only kick to login on a 401 (your axios interceptor already handles that redirect).

**No client-side caching.** Every page navigation refetches everything. Add TanStack Query (react-query) with a 1–2 minute `staleTime`. Navigations become instant, data refreshes in the background, and you delete most of your manual loading-state code. This is the single highest-leverage client change.

**One bundle.** Recharts, Radix, and every page load up front. Lazy-load routes with `React.lazy` and the dashboard shows up faster.

**Transactions endpoint has no pagination.** It returns up to 500 rows and the client filters in memory. Fine now; add `offset`/`limit` (or cursor) pagination plus a server-side search param before your history grows past a few thousand rows.

**Dashboard runs queries in series.** The monthly aggregate, plan items, and runway queries await one after another. `Promise.all` them and push the net-worth and runway math into SQL aggregates instead of pulling whole tables.

---

## Part 3: Roadmap — live tracking and goals

### Connecting MACU, credit cards, and Venmo

Good news: your Plaid plumbing already does most of this. What's missing is production access and webhook registration (now added).

**MACU.** Mountain America Credit Union is supported by Plaid with OAuth, so linking is the standard Link flow you already built. Your bank accounts and MACU credit cards come through the same connection.

**Plaid environment.** You're on sandbox keys (fake data). To link real accounts, request production access in the Plaid dashboard (Team → request access; pay-as-you-go is free to start and a personal app's volume costs almost nothing). Then set `PLAID_ENV=production` and the production secret in Render.

**Venmo.** Plaid lists Venmo as a connectable institution, so try it first through your normal Link flow. PayPal-owned institutions have historically been flaky with aggregators, so if the connection fails or silently stops syncing, the fallback is Venmo's CSV statement export (Settings → Statements) plus a small import endpoint. Happy to build that importer if you hit the wall.

**Live updates.** Two pieces, one of which I wired up:

- Link tokens now register `PLAID_WEBHOOK_URL`, so Plaid pushes `SYNC_UPDATES_AVAILABLE` to your server the moment new transactions post, and the (now verified) webhook triggers a sync. Set `PLAID_WEBHOOK_URL=https://your-render-app.onrender.com/api/plaid/webhook` in Render and `.env`. Note this only applies to items linked after the URL is set; re-link existing items or call Plaid's `itemWebhookUpdate` for old ones.
- Add a fallback scheduled sync (banks occasionally miss webhooks): a daily cron hitting `/api/plaid/sync`, or a Render cron job. Cheap insurance.

One thing webhooks don't cover: account balances only refresh during sync. Update stored balances from `accountsGet` (or the balances included in `transactionsSync`) on each sync run so net worth stays current.

### Making goals track themselves

The schema already supports this (`savingsGoals.linkedAccountId` exists) but nothing uses it. The build order that gets you the most for the least work:

1. **Balance-linked goals.** When a goal has a `linkedAccountId`, compute `currentAmount` from the account's live balance instead of the manual field. One join in the savings route. Your emergency-fund goal then updates itself every sync.
2. **Contribution-tracked goals.** For goals without a dedicated account (saving for a trip out of checking), track progress as the sum of transactions you tag to that goal. Add a `goalId` column to transactions and a tag dropdown next to your existing category dropdown.
3. **Budget rollups from real categories.** Transactions currently inherit a category from the account name, which makes budget-vs-actual mostly meaningless. Map Plaid's `personal_finance_category` (already stored in `plaidCategory`) to your budget categories with a small rules table ("MAVERIK → Gas") so new transactions categorize themselves and your budget page reflects reality without manual tagging.
4. **Pace and projection.** With live data flowing, the dashboard can answer the questions you actually care about: am I on pace this month, when does this goal complete at my current rate, did a big Venmo charge blow the dining budget. All computable from data you already store.
5. **Alerts.** A scheduled job that checks pace and emails/texts you when a category crosses 80% of its limit or a goal falls behind schedule.

### Suggested order of operations

1. Change the admin password, `npm install`, run the migration, deploy (today)
2. Set `PLAID_WEBHOOK_URL` in Render, request Plaid production access (today; approval takes a few days)
3. Link MACU + credit cards, try Venmo via Plaid (when approved)
4. Add TanStack Query + lazy routes on the client (weekend project)
5. Balance-linked goals, then category mapping, then pace/alerts (one feature at a time)
