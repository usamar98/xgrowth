"use client";
import { useEffect, useState } from "react";
import {
  Activity,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Eye,
  Pause,
  Play,
  Plus,
} from "lucide-react";
import {
  api,
  dateLabel,
  money,
  type Costs,
  type DeskWorkspace,
  type QueueData,
  type QueueJob,
} from "@/lib/dashboard-types";
import { localInstants, localKey } from "@/lib/local-time";
import { QueueReview } from "./queue-review";
import { QueueSlots } from "./queue-slots";
import { Dialog, Empty, Pill } from "./desk-ui";
import { AccountSettings, AnalyticsPage } from "./settings-analytics";
import { AutomationPage, RuleActivity } from "./rules-ui";
export type OpsProps = {
  view: string;
  ws: DeskWorkspace | null;
  queue: QueueData | null;
  costs: Costs | null;
  refresh: () => Promise<void>;
  go: (view: string, id?: string) => void;
  toast: (s: string) => void;
  pause: () => void;
  onSchedule: (id: string) => void;
};
type Plan = {
  kind: string;
  target_id: string | null;
  text: string;
  estimate: number;
};
export function ScheduleDialog({
  id,
  ws,
  job,
  onClose,
  done,
}: {
  id: string;
  ws: DeskWorkspace;
  job?: QueueJob;
  onClose: () => void;
  done: () => void;
}) {
  const draft = ws.drafts.find((d) => d.id === id),
    zone = job?.timezone || ws.settings.timezone || "Asia/Karachi";
  const [when, setWhen] = useState(() =>
      localKey(job?.run_at || new Date(Date.now() + 3600000), zone),
    ),
    [fold, setFold] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false),
    [mode, setMode] = useState("later"),
    [plan, setPlan] = useState<Plan | null>(null);
  const account = ws.accounts.find((a) => a.id === draft?.account_id);
  const instants = localInstants(when, zone);
  useEffect(() => {
    let current = true;
    if (!draft || !account) return;
    api<Plan>("/api/desk/plan", "POST", {
      draft_id: id,
      revision: draft.revision,
      account_id: account.id,
    })
      .then((p) => {
        if (current) setPlan(p);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, [id, draft?.revision, account?.id, draft, account]);
  async function save() {
    if (!draft || !account || !confirm || !plan) return;
    const instant =
      mode === "now"
        ? new Date().toISOString()
        : instants.length === 1
          ? instants[0]
          : fold;
    if (mode === "later" && (!instant || !instants.includes(instant)))
      return setError(
        instants.length
          ? "Choose which occurrence of this time to use."
          : "This local time does not exist in the selected timezone.",
      );
    if (mode === "later" && Date.parse(instant) <= new Date().getTime())
      return setError("Choose a future time.");
    setBusy(true);
    setError("");
    try {
      await api("/api/queue", "POST", {
        action: job ? "reschedule" : "schedule",
        ...(job ? { job_id: job.id } : { draft_id: id }),
        revision: draft.revision,
        account_id: account.id,
        confirm: true,
        run_at: instant,
        timezone: zone,
      });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={job ? "Reschedule approved post" : "Review delivery"}
      onClose={onClose}
    >
      <div className="fields">
        {draft ? (
          <>
            <p className="form-hint">
              Review revision {draft.revision} and its destination before
              approving.
            </p>
            <div className="quote-preview">{plan?.text || draft.text}</div>
            <strong>
              {account
                ? "@" + account.username
                : "Choose a connected account in the composer first."}
            </strong>
            {plan?.target_id && (
              <a
                className="text-link"
                href={"https://x.com/i/status/" + plan.target_id}
                target="_blank"
                rel="noreferrer"
              >
                Reply to original post {plan.target_id}
              </a>
            )}
            {plan && (
              <p className="form-hint">
                Estimated write cost {money(plan.estimate)}
                {plan.kind === "reply" ? " plus a target lookup" : ""}.
              </p>
            )}
            {!job && (
              <label>
                Delivery
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="later">Schedule for later</option>
                  <option value="now">As soon as the worker is ready</option>
                </select>
              </label>
            )}
            {mode === "later" && (
              <QueueSlots
                zone={zone}
                accountId={account?.id}
                choose={(value) => {
                  setWhen(value);
                  setFold("");
                }}
              />
            )}
            {mode === "later" && (
              <label>
                Publish time ({zone})
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => {
                    setWhen(e.target.value);
                    setFold("");
                  }}
                />
              </label>
            )}
            {mode === "later" && instants.length > 1 && (
              <label>
                This time occurs twice
                <select value={fold} onChange={(e) => setFold(e.target.value)}>
                  <option value="">Select UTC time</option>
                  {instants.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
            )}
            <label style={{ display: "flex", gap: 8 }}>
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              I approve this content, destination, and delivery time.
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button
              className="btn primary"
              onClick={save}
              disabled={busy || !plan || !account || !confirm}
            >
              {busy
                ? "Saving…"
                : job
                  ? "Confirm new time"
                  : mode === "now"
                    ? "Approve for delivery"
                    : "Approve and schedule"}
            </button>
          </>
        ) : (
          <p>Loading the saved revision…</p>
        )}
      </div>
    </Dialog>
  );
}
function JobList({
  jobs,
  zone,
  act,
  move,
}: {
  jobs: QueueJob[];
  zone: string;
  act?: (id: string) => void;
  move?: (job: QueueJob) => void;
}) {
  return (
    <div className="data-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Content</th>
            <th>Delivery</th>
            <th>Scheduled time</th>
            <th>Estimate</th>
            {act && <th />}
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                <strong>{j.text.slice(0, 110)}</strong>
                {j.detail && <p className="muted">{j.detail}</p>}
                {j.post_id && (
                  <a
                    href={"https://x.com/i/status/" + j.post_id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View published post
                  </a>
                )}
              </td>
              <td>
                <Pill tone={j.status === "published" ? "green" : ""}>
                  {j.status.replaceAll("_", " ")}
                </Pill>
              </td>
              <td>{dateLabel(j.run_at, zone)}</td>
              <td>
                {Number.isFinite(j.estimated_micros)
                  ? money(j.estimated_micros)
                  : "Unavailable"}
              </td>
              {act && (
                <td>
                  {j.status === "scheduled" && (
                    <>
                      {move && (
                        <button className="text-link" onClick={() => move(j)}>
                          Reschedule
                        </button>
                      )}
                      <button className="text-link" onClick={() => act(j.id)}>
                        Cancel
                      </button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function CalendarPage({
  ws,
  queue,
  go,
  toast,
  refresh,
  pause,
  onSchedule,
}: OpsProps) {
  const zone = ws?.settings.timezone || "Asia/Karachi";
  const [focus, setFocus] = useState(() =>
      localKey(new Date(), zone).slice(0, 10),
    ),
    [mode, setMode] = useState("Week"),
    [batch, setBatch] = useState(false),
    [pick, setPick] = useState(false),
    [moving, setMoving] = useState<QueueJob | null>(null);
  const jobs = queue?.jobs || [],
    day = new Date(focus + "T12:00:00Z"),
    offset = (day.getUTCDay() + 6) % 7;
  const dateAt = (d: Date, delta: number) =>
    new Date(d.getTime() + delta * 86400000);
  const firstOfMonth = new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1, 12),
  );
  const start =
    mode === "Day"
      ? day
      : mode === "Week"
        ? dateAt(day, -offset)
        : dateAt(firstOfMonth, -((firstOfMonth.getUTCDay() + 6) % 7));
  const cells = Array.from(
    {
      length:
        mode === "Day"
          ? 1
          : mode === "Week"
            ? 7
            : Math.ceil(
                (((firstOfMonth.getUTCDay() + 6) % 7) +
                  new Date(
                    Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0),
                  ).getUTCDate()) /
                  7,
              ) * 7,
    },
    (_, i) => dateAt(start, i),
  );
  const today = localKey(new Date(), zone).slice(0, 10);
  const shift = (direction: number) => {
    const next =
      mode === "Month"
        ? new Date(
            Date.UTC(
              day.getUTCFullYear(),
              day.getUTCMonth() + direction,
              1,
              12,
            ),
          )
        : dateAt(day, direction * (mode === "Day" ? 1 : 7));
    setFocus(next.toISOString().slice(0, 10));
  };
  const cancel = async (id: string) => {
    try {
      await api("/api/queue", "POST", { action: "cancel", job_id: id });
      await refresh();
      toast("Scheduled job canceled.");
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const planned =
    ws?.drafts.filter((d) => d.planned_at && d.status === "planned") || [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Calendar & queue</h1>
          <p>Plan drafts and review approved delivery times in {zone}.</p>
        </div>
        <button className="btn primary" onClick={() => setPick(true)}>
          <Plus size={16} />
          Schedule
        </button>
      </div>
      <div className="ops-stack">
        <section className="panel">
          <div className="panel-header">
            <div className="calendar-toolbar">
              <button
                className="icon-btn"
                aria-label="Previous period"
                onClick={() => shift(-1)}
              >
                <ChevronLeft size={16} />
              </button>
              <strong>
                {dateLabel(day.toISOString(), "UTC", {
                  month: "long",
                  year: "numeric",
                  ...(mode === "Day" ? { day: "numeric" } : {}),
                })}
              </strong>
              <button
                className="icon-btn"
                aria-label="Next period"
                onClick={() => shift(1)}
              >
                <ChevronRight size={16} />
              </button>
              <button className="btn small" onClick={() => setFocus(today)}>
                Today
              </button>
            </div>
            <div className="segmented">
              {["Day", "Week", "Month"].map((m) => (
                <button
                  className={mode === m ? "active" : ""}
                  onClick={() => setMode(m)}
                  key={m}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div
            className="calendar-grid"
            style={mode === "Day" ? { gridTemplateColumns: "1fr" } : undefined}
          >
            {(mode === "Day"
              ? [dateLabel(day.toISOString(), "UTC", { weekday: "long" })]
              : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
            ).map((s) => (
              <div className="calendar-label" key={s}>
                {s}
              </div>
            ))}
            {cells.map((d) => {
              const key = d.toISOString().slice(0, 10);
              return (
                <div
                  key={key}
                  className={
                    key === today
                      ? "today"
                      : d.getUTCMonth() !== day.getUTCMonth()
                        ? "dim"
                        : ""
                  }
                >
                  <b>{d.getUTCDate()}</b>
                  {jobs
                    .filter((j) => localKey(j.run_at, zone).startsWith(key))
                    .map((j) => (
                      <span
                        key={j.id}
                        className="calendar-entry"
                        title={j.text}
                      >
                        {j.text}
                      </span>
                    ))}
                  {planned
                    .filter((p) =>
                      localKey(p.planned_at!, zone).startsWith(key),
                    )
                    .map((p) => (
                      <button
                        className="calendar-entry"
                        key={p.id}
                        onClick={() => go("compose", p.id)}
                      >
                        Plan · {p.text}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <CalendarClock size={17} />
              <h2>Delivery queue</h2>
            </span>
            <div className="btn-row">
              <button className="text-link" onClick={() => setBatch(true)}>
                <Eye size={14} />
                Dry run
              </button>
              <button className="btn small" disabled={!queue} onClick={pause}>
                {queue?.paused ? <Play size={13} /> : <Pause size={13} />}
                {queue?.paused ? "Resume" : "Pause all"}
              </button>
            </div>
          </div>
          {jobs.length ? (
            <JobList jobs={jobs} zone={zone} act={cancel} move={setMoving} />
          ) : (
            <Empty
              icon={CalendarClock}
              title="No approved jobs"
              text="Save a draft, review its exact text, and choose a publish time."
            />
          )}
        </section>
      </div>
      {moving && ws && (
        <ScheduleDialog
          id={moving.draft_id}
          job={moving}
          ws={ws}
          onClose={() => setMoving(null)}
          done={async () => {
            setMoving(null);
            await refresh();
            toast("Publish time updated.");
          }}
        />
      )}
      {pick && (
        <Dialog title="Choose a saved draft" onClose={() => setPick(false)}>
          <div className="simple-list">
            {ws?.drafts
              .filter((d) =>
                ["draft", "planned", "pending_review"].includes(d.status),
              )
              .map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setPick(false);
                    onSchedule(d.id);
                  }}
                >
                  <b>{d.text}</b>
                  <ChevronRight size={15} />
                </button>
              ))}
            {!ws?.drafts.length && (
              <Empty
                title="Create a draft first"
                action={
                  <button className="btn primary" onClick={() => go("compose")}>
                    Open composer
                  </button>
                }
              />
            )}
          </div>
        </Dialog>
      )}
      {batch && (
        <Dialog title="Queue dry run" onClose={() => setBatch(false)}>
          <div className="fields">
            <p className="form-hint">
              Read-only preview. The worker checks connection, policy, account,
              revision, and budget again at execution.
            </p>
            <div className="metric-row">
              <span>Publishing</span>
              <b>{queue?.paused ? "Paused" : "Ready"}</b>
            </div>
            {jobs
              .filter((j) => j.status === "scheduled")
              .map((j) => (
                <div className="metric-row" key={j.id}>
                  <span>{j.text.slice(0, 70)}</span>
                  <b>{money(j.estimated_micros)}</b>
                </div>
              ))}
            {!jobs.some((j) => j.status === "scheduled") && (
              <p>No scheduled actions.</p>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
function CostsPage({ costs, refresh, toast }: OpsProps) {
  const [entry, setEntry] = useState(""),
    [reference, setReference] = useState(""),
    [actual, setActual] = useState("");
  const [day, setDay] = useState(String((costs?.daily_budget || 0) / 1e6)),
    [month, setMonth] = useState(String((costs?.monthly_budget || 0) / 1e6));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api("/api/costs", "PATCH", {
        daily_budget: Math.round(Number(day) * 1e6),
        monthly_budget: Math.round(Number(month) * 1e6),
      });
      await refresh();
      toast("Budget limits saved.");
    } catch (err) {
      toast((err as Error).message);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Costs & usage</h1>
          <p>
            Usage estimates and spending limits in USD. Provider billing is
            reconciled separately.
          </p>
        </div>
      </div>
      <div className="ops-stack">
        <div className="ops-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>Usage summary</h2>
            </div>
            <div className="box-body">
              <div className="metric-row">
                <span>Today</span>
                <b>{costs ? money(costs.day_micros) : "Unavailable"}</b>
              </div>
              <div className="metric-row">
                <span>This month</span>
                <b>{costs ? money(costs.month_micros) : "Unavailable"}</b>
              </div>
              <div className="metric-row">
                <span>Provider invoice</span>
                <b>Unavailable</b>
              </div>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Spending limits</h2>
            </div>
            <form className="box-body fields" onSubmit={save}>
              <label>
                Daily allowance (USD)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step=".000001"
                  required
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                />
              </label>
              <label>
                Monthly allowance (USD)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step=".000001"
                  required
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                />
              </label>
              <button disabled={!costs} className="btn">
                Save limits
              </button>
            </form>
          </section>
        </div>
        <section className="panel">
          <div className="panel-header">
            <h2>Usage ledger</h2>
          </div>
          {costs?.entries.length ? (
            <div className="data-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Operation</th>
                    <th>Category</th>
                    <th>State</th>
                    <th>USD</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {costs.entries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.operation}</td>
                      <td>{e.category}</td>
                      <td>{e.state}</td>
                      <td>{e.micros == null ? "Unknown" : money(e.micros)}</td>
                      <td>
                        {["recorded", "unknown", "reconciled"].includes(
                          e.state,
                        ) && (
                          <button
                            className="text-link"
                            onClick={() => {
                              setEntry(e.id);
                              setActual(String(e.micros / 1e6));
                              setReference("");
                            }}
                          >
                            Reconcile
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty
              icon={CircleDollarSign}
              title="No usage events"
              text="Reservations and recorded estimates appear after a metered operation."
            />
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <h2>X reference rates</h2>
          </div>
          <div className="box-body">
            {costs?.rates.map((r) => (
              <div className="metric-row" key={r.operation}>
                <span>{r.operation.replaceAll("_", " ")}</span>
                <b>{r.micros === null ? "Unknown" : money(r.micros)}</b>
              </div>
            ))}
            <p className="form-hint">
              <a
                href="https://docs.x.com/x-api/getting-started/pricing"
                target="_blank"
                rel="noreferrer"
              >
                X API pricing
              </a>{" "}
              · Estimates depend on operation and account eligibility.
            </p>
          </div>
        </section>
      </div>
      {entry && (
        <Dialog title="Reconcile usage entry" onClose={() => setEntry("")}>
          <form
            className="fields"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api("/api/costs", "POST", {
                  id: entry,
                  micros: Math.round(Number(actual) * 1e6),
                  reference,
                });
                setEntry("");
                await refresh();
                toast("Provider charge recorded.");
              } catch (err) {
                toast((err as Error).message);
              }
            }}
          >
            <label>
              Provider charge (USD)
              <input
                required
                type="number"
                step="0.000001"
                min="0"
                value={actual}
                onChange={(e) => setActual(e.target.value)}
              />
            </label>
            <label>
              Billing reference
              <input
                required
                minLength={3}
                maxLength={160}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </label>
            <button className="btn primary">Save reconciliation</button>
          </form>
        </Dialog>
      )}
    </>
  );
}
export function Operations(props: OpsProps) {
  switch (props.view) {
    case "calendar":
      return (
        <>
          <CalendarPage {...props} />
          <QueueSlots zone={props.ws?.settings.timezone || "Asia/Karachi"} />
        </>
      );
    case "costs":
      return <CostsPage {...props} />;
    case "settings":
      return <AccountSettings {...props} />;
    case "analytics":
      return <AnalyticsPage {...props} />;
    case "automations":
      return <AutomationPage {...props} />;
    default:
      return (
        <>
          <div className="page-heading">
            <div>
              <h1>Activity</h1>
              <p>
                Delivery outcomes and local rule history for this workspace.
              </p>
            </div>
          </div>
          <div className="ops-stack">
            <section className="panel">
              <div className="panel-header">
                <h2>Publishing history</h2>
              </div>
              {props.queue?.jobs.length ? (
                <JobList
                  jobs={props.queue.jobs}
                  zone={props.ws?.settings.timezone || "Asia/Karachi"}
                />
              ) : (
                <Empty
                  icon={Activity}
                  title="No delivery activity yet"
                  text="Each approved job will appear here with its outcome."
                />
              )}
            </section>
            <RuleActivity />
            <QueueReview
              ws={props.ws}
              queue={props.queue}
              refresh={props.refresh}
            />
          </div>
        </>
      );
  }
}
