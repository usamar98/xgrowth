import { owner, database, handle, config } from "@/lib/server";
export async function GET() {
  return handle(async () => {
    const o = await owner(),
      db = database(),
      cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    await db
      .prepare("DELETE FROM desk_events WHERE owner=? AND occurred_at<?")
      .bind(o, cutoff)
      .run();
    const events = await db
      .prepare(
        "SELECT e.campaign_id,c.title,e.event,COUNT(*) n FROM desk_events e JOIN creative_entries c ON c.id=e.campaign_id AND c.owner=e.owner WHERE e.owner=? GROUP BY e.campaign_id,c.title,e.event ORDER BY c.title",
      )
      .bind(o)
      .all();
    return {
      enabled:
        config("SIGNALDESK_EVENT_SECRET").length >= 32 &&
        config("SIGNALDESK_EVENT_OWNER") === o,
      events: events.results,
    };
  });
}
