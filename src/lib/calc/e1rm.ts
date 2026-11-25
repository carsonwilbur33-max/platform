import { chartPct, DEFAULT_RPE_CHART, MAX_CHART_REPS, type RpeChart } from "./rpe-chart";
import { clean } from "./units";

export type E1rmFormula = "epley" | "brzycki";

export interface E1rmInput {
  weightKg: number;
  reps: number;
  rpe?: number | null;
}

export interface E1rmOptions {
  chart?: RpeChart;
  formula?: E1rmFormula;
}

export interface E1rmResult {
  e1rmKg: number;
  method: "rpe-chart" | E1rmFormula;
}

export function epley(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return weight * (1 + reps / 30);
}

export function brzycki(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  if (reps >= 37) return epley(weight, reps); // Brzycki is undefined at 37+ reps
  return (weight * 36) / (37 - reps);
}

function byFormula(formula: E1rmFormula, weight: number, reps: number): number {
  return formula === "brzycki" ? brzycki(weight, reps) : epley(weight, reps);
}

/**
 * Estimated 1RM from a logged set.
 *
 * - With an RPE inside the chart: weight ÷ chart %.
 * - With an RPE outside the chart (e.g. 15 reps, or RPE 5): the formula using
 *   reps + reps in reserve as the effective reps to failure.
 * - With no RPE: the formula (Epley by default) on the reps performed.
 */
export function estimateE1rm(input: E1rmInput, opts: E1rmOptions = {}): E1rmResult | null {
  const { weightKg, reps, rpe } = input;
  const chart = opts.chart ?? DEFAULT_RPE_CHART;
  const formula = opts.formula ?? "epley";
  if (!(weightKg > 0) || !Number.isInteger(reps) || reps < 1) return null;

  if (rpe !== null && rpe !== undefined) {
    if (rpe <= 0 || rpe > 10) return null;
    if (reps <= MAX_CHART_REPS) {
      const pct = chartPct(chart, reps, rpe);
      if (pct) return { e1rmKg: clean((weightKg * 100) / pct, 2), method: "rpe-chart" };
    }
    const effective = reps + (10 - rpe);
    return { e1rmKg: clean(byFormula(formula, weightKg, effective), 2), method: formula };
  }
  return { e1rmKg: clean(byFormula(formula, weightKg, reps), 2), method: formula };
}
