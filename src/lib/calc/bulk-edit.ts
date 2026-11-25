/**
 * Bulk edits: shift every prescription in a selection by an amount, either
 * flat (same change everywhere) or progressively (amount × weeks after the
 * first selected week — "add 2.5% to this lift every week").
 */
import type { Intensity, NumRange, SetGroup } from "./prescription";
import { clean, toKg, type Unit } from "./units";

export type BulkEditKind = "pct" | "load" | "rpe" | "sets" | "reps";

export interface BulkEdit {
  kind: BulkEditKind;
  /** Percentage points, load in `unit`, RPE points, or a set/rep count. */
  amount: number;
  /** For load edits. */
  unit?: Unit;
}

export const BULK_EDIT_LABELS: Record<BulkEditKind, string> = {
  pct: "% of TM (points)",
  load: "Fixed load",
  rpe: "RPE (RIR moves the opposite way)",
  sets: "Sets",
  reps: "Reps",
};

function shiftRange(r: NumRange, by: number, min: number, max = Infinity, step?: number): NumRange {
  const f = (v: number) => {
    let x = v + by;
    if (step) x = Math.round(x / step) * step;
    return clean(Math.min(max, Math.max(min, x)), 4);
  };
  return { min: f(r.min), max: f(r.max) };
}

function editIntensity(i: Intensity, e: BulkEdit, factor: number): Intensity {
  const by = e.amount * factor;
  switch (i.kind) {
    case "pct1rm":
      return e.kind === "pct" ? { ...i, ...shiftRange(i, by, 1, 120) } : i;
    case "pctE1rm":
      return e.kind === "pct" ? { ...i, ...shiftRange(i, by, 1, 110) } : i;
    case "load": {
      if (e.kind !== "load") return i;
      const kg = toKg(by, e.unit ?? i.unit);
      return { ...i, minKg: clean(Math.max(0.5, i.minKg + kg), 6), maxKg: clean(Math.max(0.5, i.maxKg + kg), 6) };
    }
    case "rpe":
      return e.kind === "rpe" ? { ...i, ...shiftRange(i, by, 1, 10, 0.5) } : i;
    case "rir":
      return e.kind === "rpe" ? { ...i, ...shiftRange(i, -by, 0, 9, 0.5) } : i;
    case "drop":
      return i;
  }
}

/** Apply a bulk edit to one set group. `factor` scales the amount (progressive edits). */
export function applyBulkEdit(sg: SetGroup, e: BulkEdit, factor = 1): SetGroup {
  if (factor === 0) return sg;
  const by = e.amount * factor;
  const out: SetGroup = {
    ...sg,
    target: sg.target ? editIntensity(sg.target, e, factor) : null,
    bounds: sg.bounds.map((b) => editIntensity(b, e, factor)),
  };
  if (e.kind === "sets" && sg.sets) out.sets = shiftRange(sg.sets, Math.round(by), 1);
  if (e.kind === "reps" && sg.reps !== "amrap") out.reps = shiftRange(sg.reps, Math.round(by), 1);
  return out;
}

/** True if the edit would change anything in these groups (to skip no-op cells). */
export function bulkEditTouches(groups: SetGroup[], e: BulkEdit): boolean {
  return groups.some((g) => JSON.stringify(applyBulkEdit(g, e, 1)) !== JSON.stringify(g));
}
