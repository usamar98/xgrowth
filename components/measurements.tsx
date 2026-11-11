"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/dashboard-types";
import { Dialog } from "./desk-ui";
type Sample = {
  id: string;
  text: string;
  public_metrics?: Record<string, number> | null;
};
type Experiment = {
  id: string;
  account_id: string;
  name: string;
  first_post: string;
  second_post: string;
  metric: string;
};
export function Experiments({
  accountId,
  posts,
}: {
  accountId?: string;
  posts: Sample[];
}) {
  const [records, setRecords] = useState<Experiment[]>([]),
    [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(""),
    [left, setLeft] = useState(""),
    [right, setRight] = useState(""),
    [metric, setMetric] = useState("like_count");
  const load = useCallback(async () => {
    try {
      setRecords(
        (await api<{ experiments: Experiment[] }>("/api/desk/experiments"))
          .experiments,
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/api/desk/experiments", "POST", {
        account_id: accountId,
        name,
        first_post: left,
        second_post: right,
        metric,
      });
      await load();
      setOpen(false);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Post comparisons</h2>
        <button
          className="btn small"
          onClick={() => setOpen(true)}
          disabled={posts.length < 2}
        >
          Compare posts
        </button>
      </div>
      <div className="box-body">
        <p>
          Compare one observed post per variant. Differences may reflect
          audience, timing, or subject.
        </p>
        {error && <p className="form-error">{error}</p>}
        {records
          .filter((r) => r.account_id === accountId)
          .map((r) => (
            <div className="metric-row" key={r.id}>
              <span>
                <b>{r.name}</b>
                <br />
                {r.metric.replace("_count", "")} · one post per variant
              </span>
              <strong>
                {posts.find((p) => p.id === r.first_post)?.public_metrics?.[
                  r.metric
                ] ?? "Unavailable"}{" "}
                /{" "}
                {posts.find((p) => p.id === r.second_post)?.public_metrics?.[
                  r.metric
                ] ?? "Unavailable"}
              </strong>
            </div>
          ))}
      </div>
      {open && (
        <Dialog title="Compare two posts" onClose={() => setOpen(false)}>
          <form className="fields" onSubmit={submit}>
            <label>
              Comparison name
              <input
                maxLength={100}
                value={name}
                required
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {[true, false].map((first) => (
              <label key={String(first)}>
                Variant {first ? "A" : "B"}
                <select
                  required
                  value={first ? left : right}
                  onChange={(e) =>
                    first ? setLeft(e.target.value) : setRight(e.target.value)
                  }
                >
                  <option value="">Select a post</option>
                  {posts.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.text.slice(0, 90)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              Measure
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              >
                {[
                  "like_count",
                  "impression_count",
                  "retweet_count",
                  "reply_count",
                ].map((k) => (
                  <option key={k} value={k}>
                    {k.replace("_count", "")}
                  </option>
                ))}
              </select>
            </label>
            {error && <p className="form-error">{error}</p>}
            <button className="btn primary" disabled={left === right}>
              Save comparison
            </button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
export function OutcomePanel() {
  const [data, setData] = useState<{
      enabled: boolean;
      events: {
        campaign_id: string;
        title: string;
        event: string;
        n: number;
      }[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<NonNullable<typeof data>>("/api/desk/outcomes")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel stack-gap">
      <div className="panel-header">
        <h2>First-party outcomes</h2>
      </div>
      <div className="box-body">
        <p>
          {error ||
            (!data
              ? "Loading outcomes…"
              : data.enabled
                ? "Signed events received in the past 30 days. Campaign attribution comes from your originating site."
                : "Configure a signing secret and an owner on the server to receive first-party campaign events.")}
        </p>
        {data?.events.map((e) => (
          <div className="metric-row" key={e.campaign_id + e.event}>
            <span>
              {e.title} · {e.event}
            </span>
            <b>{e.n}</b>
          </div>
        ))}
      </div>
    </section>
  );
}
