export type Kind = "post" | "thread" | "reply" | "quote";
export type EntryKind = "voice" | "knowledge" | "campaign" | "idea" | "snippet";
export interface CreativeEntry {
  id: string;
  kind: EntryKind;
  title: string;
  content: string;
  tags: string[];
  details: Record<string, string>;
  revision: number;
  updated_at: string;
}
export interface DraftFields {
  text: string;
  pillar: "Teach" | "Show" | "Ask";
  account_id: string | null;
  planned_at: string | null;
  kind: Kind;
  target_id: string | null;
  parts: string[];
  folder: string;
  tags: string[];
  campaign_id: string | null;
  knowledge_ids: string[];
  voice_id: string | null;
  intent: string;
  provenance: "ai" | "manual";
}
export interface CreativeDraft extends DraftFields {
  id: string;
  revision: number;
  status: string;
  updated_at: string;
  created_at: string;
}
export interface InboxItem {
  account_id: string;
  post_id: string;
  author_id: string;
  author_name: string;
  author_username: string;
  text: string;
  created_at: string;
  fetched_at: string;
  source: string;
  status: string;
  note: string;
  snoozed_until: string | null;
  labels: string[];
  campaign_id: string | null;
  opt_out: number;
}
export interface CreativeState {
  accounts: { id: string; name: string; username: string }[];
  entries: CreativeEntry[];
  drafts: CreativeDraft[];
  items: InboxItem[];
  ai: boolean;
}
export const blankDraft: DraftFields = {
  text: "",
  pillar: "Teach",
  kind: "post",
  target_id: null,
  parts: [],
  folder: "",
  tags: [],
  campaign_id: null,
  knowledge_ids: [],
  voice_id: null,
  intent: "answer",
  provenance: "manual",
  account_id: null,
  planned_at: null,
};
export const editableStatuses = [
  "draft",
  "planned",
  "pending_review",
  "approved",
  "scheduled",
  "failed",
  "blocked",
  "canceled",
];
export const nativePostUrl = (id: string | null) =>
  id && /^\d{1,20}$/.test(id) ? "https://x.com/i/web/status/" + id : null;
export function createUtm(raw: string, campaign: string) {
  const url = new URL(raw);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Enter an HTTP or HTTPS URL.");
  for (const [key, value] of Object.entries({
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: campaign,
  }))
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  return url.toString();
}
export function reviewClaims(text: string, entries: CreativeEntry[]) {
  const facts = entries.map((e) => e.content.toLowerCase());
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .filter(
      (line) =>
        /\d|guarantee|first ever|industry.leading|only platform|fastest/i.test(
          line,
        ) && !facts.some((f) => f.includes(line.toLowerCase().trim())),
    )
    .slice(0, 6);
}
export const aiActions = [
  "Brainstorm",
  "Product update",
  "Improve hook",
  "Shorten",
  "Simplify",
  "Alternative ending",
  "Concise reply",
  "Informative reply",
  "Conversational reply",
  "Technical reply",
] as const;
