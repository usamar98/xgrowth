"use client";
import { useEffect, useState } from "react";
import { api, dateLabel } from "@/lib/dashboard-types";
import type { DeskWorkspace, QueueData, QueueJob } from "@/lib/dashboard-types";
import { Dialog } from "./desk-ui";
type Attempt = {
  id: string;
  job_id: string;
  started_at: string;
  finished_at: string | null;
  state: string;
  detail: string | null;
};
export function QueueReview({
  ws,
  queue,
  refresh,
}: {
  ws: DeskWorkspace | null;
  queue: QueueData | null;
  refresh: () => Promise<void>;
}) {
  const [attempts, setAttempts] = useState<Attempt[]>([]),
    [job, setJob] = useState<QueueJob | null>(null),
    [post, setPost] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const zone = ws?.settings.timezone || "Asia/Karachi";
  useEffect(() => {
    let active = true;
    api<{ attempts: Attempt[] }>("/api/queue?attempts=1")
      .then((r) => {
        if (active) setAttempts(r.attempts || []);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [queue]);
  const unknown =
    queue?.jobs.filter((j) => j.status === "outcome-unknown") || [];
  return (
    <section className="panel stack-gap">
      <div className="panel-header">
        <h2>Delivery attempts</h2>
      </div>
      <div className="box-body">
        {unknown.map((j) => (
          <div className="metric-row" key={j.id}>
            <span>{j.text.slice(0, 90)} · Outcome unknown</span>
            <button
              className="btn small"
              onClick={() => {
                setJob(j);
                setError("");
                setPost("");
              }}
            >
              Verify published post
            </button>
          </div>
        ))}
        {attempts.map((a) => (
          <div className="metric-row" key={a.id}>
            <span>
              <b>{a.state}</b> · {dateLabel(a.started_at, zone)}
              {a.detail && (
                <>
                  <br />
                  {a.detail}
                </>
              )}
            </span>
            <small>
              {a.finished_at ? dateLabel(a.finished_at, zone) : "In progress"}
            </small>
          </div>
        ))}
        {!attempts.length && !unknown.length && (
          <p>No dispatch attempts recorded.</p>
        )}
        {error && !job && <p className="form-error">{error}</p>}
      </div>
      {job && (
        <Dialog
          title="Verify an uncertain delivery"
          onClose={() => setJob(null)}
        >
          <form
            className="fields"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/api/queue", "POST", {
                  action: "reconcile",
                  job_id: job.id,
                  account_id: job.account_id,
                  post_id: post,
                  confirm: true,
                });
                setJob(null);
                await refresh();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <b>
              @
              {ws?.accounts.find((a) => a.id === job.account_id)?.username ||
                "Disconnected account"}
            </b>
            <div className="quote-preview">{job.text}</div>
            <p className="form-hint">
              Verify the author, text, target and publication time with an X
              lookup. Estimated cost $0.005.
            </p>
            <label>
              Post ID from X
              <input
                inputMode="numeric"
                pattern="[0-9]{1,20}"
                required
                value={post}
                onChange={(e) => setPost(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="btn primary" disabled={busy}>
              Verify with X
            </button>
          </form>
        </Dialog>
      )}
    </section>
  );
}
