"use client";
import { useEffect, useState } from "react";
import { api, dateLabel } from "@/lib/dashboard-types";
type Report = {
  since: string;
  through: string;
  days: number;
  formats: { kind: string; n: number }[];
  campaigns: { title: string; n: number }[];
  replies: { sent: number; hours: number | null };
  followers: {
    account_id: string;
    observed_at: string;
    followers: number | null;
  }[];
  inbox: { status: string; n: number }[];
};
export function WorkflowReport({
  accountId,
  zone,
}: {
  accountId?: string;
  zone: string;
}) {
  const [data, setData] = useState<Report | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    api<Report>("/api/desk/report")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const observations =
      data?.followers.filter(
        (r) => r.account_id === accountId && typeof r.followers === "number",
      ) || [],
    first = observations.at(0),
    last = observations.at(-1);
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Workflow outcomes</h2>
        <span className="subtle">Last 30 days</span>
      </div>
      <div className="box-body">
        {error ? (
          <p className="form-error">{error}</p>
        ) : data ? (
          <>
            <p>
              {dateLabel(data.since, zone, { month: "short", day: "numeric" })}{" "}
              –{" "}
              {dateLabel(data.through, zone, {
                month: "short",
                day: "numeric",
              })}
              . Publishing counts include confirmed workspace deliveries.
            </p>
            <div className="metric-row">
              <span>Distinct UTC days with a delivery</span>
              <b>{data.days}</b>
            </div>
            <div className="metric-row">
              <span>Confirmed contextual replies</span>
              <b>{data.replies.sent}</b>
            </div>
            <div className="metric-row">
              <span>Mean time from source post to reply</span>
              <b>
                {data.replies.hours === null
                  ? "Unavailable"
                  : data.replies.hours.toFixed(1) + " h"}
              </b>
            </div>
            <div className="metric-row">
              <span>
                Observed follower change · {observations.length} snapshots
              </span>
              <b>
                {observations.length > 1 && first && last
                  ? Number(last.followers) - Number(first.followers)
                  : "Unavailable"}
              </b>
            </div>
            {data.formats.map((row) => (
              <div className="metric-row" key={row.kind}>
                <span>Published · {row.kind}</span>
                <b>{row.n}</b>
              </div>
            ))}
            {data.campaigns.map((row) => (
              <div className="metric-row" key={row.title}>
                <span>Campaign · {row.title}</span>
                <b>{row.n} deliveries</b>
              </div>
            ))}
          </>
        ) : (
          <p>Loading observations…</p>
        )}
      </div>
    </section>
  );
}
