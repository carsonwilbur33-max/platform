import { eq } from "drizzle-orm";
import type { Tx } from "@/db";
import { db } from "@/db";
import { athleteExerciseSettings, athletes, exercises, rpeCharts, trainingMaxes } from "@/db/schema";
import { DEFAULT_RPE_CHART } from "@/lib/calc/rpe-chart";
import { AthleteContext } from "@/lib/program/athlete-context";

export async function loadAthleteContext(athleteId: string, tx: Tx = db): Promise<AthleteContext> {
  const athlete = await tx.query.athletes.findFirst({ where: eq(athletes.id, athleteId) });
  if (!athlete) throw new Error(`Athlete ${athleteId} not found`);
  const [exs, tms, settings, chartRow] = await Promise.all([
    tx.select({ id: exercises.id, name: exercises.name, parentId: exercises.parentId, defaultTmRatio: exercises.defaultTmRatio }).from(exercises),
    tx
      .select({ exerciseId: trainingMaxes.exerciseId, weightKg: trainingMaxes.weightKg, effectiveDate: trainingMaxes.effectiveDate })
      .from(trainingMaxes)
      .where(eq(trainingMaxes.athleteId, athleteId)),
    tx.select().from(athleteExerciseSettings).where(eq(athleteExerciseSettings.athleteId, athleteId)),
    athlete.rpeChartId
      ? tx.query.rpeCharts.findFirst({ where: eq(rpeCharts.id, athlete.rpeChartId) })
      : tx.query.rpeCharts.findFirst({ where: eq(rpeCharts.isDefault, true) }),
  ]);
  return new AthleteContext(athlete, exs, tms, settings, chartRow?.data ?? DEFAULT_RPE_CHART);
}
