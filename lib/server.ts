import { env, standalone } from "#signaldesk-runtime";
import { getChatGPTUser } from "@/app/chatgpt-auth";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function database() {
  if (!env.DB)
    throw new AppError(
      standalone
        ? "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN to enable workspace storage."
        : "Saved data is temporarily unavailable. Please try again.",
      503,
    );
  return env.DB;
}
export function config(key: string) {
  return (
    (env as unknown as Record<string, string>)[key] || process.env[key] || ""
  );
}
export function configuration() {
  const missing = [
    "X_CLIENT_ID",
    "X_CLIENT_SECRET",
    "X_TOKEN_ENCRYPTION_KEY",
    "APP_ORIGIN",
  ].filter((k) => !config(k));
  if (
    config("X_TOKEN_ENCRYPTION_KEY") &&
    !/^[a-f\d]{64}$/i.test(config("X_TOKEN_ENCRYPTION_KEY"))
  )
    missing.push("Valid 64-character encryption key");
  return { configured: !missing.length, missing };
}
export function appOrigin() {
  const origin = new URL(config("APP_ORIGIN"));
  if (
    origin.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(origin.hostname)
  )
    throw new AppError("Configure a secure app origin.", 503);
  return origin.origin;
}
export async function owner(request?: Request) {
  const user = await getChatGPTUser();
  if (!user)
    throw new AppError("Sign in to access your private workspace.", 401);
  const expected =
    config("OWNER_USER_ID") ||
    (process.env.NODE_ENV === "development" ? "local_seedy" : "");
  if (!expected || user.userId !== expected)
    throw new AppError(
      "This private workspace is restricted to its configured owner.",
      403,
    );
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (!origin || origin !== (standalone ? appOrigin() : new URL(request.url).origin))
      throw new AppError("This action must start in your workspace.", 403);
  }
  return user.userId;
}
export async function body(request: Request) {
  const limit = 20000;
  if (Number(request.headers.get("content-length") || 0) > limit)
    throw new AppError("The request is too large.", 413);
  if (!request.body) throw new AppError("A JSON request body is required.");
  const reader = request.body.getReader(),
    decoder = new TextDecoder(),
    pieces: string[] = [];
  let bytes = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > limit) {
      await reader.cancel();
      throw new AppError("The request is too large.", 413);
    }
    pieces.push(decoder.decode(chunk.value, { stream: true }));
  }
  pieces.push(decoder.decode());
  try {
    return JSON.parse(pieces.join(""));
  } catch {
    throw new AppError("Invalid JSON request.");
  }
}
export async function handle(fn: () => Promise<unknown>) {
  try {
    const data = await fn();
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AppError)
      return Response.json(
        { error: e.message },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    if (e instanceof Error && e.name === "ZodError")
      return Response.json(
        { error: "Check the form values and try again." },
        { status: 400 },
      );
    console.error(
      "Workspace operation failed",
      e instanceof Error ? e.name : "Unknown",
    );
    return Response.json(
      {
        error:
          "Could not complete this action. Reload your workspace to check its latest state. If publishing, check X before retrying.",
      },
      { status: 503 },
    );
  }
}
export async function preferences(id: string) {
  const db = database();
  await db
    .prepare("INSERT OR IGNORE INTO settings(owner) VALUES (?)")
    .bind(id)
    .run();
  return await db
    .prepare(
      "SELECT audience,topics,weekly_target,budget,timezone,actions_paused,daily_budget FROM settings WHERE owner=?",
    )
    .bind(id)
    .first<import("./types").Preferences>();
}
export function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function fromBase64url(s: string) {
  return Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
}
async function encryptionKey() {
  const hex = config("X_TOKEN_ENCRYPTION_KEY");
  if (!/^[a-f\d]{64}$/i.test(hex))
    throw new AppError("The X connection is not configured yet.", 503);
  return crypto.subtle.importKey(
    "raw",
    Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function encrypt(value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(),
    new TextEncoder().encode(value),
  );
  return base64url(iv) + "." + base64url(new Uint8Array(encrypted));
}
export async function decrypt(value: string) {
  const [iv, data] = value.split(".");
  const result = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(iv) },
    await encryptionKey(),
    fromBase64url(data),
  );
  return new TextDecoder().decode(result);
}
