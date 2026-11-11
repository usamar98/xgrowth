import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/web";

const directory = new URL("../drizzle/", import.meta.url);

export async function migrateVercelDatabase(client) {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS signaldesk_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)",
  );
  const files = (await readdir(directory))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  const applied = [];
  for (const name of files) {
    const sql = (await readFile(new URL(name, directory), "utf8")).replaceAll(
      "\r\n",
      "\n",
    );
    const checksum = createHash("sha256").update(sql).digest("hex");
    const tx = await client.transaction("write");
    try {
      const previous = await tx.execute({
        sql: "SELECT checksum FROM signaldesk_migrations WHERE name=?",
        args: [name],
      });
      if (previous.rows.length) {
        if (previous.rows[0].checksum !== checksum)
          throw new Error("Previously applied migration changed: " + name);
      } else {
        // Let SQLite parse the file as a whole, including multi-statement triggers.
        await tx.executeMultiple(sql);
        await tx.execute({
          sql: "INSERT INTO signaldesk_migrations(name,checksum) VALUES(?,?)",
          args: [name, checksum],
        });
      }
      await tx.commit();
      if (!previous.rows.length) applied.push(name);
    } catch (error) {
      if (!tx.closed) await tx.rollback();
      throw error;
    } finally {
      tx.close();
    }
  }
  return applied;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken)
    throw new Error(
      "Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for the target database.",
    );
  const client = createClient({ url, authToken });
  try {
    const applied = await migrateVercelDatabase(client);
    console.log(
      applied.length
        ? "Applied: " + applied.join(", ")
        : "Database migrations are up to date.",
    );
  } finally {
    client.close();
  }
}
