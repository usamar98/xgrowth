import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const sessionCookie = "__Host-signaldesk_owner";
export const sessionLifetime = 8 * 60 * 60;

export function ownerConfig() {
  const owner = process.env.OWNER_USER_ID?.trim();
  const key = process.env.SIGNALDESK_OWNER_KEY || "";
  if (!owner || !/^[0-9a-f]{64}$/i.test(key)) return null;
  let url: URL;
  try {
    url = new URL(process.env.APP_ORIGIN || "");
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    return null;
  return { owner, origin: url.origin, key: Buffer.from(key, "hex") };
}

type OwnerConfig = NonNullable<ReturnType<typeof ownerConfig>>;

export function matchesOwnerKey(candidate: string, config: OwnerConfig) {
  return (
    /^[0-9a-f]{64}$/i.test(candidate) &&
    timingSafeEqual(config.key, Buffer.from(candidate, "hex"))
  );
}

function signature(payload: string, config: OwnerConfig) {
  return createHmac("sha256", config.key)
    .update(
      JSON.stringify([
        "signaldesk-owner-v1",
        config.owner,
        config.origin,
        payload,
      ]),
    )
    .digest("base64url");
}

export function createOwnerSession(config: OwnerConfig) {
  const expires = Math.floor(Date.now() / 1000) + sessionLifetime;
  const payload = expires + "." + randomBytes(16).toString("hex");
  return payload + "." + signature(payload, config);
}

export function sessionOwner(token: string | undefined) {
  const config = ownerConfig();
  const match = token?.match(
    /^(\d{10,11})\.([a-f0-9]{32})\.([A-Za-z0-9_-]{43})$/,
  );
  if (!config || !match) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Number(match[1]) <= now || Number(match[1]) > now + sessionLifetime)
    return null;
  const expected = signature(match[1] + "." + match[2], config);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(match[3]))
    ? config.owner
    : null;
}
