import { z } from "zod";
import { standalone } from "#signaldesk-runtime";
import { owner, handle, database, body, AppError } from "@/lib/server";
import { imageMime, mediaBucket } from "@/lib/media";
const uploadLimit = standalone
    ? { bytes: 4_500_000, label: "4.5 MB" }
    : { bytes: 5 * 1024 * 1024, label: "5 MB" },
  editable = "status IN ('draft','planned','pending_review')";
async function ownedDraft(o: string, id: string) {
  const row = await database()
    .prepare("SELECT id FROM drafts WHERE id=? AND owner=?")
    .bind(id, o)
    .first();
  if (!row) throw new AppError("Draft unavailable.", 404);
}
export async function GET(r: Request) {
  const url = new URL(r.url),
    blob = url.searchParams.get("file");
  if (blob) {
    let response: Response | undefined;
    const check = await handle(async () => {
      const o = await owner();
      const row = await database()
        .prepare("SELECT object_key FROM draft_media WHERE owner=? AND id=?")
        .bind(o, blob)
        .first<{ object_key: string }>();
      if (!row) throw new AppError("Image unavailable.", 404);
      const file = await mediaBucket().get(row.object_key);
      if (!file) throw new AppError("Image file unavailable.", 404);
      response = new Response(file.body, {
        headers: {
          "Content-Type":
            file.httpMetadata?.contentType || "application/octet-stream",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
        },
      });
      return { ok: true };
    });
    return response ?? check;
  }
  return handle(async () => {
    const o = await owner(),
      id = z.string().uuid().parse(url.searchParams.get("draft_id"));
    await ownedDraft(o, id);
    return {
      uploadLimit,
      items: (
        await database()
          .prepare(
            "SELECT id,filename,alt,position,bytes FROM draft_media WHERE owner=? AND draft_id=? ORDER BY position,id",
          )
          .bind(o, id)
          .all()
      ).results,
    };
  });
}
export async function POST(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      id = z.string().uuid().parse(new URL(r.url).searchParams.get("draft_id"));
    await ownedDraft(o, id);
    if (
      !r.body ||
      Number(r.headers.get("content-length") || 0) > uploadLimit.bytes
    )
      throw new AppError(
        `Images must be ${uploadLimit.label} or smaller.`,
        413,
      );
    const reader = r.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > uploadLimit.bytes) {
        await reader.cancel();
        throw new AppError(`Image exceeds ${uploadLimit.label}.`, 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let pos = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, pos);
      pos += chunk.length;
    }
    const type = imageMime(bytes),
      mid = crypto.randomUUID(),
      key = "drafts/" + encodeURIComponent(o) + "/" + mid,
      bucket = mediaBucket(),
      db = database();
    const name = (r.headers.get("x-file-name") || "Image").slice(0, 140);
    await bucket.put(key, bytes, { httpMetadata: { contentType: type } });
    try {
      const result = await db
        .prepare(
          "INSERT INTO draft_media(id,owner,draft_id,object_key,filename,media_type,bytes,alt,position,created_at) SELECT ?,owner,id,?,?,?,?,'',COALESCE((SELECT MAX(position)+1 FROM draft_media WHERE draft_id=?),0),? FROM drafts WHERE owner=? AND id=? AND " +
            editable +
            " AND (SELECT COUNT(*) FROM draft_media WHERE draft_id=?)<4",
        )
        .bind(
          mid,
          key,
          name,
          type,
          size,
          id,
          new Date().toISOString(),
          o,
          id,
          id,
        )
        .run();
      if (!result.meta.changes)
        throw new AppError(
          "Use an editable draft with fewer than four images.",
          409,
        );
    } catch (err) {
      await bucket.delete(key);
      throw err;
    }
    return { id: mid };
  });
}
const edit = z.object({
  id: z.string().uuid(),
  alt: z.string().max(1000),
  position: z.number().int().min(0).max(1000),
});
export async function PATCH(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = edit.parse(await body(r));
    const result = await database()
      .prepare(
        "UPDATE draft_media SET alt=?,position=? WHERE owner=? AND id=? AND draft_id IN(SELECT id FROM drafts WHERE owner=? AND " +
          editable +
          ")",
      )
      .bind(p.alt, p.position, o, p.id, o)
      .run();
    if (!result.meta.changes)
      throw new AppError("Image cannot be edited.", 409);
    return { ok: true };
  });
}
export async function DELETE(r: Request) {
  return handle(async () => {
    const o = await owner(r),
      p = z.object({ id: z.string().uuid() }).parse(await body(r));
    const row = await database()
      .prepare(
        "DELETE FROM draft_media WHERE owner=? AND id=? AND draft_id IN(SELECT id FROM drafts WHERE owner=? AND " +
          editable +
          ") RETURNING object_key",
      )
      .bind(o, p.id, o)
      .first<{ object_key: string }>();
    if (!row) throw new AppError("Image cannot be removed.", 409);
    await mediaBucket().delete(row.object_key);
    return { ok: true };
  });
}
