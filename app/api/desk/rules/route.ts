import { z } from "zod";
import { AppError, owner, body, database, handle } from "@/lib/server";
import { type Rule, rulePreview } from "@/lib/automation-runner";
import { nextSlot } from "@/lib/automation-schedule";
const create = z.object({
  action: z.literal("create"),
  name: z.string().trim().min(1).max(80),
  kind: z.enum([
    "weekly_review",
    "release_draft",
    "failure_alert",
    "mention_digest",
  ]),
  every_days: z.union([z.literal(1), z.literal(7)]),
  local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  timezone: z.string().max(80),
  source_id: z.string().uuid().nullable(),
  account_id: z.string().uuid().nullable(),
});
export async function GET() {
  return handle(async () => {
    const o = await owner(),
      db = database();
    const [rules, runs, sources] = await Promise.all([
      db
        .prepare(
          "SELECT id,name,action,enabled,next_run,timezone,local_time,every_days,account_id FROM desk_rules WHERE owner=? ORDER BY created_at DESC",
        )
        .bind(o)
        .all(),
      db
        .prepare(
          "SELECT id,message,created_at,draft_id FROM desk_runs WHERE owner=? ORDER BY created_at DESC LIMIT 80",
        )
        .bind(o)
        .all(),
      db
        .prepare(
          "SELECT id,title FROM creative_entries WHERE owner=? AND kind='knowledge' ORDER BY title",
        )
        .bind(o)
        .all(),
    ]);
    return {
      rules: rules.results,
      runs: runs.results,
      sources: sources.results,
    };
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const o = await owner(request),
      db = database(),
      input = await body(request);
    if (input.action === "test") {
      const p = z.object({ id: z.string().uuid() }).parse(input);
      const r = await db
        .prepare("SELECT * FROM desk_rules WHERE owner=? AND id=?")
        .bind(o, p.id)
        .first<Rule>();
      if (!r) throw new AppError("Rule unavailable.", 404);
      return rulePreview(r);
    }
    const p = create.parse(input);
    if (
      p.account_id &&
      !(await db
        .prepare("SELECT id FROM accounts WHERE id=? AND owner=?")
        .bind(p.account_id, o)
        .first())
    )
      throw new AppError("Account unavailable.");
    if (
      p.kind === "release_draft" &&
      (!p.source_id ||
        !(await db
          .prepare(
            "SELECT id FROM creative_entries WHERE owner=? AND id=? AND kind='knowledge'",
          )
          .bind(o, p.source_id)
          .first()))
    )
      throw new AppError("Choose a saved knowledge entry.");
    let next;
    try {
      next = nextSlot(new Date(), p.timezone, p.local_time, p.every_days, true);
    } catch {
      throw new AppError("Choose an IANA timezone and valid local time.");
    }
    const result = await db
      .prepare(
        "INSERT INTO desk_rules(id,owner,name,action,account_id,source_id,every_days,local_time,timezone,next_run,created_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM desk_rules WHERE owner=?)<50",
      )
      .bind(
        crypto.randomUUID(),
        o,
        p.name,
        p.kind,
        p.account_id,
        p.source_id,
        p.every_days,
        p.local_time,
        p.timezone,
        next,
        new Date().toISOString(),
        o,
      )
      .run();
    if (!result.meta.changes)
      throw new AppError("This workspace has 50 rules.", 409);
    return { ok: true };
  });
}
export async function PATCH(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = z
        .object({ id: z.string().uuid(), enabled: z.boolean() })
        .parse(await body(r));
    await database()
      .prepare("UPDATE desk_rules SET enabled=? WHERE owner=? AND id=?")
      .bind(Number(p.enabled), o, p.id)
      .run();
    return { ok: true };
  });
}
export async function DELETE(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = z.object({ id: z.string().uuid() }).parse(await body(r));
    await database()
      .prepare("DELETE FROM desk_rules WHERE owner=? AND id=?")
      .bind(o, p.id)
      .run();
    return { ok: true };
  });
}
