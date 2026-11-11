import { handle, database, owner } from "@/lib/server";
export async function GET() {
  return handle(async () => {
    const o = await owner(),
      db = database(),
      since = new Date(Date.now() - 30 * 86400000).toISOString();
    const [formats, campaigns, replies, followers, consistent, outstanding] =
      await Promise.all([
        db
          .prepare(
            "SELECT kind,COUNT(*) n FROM queue_jobs WHERE owner=? AND status='published' AND updated_at>=? GROUP BY kind",
          )
          .bind(o, since)
          .all(),
        db
          .prepare(
            "SELECT e.title,COUNT(q.id) n FROM creative_entries e LEFT JOIN queue_jobs q ON q.owner=e.owner AND q.campaign_id=e.id AND q.status='published' AND q.updated_at>=? WHERE e.owner=? AND e.kind='campaign' GROUP BY e.id,e.title ORDER BY n DESC",
          )
          .bind(since, o)
          .all(),
        db
          .prepare(
            "SELECT COUNT(*) sent,AVG((julianday(q.updated_at)-julianday(i.created_at))*24) hours FROM queue_jobs q JOIN inbox_items i ON q.account_id=i.account_id AND q.target_id=i.post_id AND q.owner=i.owner WHERE q.owner=? AND q.kind='reply' AND q.status='published' AND q.updated_at>=?",
          )
          .bind(o, since)
          .first(),
        db
          .prepare(
            "SELECT account_id,observed_at,json_extract(public_metrics,'$.followers_count') followers FROM x_profile_snapshots WHERE owner=? AND observed_at>=? ORDER BY observed_at",
          )
          .bind(o, since)
          .all(),
        db
          .prepare(
            "SELECT COUNT(DISTINCT substr(updated_at,1,10)) n FROM queue_jobs WHERE owner=? AND status='published' AND updated_at>=?",
          )
          .bind(o, since)
          .first<{ n: number }>(),
        db
          .prepare(
            "SELECT status,COUNT(*) n FROM inbox_items WHERE owner=? GROUP BY status",
          )
          .bind(o)
          .all(),
      ]);
    return {
      since,
      through: new Date().toISOString(),
      formats: formats.results,
      campaigns: campaigns.results,
      replies,
      followers: followers.results,
      days: consistent?.n || 0,
      inbox: outstanding.results,
    };
  });
}
