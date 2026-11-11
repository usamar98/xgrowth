import { chromium } from "@playwright/test";
import { verifyFixtureViews } from "./browser-fixtures.mjs";
import assert from "node:assert/strict";
import { mkdirSync, existsSync } from "node:fs";
const origin = new URL(
  process.env.SIGNALDESK_TEST_ORIGIN || "http://localhost:5173",
);
if (!["localhost", "127.0.0.1"].includes(origin.hostname))
  throw Error("Browser checks require a local workspace.");
const dir = ".sites-runtime/browser";
mkdirSync(dir, { recursive: true });
const systemEdge =
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const browser = await chromium.launch({
  headless: true,
  ...(existsSync(systemEdge) ? { executablePath: systemEdge } : {}),
});
const ctx = await browser.newContext({
  baseURL: origin.origin,
  viewport: { width: 1440, height: 1000 },
  reducedMotion: "reduce",
});
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const seed = "SignalDesk browser acceptance " + crypto.randomUUID();
let draftId;
try {
  await page.goto("/");
  await page.getByRole("heading", { name: "Workspace overview" }).waitFor();
  await page.getByRole("link", { name: "Sign in to connect" }).waitFor();
  assert.equal((await ctx.request.get("/api/workspace")).status(), 401);
  await page.getByRole("link", { name: "Sign in to connect" }).click();
  await page
    .getByRole("button", { name: "Set up connection" })
    .waitFor({ timeout: 30000 });
  const workspace = await ctx.request.get("/api/workspace");
  assert.equal(workspace.status(), 200);
  await page.getByText("Queue ready", { exact: true }).waitFor();
  await page.screenshot({
    path: dir + "/overview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "New draft", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Post text", exact: true })
    .fill(seed);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  const saved = await page.waitForFunction(
    async (value) => {
      const r = await fetch("/api/drafts");
      const data = await r.json();
      return data.drafts?.find((d) => d.text === value)?.id || false;
    },
    seed,
    { timeout: 10000 },
  );
  draftId = await saved.jsonValue();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("dialog", { name: "Revision history" }).waitFor();
  await page.keyboard.press("Escape");
  await page
    .getByRole("link", { name: "Drafts", exact: false })
    .first()
    .click();
  await page.getByText(seed, { exact: false }).first().waitFor();
  await page
    .getByRole("link", { name: "Calendar & queue", exact: true })
    .click();
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await page.getByRole("button", { name: "Dry run", exact: true }).click();
  await page.getByRole("dialog", { name: "Queue dry run" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Engage", exact: true }).click();
  await page.getByRole("heading", { name: "Inbox views" }).waitFor();
  await page.getByRole("button", { name: "Saved", exact: true }).click();
  await page.screenshot({ path: dir + "/inbox-desktop.png", fullPage: true });
  await page.getByRole("link", { name: "Costs & usage", exact: true }).click();
  await page.getByRole("heading", { name: "Spending limits" }).waitFor();
  for (const id of [
    "campaigns",
    "voice",
    "inspiration",
    "automations",
    "analytics",
    "activity",
    "settings",
  ]) {
    await page.goto("/app/" + id);
    await page.locator("main h1").first().waitFor();
    await page.waitForTimeout(150);
    assert.equal(
      await page.getByRole("alert").count(),
      0,
      "Unexpected alert on " + id,
    );
  }
  await page.goto(
    "/app/settings?connection_error=Authorization%20declined%20during%20fixture",
  );
  await page
    .getByText("Authorization declined during fixture", { exact: true })
    .waitFor();
  await page.goto("/app/overview");
  await page.getByText("Queue ready", { exact: true }).waitFor();
  await page.keyboard.press("Control+k");
  await page.getByRole("dialog", { name: "Search workspace" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.screenshot({ path: dir + "/overview-dark.png", fullPage: true });
  await page.getByRole("button", { name: "Switch to light theme" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: dir + "/overview-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile overview overflow",
  );
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Engage", exact: true }).click();
  await page.getByRole("heading", { name: "Inbox views" }).waitFor();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "Mobile inbox overflow",
  );
  console.log(
    "PASS private sign-in, connected routes, durable drafts, version history, calendar, reply inbox, costs, search, dark theme and mobile navigation.",
  );
  assert.deepEqual(errors, []);
  await verifyFixtureViews(browser, origin.origin);
} finally {
  const all = await ctx.request
    .get("/api/drafts")
    .then((r) => r.json())
    .catch(() => ({}));
  const draft = all.drafts?.find((d) => d.id === draftId || d.text === seed);
  if (draft)
    await ctx.request.delete("/api/drafts", {
      headers: { origin: origin.origin },
      data: { id: draft.id, revision: draft.revision },
    });
  await browser.close();
}
