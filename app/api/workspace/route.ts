import { z } from "zod";
import {
  handle,
  owner,
  database,
  body,
  preferences,
  configuration,
  AppError,
} from "@/lib/server";
import { purgeMedia } from "@/lib/media";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(async () => {
    const id = await owner(),
      db = database(),
      settings = await preferences(id);
    const [accounts, drafts, usage] = await Promise.all([
      db
        .prepare(
          "SELECT id,x_user_id,username,name,granted_scopes,health,last_sync,blocked_until FROM accounts WHERE owner=? ORDER BY name",
        )
        .bind(id)
        .all(),
      db
        .prepare(
          "SELECT * FROM drafts WHERE owner=? ORDER BY updated_at DESC LIMIT 500",
        )
        .bind(id)
        .all(),
      db
        .prepare(
          "SELECT COALESCE((SELECT amount FROM usage WHERE key=?),0)+COALESCE((SELECT SUM(micros) FROM cost_entries WHERE owner=? AND state<>'released' AND created_at>=?),0) AS amount",
        )
        .bind(
          id + ":" + new Date().toISOString().slice(0, 7),
          id,
          new Date().toISOString().slice(0, 7),
        )
        .first<{ amount: number }>(),
    ]);
    return {
      accounts: accounts.results,
      drafts: drafts.results,
      settings,
      usage: usage?.amount ?? 0,
      ...configuration(),
    };
  });
}
const tz = z
  .string()
  .max(80)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  });
export async function PATCH(request: Request) {
  return handle(async () => {
    const id = await owner(request),
      p = z
        .object({
          timezone: tz,
          audience: z.string().trim().max(200),
          topics: z.string().trim().max(400),
          weekly_target: z.number().int().min(1).max(14),
          budget: z.number().int().min(0).max(100000000),
        })
        .partial()
        .strict()
        .parse(await body(request));
    const fields = Object.entries(p);
    if (!fields.length) throw new AppError("Choose a preference to save.");
    await preferences(id);
    await database()
      .prepare(
        "UPDATE settings SET " +
          fields.map(([k]) => k + "=?").join(",") +
          " WHERE owner=?",
      )
      .bind(...fields.map(([, v]) => v), id)
      .run();
    return { ok: true };
  });
}
export async function DELETE(request: Request) {
  return handle(async () => {
    const id = await owner(request),
      db = database();
    z.object({ confirm: z.literal("DELETE") })
      .strict()
      .parse(await body(request));
    await preferences(id);
    await db
      .prepare("UPDATE settings SET actions_paused=1 WHERE owner=?")
      .bind(id)
      .run();
    const active = await db
      .prepare(
        "SELECT id FROM accounts WHERE owner=? AND locked_until>? UNION SELECT id FROM queue_jobs WHERE owner=? AND status='dispatching'",
      )
      .bind(id, Date.now(), id)
      .first();
    if (active)
      throw new AppError(
        "Actions are paused. An external request is in flight. Check Activity and try again after it finishes.",
        409,
      );
    await purgeMedia(id);
    const tables = [
      "x_delete_previews",
      "x_sync_pages",
      "x_opt_out",
      "inbox_items",
      "x_post_snapshots",
      "x_profile_snapshots",
      "x_owned_posts",
      "x_account_ids",
      "desk_events",
      "desk_experiments",
      "desk_runs",
      "desk_rules",
      "desk_access_log",
      "desk_api_keys",
      "creative_entries",
      "creative_generations",
      "drafts",
      "draft_media",
      "draft_versions",
      "accounts",
      "oauth_states",
      "settings",
    ];
    await db.batch(
      tables.map((t) =>
        db.prepare("DELETE FROM " + t + " WHERE owner=?").bind(id),
      ),
    );
    return {
      ok: true,
      message:
        "Workspace data removed. Aggregate budget reservations persist. Revoke SignalDesk in X Connected apps to invalidate any upstream grants.",
    };
  });
}
