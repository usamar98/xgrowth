import { handle, owner, database } from "@/lib/server";
const tables = [
  "settings",
  "drafts",
  "draft_versions",
  "draft_media",
  "creative_entries",
  "creative_generations",
  "inbox_items",
  "x_opt_out",
  "x_owned_posts",
  "x_post_snapshots",
  "x_profile_snapshots",
  "queue_jobs",
  "queue_slots",
  "cost_entries",
  "desk_rules",
  "desk_runs",
  "desk_events",
  "desk_experiments",
  "desk_access_log",
] as const;
export async function GET() {
  return handle(async () => {
    const o = await owner(),
      db = database(),
      exported: Record<string, unknown> = {};
    exported.accounts = (
      await db
        .prepare(
          "SELECT id,username,name,x_user_id,blocked_until FROM accounts WHERE owner=?",
        )
        .bind(o)
        .all()
    ).results;
    const names = (
      await db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all<{ name: string }>()
    ).results.map((v) => v.name);
    for (const table of tables) {
      if (!names.includes(table)) continue;
      const cols = (
        await db
          .prepare("PRAGMA table_info(" + table + ")")
          .all<{ name: string }>()
      ).results.map((v) => v.name);
      const privateColumns = new Set([
        "owner",
        "digest",
        "lease",
        "object_key",
        "provider_reference",
      ]);
      const fields = cols
        .filter((v) => !privateColumns.has(v))
        .map((v) => '"' + v.replaceAll('"', '""') + '"')
        .join(",");
      if (cols.includes("owner"))
        exported[table] = (
          await db
            .prepare("SELECT " + fields + " FROM " + table + " WHERE owner=?")
            .bind(o)
            .all()
        ).results;
    }
    return {
      product: "SignalDesk",
      version: 1,
      exported_at: new Date().toISOString(),
      ...exported,
    };
  });
}
