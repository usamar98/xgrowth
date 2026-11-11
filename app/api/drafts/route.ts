import { z } from "zod";
import { AppError, body, database, handle, owner } from "@/lib/server";
import {
  getDraft,
  listDrafts,
  readFields,
  saveDraft,
} from "@/lib/creative-store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handle(async () => {
    const user = await owner(),
      id = new URL(request.url).searchParams.get("id");
    if (!id) return { drafts: await listDrafts(user) };
    const draft = await getDraft(user, z.string().uuid().parse(id));
    const rows = await database()
      .prepare(
        "SELECT revision,snapshot,created_at FROM draft_versions WHERE owner=? AND draft_id=? ORDER BY revision DESC LIMIT 60",
      )
      .bind(user, id)
      .all<{ revision: number; snapshot: string; created_at: string }>();
    return {
      draft,
      versions: rows.results.map((v) => ({
        revision: v.revision,
        created_at: v.created_at,
        fields: readFields(JSON.parse(v.snapshot)),
      })),
    };
  });
}
export async function POST(request: Request) {
  return handle(async () =>
    saveDraft(await owner(request), await body(request), false),
  );
}
export async function PATCH(request: Request) {
  return handle(async () =>
    saveDraft(await owner(request), await body(request), true),
  );
}
export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await owner(request),
      p = z
        .object({ id: z.string().uuid(), revision: z.number().int() })
        .parse(await body(request));
    const r = await database()
      .prepare(
        "DELETE FROM drafts WHERE owner=? AND id=? AND revision=? AND status IN ('draft','planned','canceled','failed','blocked','pending_review')",
      )
      .bind(user, p.id, p.revision)
      .run();
    if (!r.meta.changes)
      throw new AppError(
        "Cancel scheduled work and reload the draft before removing it.",
        409,
      );
    return { ok: true };
  });
}
