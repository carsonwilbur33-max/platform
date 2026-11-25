export type Unit = "kg" | "lb";

/** Exact by definition (international avoirdupois pound). */
export const KG_PER_LB = 0.45359237;

export const DEFAULT_ROUNDING: Record<Unit, number> = { kg: 2.5, lb: 5 };

export function toKg(value: number, unit: Unit): number {
  return unit === "kg" ? value : value * KG_PER_LB;
}

export function fromKg(kg: number, unit: Unit): number {
  return unit === "kg" ? kg : kg / KG_PER_LB;
}

/** Removes float noise (e.g. 182.49999999 → 182.5) without hiding real precision. */
export function clean(n: number, decimals = 4): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/** Round to the nearest multiple of `increment` (ties round up). */
export function roundToIncrement(value: number, increment: number): number {
  if (!(increment > 0)) return clean(value);
  return clean(Math.round(clean(value / increment, 6)) * increment);
}

export interface DisplayLoad {
  /** Value in the display unit, rounded to the increment. */
  value: number;
  unit: Unit;
  /** The rounded value converted back to canonical kg. */
  kg: number;
}

/** Convert canonical kg to a display unit and round to that unit's increment. */
export function roundLoad(kg: number, unit: Unit, increment = DEFAULT_ROUNDING[unit]): DisplayLoad {
  const value = roundToIncrement(fromKg(kg, unit), increment);
  return { value, unit, kg: clean(toKg(value, unit)) };
}

/** Format a number without trailing zeros: 180 → "180", 182.5 → "182.5". */
export function fmtNum(n: number, maxDecimals = 2): string {
  return String(clean(n, maxDecimals));
}

export function formatWeight(kg: number, unit: Unit, increment?: number): string {
  const d = increment === undefined ? { value: clean(fromKg(kg, unit), 1), unit } : roundLoad(kg, unit, increment);
  return `${fmtNum(d.value)} ${unit}`;
}
