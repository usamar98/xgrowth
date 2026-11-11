"use client";
import { useCallback, useEffect, useState } from "react";
import { Activity, Clipboard, KeyRound, Play, Plus, Zap } from "lucide-react";
import type { OpsProps } from "./operations";
import { api, dateLabel } from "@/lib/dashboard-types";
import { Dialog, Empty, Pill } from "./desk-ui";
type Rule = {
  id: string;
  name: string;
  action: string;
  enabled: number;
  next_run: string;
  timezone: string;
  local_time: string;
  every_days: number;
  account_id: string | null;
};
type Rules = {
  rules: Rule[];
  runs: {
    id: string;
    message: string;
    created_at: string;
    draft_id: string | null;
  }[];
  sources: { id: string; title: string }[];
};
const actions: Record<string, string> = {
  weekly_review: "Prepare a workspace review",
  release_draft: "Prepare a release-note draft",
  failure_alert: "Report delivery failures",
  mention_digest: "Summarize unresolved mentions",
};
function useRules() {
  const [data, setData] = useState<Rules | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      setData(await api<Rules>("/api/desk/rules"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  return { data, load, error };
}
export function RuleActivity() {
  const { data, error } = useRules();
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>Rule history</h2>
      </div>
      {error ? (
        <p className="box-body form-error">{error}</p>
      ) : data?.runs.length ? (
        <div className="box-body">
          {data.runs.map((r) => (
            <div key={r.id} className="metric-row">
              <span>{r.message}</span>
              <small>{new Date(r.created_at).toLocaleString()}</small>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={Activity} title="No completed rule runs" />
      )}
    </section>
  );
}
export function AutomationPage({ ws, toast, queue, go }: OpsProps) {
  const { data, load, error } = useRules(),
    [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [action, setAction] = useState("weekly_review"),
    [time, setTime] = useState("09:00"),
    [days, setDays] = useState(7),
    [source, setSource] = useState(""),
    [target, setTarget] = useState(""),
    [test, setTest] = useState(""),
    [busy, setBusy] = useState(false);
  const zone = ws?.settings.timezone || "Asia/Karachi";
  const update = async (method: string, input: unknown) => {
    setBusy(true);
    try {
      await api("/api/desk/rules", method, input);
      await load();
      setOpen(false);
      toast("Rule updated.");
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Automations</h1>
          <p>Schedule a private draft, review, or in-app alert.</p>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>
          <Plus size={15} />
          New rule
        </button>
      </div>
      <div className="ops-stack">
        <section className="panel">
          <div className="panel-header">
            <h2>Workspace rules</h2>
            <Pill>
              {queue?.paused ? "Workspace paused" : "Local actions only"}
            </Pill>
          </div>
          {error && <p className="notice">{error}</p>}
          {data?.rules.length ? (
            <div className="box-body fields">
              {data.rules.map((r) => (
                <div
                  className="fields"
                  style={{
                    borderBottom: "1px solid var(--line)",
                    paddingBottom: 10,
                  }}
                  key={r.id}
                >
                  <div>
                    <strong>{r.name}</strong>{" "}
                    <Pill>{r.enabled ? "Enabled" : "Disabled"}</Pill>
                    <p className="form-hint">
                      {actions[r.action]} ·{" "}
                      {r.every_days === 7 ? "Weekly" : "Daily"} at{" "}
                      {r.local_time} ({r.timezone}) ·{" "}
                      {r.account_id
                        ? "@" +
                          (ws?.accounts.find((a) => a.id === r.account_id)
                            ?.username || "disconnected")
                        : "Private workspace"}
                    </p>
                    <p className="form-hint">
                      Next run {dateLabel(r.next_run, r.timezone)} · No external
                      usage
                    </p>
                  </div>
                  <div className="btn-row">
                    <button
                      className="btn small"
                      onClick={async () => {
                        try {
                          const p = await api<{ message: string }>(
                            "/api/desk/rules",
                            "POST",
                            { action: "test", id: r.id },
                          );
                          setTest(p.message);
                        } catch (err) {
                          toast((err as Error).message);
                        }
                      }}
                    >
                      <Play size={13} />
                      Test
                    </button>
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() =>
                        update("PATCH", { id: r.id, enabled: !r.enabled })
                      }
                    >
                      {r.enabled ? "Disable" : "Enable"}
                    </button>
                    <button
                      className="text-link"
                      disabled={busy}
                      onClick={() => update("DELETE", { id: r.id })}
                    >
                      Delete rule
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              icon={Zap}
              title="Create your first rule"
              text="Prepare a weekly review or draft from a saved release note. Each run is recorded here."
            />
          )}
        </section>
        <RuleActivity />
        <section className="panel box-body">
          <h2>Autonomous replies</h2>
          <p>
            Disabled. Prepare individual replies in the conversation workspace.
          </p>
          <button className="text-link stack-gap" onClick={() => go("engage")}>
            Open Engage
          </button>
        </section>
      </div>
      {open && (
        <Dialog title="New workspace rule" onClose={() => setOpen(false)}>
          <form
            className="fields"
            onSubmit={(e) => {
              e.preventDefault();
              void update("POST", {
                action: "create",
                name,
                kind: action,
                every_days: days,
                local_time: time,
                timezone: zone,
                account_id: target || null,
                source_id: action === "release_draft" ? source : null,
              });
            }}
          >
            <label>
              Rule name
              <input
                maxLength={80}
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label>
              Action
              <select
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                {Object.entries(actions).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {action === "release_draft" && (
              <label>
                Knowledge source
                <select
                  required
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">Select saved knowledge</option>
                  {data?.sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Destination
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              >
                <option value="">Private workspace</option>
                {ws?.accounts.map((a) => (
                  <option value={a.id} key={a.id}>
                    @{a.username}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Repeat
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              >
                <option value={7}>Weekly</option>
                <option value={1}>Daily</option>
              </select>
            </label>
            <label>
              Local time ({zone})
              <input
                required
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </label>
            <p className="form-hint">
              Uses the first occurrence of a repeated local time and skips a
              missing occurrence. The worker must be running.
            </p>
            <button className="btn primary" disabled={busy}>
              Create rule
            </button>
          </form>
        </Dialog>
      )}
      {test && (
        <Dialog title="Rule test" onClose={() => setTest("")}>
          <p className="quote-preview">{test}</p>
          <p className="form-hint stack-gap">
            Preview only. No records or external actions were created.
          </p>
        </Dialog>
      )}
    </>
  );
}
const scopes = [
  "drafts:read",
  "drafts:create",
  "drafts:review",
  "jobs:read",
  "summary:read",
];
type Key = {
  id: string;
  label: string;
  expires: string;
  scopes: string;
  revoked: number;
};
export function AccessKeys({ toast }: { toast: (s: string) => void }) {
  const [keys, setKeys] = useState<Key[]>([]),
    [open, setOpen] = useState(false),
    [label, setLabel] = useState(""),
    [days, setDays] = useState(7),
    [selected, setSelected] = useState([scopes[0]]),
    [token, setToken] = useState(""),
    [account, setAccount] = useState(""),
    [accounts, setAccounts] = useState<{ id: string; username: string }[]>([]),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const d = await api<{ keys: Key[] }>("/api/desk/keys");
      setKeys(d.keys);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const d = await api<{ token: string }>("/api/desk/keys", "POST", {
        label,
        days,
        scopes: selected,
        account_id: account || null,
      });
      setToken(d.token);
      setOpen(false);
      await load();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <section className="panel">
      <div className="panel-header">
        <span className="panel-title">
          <KeyRound size={16} />
          <h2>Developer access</h2>
        </span>
        <button
          className="btn small"
          onClick={async () => {
            try {
              const w = await api<{
                accounts: { id: string; username: string }[];
              }>("/api/workspace");
              setAccounts(w.accounts);
              setOpen(true);
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        >
          Create key
        </button>
      </div>
      <div className="box-body">
        <p>
          Issue an expiring scoped credential for the developer API or local MCP
          bridge.
        </p>
        {error && <p className="form-error">{error}</p>}
        {keys.map((k) => (
          <div className="metric-row" key={k.id}>
            <span>
              <b>{k.label}</b> ·{" "}
              {k.revoked ? "Revoked" : k.expires.slice(0, 10)}
              <br />
              {JSON.parse(k.scopes).join(", ")}
            </span>
            {!k.revoked && (
              <button
                className="text-link"
                onClick={async () => {
                  try {
                    await api("/api/desk/keys", "DELETE", { id: k.id });
                    await load();
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
      {open && (
        <Dialog title="Create developer key" onClose={() => setOpen(false)}>
          <form className="fields" onSubmit={create}>
            <label>
              Name
              <input
                required
                maxLength={80}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              Account binding
              <select
                value={account}
                onChange={(e) => setAccount(e.target.value)}
              >
                <option value="">Unassigned drafts only</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    @{a.username}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Expires in days
              <input
                type="number"
                min="1"
                max="90"
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
            <fieldset>
              <legend>Scopes</legend>
              {scopes.map((s) => (
                <label style={{ display: "flex", gap: 7 }} key={s}>
                  <input
                    type="checkbox"
                    checked={selected.includes(s)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? [...selected, s]
                          : selected.filter((v) => v !== s),
                      )
                    }
                  />
                  {s}
                </label>
              ))}
            </fieldset>
            <button className="btn primary" disabled={!selected.length}>
              Generate key
            </button>
          </form>
        </Dialog>
      )}
      {token && (
        <Dialog title="Copy your developer key" onClose={() => setToken("")}>
          <div className="fields">
            <p className="form-hint">
              The key is shown once. Store it in your client’s secret settings.
            </p>
            <code className="quote-preview mono">{token}</code>
            <button
              className="btn"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(token);
                  toast("Key copied.");
                } catch {
                  toast("Select and copy the key above.");
                }
              }}
            >
              <Clipboard size={14} />
              Copy key
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
