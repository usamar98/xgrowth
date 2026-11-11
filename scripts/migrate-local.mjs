import { spawnSync } from "node:child_process";
import "./sites-env.mjs";
const command = (...args) =>
  spawnSync(
    process.execPath,
    ["node_modules/wrangler/bin/wrangler.js", "d1", ...args],
    { encoding: "utf8", env: { ...process.env, CI: "1" } },
  );
const flags = [
  "--local",
  "--config",
  "wrangler.local.jsonc",
  "--persist-to",
  ".wrangler/state",
];
const result = command("migrations", "apply", "DB", ...flags);
process.stdout.write(result.stdout || "");
process.stderr.write(result.stderr || "");
process.exitCode = result.status ?? 1;
