import { z } from "zod";
import { owner, body, database, handle } from "@/lib/server";
import { issueKey } from "@/lib/desk-keys";
export async function GET() {
  return handle(async () => ({
    keys: (
      await database()
        .prepare(
          "SELECT id,label,account_id,scopes,expires,revoked FROM desk_api_keys WHERE owner=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(await owner())
        .all()
    ).results,
  }));
}
export async function POST(r: Request) {
  return handle(async () => issueKey(await owner(r), await body(r)));
}
export async function DELETE(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      { id } = z.object({ id: z.string().uuid() }).parse(await body(r));
    await database()
      .prepare("UPDATE desk_api_keys SET revoked=1 WHERE owner=? AND id=?")
      .bind(o, id)
      .run();
    return { ok: true };
  });
}
