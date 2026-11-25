import { z } from "zod";

/** A single value is stored as min === max. */
export const rangeSchema = z.object({ min: z.number(), max: z.number() });
export type NumRange = z.infer<typeof rangeSchema>;

export const unitSchema = z.enum(["kg", "lb"]);

export const intensitySchema = z.discriminatedUnion("kind", [
  /** RPE, 0.5 steps. */
  z.object({ kind: z.literal("rpe"), min: z.number(), max: z.number() }),
  /** Reps in reserve. */
  z.object({ kind: z.literal("rir"), min: z.number(), max: z.number() }),
  /** Percent of the training max (72 = 72%). */
  z.object({ kind: z.literal("pct1rm"), min: z.number(), max: z.number() }),
  /** Fixed load, canonical kg plus the unit it was written in. */
  z.object({ kind: z.literal("load"), minKg: z.number(), maxKg: z.number(), unit: unitSchema }),
  /** Percent drop from today's top set load (8 = −8%). */
  z.object({ kind: z.literal("drop"), min: z.number(), max: z.number() }),
  /** Percent of today's top-set e1RM. */
  z.object({ kind: z.literal("pctE1rm"), min: z.number(), max: z.number() }),
]);
export type Intensity = z.infer<typeof intensitySchema>;
export type IntensityKind = Intensity["kind"];

export const setGroupSchema = z.object({
  /**
   * straight    — fixed (or ranged) number of sets
   * workUp      — work up to a top set (single/double/triple…) — sets are the top sets
   * repeatUntil — keep doing sets until RPE `repeatUntilRpe` (optional `maxSets` cap)
   */
  mode: z.enum(["straight", "workUp", "repeatUntil"]),
  sets: rangeSchema.nullable(),
  reps: z.union([rangeSchema, z.literal("amrap")]),
  target: intensitySchema.nullable(),
  bounds: z.array(intensitySchema),
  amrapRpeCap: z.number().optional(),
  repeatUntilRpe: z.number().optional(),
  maxSets: z.number().int().optional(),
});
export type SetGroup = z.infer<typeof setGroupSchema>;

/** Intensities that resolve to a weight. */
export const LOAD_KINDS: ReadonlySet<IntensityKind> = new Set(["pct1rm", "load", "drop", "pctE1rm"]);
/** Intensities that are an effort level. */
export const EFFORT_KINDS: ReadonlySet<IntensityKind> = new Set(["rpe", "rir"]);

/** True when this set group depends on the day's top set (a backoff). */
export function isBackoff(sg: SetGroup): boolean {
  return [sg.target, ...sg.bounds].some((i) => i?.kind === "drop" || i?.kind === "pctE1rm");
}

/** Exercise-level variation modifiers (live on the planned exercise, not the library entry). */
export const modifiersSchema = z.object({
  pause: z.string().optional(), // e.g. "2s", "3ct"
  tempo: z.string().optional(), // e.g. "3-1-0"
  pins: z.string().optional(), // e.g. "knee", "2in above chest"
  belt: z.boolean().optional(), // false = beltless
  other: z.string().optional(),
});
export type ExerciseModifiers = z.infer<typeof modifiersSchema>;

export function formatModifiers(m: ExerciseModifiers | null | undefined): string {
  if (!m) return "";
  const parts: string[] = [];
  if (m.pause) parts.push(`pause ${m.pause}`);
  if (m.tempo) parts.push(`tempo ${m.tempo}`);
  if (m.pins) parts.push(`pins @ ${m.pins}`);
  if (m.belt === false) parts.push("no belt");
  if (m.belt === true) parts.push("belt");
  if (m.other) parts.push(m.other);
  return parts.join(", ");
}
