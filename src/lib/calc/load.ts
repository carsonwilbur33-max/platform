/**
 * Turning a prescription into a suggested weight.
 */
import { estimateE1rm, type E1rmFormula } from "./e1rm";
import { isBackoff, type Intensity, type NumRange, type SetGroup } from "./prescription";
import { chartPct, DEFAULT_RPE_CHART, rirToRpe, type RpeChart } from "./rpe-chart";
import { clean, DEFAULT_ROUNDING, roundLoad, type Unit } from "./units";

export interface TopSetRef {
  weightKg: number;
  reps: number;
  rpe?: number | null;
}

export interface LoadContext {
  /** Effective training max for this exercise on this date (after parent ratio), kg. */
  tmKg: number | null;
  chart?: RpeChart;
  formula?: E1rmFormula;
  /** Today's top set for this exercise — the athlete's actual set, or the coach-side estimate. */
  topSet?: TopSetRef | null;
}

export type LoadBasis = "tm" | "fixed" | "top-set" | "top-e1rm" | "rpe-estimate";

export interface LoadRange {
  minKg: number;
  maxKg: number;
  basis: LoadBasis;
  /** True for loads derived from RPE via the chart: shown as "≈". */
  estimate: boolean;
}

export interface Suggestion extends LoadRange {
  /** True when the target range was clamped into a hard bound. */
  clamped: boolean;
}

/**
 * The effective training max for an exercise: its own TM if set, otherwise
 * the parent lift's TM × ratio. Returns null when neither applies.
 */
export function effectiveTm(ownTmKg: number | null | undefined, parentTmKg: number | null | undefined, ratio: number | null | undefined): number | null {
  if (ownTmKg != null && ownTmKg > 0) return ownTmKg;
  if (parentTmKg != null && parentTmKg > 0 && ratio != null && ratio > 0) return clean(parentTmKg * ratio, 3);
  return null;
}

/** The TM effective on a date, from a list of dated TMs (YYYY-MM-DD). */
export function tmAsOf<T extends { weightKg: number; effectiveDate: string }>(tms: T[], date: string): T | null {
  let best: T | null = null;
  for (const t of tms) {
    if (t.effectiveDate <= date && (!best || t.effectiveDate > best.effectiveDate)) best = t;
  }
  return best;
}

function repsRange(sg: SetGroup): NumRange | null {
  return sg.reps === "amrap" ? null : sg.reps;
}

/** The kg range implied by a single intensity, or null if it can't be resolved. */
export function intensityLoadRange(i: Intensity, sg: SetGroup, ctx: LoadContext): LoadRange | null {
  const chart = ctx.chart ?? DEFAULT_RPE_CHART;
  switch (i.kind) {
    case "load":
      return { minKg: i.minKg, maxKg: i.maxKg, basis: "fixed", estimate: false };
    case "pct1rm":
      if (!ctx.tmKg) return null;
      return { minKg: (ctx.tmKg * i.min) / 100, maxKg: (ctx.tmKg * i.max) / 100, basis: "tm", estimate: false };
    case "drop":
      if (!ctx.topSet) return null;
      // A bigger drop gives the lighter end of the range.
      return {
        minKg: ctx.topSet.weightKg * (1 - i.max / 100),
        maxKg: ctx.topSet.weightKg * (1 - i.min / 100),
        basis: "top-set",
        estimate: false,
      };
    case "pctE1rm": {
      if (!ctx.topSet) return null;
      const e = estimateE1rm(ctx.topSet, { chart, formula: ctx.formula });
      if (!e) return null;
      return { minKg: (e.e1rmKg * i.min) / 100, maxKg: (e.e1rmKg * i.max) / 100, basis: "top-e1rm", estimate: false };
    }
    case "rpe":
    case "rir": {
      const reps = repsRange(sg);
      if (!ctx.tmKg || !reps) return null;
      const rpeLo = i.kind === "rpe" ? i.min : rirToRpe(i.max);
      const rpeHi = i.kind === "rpe" ? i.max : rirToRpe(i.min);
      // Lightest: most reps at lowest RPE. Heaviest: fewest reps at highest RPE.
      const lo = chartPct(chart, reps.max, rpeLo);
      const hi = chartPct(chart, reps.min, rpeHi);
      if (lo == null || hi == null) return null;
      return { minKg: (ctx.tmKg * lo) / 100, maxKg: (ctx.tmKg * hi) / 100, basis: "rpe-estimate", estimate: true };
    }
  }
}

/**
 * Suggested load range for a set group.
 *
 * The target produces a range; any load-type bounds are hard limits the range
 * is clamped into. With no resolvable target, the bound itself is the suggestion.
 * For AMRAP / repeat-until sets with only an RPE, there's no rep count to read
 * the chart with, so no suggestion.
 */
export function suggestLoad(sg: SetGroup, ctx: LoadContext): Suggestion | null {
  const target = sg.target ? intensityLoadRange(sg.target, sg, ctx) : null;

  let lo = -Infinity;
  let hi = Infinity;
  let boundRange: LoadRange | null = null;
  for (const b of sg.bounds) {
    if (b.kind === "rpe" || b.kind === "rir") continue;
    const r = intensityLoadRange(b, sg, ctx);
    if (!r) continue;
    lo = Math.max(lo, r.minKg);
    hi = Math.min(hi, r.maxKg);
    boundRange = r;
  }

  if (!target) {
    if (!boundRange || lo > hi) return null;
    return { minKg: lo, maxKg: hi, basis: boundRange.basis, estimate: false, clamped: false };
  }
  if (!boundRange) return { ...target, clamped: false };

  const minKg = Math.min(Math.max(target.minKg, lo), hi);
  const maxKg = Math.max(Math.min(target.maxKg, hi), lo);
  const clamped = minKg !== target.minKg || maxKg !== target.maxKg;
  return { ...target, minKg, maxKg, clamped };
}

export interface RoundedSuggestion {
  min: number;
  max: number;
  unit: Unit;
  minKg: number;
  maxKg: number;
  estimate: boolean;
  basis: LoadBasis;
  clamped: boolean;
}

/** Round a suggestion for display in a unit. A collapsed range shows as a single value. */
export function roundSuggestion(s: Suggestion, unit: Unit, increment = DEFAULT_ROUNDING[unit]): RoundedSuggestion {
  const a = roundLoad(s.minKg, unit, increment);
  const b = roundLoad(s.maxKg, unit, increment);
  return { min: a.value, max: b.value, unit, minKg: a.kg, maxKg: b.kg, estimate: s.estimate, basis: s.basis, clamped: s.clamped };
}

export function formatSuggestion(r: RoundedSuggestion): string {
  const v = r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
  return `${r.estimate ? "≈" : ""}${v} ${r.unit}`;
}

/**
 * Coach-side estimate of today's top set, for previewing backoff loads before
 * anything is logged: the top-set group's suggested load (midpoint), at its
 * rep count and target RPE.
 */
export function estimateTopSet(top: SetGroup, ctx: LoadContext): TopSetRef | null {
  const s = suggestLoad(top, { ...ctx, topSet: null });
  if (!s || top.reps === "amrap") return null;
  const rpe = top.target?.kind === "rpe" ? top.target.max : top.target?.kind === "rir" ? rirToRpe(top.target.min) : null;
  return { weightKg: (s.minKg + s.maxKg) / 2, reps: top.reps.min, rpe };
}

/**
 * The set group a backoff refers to: the nearest earlier non-backoff group
 * for the same exercise (usually the "top" set).
 */
export function findTopSetGroup(groups: SetGroup[], index: number): SetGroup | null {
  for (let i = index - 1; i >= 0; i--) {
    if (!isBackoff(groups[i])) return groups[i];
  }
  return null;
}
