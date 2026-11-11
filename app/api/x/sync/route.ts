import { z } from "zod";
import { owner, handle, body, database, config, AppError } from "@/lib/server";
import {
  accountAccess,
  requireScopes,
  evidence,
  type XPostData,
} from "@/lib/x-policy";
import { withAccount, xRequest, type PrivateAccount } from "@/lib/x-client";
import { estimatePostRead, reserveCost, settleCost } from "@/lib/costs";

const input = z.object({
  account_id: z.string().uuid(),
  kind: z.enum(["owned", "mentions"]).default("owned"),
  limit: z.coerce.number().int().min(5).max(30).default(10),
  older: z.boolean().default(false),
});
type Kind = "owned" | "mentions";
type Profile = {
  id: string;
  name: string;
  username: string;
  public_metrics?: Record<string, number>;
};
type Page = {
  data?: XPostData[];
  includes?: { users?: Profile[] };
  meta?: { result_count?: number; next_token?: string };
  errors?: unknown[];
};
function timelineCost(kind: Kind, count: number, id: string) {
  return estimatePostRead({
    route: kind === "owned" ? "posts" : "mentions",
    count,
    userId: id,
    appOwnerId: config("X_DEVELOPER_OWNER_ID"),
  });
}
function estimate(kind: Kind, count: number, id: string) {
  return (
    timelineCost(kind, count, id) + (kind === "owned" ? 10000 : count * 10000)
  );
}
export async function GET(request: Request) {
  return handle(async () => {
    const o = await owner(),
      p = input.parse(Object.fromEntries(new URL(request.url).searchParams));
    const a = await accountAccess(o, p.account_id);
    requireScopes(a);
    return {
      estimate_micros: estimate(p.kind, p.limit, a.x_user_id),
      limit: p.limit,
      kind: p.kind,
    };
  });
}
async function readProfile(a: PrivateAccount) {
  const reservation = await reserveCost(a.owner, 10000, "profile.read", {
    accountId: a.id,
  });
  try {
    const res = await xRequest<{ data?: Profile }>(
      a,
      "users/me?user.fields=public_metrics",
    );
    if (res.data?.id !== a.x_user_id)
      throw new AppError(
        "The identity returned by X differs from the connected account.",
        409,
      );
    await settleCost(reservation, "recorded");
    return res.data;
  } catch (e) {
    await settleCost(reservation, "unknown");
    throw e;
  }
}
export async function POST(request: Request) {
  return handle(async () => {
    const o = await owner(request),
      p = input.parse(await body(request)),
      db = database();
    return withAccount(o, p.account_id, async (a) => {
      requireScopes(a);
      const params = new URLSearchParams({
        max_results: String(p.limit),
        "tweet.fields":
          "author_id,created_at,public_metrics,entities,referenced_tweets",
      });
      if (p.kind === "mentions") params.set("expansions", "author_id");
      else params.set("exclude", "retweets");
      if (p.older) {
        const page = await db
          .prepare(
            "SELECT next_token FROM x_sync_pages WHERE owner=? AND account_id=? AND kind=?",
          )
          .bind(o, a.id, p.kind)
          .first<{ next_token: string | null }>();
        if (!page?.next_token)
          throw new AppError("There is no further page in this import.");
        params.set("pagination_token", page.next_token);
      }
      const maxCost =
        estimate(p.kind, p.limit, a.x_user_id) -
        (p.kind === "owned" ? 10000 : 0);
      const profile = p.kind === "owned" ? await readProfile(a) : null;
      const reservation = await reserveCost(
        o,
        maxCost,
        p.kind === "owned" ? "timeline.read" : "mentions.read",
        { accountId: a.id },
      );
      let result: Page;
      try {
        result = await xRequest<Page>(
          a,
          "users/" +
            a.x_user_id +
            "/" +
            (p.kind === "owned" ? "tweets" : "mentions") +
            "?" +
            params,
        );
        if (!Array.isArray(result.data) && result.meta?.result_count !== 0)
          throw new AppError("X returned incomplete timeline coverage.", 502);
        const actual =
          timelineCost(p.kind, result.data?.length ?? 0, a.x_user_id) +
          (result.includes?.users?.length ?? 0) * 10000;
        await settleCost(reservation, "recorded", actual);
      } catch (e) {
        await settleCost(reservation, "unknown");
        throw e;
      }
      const fetched = new Date().toISOString(),
        users = new Map(result.includes?.users?.map((u) => [u.id, u]));
      const posts = (result.data ?? []).slice(0, p.limit),
        batch: D1PreparedStatement[] = [];
      if (profile)
        batch.push(
          db
            .prepare(
              "INSERT INTO x_profile_snapshots(owner,account_id,observed_at,name,username,public_metrics) VALUES(?,?,?,?,?,?)",
            )
            .bind(
              o,
              a.id,
              fetched,
              profile.name,
              profile.username,
              profile.public_metrics
                ? JSON.stringify(profile.public_metrics)
                : null,
            ),
        );
      for (const post of posts) {
        if (
          !/^\d{1,20}$/.test(post.id) ||
          !post.author_id ||
          typeof post.text !== "string"
        )
          continue;
        if (p.kind === "owned") {
          if (post.author_id !== a.x_user_id) continue;
          const metrics = post.public_metrics
            ? JSON.stringify(post.public_metrics)
            : null;
          batch.push(
            db
              .prepare(
                "INSERT INTO x_owned_posts(owner,account_id,id,author_id,text,created_at,fetched_at,public_metrics) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(owner,account_id,id) DO UPDATE SET text=excluded.text,fetched_at=excluded.fetched_at,public_metrics=excluded.public_metrics,status='published' WHERE x_owned_posts.status NOT IN ('deleted','deleting','outcome-unknown')",
              )
              .bind(
                o,
                a.id,
                post.id,
                post.author_id,
                post.text,
                post.created_at ?? null,
                fetched,
                metrics,
              ),
          );
          batch.push(
            db
              .prepare(
                "INSERT INTO x_post_snapshots(owner,account_id,post_id,observed_at,public_metrics) VALUES(?,?,?,?,?)",
              )
              .bind(o, a.id, post.id, fetched, metrics),
          );
        } else {
          const proof = await evidence(a, post),
            author = users.get(post.author_id);
          batch.push(
            db
              .prepare(
                "INSERT INTO inbox_items(owner,account_id,post_id,author_id,author_name,author_username,text,created_at,fetched_at,source,evidence_type,subject_x_id,quoted_post_id,verified_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(owner,account_id,post_id) DO UPDATE SET author_name=excluded.author_name,author_username=excluded.author_username,text=excluded.text,fetched_at=excluded.fetched_at,source=excluded.source,evidence_type=excluded.evidence_type,quoted_post_id=excluded.quoted_post_id,verified_at=excluded.verified_at WHERE inbox_items.author_id=excluded.author_id",
              )
              .bind(
                o,
                a.id,
                post.id,
                post.author_id,
                author?.name ?? "",
                author?.username ?? "",
                post.text,
                post.created_at ?? null,
                fetched,
                proof.type === "quote" ? "quote" : "mention",
                proof.type,
                a.x_user_id,
                proof.quoted,
                fetched,
              ),
          );
        }
      }
      batch.push(
        db
          .prepare(
            "INSERT INTO x_sync_pages(owner,account_id,kind,next_token) VALUES(?,?,?,?) ON CONFLICT(owner,account_id,kind) DO UPDATE SET next_token=excluded.next_token",
          )
          .bind(o, a.id, p.kind, result.meta?.next_token ?? null),
      );
      batch.push(
        db
          .prepare("UPDATE accounts SET last_sync=? WHERE id=? AND owner=?")
          .bind(fetched, a.id, o),
      );
      await db.batch(batch);
      return {
        accountId: a.id,
        fetchedAt: fetched,
        profile,
        posts,
        has_more: !!result.meta?.next_token,
        partial: !!result.errors?.length,
        limit: p.limit,
      };
    });
  });
}
