export function localKey(instant: Date | string, zone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (n: string) => parts.find((p) => p.type === n)?.value;
  return (
    get("year") +
    "-" +
    get("month") +
    "-" +
    get("day") +
    "T" +
    get("hour") +
    ":" +
    get("minute")
  );
}
export function localInstants(value: string, zone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return [];
  const naive = Date.parse(value + ":00Z");
  if (!Number.isFinite(naive)) return [];
  const offsets = new Set<number>();
  for (const d of [-36, -12, 0, 12, 36]) {
    const sample = naive + d * 3600000;
    offsets.add(Date.parse(localKey(new Date(sample), zone) + ":00Z") - sample);
  }
  return Array.from(offsets)
    .map((offset) => new Date(naive - offset))
    .filter((time) => localKey(time, zone) === value)
    .map((d) => d.toISOString())
    .sort();
}
