import { z } from "zod";
import { AppError, database } from "./server";
import {
  blankDraft,
  editableStatuses,
  type CreativeDraft,
  type CreativeEntry,
  type DraftFields,
} from "./creative-types";
const nullableId = z.string().uuid().nullable();
const tags = z.array(z.string().trim().max(50)).max(16);
export const draftSchema = z.object({
  id: z.string().uuid().optional(),
  revision: z.number().int().positive().optional(),
  text: z.string().max(4000),
  pillar: z.enum(["Teach", "Show", "Ask"]).default("Teach"),
  account_id: nullableId.default(null),
  planned_at: z.string().datetime().nullable().default(null),
  kind: z.enum(["post", "reply", "thread", "quote"]).default("post"),
  target_id: z
    .string()
    .regex(/^\d{1,20}$/)
    .nullable()
    .default(null),
  parts: z.array(z.string().max(4000)).max(20).default([]),
  folder: z.string().trim().max(100).default(""),
  tags: tags.default([]),
  campaign_id: nullableId.default(null),
  knowledge_ids: z.array(z.string().uuid()).max(6).default([]),
  voice_id: nullableId.default(null),
  intent: z
    .enum(["answer", "clarify", "thank", "correct", "continue"])
    .default("answer"),
  provenance: z.enum(["manual", "ai"]).default("manual"),
});
export const entrySchema = z.object({
  id: z.string().uuid().optional(),
  revision: z.number().int().positive().optional(),
  kind: z.enum(["campaign", "voice", "knowledge", "idea", "snippet"]),
  title: z.string().trim().min(1).max(120),
  content: z.string().max(6000),
  details: z
    .record(z.string().max(40), z.string().max(900))
    .refine((d) => Object.keys(d).length <= 12),
  tags,
});
function parse<T>(v: unknown, otherwise: T): T {
  return typeof v === "string" ? JSON.parse(v) : otherwise;
}
export function readFields(row: Record<string, unknown>): DraftFields {
  return {
    ...blankDraft,
    ...row,
    tags: parse(row.tags, []),
    knowledge_ids: parse(row.knowledge_ids, []),
    parts: parse(row.parts, []),
  } as DraftFields;
}
const selectDraft =
  "id,revision,status,created_at,updated_at,text,pillar,account_id,planned_at,kind,target_id,provenance,parts,folder,tags,campaign_id,knowledge_ids,voice_id,intent";
export async function listDrafts(user: string): Promise<CreativeDraft[]> {
  const rows = await database()
    .prepare(
      "SELECT " +
        selectDraft +
        " FROM drafts WHERE owner=? ORDER BY updated_at DESC LIMIT 500",
    )
    .bind(user)
    .all<Record<string, unknown>>();
  return rows.results.map((row) => readFields(row) as CreativeDraft);
}
export async function getDraft(
  user: string,
  id: string,
): Promise<CreativeDraft> {
  const row = await database()
    .prepare("SELECT " + selectDraft + " FROM drafts WHERE owner=? AND id=?")
    .bind(user, id)
    .first<Record<string, unknown>>();
  if (!row) throw new AppError("Draft unavailable.", 404);
  return readFields(row) as CreativeDraft;
}
export async function listEntries(user: string): Promise<CreativeEntry[]> {
  const rows = await database()
    .prepare(
      "SELECT id,kind,title,content,details,tags,revision,updated_at FROM creative_entries WHERE owner=? ORDER BY updated_at DESC LIMIT 500",
    )
    .bind(user)
    .all<
      Omit<CreativeEntry, "details" | "tags"> & {
        details: string;
        tags: string;
      }
    >();
  return rows.results.map((row) => ({
    ...row,
    details: parse<Record<string, string>>(row.details, {}),
    tags: parse<string[]>(row.tags, []),
  }));
}
export async function saveDraft(
  user: string,
  input: unknown,
  editing: boolean,
) {
  const p = draftSchema.parse(input),
    db = database();
  if (!p.text.trim() && !p.parts.some((s) => s.trim()))
    throw new AppError("Write some text before saving.");
  if (p.planned_at && Date.parse(p.planned_at) < Date.now() - 60000)
    throw new AppError("Choose a future planning date.");
  if (
    p.account_id &&
    !(await db
      .prepare("SELECT 1 FROM accounts WHERE owner=? AND id=?")
      .bind(user, p.account_id)
      .first())
  )
    throw new AppError("Choose a connected account.");
  const refs = [
    ...(p.campaign_id ? [[p.campaign_id, "campaign"]] : []),
    ...(p.voice_id ? [[p.voice_id, "voice"]] : []),
    ...p.knowledge_ids.map((id) => [id, "knowledge"]),
  ];
  for (const [id, kind] of refs)
    if (
      !(await db
        .prepare(
          "SELECT 1 FROM creative_entries WHERE owner=? AND id=? AND kind=?",
        )
        .bind(user, id, kind)
        .first())
    )
      throw new AppError("A selected library entry is unavailable.");
  const id = editing ? p.id : crypto.randomUUID(),
    now = new Date().toISOString();
  const data = {
    text: p.kind === "thread" ? (p.parts[0] ?? p.text) : p.text,
    pillar: p.pillar,
    account_id: p.account_id,
    planned_at: p.planned_at,
    kind: p.kind,
    target_id: ["reply", "quote"].includes(p.kind) ? p.target_id : null,
    parts: JSON.stringify(p.kind === "thread" ? p.parts : []),
    folder: p.folder,
    tags: JSON.stringify(p.tags),
    campaign_id: p.campaign_id,
    knowledge_ids: JSON.stringify([...new Set(p.knowledge_ids)]),
    voice_id: p.voice_id,
    intent: p.intent,
    status: p.planned_at ? "planned" : "draft",
    updated_at: now,
  };
  const fields = Object.keys(data),
    values = Object.values(data);
  if (editing) {
    if (!id || !p.revision)
      throw new AppError("Reload this draft before editing.");
    const result = await db
      .prepare(
        "UPDATE drafts SET " +
          fields.map((f) => f + "=?").join(",") +
          ",provenance=CASE WHEN provenance='ai' THEN 'ai' ELSE ? END,revision=revision+1,last_error=NULL WHERE owner=? AND id=? AND revision=? AND status IN (" +
          editableStatuses.map(() => "?").join(",") +
          ")",
      )
      .bind(...values, p.provenance, user, id, p.revision, ...editableStatuses)
      .run();
    if (!result.meta.changes)
      throw new AppError(
        "This version changed or is locked. Reload before editing.",
        409,
      );
  } else {
    const keys = [...fields, "id", "owner", "provenance", "created_at"];
    const result = await db
      .prepare(
        "INSERT INTO drafts(" +
          keys.join(",") +
          ") SELECT " +
          keys.map(() => "?").join(",") +
          " WHERE (SELECT count(*) FROM drafts WHERE owner=?)<500",
      )
      .bind(...values, id!, user, p.provenance, now, user)
      .run();
    if (!result.meta.changes)
      throw new AppError("The workspace already contains 500 drafts.");
  }
  return { id: id!, revision: editing ? p.revision! + 1 : 1 };
}
