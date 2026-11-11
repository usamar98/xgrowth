import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import { build } from "esbuild";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// Exercise real route handlers and SQL against SQLite with only identity and X mocked.
const temp = mkdtempSync(join(tmpdir(), "signaldesk-worker-"));
let sqlite = new DatabaseSync(join(temp, "test.sqlite"));
for (const file of (await readdir("drizzle"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  sqlite.exec(await readFile("drizzle/" + file, "utf8"));
class Statement {
  constructor(sql, values = []) {
    this.sql = sql;
    this.values = values;
  }
  bind(...v) {
    return new Statement(this.sql, v);
  }
  async first() {
    return sqlite.prepare(this.sql).get(...this.values) || null;
  }
  async all() {
    return {
      results: sqlite.prepare(this.sql).all(...this.values),
      success: true,
    };
  }
  async run() {
    const r = sqlite.prepare(this.sql).run(...this.values);
    return { meta: { changes: Number(r.changes) }, success: true };
  }
}
globalThis.__testEnv = {
  OWNER_USER_ID: "owner-a",
  DB: {
    prepare: (sql) => new Statement(sql),
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const result = [];
        for (const s of statements) {
          const r = sqlite.prepare(s.sql).run(...s.values);
          result.push({ meta: { changes: Number(r.changes) }, success: true });
        }
        sqlite.exec("COMMIT");
        return result;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  },
  X_CLIENT_ID: "test-client",
  X_CLIENT_SECRET: "test-secret",
  APP_ORIGIN: "https://studio.test",
  X_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
};
globalThis.__testOwner = "owner-a";
await mkdir(".sites-runtime", { recursive: true });
await build({
  stdin: {
    contents: `export * as worker from '../lib/queue-worker';export * as costs from '../lib/costs';export * as queue from '../lib/queue';export * as server from '../lib/server';export * as content from '../lib/content';export * as drafts from '../app/api/drafts/route';export * as workspace from '../app/api/workspace/route';export * as publish from '../app/api/x/publish/route';export * as sync from '../app/api/x/sync/route';export * as client from '../lib/x-client';`,
    resolveDir: process.cwd() + "/scripts",
    loader: "ts",
  },
  outfile: ".sites-runtime/test-bundle.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  plugins: [
    {
      name: "test-runtime",
      setup(b) {
        b.onResolve({ filter: /^cloudflare:workers$/ }, () => ({
          path: "env",
          namespace: "test",
        }));
        b.onResolve({ filter: /chatgpt-auth$/ }, () => ({
          path: "auth",
          namespace: "test",
        }));
        b.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
          contents:
            args.path === "env"
              ? "export const env=globalThis.__testEnv;"
              : "export async function getChatGPTUser(){return globalThis.__testOwner?{userId:globalThis.__testOwner}:null;}",
          loader: "js",
        }));
      },
    },
  ],
});
const {
  worker,
  costs,
  queue,
  server,
  content,
  drafts,
  workspace,
  publish,
  sync,
  client,
} = await import(
  pathToFileURL(process.cwd() + "/.sites-runtime/test-bundle.mjs")
);
const req = (path, body, method = "POST", origin = "https://studio.test") =>
  new Request("https://studio.test" + path, {
    method,
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });
const parse = async (response) => ({
  status: response.status,
  data: await response.json(),
});
const draftData = (
  text = "A small lesson: ask a clear question before choosing a solution.",
  account_id = null,
) => ({ text, pillar: "Teach", planned_at: null, account_id });
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
await check(
  "weighted character count, emoji families, URLs, and unsupported mentions",
  async () => {
    assert.equal(content.reviewText("👨‍👩‍👧‍👦").length, 2);
    assert.equal(
      content.reviewText("https://example.com/very-long-path").length,
      23,
    );
    assert.equal(content.reviewText("中".repeat(141)).valid, false);
    assert.equal(content.reviewText("Thanks @somebody").valid, false);
    assert.equal(content.reviewText("[Your lesson]").valid, false);
    assert.equal(content.reviewText("example.com").hasUrl, true);
  },
);
await check("unavailable analytics are never converted into zero", async () => {
  assert.equal(
    content.getMetrics([{ public_metrics: { like_count: 2 } }]).impressions,
    null,
  );
  assert.equal(
    content.getMetrics([{ public_metrics: { impression_count: 100 } }]).rate,
    null,
  );
  assert.equal(
    content.getMetrics([
      {
        public_metrics: {
          impression_count: 100,
          like_count: 2,
          reply_count: 1,
          retweet_count: 1,
          quote_count: 1,
        },
      },
    ]).rate,
    5,
  );
});
await check("authentication and same-origin checks", async () => {
  globalThis.__testOwner = null;
  assert.equal((await workspace.GET()).status, 401);
  globalThis.__testOwner = "owner-a";
  assert.equal(
    (
      await drafts.POST(
        req("/api/drafts", draftData(), "POST", "https://attacker.test"),
      )
    ).status,
    403,
  );
});
let draftId,
  accountId = crypto.randomUUID();
await check(
  "draft creation, persistence, optimistic edits, and ownership isolation",
  async () => {
    const created = await parse(
      await drafts.POST(req("/api/drafts", draftData())),
    );
    assert.equal(created.status, 200);
    draftId = created.data.id;
    assert.equal(
      (await parse(await workspace.GET())).data.drafts[0].id,
      draftId,
    );
    globalThis.__testOwner = "owner-b";
    assert.equal((await workspace.GET()).status, 403);
    globalThis.__testEnv.OWNER_USER_ID = "owner-b";
    assert.equal((await parse(await workspace.GET())).data.drafts.length, 0);
    assert.equal(
      (
        await drafts.PATCH(
          req(
            "/api/drafts",
            { ...draftData(), id: draftId, revision: 1 },
            "PATCH",
          ),
        )
      ).status,
      409,
    );
    globalThis.__testOwner = "owner-a";
    globalThis.__testEnv.OWNER_USER_ID = "owner-a";
    assert.equal(
      (
        await drafts.PATCH(
          req(
            "/api/drafts",
            {
              ...draftData("A revised lesson about making decisions."),
              id: draftId,
              revision: 1,
            },
            "PATCH",
          ),
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await drafts.PATCH(
          req(
            "/api/drafts",
            { ...draftData(), id: draftId, revision: 1 },
            "PATCH",
          ),
        )
      ).status,
      409,
    );
  },
);
await check(
  "past planning dates and foreign accounts are rejected",
  async () => {
    assert.equal(
      (
        await drafts.POST(
          req("/api/drafts", {
            ...draftData(),
            planned_at: "2020-01-01T00:00:00.000Z",
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await drafts.POST(
          req("/api/drafts", draftData("A new thought", crypto.randomUUID())),
        )
      ).status,
      400,
    );
  },
);
const encrypted = await server.encrypt(
  JSON.stringify({
    access_token: "test-access",
    refresh_token: "test-refresh",
  }),
);
sqlite
  .prepare(
    "INSERT INTO accounts(id,owner,x_user_id,username,name,tokens,expires) VALUES (?,?,?,?,?,?,?)",
  )
  .run(
    accountId,
    "owner-a",
    "123",
    "testaccount",
    "Test account",
    encrypted,
    Date.now() + 3600000,
  );
await check(
  "tokens encrypt and round-trip without plaintext storage",
  async () => {
    assert.ok(!encrypted.includes("test-access"));
    assert.equal(
      JSON.parse(await server.decrypt(encrypted)).access_token,
      "test-access",
    );
  },
);
sqlite
  .prepare(
    "UPDATE accounts SET granted_scopes='tweet.read tweet.write users.read' WHERE id=?",
  )
  .run(accountId);
let upstream = 0;
globalThis.fetch = async () => {
  upstream++;
  return Response.json({ data: { id: "12345" } });
};
await check(
  "publishing requires explicit confirmation and blocks duplicate concurrent sends",
  async () => {
    const created = await parse(
      await drafts.POST(
        req(
          "/api/drafts",
          draftData("My first complete publishing test.", accountId),
        ),
      ),
    );
    const input = { id: created.data.id, revision: 1, confirm: true };
    assert.equal(
      (await publish.POST(req("/api/x/publish", { ...input, confirm: false })))
        .status,
      400,
    );
    const results = await Promise.all([
      publish.POST(req("/api/x/publish", input)),
      publish.POST(req("/api/x/publish", input)),
    ]);
    assert.ok(results.some((r) => r.status === 200));
    assert.equal(upstream, 0);
    await Promise.all([worker.tick(), worker.tick()]);
    assert.equal(upstream, 1);
    const again = await parse(await publish.POST(req("/api/x/publish", input)));
    assert.equal(again.data.already_published, true);
    assert.equal(upstream, 1);
  },
);
await check(
  "uncertain upstream outcomes cannot automatically publish a second time",
  async () => {
    globalThis.fetch = async () => {
      upstream++;
      throw new Error("network timeout");
    };
    const created = await parse(
      await drafts.POST(
        req(
          "/api/drafts",
          draftData(
            "A unique post with a simulated network timeout.",
            accountId,
          ),
        ),
      ),
    );
    const input = { id: created.data.id, revision: 1, confirm: true };
    assert.equal(
      (await publish.POST(req("/api/x/publish", input))).status,
      200,
    );
    await worker.tick();
    assert.equal(
      sqlite.prepare("SELECT status FROM drafts WHERE id=?").get(input.id)
        .status,
      "uncertain",
    );
    const before = upstream;
    assert.equal(
      (await publish.POST(req("/api/x/publish", input))).status,
      409,
    );
    assert.equal(upstream, before);
  },
);
await check(
  "429 persists the reset time and stops subsequent requests",
  async () => {
    const reset = Math.floor(Date.now() / 1000) + 900;
    globalThis.fetch = async () =>
      Response.json(
        { error: "rate limit" },
        { status: 429, headers: { "x-rate-limit-reset": String(reset) } },
      );
    const r = await sync.POST(req("/api/x/sync", { account_id: accountId }));
    assert.equal(r.status, 429);
    assert.ok(
      sqlite
        .prepare("SELECT blocked_until FROM accounts WHERE id=?")
        .get(accountId).blocked_until >=
        reset * 1000,
    );
    assert.equal(
      (await sync.POST(req("/api/x/sync", { account_id: accountId }))).status,
      429,
    );
    sqlite
      .prepare("UPDATE accounts SET blocked_until=0 WHERE id=?")
      .run(accountId);
  },
);
await check("API allowance blocks the call before it reaches X", async () => {
  sqlite.prepare("UPDATE settings SET budget=0 WHERE owner=?").run("owner-a");
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({});
  };
  assert.equal(
    (await sync.POST(req("/api/x/sync", { account_id: accountId }))).status,
    402,
  );
  assert.equal(calls, 0);
});
await check(
  "expired tokens refresh once and persist the rotated refresh token",
  async () => {
    sqlite
      .prepare("UPDATE settings SET budget=10000000 WHERE owner=?")
      .run("owner-a");
    sqlite.prepare("UPDATE accounts SET expires=0 WHERE id=?").run(accountId);
    let refreshes = 0;
    globalThis.fetch = async (url) => {
      assert.ok(url.endsWith("/oauth2/token"));
      refreshes++;
      return Response.json({
        access_token: "rotated-access",
        refresh_token: "rotated-refresh",
        expires_in: 7200,
      });
    };
    await client.withAccount("owner-a", accountId, async (account) => {
      assert.equal(await client.accessToken(account), "rotated-access");
      assert.equal(await client.accessToken(account), "rotated-access");
    });
    assert.equal(refreshes, 1);
    const stored = sqlite
      .prepare("SELECT tokens FROM accounts WHERE id=?")
      .get(accountId);
    assert.equal(
      JSON.parse(await server.decrypt(stored.tokens)).refresh_token,
      "rotated-refresh",
    );
  },
);
const create = async (text) => {
  const result = await parse(
    await drafts.POST(req("/api/drafts", draftData(text, accountId))),
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data.id;
};
const approve = (draft_id) =>
  queue.schedule("owner-a", {
    draft_id,
    revision: 1,
    account_id: accountId,
    run_at: new Date().toISOString(),
    timezone: "Asia/Karachi",
  });
await check(
  "draft revision and destination are immutable after approval",
  async () => {
    const id = await create("Draft with one editable sentence.");
    const job = await approve(id);
    sqlite
      .prepare(
        "UPDATE drafts SET revision=revision+1,text='Updated sentence' WHERE id=?",
      )
      .run(id);
    assert.equal(
      sqlite.prepare("SELECT status FROM queue_jobs WHERE id=?").get(job.id)
        .status,
      "canceled",
    );
    assert.throws(() =>
      sqlite
        .prepare("UPDATE queue_jobs SET account_id='another' WHERE id=?")
        .run(job.id),
    );
  },
);
await check(
  "paused work, canceled jobs and disconnected accounts do not dispatch",
  async () => {
    const id = await create("One delivery paused by the account owner.");
    const job = await approve(id);
    sqlite
      .prepare("UPDATE settings SET actions_paused=1 WHERE owner=?")
      .run("owner-a");
    assert.deepEqual(await worker.tick(), { processed: 0 });
    await queue.cancelJob("owner-a", job.id);
    sqlite
      .prepare("UPDATE settings SET actions_paused=0 WHERE owner=?")
      .run("owner-a");
    assert.deepEqual(await worker.tick(), { processed: 0 });
  },
);
await check(
  "a worker restart preserves approval and an abandoned dispatch becomes outcome-unknown",
  async () => {
    const id = await create("A scheduled post surviving a restart.");
    const job = await approve(id);
    const digest = sqlite
      .prepare("SELECT digest FROM queue_jobs WHERE id=?")
      .get(job.id).digest;
    sqlite.close();
    sqlite = new DatabaseSync(join(temp, "test.sqlite"));
    const recovered = sqlite
      .prepare("SELECT digest,status FROM queue_jobs WHERE id=?")
      .get(job.id);
    assert.equal(recovered.digest, digest);
    assert.equal(recovered.status, "scheduled");
    sqlite
      .prepare(
        "UPDATE queue_jobs SET status='dispatching',lease='crashed-worker',lease_until=0,dispatch_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), job.id);
    const before = upstream;
    await worker.tick();
    await worker.tick();
    assert.equal(
      sqlite.prepare("SELECT status FROM queue_jobs WHERE id=?").get(job.id)
        .status,
      "outcome-unknown",
    );
    assert.equal(upstream, before);
  },
);
await check(
  "money classifications distinguish URLs, unpriced operations and qualified owned reads",
  async () => {
    assert.equal(
      costs.estimatePublication("post", "Visit example.com"),
      200000,
    );
    assert.equal(costs.estimatePublication("reply", "Visit example.com"), null);
    assert.equal(
      costs.estimatePublication("reply", "Thanks for asking."),
      10000,
    );
    assert.equal(
      costs.estimatePostRead({
        count: 2,
        route: "mentions",
        userId: "1",
        appOwnerId: "1",
      }),
      2000,
    );
    assert.equal(
      costs.estimatePostRead({
        count: 2,
        route: "lookup",
        userId: "1",
        appOwnerId: "1",
      }),
      10000,
    );
    assert.equal(
      costs.estimatePostRead({
        count: 2,
        route: "posts",
        userId: "2",
        appOwnerId: "1",
      }),
      10000,
    );
  },
);
await check(
  "parallel cost reservations cannot overrun the daily allowance",
  async () => {
    await server.preferences("budget-owner");
    sqlite
      .prepare("UPDATE settings SET daily_budget=10000 WHERE owner=?")
      .run("budget-owner");
    const results = await Promise.allSettled([
      costs.reserveCost("budget-owner", 8000, "a"),
      costs.reserveCost("budget-owner", 8000, "b"),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const reservation = results.find((r) => r.status === "fulfilled").value;
    await costs.settleCost(reservation, "released");
    assert.equal((await costs.costReport("budget-owner")).day_micros, 0);
  },
);
await check(
  "a reply with unverified summon evidence and thread drafts stay blocked",
  async () => {
    const id = await create("A reply to your question.");
    sqlite
      .prepare("UPDATE drafts SET kind='reply',target_id='888' WHERE id=?")
      .run(id);
    await assert.rejects(approve(id), /verify|recipient|Import/);
    sqlite.prepare("UPDATE drafts SET kind='thread' WHERE id=?").run(id);
    await assert.rejects(approve(id), /manual/);
  },
);
await check(
  "reconciliation only reads X and verified human replies respect opt-outs and resolve their conversation",
  async () => {
    const ambiguous = sqlite
      .prepare(
        "SELECT id,text,dispatch_at FROM queue_jobs WHERE owner=? AND status='outcome-unknown' AND dispatch_at IS NOT NULL LIMIT 1",
      )
      .get("owner-a");
    let writes = 0;
    globalThis.fetch = async (_url, init) => {
      if (init.method === "POST") writes++;
      return Response.json({
        data: {
          id: "221",
          author_id: "123",
          text: ambiguous.text,
          created_at: ambiguous.dispatch_at,
        },
      });
    };
    assert.equal(
      (await queue.reconcileJob("owner-a", ambiguous.id, accountId, "221"))
        .post_id,
      "221",
    );
    assert.equal(writes, 0);
    const replyId = await create("Here is the requested explanation.");
    sqlite
      .prepare("UPDATE drafts SET kind='reply',target_id='888' WHERE id=?")
      .run(replyId);
    const stamp = new Date().toISOString();
    sqlite
      .prepare(
        "INSERT INTO inbox_items(owner,account_id,post_id,author_id,author_name,author_username,text,created_at,fetched_at,source,evidence_type,subject_x_id,verified_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        "owner-a",
        accountId,
        "888",
        "456",
        "Reader",
        "reader",
        "Can you explain?",
        stamp,
        stamp,
        "mention",
        "mention",
        "123",
        stamp,
      );
    sqlite.prepare("UPDATE drafts SET provenance='ai' WHERE id=?").run(replyId);
    await assert.rejects(approve(replyId), /AI-assisted/);
    sqlite
      .prepare("UPDATE drafts SET provenance='manual' WHERE id=?")
      .run(replyId);
    sqlite
      .prepare("INSERT INTO x_opt_out VALUES(?,?,?)")
      .run("owner-a", accountId, "456");
    await assert.rejects(approve(replyId), /opted out/);
    sqlite.prepare("DELETE FROM x_opt_out WHERE owner=?").run("owner-a");
    const reply = await approve(replyId);
    globalThis.fetch = async (url, init) => {
      if (init.method === "POST") {
        writes++;
        assert.deepEqual(JSON.parse(init.body), {
          text: "Here is the requested explanation.",
          reply: { in_reply_to_tweet_id: "888" },
        });
        return Response.json({ data: { id: "999" } });
      }
      assert.match(url, /tweets\/888/);
      return Response.json({
        data: {
          id: "888",
          author_id: "456",
          text: "Can you explain?",
          entities: { mentions: [{ id: "123" }] },
        },
      });
    };
    await worker.tick();
    assert.equal(
      sqlite.prepare("SELECT status FROM queue_jobs WHERE id=?").get(reply.id)
        .status,
      "published",
    );
    assert.equal(writes, 1);
    assert.equal(
      sqlite
        .prepare("SELECT status FROM inbox_items WHERE post_id=?")
        .get("888").status,
      "resolved",
    );
  },
);
await check(
  "disconnecting the approved account blocks future delivery",
  async () => {
    const id = await create(
      "This account was disconnected before the scheduled time.",
    );
    const job = await approve(id);
    sqlite.prepare("DELETE FROM accounts WHERE id=?").run(accountId);
    assert.equal(
      sqlite.prepare("SELECT status FROM queue_jobs WHERE id=?").get(job.id)
        .status,
      "blocked",
    );
    assert.deepEqual(await worker.tick(), { processed: 0 });
  },
);
console.log(
  `\n${passed} critical checks passed. X was mocked; no real account was contacted.`,
);
sqlite.close();
rmSync(temp, { recursive: true, force: true });
