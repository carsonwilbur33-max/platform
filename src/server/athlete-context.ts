import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { db } from "@/db";
import { athleteExerciseSettings, athletes, exercises, rpeCharts, trainingMaxes } from "@/db/schema";
import { DEFAULT_RPE_CHART, type RpeChart } from "@/lib/calc/rpe-chart";
import { AthleteContext, type CtxAthlete, type CtxExercise, type CtxSetting, type CtxTm } from "@/lib/program/athlete-context";

/** Plain rows for building an AthleteContext (serializable, so it can be sent to the browser). */
export interface CtxRows {
  athlete: CtxAthlete;
  exercises: CtxExercise[];
  tms: CtxTm[];
  settings: CtxSetting[];
  chart: RpeChart;
}

export async function loadCtxRows(athleteId: string, tx: Tx = db): Promise<CtxRows> {
  const athlete = await tx.query.athletes.findFirst({ where: eq(athletes.id, athleteId) });
  if (!athlete) throw new Error(`Athlete ${athleteId} not found`);
  const [exs, tms, settings, chartRow] = await Promise.all([
    tx.select({ id: exercises.id, name: exercises.name, parentId: exercises.parentId, defaultTmRatio: exercises.defaultTmRatio }).from(exercises),
    tx
      .select({ exerciseId: trainingMaxes.exerciseId, weightKg: trainingMaxes.weightKg, effectiveDate: trainingMaxes.effectiveDate })
      .from(trainingMaxes)
      .where(eq(trainingMaxes.athleteId, athleteId)),
    tx
      .select({
        exerciseId: athleteExerciseSettings.exerciseId,
        unit: athleteExerciseSettings.unit,
        rounding: athleteExerciseSettings.rounding,
        tmRatio: athleteExerciseSettings.tmRatio,
      })
      .from(athleteExerciseSettings)
      .where(eq(athleteExerciseSettings.athleteId, athleteId)),
    athlete.rpeChartId
      ? tx.query.rpeCharts.findFirst({ where: eq(rpeCharts.id, athlete.rpeChartId) })
      : tx.query.rpeCharts.findFirst({ where: eq(rpeCharts.isDefault, true) }),
  ]);
  return {
    athlete: { unit: athlete.unit, roundingKg: athlete.roundingKg, roundingLb: athlete.roundingLb, e1rmFormula: athlete.e1rmFormula },
    exercises: exs,
    tms,
    settings,
    chart: chartRow?.data ?? DEFAULT_RPE_CHART,
  };
}

export function contextFromRows(r: CtxRows): AthleteContext {
  return new AthleteContext(r.athlete, r.exercises, r.tms, r.settings, r.chart);
}

export async function loadAthleteContext(athleteId: string, tx: Tx = db): Promise<AthleteContext> {
  return contextFromRows(await loadCtxRows(athleteId, tx));
}
