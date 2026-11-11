# Operating the publication worker

Use the same APP_ORIGIN and SIGNALDESK_WORKER_SECRET for the application and worker. Generate a secret of at least 32 characters. Apply all SQL migrations and start the web process, then start the worker in another terminal.

```sh
npm run worker
```

For a single pass, run `node scripts/queue-worker.mjs --once`. The worker requests one authenticated tick, claims a due job if present and runs due local automation rules. Keep the worker running for scheduled delivery. The queue lives in D1 and survives both processes restarting. All execution timestamps are UTC and retain the owner's IANA timezone for display.

## Approval and delivery

An owner approves an exact draft revision, connected identity, destination, text and content format. Each approval stores a SHA-256 digest and a cost estimate. Editing the draft invalidates queued approvals. Rescheduling preserves the revision and account. The job records approval time, requesting owner, dispatch attempts, state, estimated cost and any returned post ID.

A single SQL claim selects one due job per account. The process renews its tokenized lease around token refresh and eligibility checks. External requests have bounded timeouts. Immediately before the write, the worker reserves budget and commits dispatch intent only while the job still has its lease, the approved version and account match, dispatch is active, and any reply evidence and opt-outs permit sending. The account's separate lock coordinates token rotation, imports and writes.

Pause prevents new dispatches. If a request has crossed the recorded dispatch boundary, the provider can still complete it. Disconnect removes the credential and blocks later jobs. An edited, canceled or blocked draft can be reviewed and approved again. Confirmed deliveries record the X post ID. Confirmed replies also resolve their imported conversation.

## Recovery

* An expired lease before dispatch returns to the queue, up to the retry limit.
* A known rate-limit rejection defers the job to the later of the provider reset time or local backoff. The worker permits up to four claims.
* A write timeout, unreadable successful response or expired lease after dispatch produces `outcome-unknown`. The worker leaves the approved job in review.
* The authenticated reconciliation endpoint accepts the actual post ID selected by the owner. It reads that post and checks the connected author, approved text, reply target and time of publication. A mismatch leaves the job unresolved.
* Billing reconciliation is separate. Provide the actual billed amount and reference in Costs.

While thread, quote and media publishing lack verified access, their drafts stay available for manual completion in X. The deferral happens before dispatch. The fixture suite exercises normal text delivery, reply eligibility, approval invalidation, ambiguous outcomes, concurrency, restart and budget recovery. Run `npm test` against provider mocks.
