"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  ChartNoAxesColumn,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  FilePenLine,
  Files,
  FolderOpen,
  Inbox,
  LayoutDashboard,
  Lightbulb,
  Menu,
  Moon,
  PanelLeft,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { brand, sections } from "@/lib/navigation";
import {
  api,
  type Costs,
  type DeskWorkspace,
  type QueueData,
  type Summary,
} from "@/lib/dashboard-types";
import { Dialog, Empty } from "./desk-ui";
import { Overview } from "./overview";
import { Operations, ScheduleDialog } from "./operations";
import SignalCreative from "./signal-creative";
import { OutcomePanel } from "./measurements";
const icons: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  compose: FilePenLine,
  drafts: Files,
  calendar: CalendarDays,
  engage: Inbox,
  analytics: ChartNoAxesColumn,
  campaigns: FolderOpen,
  inspiration: Lightbulb,
  voice: BookOpen,
  automations: Zap,
  costs: CircleDollarSign,
  activity: Activity,
  settings: Settings,
};
const creativeViews = [
  "compose",
  "drafts",
  "engage",
  "campaigns",
  "voice",
  "inspiration",
];
const signIn = (view: string) =>
  "/signin-with-chatgpt?return_to=" + encodeURIComponent("/app/" + view);
export default function SignalDesk({ initialView }: { initialView: string }) {
  const [view, setView] = useState(initialView),
    [ws, setWs] = useState<DeskWorkspace | null>(null),
    [queue, setQueue] = useState<QueueData | null>(null),
    [costs, setCosts] = useState<Costs | null>(null),
    [summary, setSummary] = useState<Summary | null>(null);
  const [login, setLogin] = useState(false),
    [error, setError] = useState(""),
    [drawer, setDrawer] = useState(false),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState(""),
    [dark, setDark] = useState(false),
    [message, setMessage] = useState(""),
    [schedule, setSchedule] = useState<string | null>(null),
    [draft, setDraft] = useState<string | undefined>(),
    [sequence, setSequence] = useState(0),
    [loading, setLoading] = useState(true);
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const n = ++epoch.current;
    try {
      const w = await api<DeskWorkspace>("/api/workspace");
      if (n !== epoch.current) return;
      setWs(w);
      setLogin(false);
      const results = await Promise.allSettled([
        api<QueueData>("/api/queue"),
        api<Costs>("/api/costs"),
        api<Summary>("/api/desk/summary"),
      ] as const);
      if (n !== epoch.current) return;
      setQueue(results[0].status === "fulfilled" ? results[0].value : null);
      setCosts(results[1].status === "fulfilled" ? results[1].value : null);
      setSummary(results[2].status === "fulfilled" ? results[2].value : null);
      setError(
        results.some((r) => r.status === "rejected")
          ? "Some workspace data could not be loaded."
          : "",
      );
    } catch (e) {
      if (n !== epoch.current) return;
      const fail = e as Error & { status?: number };
      setWs(null);
      setQueue(null);
      setSummary(null);
      setCosts(null);
      setLogin(fail.status === 401);
      setError(fail.status === 401 ? "" : fail.message);
    } finally {
      if (n === epoch.current) setLoading(false);
    }
  }, []);
  const navigate = useCallback((target: string, id?: string) => {
    const next = sections.find((s) => s.id === target)?.id;
    if (!next) return;
    setView(next);
    setDraft(id);
    setSequence((v) => v + 1);
    setDrawer(false);
    setPalette(false);
    setQuery("");
    if (location.pathname !== "/app/" + next)
      history.pushState(null, "", "/app/" + next);
    window.scrollTo({ top: 0 });
  }, []);
  useEffect(() => {
    const task = window.setTimeout(() => {
      void refresh();
      const d = localStorage.getItem("signaldesk-theme") === "dark";
      document.documentElement.dataset.theme = d ? "dark" : "light";
      setDark(d);
    }, 0);
    const pop = () => {
      setView(location.pathname.split("/")[2] || "overview");
      setDraft(undefined);
      setDrawer(false);
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.clearTimeout(task);
      window.removeEventListener("popstate", pop);
    };
  }, [refresh]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        setQuery("");
      }
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(t);
  }, [message]);
  const toggleTheme = () => {
    const theme = dark ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("signaldesk-theme", theme);
    setDark(!dark);
  };
  const current = sections.find((s) => s.id === view) || sections[0];
  const account = ws?.accounts[0];
  const openSchedule = (id: string) => {
    void refresh();
    setSchedule(id);
  };
  const pause = async () => {
    try {
      if (!ws) {
        navigate("settings");
        return;
      }
      const next = !queue?.paused;
      await api("/api/queue", "POST", { action: "pause", paused: next });
      await refresh();
      setMessage(next ? "Future publishing paused." : "Publishing resumed.");
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  return (
    <div className="desk">
      <a className="skip" href="#workspace-content">
        Skip to workspace
      </a>
      {drawer && (
        <button
          className="side-shade"
          onClick={() => setDrawer(false)}
          aria-label="Close navigation"
        />
      )}
      <aside className={"sidebar " + (drawer ? "opened" : "")}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>{brand}</span>
          <button
            className="mobile-close icon-btn"
            onClick={() => setDrawer(false)}
            aria-label="Close menu"
          >
            <X />
          </button>
        </div>
        <button
          className="workspace-chooser"
          onClick={() => navigate("settings")}
        >
          <span className="workspace-x">𝕏</span>
          <span>
            <b>Personal workspace</b>
            <small>{account ? "@" + account.username : "X workspace"}</small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav aria-label="Main navigation">
          {["Workspace", "Library", "Operations"].map((g) => (
            <div className="nav-group" key={g}>
              <div className="nav-label">{g}</div>
              {sections
                .filter((s) => s.group === g)
                .map((s) => {
                  const Icon = icons[s.id];
                  return (
                    <a
                      href={"/app/" + s.id}
                      key={s.id}
                      aria-current={view === s.id ? "page" : undefined}
                      className={view === s.id ? "selected" : ""}
                      onClick={(e) => {
                        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
                          e.preventDefault();
                          navigate(s.id);
                        }
                      }}
                    >
                      <Icon size={17} />
                      <span>{s.name}</span>
                      {s.id === "drafts" && !!ws?.drafts.length && (
                        <small>{ws.drafts.length}</small>
                      )}
                    </a>
                  );
                })}
            </div>
          ))}
        </nav>
        <button className="sidebar-user" onClick={() => navigate("settings")}>
          <span className="owner-icon">
            <ShieldCheck size={18} />
          </span>
          <span>
            <b>Private workspace</b>
            <small>Owner access</small>
          </span>
          <SlidersHorizontal size={15} />
        </button>
      </aside>
      <div className="desk-main">
        <header className="topbar">
          <div className="crumb">
            <button
              className="menu-btn icon-btn"
              onClick={() => setDrawer(true)}
              aria-label="Open navigation"
            >
              <Menu size={20} />
            </button>
            <PanelLeft size={16} className="crumb-panel" />
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{current.name}</strong>
          </div>
          <div className="top-actions">
            <button
              className="search-toggle"
              aria-label="Search workspace"
              onClick={() => {
                setQuery("");
                setPalette(true);
              }}
            >
              <Search size={16} />
              <span>Search workspace</span>
              <kbd>Ctrl K</kbd>
            </button>
            <div className="vertical-rule" />
            <button
              className="icon-btn"
              aria-label={
                dark ? "Switch to light theme" : "Switch to dark theme"
              }
              onClick={toggleTheme}
            >
              {dark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </header>
        <main id="workspace-content" className="desk-content">
          {error && (
            <div role="alert" className="notice">
              {error}
              <button onClick={refresh}>Retry</button>
            </div>
          )}
          {view === "overview" ? (
            <Overview
              ws={ws}
              queue={queue}
              costs={costs}
              summary={summary}
              go={navigate}
              login={login}
              loading={loading}
              signIn={signIn("overview")}
              pause={pause}
            />
          ) : login ? (
            <>
              <div className="page-heading">
                <h1>{current.name}</h1>
              </div>
              <div className="panel">
                <Empty
                  icon={ShieldCheck}
                  title="Open your private workspace"
                  text="Sign in to access your drafts and account settings."
                  action={
                    <a className="btn primary" href={signIn(view)}>
                      Sign in <ArrowUpRight size={15} />
                    </a>
                  }
                />
              </div>
            </>
          ) : loading ? (
            <div className="loading-card" role="status">
              Loading workspace…
            </div>
          ) : creativeViews.includes(view) ? (
            <>
              <SignalCreative
                key={view + sequence}
                view={view}
                navigate={navigate}
                refresh={refresh}
                initialDraftId={draft}
                onSchedule={openSchedule}
              />
              {view === "campaigns" && <OutcomePanel />}
            </>
          ) : (
            <Operations
              key={view}
              view={view}
              ws={ws}
              queue={queue}
              costs={costs}
              refresh={refresh}
              go={navigate}
              toast={setMessage}
              pause={pause}
              onSchedule={openSchedule}
            />
          )}
        </main>
      </div>
      {palette && (
        <Dialog title="Search workspace" onClose={() => setPalette(false)}>
          <div className="palette-search">
            <Search size={18} />
            <input
              autoFocus
              placeholder="Find a page or draft…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>Esc</kbd>
          </div>
          <div className="palette-items">
            {sections
              .filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
              .map((s) => {
                const Icon = icons[s.id];
                return (
                  <button key={s.id} onClick={() => navigate(s.id)}>
                    <Icon size={17} />
                    {s.name}
                    <ChevronRight size={15} />
                  </button>
                );
              })}
            {(query
              ? ws?.drafts
                  .filter((d) =>
                    d.text.toLowerCase().includes(query.toLowerCase()),
                  )
                  .slice(0, 6)
              : []
            )?.map((d) => (
              <button key={d.id} onClick={() => navigate("compose", d.id)}>
                <FilePenLine size={16} />
                {d.text.slice(0, 65)}
              </button>
            ))}
            {query &&
              !sections.some((s) =>
                s.name.toLowerCase().includes(query.toLowerCase()),
              ) &&
              !ws?.drafts.some((d) =>
                d.text.toLowerCase().includes(query.toLowerCase()),
              ) && <p>No matching pages or drafts.</p>}
          </div>
        </Dialog>
      )}
      {schedule && ws && (
        <ScheduleDialog
          id={schedule}
          ws={ws}
          onClose={() => setSchedule(null)}
          done={async () => {
            setSchedule(null);
            await refresh();
            navigate("calendar");
            setMessage("Approved version added to the queue.");
          }}
        />
      )}
      {message && (
        <div className="toast" role="status">
          {message}
          <button onClick={() => setMessage("")} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
