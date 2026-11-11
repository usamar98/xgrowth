import { z } from "zod";
import { AppError, body, database, handle, owner } from "@/lib/server";
import { entrySchema, listDrafts, listEntries } from "@/lib/creative-store";
import { generateDraft, localModel } from "@/lib/creative-ai";
import { replyDecision } from "@/lib/x-policy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const user = await owner(),
      db = database(),
      params = new URL(request.url).searchParams;
    if (params.has("target"))
      return replyDecision(
        user,
        z.string().uuid().parse(params.get("account")),
        z
          .string()
          .regex(/^\d{1,20}$/)
          .parse(params.get("target")),
        params.get("ai") === "1" ? "ai" : "manual",
      );
    const [entries, drafts, accounts, items] = await Promise.all([
      listEntries(user),
      listDrafts(user),
      db
        .prepare(
          "SELECT id,name,username FROM accounts WHERE owner=? ORDER BY name",
        )
        .bind(user)
        .all(),
      db
        .prepare(
          "SELECT account_id,post_id,author_id,author_name,author_username,text,created_at,fetched_at,source,status,snoozed_until,note,labels,campaign_id,opt_out FROM inbox_items WHERE owner=? ORDER BY created_at DESC LIMIT 250",
        )
        .bind(user)
        .all<Record<string, unknown>>(),
    ]);
    return {
      entries,
      drafts,
      accounts: accounts.results,
      items: items.results.map((i) => ({
        ...i,
        labels: JSON.parse(String(i.labels || "[]")),
      })),
      ai: !!localModel(),
    };
  });
}
const itemSchema = z.object({
  account_id: z.string().uuid(),
  post_id: z.string().regex(/^\d{1,20}$/),
  status: z.enum(["open", "saved", "review", "snoozed", "resolved"]),
  note: z.string().max(2000),
  labels: z.array(z.string().trim().max(45)).max(12),
  campaign_id: z.string().uuid().nullable(),
  snoozed_until: z.string().datetime().nullable(),
  opt_out: z.boolean(),
});
export async function POST(request: Request) {
  return handle(async () => {
    const user = await owner(request),
      raw = await body(request),
      db = database(),
      now = new Date().toISOString();
    if (raw?.action === "generate") return generateDraft(user, raw);
    if (raw?.action === "inbox") {
      const p = itemSchema.parse(raw),
        item = await db
          .prepare(
            "SELECT author_id FROM inbox_items WHERE owner=? AND account_id=? AND post_id=?",
          )
          .bind(user, p.account_id, p.post_id)
          .first<{ author_id: string }>();
      if (!item) throw new AppError("This conversation is unavailable.", 404);
      if (
        p.campaign_id &&
        !(await db
          .prepare(
            "SELECT id FROM creative_entries WHERE owner=? AND id=? AND kind='campaign'",
          )
          .bind(user, p.campaign_id)
          .first())
      )
        throw new AppError("Select a campaign in this workspace.");
      const writes = [
        db
          .prepare(
            "UPDATE inbox_items SET status=?,note=?,labels=?,campaign_id=?,snoozed_until=?,opt_out=MAX(opt_out,?) WHERE owner=? AND account_id=? AND post_id=?",
          )
          .bind(
            p.status,
            p.note,
            JSON.stringify(p.labels),
            p.campaign_id,
            p.status === "snoozed" ? p.snoozed_until : null,
            Number(p.opt_out),
            user,
            p.account_id,
            p.post_id,
          ),
      ];
      if (p.opt_out)
        writes.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO x_opt_out(owner,account_id,author_id) VALUES(?,?,?)",
            )
            .bind(user, p.account_id, item.author_id),
        );
      await db.batch(writes);
      return { ok: true };
    }
    if (raw?.action !== "entry") throw new AppError("Unknown creative action.");
    const p = entrySchema.parse(raw),
      id = p.id || crypto.randomUUID();
    const args = [
      p.title,
      p.content,
      JSON.stringify(p.details),
      JSON.stringify(p.tags),
      now,
    ];
    const result = p.id
      ? await db
          .prepare(
            "UPDATE creative_entries SET title=?,content=?,details=?,tags=?,updated_at=?,revision=revision+1 WHERE owner=? AND id=? AND kind=? AND revision=?",
          )
          .bind(...args, user, p.id, p.kind, p.revision || 0)
          .run()
      : await db
          .prepare(
            "INSERT INTO creative_entries(title,content,details,tags,updated_at,id,owner,kind,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM creative_entries WHERE owner=?)<500",
          )
          .bind(...args, id, user, p.kind, now, user)
          .run();
    if (!result.meta.changes)
      throw new AppError(
        "The entry changed or the library limit was reached.",
        409,
      );
    return { id };
  });
}
export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await owner(request),
      p = z
        .object({ id: z.string().uuid(), revision: z.number().int() })
        .parse(await body(request));
    const result = await database()
      .prepare(
        "DELETE FROM creative_entries WHERE owner=? AND id=? AND revision=?",
      )
      .bind(user, p.id, p.revision)
      .run();
    if (!result.meta.changes)
      throw new AppError("Reload this entry before removing it.", 409);
    return { ok: true };
  });
}
