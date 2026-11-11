import { existsSync } from "node:fs";
import { setTimeout as wait } from "node:timers/promises";

if (existsSync(".env")) process.loadEnvFile(".env");
const secret = process.env.SIGNALDESK_WORKER_SECRET || "";
if (secret.length < 32)
  throw new Error(
    "Set SIGNALDESK_WORKER_SECRET to a random value of at least 32 characters in the app and worker.",
  );
const origin = new URL(process.env.APP_ORIGIN || "http://localhost:5173");
if (
  origin.protocol !== "https:" &&
  !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
)
  throw new Error("Use HTTPS or localhost.");
const target = new URL("/api/worker/tick", origin);
let stopping = false;
process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});
do {
  let delay = 10000;
  try {
    const response = await fetch(target, {
      method: "POST",
      redirect: "error",
      headers: { Authorization: "Bearer " + secret },
      signal: AbortSignal.timeout(110000),
    });
    if (!response.ok) throw new Error("Tick returned HTTP " + response.status);
    const result = await response.json();
    if (result.processed) delay = 500;
  } catch (error) {
    console.error(
      "Worker tick failed:",
      error instanceof Error ? error.message : "Request failed",
    );
    delay = 30000;
    if (process.argv.includes("--once")) process.exitCode = 1;
  }
  if (process.argv.includes("--once") || stopping) break;
  await wait(delay);
} while (!stopping);
