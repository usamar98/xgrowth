import { z } from "zod";
import { handle, owner, body, database, decrypt, AppError } from "@/lib/server";
import { tokenRequest } from "@/lib/x-client";

export async function POST(request: Request) {
  return handle(async () => {
    const o = await owner(request),
      p = z
        .object({ account_id: z.string().uuid() })
        .strict()
        .parse(await body(request)),
      db = database();
    // Removing the account triggers queue cancellation in the same database operation.
    const removed = await db
      .prepare(
        "DELETE FROM accounts WHERE owner=? AND id=? RETURNING tokens,locked_until",
      )
      .bind(o, p.account_id)
      .first<{ tokens: string; locked_until: number }>();
    if (!removed) throw new AppError("Account not found.", 404);
    let revoked = false;
    if (removed.tokens) {
      try {
        const t = JSON.parse(await decrypt(removed.tokens));
        await tokenRequest(
          { token: t.refresh_token || t.access_token },
          "revoke",
        );
        revoked = true;
      } catch {
        /* Local removal succeeded even if X revoke was unavailable. */
      }
    }
    const active = removed.locked_until > Date.now();
    return {
      ok: true,
      revoked,
      message:
        "Account disconnected. " +
        (active ? "A request already in flight may finish. " : "") +
        (revoked && !active
          ? "Stored credentials and the X grant were removed."
          : "Review and revoke the grant under Connected apps on X."),
    };
  });
}
