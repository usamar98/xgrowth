import { env } from "cloudflare:workers";
import { AppError } from "./server";
export function mediaBucket() {
  if (!env.BUCKET) throw new AppError("Image storage is not configured.", 503);
  return env.BUCKET;
}
export function imageMime(bytes: Uint8Array) {
  const match = (...sig: number[]) => sig.every((v, i) => bytes[i] === v);
  if (match(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (match(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (
    match(82, 73, 70, 70) &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return "image/webp";
  throw new AppError("Choose a PNG, JPEG, or WebP image.");
}
export async function purgeMedia(o: string) {
  if (!env.BUCKET) return;
  const prefix = "drafts/" + encodeURIComponent(o) + "/";
  let cursor: string | undefined;
  do {
    const page = await env.BUCKET.list({ prefix, cursor, limit: 100 });
    if (page.objects.length)
      await env.BUCKET.delete(page.objects.map((obj) => obj.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
