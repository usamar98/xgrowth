import { z } from "zod";
import { database, preferences } from "@/lib/server";
import { nextAvailable, type Slot } from "@/lib/queue-slots";
import { handle, owner, body, AppError } from "@/lib/server";
import { checkDraft } from "@/lib/queue";
import { estimatePublication } from "@/lib/costs";
export async function POST(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = z
        .object({
          draft_id: z.string().uuid(),
          revision: z.number().int().positive(),
          account_id: z.string().uuid(),
        })
        .parse(await body(r));
    const draft = await checkDraft(o, p.draft_id, p.revision, p.account_id);
    const estimate = estimatePublication(draft.kind, draft.text);
    if (estimate === null)
      throw new AppError(
        "Write cost is unverified. Use native X for this draft.",
        402,
      );
    return {
      kind: draft.kind,
      target_id: draft.target_id,
      text: draft.text,
      estimate,
    };
  });
}
export async function GET(r: Request) {
  return handle(async () => {
    const o = await owner(),
      db = database(),
      id = new URL(r.url).searchParams.get("account_id");
    const slots = (
      await db
        .prepare(
          "SELECT id,weekday,local_time,timezone FROM queue_slots WHERE owner=? ORDER BY weekday,local_time",
        )
        .bind(o)
        .all<Slot>()
    ).results;
    const jobs = (
      await db
        .prepare(
          "SELECT run_at FROM queue_jobs WHERE owner=? AND (? IS NULL OR account_id=?) AND status IN ('processing','dispatching','scheduled')",
        )
        .bind(o, id, id)
        .all<{ run_at: string }>()
    ).results;
    const busy = new Set(jobs.map((j) => j.run_at)),
      now = new Date();
    return {
      slots: slots.map((s) => ({ ...s, next: nextAvailable(s, busy, now) })),
    };
  });
}
export async function PUT(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = z
        .object({
          weekday: z.number().int().min(0).max(6),
          local_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          timezone: z.string().max(80),
        })
        .parse(await body(r));
    try {
      new Intl.DateTimeFormat("en", { timeZone: p.timezone }).format();
    } catch {
      throw new AppError("Invalid timezone.");
    }
    await preferences(o);
    const result = await database()
      .prepare(
        "INSERT OR IGNORE INTO queue_slots(id,owner,weekday,local_time,timezone) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM queue_slots WHERE owner=?)<28",
      )
      .bind(crypto.randomUUID(), o, p.weekday, p.local_time, p.timezone, o)
      .run();
    if (!result.meta.changes)
      throw new AppError(
        "This slot already exists or the 28-slot limit has been reached.",
        409,
      );
    return { ok: true };
  });
}
export async function DELETE(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = z.object({ id: z.string().uuid() }).parse(await body(r));
    await database()
      .prepare("DELETE FROM queue_slots WHERE owner=? AND id=?")
      .bind(o, p.id)
      .run();
    return { ok: true };
  });
}
