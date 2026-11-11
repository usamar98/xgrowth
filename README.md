# SignalDesk

SignalDesk is a private X workspace for writing original posts, reviewing mentions, scheduling approved drafts, and tracking usage. Drafting, campaign planning, voice profiles, the calendar, and local rules work without an X or AI subscription.

## Run locally

Use Node 22.14 or later and npm. From the project directory, run the following in PowerShell.

```powershell
npm run install:ci
npm run setup:local
npm run dev
```

Open [the local workspace](http://localhost:5173) and choose **Sign in to connect**. The development server simulates one owner on loopback. Settings shows which X credentials are still needed. You can write and save drafts immediately after local sign-in. Open a second terminal for scheduled publishing and local rules.

```powershell
npm run worker
```

The setup command preserves existing environment values, generates missing server keys, and applies ordered SQL migrations to local D1. Stop and restart the web process and worker after changing environment values. Both processes must use the same origin and worker secret. The local worker reads its schedule from D1 at each tick. Keep the machine and both processes running when delivery is due. Overnight downtime delays eligible jobs until the next successful tick.

The repository uses the existing React, Vinext, TypeScript, Cloudflare D1, and R2 foundation. D1 stores workflow and accounting records. R2 stores private draft images. SQLite-compatible SQL migrations in `drizzle/` are applied using Wrangler migration tracking. The starter Drizzle generation command describes the original baseline schema only. New schema changes use ordered SQL migrations.

## Connect X and publish

1. Register a confidential OAuth 2.0 web app in the X developer console. Register the exact local callback `http://localhost:5173/api/x/callback`, or the HTTPS deployment origin followed by `/api/x/callback`.
2. Set `X_CLIENT_ID`, `X_CLIENT_SECRET`, and the matching `APP_ORIGIN` in the server environment. Retain the encryption key created during local setup.
3. In Settings, connect X and verify the returned handle. Select a timezone and open Costs & usage to set daily and monthly limits.
4. Review the resource cap and cost estimate before importing owned posts or mentions. Unknown public metrics remain unavailable.
5. Save an original draft or open an imported conversation in Engage. Review the writing, selected account, target and estimate. Approve immediate delivery or select a local time.
6. Follow the result in Calendar & queue and Activity. For replies with insufficient evidence, use Copy reply and Open original on X. A pending dispatch can remain ambiguous after a network failure. Review it before considering any additional action.

Thread, quote, and image drafts can be prepared locally. API delivery for those formats stays gated until account entitlements and a matching transport are verified. AI-assisted replies stay draft-only. For credentials, eligibility rules, endpoint evidence and billing assumptions, see [integration capabilities](docs/integration-capabilities.md), [the cost model](docs/cost-model.md), and [queue operation](docs/queue.md).

## Optional tools

- **Local AI.** Configure `OLLAMA_MODEL` with the name of an installed local Ollama model. The application calls the fixed loopback Ollama service. Selected writing, knowledge, voice and explicitly requested conversation context are the model inputs. Local-model token counts are recorded when returned. Hardware and electricity costs are outside the X spending ledger.
- **Automations.** Create a daily or weekly local review, release draft, mention digest or failure report. The worker records one result per scheduled occurrence. A dry run previews the result. Workspace pause applies to scheduled rules and publishing.
- **Developer API.** Issue a short-lived scoped key in Settings. Send a JSON POST to `/api/developer` with a bearer token and a `tool` value of `list_drafts`, `create_draft`, `request_review`, `job_status`, or `workspace_summary`. Draft creation also needs `text`. Status and review requests need `id`. The server enforces the bound account and permits 30 requests per key per minute.
- **MCP.** Launch `node scripts/desk-mcp.mjs` from a local MCP client with `APP_ORIGIN` and `SIGNALDESK_API_TOKEN` in the process environment. It uses newline-delimited JSON-RPC over stdio and the same scoped HTTP services. Human approval remains inside the app.
- **Outcomes.** Configure `SIGNALDESK_EVENT_SECRET` and `SIGNALDESK_EVENT_OWNER` on the server. Your first-party backend may send `visit`, `signup`, or `purchase` events to `/api/outcomes`. Supply a UUID `id`, `campaign_id`, UTC `occurred_at`, `event` and boolean `bot`. Set `X-SignalDesk-Timestamp` to Unix seconds and `X-SignalDesk-Signature` to hex HMAC-SHA256 over the timestamp, a period, and the exact UTF-8 JSON request body. Signatures expire after five minutes. Replayed IDs are deduplicated. The site backend supplies campaign attribution and bot classification. The receiver accepts no visitor profiles or sales amounts.

## Verify

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

With the development web process already running, `npm run test:browser` exercises the local UI. On Windows it uses installed Edge. On other machines install the matching Playwright Chromium browser first. Test images are saved in the ignored `.sites-runtime/browser/` folder. Provider fixtures supply X responses in integration tests. See [delivery status](docs/delivery.md) for the scope and verification record.

## Deployment, recovery and privacy

**Vercel.** Use the repository root and the Next.js preset. The checked-in `vercel.json` runs `npm run build:vercel` and uses the native `.next` output. Configure the private owner login and a persistent libSQL database before using the hosted workspace. Setup and migration steps are in the [Vercel deployment checklist](docs/deployment-checklist.md#vercel).

Run `npm run build:vercel` followed by `npm run test:vercel` to verify the manifests and exercise the compiled sign-in and API routes locally using disposable credentials.

**Cloudflare / Sites.** `npm run build` emits the Worker under `dist/server/`. Use the private Sites identity dispatcher with the configured `OWNER_USER_ID`, a D1 binding named `DB`, and an R2 binding named `BUCKET`. Set server secrets outside the source tree. Apply all `drizzle/*.sql` migrations in filename order. Configure the separate worker with the protected tick endpoint reachable at the same HTTPS origin. The web application authenticates owner requests through dispatcher-supplied identity headers. Directly exposing the raw Worker bypasses that ingress trust boundary. Public signup and billing are outside the personal release.

Stop both local processes before backing up `.wrangler/state`, which includes the SQLite and object-storage state. Store that backup encrypted and keep its matching encryption key in a separate secret store. Restore state to an isolated local directory first, set the original environment and verify drafts and version links with publishing paused. A JSON workspace export omits credentials and media bytes. Maintain distinct production backups of D1, R2 and server keys.

For key rotation, pause work, wait for in-flight operations, disconnect the account, and allow outstanding OAuth states to expire. Then change the encryption key, restart both processes and reconnect the same X identity. Verify the returned handle before approving new jobs. Existing stored credentials need the key that originally encrypted them.

Settings → Data & privacy controls export, observation retention and local data removal. The worker prunes expired snapshots in bounded batches. Private notes and opt-outs survive normal observation expiry. First-party outcome records expire after 30 days. Confirmed app-initiated deletion clears stored post content and its metric history. Upstream deletion discovered outside this app requires explicit rechecking and local cleanup. Disconnection stops future work for the account. A request already accepted by X can still complete. Workspace removal retains aggregate budget reservations used to enforce the cap.
