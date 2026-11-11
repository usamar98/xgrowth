import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const settings = JSON.parse(await readFile("vercel.json", "utf8"));
const readManifest = async (name) =>
  JSON.parse(await readFile(join(settings.outputDirectory, name), "utf8"));

const routes = await readManifest("routes-manifest.json");
assert.ok(
  routes.dynamicRoutes.some((route) => route.page === "/app/[section]"),
  "Expected the workspace route in the native Next.js routing manifest",
);

const pages = await readManifest("server/app-paths-manifest.json");
for (const route of [
  "/page",
  "/app/[section]/page",
  "/signin-with-chatgpt/route",
  "/signout-with-chatgpt/route",
  "/api/workspace/route",
  "/api/worker/tick/route",
]) {
  assert.ok(pages[route], `Missing ${route} in the Next.js server bundle`);
}
console.log("Verified Next.js output for the workspace and API routes.");
