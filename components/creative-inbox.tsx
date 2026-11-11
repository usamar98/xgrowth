"use client";
import { useEffect, useState } from "react";
import {
  Archive,
  AtSign,
  Bookmark,
  Check,
  CircleHelp,
  Clock,
  Download,
  ExternalLink,
  Inbox,
  MessageSquare,
  RefreshCw,
  Search,
} from "lucide-react";
import { api, downloadFile, money } from "@/lib/dashboard-types";
import {
  nativePostUrl,
  type CreativeState,
  type InboxItem,
} from "@/lib/creative-types";
import { Empty, Pill, Dialog } from "./desk-ui";
import { Editor } from "./creative-editor";
type Props = {
  state: CreativeState;
  refresh: () => Promise<void>;
  navigate: (view: string, id?: string) => void;
  schedule?: (id: string) => void;
};
const filters = [
  ["Unanswered", Inbox],
  ["Mentions", AtSign],
  ["Quotes", MessageSquare],
  ["Needs review", CircleHelp],
  ["Saved", Bookmark],
  ["Snoozed", Clock],
  ["Resolved", Archive],
  ["Reply drafts", MessageSquare],
] as const;
function activeStatus(item: InboxItem) {
  return item.status === "snoozed" &&
    item.snoozed_until &&
    Date.parse(item.snoozed_until) <= Date.now()
    ? "open"
    : item.status;
}
function matches(i: InboxItem, f: string) {
  const status = activeStatus(i);
  switch (f) {
    case "Unanswered":
      return ["open", "review", "saved"].includes(status);
    case "Mentions":
      return i.source === "mention";
    case "Quotes":
      return i.source === "quote";
    case "Needs review":
      return status === "review";
    default:
      return status === f.toLowerCase();
  }
}
function Detail({
  item,
  state,
  refresh,
  schedule,
}: Pick<Props, "state" | "refresh" | "schedule"> & { item: InboxItem }) {
  const [metadata, setMetadata] = useState(item),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [decision, setDecision] = useState({
      state: "unknown",
      reason: "Checking the saved evidence…",
    });
  const draft = state.drafts.find(
    (d) =>
      d.kind === "reply" &&
      d.account_id === item.account_id &&
      d.target_id === item.post_id,
  );
  useEffect(() => {
    let alive = true;
    api<typeof decision>(
      "/api/creative?account=" +
        item.account_id +
        "&target=" +
        item.post_id +
        "&ai=" +
        (draft?.provenance === "ai" ? "1" : "0"),
    )
      .then((x) => {
        if (alive) setDecision(x);
      })
      .catch((e) => {
        if (alive) setDecision({ state: "unavailable", reason: e.message });
      });
    return () => {
      alive = false;
    };
  }, [
    item.account_id,
    item.post_id,
    item.status,
    item.opt_out,
    draft?.provenance,
  ]);
  async function save(p: Partial<InboxItem> = {}) {
    setBusy(true);
    setError("");
    try {
      const value = { ...metadata, ...p };
      await api("/api/creative", "POST", {
        ...value,
        action: "inbox",
        opt_out: !!value.opt_out,
      });
      setMetadata(value);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cr-stack">
      <section className="panel cr-editor">
        <div className="cr-bar">
          <h2>Original post</h2>
          <a
            href={nativePostUrl(item.post_id)!}
            target="_blank"
            rel="noreferrer"
            aria-label="Open original post on X"
          >
            <ExternalLink size={16} />
          </a>
        </div>
        <div className="cr-profile">
          <span className="cr-avatar">
            {(item.author_name || item.author_username || "X")[0]}
          </span>
          <span>
            <b>{item.author_name || "X user"}</b>
            <small>
              {item.author_username
                ? "@" + item.author_username
                : "User " + item.author_id}
            </small>
          </span>
        </div>
        <p className="cr-prose">{item.text}</p>
        <small>
          {item.source} ·{" "}
          {item.created_at
            ? new Date(item.created_at).toLocaleString()
            : "Time unavailable"}{" "}
          · Retrieved {new Date(item.fetched_at).toLocaleString()}
        </small>
        <div className="cr-policy">
          <Pill>{decision.state}</Pill> {decision.reason}
        </div>
        <details>
          <summary>Conversation memory</summary>
          <div className="cr-stack">
            <label>
              Private note
              <textarea
                value={metadata.note}
                maxLength={2000}
                onChange={(e) =>
                  setMetadata({ ...metadata, note: e.target.value })
                }
              />
            </label>
            <label>
              Labels, comma-separated
              <input
                value={metadata.labels.join(",")}
                onChange={(e) =>
                  setMetadata({
                    ...metadata,
                    labels: e.target.value.split(",").slice(0, 12),
                  })
                }
              />
            </label>
            <label>
              Campaign
              <select
                value={metadata.campaign_id || ""}
                onChange={(e) =>
                  setMetadata({
                    ...metadata,
                    campaign_id: e.target.value || null,
                  })
                }
              >
                <option value="">None</option>
                {state.entries
                  .filter((x) => x.kind === "campaign")
                  .map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Status
              <select
                value={metadata.status}
                onChange={(e) =>
                  setMetadata({
                    ...metadata,
                    status: e.target.value,
                    snoozed_until:
                      e.target.value === "snoozed"
                        ? new Date(Date.now() + 86400000).toISOString()
                        : null,
                  })
                }
              >
                {["open", "review", "saved", "snoozed", "resolved"].map((v) => (
                  <option key={v} value={v}>
                    {v === "snoozed" ? "Snoozed for 24 hours" : v}
                  </option>
                ))}
              </select>
            </label>
            <label className="cr-check">
              <input
                type="checkbox"
                checked={!!metadata.opt_out}
                disabled={!!item.opt_out}
                onChange={(e) =>
                  setMetadata({
                    ...metadata,
                    opt_out: Number(e.target.checked),
                  })
                }
              />
              Record author opt-out
            </label>
            <div className="cr-row">
              <button
                className="btn"
                disabled={busy}
                onClick={() => void save()}
              >
                Save changes
              </button>
              <button
                className="btn"
                onClick={() =>
                  downloadFile(
                    "conversation-note.json",
                    JSON.stringify(
                      {
                        original: nativePostUrl(item.post_id),
                        note: metadata.note,
                        labels: metadata.labels,
                      },
                      null,
                      2,
                    ),
                  )
                }
              >
                <Download size={14} /> Export note
              </button>
            </div>
          </div>
        </details>
        <div className="cr-row">
          <button
            disabled={busy}
            className="btn"
            onClick={() =>
              void save({
                status: item.status === "resolved" ? "open" : "resolved",
              })
            }
          >
            <Check size={14} />
            {item.status === "resolved" ? "Reopen" : "Resolve"}
          </button>
          <button
            disabled={busy}
            className="btn"
            onClick={() =>
              void save({ status: item.status === "saved" ? "open" : "saved" })
            }
          >
            <Bookmark size={14} />
            {item.status === "saved" ? "Unsave" : "Save opportunity"}
          </button>
        </div>
        {error && (
          <p role="alert" className="cr-error">
            {error}
          </p>
        )}
      </section>
      <Editor
        embedded
        draft={draft}
        state={state}
        seed={
          draft
            ? undefined
            : {
                kind: "reply",
                account_id: item.account_id,
                target_id: item.post_id,
              }
        }
        refresh={refresh}
        schedule={schedule}
        eligible={decision.state === "eligible"}
        onGeneration={() => void refresh()}
      />
    </div>
  );
}
export function InboxWorkspace({ state, refresh, navigate, schedule }: Props) {
  const [filter, setFilter] = useState("Unanswered"),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [sync, setSync] = useState(false),
    [limit, setLimit] = useState(10),
    [older, setOlder] = useState(false),
    [estimate, setEstimate] = useState<number | null>(null),
    [err, setErr] = useState(""),
    [busy, setBusy] = useState(false);
  const [account, setAccount] = useState(state.accounts[0]?.id || "");
  const draftItems = state.drafts.filter(
    (d) => d.kind === "reply" && (!account || d.account_id === account),
  );
  const visible = state.items
    .filter(
      (i) =>
        i.account_id === account &&
        matches(i, filter) &&
        (i.text + " " + i.author_username + " " + i.labels.join(" "))
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.text.includes("?")) - Number(a.text.includes("?")) ||
        String(b.created_at).localeCompare(String(a.created_at)),
    );
  const item = visible.find((i) => i.post_id === selected) || visible[0];
  useEffect(() => {
    if (!sync || !account) return;
    let live = true;
    api<{ estimate_micros: number }>(
      "/api/x/sync?kind=mentions&account_id=" + account + "&limit=" + limit,
    )
      .then((r) => {
        if (live) {
          setEstimate(r.estimate_micros);
          setErr("");
        }
      })
      .catch((e) => {
        if (live) {
          setEstimate(null);
          setErr(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [sync, account, limit]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Engage</h1>
          <p>Review mentions, save context, and prepare a reply.</p>
        </div>
        <button
          className="btn primary"
          onClick={() => (account ? setSync(true) : navigate("settings"))}
        >
          <RefreshCw size={15} />
          {account ? "Import mentions" : "Connect X"}
        </button>
      </div>
      <div className="cr-inbox">
        <aside className="panel cr-filters">
          <h2>Inbox views</h2>
          {filters.map(([f, Icon]) => (
            <button
              key={f}
              className={filter === f ? "active" : ""}
              onClick={() => setFilter(f)}
            >
              <Icon size={15} />
              {f}
            </button>
          ))}
        </aside>
        <section className="panel cr-list">
          <div className="cr-bar">
            <h2>{filter}</h2>
          </div>
          <label className="cr-search">
            <Search size={15} />
            <input
              aria-label="Search conversations"
              placeholder="Find a conversation"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          {state.accounts.length > 1 && (
            <select
              aria-label="Inbox account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
            >
              {state.accounts.map((a) => (
                <option value={a.id} key={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
          )}
          {filter === "Reply drafts"
            ? draftItems
                .filter((d) =>
                  d.text.toLowerCase().includes(query.toLowerCase()),
                )
                .map((d) => (
                  <button
                    className="cr-inbox-row"
                    key={d.id}
                    onClick={() => navigate("compose", d.id)}
                  >
                    <b>{d.text.slice(0, 100)}</b>
                    <small>
                      {d.provenance} · {d.status}
                    </small>
                  </button>
                ))
            : visible.map((i) => (
                <button
                  className={
                    "cr-inbox-row " +
                    (item?.post_id === i.post_id ? "active" : "")
                  }
                  key={i.post_id}
                  onClick={() => setSelected(i.post_id)}
                >
                  <b>
                    {i.author_username
                      ? "@" + i.author_username
                      : i.author_name || "X user"}
                  </b>
                  <span>{i.text}</span>
                  <small>
                    {activeStatus(i)} ·{" "}
                    {i.text.includes("?")
                      ? "Contains a question"
                      : "Recent conversation"}
                  </small>
                </button>
              ))}
          {!(filter === "Reply drafts" ? draftItems : visible).length && (
            <Empty
              icon={Inbox}
              title="No conversations here"
              text={
                filter === "Quotes"
                  ? "Only quotes found in permitted imports appear here."
                  : account
                    ? "Imported conversations matching this view appear here."
                    : "Connect X to import recent mentions."
              }
            />
          )}
        </section>
        <div>
          {item && filter !== "Reply drafts" ? (
            <Detail
              key={item.account_id + item.post_id}
              item={item}
              state={state}
              refresh={refresh}
              schedule={schedule}
            />
          ) : (
            <section className="panel">
              <Empty
                icon={MessageSquare}
                title="Conversation details"
                text="Select a conversation to review its original post and draft a reply."
              />
            </section>
          )}
        </div>
      </div>
      {sync && (
        <Dialog
          title="Import mentions"
          onClose={() => {
            if (!busy) setSync(false);
          }}
        >
          <div className="cr-stack">
            <p>
              Read a bounded page for @
              {state.accounts.find((a) => a.id === account)?.username}. Context
              is limited to data returned by X.
            </p>
            <label>
              Post limit
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
            <label className="cr-check">
              <input
                type="checkbox"
                checked={older}
                onChange={(e) => setOlder(e.target.checked)}
              />
              Continue to an older page
            </label>
            <p>
              Estimated maximum ·{" "}
              {estimate === null ? "Unavailable" : money(estimate)}
            </p>
            {err && (
              <p role="alert" className="cr-error">
                {err}
              </p>
            )}
            <button
              className="btn primary"
              disabled={busy || estimate === null}
              onClick={async () => {
                setBusy(true);
                try {
                  await api("/api/x/sync", "POST", {
                    kind: "mentions",
                    account_id: account,
                    limit,
                    older,
                  });
                  await refresh();
                  setSync(false);
                } catch (e) {
                  setErr((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Importing…" : "Import mentions"}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
