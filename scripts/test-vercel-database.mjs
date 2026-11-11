import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, rmdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { build } from "esbuild";
import { migrateVercelDatabase } from "./migrate-vercel.mjs";

async function verify(directory) {
  const bundle = join(directory, "adapter.mjs");
  const client = createClient({
    url: pathToFileURL(join(directory, "test.sqlite")).href,
    intMode: "number",
  });
  try {
    await build({
      entryPoints: ["lib/vercel-database.ts"],
      bundle: true,
      platform: "node",
      format: "esm",
      packages: "external",
      outfile: bundle,
    });
    const { createVercelDatabase } = await import(pathToFileURL(bundle).href);
    const db = createVercelDatabase(client);
    const expected = (await readdir("drizzle"))
      .filter((file) => /^\d+_.+\.sql$/.test(file))
      .sort();
    assert.deepEqual(await migrateVercelDatabase(client), expected);
    assert.deepEqual(await migrateVercelDatabase(client), []);
    assert.equal(
      await db
        .prepare("SELECT COUNT(*) AS n FROM signaldesk_migrations")
        .first("n"),
      expected.length,
    );

    const insert = db.prepare("INSERT INTO settings(owner) VALUES(?)");
    const firstOwner = await insert.bind("one").run();
    assert.equal(firstOwner.success, true);
    assert.equal(firstOwner.meta.changes, 1);
    assert.ok(firstOwner.meta.last_row_id > 0);
    await assert.rejects(() =>
      db.batch([insert.bind("rolled-back"), insert.bind("one")]),
    );
    assert.equal(
      await db
        .prepare("SELECT owner FROM settings WHERE owner=?")
        .bind("rolled-back")
        .first(),
      null,
    );

    const created = await db
      .prepare(
        "INSERT INTO drafts(id,owner,text,created_at,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id, revision",
      )
      .bind("draft-a", "one", "First text")
      .all();
    assert.deepEqual(created.results, [{ id: "draft-a", revision: 1 }]);
    assert.equal(created.meta.changes, 1);
    const changed = await db.batch([
      db
        .prepare(
          "UPDATE drafts SET text=?, revision=revision+1 WHERE id=? RETURNING revision",
        )
        .bind("Revised text", "draft-a"),
      db
        .prepare(
          "SELECT revision, json_extract(snapshot, '$.text') AS text FROM draft_versions WHERE draft_id=? ORDER BY revision",
        )
        .bind("draft-a"),
    ]);
    assert.deepEqual(changed[0].results, [{ revision: 2 }]);
    assert.equal(changed[0].meta.changes, 1);
    assert.deepEqual(changed[1].results, [
      { revision: 1, text: "First text" },
      { revision: 2, text: "Revised text" },
    ]);
    assert.equal(changed[1].meta.changes, 0);
    assert.deepEqual(
      await db
        .prepare("SELECT id, revision FROM drafts")
        .raw({ columnNames: true }),
      [
        ["id", "revision"],
        ["draft-a", 2],
      ],
    );
    const remove = db
      .prepare("DELETE FROM drafts WHERE id=? RETURNING id")
      .bind("draft-a");
    const removed = await remove.run();
    assert.deepEqual(removed.results, [{ id: "draft-a" }]);
    assert.equal(removed.meta.changes, 1);
    assert.equal((await remove.run()).meta.changes, 0);
    console.log(
      `PASS ${expected.length} ordered libSQL migrations and idempotency, named rows, write metadata, RETURNING, atomic batches and draft version triggers`,
    );
  } finally {
    client.close();
  }
}

if (process.argv[2] === "--fixture") {
  await verify(process.argv[3]);
} else {
  const testRoot = resolve(".sites-runtime");
  await mkdir(testRoot, { recursive: true });
  const directory = await mkdtemp(join(testRoot, "vercel-db-"));
  // On Windows, the native libSQL driver can keep a database mapped until process exit.
  try {
    const child = spawnSync(
      process.execPath,
      [process.argv[1], "--fixture", directory],
      { stdio: "inherit" },
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
  } finally {
    for (const entry of await readdir(directory)) {
      await rm(join(directory, entry));
    }
    await rmdir(directory);
  }
}
