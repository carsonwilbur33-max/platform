import { and, asc, eq, gte, isNull } from "drizzle-orm";
import { db } from "@/db";
import { athleteExerciseSettings, athletes, blocks, exercises, meetEntries, meets, programs, rpeCharts, trainingMaxes } from "@/db/schema";
import { DEFAULT_RPE_CHART, type RpeChart } from "@/lib/calc/rpe-chart";
import type { CtxAthlete, CtxExercise, CtxSetting, CtxTm } from "@/lib/program/athlete-context";
import type { EdState } from "@/lib/editor/state";
import { todayISO } from "@/lib/dates";
import { loadEdState } from "./block-ops";

export interface LibraryExercise {
  id: string;
  name: string;
  category: string;
  parentId: string | null;
  defaultTmRatio: number | null;
  archived: boolean;
}

export interface EditorData {
  state: EdState;
  block: { id: string; name: string; kind: string; startDate: string | null; notes: string; programId: string };
  program: { id: string; name: string; isTemplate: boolean; athleteId: string | null };
  athlete: ({ id: string; name: string } & CtxAthlete) | null;
  ctx: { exercises: CtxExercise[]; tms: CtxTm[]; settings: CtxSetting[]; chart: RpeChart } | null;
  library: LibraryExercise[];
  siblings: { id: string; name: string }[];
  meet: { name: string; date: string } | null;
  today: string;
}

export async function getEditorData(blockId: string): Promise<EditorData | null> {
  const block = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
  if (!block) return null;
  const program = (await db.query.programs.findFirst({ where: eq(programs.id, block.programId) }))!;
  const state = (await loadEdState(db, blockId))!;
  const today = todayISO();

  const lib = await db.select().from(exercises).orderBy(asc(exercises.name));
  const library: LibraryExercise[] = lib.map((e) => ({
    id: e.id,
    name: e.name,
    category: e.category,
    parentId: e.parentId,
    defaultTmRatio: e.defaultTmRatio,
    archived: !!e.archivedAt,
  }));
  const siblings = await db
    .select({ id: blocks.id, name: blocks.name })
    .from(blocks)
    .where(eq(blocks.programId, program.id))
    .orderBy(asc(blocks.position));

  let athlete: EditorData["athlete"] = null;
  let ctx: EditorData["ctx"] = null;
  let meet: EditorData["meet"] = null;
  if (program.athleteId) {
    const a = (await db.query.athletes.findFirst({ where: eq(athletes.id, program.athleteId) }))!;
    athlete = { id: a.id, name: a.name, unit: a.unit, roundingKg: a.roundingKg, roundingLb: a.roundingLb, e1rmFormula: a.e1rmFormula };
    const [tms, settings, chartRow, m] = await Promise.all([
      db
        .select({ exerciseId: trainingMaxes.exerciseId, weightKg: trainingMaxes.weightKg, effectiveDate: trainingMaxes.effectiveDate })
        .from(trainingMaxes)
        .where(eq(trainingMaxes.athleteId, a.id)),
      db
        .select({
          exerciseId: athleteExerciseSettings.exerciseId,
          unit: athleteExerciseSettings.unit,
          rounding: athleteExerciseSettings.rounding,
          tmRatio: athleteExerciseSettings.tmRatio,
        })
        .from(athleteExerciseSettings)
        .where(eq(athleteExerciseSettings.athleteId, a.id)),
      a.rpeChartId
        ? db.query.rpeCharts.findFirst({ where: eq(rpeCharts.id, a.rpeChartId) })
        : db.query.rpeCharts.findFirst({ where: eq(rpeCharts.isDefault, true) }),
      db
        .select({ name: meets.name, date: meets.date })
        .from(meetEntries)
        .innerJoin(meets, eq(meets.id, meetEntries.meetId))
        .where(and(eq(meetEntries.athleteId, a.id), gte(meets.date, today)))
        .orderBy(asc(meets.date))
        .limit(1),
    ]);
    ctx = {
      exercises: library.map((e) => ({ id: e.id, name: e.name, parentId: e.parentId, defaultTmRatio: e.defaultTmRatio })),
      tms,
      settings,
      chart: chartRow?.data ?? DEFAULT_RPE_CHART,
    };
    meet = m[0] ?? null;
  }

  return {
    state,
    block: { id: block.id, name: block.name, kind: block.kind, startDate: block.startDate, notes: block.notes, programId: block.programId },
    program: { id: program.id, name: program.name, isTemplate: program.isTemplate, athleteId: program.athleteId },
    athlete,
    ctx,
    library,
    siblings,
    meet,
    today,
  };
}

/** Templates (programs with isTemplate) and their blocks, for "new block from template". */
export async function listTemplateBlocks() {
  return db
    .select({ blockId: blocks.id, blockName: blocks.name, programId: programs.id, programName: programs.name })
    .from(blocks)
    .innerJoin(programs, eq(programs.id, blocks.programId))
    .where(and(eq(programs.isTemplate, true), isNull(programs.archivedAt)))
    .orderBy(asc(programs.name), asc(blocks.position));
}
