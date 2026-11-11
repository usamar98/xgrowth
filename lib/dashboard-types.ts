import type { Draft } from "./types";
export type DeskAccount = {
  id: string;
  name: string;
  username: string;
  granted_scopes?: string;
  last_sync?: string;
  health?: string;
  blocked_until: number;
};
export type DeskWorkspace = {
  accounts: DeskAccount[];
  drafts: Draft[];
  settings: {
    timezone?: string;
    weekly_target: number;
    audience: string;
    topics: string;
    budget: number;
  };
  configured: boolean;
  missing: string[];
  usage: number;
};
export type QueueJob = {
  id: string;
  draft_id: string;
  account_id: string;
  revision: number;
  kind: string;
  text: string;
  target_id: string | null;
  status: string;
  run_at: string;
  timezone: string;
  detail?: string;
  post_id?: string;
  created_at: string;
  estimated_micros: number;
};
export type QueueData = { jobs: QueueJob[]; paused: boolean };
export type Costs = {
  month_micros: number;
  day_micros: number;
  monthly_budget: number;
  daily_budget: number;
  entries: {
    id: string;
    operation: string;
    category: string;
    state: string;
    micros: number;
    account_id: string | null;
    job_id: string | null;
    created_at: string;
  }[];
  rates: { operation: string; micros: number | null }[];
};
export type Summary = {
  mentions: number;
  saved: number;
  eligible: number;
  rules: number;
  profile: { observed_at: string; followers: number | null } | null;
};
export async function api<T>(
  path: string,
  method = "GET",
  input?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers:
      input === undefined ? undefined : { "Content-Type": "application/json" },
    body: input === undefined ? undefined : JSON.stringify(input),
  });
  const data = await response
    .json()
    .catch(() => ({ error: "Workspace service is unavailable." }));
  if (!response.ok)
    throw Object.assign(
      new Error((data as { error?: string }).error || "Request failed."),
      { status: response.status },
    );
  return data as T;
}
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: n > 0 && n < 100000 ? 3 : 2,
  }).format(n / 1e6);
export function downloadFile(
  name: string,
  text: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export function dateLabel(
  date: string | number,
  zone: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  },
) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    ...options,
  }).format(new Date(date));
}
