/**
 * RPE → %1RM chart.
 *
 * `pct[i][r]` is the percentage of 1RM for RPE `rpes[i]` at `r + 1` reps.
 * Rows are stored highest RPE first. The chart is plain JSON so it can be
 * stored in the database and edited.
 */
export interface RpeChart {
  rpes: number[];
  pct: number[][];
}

/**
 * The widely used Tuchscherer / RTS chart. Each half-RPE step or each extra
 * rep moves one position along this sequence, so the whole table is
 * pct(reps, rpe) = SEQUENCE[(reps - 1) * 2 + (10 - rpe) * 2].
 */
const RTS_SEQUENCE = [
  100, 97.8, 95.5, 93.9, 92.2, 90.7, 89.2, 87.8, 86.3, 85.0, 83.7, 82.4, 81.1, 79.9, 78.6, 77.4,
  76.2, 75.1, 73.9, 72.3, 70.7, 69.4, 68.0, 66.7, 65.3, 64.0, 62.6, 61.3, 59.9, 58.6, 57.4,
];

export const MAX_CHART_REPS = 12;

export function buildDefaultRpeChart(): RpeChart {
  const rpes: number[] = [];
  for (let r = 10; r >= 6; r -= 0.5) rpes.push(r);
  const pct = rpes.map((rpe) =>
    Array.from({ length: MAX_CHART_REPS }, (_, i) => RTS_SEQUENCE[i * 2 + (10 - rpe) * 2]),
  );
  return { rpes, pct };
}

export const DEFAULT_RPE_CHART: RpeChart = buildDefaultRpeChart();

export function rirToRpe(rir: number): number {
  return 10 - rir;
}

export function rpeToRir(rpe: number): number {
  return 10 - rpe;
}

/**
 * %1RM for a rep count at an RPE. RPEs between chart rows are linearly
 * interpolated. Returns null when outside the chart.
 */
export function chartPct(chart: RpeChart, reps: number, rpe: number): number | null {
  if (!Number.isInteger(reps) || reps < 1) return null;
  const col = reps - 1;
  const rpes = chart.rpes;
  const hi = Math.max(...rpes);
  const lo = Math.min(...rpes);
  if (rpe > hi || rpe < lo) return null;
  // rows are sorted descending
  for (let i = 0; i < rpes.length; i++) {
    const r = rpes[i];
    const row = chart.pct[i];
    if (row === undefined || col >= row.length) return null;
    if (r === rpe) return row[col] ?? null;
    const next = rpes[i + 1];
    if (next !== undefined && rpe < r && rpe > next) {
      const a = row[col];
      const b = chart.pct[i + 1]?.[col];
      if (a === undefined || b === undefined) return null;
      const t = (r - rpe) / (r - next);
      return a + (b - a) * t;
    }
  }
  return null;
}

/** Validates an edited chart: same shape, percentages fall as reps rise / RPE falls. */
export function validateRpeChart(chart: RpeChart): string[] {
  const errors: string[] = [];
  if (chart.rpes.length !== chart.pct.length) errors.push("Row count does not match RPE list.");
  chart.pct.forEach((row, i) => {
    row.forEach((v, c) => {
      if (!(v > 0 && v <= 100)) errors.push(`RPE ${chart.rpes[i]}, ${c + 1} reps: ${v} is not between 0 and 100.`);
      if (c > 0 && v > row[c - 1]) errors.push(`RPE ${chart.rpes[i]}: ${c + 1} reps is higher than ${c} reps.`);
    });
  });
  return errors;
}
