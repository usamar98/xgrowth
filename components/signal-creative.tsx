"use client";
import { useCallback, useEffect, useState } from "react";
import {
  Download,
  FilePenLine,
  FileText,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { api, downloadFile } from "@/lib/dashboard-types";
import {
  type CreativeState,
  type CreativeDraft,
  type DraftFields,
} from "@/lib/creative-types";
import { Editor } from "./creative-editor";
import { InboxWorkspace } from "./creative-inbox";
import { Library } from "./creative-library";
import { Dialog, Empty, Pill } from "./desk-ui";
import "./signal-creative.css";
type Props = {
  view: string;
  navigate: (view: string, id?: string) => void;
  refresh: () => void | Promise<void>;
  initialDraftId?: string;
  initialText?: string;
  onSchedule?: (draftId: string) => void;
};
function DraftList({
  state,
  navigate,
  refresh,
}: {
  state: CreativeState;
  navigate: Props["navigate"];
  refresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [status, setStatus] = useState("all"),
    [remove, setRemove] = useState<CreativeDraft | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const visible = state.drafts.filter(
    (d) =>
      (status === "all" || status === d.status) &&
      (d.text + " " + d.folder + " " + d.tags.join(" ") + " " + d.kind)
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  async function importOne(file: File) {
    if (file.size > 20000)
      throw new Error("Choose a single draft JSON file under 20 KB.");
    const pkg = JSON.parse(await file.text());
    if (
      pkg?.format !== "signaldesk-draft-v1" ||
      !pkg.draft ||
      typeof pkg.draft.text !== "string"
    )
      throw new Error("Choose a SignalDesk draft export.");
    const src = pkg.draft as Partial<DraftFields>;
    const result = await api<{ id: string }>("/api/drafts", "POST", {
      ...src,
      id: undefined,
      revision: undefined,
      account_id: null,
      planned_at: null,
      campaign_id: null,
      knowledge_ids: [],
      voice_id: null,
      provenance: src.kind === "reply" ? "ai" : src.provenance,
    });
    await refresh();
    navigate("compose", result.id);
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Drafts</h1>
          <p>Your writing, revisions, and review queue.</p>
        </div>
        <button className="btn primary" onClick={() => navigate("compose")}>
          <Plus size={15} /> New draft
        </button>
      </div>
      <section className="panel cr-library">
        <div className="cr-bar">
          <label className="cr-search">
            <Search size={15} />
            <input
              aria-label="Search drafts"
              value={query}
              placeholder="Search text, tags, or folder"
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="cr-row">
            <select
              aria-label="Draft status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">All statuses</option>
              {[...new Set(state.drafts.map((d) => d.status))].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <label className="btn cr-upload">
              <Upload size={14} /> Import
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) {
                    try {
                      setError("");
                      await importOne(f);
                    } catch (err) {
                      setError((err as Error).message);
                    }
                  }
                }}
              />
            </label>
          </div>
        </div>
        {visible.length ? (
          <div>
            {visible.map((d) => (
              <article className="cr-draft-row" key={d.id}>
                <FileText size={17} />
                <button onClick={() => navigate("compose", d.id)}>
                  <b>{d.text || d.parts[0] || "Untitled draft"}</b>
                  <small>
                    {d.kind} · {d.folder ? d.folder + " · " : ""}v{d.revision} ·{" "}
                    {new Date(d.updated_at).toLocaleDateString()}
                  </small>
                </button>
                <Pill>{d.status}</Pill>
                <button
                  className="icon-btn"
                  aria-label="Export this draft"
                  onClick={() =>
                    downloadFile(
                      "signaldesk-draft.json",
                      JSON.stringify(
                        { format: "signaldesk-draft-v1", draft: d },
                        null,
                        2,
                      ),
                    )
                  }
                >
                  <Download size={15} />
                </button>
                {[
                  "draft",
                  "planned",
                  "canceled",
                  "failed",
                  "blocked",
                  "pending_review",
                ].includes(d.status) && (
                  <button
                    className="icon-btn"
                    aria-label="Remove this draft"
                    onClick={() => setRemove(d)}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={FilePenLine}
            title={
              state.drafts.length
                ? "No matching drafts"
                : "Your draft library is ready"
            }
            text={
              state.drafts.length
                ? "Try another search or status."
                : "Start an original post, thread, quote, or reply."
            }
            action={
              <button className="btn" onClick={() => navigate("compose")}>
                <Plus size={14} /> Create draft
              </button>
            }
          />
        )}
      </section>
      {error && (
        <p className="cr-error" role="alert">
          {error}
        </p>
      )}
      {remove && (
        <Dialog title="Remove saved draft?" onClose={() => setRemove(null)}>
          <p>{remove.text.slice(0, 160)}</p>
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              try {
                setBusy(true);
                await api("/api/drafts", "DELETE", {
                  id: remove.id,
                  revision: remove.revision,
                });
                await refresh();
                setRemove(null);
              } catch (e) {
                setError((e as Error).message);
                setRemove(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            Remove draft and versions
          </button>
        </Dialog>
      )}
    </>
  );
}
export function SignalCreative({
  view,
  navigate,
  refresh,
  initialDraftId,
  initialText,
  onSchedule,
}: Props) {
  const [state, setState] = useState<CreativeState | null>(null),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const data = await api<CreativeState>("/api/creative");
    setState(data);
    setError("");
  }, []);
  useEffect(() => {
    let current = true;
    api<CreativeState>("/api/creative")
      .then((s) => {
        if (current) setState(s);
      })
      .catch((e) => {
        if (current) setError(e.message);
      });
    return () => {
      current = false;
    };
  }, []);
  const reload = async () => {
    await load();
    await refresh();
  };
  if (error)
    return (
      <div className="notice" role="alert">
        {error}
        <button onClick={() => void load().catch((e) => setError(e.message))}>
          Retry
        </button>
      </div>
    );
  if (!state)
    return (
      <div className="loading-card" role="status">
        Loading your workspace…
      </div>
    );
  if (
    view === "compose" &&
    initialDraftId &&
    !state.drafts.some((d) => d.id === initialDraftId)
  )
    return (
      <div className="notice" role="alert">
        This draft is unavailable.
        <button onClick={() => navigate("drafts")}>Open drafts</button>
      </div>
    );
  return (
    <div className="creative">
      {view === "compose" ? (
        <>
          <div className="page-heading">
            <div>
              <h1>Compose</h1>
              <p>Write, revise, and review your next post.</p>
            </div>
          </div>
          <Editor
            draft={state.drafts.find((d) => d.id === initialDraftId)}
            state={state}
            seed={initialText ? { text: initialText } : undefined}
            refresh={reload}
            schedule={onSchedule}
          />
        </>
      ) : view === "drafts" ? (
        <DraftList state={state} navigate={navigate} refresh={reload} />
      ) : view === "engage" ? (
        <InboxWorkspace
          state={state}
          navigate={navigate}
          refresh={reload}
          schedule={onSchedule}
        />
      ) : (
        <Library
          view={view}
          state={state}
          navigate={navigate}
          refresh={reload}
        />
      )}
    </div>
  );
}
export default SignalCreative;
