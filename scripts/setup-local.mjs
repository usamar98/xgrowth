import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const file = ".env";
const source = existsSync(file) ? readFileSync(file, "utf8") : "";
const values = {
  APP_ORIGIN: "http://localhost:5173",
  X_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  SIGNALDESK_WORKER_SECRET: randomBytes(32).toString("hex"),
};
const missing = Object.entries(values).filter(
  ([k]) => !new RegExp("^\\s*" + k + "\\s*=", "m").test(source),
);
if (missing.length)
  appendFileSync(
    file,
    "\n" + missing.map(([key, value]) => key + "=" + value).join("\n") + "\n",
    { mode: 0o600 },
  );
console.log("Local environment prepared. Existing values were preserved.");
const run = spawnSync(process.execPath, ["scripts/migrate-local.mjs"], {
  stdio: "inherit",
});
process.exitCode = run.status ?? 1;
