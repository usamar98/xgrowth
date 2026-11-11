import { AppError, database, preferences } from "./server";
import { reviewText } from "./content";

const registry = [
  ["post.create", 15000, "Original text without a URL."],
  ["post.create.url", 200000, "Original with a detected URL."],
  ["reply.summoned", 10000, "Verified summoned text-only reply."],
  [
    "reply.url",
    null,
    "The rate for a summoned reply containing a URL is unconfirmed.",
  ],
  ["post.read", 5000, "Per post resource."],
  ["profile.read", 10000, "Per user resource."],
  [
    "post.read.owned",
    1000,
    "Qualifying endpoint and authenticated developer-app owner only.",
  ],
  ["post.delete", null, "Requires a documented conservative allowance."],
] as const;
export const rates = registry.map(([operation, micros, condition]) => ({
  operation,
  micros,
  condition,
  currency: "USD",
  unit: "micro-USD",
  tier: "pay-per-use",
  source: "https://docs.x.com/x-api/getting-started/pricing",
  checked_at: "2026-11-11",
}));
export function estimatePublication(kind: string, text: string) {
  if (kind !== "post" && kind !== "reply") return null;
  const url = reviewText(text).hasUrl;
  if (kind === "reply") return url ? null : 10000;
  return url ? 200000 : 15000;
}
export function estimatePostRead(input: {
  count: number;
  route: "posts" | "mentions" | "lookup";
  userId: string;
  appOwnerId?: string;
}) {
  if (!Number.isSafeInteger(input.count) || input.count < 0)
    throw new AppError("Invalid resource count.");
  const owned =
    input.route !== "lookup" &&
    !!input.userId &&
    input.userId === input.appOwnerId;
  return input.count * (owned ? 1000 : 5000);
}
type Context = {
  accountId?: string | null;
  jobId?: string | null;
  campaignId?: string | null;
  category?: "x" | "ai" | "storage" | "infrastructure";
};
export async function reserveCost(
  owner: string,
  amountMicros: number,
  operation: string,
  context: Context = {},
) {
  if (!Number.isSafeInteger(amountMicros) || amountMicros <= 0)
    throw new AppError(
      "A positive estimate or explicit allowance is required.",
      402,
    );
  await preferences(owner);
  const db = database(),
    now = new Date().toISOString(),
    day = now.slice(0, 10),
    month = now.slice(0, 7),
    id = crypto.randomUUID();
  const result = await db
    .prepare(
      "INSERT INTO cost_entries(id,owner,operation,category,state,micros,reserved_micros,account_id,campaign_id,job_id,created_at) " +
        "SELECT ?,owner,?,?,'reserved',?,?,?,?,?,? FROM settings AS s WHERE owner=? " +
        "AND ? + COALESCE((SELECT SUM(micros) FROM cost_entries WHERE owner=s.owner AND state<>'released' AND created_at>=?),0) <= daily_budget " +
        "AND ? + COALESCE((SELECT SUM(micros) FROM cost_entries WHERE owner=s.owner AND state<>'released' AND created_at>=?),0) " +
        "+ COALESCE((SELECT amount FROM usage WHERE key=?),0) <= budget",
    )
    .bind(
      id,
      operation,
      context.category || "x",
      amountMicros,
      amountMicros,
      context.accountId || null,
      context.campaignId || null,
      context.jobId || null,
      now,
      owner,
      amountMicros,
      day,
      amountMicros,
      month,
      owner + ":" + month,
    )
    .run();
  if (!result.meta.changes)
    throw new AppError(
      "This estimate exceeds the remaining daily or monthly budget.",
      402,
    );
  return id;
}
export async function settleCost(
  id: string,
  state: "recorded" | "released" | "unknown",
  actualMicros?: number,
) {
  if (
    actualMicros !== undefined &&
    (!Number.isSafeInteger(actualMicros) || actualMicros < 0)
  )
    throw new AppError("Invalid estimated usage.");
  return database()
    .prepare(
      "UPDATE cost_entries SET state=?,micros=CASE WHEN ?='released' THEN 0 ELSE COALESCE(?,reserved_micros) END WHERE id=? AND state='reserved'",
    )
    .bind(state, state, actualMicros ?? null, id)
    .run();
}
export async function costReport(owner: string) {
  await preferences(owner);
  const db = database(),
    month = new Date().toISOString().slice(0, 7),
    day = new Date().toISOString().slice(0, 10);
  const [s, entries, totals, legacy] = await Promise.all([
    db
      .prepare(
        "SELECT daily_budget,budget AS monthly_budget FROM settings WHERE owner=?",
      )
      .bind(owner)
      .first(),
    db
      .prepare(
        "SELECT id,category,operation,state,micros,reserved_micros,account_id,campaign_id,job_id,provider_reference,created_at FROM cost_entries WHERE owner=? AND created_at>=? ORDER BY created_at DESC LIMIT 500",
      )
      .bind(owner, month)
      .all(),
    db
      .prepare(
        "SELECT COALESCE(SUM(micros),0) AS month_micros,COALESCE(SUM(CASE WHEN created_at>=? THEN micros ELSE 0 END),0) AS day_micros FROM cost_entries WHERE owner=? AND state<>'released' AND created_at>=?",
      )
      .bind(day, owner, month)
      .first<{ month_micros: number; day_micros: number }>(),
    db
      .prepare("SELECT amount FROM usage WHERE key=?")
      .bind(owner + ":" + month)
      .first<{ amount: number }>(),
  ]);
  return {
    ...s,
    day_micros: totals?.day_micros || 0,
    month_micros: (totals?.month_micros || 0) + (legacy?.amount || 0),
    legacy_micros: legacy?.amount || 0,
    entries: entries.results,
    rates,
    window: "UTC",
    currency: "USD",
  };
}
