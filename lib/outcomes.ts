import { z } from "zod";
import { AppError, config, database } from "./server";
const input = z
  .object({
    id: z.string().uuid(),
    campaign_id: z.string().uuid(),
    event: z.enum(["visit", "signup", "purchase"]),
    occurred_at: z.string().datetime({ offset: true }),
    bot: z.boolean(),
  })
  .strict();
export async function recordOutcome(r: Request) {
  const secret = config("SIGNALDESK_EVENT_SECRET"),
    o = config("SIGNALDESK_EVENT_OWNER");
  if (secret.length < 32 || !o)
    throw new AppError("Outcome collection is not configured.", 503);
  const ts = r.headers.get("x-signaldesk-timestamp") || "",
    mac = r.headers.get("x-signaldesk-signature") || "";
  if (
    !/^\d{10}$/.test(ts) ||
    Math.abs(Date.now() / 1000 - Number(ts)) > 300 ||
    !/^[a-f0-9]{64}$/i.test(mac)
  )
    throw new AppError("Event authentication failed.", 401);
  if (Number(r.headers.get("content-length") || 0) > 2048 || !r.body)
    throw new AppError("Invalid event size.", 413);
  const reader = r.body.getReader(),
    decoder = new TextDecoder(),
    parts: string[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.length;
    if (bytes > 2048) {
      await reader.cancel();
      throw new AppError("Event too large.", 413);
    }
    parts.push(decoder.decode(next.value, { stream: true }));
  }
  parts.push(decoder.decode());
  const raw = parts.join("");
  const encoder = new TextEncoder(),
    key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(mac.match(/../g)!, (v) => parseInt(v, 16)),
    encoder.encode(ts + "." + raw),
  );
  if (!ok) throw new AppError("Invalid event signature.", 401);
  let event;
  try {
    event = input.parse(JSON.parse(raw));
  } catch {
    throw new AppError("Invalid event.");
  }
  const age = Date.now() - Date.parse(event.occurred_at);
  if (age < -300000 || age > 30 * 86400000)
    throw new AppError("Event outside retention window.");
  if (
    event.bot ||
    /crawl|spider|bot\b/i.test(r.headers.get("user-agent") || "")
  )
    return { ignored: true };
  const db = database();
  if (
    !(await db
      .prepare(
        "SELECT id FROM creative_entries WHERE owner=? AND id=? AND kind='campaign'",
      )
      .bind(o, event.campaign_id)
      .first())
  )
    throw new AppError("Campaign unavailable.", 404);
  const saved = await db
    .prepare(
      "INSERT OR IGNORE INTO desk_events(id,owner,campaign_id,event,occurred_at,received_at) VALUES(?,?,?,?,?,?)",
    )
    .bind(
      event.id,
      o,
      event.campaign_id,
      event.event,
      new Date(event.occurred_at).toISOString(),
      new Date().toISOString(),
    )
    .run();
  return { accepted: true, duplicate: !saved.meta.changes };
}
