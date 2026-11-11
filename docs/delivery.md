# SignalDesk delivery record

## Local implementation

| Area | Delivered |
| --- | --- |
| Foundation | Existing React/Vinext application, private dispatcher identity and owner allowlist, local sign-in simulator, D1 migrations, encrypted X grants, configurable timezone, bounded imports, private R2 media. |
| Daily writing | Persistent autosave, version history and restoration, post/thread/quote/reply drafts, library organization, weighted counts, import/export, manual image attachments and native-X fallback. |
| Engagement | Filterable three-panel inbox, source IDs and retrieval dates, saved notes, snooze, resolve, opt-outs, selected campaign and evidence-based eligibility. |
| Delivery | Exact revision, target and account approval, calendar views, saved weekly slots, reschedule/cancel, pause, signed worker access, durable dispatch intent and ambiguous-outcome recovery. |
| Costs | Versioned reference rates, URL classification, integer microdollars, per-action reservations, daily/monthly ceilings, cost ledger and manual reconciliation against a billing reference. |
| Creative workflows | Editable voices and knowledge, inspiration library, campaign attribution, local Ollama boundary, AI provenance and explicit context selection. |
| Measurement | Date-stamped imports and snapshots, missing-field preservation, CSV export, observed follower change, delivery and inbox summaries, two-post observational comparisons, signed first-party outcomes. |
| Operations | Local scheduled review/draft/digest/alert rules, run history, test mode, scoped developer API, stdio MCP bridge, private exports and retention cleanup. |

## Verification

The November 11, 2026 local run passed TypeScript, ESLint, all 30 application and integration checks, and the production build. The local database applied all 11 migrations and a second migration check found no pending changes.

The build and test commands are in the project README. The integration tests use an in-memory SQLite database with the project migrations and mock X responses. Browser tests exercise the running local app with loopback development identity. Separate browser fixtures intercept the API to verify delivery approval and a stale conversation with a manual reply. No test needs a live X account.

- The queue suite covers immutable approvals, account switching, simultaneous claims, ambiguous delivery, restart, dispatch recovery, pause, disconnect, rate-limit handling, edit invalidation, opt-outs and read-only reconciliation.
- X integration fixtures cover forged, expired and replayed OAuth callbacks, token encryption, bounded data and evidence, expired eligibility, AI reply restrictions, ownership checks, per-item deletion outcomes and workspace data removal.
- Operations fixtures cover DST gaps and overlaps, Asia/Karachi local time, scoped-key revocation, upload signatures, rule-run deduplication, signed webhook replay, weekly slot selection, thread splitting, selected model context and preservation of AI provenance across edits.
- Desktop and mobile browser checks cover private sign-in, saved drafts and revisions, calendar navigation, queue dry run, inbox, costs, settings, connection errors, palette navigation and light/dark themes. Additional fixtures submit an exact approval and copy a preserved reply for native X. The test suite removes the live local draft it creates.

## Integration and feature limits

Live X OAuth, real X charges, publishing and deletion need the owner's developer credentials and authorization. Local AI generation needs a compatible installed Ollama model. Owner sign-in in the local preview is simulated; a production installation needs the private dispatcher. No public deployment or commercial account provisioning is part of this build.

Quote, thread and image drafts support manual completion. API dispatch for those formats remains gated. Autonomous and AI-assisted API replies stay disabled. The worker can publish eligible manually written replies after individual approval. Mentions and quotes have bounded coverage; import is owner-triggered.

Rules currently produce scheduled local drafts, summaries and in-app reports. More elaborate event-triggered rule chains, delivery of individual thread parts, broader licensed discovery, multi-user invitations and billing are outside this personal release. Local outcome attribution relies on the emitting site's signed campaign ID. Retention cleanup runs while the worker is active.
