import { database } from "./server";
import { env } from "cloudflare:workers";
export async function expireObservations() {
  const db = database();
  const now = Date.now();
  const due = await db
    .prepare(
      "INSERT INTO maintenance_ticks(name,last_run) VALUES('retention',?) ON CONFLICT(name) DO UPDATE SET last_run=excluded.last_run WHERE last_run<?",
    )
    .bind(now, now - 3600000)
    .run();
  if (!due.meta.changes) return;
  // Preserve local decisions and opt-outs while removing expired observations.
  const tables = [
    ["x_post_snapshots", "observed_at"],
    ["x_profile_snapshots", "observed_at"],
    ["x_owned_posts", "fetched_at"],
    ["desk_access_log", "created_at"],
  ];
  const statements = tables.map(([table, column]) =>
    db.prepare(
      "DELETE FROM " +
        table +
        " WHERE rowid IN (SELECT r.rowid FROM " +
        table +
        " r JOIN settings s ON s.owner=r.owner WHERE julianday(r." +
        column +
        ") < julianday('now')-s.retention_days LIMIT 100)",
    ),
  );
  statements.push(
    db.prepare(
      "UPDATE inbox_items SET text='',evidence_type='unknown',author_name='',author_username='' WHERE rowid IN (SELECT i.rowid FROM inbox_items i JOIN settings s ON s.owner=i.owner WHERE i.text<>'' AND julianday(i.fetched_at)<julianday('now')-s.retention_days LIMIT 100)",
    ),
  );
  statements.push(
    db.prepare(
      "DELETE FROM desk_events WHERE rowid IN (SELECT rowid FROM desk_events WHERE julianday(occurred_at)<julianday('now')-30 LIMIT 100)",
    ),
  );
  await db.batch(statements);
  if (env.BUCKET) {
    const orphaned = await db
      .prepare(
        "SELECT object_key FROM obsolete_images ORDER BY removed_at LIMIT 100",
      )
      .all<{ object_key: string }>();
    if (orphaned.results.length) {
      await env.BUCKET.delete(orphaned.results.map((item) => item.object_key));
      await db.batch(
        orphaned.results.map((item) =>
          db
            .prepare("DELETE FROM obsolete_images WHERE object_key=?")
            .bind(item.object_key),
        ),
      );
    }
  }
}
