"use client";
import { useCallback, useEffect, useState } from "react";
import { api, dateLabel } from "@/lib/dashboard-types";
import { localKey } from "@/lib/local-time";
import type { Slot } from "@/lib/queue-slots";
const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
export function QueueSlots({
  zone,
  accountId,
  choose,
}: {
  zone: string;
  accountId?: string;
  choose?: (time: string) => void;
}) {
  const [slots, setSlots] = useState<(Slot & { next: string | null })[]>([]),
    [day, setDay] = useState(1),
    [time, setTime] = useState("09:00"),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    const result = await api<{ slots: (Slot & { next: string | null })[] }>(
      "/api/desk/plan" +
        (accountId ? "?account_id=" + encodeURIComponent(accountId) : ""),
    );
    setSlots(result.slots);
  }, [accountId]);
  useEffect(() => {
    let mounted = true;
    api<{ slots: (Slot & { next: string | null })[] }>(
      "/api/desk/plan" +
        (accountId ? "?account_id=" + encodeURIComponent(accountId) : ""),
    )
      .then((result) => {
        if (mounted) setSlots(result.slots);
      })
      .catch((e) => {
        if (mounted) setError(e.message);
      });
    return () => {
      mounted = false;
    };
  }, [accountId]);
  async function update(method: string, p: unknown) {
    try {
      await api("/api/desk/plan", method, p);
      await load();
      setError("");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  if (choose)
    return slots.length ? (
      <label>
        Available queue slot
        <select
          defaultValue=""
          onChange={(e) => {
            if (e.target.value) choose(localKey(e.target.value, zone));
          }}
        >
          <option value="">Choose a saved slot</option>
          {slots
            .filter((s) => s.next)
            .map((s) => (
              <option key={s.id} value={s.next!}>
                {dateLabel(s.next!, zone)} · {zone}
              </option>
            ))}
        </select>
      </label>
    ) : null;
  return (
    <section className="panel stack-gap">
      <div className="panel-header">
        <h2>Weekly queue slots</h2>
      </div>
      <div className="box-body fields">
        <p className="form-hint">
          Save regular publishing times. Select an available occurrence when
          approving a draft.
        </p>
        <form
          className="btn-row"
          onSubmit={(e) => {
            e.preventDefault();
            void update("PUT", {
              weekday: day,
              local_time: time,
              timezone: zone,
            });
          }}
        >
          <label>
            Weekday
            <select
              value={day}
              onChange={(e) => setDay(Number(e.target.value))}
            >
              {days.map((d, i) => (
                <option value={i} key={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Time ({zone})
            <input
              type="time"
              value={time}
              required
              onChange={(e) => setTime(e.target.value)}
            />
          </label>
          <button className="btn">Add slot</button>
        </form>
        {slots.map((s) => (
          <div className="metric-row" key={s.id}>
            <span>
              {days[s.weekday]} · {s.local_time} · {s.timezone}
            </span>
            <button
              className="text-link"
              onClick={() => update("DELETE", { id: s.id })}
            >
              Remove
            </button>
          </div>
        ))}
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
