import assert from "node:assert/strict";

// Network fixtures live only inside this isolated browser context. No provider write is reachable.
export async function verifyFixtureViews(browser, origin) {
  const ctx = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 850 },
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  const account = {
    id: crypto.randomUUID(),
    username: "fixture_owner",
    name: "Fixture owner",
    health: "connected",
    granted_scopes: "tweet.read tweet.write users.read offline.access",
  };
  const now = new Date().toISOString();
  const draft = {
    id: crypto.randomUUID(),
    revision: 1,
    kind: "post",
    provenance: "manual",
    target_id: null,
    status: "draft",
    account_id: account.id,
    text: "A reviewed fixture for the scheduling flow.",
    pillar: "Teach",
    parts: [],
    tags: [],
    knowledge_ids: [],
    voice_id: null,
    campaign_id: null,
    folder: "",
    intent: "answer",
    created_at: now,
    updated_at: now,
  };
  const item = {
    account_id: account.id,
    post_id: "20000002",
    author_id: "20000003",
    author_name: "Fixture author",
    author_username: "fixture_author",
    text:
      "Could you explain your release notes? " +
      "Additional context. ".repeat(35),
    created_at: now,
    fetched_at: now,
    source: "mention",
    status: "open",
    opt_out: 0,
    note: "",
    labels: [],
    campaign_id: null,
    snoozed_until: null,
  };
  const ws = {
    accounts: [account],
    settings: {
      timezone: "Asia/Karachi",
      weekly_target: 3,
      budget: 1000000,
      audience: "",
      topics: "",
    },
    drafts: [draft],
    usage: 0,
    configured: true,
    missing: [],
  };
  const jobs = [],
    drafts = [draft];
  let writes = 0,
    replySaves = 0;
  await ctx.route("**/api/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    const reply = (json, status = 200) => route.fulfill({ status, json });
    if (path === "/api/workspace") return reply({ ...ws, drafts });
    if (path === "/api/queue" && method === "GET")
      return reply({ jobs, paused: false });
    if (path === "/api/desk/summary")
      return reply({
        mentions: 1,
        saved: 0,
        rules: 0,
        eligible: 0,
        profile: null,
      });
    if (path === "/api/costs")
      return reply({
        month_micros: 0,
        day_micros: 0,
        monthly_budget: 1000000,
        daily_budget: 1000000,
        entries: [],
        rates: [],
      });
    if (path === "/api/creative" && url.searchParams.has("target"))
      return reply({
        state: "unknown",
        reason: "Fixture evidence has expired. Use native X.",
      });
    if (path === "/api/creative")
      return reply({
        entries: [],
        drafts,
        accounts: [account],
        items: [item],
        ai: false,
      });
    if (path === "/api/drafts" && method === "GET") return reply({ drafts });
    if (path === "/api/drafts" && ["POST", "PATCH"].includes(method)) {
      const p = req.postDataJSON();
      const id = p.id || crypto.randomUUID();
      replySaves++;
      drafts.push({ ...draft, ...p, id, revision: 1 });
      return reply({ id, revision: 1 });
    }
    if (path === "/api/desk/media") return reply({ items: [] });
    if (path === "/api/desk/plan" && method === "GET")
      return reply({ slots: [] });
    if (path === "/api/desk/plan")
      return reply({
        kind: "post",
        target_id: null,
        text: draft.text,
        estimate: 15000,
      });
    if (path === "/api/queue" && method === "POST") {
      const p = req.postDataJSON();
      assert.equal(p.action, "schedule");
      assert.equal(p.revision, 1);
      assert.equal(p.account_id, account.id);
      assert.equal(p.confirm, true);
      jobs.push({
        id: crypto.randomUUID(),
        draft_id: draft.id,
        account_id: account.id,
        revision: 1,
        text: draft.text,
        status: "scheduled",
        kind: "post",
        timezone: p.timezone,
        estimated_micros: 15000,
        run_at: p.run_at,
        created_at: now,
      });
      writes++;
      return reply({ status: "scheduled" });
    }
    return reply({ error: "Unconfigured fixture route" }, 404);
  });
  try {
    await page.goto("/app/calendar");
    await page.getByRole("button", { name: "Schedule", exact: true }).click();
    await page.getByRole("button", { name: draft.text }).click();
    await page.getByText("Estimated write cost", { exact: false }).waitFor();
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Approve and schedule" }).click();
    await page.getByText("Approved version added to the queue.").waitFor();
    assert.equal(writes, 1);
    await page.getByRole("link", { name: "Engage", exact: true }).click();
    await page
      .getByText("Fixture evidence has expired. Use native X.")
      .waitFor();
    await page
      .getByRole("textbox", { name: "Reply text" })
      .fill("Thank you for asking. Here is a manual reply draft.");
    await page.getByRole("button", { name: "Copy reply" }).click();
    await page.getByText("Copied", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(() => navigator.clipboard.readText()),
      "Thank you for asking. Here is a manual reply draft.",
    );
    assert.equal(
      await page
        .getByRole("link", { name: "Open original on X" })
        .getAttribute("href"),
      "https://x.com/i/web/status/" + item.post_id,
    );
    assert.ok(replySaves > 0);
    assert.equal(
      await page.getByRole("button", { name: "Review & schedule" }).count(),
      0,
    );
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    );
    console.log(
      "PASS isolated browser fixtures: exact-version scheduling, stale reply evidence, copy/native fallback, and long mobile conversation.",
    );
  } finally {
    await ctx.close();
  }
}
