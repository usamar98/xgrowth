import { z } from "zod";
import {
  handle,
  owner,
  body,
  database,
  preferences,
  AppError,
} from "@/lib/server";
import {
  queueView,
  schedule,
  cancelJob,
  checkTime,
  reconcileJob,
} from "@/lib/queue";
const action = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("schedule"),
    draft_id: z.string().uuid(),
    revision: z.number().int().positive(),
    account_id: z.string().uuid(),
    confirm: z.literal(true),
    run_at: z.string().max(60),
    timezone: z.string().min(1).max(80),
  }),
  z.object({
    action: z.literal("reschedule"),
    job_id: z.string().uuid(),
    revision: z.number().int().positive(),
    account_id: z.string().uuid(),
    confirm: z.literal(true),
    run_at: z.string().max(60),
    timezone: z.string().min(1).max(80),
  }),
  z.object({ action: z.literal("cancel"), job_id: z.string().uuid() }),
  z.object({
    action: z.literal("reconcile"),
    job_id: z.string().uuid(),
    account_id: z.string().uuid(),
    post_id: z.string().regex(/^\d{1,20}$/),
    confirm: z.literal(true),
  }),
  z.object({ action: z.literal("pause"), paused: z.boolean() }),
]);
export async function GET(request?: Request) {
  return handle(async () => {
    const user = await owner();
    if (request && new URL(request.url).searchParams.get("attempts") === "1") {
      const rows = await database()
        .prepare(
          "SELECT a.id,a.job_id,a.started_at,a.finished_at,a.state,a.detail FROM queue_attempts a JOIN queue_jobs j ON j.id=a.job_id WHERE j.owner=? ORDER BY a.started_at DESC LIMIT 100",
        )
        .bind(user)
        .all();
      return { attempts: rows.results };
    }
    return queueView(user);
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const user = await owner(request),
      input = action.parse(await body(request));
    if (input.action === "schedule") return schedule(user, input);
    if (input.action === "reconcile")
      return reconcileJob(user, input.job_id, input.account_id, input.post_id);
    if (input.action === "reschedule") {
      const time = checkTime(input.run_at, input.timezone);
      const changed = await database()
        .prepare(
          "UPDATE queue_jobs SET run_at=? WHERE owner=? AND id=? AND account_id=? AND revision=? AND status='scheduled' AND timezone=?",
        )
        .bind(
          time,
          user,
          input.job_id,
          input.account_id,
          input.revision,
          input.timezone,
        )
        .run();
      if (!changed.meta.changes)
        throw new AppError(
          "This job changed or has started. Refresh the queue.",
          409,
        );
      return { ok: true, run_at: time };
    }
    if (input.action === "cancel") await cancelJob(user, input.job_id);
    else {
      await preferences(user);
      await database()
        .prepare("UPDATE settings SET actions_paused=? WHERE owner=?")
        .bind(input.paused ? 1 : 0, user)
        .run();
    }
    return { ok: true };
  });
}
