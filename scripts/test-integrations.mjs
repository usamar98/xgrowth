import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { build } from "esbuild";
import assert from "node:assert/strict";

const sqlite = new DatabaseSync(":memory:");
sqlite.exec("PRAGMA foreign_keys=ON");
for (const file of readdirSync("drizzle")
  .filter((f) => f.endsWith(".sql"))
  .sort())
  sqlite.exec(readFileSync("drizzle/" + file, "utf8"));
function statement(sql, values = []) {
  return {
    bind: (...v) => statement(sql, v),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...values) }),
    run: () => ({
      meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) },
    }),
  };
}
const db = {
  prepare: statement,
  batch: async (ops) => {
    sqlite.exec("BEGIN");
    try {
      const out = ops.map((s) => s.run());
      sqlite.exec("COMMIT");
      return out;
    } catch (e) {
      sqlite.exec("ROLLBACK");
      throw e;
    }
  },
};
const o = "owner",
  origin = "https://desk.test",
  scopes = "tweet.read tweet.write users.read offline.access";
globalThis.xEnv = {
  DB: db,
  APP_ORIGIN: origin,
  OWNER_USER_ID: o,
  X_CLIENT_ID: "fixture",
  X_CLIENT_SECRET: "fixture-only",
  X_DELETE_COST_MICROS: "10000",
  X_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
};
globalThis.xUser = o;
const cookies = new Map();
globalThis.xCookieJar = {
  get: (k) => (cookies.has(k) ? { value: cookies.get(k) } : undefined),
  set: (k, v) => (v ? cookies.set(k, v) : cookies.delete(k)),
};
const entry = ["connect", "callback", "disconnect", "owned", "sync"]
  .map((k) => "export * as " + k + ' from "./app/api/x/' + k + '/route";')
  .join("\n");
mkdirSync(".sites-runtime", { recursive: true });
const bundlePath = resolve(".sites-runtime/integration-fixture.mjs");
await build({
  stdin: {
    contents:
      entry +
      'export * as policy from "./lib/x-policy";export * as ws from "./app/api/workspace/route";',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: bundlePath,
  plugins: [
    {
      name: "provider-fixture",
      setup(b) {
        for (const [filter, path] of [
          [/^#signaldesk-runtime$/, "env"],
          [/chatgpt-auth$/, "auth"],
          [/^next\/headers$/, "headers"],
        ])
          b.onResolve({ filter }, () => ({ path, namespace: "fixture" }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents: {
            env: "export const env=globalThis.xEnv; export const standalone=false;",
            auth: "export async function getChatGPTUser(){return globalThis.xUser?{userId:globalThis.xUser}:null;}",
            headers:
              "export async function cookies(){return globalThis.xCookieJar;}",
          }[args.path],
        }));
      },
    },
  ],
});
const api = await import(pathToFileURL(bundlePath).href);
const request = (path, data, method = "POST") =>
  new Request(origin + path, {
    method,
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
const callback = (state) =>
  api.callback.GET(
    new Request(
      origin +
        "/api/x/callback?state=" +
        encodeURIComponent(state) +
        "&code=fixture-code",
    ),
  );
const authorize = async () => {
  const res = await api.connect.POST(request("/api/x/connect", {}));
  assert.equal(res.status, 200);
  const url = new URL((await res.json()).url);
  assert.equal(url.origin, "https://x.com");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  return url.searchParams.get("state");
};
const incoming = {
  id: "42",
  author_id: "88",
  created_at: new Date().toISOString(),
  text: "@demo Can you explain?",
  entities: { mentions: [{ id: "11", username: "demo" }] },
};
let calls = 0,
  deleted = 0,
  foreign = false;
globalThis.fetch = async (url, init = {}) => {
  calls++;
  const path = new URL(url).pathname;
  if (path === "/2/oauth2/token")
    return Response.json({
      access_token: "fixture-access",
      refresh_token: "fixture-refresh",
      expires_in: 3600,
      scope: scopes,
    });
  if (path === "/2/oauth2/revoke") return new Response(null, { status: 200 });
  if (path === "/2/users/me")
    return Response.json({
      data: { id: "11", name: "Owner", username: "demo" },
    });
  if (path === "/2/users/11/mentions")
    return Response.json({
      data: [incoming],
      includes: { users: [{ id: "88", username: "viewer", name: "Viewer" }] },
      meta: { result_count: 1 },
    });
  if (path === "/2/users/11/tweets")
    return Response.json({
      data: [
        {
          id: "77",
          text: "An owned post",
          author_id: "11",
          public_metrics: { like_count: 0 },
        },
        { id: "78", text: "A second post", author_id: "11" },
      ],
      meta: { result_count: 2 },
    });
  if (path === "/2/tweets/42") return Response.json({ data: incoming });
  if (/^\/2\/tweets\/7[78]$/.test(path)) {
    if (init.method === "DELETE") {
      deleted++;
      return Response.json({ data: { deleted: true } });
    }
    return Response.json({
      data: {
        id: path.split("/").at(-1),
        author_id: foreign && path.endsWith("77") ? "99" : "11",
      },
    });
  }
  throw Error("Unexpected fixture request: " + path);
};
globalThis.xUser = null;
assert.equal((await api.ws.GET()).status, 401);
globalThis.xUser = "another";
assert.equal((await api.ws.GET()).status, 403);
globalThis.xUser = o;
let state = await authorize();
assert.ok(
  (await callback("wrong")).headers
    .get("location")
    .includes("connection_error"),
);
assert.equal(calls, 0);
sqlite.prepare("UPDATE oauth_states SET expires=0 WHERE state=?").run(state);
assert.ok(
  (await callback(state)).headers.get("location").includes("connection_error"),
);
assert.equal(calls, 0);
state = await authorize();
assert.ok(
  (await callback(state)).headers.get("location").includes("connected=1"),
);
cookies.set("xgrowth_oauth", state);
const before = calls;
assert.ok(
  (await callback(state)).headers.get("location").includes("connection_error"),
);
assert.equal(calls, before);
const account = sqlite.prepare("SELECT * FROM accounts").get();
assert.ok(!account.tokens.includes("fixture-access"));
assert.equal(account.granted_scopes, scopes);
console.log(
  "PASS owner gate, S256 challenges, forged, expired and replayed callbacks, encrypted connection",
);
const input = { account_id: account.id, kind: "mentions", limit: 5 };
const estimate = await api.sync.GET(
  new Request(
    origin + "/api/x/sync?" + new URLSearchParams({ ...input, limit: "5" }),
  ),
);
assert.equal((await estimate.json()).estimate_micros, 75000);
assert.equal((await api.sync.POST(request("/api/x/sync", input))).status, 200);
assert.equal(
  (await api.policy.replyDecision(o, account.id, "42")).state,
  "eligible",
);
assert.equal(
  (await api.policy.replyDecision(o, account.id, "42", "ai")).state,
  "unavailable",
);
sqlite
  .prepare("UPDATE inbox_items SET verified_at=?")
  .run("2000-01-01T00:00:00Z");
assert.equal(
  (await api.policy.replyDecision(o, account.id, "42")).state,
  "unknown",
);
const { type } = await api.policy.evidence(account, {
  ...incoming,
  entities: undefined,
});
assert.notEqual(type, "mention");
sqlite.prepare("INSERT INTO x_opt_out VALUES(?,?,?)").run(o, account.id, "88");
assert.equal(
  (await api.policy.replyDecision(o, account.id, "42")).state,
  "ineligible",
);
assert.equal(
  (await api.sync.POST(request("/api/x/sync", { ...input, kind: "owned" })))
    .status,
  200,
);
const owned = (
  await (
    await api.owned.GET(
      new Request(origin + "/api/x/owned?account_id=" + account.id),
    )
  ).json()
).posts;
assert.equal(owned.find((p) => p.id === "78").public_metrics, null);
assert.deepEqual(owned.find((p) => p.id === "77").public_metrics, {
  like_count: 0,
});
console.log(
  "PASS bounded import, provider ID evidence, stale and AI replies blocked, opt-out and absent metrics",
);
const select = { account_id: account.id, post_ids: ["77", "78"] };
assert.equal(
  (
    await api.owned.POST(
      request("/api/x/owned", { ...select, post_ids: ["999"] }),
    )
  ).status,
  403,
);
const preview = await (
  await api.owned.POST(request("/api/x/owned", select))
).json();
assert.equal(preview.estimate_micros, 30000);
const confirmed = { ...select, confirmation: preview.confirmation };
assert.equal(
  (
    await api.owned.DELETE(
      request("/api/x/owned", { ...confirmed, post_ids: ["78"] }, "DELETE"),
    )
  ).status,
  403,
);
foreign = true;
const result = await (
  await api.owned.DELETE(request("/api/x/owned", confirmed, "DELETE"))
).json();
assert.deepEqual(
  result.results.map((i) => i.status),
  ["failed", "deleted"],
);
assert.equal(deleted, 1);
assert.equal(
  (await api.owned.DELETE(request("/api/x/owned", confirmed, "DELETE"))).status,
  403,
);
assert.equal(
  sqlite.prepare("SELECT text FROM x_owned_posts WHERE id=?").get("78").text,
  "",
);
console.log(
  "PASS expiring exact-selection token, fresh authorship, partial deletion, cleared content and replay protection",
);
assert.equal(
  (
    await api.disconnect.POST(
      request("/api/x/disconnect", { account_id: account.id }),
    )
  ).status,
  200,
);
assert.equal(sqlite.prepare("SELECT count(*) c FROM accounts").get().c, 0);
state = await authorize();
await callback(state);
assert.equal(sqlite.prepare("SELECT id FROM accounts").get().id, account.id);
assert.equal(
  (await api.policy.replyDecision(o, account.id, "42")).state,
  "ineligible",
);
assert.equal(
  (
    await api.ws.DELETE(
      request("/api/workspace", { confirm: "DELETE" }, "DELETE"),
    )
  ).status,
  200,
);
assert.equal(sqlite.prepare("SELECT count(*) c FROM x_account_ids").get().c, 0);
assert.equal(sqlite.prepare("SELECT count(*) c FROM inbox_items").get().c, 0);
console.log(
  "PASS immediate disconnection, stable reauthorization, persistent opt-out, workspace purge",
);
sqlite.close();
