"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Download,
  Link2,
  Plug,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { OpsProps } from "./operations";
import { api, dateLabel, downloadFile, money } from "@/lib/dashboard-types";
import { Empty, Dialog, Pill } from "./desk-ui";
import { WorkflowReport } from "./workflow-report";
import { Experiments } from "./measurements";
import { AccessKeys } from "./rules-ui";
type Post = {
  id: string;
  text: string;
  status: string;
  created_at: string;
  fetched_at: string;
  public_metrics?: Record<string, number> | null;
};
type Owned = {
  posts: Post[];
  profile: {
    name: string;
    username: string;
    public_metrics?: Record<string, number>;
  } | null;
  fetchedAt: string | null;
};
function useOwned(id?: string) {
  const [data, setData] = useState<Owned | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!id) {
      setData(null);
      return;
    }
    try {
      const result = await api<Owned>(
        "/api/x/owned?account_id=" + encodeURIComponent(id),
      );
      setData(result);
      setError("");
    } catch (e) {
      setData(null);
      setError((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  return { data, error, load };
}
function ImportPanel({
  id,
  onUpdate,
  toast,
}: {
  id: string;
  onUpdate: () => void;
  toast: (s: string) => void;
}) {
  const [kind, setKind] = useState("owned"),
    [limit, setLimit] = useState(10),
    [estimate, setEstimate] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ estimate_micros: number }>(
      "/api/x/sync?account_id=" +
        encodeURIComponent(id) +
        "&kind=" +
        kind +
        "&limit=" +
        limit,
    )
      .then((r) => {
        if (active) {
          setEstimate(r.estimate_micros);
          setError("");
        }
      })
      .catch((e) => {
        if (active) {
          setEstimate(null);
          setError(e.message);
        }
      });
    return () => {
      active = false;
    };
  }, [id, kind, limit]);
  const run = async () => {
    setBusy(true);
    try {
      await api("/api/x/sync", "POST", { account_id: id, kind, limit });
      onUpdate();
      toast("Import finished.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fields">
      <label>
        Import source
        <select
          value={kind}
          onChange={(e) => {
            setEstimate(null);
            setKind(e.target.value);
          }}
        >
          <option value="owned">My recent posts</option>
          <option value="mentions">Mentions</option>
        </select>
      </label>
      <label>
        Maximum resources
        <select
          value={limit}
          onChange={(e) => {
            setEstimate(null);
            setLimit(Number(e.target.value));
          }}
        >
          {[5, 10, 20, 30].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </label>
      <div className="metric-row">
        <span>Estimated reservation</span>
        <b>{estimate === null ? "Unavailable" : money(estimate)}</b>
      </div>
      <button
        className="btn"
        disabled={estimate === null || busy}
        onClick={run}
      >
        <RefreshCw size={14} />
        {busy ? "Importing…" : "Confirm import"}
      </button>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function AccountSettings({ ws, refresh, toast }: OpsProps) {
  const account = ws?.accounts[0],
    prefs = ws?.settings;
  const [timezone, setTimezone] = useState(prefs?.timezone || "Asia/Karachi"),
    [audience, setAudience] = useState(prefs?.audience || ""),
    [topics, setTopics] = useState(prefs?.topics || ""),
    [weekly, setWeekly] = useState(prefs?.weekly_target || 3),
    [confirm, setConfirm] = useState(""),
    [phrase, setPhrase] = useState(""),
    [busy, setBusy] = useState(false);
  const [retention, setRetention] = useState(30);
  useEffect(() => {
    api<{ retention_days: number }>("/api/desk/retention")
      .then((d) => setRetention(d.retention_days))
      .catch((e) => toast(e.message));
  }, [toast]);
  const [connectionMessage, setConnectionMessage] = useState("");
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const msg =
      q.get("connection_error") ||
      (q.get("connected") === "1" ? "X account connected." : "");
    if (msg) {
      const task = setTimeout(() => setConnectionMessage(msg.slice(0, 250)), 0);
      history.replaceState(null, "", location.pathname);
      return () => clearTimeout(task);
    }
  }, []);
  const exec = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await exec(async () => {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date());
      await api("/api/workspace", "PATCH", {
        timezone,
        audience,
        topics,
        weekly_target: weekly,
        budget: prefs?.budget || 0,
      });
      await refresh();
      toast("Preferences saved.");
    });
  };
  const connect = () =>
    exec(async () => {
      const r = await api<{ url: string }>("/api/x/connect", "POST", {});
      const dest = new URL(r.url);
      if (dest.origin !== "https://x.com")
        throw new Error("Unexpected authorization destination.");
      location.assign(dest.href);
    });
  const accept = () =>
    exec(async () => {
      if (confirm === "disconnect") {
        await api("/api/x/disconnect", "POST", { account_id: account?.id });
      } else {
        await api("/api/workspace", "DELETE", { confirm: "DELETE" });
      }
      await refresh();
      setConfirm("");
      setPhrase("");
      toast(
        confirm === "disconnect"
          ? "Account disconnected."
          : "Workspace data removed.",
      );
    });
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
          <p>
            Manage your X connection, writing preferences, and private
            workspace.
          </p>
        </div>
        <a className="btn small" href="/signout-with-chatgpt?return_to=/">
          Sign out
        </a>
      </div>
      <div className="ops-stack">
        {connectionMessage && (
          <div className="notice" role="status">
            {connectionMessage}
          </div>
        )}
        <div className="ops-grid">
          <section className="panel">
            <div className="panel-header">
              <span className="panel-title">
                <Link2 size={17} />
                <h2>X connection</h2>
              </span>
              <Pill tone={account ? "green" : ""}>
                {account ? "Connected" : "Disconnected"}
              </Pill>
            </div>
            <div className="box-body fields">
              {account ? (
                <>
                  <h3>
                    {account.name} · @{account.username}
                  </h3>
                  <p className="form-hint">
                    Scopes:{" "}
                    {String(account.granted_scopes || "Reconnection required")}
                  </p>
                  <p className="form-hint">
                    Last sync:{" "}
                    {account.last_sync
                      ? dateLabel(account.last_sync, timezone)
                      : "Unavailable"}
                  </p>
                  {(account.health !== "connected" ||
                    !account.granted_scopes) && (
                    <button
                      disabled={!ws?.configured || busy}
                      className="btn primary"
                      onClick={connect}
                    >
                      Reconnect with X
                    </button>
                  )}
                  <button
                    className="btn small"
                    onClick={() => setConfirm("disconnect")}
                  >
                    Disconnect account
                  </button>
                </>
              ) : (
                <>
                  <h3>Connect your X developer app</h3>
                  <p className="form-hint">
                    Register your callback, configure the server credentials,
                    then authorize your account on X.
                  </p>
                  <div className="quote-preview mono">
                    APP_ORIGIN/api/x/callback
                  </div>
                  {!!ws?.missing?.length && (
                    <p className="form-hint">
                      Server configuration required: {ws.missing.join(", ")}
                    </p>
                  )}
                  <button
                    className="btn primary"
                    disabled={!ws?.configured || busy}
                    onClick={connect}
                  >
                    <Link2 size={14} />
                    Connect with X
                  </button>
                </>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <h2>Bounded import</h2>
            </div>
            <div className="box-body">
              {account ? (
                <ImportPanel id={account.id} onUpdate={refresh} toast={toast} />
              ) : (
                <Empty
                  icon={Plug}
                  title="Connect an account to import"
                  text="Choose a source and review its estimated cost before fetching posts."
                />
              )}
            </div>
          </section>
        </div>
        <div className="ops-grid">
          <section className="panel">
            <div className="panel-header">
              <h2>Workspace preferences</h2>
            </div>
            <form className="box-body fields" onSubmit={save}>
              <label>
                Local timezone
                <input
                  value={timezone}
                  list="timezones"
                  onChange={(e) => setTimezone(e.target.value)}
                  required
                />
                <datalist id="timezones">
                  {[
                    "Asia/Karachi",
                    "UTC",
                    "America/New_York",
                    "America/Los_Angeles",
                    "Europe/London",
                    "Asia/Singapore",
                    "Australia/Sydney",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </datalist>
              </label>
              <label>
                Audience
                <input
                  maxLength={200}
                  value={audience}
                  placeholder="Who do you write for?"
                  onChange={(e) => setAudience(e.target.value)}
                />
              </label>
              <label>
                Writing topics
                <textarea
                  maxLength={400}
                  value={topics}
                  onChange={(e) => setTopics(e.target.value)}
                />
              </label>
              <label>
                Weekly writing goal
                <input
                  type="number"
                  min="1"
                  max="14"
                  value={weekly}
                  onChange={(e) => setWeekly(Number(e.target.value))}
                />
              </label>
              <button className="btn" disabled={busy}>
                Save preferences
              </button>
            </form>
          </section>
          <section className="panel">
            <div className="panel-header">
              <span className="panel-title">
                <ShieldCheck size={17} />
                <h2>Data & privacy</h2>
              </span>
            </div>
            <div className="box-body fields">
              <p className="form-hint">
                Export your saved content, public metric snapshots, and usage
                history. Credentials are excluded. Removing workspace data also
                stops queued actions.
              </p>
              <button
                className="btn"
                onClick={() =>
                  exec(async () => {
                    const result = await api("/api/desk/export");
                    downloadFile(
                      "signaldesk-workspace.json",
                      JSON.stringify(result, null, 2),
                    );
                  })
                }
              >
                <Download size={14} />
                Export workspace
              </button>
              <label>
                Keep imported observations (days)
                <input
                  type="number"
                  min="7"
                  max="365"
                  value={retention}
                  onChange={(e) => setRetention(Number(e.target.value))}
                />
              </label>
              <button
                className="btn"
                onClick={() =>
                  exec(async () => {
                    await api("/api/desk/retention", "PATCH", {
                      days: retention,
                    });
                    toast("Retention period saved.");
                  })
                }
              >
                Save retention
              </button>
              <button
                className="btn danger"
                onClick={() => setConfirm("delete")}
              >
                Remove workspace data
              </button>
            </div>
          </section>
        </div>
        <AccessKeys toast={toast} />
      </div>
      {confirm && (
        <Dialog
          title={
            confirm === "disconnect"
              ? "Disconnect @" + account?.username + "?"
              : "Remove workspace data?"
          }
          onClose={() => setConfirm("")}
        >
          <div className="fields">
            <p>
              {confirm === "disconnect"
                ? "Future queued actions will stop. A request already in flight may still complete."
                : "This removes saved drafts, connections, and local content. Export anything you want to keep before continuing. Billing reservation totals may be retained."}
            </p>
            {confirm === "delete" && (
              <label>
                Type DELETE to confirm
                <input
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                />
              </label>
            )}
            <button
              className="btn danger"
              disabled={busy || (confirm === "delete" && phrase !== "DELETE")}
              onClick={accept}
            >
              {confirm === "disconnect"
                ? "Disconnect account"
                : "Delete workspace data"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function csv(value: string | number | null | undefined) {
  const s = value == null ? "" : String(value);
  return (
    '"' + (/^[=+@\-\t\r]/.test(s) ? "'" : "") + s.replaceAll('"', '""') + '"'
  );
}
export function AnalyticsPage({ ws, go, toast }: OpsProps) {
  const account = ws?.accounts[0],
    zone = ws?.settings.timezone || "Asia/Karachi";
  const { data, error, load } = useOwned(account?.id);
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [preview, setPreview] = useState<{
      confirmation: string;
      estimate_micros: number;
      posts: Post[];
    } | null>(null),
    [busy, setBusy] = useState(false),
    [results, setResults] = useState<string[]>([]);
  const posts = (data?.posts || []).filter((p) => p.status !== "deleted"),
    visible = posts.filter((p) =>
      p.text.toLowerCase().includes(search.toLowerCase()),
    );
  const total = (field: string) =>
    posts.length &&
    posts.every((p) => typeof p.public_metrics?.[field] === "number")
      ? posts.reduce((sum, p) => sum + p.public_metrics![field], 0)
      : null;
  const exportCsv = () => {
    const lines = [
      [
        "Post ID",
        "Text",
        "Observed",
        "Published",
        "Impressions",
        "Likes",
        "Replies",
      ],
      ...posts.map((p) => [
        p.id,
        p.text,
        p.fetched_at,
        p.created_at,
        p.public_metrics?.impression_count,
        p.public_metrics?.like_count,
        p.public_metrics?.reply_count,
      ]),
    ];
    downloadFile(
      "signaldesk-owned-posts.csv",
      lines.map((row) => row.map(csv).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  };
  async function deletion(start: boolean) {
    setBusy(true);
    try {
      if (start)
        setPreview(
          await api("/api/x/owned", "POST", {
            account_id: account?.id,
            post_ids: selected,
          }),
        );
      else if (preview) {
        const r = await api<{
          results: { id: string; status: string; message?: string }[];
        }>("/api/x/owned", "DELETE", {
          account_id: account?.id,
          post_ids: selected,
          confirmation: preview.confirmation,
        });
        setResults(
          r.results.map(
            (i) =>
              i.id + " · " + i.status + (i.message ? " · " + i.message : ""),
          ),
        );
        setSelected([]);
        setPreview(null);
        await load();
      }
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Analytics</h1>
          <p>
            {account ? "@" + account.username : "Account observations"} ·{" "}
            {data?.fetchedAt
              ? "Last observed " + dateLabel(data.fetchedAt, zone)
              : "No observation available"}
          </p>
        </div>
        <button className="btn" disabled={!posts.length} onClick={exportCsv}>
          <Download size={14} />
          Export CSV
        </button>
      </div>
      <div className="ops-stack">
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        <div className="stat-grid">
          {[
            [
              "Followers",
              data?.profile?.public_metrics?.followers_count,
              "Latest profile",
            ],
            ["Impressions", total("impression_count"), "Imported posts"],
            ["Likes", total("like_count"), "Imported posts"],
            ["Replies", total("reply_count"), "Imported posts"],
          ].map(([name, v, source]) => (
            <div key={String(name)} className="stat-card">
              <div className="stat-label">{name}</div>
              <div className="stat-value">
                {v == null ? "—" : Number(v).toLocaleString()}
              </div>
              <div className="stat-foot">{source}</div>
            </div>
          ))}
        </div>
        <section className="panel">
          <div className="panel-header">
            <h2>Owned posts</h2>
            <span className="subtle">{posts.length} locally imported</span>
          </div>
          {posts.length ? (
            <>
              <div className="box-body btn-row">
                <input
                  className="input"
                  style={{ maxWidth: 270 }}
                  aria-label="Search owned posts"
                  placeholder="Search post text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <button
                  className="btn danger"
                  disabled={!selected.length || busy}
                  onClick={() => deletion(true)}
                >
                  Review deletion ({selected.length})
                </button>
              </div>
              <div className="data-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Select</th>
                      <th>Post</th>
                      <th>Published</th>
                      <th>Impressions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={"Select post " + p.id}
                            checked={selected.includes(p.id)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, p.id]
                                  : selected.filter((id) => id !== p.id),
                              )
                            }
                          />
                        </td>
                        <td>
                          <a
                            target="_blank"
                            rel="noreferrer"
                            href={"https://x.com/i/status/" + p.id}
                          >
                            {p.text}
                          </a>
                        </td>
                        <td>
                          {p.created_at
                            ? dateLabel(p.created_at, zone)
                            : "Unavailable"}
                        </td>
                        <td>{p.public_metrics?.impression_count ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <Empty
              icon={BarChart3}
              title="No imported performance data"
              text="Connect X and run a bounded import to see available observations."
              action={
                <button className="btn" onClick={() => go("settings")}>
                  Connection settings <ArrowRight size={14} />
                </button>
              }
            />
          )}
        </section>
        <WorkflowReport accountId={account?.id} zone={zone} />
        <Experiments accountId={account?.id} posts={posts} />
        <div className="box-body">
          <p>
            Follower count comes from the latest profile snapshot. Each
            engagement total sums lifetime public metrics across the imported
            posts. A missing field leaves the total unavailable.
          </p>
        </div>
        {results.length > 0 && (
          <div className="panel box-body">
            {results.map((r) => (
              <p key={r}>{r}</p>
            ))}
          </div>
        )}
      </div>
      {preview && (
        <Dialog
          title={"Delete selected posts from @" + account?.username + "?"}
          onClose={() => setPreview(null)}
        >
          <div className="fields">
            <p>
              Deletion on X is permanent. Confirm only the posts listed here.
            </p>
            {preview.posts.map((p) => (
              <div className="quote-preview" key={p.id}>
                {p.text}
              </div>
            ))}
            <p className="form-hint">
              Reservation: {money(preview.estimate_micros)}
            </p>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => deletion(false)}
            >
              Permanently delete {preview.posts.length} selected
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
