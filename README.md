# XGrowth — Content Studio

A private working application for original X content, persistent drafts, publication planning, and account-owner-controlled publishing. It does not promise followers, fast growth, or freedom from suspension. The research and business case is in [docs/X-API-CASE-STUDY.md](docs/X-API-CASE-STUDY.md) and inside the app.

## Implemented

- Responsive overview, content studio, weekly planner, insights, API study, and settings.
- Owner-scoped D1 persistence for drafts, settings, connections, and budget reservations.
- Editorial writing templates; no paid language-model dependency or simulated AI generation.
- X OAuth 2.0 with S256 PKCE, single-use state, browser cookie binding, encrypted server-side access/refresh tokens, and token renewal.
- Multiple authorized X profile connections and disconnection.
- User-triggered reads of the connected profile and up to 30 original posts.
- Exact-text publishing confirmation, weighted Unicode/emoji/URL validation, stored-draft duplicate checks, atomic account leases and draft state changes.
- Conservative monthly API allowance and persistent X rate-limit backoff.
- Uncertain publishing outcomes blocked from automatic retry; check X before reconciling.
- Privacy explanation and workspace-data deletion.

Planning dates are manual reminders. There is no background scheduler, AI reply bot, auto-like, auto-follow, bulk messaging, scraping, or ban-evasion feature. Fetched X post text is not saved to the database. The frontend clears fetched analytics after 15 minutes; server responses use `Cache-Control: no-store`.

## Local development

Node 22.14+; React/Vinext; Cloudflare Worker; D1 with generated Drizzle migrations.

```powershell
npm run install:ci
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_tough_dexter_bennett.sql
npm run dev
```

The preview prints its local URL. Its sign-in link simulates identity for loopback development only; production identity comes from the private Sites dispatcher. No development identity fallback exists in application routes. Apply each migration once, in order; Sites applies production migrations during publishing.

Use `npm run install:ci` after cloning: it includes required development and optional packages even if the host defaults to production-only installs. Stop the preview before changing dependencies on Windows to avoid file locks.

## Connect a real X account

1. Create an X developer web app with OAuth 2.0 and read/write permissions. Fund API credits.
2. Set `APP_ORIGIN` to the exact trusted app origin. Register `APP_ORIGIN/api/x/callback` as the X callback.
3. Set `X_CLIENT_ID`, `X_CLIENT_SECRET`, and `X_TOKEN_ENCRYPTION_KEY` as server-side secrets. The encryption key is 32 cryptographically random bytes encoded as 64 hexadecimal characters. Do not replace it while existing tokens depend on it without a migration/reconnect plan.
4. Local development reads the ignored `.env`; copy field names from `.env.example`. Hosted runtime secrets are managed through Sites and require deployment to apply.
5. Use Settings → Connect X account and approve `tweet.read tweet.write users.read offline.access` on X.

The private deployment has its origin and encryption key configured. X client credentials and account authorization remain. No real X account, live billing, or publication was tested during this build.

## Verification

```powershell
node node_modules/typescript/bin/tsc --noEmit
node scripts/test-app.mjs
npm run build
```

The suite invokes actual route handlers against SQLite while mocking identity/runtime bindings and X. It covers authorization, cross-owner access, persistence, edit conflicts, dates, Unicode, missing analytics, encryption, refresh rotation, duplicate publishing, ambiguous requests, rate-limit headers, and budget denial. It does not contact X.

## Operational limits

This is a private MVP, not a public SaaS launch. The allowance uses conservative request reservations, including failures, and is not reconciled to the X bill. Configure X's developer-wide spending limit. Draft storage is bounded to 500 records per workspace. Metrics are a recent-post snapshot with lifetime totals, not historical follower attribution. Uncertain outcomes require investigation; logs do not include tokens or post text.

Budget reservation totals survive workspace deletion to prevent allowance bypass. Workspace deletion removes locally stored connections; users should also revoke access in X's Connected apps settings. Disconnection attempts upstream revocation and reports when the user needs to finish on X.

Before a commercial launch, test live OAuth and subscribed endpoints; validate an operator retention/deletion process; add historical measurement only with appropriate retention, scheduling only with durable execution and duplicate reconciliation, service monitoring, key rotation, developer-wide quotas, public onboarding/access controls, and service privacy/terms. API requirements and prices can change.

WebMCP exposes `start_x_post_draft` when supported. It opens the editor and never saves or publishes. Unsupported browsers continue normally. Live WebMCP validation passed: registration, valid editor staging, invalid-input rejection, and visible state read-back.
