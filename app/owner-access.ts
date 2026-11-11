import { NextResponse } from "next/server";
import { standalone } from "#signaldesk-runtime";
import {
  createOwnerSession,
  matchesOwnerKey,
  ownerConfig,
  sessionCookie,
  sessionLifetime,
} from "@/lib/owner-session";
import { safeRelativeReturnPath } from "./chatgpt-auth";

function form(signOut: boolean, message: string, status = 200) {
  const title = signOut ? "Sign out" : "Sign in to SignalDesk";
  const content =
    status === 503
      ? ""
      : `<form method="post">
    ${signOut ? "" : '<label>Owner access key<input name="key" type="password" autocomplete="current-password" required maxlength="64"></label>'}
    <button type="submit">${signOut ? "Sign out" : "Sign in"}</button></form>`;
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
    <style>html{color-scheme:light dark}body{font:1rem/1.5 system-ui;margin:0}main{max-width:24rem;margin:15vh auto;padding:1.5rem}h1{font-size:1.7rem}input,button{box-sizing:border-box;font:inherit;padding:.65rem .8rem;border-radius:.4rem}input{display:block;width:100%;margin:.4rem 0 1rem;border:1px solid #82938c}button{background:#126750;color:white;border:0;cursor:pointer}</style>
    </head><body><main><h1>${title}</h1><p>${message}</p>${content}</main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    },
  );
}

async function readKey(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0] !==
    "application/x-www-form-urlencoded"
  )
    return "";
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "",
    bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 512) {
      await reader.cancel();
      return "";
    }
    text += decoder.decode(value, { stream: true });
  }
  return new URLSearchParams(text + decoder.decode()).get("key") || "";
}

export async function ownerAccess(request: Request, signOut: boolean) {
  if (!standalone) return new Response(null, { status: 404 });
  const config = ownerConfig();
  if (!config)
    return form(
      signOut,
      "Configure APP_ORIGIN, OWNER_USER_ID and SIGNALDESK_OWNER_KEY in the server environment to enable owner access.",
      503,
    );
  if (request.method === "GET")
    return form(
      signOut,
      signOut
        ? "End the owner session in this browser."
        : "Enter the access key for this private workspace.",
    );
  if (request.headers.get("origin") !== config.origin)
    return form(
      signOut,
      "Open the configured workspace address and try again.",
      403,
    );
  if (!signOut && !matchesOwnerKey(await readKey(request), config))
    return form(false, "The owner access key is incorrect.", 401);
  const returnTo = safeRelativeReturnPath(
    new URL(request.url).searchParams.get("return_to") || "/",
  );
  const response = NextResponse.redirect(new URL(returnTo, config.origin), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set(
    sessionCookie,
    signOut ? "" : createOwnerSession(config),
    {
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "lax",
      maxAge: signOut ? 0 : sessionLifetime,
    },
  );
  return response;
}
