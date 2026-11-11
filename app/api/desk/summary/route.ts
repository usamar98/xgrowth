import { database, handle, owner } from "@/lib/server";

export async function GET() {
  return handle(async () => {
    const user = await owner();
    const db = database();
    const start = new Date(Date.now() - 86400000).toISOString();
    const [inbox, profile, rules] = await Promise.all([
      db
        .prepare(
          `
        SELECT COUNT(CASE WHEN i.status IN ('open','review','saved') THEN 1 END) AS mentions,
               COUNT(CASE WHEN i.status='saved' THEN 1 END) AS saved,
               COUNT(CASE WHEN i.status IN ('open','review','saved') AND i.opt_out=0
                 AND i.evidence_type IN ('mention','quote') AND a.x_user_id=i.subject_x_id
                 AND a.health='connected' AND i.verified_at>=? AND NOT EXISTS
                   (SELECT 1 FROM x_opt_out p WHERE p.owner=i.owner AND p.account_id=i.account_id
                    AND p.author_id=i.author_id) THEN 1 END) AS eligible
        FROM inbox_items i LEFT JOIN accounts a ON a.owner=i.owner AND a.id=i.account_id
        WHERE i.owner=?
      `,
        )
        .bind(start, user)
        .first(),
      db
        .prepare(
          `
        SELECT s.observed_at, json_extract(s.public_metrics,'$.followers_count') AS followers
        FROM x_profile_snapshots s JOIN accounts a ON a.id=s.account_id AND a.owner=s.owner
        WHERE s.owner=? ORDER BY s.observed_at DESC LIMIT 1
      `,
        )
        .bind(user)
        .first(),
      db
        .prepare(
          "SELECT COUNT(*) n FROM desk_rules WHERE owner=? AND enabled=1",
        )
        .bind(user)
        .first<{ n: number }>(),
    ]);
    return { ...inbox, profile, rules: rules?.n ?? 0 };
  });
}
