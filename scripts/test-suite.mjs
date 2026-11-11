import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
const suites = readdirSync("scripts")
  .filter((n) => /^test-.+\.mjs$/.test(n) && n !== "test-suite.mjs")
  .sort();
for (const file of suites) {
  console.log("\n" + file);
  const result = spawnSync(process.execPath, ["scripts/" + file], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
