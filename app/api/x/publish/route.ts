import { z } from "zod";
import { handle, owner, body, database, AppError } from "@/lib/server";
import { schedule } from "@/lib/queue";

export async function POST(request: Request) {
  return handle(async () => {
    const user = await owner(request);
    const p = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int().positive(),
        confirm: z.literal(true),
        account_id: z.string().uuid().optional(),
      })
      .parse(await body(request));
    const draft = await database()
      .prepare(
        "SELECT account_id,status,post_id FROM drafts WHERE owner=? AND id=?",
      )
      .bind(user, p.id)
      .first<{
        account_id: string | null;
        status: string;
        post_id: string | null;
      }>();
    if (!draft) throw new AppError("Draft not found.", 404);
    if (draft.status === "published")
      return { post_id: draft.post_id, already_published: true };
    if (!draft.account_id)
      throw new AppError("Select an X account in the draft.");
    if (p.account_id && p.account_id !== draft.account_id)
      throw new AppError("The account changed. Review the draft again.", 409);
    return schedule(user, {
      draft_id: p.id,
      revision: p.revision,
      account_id: draft.account_id,
      run_at: new Date().toISOString(),
      timezone: "UTC",
    });
  });
}
