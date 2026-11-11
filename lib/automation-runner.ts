import { database, AppError } from "./server";
import { expireObservations } from "./retention";
import { nextSlot } from "./automation-schedule";
export type Rule = {
  id: string;
  owner: string;
  name: string;
  action: string;
  account_id: string | null;
  source_id: string | null;
  every_days: number;
  local_time: string;
  timezone: string;
  next_run: string;
  enabled: number;
};
export async function rulePreview(rule: Rule) {
  const db = database(),
    week = new Date(Date.now() - 7 * 86400000).toISOString();
  if (rule.action === "release_draft") {
    const source = await db
      .prepare(
        "SELECT title,content FROM creative_entries WHERE owner=? AND id=? AND kind='knowledge'",
      )
      .bind(rule.owner, rule.source_id)
      .first<{ title: string; content: string }>();
    if (!source)
      throw new AppError("The selected knowledge entry is unavailable.");
    return {
      message: "Prepared a release draft from " + source.title + ".",
      text: (source.title + "\n\n" + source.content).slice(0, 4000),
    };
  }
  const count = async (sql: string, params: (string | null)[]) =>
    Number(
      (
        await db
          .prepare(sql)
          .bind(...params)
          .first<{ n: number }>()
      )?.n || 0,
    );
  if (rule.action === "failure_alert") {
    const n = await count(
      "SELECT COUNT(*) n FROM queue_jobs WHERE owner=? AND (? IS NULL OR account_id=?) AND status IN ('blocked','failed','outcome-unknown') AND created_at>=?",
      [rule.owner, rule.account_id, rule.account_id, week],
    );
    return {
      message: n + " publishing jobs need review from the past seven days.",
      text: null,
    };
  }
  const mentions = await count(
    "SELECT COUNT(*) n FROM inbox_items WHERE owner=? AND (? IS NULL OR account_id=?) AND status='open' AND opt_out=0",
    [rule.owner, rule.account_id, rule.account_id],
  );
  if (rule.action === "mention_digest")
    return {
      message: mentions + " unresolved conversations in the imported inbox.",
      text: null,
    };
  const published = await count(
    "SELECT COUNT(*) n FROM queue_jobs WHERE owner=? AND (? IS NULL OR account_id=?) AND status='published' AND updated_at>=?",
    [rule.owner, rule.account_id, rule.account_id, week],
  );
  const drafts = await count(
    "SELECT COUNT(*) n FROM drafts WHERE owner=? AND (? IS NULL OR account_id=?) AND status IN ('draft','planned','pending_review')",
    [rule.owner, rule.account_id, rule.account_id],
  );
  return {
    message:
      "Weekly review · " +
      published +
      " confirmed deliveries in seven days, " +
      drafts +
      " open drafts, " +
      mentions +
      " unresolved conversations.",
    text: null,
  };
}
export async function runDueRules() {
  await expireObservations();
  const db = database(),
    now = new Date(),
    instant = now.toISOString();
  const rules = (
    await db
      .prepare(
        "SELECT r.* FROM desk_rules r WHERE r.enabled=1 AND r.next_run<=? AND NOT EXISTS (SELECT 1 FROM settings q WHERE q.owner=r.owner AND q.actions_paused=1) ORDER BY r.next_run LIMIT 10",
      )
      .bind(instant)
      .all<Rule>()
  ).results;
  for (const r of rules) {
    const runId = crypto.randomUUID(),
      draftId = crypto.randomUUID();
    let preview: { message: string; text: string | null };
    try {
      preview = await rulePreview(r);
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      preview = { message: e.message, text: null };
    }
    const next = nextSlot(now, r.timezone, r.local_time, r.every_days),
      hasDraft = !!preview.text;
    await db.batch([
      db
        .prepare(
          "INSERT OR IGNORE INTO desk_runs(id,owner,rule_id,slot,created_at,message,draft_id) SELECT ?,owner,id,next_run,?,?,? FROM desk_rules WHERE owner=? AND id=? AND next_run=? AND enabled=1 AND (account_id IS NULL OR EXISTS (SELECT 1 FROM accounts WHERE accounts.id=desk_rules.account_id AND accounts.owner=desk_rules.owner)) AND NOT EXISTS(SELECT 1 FROM settings q WHERE q.owner=desk_rules.owner AND q.actions_paused=1)",
        )
        .bind(
          runId,
          instant,
          preview.message,
          hasDraft ? draftId : null,
          r.owner,
          r.id,
          r.next_run,
        ),
      db
        .prepare(
          "INSERT INTO drafts(id,owner,text,pillar,account_id,status,created_at,updated_at) SELECT draft_id,owner,?,'Show',?,'draft',?,? FROM desk_runs WHERE id=? AND draft_id IS NOT NULL AND (SELECT COUNT(*) FROM drafts WHERE owner=?)<500",
        )
        .bind(
          preview.text || "",
          r.account_id,
          instant,
          instant,
          runId,
          r.owner,
        ),
      db
        .prepare(
          "UPDATE desk_runs SET draft_id=NULL,message='Draft capacity reached. Remove an unused draft.' WHERE id=? AND draft_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM drafts WHERE id=desk_runs.draft_id)",
        )
        .bind(runId),
      db
        .prepare(
          "UPDATE desk_rules SET next_run=? WHERE owner=? AND id=? AND next_run=? AND EXISTS(SELECT 1 FROM desk_runs WHERE rule_id=? AND slot=?)",
        )
        .bind(next, r.owner, r.id, r.next_run, r.id, r.next_run),
    ]);
  }
}
