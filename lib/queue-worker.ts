import { AppError, database } from "./server";
import { withAccount, accessToken, rawRequest, XError } from "./x-client";
import { verifyReplyTarget, assertPublishable } from "./x-policy";
import { checkDraft, payloadHash, type Job } from "./queue";
import { reserveCost, settleCost } from "./costs";

const leaseMs = 120000;
const clock = () => new Date().toISOString();
async function recoverExpired() {
  const db = database(),
    now = Date.now(),
    stamp = clock();
  // Mark write-intent leases ambiguous even if the process died before the actual fetch.
  await db.batch([
    db
      .prepare(
        "UPDATE cost_entries SET state='unknown' WHERE state='reserved' AND job_id IN (SELECT id FROM queue_jobs WHERE status='dispatching' AND lease_until<=?)",
      )
      .bind(now),
    db
      .prepare(
        "UPDATE cost_entries SET state='released',micros=0 WHERE state='reserved' AND job_id IN (SELECT id FROM queue_jobs WHERE status IN ('processing','canceled','blocked') AND dispatch_at IS NULL AND lease_until<=?)",
      )
      .bind(now),
    db
      .prepare(
        "UPDATE queue_attempts SET state='outcome-unknown',finished_at=?,detail='Lease expired after dispatch intent.' WHERE finished_at IS NULL AND id IN (SELECT lease FROM queue_jobs WHERE status='dispatching' AND lease_until<=?)",
      )
      .bind(stamp, now),
    db
      .prepare(
        "UPDATE queue_attempts SET state='abandoned',finished_at=? WHERE finished_at IS NULL AND id IN (SELECT lease FROM queue_jobs WHERE status IN ('processing','canceled','blocked') AND lease_until<=?)",
      )
      .bind(stamp, now),
    db
      .prepare(
        "UPDATE queue_jobs SET status='outcome-unknown',detail='The worker stopped after recording dispatch intent. Check X before any further action.',lease=NULL WHERE status='dispatching' AND lease_until<=?",
      )
      .bind(now),
    db
      .prepare(
        "UPDATE queue_jobs SET status=CASE WHEN attempts>=4 THEN 'blocked' ELSE 'scheduled' END,lease=NULL,detail='Previous worker stopped before dispatch.' WHERE status='processing' AND lease_until<=?",
      )
      .bind(now),
  ]);
}
async function renew(job: Job) {
  const claim = await database()
    .prepare(
      "UPDATE queue_jobs SET lease_until=? WHERE id=? AND lease=? AND lease_until>? AND status='processing' AND EXISTS(SELECT 1 FROM settings WHERE owner=queue_jobs.owner AND actions_paused=0)",
    )
    .bind(Date.now() + leaseMs, job.id, job.lease, Date.now())
    .run();
  if (!claim.meta.changes)
    throw new AppError(
      "Approval paused, expired or canceled before dispatch.",
      409,
    );
}
async function execute(job: Job) {
  const db = database();
  let reservation: string | undefined,
    dispatchStarted = false;
  try {
    await withAccount(job.owner, job.account_id, async (account) => {
      if (account.x_user_id !== job.x_user_id)
        throw new AppError(
          "The connected X identity changed. Approve a new delivery.",
          403,
        );
      await renew(job);
      if (job.kind === "reply" && job.target_id)
        await verifyReplyTarget(account, job.target_id);
      const draft = await checkDraft(
        job.owner,
        job.draft_id,
        job.revision,
        job.account_id,
      );
      const digest = await payloadHash({
        ...draft,
        draft_id: draft.id,
        account_id: job.account_id,
        x_user_id: account.x_user_id,
      });
      if (digest !== job.digest)
        throw new AppError(
          "The approved content changed. Review it again.",
          409,
        );
      const token = await accessToken(account);
      await assertPublishable(job.owner, job.account_id, draft);
      await renew(job);
      reservation = await reserveCost(
        job.owner,
        job.estimated_micros,
        job.kind === "reply"
          ? "reply.summoned"
          : job.estimated_micros === 200000
            ? "post.create.url"
            : "post.create",
        {
          accountId: job.account_id,
          campaignId: job.campaign_id,
          jobId: job.id,
        },
      );
      const now = clock();
      const finalGate =
        " AND EXISTS(SELECT 1 FROM drafts d WHERE d.id=queue_jobs.draft_id AND d.owner=queue_jobs.owner AND d.revision=queue_jobs.revision AND d.account_id=queue_jobs.account_id) AND EXISTS(SELECT 1 FROM settings s WHERE s.owner=queue_jobs.owner AND s.actions_paused=0) AND EXISTS(SELECT 1 FROM accounts a WHERE a.id=queue_jobs.account_id AND a.owner=queue_jobs.owner AND a.x_user_id=queue_jobs.x_user_id)";
      const replyGate =
        " AND (kind<>'reply' OR (provenance='manual' AND EXISTS(SELECT 1 FROM inbox_items i WHERE i.owner=queue_jobs.owner AND i.account_id=queue_jobs.account_id AND i.post_id=queue_jobs.target_id AND i.subject_x_id=queue_jobs.x_user_id AND i.author_id<>'' AND i.evidence_type IN ('mention','quote') AND i.verified_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') AND i.status<>'resolved' AND i.opt_out=0 AND NOT EXISTS(SELECT 1 FROM x_opt_out o WHERE o.owner=i.owner AND o.account_id=i.account_id AND o.author_id=i.author_id))))";
      const changed = await db.batch([
        db
          .prepare(
            "UPDATE queue_jobs SET status='dispatching',dispatch_at=?,lease_until=? WHERE id=? AND lease=? AND status='processing' AND lease_until>?" +
              finalGate +
              replyGate,
          )
          .bind(now, Date.now() + leaseMs, job.id, job.lease, Date.now()),
        db
          .prepare(
            "UPDATE queue_attempts SET state='dispatching',dispatch_at=? WHERE id=? AND EXISTS(SELECT 1 FROM queue_jobs WHERE id=? AND status='dispatching' AND lease=?)",
          )
          .bind(now, job.lease, job.id, job.lease),
      ]);
      if (!changed[0].meta.changes)
        throw new AppError("Dispatch canceled before sending.", 409);
      dispatchStarted = true;
      const data =
        job.kind === "reply"
          ? { text: job.text, reply: { in_reply_to_tweet_id: job.target_id } }
          : { text: job.text };
      const response = await rawRequest<{ data?: { id: string } }>(
        token,
        "tweets",
        { method: "POST", body: JSON.stringify(data) },
        account,
      );
      if (!response.data?.id || !/^\d+$/.test(response.data.id))
        throw new XError("X returned no confirmed post ID.", 200, true);
      const result = await db.batch([
        db
          .prepare(
            "UPDATE queue_jobs SET status='published',post_id=?,detail=NULL,lease=NULL WHERE id=? AND lease=? AND status='dispatching'",
          )
          .bind(response.data.id, job.id, job.lease),
        db
          .prepare(
            "UPDATE drafts SET status='published',post_id=?,last_error=NULL,updated_at=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND EXISTS(SELECT 1 FROM queue_jobs WHERE id=? AND status='published' AND post_id=?)",
          )
          .bind(
            response.data.id,
            clock(),
            job.draft_id,
            job.owner,
            job.revision,
            job.id,
            response.data.id,
          ),
        db
          .prepare(
            "UPDATE cost_entries SET state='recorded' WHERE id=? AND state='reserved'",
          )
          .bind(reservation),
        db
          .prepare(
            "UPDATE queue_attempts SET state='published',finished_at=? WHERE id=?",
          )
          .bind(clock(), job.lease),
      ]);
      if (!result[0].meta.changes)
        throw new AppError(
          "The job lost its lease while awaiting confirmation.",
          409,
        );
    });
  } catch (error) {
    const reason =
      error instanceof AppError
        ? error.message
        : "A worker error interrupted delivery.";
    const status =
      error instanceof XError
        ? error.upstreamStatus
        : error instanceof AppError
          ? error.status
          : 0;
    const rejected =
      error instanceof XError &&
      !error.uncertain &&
      status >= 400 &&
      status < 500;
    const ambiguous = dispatchStarted && !rejected;
    const paused =
      !dispatchStarted &&
      !!(
        await db
          .prepare("SELECT actions_paused FROM settings WHERE owner=?")
          .bind(job.owner)
          .first<{ actions_paused: number }>()
      )?.actions_paused;
    const retryable =
      !ambiguous &&
      job.attempts < 4 &&
      (status === 429 ||
        (!dispatchStarted && status === 409 && reason.includes("request")));
    const next = ambiguous
      ? "outcome-unknown"
      : paused || retryable
        ? "scheduled"
        : status === 400 ||
            status === 403 ||
            status === 401 ||
            status === 402 ||
            status === 404 ||
            status === 409
          ? "blocked"
          : "failed";
    if (reservation)
      await settleCost(reservation, dispatchStarted ? "unknown" : "released");
    const gate = await db
      .prepare("SELECT blocked_until FROM accounts WHERE id=? AND owner=?")
      .bind(job.account_id, job.owner)
      .first<{ blocked_until: number }>();
    const retryAt = paused
      ? job.run_at
      : new Date(
          Math.max(
            Date.now() + 30000 * 2 ** Math.min(job.attempts, 4),
            gate?.blocked_until || 0,
          ),
        ).toISOString();
    await db.batch([
      db
        .prepare(
          "UPDATE queue_jobs SET status=?,detail=?,lease=NULL,run_at=CASE WHEN ?='scheduled' THEN ? ELSE run_at END,dispatch_at=CASE WHEN ?='scheduled' THEN NULL ELSE dispatch_at END WHERE id=? AND lease=? AND status IN ('processing','dispatching')",
        )
        .bind(next, reason, next, retryAt, next, job.id, job.lease),
      db
        .prepare(
          "UPDATE queue_attempts SET state=?,detail=?,finished_at=? WHERE id=? AND finished_at IS NULL",
        )
        .bind(next, reason, clock(), job.lease),
    ]);
    if (next === "outcome-unknown")
      await db
        .prepare(
          "UPDATE drafts SET status='uncertain',last_error=? WHERE id=? AND owner=? AND EXISTS(SELECT 1 FROM queue_jobs WHERE id=? AND status='outcome-unknown')",
        )
        .bind(reason, job.draft_id, job.owner, job.id)
        .run();
  }
}
export async function tick() {
  const db = database(),
    lease = crypto.randomUUID(),
    now = clock();
  await recoverExpired();
  const job = await db
    .prepare(
      "UPDATE queue_jobs SET status='processing',lease=?,lease_until=?,attempts=attempts+1 WHERE id=(SELECT q.id FROM queue_jobs q JOIN settings s ON s.owner=q.owner WHERE q.status='scheduled' AND q.run_at<=? AND s.actions_paused=0 AND NOT EXISTS(SELECT 1 FROM queue_jobs busy WHERE busy.account_id=q.account_id AND busy.owner=q.owner AND busy.status IN ('processing','dispatching')) ORDER BY q.run_at,q.created_at LIMIT 1) AND status='scheduled' RETURNING *",
    )
    .bind(lease, Date.now() + leaseMs, now)
    .first<Job>();
  if (!job) return { processed: 0 };
  await db
    .prepare(
      "INSERT INTO queue_attempts(id,job_id,started_at,state) VALUES (?,?,?,'processing')",
    )
    .bind(lease, job.id, now)
    .run();
  await execute(job);
  return { processed: 1 };
}
