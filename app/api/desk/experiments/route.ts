import { z } from "zod";
import { owner, database, handle, body, AppError } from "@/lib/server";
import { GET as owned } from "@/app/api/x/owned/route";
const schema = z.object({
  account_id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  first_post: z.string().regex(/^\d{1,24}$/),
  second_post: z.string().regex(/^\d{1,24}$/),
  metric: z.enum([
    "impression_count",
    "like_count",
    "reply_count",
    "retweet_count",
  ]),
});
export async function GET() {
  return handle(async () => ({
    experiments: (
      await database()
        .prepare(
          "SELECT id,account_id,name,first_post,second_post,metric FROM desk_experiments WHERE owner=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(await owner())
        .all()
    ).results,
  }));
}
export async function POST(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = schema.parse(await body(r));
    if (p.first_post === p.second_post)
      throw new AppError("Choose two distinct posts.");
    const url = new URL("/api/x/owned", r.url);
    url.searchParams.set("account_id", p.account_id);
    const res = await owned(new Request(url, { headers: r.headers }));
    if (!res.ok) throw new AppError("Owned posts unavailable.", 403);
    const data = (await res.json()) as {
      posts: { id: string; status: string }[];
    };
    const ids = new Set(
      data.posts
        .filter((post) => post.status !== "deleted")
        .map((post) => post.id),
    );
    if (!ids.has(p.first_post) || !ids.has(p.second_post))
      throw new AppError("Select two imported posts you own.");
    const result = await database()
      .prepare("INSERT INTO desk_experiments VALUES(?,?,?,?,?,?,?,?)")
      .bind(
        crypto.randomUUID(),
        o,
        p.account_id,
        p.name,
        p.first_post,
        p.second_post,
        p.metric,
        new Date().toISOString(),
      )
      .run();
    return { ok: !!result.meta.changes };
  });
}
