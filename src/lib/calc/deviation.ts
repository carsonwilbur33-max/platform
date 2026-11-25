/**
 * Flags for a logged set compared against its prescription snapshot.
 */
import { intensityLoadRange, type LoadContext } from "./load";
import type { Intensity, NumRange, SetGroup } from "./prescription";
import { rirToRpe } from "./rpe-chart";
import { clean, fmtNum } from "./units";

export type DeviationKind = "rpe_high" | "rpe_low" | "load_high" | "load_low" | "reps_low" | "reps_high";

export interface Deviation {
  kind: DeviationKind;
  /** Whether this broke a hard bound (vs. missing the target). */
  hardBound: boolean;
  message: string;
}

export interface LoggedSetInput {
  weightKg: number;
  reps: number;
  rpe?: number | null;
}

function effortRange(i: Intensity): NumRange | null {
  if (i.kind === "rpe") return { min: i.min, max: i.max };
  if (i.kind === "rir") return { min: rirToRpe(i.max), max: rirToRpe(i.min) };
  return null;
}

/**
 * @param toleranceKg Loads within this of a limit are not flagged. Defaults
 *   to half of a 2.5 kg increment, so a correctly rounded load never flags.
 */
export function checkLoggedSet(sg: SetGroup, set: LoggedSetInput, ctx: LoadContext, toleranceKg = 1.25): Deviation[] {
  const out: Deviation[] = [];
  const eps = toleranceKg + 0.01;

  // --- reps ---
  if (sg.reps !== "amrap") {
    if (set.reps < sg.reps.min)
      out.push({ kind: "reps_low", hardBound: false, message: `${set.reps} reps, prescribed ${fmtRange(sg.reps)}` });
    else if (set.reps > sg.reps.max)
      out.push({ kind: "reps_high", hardBound: false, message: `${set.reps} reps, prescribed ${fmtRange(sg.reps)}` });
  }

  // --- RPE ---
  const rpe = set.rpe;
  if (rpe != null) {
    const checks: { r: NumRange; hard: boolean }[] = [];
    // Repeat-until sets are expected to climb towards the stop RPE; only the target applies to the first set.
    if (sg.target && sg.mode !== "repeatUntil") {
      const r = effortRange(sg.target);
      if (r) checks.push({ r, hard: false });
    }
    for (const b of sg.bounds) {
      const r = effortRange(b);
      if (r) checks.push({ r, hard: true });
    }
    if (sg.amrapRpeCap !== undefined) checks.push({ r: { min: 0, max: sg.amrapRpeCap }, hard: true });
    for (const { r, hard } of checks) {
      if (rpe > r.max) out.push({ kind: "rpe_high", hardBound: hard, message: `RPE ${fmtNum(rpe)}, ${hard ? "limit" : "target"} ${fmtRpe(r)}` });
      else if (rpe < r.min) out.push({ kind: "rpe_low", hardBound: hard, message: `RPE ${fmtNum(rpe)}, ${hard ? "limit" : "target"} ${fmtRpe(r)}` });
    }
  }

  // --- load ---
  const loadChecks: { i: Intensity; hard: boolean }[] = [];
  if (sg.target && sg.target.kind !== "rpe" && sg.target.kind !== "rir") loadChecks.push({ i: sg.target, hard: false });
  for (const b of sg.bounds) if (b.kind !== "rpe" && b.kind !== "rir") loadChecks.push({ i: b, hard: true });
  for (const { i, hard } of loadChecks) {
    const r = intensityLoadRange(i, sg, ctx);
    if (!r) continue;
    const label = hard ? "limit" : "target";
    if (set.weightKg > r.maxKg + eps)
      out.push({ kind: "load_high", hardBound: hard, message: `${fmtNum(set.weightKg, 1)} kg, ${label} ${fmtKg(r.minKg, r.maxKg)}` });
    else if (set.weightKg < r.minKg - eps)
      out.push({ kind: "load_low", hardBound: hard, message: `${fmtNum(set.weightKg, 1)} kg, ${label} ${fmtKg(r.minKg, r.maxKg)}` });
  }

  return out;
}

function fmtRange(r: NumRange): string {
  return r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
}
function fmtRpe(r: NumRange): string {
  return r.min === 0 ? `≤${fmtNum(r.max)}` : fmtRange(r);
}
function fmtKg(a: number, b: number): string {
  const x = clean(a, 1);
  const y = clean(b, 1);
  return x === y ? `${x} kg` : `${x}–${y} kg`;
}
