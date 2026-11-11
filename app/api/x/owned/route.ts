import { z } from "zod";
import { handle, owner, body, database, config, AppError } from "@/lib/server";
import { reserveCost, settleCost } from "@/lib/costs";
import { requireScopes, accountAccess } from "@/lib/x-policy";
import {
  withAccount,
  xRequest,
  XError,
  type PrivateAccount,
} from "@/lib/x-client";

type StoredPost = {
  id: string;
  text: string;
  author_id: string;
  created_at: string | null;
  fetched_at: string;
  public_metrics: string | null;
  status: string;
};
const selection = z.object({
  account_id: z.string().uuid(),
  post_ids: z
    .array(z.string().regex(/^\d{1,20}$/))
    .min(1)
    .max(3),
});
const parseMetrics = (v: string | null) =>
  v ? (JSON.parse(v) as Record<string, number>) : null;
export async function GET(request: Request) {
  return handle(async () => {
    const o = await owner(),
      id = z
        .string()
        .uuid()
        .parse(new URL(request.url).searchParams.get("account_id"));
    await accountAccess(o, id);
    const db = database(),
      [posts, profile] = await Promise.all([
        db
          .prepare(
            "SELECT id,text,author_id,created_at,fetched_at,public_metrics,status FROM x_owned_posts WHERE owner=? AND account_id=? ORDER BY created_at DESC LIMIT 500",
          )
          .bind(o, id)
          .all<StoredPost>(),
        db
          .prepare(
            "SELECT observed_at,name,username,public_metrics FROM x_profile_snapshots WHERE owner=? AND account_id=? ORDER BY observed_at DESC LIMIT 1",
          )
          .bind(o, id)
          .first<{
            observed_at: string;
            name: string;
            username: string;
            public_metrics: string | null;
          }>(),
      ]);
    return {
      posts: posts.results.map((p) => ({
        ...p,
        public_metrics: parseMetrics(p.public_metrics),
      })),
      profile: profile
        ? { ...profile, public_metrics: parseMetrics(profile.public_metrics) }
        : null,
      fetchedAt: profile?.observed_at ?? null,
    };
  });
}
function deletionAllowance() {
  const amount = Number(config("X_DELETE_COST_MICROS"));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 10000000)
    throw new AppError(
      "Set a verified deletion allowance (X_DELETE_COST_MICROS) in the server configuration before deleting.",
      402,
    );
  return amount;
}
function selected(ids: string[]) {
  const maximum = Math.min(
    3,
    Math.max(
      1,
      Number.parseInt(config("X_DELETE_BATCH_LIMIT") || "3", 10) || 1,
    ),
  );
  if (ids.length > maximum || new Set(ids).size !== ids.length)
    throw new AppError("Select up to " + maximum + " distinct owned posts.");
  return [...ids].sort();
}
export async function POST(request: Request) {
  return handle(async () => {
    const o = await owner(request),
      p = selection.parse(await body(request)),
      ids = selected(p.post_ids);
    const a = await accountAccess(o, p.account_id);
    requireScopes(a, true);
    const amount = deletionAllowance(),
      db = database();
    const q =
      "SELECT id,text,created_at,fetched_at,status FROM x_owned_posts WHERE owner=? AND account_id=? AND author_id=? AND status='published' AND id IN (" +
      ids.map(() => "?").join(",") +
      ")";
    const posts = await db
      .prepare(q)
      .bind(o, a.id, a.x_user_id, ...ids)
      .all();
    if (posts.results.length !== ids.length)
      throw new AppError(
        "Selection contains an unavailable or unowned post.",
        403,
      );
    const expires = Date.now() + 300000,
      id = crypto.randomUUID();
    await db.batch([
      db
        .prepare("DELETE FROM x_delete_previews WHERE owner=? OR expires<?")
        .bind(o, Date.now()),
      db
        .prepare(
          "INSERT INTO x_delete_previews(id,owner,account_id,post_ids,expires) VALUES(?,?,?,?,?)",
        )
        .bind(id, o, a.id, JSON.stringify(ids), expires),
    ]);
    return {
      confirmation: id,
      posts: posts.results,
      expires_at: new Date(expires).toISOString(),
      estimate_micros: ids.length * (5000 + amount),
      account: a.id,
      username: (
        await db
          .prepare("SELECT username FROM accounts WHERE id=? AND owner=?")
          .bind(a.id, o)
          .first<{ username: string }>()
      )?.username,
    };
  });
}
async function removeOne(a: PrivateAccount, id: string, allowance: number) {
  requireScopes(a, true);
  const db = database(),
    o = a.owner;
  const valid = await db
    .prepare(
      "SELECT id FROM x_owned_posts WHERE owner=? AND account_id=? AND author_id=? AND id=? AND status='published'",
    )
    .bind(o, a.id, a.x_user_id, id)
    .first();
  if (!valid) throw new AppError("Owned post is unavailable.", 403);
  const read = await reserveCost(o, 5000, "post.read", { accountId: a.id });
  let fresh: { data?: { id: string; author_id?: string } };
  try {
    fresh = await xRequest(a, "tweets/" + id + "?tweet.fields=author_id");
    await settleCost(read, "recorded", fresh.data ? 5000 : 0);
  } catch (e) {
    await settleCost(read, "unknown");
    throw e;
  }
  if (fresh.data?.id !== id || fresh.data.author_id !== a.x_user_id)
    throw new AppError(
      "X did not confirm authorship. The post was retained.",
      403,
    );
  const reservation = await reserveCost(o, allowance, "post.delete", {
    accountId: a.id,
  });
  const claimed = await db
    .prepare(
      "UPDATE x_owned_posts SET status='deleting' WHERE owner=? AND account_id=? AND author_id=? AND id=? AND status='published' AND EXISTS(SELECT 1 FROM settings WHERE owner=? AND actions_paused=0) AND EXISTS(SELECT 1 FROM accounts WHERE owner=? AND id=? AND health='connected' AND tokens=? AND locked_until>? AND blocked_until<=?)",
    )
    .bind(
      o,
      a.id,
      a.x_user_id,
      id,
      o,
      o,
      a.id,
      a.tokens,
      Date.now(),
      Date.now(),
    )
    .run();
  if (!claimed.meta.changes) {
    await settleCost(reservation, "released");
    throw new AppError(
      "Account, pause state, or post changed before deletion.",
      409,
    );
  }
  try {
    const res = await xRequest<{ data?: { deleted: boolean } }>(
      a,
      "tweets/" + id,
      { method: "DELETE" },
    );
    if (res.data?.deleted !== true)
      throw new XError(
        "X did not confirm deletion. Review the original.",
        200,
        true,
      );
    await db.batch([
      db
        .prepare(
          "UPDATE x_owned_posts SET status='deleted',text='',public_metrics=NULL WHERE owner=? AND account_id=? AND id=?",
        )
        .bind(o, a.id, id),
      db
        .prepare(
          "DELETE FROM x_post_snapshots WHERE owner=? AND account_id=? AND post_id=?",
        )
        .bind(o, a.id, id),
    ]);
    await settleCost(reservation, "recorded");
    return { id, status: "deleted" };
  } catch (e) {
    const unknown = !(e instanceof XError) || e.uncertain;
    await db
      .prepare(
        "UPDATE x_owned_posts SET status=? WHERE owner=? AND account_id=? AND id=? AND status='deleting'",
      )
      .bind(unknown ? "outcome-unknown" : "published", o, a.id, id)
      .run();
    await settleCost(reservation, "unknown");
    return {
      id,
      status: unknown ? "outcome-unknown" : "failed",
      message:
        e instanceof AppError
          ? e.message
          : "Review the original on X before taking another action.",
    };
  }
}
export async function DELETE(request: Request) {
  return handle(async () => {
    const o = await owner(request),
      p = selection
        .extend({ confirmation: z.string().uuid() })
        .strict()
        .parse(await body(request)),
      ids = selected(p.post_ids),
      db = database();
    const amount = deletionAllowance();
    return withAccount(o, p.account_id, async (a) => {
      requireScopes(a, true);
      const claimed = await db
        .prepare(
          "DELETE FROM x_delete_previews WHERE id=? AND owner=? AND account_id=? AND post_ids=? AND expires>? RETURNING id",
        )
        .bind(p.confirmation, o, a.id, JSON.stringify(ids), Date.now())
        .first();
      if (!claimed)
        throw new AppError(
          "Review this exact selection again. The confirmation expired or was already used.",
          403,
        );
      const results = [];
      for (const id of ids) {
        try {
          results.push(await removeOne(a, id, amount));
        } catch (e) {
          results.push({
            id,
            status: "failed",
            message:
              e instanceof AppError ? e.message : "Could not verify this post.",
          });
        }
      }
      return { results };
    });
  });
}
