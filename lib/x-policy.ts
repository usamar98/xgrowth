import { AppError, database } from "./server";
import { reserveCost, settleCost } from "./costs";
import { xRequest, type PrivateAccount } from "./x-client";

type Access = Pick<
  PrivateAccount,
  "id" | "owner" | "x_user_id" | "granted_scopes" | "health"
>;
export type XPostData = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  public_metrics?: Record<string, number>;
  entities?: { mentions?: { id?: string; username?: string }[] };
  referenced_tweets?: { type: string; id: string }[];
};
type Decision = {
  state: "eligible" | "unknown" | "unavailable" | "ineligible";
  reason: string;
};
export async function accountAccess(owner: string, id: string) {
  const a = await database()
    .prepare(
      "SELECT id,owner,x_user_id,health,granted_scopes FROM accounts WHERE owner=? AND id=?",
    )
    .bind(owner, id)
    .first<Access>();
  if (!a) throw new AppError("Connect the selected X account first.", 404);
  return a;
}
export function requireScopes(a: Access, write = false) {
  const granted = new Set(a.granted_scopes.split(" "));
  if (
    a.health !== "connected" ||
    !["tweet.read", "users.read", ...(write ? ["tweet.write"] : [])].every(
      (s) => granted.has(s),
    )
  )
    throw new AppError(
      "Reconnect this account in Settings to verify its permissions.",
      403,
    );
}
export async function evidence(a: Access, post: XPostData) {
  const refs = post.referenced_tweets ?? [],
    quote = refs.find((r) => r.type === "quoted");
  if (
    !post.author_id ||
    post.author_id === a.x_user_id ||
    refs.some((r) => r.type === "retweeted")
  )
    return { type: "none", quoted: null };
  if (post.entities?.mentions?.some((m) => m.id === a.x_user_id))
    return { type: "mention", quoted: null };
  if (quote) {
    const owned = await database()
      .prepare(
        "SELECT id FROM x_owned_posts WHERE owner=? AND account_id=? AND author_id=? AND id=? UNION SELECT post_id FROM queue_jobs WHERE owner=? AND x_user_id=? AND post_id=? AND status='published'",
      )
      .bind(
        a.owner,
        a.id,
        a.x_user_id,
        quote.id,
        a.owner,
        a.x_user_id,
        quote.id,
      )
      .first();
    return { type: owned ? "quote" : "unknown", quoted: quote.id };
  }
  return {
    type: post.entities?.mentions?.some((m) => !m.id) ? "unknown" : "none",
    quoted: null,
  };
}
export async function replyDecision(
  owner: string,
  accountId: string,
  targetId: string,
  provenance = "manual",
): Promise<Decision> {
  let a: Access;
  try {
    a = await accountAccess(owner, accountId);
    requireScopes(a, true);
  } catch (e) {
    if (e instanceof AppError)
      return { state: "unavailable", reason: e.message };
    throw e;
  }
  if (provenance !== "manual")
    return {
      state: "unavailable",
      reason:
        "AI-assisted replies need clarification from X. Copy the draft and open the original.",
    };
  const row = await database()
    .prepare(
      "SELECT i.*, EXISTS(SELECT 1 FROM x_opt_out o WHERE o.owner=i.owner AND o.account_id=i.account_id AND o.author_id=i.author_id) AS opted FROM inbox_items i WHERE owner=? AND account_id=? AND post_id=?",
    )
    .bind(owner, accountId, targetId)
    .first<{
      author_id: string;
      subject_x_id: string;
      evidence_type: string;
      verified_at: string;
      opted: number;
      opt_out: number;
      status: string;
    }>();
  if (!row || row.subject_x_id !== a.x_user_id)
    return {
      state: "unknown",
      reason: "Import this interaction to verify its recipient.",
    };
  if (row.opted || row.opt_out || row.status === "resolved")
    return {
      state: "ineligible",
      reason: "This conversation is resolved or its author has opted out.",
    };
  if (
    !row.author_id ||
    row.evidence_type === "unknown" ||
    !Number.isFinite(Date.parse(row.verified_at)) ||
    Date.parse(row.verified_at) < Date.now() - 86400000
  )
    return {
      state: "unknown",
      reason:
        "Refresh the interaction to verify the author and current summons.",
    };
  if (!["mention", "quote"].includes(row.evidence_type))
    return {
      state: "ineligible",
      reason: "X did not verify an explicit mention or quote of this account.",
    };
  return {
    state: "eligible",
    reason:
      "X supplied a matching " +
      row.evidence_type +
      " from the original author.",
  };
}
export async function assertPublishable(
  owner: string,
  accountId: string,
  p: {
    kind: string;
    text: string;
    target_id: string | null;
    provenance: string;
  },
) {
  requireScopes(await accountAccess(owner, accountId), true);
  if (
    (p.text.match(/(?:^|[^a-z0-9_])\$[a-z]{1,6}(?![a-z0-9_])/gi) || []).length >
    1
  )
    throw new AppError("X limits self-serve posts to one cashtag.", 400);
  if (p.kind === "post" && !p.target_id) return;
  if (p.kind !== "reply" || !p.target_id)
    throw new AppError("This format requires manual publication in X.", 403);
  const verdict = await replyDecision(
    owner,
    accountId,
    p.target_id,
    p.provenance,
  );
  if (verdict.state !== "eligible") throw new AppError(verdict.reason, 403);
}
export async function verifyReplyTarget(a: PrivateAccount, targetId: string) {
  if (!/^\d{1,20}$/.test(targetId)) throw new AppError("Invalid target.");
  requireScopes(a, true);
  const db = database(),
    cost = await reserveCost(a.owner, 5000, "post.read", { accountId: a.id });
  const markUnknown = () =>
    db
      .prepare(
        "UPDATE inbox_items SET evidence_type='unknown' WHERE owner=? AND account_id=? AND post_id=?",
      )
      .bind(a.owner, a.id, targetId)
      .run();
  let result: { data?: XPostData; errors?: unknown[] };
  try {
    result = await xRequest(
      a,
      "tweets/" +
        targetId +
        "?tweet.fields=author_id,entities,referenced_tweets",
    );
  } catch (e) {
    await markUnknown();
    await settleCost(cost, "unknown");
    throw e;
  }
  await settleCost(cost, "recorded", result.data ? 5000 : 0);
  if (
    result.errors?.length ||
    result.data?.id !== targetId ||
    !result.data.author_id
  ) {
    await markUnknown();
    throw new AppError(
      "The target is unavailable. Open the original on X.",
      403,
    );
  }
  const proof = await evidence(a, result.data);
  const updated = await db
    .prepare(
      "UPDATE inbox_items SET evidence_type=?,subject_x_id=?,quoted_post_id=?,verified_at=? WHERE owner=? AND account_id=? AND post_id=? AND author_id=?",
    )
    .bind(
      proof.type,
      a.x_user_id,
      proof.quoted,
      new Date().toISOString(),
      a.owner,
      a.id,
      targetId,
      result.data.author_id,
    )
    .run();
  if (!updated.meta.changes) {
    await markUnknown();
    throw new AppError(
      "Target identity changed. Import again before replying.",
      403,
    );
  }
}
