import { cookies } from "next/headers";
import {
  owner,
  database,
  decrypt,
  encrypt,
  appOrigin,
  AppError,
} from "@/lib/server";
import { tokenRequest, rawRequest } from "@/lib/x-client";
import { reserveCost, settleCost } from "@/lib/costs";
export async function GET(request: Request) {
  let origin: string;
  try {
    origin = appOrigin();
  } catch {
    return Response.json(
      { error: "Configure the X application first." },
      { status: 503 },
    );
  }
  try {
    const id = await owner(),
      url = new URL(request.url),
      state = url.searchParams.get("state"),
      jar = await cookies();
    if (
      url.origin !== origin ||
      !state ||
      state !== jar.get("xgrowth_oauth")?.value
    )
      throw new AppError("This connection request could not be verified.");
    jar.set("xgrowth_oauth", "", { path: "/api/x", maxAge: 0 });
    const db = database(),
      row = await db
        .prepare(
          "DELETE FROM oauth_states WHERE state=? AND owner=? AND expires>? RETURNING verifier",
        )
        .bind(state, id, Date.now())
        .first<{ verifier: string }>();
    if (!row)
      throw new AppError(
        "This authorization expired or was already used. Start again.",
      );
    const code = url.searchParams.get("code");
    if (!code || url.searchParams.has("error"))
      throw new AppError("X authorization was declined.");
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: origin + "/api/x/callback",
      code_verifier: await decrypt(row.verifier),
    });
    const granted = new Set(tokens.scope?.split(" "));
    if (
      !["tweet.read", "tweet.write", "users.read", "offline.access"].every(
        (s) => granted.has(s),
      ) ||
      !tokens.refresh_token
    )
      throw new AppError(
        "Reconnect with the requested read, write, and offline permissions.",
      );
    const reservation = await reserveCost(id, 10000, "profile.read");
    let u: { id: string; name: string; username: string };
    try {
      const result = await rawRequest<{ data?: typeof u }>(
        tokens.access_token,
        "users/me",
      );
      if (!result.data?.username || !/^\d{1,20}$/.test(result.data.id))
        throw new AppError("X did not return a verified account identity.");
      u = result.data;
    } catch (e) {
      await settleCost(reservation, "unknown");
      throw e;
    }
    await settleCost(reservation, "recorded");
    await db
      .prepare(
        "INSERT OR IGNORE INTO x_account_ids(owner,x_user_id,account_id) VALUES(?,?,?)",
      )
      .bind(id, u.id, crypto.randomUUID())
      .run();
    const identity = await db
      .prepare(
        "SELECT account_id FROM x_account_ids WHERE owner=? AND x_user_id=?",
      )
      .bind(id, u.id)
      .first<{ account_id: string }>();
    const saved = await db
      .prepare(
        "INSERT INTO accounts(id,owner,x_user_id,username,name,tokens,expires,granted_scopes) SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM accounts WHERE owner=? AND x_user_id<>?) ON CONFLICT(owner,x_user_id) DO UPDATE SET username=excluded.username,name=excluded.name,tokens=excluded.tokens,expires=excluded.expires,granted_scopes=excluded.granted_scopes,blocked_until=0,health='connected' WHERE accounts.locked_until<=?",
      )
      .bind(
        identity!.account_id,
        id,
        u.id,
        u.username,
        u.name,
        await encrypt(JSON.stringify(tokens)),
        Date.now() + (tokens.expires_in || 7200) * 1000,
        tokens.scope!,
        id,
        u.id,
        Date.now(),
      )
      .run();
    if (!saved.meta.changes)
      throw new AppError(
        "An account is connected or busy. Review Settings before reconnecting.",
      );
    return Response.redirect(origin + "/app/settings?connected=1", 303);
  } catch (e) {
    return Response.redirect(
      origin +
        "/app/settings?connection_error=" +
        encodeURIComponent(
          e instanceof AppError
            ? e.message
            : "Connection failed. Try again from Settings.",
        ),
      303,
    );
  }
}
