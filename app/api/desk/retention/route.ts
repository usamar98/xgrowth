import { z } from "zod";
import { handle, owner, body, database, preferences } from "@/lib/server";
export async function GET() {
  return handle(async () => {
    const o = await owner();
    await preferences(o);
    return database()
      .prepare("SELECT retention_days FROM settings WHERE owner=?")
      .bind(o)
      .first();
  });
}
export async function PATCH(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      { days } = z
        .object({ days: z.number().int().min(7).max(365) })
        .parse(await body(r));
    await preferences(o);
    await database()
      .prepare("UPDATE settings SET retention_days=? WHERE owner=?")
      .bind(days, o)
      .run();
    return { retention_days: days };
  });
}
