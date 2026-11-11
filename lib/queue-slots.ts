import { localInstants, localKey } from "./local-time";
export type Slot = {
  id: string;
  weekday: number;
  local_time: string;
  timezone: string;
};
export function nextAvailable(slot: Slot, busy: Set<string>, now: Date) {
  const day = localKey(now, slot.timezone).slice(0, 10);
  const start = new Date(day + "T12:00:00Z");
  const offset = (slot.weekday - start.getUTCDay() + 7) % 7;
  for (let i = offset; i < 90; i += 7) {
    const date = new Date(start.getTime() + i * 86400000)
      .toISOString()
      .slice(0, 10);
    const instant = localInstants(
      date + "T" + slot.local_time,
      slot.timezone,
    )[0];
    if (instant && Date.parse(instant) > now.getTime() && !busy.has(instant))
      return instant;
  }
  return null;
}
