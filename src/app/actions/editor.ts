"use server";

import { and, count, eq, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { blocks, exercises, loggedSets, programs, weeks, workouts } from "@/db/schema";
import { addDays } from "@/lib/dates";
import { opsSchema } from "@/lib/editor/ops";
import { EditorError, type EdState } from "@/lib/editor/state";
import { requireCoach } from "@/server/auth";
import { applyBlockOps, blockWeekCount, copyBlock, loadEdState } from "@/server/block-ops";
import type { LibraryExercise } from "@/server/editor-data";

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

function errorMessage(e: unknown): string {
  if (e instanceof EditorError) return e.message;
  console.error(e);
  return "Something went wrong saving. Reload to see the saved version.";
}

/** Apply a batch of editor ops in one transaction. */
export async function saveBlockOps(blockId: string, rawOps: unknown): Promise<ActionResult> {
  await requireCoach();
  const parsed = opsSchema.safeParse(rawOps);
  if (!parsed.success) return { ok: false, error: "Invalid edit." };
  try {
    await db.transaction((tx) => applyBlockOps(tx as unknown as Tx, blockId, parsed.data));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** The block as saved, for resyncing after an error. */
export async function reloadBlockState(blockId: string): Promise<ActionResult<{ state: EdState }>> {
  await requireCoach();
  const state = await loadEdState(db, blockId);
  return state ? { ok: true, state } : { ok: false, error: "Block not found." };
}

const metaSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(200),
  kind: z.enum(["hypertrophy", "strength", "peak", "pivot", "taper", "other"]),
  startDate: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()),
  notes: z.string().max(5000),
});

export async function updateBlockMeta(blockId: string, raw: unknown): Promise<ActionResult<{ state: EdState }>> {
  await requireCoach();
  const p = metaSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid." };
  await db.transaction(async (tx) => {
    await tx.update(blocks).set(p.data).where(eq(blocks.id, blockId));
    await applyBlockOps(tx as unknown as Tx, blockId, []); // recompute dates
  });
  revalidatePath("/coach", "layout");
  return { ok: true, state: (await loadEdState(db, blockId))! };
}

/** Copy this block into the same program, starting the week after it ends. */
export async function duplicateBlock(blockId: string): Promise<ActionResult<{ blockId: string }>> {
  await requireCoach();
  const src = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
  if (!src) return { ok: false, error: "Block not found." };
  const id = await db.transaction(async (tx) => {
    const t = tx as unknown as Tx;
    const n = await blockWeekCount(t, blockId);
    // shift later blocks down one position
    await tx
      .update(blocks)
      .set({ position: sql`${blocks.position} + 1` })
      .where(and(eq(blocks.programId, src.programId), sql`${blocks.position} > ${src.position}`));
    return copyBlock(t, blockId, {
      programId: src.programId,
      name: `${src.name} (copy)`,
      startDate: src.startDate ? addDays(src.startDate, n * 7) : null,
      position: src.position + 1,
    });
  });
  revalidatePath("/coach", "layout");
  return { ok: true, blockId: id };
}

/** Save a copy of this block as a new template. Later edits to either never affect the other. */
export async function saveBlockAsTemplate(blockId: string, name: string): Promise<ActionResult<{ blockId: string }>> {
  await requireCoach();
  const clean = name.trim() || "Untitled template";
  const id = await db.transaction(async (tx) => {
    const [p] = await tx.insert(programs).values({ name: clean, isTemplate: true }).returning();
    return copyBlock(tx as unknown as Tx, blockId, { programId: p.id, name: clean, startDate: null });
  });
  revalidatePath("/coach", "layout");
  return { ok: true, blockId: id };
}

/** Delete a block. Refused if any session in it has been logged. */
export async function deleteBlock(blockId: string): Promise<ActionResult<{ programId: string; athleteId: string | null }>> {
  await requireCoach();
  const block = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
  if (!block) return { ok: false, error: "Block not found." };
  const wos = await db
    .select({ id: workouts.id })
    .from(workouts)
    .innerJoin(weeks, eq(weeks.id, workouts.weekId))
    .where(eq(weeks.blockId, blockId));
  if (wos.length) {
    const [{ n }] = await db.select({ n: count() }).from(loggedSets).where(inArray(loggedSets.workoutId, wos.map((w) => w.id)));
    if (n > 0) return { ok: false, error: "This block has logged training and can't be deleted." };
  }
  const program = (await db.query.programs.findFirst({ where: eq(programs.id, block.programId) }))!;
  await db.transaction(async (tx) => {
    await tx.delete(blocks).where(eq(blocks.id, blockId));
    // Templates are one program per block: remove the empty template program too.
    if (program.isTemplate) {
      const [{ n }] = await tx.select({ n: count() }).from(blocks).where(eq(blocks.programId, program.id));
      if (n === 0) await tx.delete(programs).where(eq(programs.id, program.id));
    }
  });
  revalidatePath("/coach", "layout");
  return { ok: true, programId: program.id, athleteId: program.athleteId };
}

const exerciseSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  category: z.enum(["squat", "bench", "deadlift", "upper", "lower", "core", "other"]),
  parentId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()),
  defaultTmRatio: z.preprocess((v) => (v === "" || v == null ? null : Number(v) / 100), z.number().positive().max(2).nullable()),
});

/** Create a custom exercise (from the grid's exercise picker or the library page). */
export async function createExercise(raw: unknown): Promise<ActionResult<{ exercise: LibraryExercise }>> {
  await requireCoach();
  const p = exerciseSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid." };
  const dupe = await db.query.exercises.findFirst({ where: sql`lower(${exercises.name}) = ${p.data.name.toLowerCase()}` });
  if (dupe) return { ok: false, error: `"${dupe.name}" already exists.` };
  const [e] = await db.insert(exercises).values({ ...p.data, isCustom: true }).returning();
  revalidatePath("/coach/exercises");
  return {
    ok: true,
    exercise: { id: e.id, name: e.name, category: e.category, parentId: e.parentId, defaultTmRatio: e.defaultTmRatio, archived: false },
  };
}

export async function updateExercise(id: string, raw: unknown): Promise<ActionResult> {
  await requireCoach();
  const p = exerciseSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Invalid." };
  if (p.data.parentId === id) return { ok: false, error: "An exercise can't be a variation of itself." };
  const dupe = await db.query.exercises.findFirst({ where: sql`lower(${exercises.name}) = ${p.data.name.toLowerCase()} and ${exercises.id} <> ${id}` });
  if (dupe) return { ok: false, error: `"${dupe.name}" already exists.` };
  await db.update(exercises).set(p.data).where(eq(exercises.id, id));
  revalidatePath("/coach/exercises");
  return { ok: true };
}

/** Archived exercises disappear from the picker; existing programs keep them. */
export async function setExerciseArchived(id: string, archived: boolean): Promise<ActionResult> {
  await requireCoach();
  await db.update(exercises).set({ archivedAt: archived ? new Date() : null }).where(eq(exercises.id, id));
  revalidatePath("/coach/exercises");
  return { ok: true };
}
