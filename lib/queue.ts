import twitterText from "twitter-text";
import { AppError, database, preferences } from "./server";
import { canonicalText } from "./content";
import { estimatePublication, reserveCost, settleCost } from "./costs";
import { assertPublishable, requireScopes } from "./x-policy";
import { withAccount, xRequest } from "./x-client";

export type Payload = {
  kind: string;
  text: string;
  target_id: string | null;
  provenance: string;
};
type DraftRow = Payload & {
  id: string;
  owner: string;
  revision: number;
  account_id: string | null;
  campaign_id: string | null;
  status: string;
};
export type Job = Payload & {
  id: string;
  owner: string;
  draft_id: string;
  revision: number;
  account_id: string;
  x_user_id: string;
  campaign_id: string | null;
  digest: string;
  estimated_micros: number;
  status: string;
  attempts: number;
  lease: string;
  run_at: string;
  post_id: string | null;
};
type Approval = {
  draft_id: string;
  revision: number;
  account_id: string;
  run_at: string;
  timezone: string;
};
const editable = [
  "draft",
  "planned",
  "pending_review",
  "approved",
  "scheduled",
  "canceled",
  "failed",
  "blocked",
];
const active =
  "('scheduled','processing','dispatching','published','outcome-unknown')";
const fields =
  "id,draft_id,revision,account_id,x_user_id,kind,text,target_id,provenance,campaign_id,digest,estimated_micros,status,run_at,timezone,created_at,approved_at,requested_by,dispatch_at,detail,post_id,updated_at";

export async function payloadHash(
  job: Payload & {
    account_id: string;
    x_user_id: string;
    draft_id: string;
    revision: number;
  },
) {
  const bound = JSON.stringify([
    job.account_id,
    job.x_user_id,
    job.draft_id,
    job.revision,
    job.kind,
    job.text,
    job.target_id,
    job.provenance,
    [],
  ]);
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bound)),
  );
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
export async function checkDraft(
  owner: string,
  draftId: string,
  revision: number,
  accountId: string,
) {
  const db = database();
  const row = await db
    .prepare(
      "SELECT id,owner,revision,account_id,campaign_id,status,kind,text,target_id,provenance FROM drafts WHERE id=? AND owner=?",
    )
    .bind(draftId, owner)
    .first<DraftRow>();
  if (!row) throw new AppError("Draft not found.", 404);
  if (
    row.revision !== revision ||
    row.account_id !== accountId ||
    !editable.includes(row.status)
  )
    throw new AppError(
      "Draft or account changed. Review and approve the current version.",
      409,
    );
  if (row.kind !== "post" && row.kind !== "reply")
    throw new AppError(
      "This draft format requires manual publication in X.",
      403,
    );
  if (!row.text.trim() || !twitterText.parseTweet(row.text).valid)
    throw new AppError(
      "Review the weighted post length and unsupported characters.",
    );
  if (row.kind === "reply" && !row.target_id)
    throw new AppError("Choose the conversation to reply to.");
  if (row.kind === "post" && row.target_id)
    throw new AppError(
      "This original post contains a reply target. Review its format.",
    );
  const media = await db
    .prepare("SELECT id FROM draft_media WHERE draft_id=? AND owner=? LIMIT 1")
    .bind(draftId, owner)
    .first();
  if (media)
    throw new AppError(
      "Media publication requires verified upload access. Open this draft in X.",
      403,
    );
  const duplicate = await db
    .prepare(
      "SELECT text FROM drafts WHERE owner=? AND account_id=? AND id<>? AND status IN ('publishing','published','uncertain','outcome-unknown') UNION ALL SELECT text FROM queue_jobs WHERE owner=? AND account_id=? AND draft_id<>? AND status IN " +
        active,
    )
    .bind(owner, accountId, draftId, owner, accountId, draftId)
    .all<{ text: string }>();
  if (
    duplicate.results.some(
      (item) => canonicalText(item.text) === canonicalText(row.text),
    )
  )
    throw new AppError(
      "Matching text has already been approved or submitted for this account.",
      409,
    );
  await assertPublishable(owner, accountId, row);
  return row;
}
export function checkTime(instant: string, timezone: string) {
  if (
    !/(Z|[+-]\d\d:\d\d)$/i.test(instant) ||
    !Number.isFinite(Date.parse(instant))
  )
    throw new AppError(
      "Provide an execution time with an explicit UTC offset.",
    );
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new AppError("Choose a valid IANA timezone.");
  }
  if (Date.parse(instant) < Date.now() - 60000)
    throw new AppError("Choose a future delivery time.");
  return new Date(instant).toISOString();
}
export async function schedule(owner: string, input: Approval) {
  const db = database(),
    runAt = checkTime(input.run_at, input.timezone);
  await preferences(owner);
  const draft = await checkDraft(
    owner,
    input.draft_id,
    input.revision,
    input.account_id,
  );
  const account = await db
    .prepare("SELECT x_user_id FROM accounts WHERE id=? AND owner=?")
    .bind(input.account_id, owner)
    .first<{ x_user_id: string }>();
  if (!account) throw new AppError("Connect the selected account.", 404);
  const cost = estimatePublication(draft.kind, draft.text);
  if (cost === null)
    throw new AppError(
      "Pricing for this action is unconfirmed. Keep the draft or publish manually in X.",
      402,
    );
  const digest = await payloadHash({
    ...draft,
    draft_id: draft.id,
    account_id: input.account_id,
    x_user_id: account.x_user_id,
  });
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  const added = await db
    .prepare(
      "INSERT OR IGNORE INTO queue_jobs(id,owner,draft_id,revision,account_id,x_user_id,kind,text,target_id,provenance,campaign_id,digest,estimated_micros,run_at,timezone,created_at,approved_at,requested_by) " +
        "SELECT ?,d.owner,d.id,d.revision,a.id,a.x_user_id,d.kind,d.text,d.target_id,d.provenance,d.campaign_id,?,?,?,?,?,?,? FROM drafts d JOIN accounts a ON a.id=d.account_id AND a.owner=d.owner JOIN settings s ON s.owner=d.owner " +
        "WHERE d.id=? AND d.owner=? AND d.revision=? AND a.id=? AND a.x_user_id=? AND d.status=? AND s.actions_paused=0",
    )
    .bind(
      id,
      digest,
      cost,
      runAt,
      input.timezone,
      now,
      now,
      owner,
      draft.id,
      owner,
      draft.revision,
      input.account_id,
      account.x_user_id,
      draft.status,
    )
    .run();
  if (!added.meta.changes)
    throw new AppError(
      "Approval could not be saved. Check the queue, pause state and account before continuing.",
      409,
    );
  return {
    id,
    job_id: id,
    status: "scheduled",
    estimated_micros: cost,
    run_at: runAt,
  };
}
export async function queueView(owner: string) {
  const db = database();
  await preferences(owner);
  const [jobs, settings] = await Promise.all([
    db
      .prepare(
        "SELECT " +
          fields +
          " FROM queue_jobs WHERE owner=? ORDER BY created_at DESC LIMIT 500",
      )
      .bind(owner)
      .all(),
    db
      .prepare("SELECT actions_paused FROM settings WHERE owner=?")
      .bind(owner)
      .first<{ actions_paused: number }>(),
  ]);
  return { jobs: jobs.results, paused: !!settings?.actions_paused };
}
export async function cancelJob(owner: string, id: string) {
  const changed = await database()
    .prepare(
      "UPDATE queue_jobs SET status='canceled',detail='Canceled by owner.' WHERE id=? AND owner=? AND status IN ('scheduled','processing')",
    )
    .bind(id, owner)
    .run();
  if (!changed.meta.changes)
    throw new AppError(
      "This job can no longer be canceled. Check its delivery status.",
      409,
    );
}
export async function reconcileJob(
  owner: string,
  id: string,
  accountId: string,
  postId: string,
) {
  const db = database();
  const job = await db
    .prepare(
      "SELECT * FROM queue_jobs WHERE id=? AND owner=? AND account_id=? AND status='outcome-unknown'",
    )
    .bind(id, owner, accountId)
    .first<Job & { dispatch_at: string }>();
  if (!job)
    throw new AppError("Choose an unconfirmed delivery for this account.", 404);
  return withAccount(owner, accountId, async (account) => {
    requireScopes(account);
    if (account.x_user_id !== job.x_user_id)
      throw new AppError("Verify the original connected identity.", 403);
    const hold = await reserveCost(owner, 5000, "post.read", {
      accountId,
      jobId: id,
      campaignId: job.campaign_id,
    });
    type Candidate = {
      id: string;
      author_id: string;
      text: string;
      created_at: string;
      referenced_tweets?: { type: string; id: string }[];
    };
    let response: { data?: Candidate };
    try {
      response = await xRequest(
        account,
        "tweets/" +
          postId +
          "?tweet.fields=author_id,created_at,referenced_tweets",
      );
    } catch (e) {
      await settleCost(hold, "unknown");
      throw e;
    }
    await settleCost(hold, "recorded", response.data ? 5000 : 0);
    const p = response.data,
      offset = Date.parse(p?.created_at || "") - Date.parse(job.dispatch_at);
    const target =
      p?.referenced_tweets?.find((ref) => ref.type === "replied_to")?.id ||
      null;
    if (
      !p ||
      p.id !== postId ||
      p.author_id !== job.x_user_id ||
      p.text !== job.text ||
      target !== job.target_id ||
      !Number.isFinite(offset) ||
      offset < -30000 ||
      offset > 600000
    )
      throw new AppError(
        "X could not verify matching author, time, text and reply target. The delivery remains unconfirmed.",
        409,
      );
    const result = await db.batch([
      db
        .prepare(
          "UPDATE queue_jobs SET status='published',post_id=?,detail='Verified against the owner-selected post.' WHERE id=? AND owner=? AND status='outcome-unknown' AND NOT EXISTS(SELECT 1 FROM queue_jobs WHERE owner=? AND post_id=? AND id<>?)",
        )
        .bind(postId, id, owner, owner, postId, id),
      db
        .prepare(
          "UPDATE drafts SET status='published',post_id=?,revision=revision+1,last_error=NULL,updated_at=? WHERE id=? AND owner=? AND revision=? AND EXISTS(SELECT 1 FROM queue_jobs WHERE id=? AND status='published' AND post_id=?)",
        )
        .bind(
          postId,
          new Date().toISOString(),
          job.draft_id,
          owner,
          job.revision,
          id,
          postId,
        ),
    ]);
    if (!result[0].meta.changes)
      throw new AppError(
        "This result was already recorded. Refresh Activity.",
        409,
      );
    return { ok: true, post_id: postId };
  });
}
