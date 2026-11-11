import { z } from "zod";
import { AppError, body, database, handle } from "@/lib/server";
import { saveDraft } from "@/lib/creative-store";
import { authorizeKey } from "@/lib/desk-keys";
const permissions = {
  list_drafts: "drafts:read",
  create_draft: "drafts:create",
  request_review: "drafts:review",
  job_status: "jobs:read",
  workspace_summary: "summary:read",
} as const;
const form = z
  .object({
    tool: z.enum([
      "list_drafts",
      "create_draft",
      "request_review",
      "job_status",
      "workspace_summary",
    ]),
    id: z.string().uuid().optional(),
    text: z.string().trim().min(1).max(4000).optional(),
  })
  .strict();
export async function POST(request: Request) {
  return handle(async () => {
    const caller = await authorizeKey(request),
      p = form.parse(await body(request)),
      db = database();
    if (!JSON.parse(caller.scopes).includes(permissions[p.tool]))
      throw new AppError("This credential lacks the required scope.", 403);
    const now = new Date().toISOString(),
      params = [caller.owner, caller.account_id];
    await db
      .prepare("INSERT INTO desk_access_log VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), caller.owner, caller.id, p.tool, now)
      .run();
    switch (p.tool) {
      case "list_drafts":
        return {
          drafts: (
            await db
              .prepare(
                "SELECT id,text,status,revision,updated_at FROM drafts WHERE owner=? AND account_id IS ? ORDER BY updated_at DESC LIMIT 60",
              )
              .bind(...params)
              .all()
          ).results,
        };
      case "workspace_summary":
        return {
          counts: (
            await db
              .prepare(
                "SELECT status,COUNT(*) count FROM drafts WHERE owner=? AND account_id IS ? GROUP BY status",
              )
              .bind(...params)
              .all()
          ).results,
        };
      case "job_status": {
        const result = await db
          .prepare(
            "SELECT id,status,post_id,run_at FROM queue_jobs WHERE owner=? AND account_id IS ? AND id=?",
          )
          .bind(...params, p.id || "")
          .first();
        if (!result) throw new AppError("Job unavailable.", 404);
        return result;
      }
      case "create_draft": {
        if (!p.text) throw new AppError("Provide draft text.");
        return saveDraft(
          caller.owner,
          {
            text: p.text,
            account_id: caller.account_id,
            kind: "post",
            provenance: "ai",
          },
          false,
        );
      }
      case "request_review": {
        const r = await db
          .prepare(
            "UPDATE drafts SET status='pending_review',updated_at=? WHERE owner=? AND account_id IS ? AND id=? AND status IN ('draft','pending_review')",
          )
          .bind(now, ...params, p.id || "")
          .run();
        if (!r.meta.changes)
          throw new AppError("Draft unavailable for review.", 409);
        return { ok: true };
      }
    }
  });
}
