"use client";
import { useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  FilePenLine,
  FolderOpen,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { api } from "@/lib/dashboard-types";
import { splitNotes } from "@/lib/creative-split";
import {
  createUtm,
  type CreativeState,
  type CreativeEntry,
  type EntryKind,
} from "@/lib/creative-types";
import { Dialog, Empty, Pill } from "./desk-ui";
const labels: Record<EntryKind, string> = {
  voice: "Voice profile",
  knowledge: "Knowledge entry",
  campaign: "Campaign",
  snippet: "Snippet",
  idea: "Saved idea",
};
const fields: Record<EntryKind, Record<string, string>> = {
  voice: {
    tone: "Tone",
    language: "Writing language",
    sentence_length: "Sentence length",
    vocabulary: "Preferred vocabulary",
    banned: "Banned phrases",
    claims: "Prohibited claims",
    cta: "Preferred call to action",
    examples: "Selected writing examples",
  },
  knowledge: {
    category: "Category",
    source: "Approved source URL",
    date: "Effective date",
  },
  campaign: { audience: "Audience", goal: "Success measure" },
  snippet: { category: "Collection" },
  idea: { url: "Original link", collection: "Collection" },
};
const bodyLabels: Record<EntryKind, string> = {
  voice: "Writing preferences",
  knowledge: "Approved facts or FAQ answer",
  campaign: "Goal and brief",
  snippet: "Reusable text",
  idea: "Private notes",
};
function entryForm(kind: EntryKind): CreativeEntry {
  return {
    id: "",
    revision: 0,
    kind,
    title: "",
    content: "",
    tags: [],
    details: {},
    updated_at: "",
  };
}
export function Library({
  view,
  state,
  refresh,
  navigate,
}: {
  view: string;
  state: CreativeState;
  refresh: () => Promise<void>;
  navigate: (view: string, id?: string) => void;
}) {
  const [kind, setKind] = useState<EntryKind>(
      view === "campaigns"
        ? "campaign"
        : view === "inspiration"
          ? "idea"
          : "voice",
    ),
    [query, setQuery] = useState(""),
    [editing, setEditing] = useState<CreativeEntry | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [remove, setRemove] = useState(false),
    [utm, setUtm] = useState(""),
    [utmResult, setUtmResult] = useState("");
  const list = state.entries.filter(
    (e) =>
      e.kind === kind &&
      (
        e.title +
        " " +
        e.content +
        " " +
        e.tags +
        " " +
        Object.values(e.details)
      )
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const Icon =
      kind === "campaign" ? FolderOpen : kind === "idea" ? Bookmark : BookOpen,
    title =
      view === "campaigns"
        ? "Campaigns"
        : view === "inspiration"
          ? "Inspiration"
          : "Voice & knowledge";
  function edit(entry: CreativeEntry) {
    setEditing({ ...entry, details: { ...entry.details } });
    setError("");
    setRemove(false);
    setUtm("");
    setUtmResult("");
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!editing) return;
    await api("/api/creative", "POST", {
      ...editing,
      id: editing.id || undefined,
      revision: editing.revision || undefined,
      action: "entry",
    });
    await refresh();
    setEditing(null);
  }
  function derive(entry: CreativeEntry, thread = false) {
    return run(async () => {
      const data =
        entry.kind === "campaign"
          ? { text: entry.content || entry.title, campaign_id: entry.id }
          : entry.kind === "knowledge"
            ? { text: entry.content || entry.title, knowledge_ids: [entry.id] }
            : entry.kind === "voice"
              ? { text: "Writing brief: " + entry.title, voice_id: entry.id }
              : entry.kind === "idea"
                ? {
                    text: "Idea to develop: " + entry.title,
                    folder: "Inspiration",
                    tags: entry.tags,
                  }
                : { text: entry.content };
      const parts = thread ? splitNotes(data.text) : [];
      const draft = await api<{ id: string }>("/api/drafts", "POST", {
        ...data,
        account_id: state.accounts[0]?.id || null,
        kind: thread ? "thread" : "post",
        parts,
      });
      await refresh();
      navigate("compose", draft.id);
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          <p>
            {view === "campaigns"
              ? "Organize posts and replies around a shared goal."
              : view === "inspiration"
                ? "Keep references and develop them into original ideas."
                : "Choose how you sound and which product facts a draft can use."}
          </p>
        </div>
        <button className="btn primary" onClick={() => edit(entryForm(kind))}>
          <Plus size={15} />{" "}
          {kind === "idea" ? "Save idea" : "New " + labels[kind].toLowerCase()}
        </button>
      </div>
      <section className="panel cr-library">
        {view === "voice" && (
          <div className="cr-tabs">
            {(["voice", "knowledge", "snippet"] as EntryKind[]).map((k) => (
              <button
                aria-pressed={kind === k}
                key={k}
                onClick={() => {
                  setKind(k);
                  setQuery("");
                }}
              >
                {k === "voice"
                  ? "Voice profiles"
                  : k === "knowledge"
                    ? "Knowledge"
                    : "Snippets & CTAs"}
              </button>
            ))}
          </div>
        )}
        <div className="cr-bar">
          <h2>
            <Icon size={18} />
            {labels[kind]}
            {kind === "knowledge" ? " library" : "s"}
          </h2>
          <label className="cr-search">
            <Search size={15} />
            <input
              aria-label="Search library"
              placeholder="Search entries or tags"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {list.length ? (
          <div className="cr-cards">
            {list.map((e) => (
              <article key={e.id}>
                <small>
                  {e.details.category || e.details.collection || labels[e.kind]}
                </small>
                <h3>{e.title}</h3>
                <p>{e.content}</p>
                {e.kind === "campaign" && (
                  <small>
                    {state.drafts.filter((d) => d.campaign_id === e.id).length}{" "}
                    assigned drafts ·{" "}
                    {state.items.filter((i) => i.campaign_id === e.id).length}{" "}
                    conversations
                  </small>
                )}
                <div className="cr-row">
                  {e.tags.filter(Boolean).map((t, i) => (
                    <Pill key={i}>{t}</Pill>
                  ))}
                </div>
                <div className="cr-row">
                  <button className="btn" onClick={() => edit(e)}>
                    Open <ArrowUpRight size={13} />
                  </button>
                  <button
                    disabled={busy}
                    className="btn"
                    onClick={() => void derive(e)}
                  >
                    <FilePenLine size={14} /> Draft
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <Empty
            icon={Icon}
            title={
              query
                ? "No matching entries"
                : "No " +
                  (kind === "knowledge"
                    ? "knowledge entries"
                    : kind === "idea"
                      ? "saved ideas"
                      : labels[kind].toLowerCase() + "s") +
                  " yet"
            }
            text={
              query
                ? "Try another title, tag, or phrase."
                : kind === "knowledge"
                  ? "Add an approved FAQ, release note, or feature description."
                  : kind === "voice"
                    ? "Save your tone, preferred language, examples, and claim boundaries."
                    : kind === "campaign"
                      ? "Create a campaign to group writing, conversations, and results."
                      : "Add a reference you want to use later."
            }
            action={
              <button className="btn" onClick={() => edit(entryForm(kind))}>
                <Plus size={14} /> Add {labels[kind].toLowerCase()}
              </button>
            }
          />
        )}
      </section>
      {error && !editing && (
        <p role="alert" className="cr-error">
          {error}
        </p>
      )}
      {editing && (
        <Dialog
          title={(editing.id ? "Edit " : "New ") + labels[kind].toLowerCase()}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <div className="creative cr-stack">
            <label>
              Name
              <input
                autoFocus
                value={editing.title}
                maxLength={120}
                onChange={(e) =>
                  setEditing({ ...editing, title: e.target.value })
                }
              />
            </label>
            <label>
              {bodyLabels[kind]}
              <textarea
                value={editing.content}
                maxLength={6000}
                onChange={(e) =>
                  setEditing({ ...editing, content: e.target.value })
                }
              />
            </label>
            {kind === "knowledge" && (
              <label className="btn cr-upload">
                <Upload size={14} /> Load text file
                <input
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 12000) {
                      setError("Choose a text file under 12 KB.");
                      return;
                    }
                    const text = await file.text();
                    if (text.length > 6000) {
                      setError("Use up to 6,000 characters per entry.");
                      return;
                    }
                    setEditing({ ...editing, content: text });
                  }}
                />
              </label>
            )}
            <div className="cr-input-grid">
              {Object.entries(fields[kind]).map(([key, label]) => (
                <label key={key}>
                  {label}
                  {key === "examples" ? (
                    <textarea
                      value={editing.details[key] || ""}
                      maxLength={900}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          details: {
                            ...editing.details,
                            [key]: e.target.value,
                          },
                        })
                      }
                    />
                  ) : (
                    <input
                      value={editing.details[key] || ""}
                      maxLength={900}
                      placeholder={
                        key === "language"
                          ? "English, Urdu, or Roman Urdu"
                          : undefined
                      }
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          details: {
                            ...editing.details,
                            [key]: e.target.value,
                          },
                        })
                      }
                    />
                  )}
                </label>
              ))}
            </div>
            {kind === "voice" && editing.details.examples && (
              <button
                className="btn"
                onClick={() => {
                  const sentences = editing.details.examples
                      .split(/[.!?\n]+/)
                      .filter((s) => s.trim()),
                    words = editing.details.examples.trim().split(/\s+/);
                  setEditing({
                    ...editing,
                    details: {
                      ...editing.details,
                      sentence_length:
                        "About " +
                        Math.round(
                          words.length / Math.max(1, sentences.length),
                        ) +
                        " words per sentence in selected examples",
                    },
                  });
                }}
              >
                Suggest sentence length from these examples
              </button>
            )}
            <label>
              Tags, comma-separated
              <input
                value={editing.tags.join(",")}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    tags: e.target.value.split(",").slice(0, 16),
                  })
                }
              />
            </label>
            {kind === "campaign" && (
              <details>
                <summary>Campaign link builder</summary>
                <label>
                  Destination URL
                  <input
                    type="url"
                    value={utm}
                    onChange={(e) => setUtm(e.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  onClick={() => {
                    try {
                      setUtmResult(createUtm(utm, editing.title));
                      setError("");
                    } catch {
                      setError("Enter a valid HTTP or HTTPS URL.");
                    }
                  }}
                >
                  Build UTM link
                </button>
                {utmResult && (
                  <label>
                    Campaign URL
                    <input
                      readOnly
                      value={utmResult}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                )}
              </details>
            )}
            {error && (
              <p className="cr-error" role="alert">
                {error}
              </p>
            )}
            <div className="cr-row">
              <button
                className="btn primary"
                disabled={!editing.title.trim() || busy}
                onClick={() => void run(save)}
              >
                Save {labels[kind].toLowerCase()}
              </button>
              {editing.id && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => setRemove(true)}
                >
                  Remove
                </button>
              )}
            </div>
            {editing.id && kind === "knowledge" && (
              <div className="cr-row">
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void derive(
                      state.entries.find((e) => e.id === editing.id)!,
                      true,
                    )
                  }
                >
                  Draft thread from saved entry
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api("/api/creative", "POST", {
                        action: "entry",
                        kind: "snippet",
                        title: editing.title,
                        content: editing.content,
                        tags: [],
                        details: { category: "FAQ" },
                      });
                      await refresh();
                      setEditing(null);
                      setKind("snippet");
                    })
                  }
                >
                  Use as reply snippet
                </button>
              </div>
            )}
            {remove && (
              <div className="cr-policy">
                <p>Remove “{editing.title}” from your library?</p>
                <button
                  className="btn"
                  onClick={() =>
                    void run(async () => {
                      await api("/api/creative", "DELETE", {
                        id: editing.id,
                        revision: editing.revision,
                      });
                      await refresh();
                      setEditing(null);
                    })
                  }
                >
                  Confirm removal
                </button>
                <button className="btn" onClick={() => setRemove(false)}>
                  Keep entry
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
