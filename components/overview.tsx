"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  CirclePause,
  CirclePlay,
  FilePenLine,
  Files,
  Inbox,
  ListChecks,
  Plus,
} from "lucide-react";
import {
  type DeskWorkspace,
  type QueueData,
  type Costs,
  type Summary,
  money,
  dateLabel,
} from "@/lib/dashboard-types";
import { SignalArt } from "./signal-art";
import { Pill } from "./desk-ui";
type Props = {
  ws: DeskWorkspace | null;
  queue: QueueData | null;
  costs: Costs | null;
  summary: Summary | null;
  go: (s: string, id?: string) => void;
  login: boolean;
  loading: boolean;
  signIn: string;
  pause: () => void;
};
export function Overview({
  ws,
  queue,
  costs,
  summary,
  go,
  login,
  loading,
  signIn,
  pause,
}: Props) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const task = window.setTimeout(() => setNow(new Date()), 0);
    return () => window.clearTimeout(task);
  }, []);
  const zone = ws?.settings.timezone || "Asia/Karachi";
  const account = ws?.accounts[0];
  const scheduled = queue?.jobs
    .filter((j) => j.status === "scheduled" || j.status === "processing")
    .sort((a, b) => Date.parse(a.run_at) - Date.parse(b.run_at));
  const drafts = ws?.drafts.filter((d) =>
    ["planned", "draft", "pending_review"].includes(d.status),
  );
  const first = drafts?.[0];
  const cards = [
    {
      label: "Drafts to review",
      value: drafts?.length,
      icon: Files,
      color: "lavender",
      route: "drafts",
      foot: "In your workspace",
    },
    {
      label: "Publishing queue",
      value: scheduled?.length,
      icon: CalendarDays,
      color: "aqua",
      route: "calendar",
      foot: "Upcoming posts",
    },
    {
      label: "Unanswered",
      value: summary?.mentions,
      icon: Inbox,
      color: "sand",
      route: "engage",
      foot: "Conversations",
    },
    {
      label: "Estimated usage",
      value: costs ? money(costs.month_micros) : undefined,
      icon: CircleDollarSign,
      color: "blue",
      route: "costs",
      foot: "Month to date",
    },
  ];
  const focus = [
    {
      title: first ? "Review your latest draft" : "Write your first draft",
      body: first ? first.text : "Capture an idea in the composer.",
      icon: FilePenLine,
      route: first ? "drafts" : "compose",
      color: "lavender",
    },
    {
      title: summary?.mentions
        ? "Review your mentions"
        : "Open your reply inbox",
      body: summary?.mentions
        ? summary.mentions + " conversations to review."
        : "Review mentions and prepare replies.",
      icon: Inbox,
      route: "engage",
      color: "sand",
    },
    summary?.saved
      ? {
          title: "Revisit saved follow-ups",
          body: summary.saved + " saved conversations.",
          icon: Inbox,
          route: "engage",
          color: "aqua",
        }
      : {
          title: "Shape your writing voice",
          body: "Set the tone for future drafts.",
          icon: BookOpen,
          route: "voice",
          color: "aqua",
        },
  ];
  return (
    <>
      <div className="page-heading overview-heading">
        <div>
          <div className="dateline">
            <span className="date-dash" />
            {now
              ? dateLabel(now.toISOString(), zone, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })
              : "Personal workspace"}
          </div>
          <h1>Workspace overview</h1>
        </div>
        <button className="btn primary" onClick={() => go("compose")}>
          <Plus size={17} />
          New draft
        </button>
      </div>
      <section className="connection-banner">
        <SignalArt />
        <div className="banner-content">
          <div className="banner-tag">
            <span className="live-dot" />
            {account ? "ACCOUNT CONNECTED" : "ACCOUNT SETUP"}
          </div>
          <h2>
            {account
              ? "Connected to @" + account.username
              : "Connect your X account"}
          </h2>
          <p>
            {account
              ? "Review your publishing queue, sync recent posts, and manage conversations."
              : "Bring your posts, publishing queue, and conversations into one private workspace."}
          </p>
          {login ? (
            <a className="btn banner-button" href={signIn}>
              Sign in to connect <ArrowRight size={15} />
            </a>
          ) : (
            <button
              className="btn banner-button"
              onClick={() => go("settings")}
            >
              {account ? "Manage account" : "Set up connection"}
              <ArrowRight size={15} />
            </button>
          )}
        </div>
      </section>
      <div className="section-heading">
        <h2>At a glance</h2>
        <span className="subtle">
          <span className={"status-dot " + (account ? "on" : "")} />
          {account ? "Connected workspace" : "Workspace activity"}
        </span>
      </div>
      <div className="stat-grid">
        {cards.map(({ label, value, icon: Icon, color, route, foot }) => (
          <button className="stat-card" key={label} onClick={() => go(route)}>
            <div className="stat-label">
              <span className={"tile-icon " + color}>
                <Icon size={16} />
              </span>
              <span>{label}</span>
            </div>
            <div
              className={
                "stat-value " + (value === undefined ? "unavailable" : "")
              }
            >
              {value ?? "—"}
            </div>
            <div className="stat-foot">
              {foot}
              <ArrowUpRight size={13} />
            </div>
          </button>
        ))}
      </div>
      <div className="overview-split">
        <section className="panel queue-panel">
          <div className="panel-header">
            <span className="panel-title">
              <CalendarClock size={18} />
              <h2>Publishing queue</h2>
            </span>
            <button className="text-link" onClick={() => go("calendar")}>
              View calendar <ArrowUpRight size={14} />
            </button>
          </div>
          {scheduled?.length ? (
            <div className="queue-overview">
              {scheduled.slice(0, 3).map((j) => (
                <button key={j.id} onClick={() => go("calendar")}>
                  <span className="queue-date">
                    {dateLabel(j.run_at, zone, { month: "short" })}
                    <b>{dateLabel(j.run_at, zone, { day: "2-digit" })}</b>
                  </span>
                  <span>
                    <strong>{j.text}</strong>
                    <small>{dateLabel(j.run_at, zone)}</small>
                  </span>
                  <Pill>{j.status}</Pill>
                </button>
              ))}
            </div>
          ) : (
            <div className="queue-blank">
              <div className="queue-art" aria-hidden>
                <span />
                <i>
                  <CalendarClock size={27} strokeWidth={1.25} />
                </i>
                <span />
              </div>
              <strong>
                {login
                  ? "Your scheduled posts appear here"
                  : loading
                    ? "Loading your queue…"
                    : "Your queue is clear"}
              </strong>
              <p>
                {login
                  ? "Sign in to view your private publishing schedule."
                  : "Approve a draft and choose a time to publish."}
              </p>
            </div>
          )}
          <div className="panel-foot">
            <span>
              <span
                className={"status-dot " + (queue?.paused ? "amber" : "on")}
              />
              {queue
                ? queue.paused
                  ? "Publishing paused"
                  : "Queue ready"
                : "Queue status unavailable"}
            </span>
            <button className="text-link" disabled={!queue} onClick={pause}>
              {queue?.paused ? (
                <CirclePlay size={14} />
              ) : (
                <CirclePause size={14} />
              )}{" "}
              {queue?.paused ? "Resume" : "Pause all"}
            </button>
          </div>
        </section>
        <section className="panel">
          <div className="panel-header">
            <span className="panel-title">
              <ListChecks size={18} />
              <h2>Daily focus</h2>
            </span>
          </div>
          <div className="focus-list">
            {focus.map(({ title, body, icon: Icon, route, color }) => (
              <button key={title} onClick={() => go(route)}>
                <span className={"focus-icon " + color}>
                  <Icon size={17} />
                </span>
                <span>
                  <strong>{title}</strong>
                  <small>{body}</small>
                </span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </section>
      </div>
      {account && (
        <section className="panel recent">
          <div className="panel-header">
            <h2>Account snapshot</h2>
            <button className="text-link" onClick={() => go("analytics")}>
              Analytics <ArrowUpRight size={14} />
            </button>
          </div>
          <div className="box-body">
            <div className="metric-row">
              <span>
                Followers ·{" "}
                {summary?.profile
                  ? dateLabel(summary.profile.observed_at, zone)
                  : "No profile observation"}
              </span>
              <b>{summary?.profile?.followers ?? "Unavailable"}</b>
            </div>
            <div className="metric-row">
              <span>Unanswered with current summons evidence</span>
              <b>{summary?.eligible ?? "Unavailable"}</b>
            </div>
            <div className="metric-row">
              <span>Scheduled today · {zone}</span>
              <b>
                {scheduled && now
                  ? scheduled.filter(
                      (j) =>
                        dateLabel(j.run_at, zone, {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        }) ===
                        dateLabel(now.toISOString(), zone, {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        }),
                    ).length
                  : "Unavailable"}
              </b>
            </div>
          </div>
        </section>
      )}
      <section className="panel recent">
        <div className="panel-header">
          <span className="panel-title">
            <Files size={18} />
            <h2>Recent drafts</h2>
          </span>
          <button className="text-link" onClick={() => go("drafts")}>
            All drafts <ArrowUpRight size={14} />
          </button>
        </div>
        {drafts?.length ? (
          <div className="simple-list">
            {drafts.slice(0, 4).map((d) => (
              <button key={d.id} onClick={() => go("compose", d.id)}>
                <FilePenLine size={16} />
                <b>{d.text}</b>
                <span>
                  {dateLabel(d.updated_at, zone, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                <ChevronRight size={14} />
              </button>
            ))}
          </div>
        ) : (
          <div className="recent-empty">
            <span className="focus-icon neutral">
              <FilePenLine size={19} />
            </span>
            <div>
              <strong>{login ? "Draft library" : "Start a draft"}</strong>
              <small>
                {login
                  ? "Sign in to access your saved writing."
                  : "Your saved writing will appear here."}
              </small>
            </div>
            <button className="btn small" onClick={() => go("compose")}>
              Open composer <ArrowRight size={14} />
            </button>
          </div>
        )}
      </section>
    </>
  );
}
