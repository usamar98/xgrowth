import { localInstants, localKey } from "./local-time";
export function nextSlot(
  after: Date,
  zone: string,
  time: string,
  interval: number,
  initial = false,
) {
  const localDay = localKey(after, zone).slice(0, 10);
  const base = Date.parse(localDay + "T12:00:00Z");
  for (
    let d = initial ? 0 : interval;
    d <= interval * 3;
    d += initial ? 1 : interval
  ) {
    const day = new Date(base + d * 86400000).toISOString().slice(0, 10);
    const next = localInstants(day + "T" + time, zone)[0];
    if (next && Date.parse(next) > after.getTime()) return next;
  }
  throw new Error("Could not resolve the next local occurrence.");
}
