import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a millisecond duration as a compact human string (e.g. "31s", "1m 4s"). */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

/** Bucket a timestamp into a recency label used by the sidebar and search. */
export function recencyBucket(
  updatedAt: number,
  now: number = Date.now(),
): "today" | "pastWeek" | "pastMonth" | "older" {
  const dayMs = 24 * 60 * 60 * 1000;
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  if (updatedAt >= startOfToday) return "today";
  if (updatedAt >= now - 7 * dayMs) return "pastWeek";
  if (updatedAt >= now - 30 * dayMs) return "pastMonth";
  return "older";
}

export const recencyLabels: Record<
  "today" | "pastWeek" | "pastMonth" | "older",
  string
> = {
  today: "Today",
  pastWeek: "Past week",
  pastMonth: "Past month",
  older: "Older",
};
