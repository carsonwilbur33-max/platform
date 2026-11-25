/**
 * Everything needed to turn an athlete's prescriptions into loads:
 * dated TMs, parent-lift ratios, per-exercise unit/rounding overrides, and
 * the RPE chart. Pure — built from rows, no database access.
 */
import type { E1rmFormula } from "@/lib/calc/e1rm";
import {
  effectiveTm,
  estimateTopSet,
  findTopSetGroup,
  formatSuggestion,
  roundSuggestion,
  suggestLoad,
  tmAsOf,
  type LoadContext,
  type RoundedSuggestion,
  type TopSetRef,
} from "@/lib/calc/load";
import { isBackoff, type SetGroup } from "@/lib/calc/prescription";
import { DEFAULT_RPE_CHART, type RpeChart } from "@/lib/calc/rpe-chart";
import type { Unit } from "@/lib/calc/units";

export interface CtxAthlete {
  unit: Unit;
  roundingKg: number;
  roundingLb: number;
  e1rmFormula: E1rmFormula;
}

export interface CtxExercise {
  id: string;
  name: string;
  parentId: string | null;
  defaultTmRatio: number | null;
}

export interface CtxTm {
  exerciseId: string;
  weightKg: number;
  effectiveDate: string;
}

export interface CtxSetting {
  exerciseId: string;
  unit: Unit | null;
  rounding: number | null;
  tmRatio: number | null;
}

export interface CellSuggestion {
  text: string;
  rounded: RoundedSuggestion;
}

export class AthleteContext {
  private exercises: Map<string, CtxExercise>;
  private tms: Map<string, CtxTm[]>;
  private settings: Map<string, CtxSetting>;

  constructor(
    public readonly athlete: CtxAthlete,
    exercises: CtxExercise[],
    tms: CtxTm[],
    settings: CtxSetting[],
    public readonly chart: RpeChart = DEFAULT_RPE_CHART,
  ) {
    this.exercises = new Map(exercises.map((e) => [e.id, e]));
    this.tms = new Map();
    for (const t of tms) {
      const list = this.tms.get(t.exerciseId) ?? [];
      list.push(t);
      this.tms.set(t.exerciseId, list);
    }
    this.settings = new Map(settings.map((s) => [s.exerciseId, s]));
  }

  exercisesList(): CtxExercise[] {
    return [...this.exercises.values()];
  }

  /** TM effective on `date`: own TM, else parent's TM × ratio (athlete override → exercise default). */
  tmFor(exerciseId: string, date: string): number | null {
    const own = tmAsOf(this.tms.get(exerciseId) ?? [], date)?.weightKg ?? null;
    if (own) return own;
    const ex = this.exercises.get(exerciseId);
    if (!ex?.parentId) return null;
    const ratio = this.settings.get(exerciseId)?.tmRatio ?? ex.defaultTmRatio;
    const parentTm = this.tmFor(ex.parentId, date);
    return effectiveTm(null, parentTm, ratio);
  }

  /** Display unit for an exercise: planned-exercise override → athlete exercise setting → athlete default. */
  unitFor(exerciseId: string, plannedOverride?: Unit | null): Unit {
    return plannedOverride ?? this.settings.get(exerciseId)?.unit ?? this.athlete.unit;
  }

  incrementFor(exerciseId: string, unit: Unit): number {
    const s = this.settings.get(exerciseId);
    if (s?.rounding && (s.unit ?? this.athlete.unit) === unit) return s.rounding;
    return unit === "kg" ? this.athlete.roundingKg : this.athlete.roundingLb;
  }

  loadContext(exerciseId: string, date: string, topSet?: TopSetRef | null): LoadContext {
    return { tmKg: this.tmFor(exerciseId, date), chart: this.chart, formula: this.athlete.e1rmFormula, topSet: topSet ?? null };
  }

  /**
   * Suggested loads for every set group of one planned exercise.
   * Backoffs use `actualTopSet` when given (athlete side), otherwise an
   * estimate from the top-set group's own suggestion (coach preview).
   */
  suggestGroups(
    exerciseId: string,
    date: string,
    groups: SetGroup[],
    opts: { unitOverride?: Unit | null; actualTopSet?: TopSetRef | null } = {},
  ): (CellSuggestion | null)[] {
    const unit = this.unitFor(exerciseId, opts.unitOverride);
    const inc = this.incrementFor(exerciseId, unit);
    const base = this.loadContext(exerciseId, date);
    return groups.map((g, i) => {
      let topSet: TopSetRef | null = null;
      if (isBackoff(g)) {
        if (opts.actualTopSet) topSet = opts.actualTopSet;
        else {
          const top = findTopSetGroup(groups, i);
          topSet = top ? estimateTopSet(top, base) : null;
        }
      }
      const s = suggestLoad(g, { ...base, topSet });
      if (!s) return null;
      const rounded = roundSuggestion(s, unit, inc);
      return { text: formatSuggestion(rounded), rounded };
    });
  }
}
