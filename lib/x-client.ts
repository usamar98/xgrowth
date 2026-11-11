import {
  AppError,
  config,
  configuration,
  database,
  decrypt,
  encrypt,
} from "./server";

type Tokens = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
};
export type PrivateAccount = {
  id: string;
  owner: string;
  x_user_id: string;
  username: string;
  name: string;
  tokens: string;
  expires: number;
  blocked_until: number;
  locked_until: number;
  granted_scopes: string;
  health: string;
};
export class XError extends AppError {
  constructor(
    message: string,
    public upstreamStatus: number,
    public uncertain = false,
  ) {
    super(
      message,
      upstreamStatus === 429 ? 429 : upstreamStatus === 401 ? 401 : 502,
    );
  }
}
export async function tokenRequest(
  params: Record<string, string>,
  path: "token" | "revoke" = "token",
): Promise<Tokens> {
  if (!configuration().configured)
    throw new AppError("X connection setup is incomplete.", 503);
  let response: Response;
  try {
    response = await fetch("https://api.x.com/2/oauth2/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          btoa(config("X_CLIENT_ID") + ":" + config("X_CLIENT_SECRET")),
      },
      body: new URLSearchParams({
        ...params,
        client_id: config("X_CLIENT_ID"),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new XError(
      "The X authorization request timed out. Check your connection.",
      0,
    );
  }
  if (!response.ok)
    throw new XError(
      "X declined authorization. Check your app configuration and reconnect.",
      response.status,
    );
  if (path === "revoke") return { access_token: "" };
  const result = (await response.json()) as Tokens;
  if (!result.access_token)
    throw new XError(
      "X returned an incomplete authorization.",
      response.status,
    );
  return result;
}
export async function withAccount<T>(
  owner: string,
  id: string,
  fn: (a: PrivateAccount) => Promise<T>,
) {
  const db = database(),
    now = Date.now(),
    until = now + 180000;
  const account = await db
    .prepare("SELECT * FROM accounts WHERE owner=? AND id=?")
    .bind(owner, id)
    .first<PrivateAccount>();
  if (!account)
    throw new AppError("Connect and select your account first.", 404);
  if (account.health !== "connected")
    throw new AppError("Reconnect this account in Settings.", 401);
  if (account.blocked_until > now)
    throw new AppError(
      "X requests are paused until " +
        new Date(account.blocked_until).toISOString() +
        ".",
      429,
    );
  const locked = await db
    .prepare(
      "UPDATE accounts SET locked_until=? WHERE owner=? AND id=? AND locked_until<=? AND health='connected' AND blocked_until<=?",
    )
    .bind(until, owner, id, now, now)
    .run();
  if (!locked.meta.changes)
    throw new AppError(
      "Another request is running for this account. Try again shortly.",
      409,
    );
  try {
    const fresh = await db
      .prepare(
        "SELECT * FROM accounts WHERE owner=? AND id=? AND locked_until=?",
      )
      .bind(owner, id, until)
      .first<PrivateAccount>();
    if (!fresh)
      throw new AppError("The connection changed. Reload the workspace.", 409);
    return await fn(fresh);
  } finally {
    await db
      .prepare(
        "UPDATE accounts SET locked_until=0 WHERE owner=? AND id=? AND locked_until=?",
      )
      .bind(owner, id, until)
      .run();
  }
}
async function markRevoked(a: PrivateAccount) {
  await database()
    .prepare(
      "UPDATE accounts SET health='reconnect',tokens='',expires=0 WHERE id=? AND owner=? AND tokens=?",
    )
    .bind(a.id, a.owner, a.tokens)
    .run();
}
export async function accessToken(a: PrivateAccount) {
  let tokens = JSON.parse(await decrypt(a.tokens)) as Tokens;
  if (a.expires > Date.now() + 60000) return tokens.access_token;
  if (!tokens.refresh_token) {
    await markRevoked(a);
    throw new AppError("Reconnect your expired X account.", 401);
  }
  let next: Tokens;
  try {
    next = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
  } catch (e) {
    if (e instanceof XError && [400, 401].includes(e.upstreamStatus))
      await markRevoked(a);
    throw e;
  }
  tokens = {
    ...next,
    scope: next.scope ?? tokens.scope,
    refresh_token: next.refresh_token || tokens.refresh_token,
  };
  const encrypted = await encrypt(JSON.stringify(tokens)),
    expires = Date.now() + (tokens.expires_in || 7200) * 1000;
  const result = await database()
    .prepare(
      "UPDATE accounts SET tokens=?,expires=?,granted_scopes=? WHERE id=? AND owner=? AND tokens=? AND locked_until=? AND health='connected'",
    )
    .bind(
      encrypted,
      expires,
      tokens.scope ?? a.granted_scopes,
      a.id,
      a.owner,
      a.tokens,
      a.locked_until,
    )
    .run();
  if (!result.meta.changes)
    throw new AppError(
      "The connection changed during refresh. Reconnect in Settings.",
      409,
    );
  a.tokens = encrypted;
  a.expires = expires;
  a.granted_scopes = tokens.scope ?? a.granted_scopes;
  return tokens.access_token;
}
export async function xRequest<T>(
  a: PrivateAccount,
  path: string,
  init: RequestInit = {},
) {
  return rawRequest<T>(await accessToken(a), path, init, a);
}
export async function rawRequest<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  a?: PrivateAccount,
): Promise<T> {
  if (!/^[a-z0-9][a-z0-9/?&=.%_,-]*$/i.test(path) || path.includes(".."))
    throw new AppError("Invalid X resource.");
  const write = ["POST", "DELETE"].includes(init.method || "GET");
  let r: Response;
  try {
    r = await fetch("https://api.x.com/2/" + path, {
      ...init,
      redirect: "error",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new XError(
      "X did not confirm this request. Review its outcome in X.",
      0,
      write,
    );
  }
  if (
    a &&
    (r.status === 429 || r.headers.get("x-rate-limit-remaining") === "0")
  ) {
    const reset = Number(r.headers.get("x-rate-limit-reset")) * 1000;
    const retry = r.headers.get("retry-after");
    const retryAt = retry
      ? /^\d+$/.test(retry)
        ? Date.now() + Number(retry) * 1000
        : Date.parse(retry)
      : 0;
    await database()
      .prepare(
        "UPDATE accounts SET blocked_until=MAX(blocked_until,?) WHERE id=? AND owner=?",
      )
      .bind(
        Math.max(Date.now() + 60000, reset || 0, retryAt || 0),
        a.id,
        a.owner,
      )
      .run();
  }
  if (!r.ok) {
    if (a && r.status === 401) await markRevoked(a);
    const details: Record<number, string> = {
      401: "Reconnect this account in Settings.",
      402: "The developer app needs API credits.",
      403: "X denied access to this resource.",
      404: "This post is no longer available.",
      429: "Wait until the X rate limit resets.",
    };
    throw new XError(
      details[r.status] || "X could not complete this request.",
      r.status,
      write && (r.status >= 500 || r.status === 408),
    );
  }
  try {
    return (await r.json()) as T;
  } catch {
    throw new XError(
      "X sent an unreadable response. Review the outcome.",
      r.status,
      write,
    );
  }
}
