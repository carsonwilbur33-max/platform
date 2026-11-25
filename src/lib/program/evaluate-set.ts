/**
 * What gets stored alongside a logged set: a snapshot of the prescription as
 * it was when logged, and the deviation flags.
 */
import { checkLoggedSet, type Deviation } from "@/lib/calc/deviation";
import type { TopSetRef } from "@/lib/calc/load";
import { isBackoff, type SetGroup } from "@/lib/calc/prescription";
import { toKg, type Unit } from "@/lib/calc/units";
import type { AthleteContext } from "./athlete-context";

export interface PrescriptionSnapshot {
  setGroup: SetGroup;
  exerciseId: string;
  tmKg: number | null;
  suggestedMinKg: number | null;
  suggestedMaxKg: number | null;
}

export interface EvaluateArgs {
  ctx: AthleteContext;
  exerciseId: string;
  date: string;
  setGroup: SetGroup;
  /** All groups of the planned exercise (used for backoff previews). */
  groups: SetGroup[];
  groupIndex: number;
  unitOverride?: Unit | null;
  /** The athlete's actual top set today, for backoffs. */
  actualTopSet?: TopSetRef | null;
  set: { weightKg: number; reps: number; rpe?: number | null };
}

export function evaluateLoggedSet(a: EvaluateArgs): { snapshot: PrescriptionSnapshot; deviations: Deviation[] } {
  const suggestion = a.ctx.suggestGroups(a.exerciseId, a.date, a.groups, { unitOverride: a.unitOverride, actualTopSet: a.actualTopSet })[a.groupIndex];
  const unit = a.ctx.unitFor(a.exerciseId, a.unitOverride);
  const toleranceKg = toKg(a.ctx.incrementFor(a.exerciseId, unit), unit) / 2;
  const loadCtx = a.ctx.loadContext(a.exerciseId, a.date, isBackoff(a.setGroup) ? (a.actualTopSet ?? null) : null);
  return {
    snapshot: {
      setGroup: a.setGroup,
      exerciseId: a.exerciseId,
      tmKg: loadCtx.tmKg,
      suggestedMinKg: suggestion?.rounded.minKg ?? null,
      suggestedMaxKg: suggestion?.rounded.maxKg ?? null,
    },
    deviations: checkLoggedSet(a.setGroup, a.set, loadCtx, toleranceKg),
  };
}
