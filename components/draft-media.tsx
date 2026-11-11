"use client";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/dashboard-types";
type Item = { id: string; alt: string; filename: string; position: number };
export function DraftMedia({
  id,
  refresh,
}: {
  id: string;
  refresh: () => void | Promise<void>;
}) {
  const [items, setItems] = useState<Item[]>([]),
    [status, setStatus] = useState(""),
    [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      setItems(
        (await api<{ items: Item[] }>("/api/desk/media?draft_id=" + id)).items,
      );
    } catch (e) {
      setStatus((e as Error).message);
    }
  }, [id]);
  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);
  async function update(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      await load();
      await refresh();
      setStatus(message);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel box-body">
      <summary style={{ cursor: "pointer" }}>
        Images {items.length ? "(" + items.length + ")" : ""}
      </summary>
      <div className="fields stack-gap">
        <p className="form-hint">
          Attach up to four images for manual publication. Image publishing
          through the API requires verified media access.
        </p>
        <label>
          Add an image · JPEG, PNG, WebP, up to 5 MB
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={busy || items.length >= 4}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 5242880) {
                setStatus("Image exceeds 5 MB.");
                return;
              }
              void update(async () => {
                const res = await fetch("/api/desk/media?draft_id=" + id, {
                  method: "POST",
                  headers: {
                    "Content-Type": file.type,
                    "X-File-Name": file.name.replace(/[^\x20-\x7e]/g, "_"),
                  },
                  body: file,
                });
                if (!res.ok) {
                  const d = (await res.json()) as { error: string };
                  throw new Error(d.error);
                }
              }, "Image attached.");
            }}
          />
        </label>
        {items.map((item, i) => (
          <div key={item.id} className="fields">
            <a
              href={"/api/desk/media?file=" + item.id}
              target="_blank"
              rel="noreferrer"
            >
              {item.filename}
            </a>
            <label>
              Alt text
              <input
                maxLength={1000}
                value={item.alt}
                onChange={(e) =>
                  setItems(
                    items.map((m, j) =>
                      j === i ? { ...m, alt: e.target.value } : m,
                    ),
                  )
                }
              />
            </label>
            <label>
              Display order
              <input
                type="number"
                min="0"
                max="1000"
                value={item.position}
                onChange={(e) =>
                  setItems(
                    items.map((m, j) =>
                      j === i ? { ...m, position: Number(e.target.value) } : m,
                    ),
                  )
                }
              />
            </label>
            <div className="btn-row">
              <button
                className="btn small"
                disabled={busy}
                onClick={() =>
                  update(
                    () =>
                      api("/api/desk/media", "PATCH", {
                        id: item.id,
                        alt: item.alt,
                        position: item.position,
                      }),
                    "Image details saved.",
                  )
                }
              >
                Save details
              </button>
              <button
                className="text-link"
                disabled={busy}
                onClick={() =>
                  update(
                    () => api("/api/desk/media", "DELETE", { id: item.id }),
                    "Image removed.",
                  )
                }
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        {(busy || status) && (
          <p role="status" className="form-hint">
            {busy ? "Updating image…" : status}
          </p>
        )}
      </div>
    </details>
  );
}
