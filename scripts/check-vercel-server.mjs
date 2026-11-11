import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { once } from "node:events";
import { setTimeout as wait } from "node:timers/promises";

// Start the actual compiled app with disposable credentials and no provider access.
const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((done) => probe.close(done));
const base = "http://127.0.0.1:" + port;
const origin = "https://workspace.test";
const key = randomBytes(32).toString("hex");
const server = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      APP_ORIGIN: origin,
      OWNER_USER_ID: "fixture-owner",
      SIGNALDESK_OWNER_KEY: key,
      TURSO_DATABASE_URL: "",
      TURSO_AUTH_TOKEN: "",
    },
  },
);
let output = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (data) => {
    output = (output + data).slice(-4000);
  });
const closed = once(server, "close");
const login = (password, formOrigin = origin) =>
  fetch(base + "/signin-with-chatgpt?return_to=/app/compose", {
    method: "POST",
    redirect: "manual",
    headers: { Origin: formOrigin },
    body: new URLSearchParams({ key: password }),
  });

try {
  let home;
  for (let tries = 0; tries < 150; tries++) {
    if (server.exitCode !== null)
      throw new Error("Native server exited: " + output);
    try {
      home = await fetch(base + "/app/overview");
      break;
    } catch {
      await wait(200);
    }
  }
  assert.equal(home?.status, 200, output);
  assert.match(await home.text(), /SignalDesk/);
  const form = await fetch(base + "/signin-with-chatgpt");
  assert.equal(form.status, 200);
  assert.match(await form.text(), /Owner access key/);
  const privateApi = base + "/api/workspace";
  const unsigned = await fetch(privateApi, {
    headers: {
      "oai-authenticated-user-id": "fixture-owner",
      "oai-authenticated-user-email": "fixture@example.test",
    },
  });
  assert.equal(unsigned.status, 401);
  assert.equal((await login("incorrect")).status, 401);
  assert.equal((await login(key, "https://other.test")).status, 403);
  const signedIn = await login(key);
  assert.equal(signedIn.status, 303);
  assert.equal(signedIn.headers.get("location"), origin + "/app/compose");
  const cookie = signedIn.headers.get("set-cookie");
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  const data = await fetch(privateApi, {
    headers: { Cookie: cookie.split(";")[0] },
  });
  assert.equal(data.status, 503);
  assert.match(
    (await data.json()).error,
    /Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN/,
  );
  const signout = await fetch(base + "/signout-with-chatgpt", {
    method: "POST",
    redirect: "manual",
    headers: { Origin: origin },
  });
  assert.equal(signout.status, 303);
  assert.match(signout.headers.get("set-cookie"), /Max-Age=0/i);
  console.log(
    "Verified the compiled workspace, private API, owner sign-in and sign-out.",
  );
} finally {
  server.kill();
  await closed;
}
