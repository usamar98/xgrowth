import { z } from "zod";
import {
  handle,
  owner,
  body,
  database,
  preferences,
  AppError,
} from "@/lib/server";
import { costReport } from "@/lib/costs";
const micros = z.number().int().nonnegative().max(1000000000);
export async function GET() {
  return handle(async () => costReport(await owner()));
}
export async function PATCH(request: Request) {
  return handle(async () => {
    const user = await owner(request),
      input = z
        .object({ daily_budget: micros, monthly_budget: micros })
        .parse(await body(request));
    await preferences(user);
    await database()
      .prepare("UPDATE settings SET daily_budget=?,budget=? WHERE owner=?")
      .bind(input.daily_budget, input.monthly_budget, user)
      .run();
    return costReport(user);
  });
}
export async function POST(request: Request) {
  return handle(async () => {
    const user = await owner(request),
      input = z
        .object({
          id: z.string().uuid(),
          micros,
          reference: z.string().trim().min(3).max(160),
        })
        .parse(await body(request));
    const r = await database()
      .prepare(
        "UPDATE cost_entries SET state='reconciled',micros=?,provider_reference=? WHERE id=? AND owner=? AND state IN ('recorded','unknown','reconciled')",
      )
      .bind(input.micros, input.reference, input.id, user)
      .run();
    if (!r.meta.changes)
      throw new AppError(
        "Only completed ledger entries can be reconciled.",
        409,
      );
    return { ok: true };
  });
}
