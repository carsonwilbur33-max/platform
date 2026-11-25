/**
 * Pure helpers for athlete logging: which set rows to show for a
 * prescription, which logged set counts as "the top set" for backoffs, and
 * which session the athlete should see as "today".
 */
import type { TopSetRef } from "@/lib/calc/load";
import type { SetGroup } from "@/lib/calc/prescription";
import { fmtNum, fromKg } from "@/lib/calc/units";

export interface LoggedLite {
  weightKg: number;
  reps: number;
  rpe: number | null;
}

export type RowKind = "required" | "optional" | "top" | "repeat" | "extra";

export interface SetRow {
  /** Index within its set group; matches logged_sets.set_index for that group. */
  index: number;
  kind: RowKind;
  label: string;
}

const TOP_NAMES: Record<number, string> = { 1: "single", 2: "double", 3: "triple" };

/**
 * Rows to show for one set group, given what's already logged against it.
 * - straight: the minimum sets are required, the rest of a range optional
 * - work up to: one row per top set
 * - repeat until RPE: logged rows plus one more, until the stop RPE or cap is hit
 * Logged sets beyond the plan (athlete added a set) appear as "extra".
 */
export function setRows(sg: SetGroup, logged: LoggedLite[]): SetRow[] {
  const rows: SetRow[] = [];
  if (sg.mode === "repeatUntil") {
    const done = repeatUntilDone(sg, logged);
    const n = done ? logged.length : logged.length + 1;
    for (let i = 0; i < n; i++) rows.push({ index: i, kind: "repeat", label: `Set ${i + 1}` });
    return rows;
  }
  const min = sg.sets?.min ?? 1;
  const max = sg.sets?.max ?? min;
  for (let i = 0; i < max; i++) {
    if (sg.mode === "workUp") {
      const reps = sg.reps === "amrap" ? null : sg.reps.max;
      const name = reps && TOP_NAMES[reps] ? `Top ${TOP_NAMES[reps]}` : "Top set";
      rows.push({ index: i, kind: "top", label: max > 1 ? `${name} ${i + 1}` : name });
    } else rows.push({ index: i, kind: i < min ? "required" : "optional", label: i < min ? `Set ${i + 1}` : `Set ${i + 1} (optional)` });
  }
  for (let i = max; i < logged.length; i++) rows.push({ index: i, kind: "extra", label: `Set ${i + 1} (extra)` });
  return rows;
}

/** A repeat-until group is finished once a set reaches the stop RPE, or the cap is hit. */
export function repeatUntilDone(sg: SetGroup, logged: LoggedLite[]): boolean {
  if (sg.mode !== "repeatUntil") return false;
  if (sg.maxSets !== undefined && logged.length >= sg.maxSets) return true;
  const last = logged.at(-1);
  return !!last && last.rpe !== null && sg.repeatUntilRpe !== undefined && last.rpe >= sg.repeatUntilRpe;
}

/** Human description of what one set should look like, e.g. "6–8 reps @7–8 · within 175–180 kg". */
export function describeTarget(sg: SetGroup, unitLabel: (kg: number, unit: "kg" | "lb") => string = defaultLoad): string {
  const parts: string[] = [];
  if (sg.reps === "amrap") parts.push("as many reps as possible");
  else parts.push(sg.reps.min === sg.reps.max ? `${sg.reps.min} rep${sg.reps.min === 1 ? "" : "s"}` : `${sg.reps.min}–${sg.reps.max} reps`);
  if (sg.target) parts.push(intensityText(sg.target, unitLabel));
  if (sg.amrapRpeCap !== undefined) parts.push(`stop at RPE ${fmtNum(sg.amrapRpeCap)}`);
  if (sg.repeatUntilRpe !== undefined)
    parts.push(`repeat until RPE ${fmtNum(sg.repeatUntilRpe)}${sg.maxSets ? ` (max ${sg.maxSets} sets)` : ""}`);
  for (const b of sg.bounds) parts.push(`stay within ${intensityText(b, unitLabel)}`);
  return parts.join(" · ");
}

function defaultLoad(kg: number, unit: "kg" | "lb") {
  return `${fmtNum(fromKg(kg, unit), 1)} ${unit}`;
}

function intensityText(i: SetGroup["bounds"][number], unitLabel: (kg: number, unit: "kg" | "lb") => string): string {
  switch (i.kind) {
    case "rpe":
      return i.min === i.max ? `RPE ${fmtNum(i.min)}` : `RPE ${fmtNum(i.min)}–${fmtNum(i.max)}`;
    case "rir":
      return i.min === i.max ? `${fmtNum(i.min)} RIR` : `${fmtNum(i.min)}–${fmtNum(i.max)} RIR`;
    case "drop":
      return i.min === i.max ? `${fmtNum(i.min)}% below top set` : `${fmtNum(i.min)}–${fmtNum(i.max)}% below top set`;
    case "pctE1rm":
      return `${i.min === i.max ? fmtNum(i.min) : `${fmtNum(i.min)}–${fmtNum(i.max)}`}% of top-set e1RM`;
    case "load": {
      const a = unitLabel(i.minKg, i.unit);
      return i.minKg === i.maxKg ? a : `${a.split(" ")[0]}–${unitLabel(i.maxKg, i.unit)}`;
    }
    case "pct1rm":
      return `${i.min === i.max ? fmtNum(i.min) : `${fmtNum(i.min)}–${fmtNum(i.max)}`}% of TM`;
  }
}

/** The set a backoff refers to: the heaviest logged in the top-set group (latest wins ties). */
export function pickTopSet(logged: LoggedLite[]): TopSetRef | null {
  let best: LoggedLite | null = null;
  for (const l of logged) if (!best || l.weightKg >= best.weightKg) best = l;
  return best ? { weightKg: best.weightKg, reps: best.reps, rpe: best.rpe } : null;
}

export interface SessionRef {
  id: string;
  plannedDate: string | null;
  completed: boolean;
  /** Has logged sets or was started, but isn't completed. */
  inProgress: boolean;
}

/**
 * "Today" is the next session in program order: an in-progress session if
 * there is one, otherwise the first incomplete session after the last
 * completed one. Skipping a day doesn't lose your place, and old skipped
 * sessions don't block the way forward. `sessions` must be in program order.
 */
export function pickTodaySession<T extends SessionRef>(sessions: T[]): T | null {
  const inProgress = sessions.filter((s) => s.inProgress && !s.completed);
  if (inProgress.length) return inProgress[inProgress.length - 1];
  let lastDone = -1;
  sessions.forEach((s, i) => {
    if (s.completed) lastDone = i;
  });
  return sessions.slice(lastDone + 1).find((s) => !s.completed) ?? null;
}

/** Only plain http(s) links are stored (YouTube, Drive, etc.). They're shown as links, never embedded. */
export function normalizeVideoUrl(raw: string): string | null | "invalid" {
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 500) return "invalid";
  try {
    const u = new URL(s.includes("://") ? s : `https://${s}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "invalid";
    if (!u.hostname.includes(".")) return "invalid";
    return u.toString();
  } catch {
    return "invalid";
  }
}

export const RPE_OPTIONS = [5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10];
