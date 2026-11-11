import {
  handle,
  owner,
  configuration,
  AppError,
  database,
  encrypt,
  base64url,
  appOrigin,
  config,
} from "@/lib/server";
import { cookies } from "next/headers";
export async function POST(request: Request) {
  return handle(async () => {
    const id = await owner(request);
    if (!configuration().configured)
      throw new AppError(
        "Add your X developer app credentials and encryption key before connecting.",
        503,
      );
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(verifier),
        ),
      ),
    );
    const db = database();
    await db.batch([
      db
        .prepare("DELETE FROM oauth_states WHERE owner=? OR expires<?")
        .bind(id, Date.now()),
      db
        .prepare(
          "INSERT INTO oauth_states(state,owner,verifier,expires) VALUES (?,?,?,?)",
        )
        .bind(state, id, await encrypt(verifier), Date.now() + 600000),
    ]);
    const cookie = await cookies();
    cookie.set("xgrowth_oauth", state, {
      httpOnly: true,
      secure: appOrigin().startsWith("https:"),
      sameSite: "lax",
      maxAge: 600,
      path: "/api/x",
    });
    const url = new URL("https://x.com/i/oauth2/authorize");
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config("X_CLIENT_ID"),
      redirect_uri: appOrigin() + "/api/x/callback",
      scope: "tweet.read tweet.write users.read offline.access",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    }).toString();
    return { url: url.toString() };
  });
}
