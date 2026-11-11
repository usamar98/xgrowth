import { z } from "zod";
import { AppError, database, base64url } from "./server";
export const keyScopes = [
  "drafts:read",
  "drafts:create",
  "drafts:review",
  "jobs:read",
  "summary:read",
] as const;
export const keyForm = z.object({
  label: z.string().trim().min(1).max(80),
  account_id: z.string().uuid().nullable(),
  scopes: z.array(z.enum(keyScopes)).min(1).max(5),
  days: z.number().int().min(1).max(90),
});
async function digest(text: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return base64url(new Uint8Array(bytes));
}
export async function issueKey(owner: string, input: unknown) {
  const p = keyForm.parse(input),
    db = database();
  if (
    p.account_id &&
    !(await db
      .prepare("SELECT id FROM accounts WHERE owner=? AND id=?")
      .bind(owner, p.account_id)
      .first())
  )
    throw new AppError("Account unavailable.", 404);
  const token = "sd_" + base64url(crypto.getRandomValues(new Uint8Array(32))),
    id = crypto.randomUUID(),
    now = new Date();
  const result = await db
    .prepare(
      "INSERT INTO desk_api_keys(id,owner,account_id,label,digest,scopes,expires,created_at) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM desk_api_keys WHERE owner=? AND revoked=0 AND expires>?)<20",
    )
    .bind(
      id,
      owner,
      p.account_id,
      p.label,
      await digest(token),
      JSON.stringify(p.scopes),
      new Date(now.getTime() + p.days * 86400000).toISOString(),
      now.toISOString(),
      owner,
      now.toISOString(),
    )
    .run();
  if (!result.meta.changes)
    throw new AppError("Revoke an existing key before creating another.", 409);
  return { id, token };
}
export type Access = {
  id: string;
  owner: string;
  account_id: string | null;
  scopes: string;
};
export async function authorizeKey(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (!/^Bearer sd_[\w-]{43}$/.test(header))
    throw new AppError("A scoped developer credential is required.", 401);
  const db = database(),
    hash = await digest(header.slice(7)),
    bucket = Math.floor(Date.now() / 60000),
    now = new Date().toISOString();
  const row = await db
    .prepare(
      "UPDATE desk_api_keys SET requests=CASE WHEN bucket=? THEN requests+1 ELSE 1 END,bucket=? WHERE digest=? AND revoked=0 AND expires>? AND (account_id IS NULL OR EXISTS(SELECT 1 FROM accounts a WHERE a.owner=desk_api_keys.owner AND a.id=desk_api_keys.account_id)) AND (bucket<>? OR requests<30) RETURNING id,owner,account_id,scopes",
    )
    .bind(bucket, bucket, hash, now, bucket)
    .first<Access>();
  if (!row)
    throw new AppError("Credential unavailable or request limit reached.", 403);
  return row;
}
