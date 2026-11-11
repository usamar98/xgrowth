"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  Eye,
  FileClock,
  Layers3,
  Plus,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { api, downloadFile } from "@/lib/dashboard-types";
import {
  aiActions,
  blankDraft,
  editableStatuses,
  nativePostUrl,
  reviewClaims,
  type CreativeDraft,
  type CreativeState,
  type DraftFields,
  type Kind,
} from "@/lib/creative-types";
import { reviewText } from "@/lib/content";
import { splitNotes } from "@/lib/creative-split";
import { DraftMedia } from "./draft-media";
import { Dialog } from "./desk-ui";
type Version = { revision: number; created_at: string; fields: DraftFields };
export type EditorProps = {
  state: CreativeState;
  draft?: CreativeDraft;
  seed?: Partial<DraftFields>;
  refresh: () => void | Promise<void>;
  schedule?: (id: string) => void;
  embedded?: boolean;
  eligible?: boolean;
  onGeneration?: () => void;
};
export function Editor({
  state,
  draft,
  seed,
  refresh,
  schedule,
  embedded,
  eligible,
  onGeneration,
}: EditorProps) {
  const initial: DraftFields = {
    ...blankDraft,
    account_id: state.accounts[0]?.id || null,
    ...draft,
    ...seed,
  };
  const [form, setForm] = useState(initial),
    [identity, setIdentity] = useState(draft?.id || ""),
    [saveState, setSaveState] = useState(""),
    [error, setError] = useState(""),
    [generating, setGenerating] = useState(false),
    [history, setHistory] = useState<Version[] | null>(null),
    [historyRevision, setHistoryRevision] = useState(0),
    [task, setTask] = useState<string>(
      embedded ? "Concise reply" : "Improve hook",
    ),
    [context, setContext] = useState(false);
  const live = useRef(form),
    saved = useRef(draft ? JSON.stringify(initial) : ""),
    version = useRef({ id: draft?.id || "", revision: draft?.revision || 0 }),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    queue = useRef<Promise<unknown>>(Promise.resolve()),
    mounted = useRef(true);
  const locked = !!draft && !editableStatuses.includes(draft.status);
  const persist = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const write = async () => {
      const fields = live.current,
        serialized = JSON.stringify(fields);
      if (!fields.text.trim() && !fields.parts.some((p) => p.trim()))
        throw new Error("Write a draft first.");
      if (serialized === saved.current) return version.current;
      if (mounted.current) {
        setSaveState("Saving…");
        setError("");
      }
      const prev = version.current;
      const result = await api<{ id: string; revision: number }>(
        "/api/drafts",
        prev.id ? "PATCH" : "POST",
        { ...fields, ...(prev.id ? prev : {}) },
      );
      saved.current = serialized;
      version.current = result;
      if (mounted.current) {
        setIdentity(result.id);
        setSaveState("Saved · v" + result.revision);
      }
      return result;
    };
    const p = queue.current.then(write, write);
    queue.current = p;
    return p.catch((e) => {
      if (mounted.current) {
        setError((e as Error).message);
        setSaveState("Unsaved");
      }
      throw e;
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void persist().catch(() => {});
      }
    };
  }, [persist]);
  function change(p: Partial<DraftFields>) {
    const value = { ...live.current, ...p };
    live.current = value;
    setForm(value);
    setSaveState("Unsaved");
    if (timer.current) clearTimeout(timer.current);
    if (value.text.trim() || value.parts.some((x) => x.trim()))
      timer.current = setTimeout(() => {
        void persist().catch(() => {});
      }, 800);
  }
  function replace(d: CreativeDraft) {
    live.current = d;
    saved.current = JSON.stringify(d);
    version.current = { id: d.id, revision: d.revision };
    setIdentity(d.id);
    setForm(d);
    setSaveState("Saved · v" + d.revision);
  }
  async function reload() {
    const { draft: d } = await api<{ draft: CreativeDraft }>(
      "/api/drafts?id=" + version.current.id,
    );
    replace(d);
    await refresh();
  }
  async function action(fn: () => Promise<void>) {
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function getHistory() {
    const { id } = await persist();
    const data = await api<{ versions: Version[] }>("/api/drafts?id=" + id);
    setHistory(data.versions);
    setHistoryRevision(
      data.versions[1]?.revision || data.versions[0]?.revision || 0,
    );
  }
  function switchKind(kind: Kind) {
    if (kind === "thread") {
      try {
        const parts = form.parts.length ? form.parts : splitNotes(form.text);
        change({ kind, parts, text: parts[0] || "" });
      } catch (e) {
        setError((e as Error).message);
      }
    } else
      change({
        kind,
        text: form.kind === "thread" ? form.parts.join("\n\n") : form.text,
        parts: [],
      });
  }
  function setParts(parts: string[]) {
    change({ parts, text: parts[0] || "" });
  }
  const account = state.accounts.find((a) => a.id === form.account_id),
    count = reviewText(form.text),
    allText = form.kind === "thread" ? form.parts.join("\n\n") : form.text,
    target = nativePostUrl(form.target_id);
  const warnings = reviewClaims(
    allText,
    state.entries.filter((e) => form.knowledge_ids.includes(e.id)),
  );
  const words = (s: string) =>
    new Set(s.toLowerCase().trim().split(/\s+/).filter(Boolean));
  const tokens = words(allText),
    similar =
      allText.trim().length > 10 &&
      state.drafts.some((d) => {
        if (d.id === identity) return false;
        const other = words(d.text),
          both = [...tokens].filter((t) => other.has(t)).length;
        return both / Math.max(1, tokens.size + other.size - both) > 0.7;
      });
  const historyItem = history?.find((v) => v.revision === historyRevision);
  const preview = (
    <div className="cr-preview">
      <div className="cr-profile">
        <span className="cr-avatar">{(account?.name || "S").slice(0, 1)}</span>
        <span>
          <b>{account?.name || "Your profile"}</b>
          <small>{account ? "@" + account.username : "Account preview"}</small>
        </span>
        <span className="cr-x">𝕏</span>
      </div>
      {(form.kind === "thread" ? form.parts : [form.text]).map((part, i) => (
        <p className={!part ? "cr-placeholder" : ""} key={i}>
          {part || "Your post preview will appear here."}
        </p>
      ))}
    </div>
  );
  return (
    <div className="creative">
      <div className={embedded ? "" : "cr-grid"}>
        <section className="panel cr-editor">
          <div className="cr-bar">
            <h2>{embedded ? "Your reply" : "Writing desk"}</h2>
            <span aria-live="polite">
              {saveState ||
                (draft ? "Saved · v" + draft.revision : "New draft")}
            </span>
          </div>
          {!embedded && (
            <div className="cr-tabs" aria-label="Post format">
              {(["post", "thread", "reply", "quote"] as Kind[]).map((k) => (
                <button
                  disabled={locked || generating}
                  aria-pressed={form.kind === k}
                  key={k}
                  onClick={() => switchKind(k)}
                >
                  {k === "post" ? "Post" : k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          )}
          <fieldset disabled={locked || generating} className="cr-fieldset">
            {!embedded && (
              <label>
                Account
                <select
                  value={form.account_id || ""}
                  onChange={(e) =>
                    change({ account_id: e.target.value || null })
                  }
                >
                  <option value="">Choose later</option>
                  {state.accounts.map((a) => (
                    <option value={a.id} key={a.id}>
                      @{a.username}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {["reply", "quote"].includes(form.kind) && !embedded && (
              <label>
                Original X post ID
                <input
                  inputMode="numeric"
                  value={form.target_id || ""}
                  maxLength={20}
                  onChange={(e) =>
                    change({
                      target_id: e.target.value.replace(/\D/g, "") || null,
                    })
                  }
                />
              </label>
            )}
            {form.kind === "reply" && (
              <label>
                Reply intent
                <select
                  value={form.intent}
                  onChange={(e) => change({ intent: e.target.value })}
                >
                  {["answer", "clarify", "thank", "correct", "continue"].map(
                    (t) => (
                      <option key={t}>{t}</option>
                    ),
                  )}
                </select>
              </label>
            )}
            {form.kind === "thread" ? (
              <div className="cr-stack">
                {form.parts.map((part, i) => (
                  <div className="cr-part" key={i}>
                    <label>
                      Part {i + 1}
                      <textarea
                        value={part}
                        maxLength={4000}
                        onChange={(e) =>
                          setParts(
                            form.parts.map((v, j) =>
                              i === j ? e.target.value : v,
                            ),
                          )
                        }
                      />
                    </label>
                    <div className="cr-row">
                      <small>{reviewText(part).length} / 280</small>
                      {[-1, 1].map((n) => (
                        <button
                          aria-label={
                            (n < 0 ? "Move up " : "Move down ") + (i + 1)
                          }
                          disabled={
                            !form.parts[i + n] && form.parts[i + n] !== ""
                          }
                          key={n}
                          onClick={() => {
                            const p = [...form.parts];
                            [p[i], p[i + n]] = [p[i + n], p[i]];
                            setParts(p);
                          }}
                        >
                          {n < 0 ? (
                            <ArrowUp size={14} />
                          ) : (
                            <ArrowDown size={14} />
                          )}
                        </button>
                      ))}
                      <button
                        aria-label={"Remove part " + (i + 1)}
                        disabled={form.parts.length === 1}
                        onClick={() =>
                          setParts(form.parts.filter((_, j) => i !== j))
                        }
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  className="btn"
                  disabled={form.parts.length >= 20}
                  onClick={() => setParts([...form.parts, ""])}
                >
                  <Plus size={15} /> Add part
                </button>
              </div>
            ) : (
              <label className="cr-write">
                {embedded ? "Reply text" : "Post text"}
                <textarea
                  aria-label={embedded ? "Reply text" : "Post text"}
                  placeholder={
                    embedded
                      ? "Write a thoughtful reply…"
                      : "What would you like to share?"
                  }
                  value={form.text}
                  maxLength={4000}
                  onChange={(e) => change({ text: e.target.value })}
                />
                <small className={count.length > 280 ? "cr-error" : ""}>
                  {count.length} / 280 weighted characters
                </small>
              </label>
            )}
            <details>
              <summary>Sources and organization</summary>
              <div className="cr-stack">
                {[
                  ["Campaign", "campaign", "campaign_id"],
                  ["Voice", "voice", "voice_id"],
                ].map(([label, kind, field]) => (
                  <label key={field}>
                    {label}
                    <select
                      value={form[field as "campaign_id" | "voice_id"] || ""}
                      onChange={(e) =>
                        change({ [field]: e.target.value || null })
                      }
                    >
                      <option value="">None selected</option>
                      {state.entries
                        .filter((x) => x.kind === kind)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.title}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
                <label>
                  Folder
                  <input
                    value={form.folder}
                    onChange={(e) => change({ folder: e.target.value })}
                  />
                </label>
                <label>
                  Tags, comma-separated
                  <input
                    value={form.tags.join(",")}
                    onChange={(e) =>
                      change({ tags: e.target.value.split(",").slice(0, 16) })
                    }
                  />
                </label>
                <div>
                  <b>Approved knowledge</b>
                  {state.entries.filter((e) => e.kind === "knowledge")
                    .length === 0 && <p>Add sources in Voice & knowledge.</p>}
                  {state.entries
                    .filter((e) => e.kind === "knowledge")
                    .map((e) => (
                      <label className="cr-check" key={e.id}>
                        <input
                          type="checkbox"
                          checked={form.knowledge_ids.includes(e.id)}
                          onChange={(event) =>
                            change({
                              knowledge_ids: event.target.checked
                                ? [...form.knowledge_ids, e.id].slice(0, 6)
                                : form.knowledge_ids.filter(
                                    (id) => id !== e.id,
                                  ),
                            })
                          }
                        />
                        {e.title}
                      </label>
                    ))}
                </div>
                <label>
                  Insert snippet
                  <select
                    value=""
                    onChange={(e) => {
                      const s = state.entries.find(
                        (x) => x.id === e.target.value,
                      );
                      if (s)
                        change({
                          text: form.text + (form.text ? "\n" : "") + s.content,
                        });
                    }}
                  >
                    <option value="">Select a saved snippet</option>
                    {state.entries
                      .filter((x) => x.kind === "snippet")
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.title}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </details>
            <details>
              <summary>
                <Sparkles size={14} /> Writing assistance
              </summary>
              {state.ai ? (
                <div className="cr-stack">
                  <label>
                    Editing task
                    <select
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                    >
                      {aiActions.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  {form.kind === "reply" && (
                    <label className="cr-check">
                      <input
                        type="checkbox"
                        checked={context}
                        onChange={(e) => setContext(e.target.checked)}
                      />{" "}
                      Include original post text
                    </label>
                  )}
                  <small>
                    Uses this draft and selected sources in your local Ollama
                    model. A suggestion creates a new revision.
                  </small>
                  <button
                    className="btn"
                    disabled={
                      !form.text.trim() || generating || form.kind === "thread"
                    }
                    onClick={() =>
                      void action(async () => {
                        const v = await persist();
                        setGenerating(true);
                        try {
                          await api("/api/creative", "POST", {
                            action: "generate",
                            draft_id: v.id,
                            revision: v.revision,
                            task,
                            include_context: context,
                          });
                          await reload();
                          onGeneration?.();
                        } finally {
                          setGenerating(false);
                        }
                      })
                    }
                  >
                    <Sparkles size={15} />{" "}
                    {generating ? "Generating…" : "Generate revision"}
                  </button>
                </div>
              ) : (
                <p>
                  Set OLLAMA_MODEL to an installed local model to enable
                  suggestions.
                </p>
              )}
            </details>
          </fieldset>
          {similar && (
            <p className="cr-help">
              This draft closely resembles another draft in your workspace.
            </p>
          )}
          {warnings.length > 0 && (
            <details>
              <summary>Claims to check ({warnings.length})</summary>
              <p>These statements need a matching source or your review.</p>
              {warnings.map((line, i) => (
                <blockquote key={i}>{line}</blockquote>
              ))}
            </details>
          )}
          <div className="cr-row">
            <button
              className="btn primary"
              disabled={locked || generating || !allText.trim()}
              onClick={() =>
                void action(async () => {
                  await persist();
                  await refresh();
                })
              }
            >
              <Save size={15} /> Save draft
            </button>
            <button
              className="btn"
              disabled={!allText.trim()}
              onClick={() =>
                void action(async () => {
                  if (!locked) await persist();
                  await navigator.clipboard.writeText(allText);
                  setSaveState("Copied");
                })
              }
            >
              <Copy size={15} /> {embedded ? "Copy reply" : "Copy"}
            </button>
            {target && (
              <a className="btn" href={target} target="_blank" rel="noreferrer">
                Open original on X <ExternalLink size={13} />
              </a>
            )}
            {(identity || form.text) && (
              <button
                className="btn"
                disabled={locked}
                onClick={() => void action(getHistory)}
              >
                <FileClock size={15} /> History
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="cr-error">
              {error}
            </p>
          )}
          {locked && (
            <p className="cr-help">
              This {draft?.status} version is read-only.
            </p>
          )}
          {(!embedded || eligible) && (
            <div className="cr-foot">
              <small>
                {account
                  ? "Publishing account · @" + account.username
                  : "Connect an X account to schedule."}
                {form.kind === "post"
                  ? " · Estimated $" + (count.cost / 1e6).toFixed(3)
                  : form.kind === "reply" && !count.hasUrl
                    ? " · Eligible text reply estimate $0.010"
                    : " · Publication cost unverified"}
              </small>
              <button
                className="btn"
                disabled={
                  locked ||
                  !account ||
                  !form.text.trim() ||
                  !["post", "reply"].includes(form.kind) ||
                  (form.kind === "reply" &&
                    (form.provenance === "ai" || !eligible))
                }
                onClick={() =>
                  void action(async () => {
                    const { id } = await persist();
                    await refresh();
                    schedule?.(id);
                  })
                }
              >
                <Check size={14} /> Review & schedule
              </button>
            </div>
          )}
        </section>
        {!embedded && (
          <aside className="cr-stack">
            <section className="panel cr-editor">
              <div className="cr-bar">
                <h2>
                  <Eye size={17} /> X preview
                </h2>
              </div>
              {preview}
            </section>
            {identity && !locked && (
              <section className="panel cr-editor">
                <DraftMedia id={identity} refresh={reload} />
              </section>
            )}
            <button
              className="btn"
              disabled={!allText.trim()}
              onClick={() =>
                downloadFile(
                  "signaldesk-draft.json",
                  JSON.stringify(
                    { format: "signaldesk-draft-v1", draft: form },
                    null,
                    2,
                  ),
                )
              }
            >
              <Layers3 size={15} /> Export draft
            </button>
          </aside>
        )}
      </div>
      {history && (
        <Dialog title="Revision history" onClose={() => setHistory(null)}>
          <div className="cr-stack">
            <label>
              Compare with current draft
              <select
                value={historyRevision}
                onChange={(e) => setHistoryRevision(Number(e.target.value))}
              >
                {history.map((v) => (
                  <option value={v.revision} key={v.revision}>
                    Version {v.revision} ·{" "}
                    {new Date(v.created_at).toLocaleString()}
                  </option>
                ))}
              </select>
            </label>
            <b>Selected revision</b>
            <div className="cr-version">
              {historyItem?.fields.kind === "thread"
                ? historyItem.fields.parts.join("\n\n")
                : historyItem?.fields.text}
            </div>
            <b>Current draft</b>
            <div className="cr-version">{allText}</div>
            <button
              className="btn primary"
              disabled={
                !historyItem || historyRevision === history[0]?.revision
              }
              onClick={() => {
                if (historyItem) {
                  change({
                    ...historyItem.fields,
                    provenance:
                      form.provenance === "ai"
                        ? "ai"
                        : historyItem.fields.provenance,
                  });
                  setHistory(null);
                  void action(async () => {
                    await persist();
                  });
                }
              }}
            >
              Restore as a new revision
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
