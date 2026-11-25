/** Calendar dates as ISO strings (YYYY-MM-DD), treated as plain dates with no time zone. */

function parse(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = parse(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(iso: string): number {
  return (parse(iso).getUTCDay() + 6) % 7;
}

export function mondayOf(iso: string): string {
  return addDays(iso, -weekdayOf(iso));
}

export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

/** Today in the server's local time zone (athlete-side "today" will use the device's date). */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Planned date of a block day in a given week: the first date on or after
 * the week's start that falls on `weekday`. Without a weekday, the week start.
 */
export function plannedDate(blockStart: string, weekPosition: number, weekday: number | null): string {
  const weekStart = addDays(blockStart, weekPosition * 7);
  if (weekday === null) return weekStart;
  return addDays(weekStart, (weekday - weekdayOf(weekStart) + 7) % 7);
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function formatShortDate(iso: string): string {
  const d = parse(iso);
  return `${WEEKDAY_SHORT[weekdayOf(iso)]} ${d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
}
