import {
  createClient,
  type Client,
  type InValue,
  type ResultSet,
} from "@libsql/client/web";

function asResult(result: ResultSet, sql: string) {
  const results = result.rows.map((row) =>
    Object.fromEntries(result.columns.map((name, index) => [name, row[index]])),
  );
  // SQLite RETURNING emits one row per direct change. Some libSQL transports
  // report zero affected rows for statements that return result columns.
  const returning = result.columns.length > 0 && /^\s*(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql);
  return {
    results,
    success: true,
    meta: {
      changes: returning ? results.length : result.rowsAffected,
      last_row_id: Number(result.lastInsertRowid ?? 0),
    },
  };
}

// Keep the statement immutable. The queue reuses the same SQL with different
// bound values and relies on batch rollback when any statement fails.
class Statement {
  constructor(
    readonly client: Client,
    readonly sql: string,
    readonly args: InValue[] = [],
  ) {}

  bind(...values: InValue[]) {
    return new Statement(this.client, this.sql, values);
  }

  async all() {
    return asResult(
      await this.client.execute({ sql: this.sql, args: this.args }),
      this.sql,
    );
  }

  run() {
    return this.all();
  }

  async first(column?: string) {
    const row = (await this.all()).results[0];
    if (!row) return null;
    if (column === undefined) return row;
    if (!Object.hasOwn(row, column)) throw new Error("Unknown result column");
    return row[column];
  }

  async raw(options?: { columnNames?: boolean }) {
    const result = await this.client.execute({
      sql: this.sql,
      args: this.args,
    });
    const rows = result.rows.map((row) =>
      result.columns.map((_, index) => row[index]),
    );
    return options?.columnNames ? [result.columns, ...rows] : rows;
  }
}

export function createVercelDatabase(client: Client) {
  const db = {
    prepare(sql: string) {
      return new Statement(client, sql);
    },
    async batch(statements: Statement[]) {
      if (!statements.length) return [];
      const batch = statements.map((stmt) => {
        if (stmt.client !== client)
          throw new Error("Statement belongs to another database");
        return { sql: stmt.sql, args: stmt.args };
      });
      const results = await client.batch(batch, "write");
      return results.map((result, index) => asResult(result, batch[index].sql));
    },
  };
  // The shared application services consume these two D1 operations.
  return db as unknown as Pick<D1Database, "prepare" | "batch">;
}

let cached:
  | {
      url: string;
      token: string;
      database: ReturnType<typeof createVercelDatabase>;
    }
  | undefined;

export function getVercelDatabase() {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  const token = process.env.TURSO_AUTH_TOKEN?.trim();
  if (!url || !token) return undefined;
  if (!cached || cached.url !== url || cached.token !== token) {
    const database = createVercelDatabase(
      createClient({ url, authToken: token, intMode: "number" }),
    );
    cached = { url, token, database };
  }
  return cached.database;
}
