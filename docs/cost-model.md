# SignalDesk usage estimates

The ledger stores integer micro-USD. One dollar equals 1,000,000 micro-USD. The worker reserves the full classified publication estimate before dispatch. A reply also needs a fresh target lookup. A failed or ambiguous dispatch keeps its allowance until the owner reconciles the ledger against provider billing.

## X pay-per-use registry

Checked November 11, 2026. The developer console supplies the account-specific billing record. [X API pricing](https://docs.x.com/x-api/getting-started/pricing)

| Operation | Estimated USD | Qualification |
| --- | ---: | --- |
| Original post | 0.015 | Per create request |
| Original containing a URL | 0.200 | URL detection uses twitter-text |
| Manually authored summoned reply | 0.010 | Current eligible mention or quote, plain text |
| Summoned reply containing a URL | Unknown | Stays available as a draft |
| Standard post lookup | 0.005 | Per returned post |
| Qualifying owned timeline or mention read | 0.001 | Authenticated X user ID matches configured developer-app owner on an eligible endpoint |
| User read | 0.010 | Per returned profile, including mention author expansions |
| Delete owned post | Unknown | Requires an explicit operator allowance for each requested item |

Existing charges may be deduplicated within a UTC day. The registry estimates each requested resource at full price because the provider calls deduplication a soft guarantee. [X API pricing](https://docs.x.com/x-api/getting-started/pricing)

For 90 ordinary posts, 30 URL posts and 1,000 qualifying owned reads, the example estimate is $8.35. Adding 600 qualifying text replies and 600 qualifying mention reads gives $14.95. SignalDesk also requests a final target lookup for each delivered reply. Six hundred successful standard target lookups could add $3.00. User expansions, profile reads, retries, AI, storage, infrastructure and taxes depend on the workload.

## Budgets and reconciliation

Daily and monthly windows follow UTC. Defaults are $2 per day and $10 per month. Change them under Costs. SQLite admits a reservation and checks both caps in one statement. The app includes retained legacy monthly usage when checking the monthly cap.

Each entry records a category, operation, timestamp and any associated account, job or campaign. Supported categories are X, AI, storage and infrastructure. Local storage and infrastructure have no automatic provider invoice feed. The costs API exposes the latest 500 current-month entries and aggregate totals over all current-month entries.

* **Reserved** holds the maximum estimated charge while a call is pending.
* **Recorded** reflects a completed request and its estimate, including measured resource counts where available.
* **Released** sets unused capacity back to zero when a job stops before dispatch.
* **Unknown** retains the reserved amount after an ambiguous request.
* **Reconciled** records an owner-entered amount and billing reference. An observed charge can exceed a local estimate.

For invoice reconciliation submit an authenticated, same-origin POST to `/api/costs` with an entry ID, integer `micros` and a `reference` to the billing record. A job marked `outcome-unknown` can separately be checked against a specific X post ID in Activity. That check reserves $0.005 for a post lookup. A matching author, text, reply target and dispatch window are required to confirm delivery.

The local allowance covers requests issued by this application. Provider billing, taxes, other clients and any provider-wide cap are managed in the developer console. [X API pricing](https://docs.x.com/x-api/getting-started/pricing)
