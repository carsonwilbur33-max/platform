import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { blockDays, blocks, exercises, loggedSets, plannedExercises, programs, setGroups, slots, weeks, workouts } from "@/db/schema";
import { formatModifiers, type SetGroup } from "@/lib/calc/prescription";
import { formatSetGroup } from "@/lib/calc/shorthand";
import { plannedDate } from "@/lib/dates";
import { loadAthleteContext } from "./athlete-context";

export interface GridGroup {
  id: string;
  text: string;
  suggestion: string | null;
  clamped: boolean;
  loggedCount: number;
}

export interface GridCell {
  plannedExerciseId: string;
  exerciseId: string;
  exerciseName: string;
  /** True when this week's exercise differs from the row's usual exercise. */
  swapped: boolean;
  modifiers: string;
  restSeconds: number | null;
  notes: string;
  unit: "kg" | "lb";
  tmKg: number | null;
  groups: GridGroup[];
}

export interface GridRow {
  slotId: string;
  /** The exercise most weeks use; shown as the row label. */
  label: string;
  cells: (GridCell | null)[];
}

export interface GridDay {
  id: string;
  name: string;
  weekday: number | null;
  workouts: ({ id: string; date: string | null; completed: boolean; loggedSets: number } | null)[];
  rows: GridRow[];
}

export interface BlockGridData {
  block: typeof blocks.$inferSelect;
  program: typeof programs.$inferSelect;
  weeks: { id: string; position: number; startDate: string | null }[];
  days: GridDay[];
}

/** Everything the block view needs, with suggested loads resolved for the program's athlete. */
export async function getBlockGrid(blockId: string): Promise<BlockGridData | null> {
  const block = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
  if (!block) return null;
  const program = (await db.query.programs.findFirst({ where: eq(programs.id, block.programId) }))!;
  const ctx = program.athleteId ? await loadAthleteContext(program.athleteId) : null;

  const weekRows = await db.select().from(weeks).where(eq(weeks.blockId, blockId)).orderBy(asc(weeks.position));
  const dayRows = await db.select().from(blockDays).where(eq(blockDays.blockId, blockId)).orderBy(asc(blockDays.position));
  const dayIds = dayRows.map((d) => d.id);
  const slotRows = dayIds.length ? await db.select().from(slots).where(inArray(slots.blockDayId, dayIds)).orderBy(asc(slots.position)) : [];
  const workoutRows = dayIds.length ? await db.select().from(workouts).where(inArray(workouts.blockDayId, dayIds)) : [];
  const workoutIds = workoutRows.map((w) => w.id);
  const peRows = workoutIds.length
    ? await db
        .select({ pe: plannedExercises, exName: exercises.name })
        .from(plannedExercises)
        .innerJoin(exercises, eq(exercises.id, plannedExercises.exerciseId))
        .where(inArray(plannedExercises.workoutId, workoutIds))
    : [];
  const peIds = peRows.map((r) => r.pe.id);
  const sgRows = peIds.length ? await db.select().from(setGroups).where(inArray(setGroups.plannedExerciseId, peIds)).orderBy(asc(setGroups.position)) : [];
  const logRows = workoutIds.length
    ? await db.select({ workoutId: loggedSets.workoutId, setGroupId: loggedSets.setGroupId }).from(loggedSets).where(inArray(loggedSets.workoutId, workoutIds))
    : [];

  const logsBySg = new Map<string, number>();
  const logsByWorkout = new Map<string, number>();
  for (const l of logRows) {
    if (l.setGroupId) logsBySg.set(l.setGroupId, (logsBySg.get(l.setGroupId) ?? 0) + 1);
    logsByWorkout.set(l.workoutId, (logsByWorkout.get(l.workoutId) ?? 0) + 1);
  }
  const sgByPe = new Map<string, (typeof sgRows)[number][]>();
  for (const sg of sgRows) {
    const list = sgByPe.get(sg.plannedExerciseId) ?? [];
    list.push(sg);
    sgByPe.set(sg.plannedExerciseId, list);
  }
  const weekIndex = new Map(weekRows.map((w, i) => [w.id, i]));
  const workoutByDayWeek = new Map(workoutRows.map((w) => [`${w.blockDayId}:${w.weekId}`, w]));
  const workoutById = new Map(workoutRows.map((w) => [w.id, w]));

  const days: GridDay[] = dayRows.map((d) => {
    const dWorkouts = weekRows.map((w) => {
      const wo = workoutByDayWeek.get(`${d.id}:${w.id}`);
      if (!wo) return null;
      const date = wo.plannedDate ?? (block.startDate ? plannedDate(block.startDate, weekIndex.get(w.id)!, d.weekday) : null);
      return { id: wo.id, date, completed: !!wo.completedAt, loggedSets: logsByWorkout.get(wo.id) ?? 0 };
    });
    const rows: GridRow[] = slotRows
      .filter((s) => s.blockDayId === d.id)
      .map((slot) => {
        const cellsRaw = weekRows.map((_, wi) => {
          const wo = dWorkouts[wi];
          return wo ? (peRows.find((r) => r.pe.slotId === slot.id && r.pe.workoutId === wo.id) ?? null) : null;
        });
        // Row label: the most common exercise across weeks.
        const counts = new Map<string, number>();
        for (const c of cellsRaw) if (c) counts.set(c.exName, (counts.get(c.exName) ?? 0) + 1);
        const label = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
        const cells = cellsRaw.map((c): GridCell | null => {
          if (!c) return null;
          const wo = workoutById.get(c.pe.workoutId)!;
          const date = wo.plannedDate ?? block.startDate ?? "9999-12-31";
          const sgs = sgByPe.get(c.pe.id) ?? [];
          const prescriptions: SetGroup[] = sgs.map((g) => g.prescription);
          const suggestions = ctx ? ctx.suggestGroups(c.pe.exerciseId, date, prescriptions, { unitOverride: c.pe.unitOverride }) : [];
          return {
            plannedExerciseId: c.pe.id,
            exerciseId: c.pe.exerciseId,
            exerciseName: c.exName,
            swapped: c.exName !== label,
            modifiers: formatModifiers(c.pe.modifiers),
            restSeconds: c.pe.restSeconds,
            notes: c.pe.notes,
            unit: ctx ? ctx.unitFor(c.pe.exerciseId, c.pe.unitOverride) : "kg",
            tmKg: ctx ? ctx.tmFor(c.pe.exerciseId, date) : null,
            groups: sgs.map((g, i) => ({
              id: g.id,
              text: formatSetGroup(g.prescription),
              suggestion: suggestions[i]?.text ?? null,
              clamped: suggestions[i]?.rounded.clamped ?? false,
              loggedCount: logsBySg.get(g.id) ?? 0,
            })),
          };
        });
        return { slotId: slot.id, label, cells };
      });
    return { id: d.id, name: d.name, weekday: d.weekday, workouts: dWorkouts, rows };
  });

  return {
    block,
    program,
    weeks: weekRows.map((w, i) => ({ id: w.id, position: w.position, startDate: block.startDate ? plannedDate(block.startDate, i, null) : null })),
    days,
  };
}
