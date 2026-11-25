"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { athletes, blocks, programs } from "@/db/schema";
import { requireCoach } from "@/server/auth";
import { copyBlock, createBlankBlock } from "@/server/block-ops";
import type { ActionResult } from "./editor";

const KINDS = ["hypertrophy", "strength", "peak", "pivot", "taper", "other"] as const;
const date = z.preprocess((v) => (v === "" || v == null ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable());

const newBlockSchema = z
  .object({
    /** Absent for a new template. */
    athleteId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()).default(null),
    /** Existing program id, or "new". */
    programId: z.string().default("new"),
    programName: z.string().trim().max(200).default(""),
    name: z.string().trim().min(1, "Give the block a name.").max(200),
    kind: z.enum(KINDS).default("other"),
    startDate: date.default(null),
    source: z.enum(["blank", "template", "copy"]).default("blank"),
    sourceBlockId: z.preprocess((v) => (v === "" ? null : v), z.string().uuid().nullable()).default(null),
    weeks: z.coerce.number().int().min(1, "At least 1 week.").max(26).default(4),
    /** Weekday numbers (0 = Mon) for a blank block, e.g. ["0","2","4"]. */
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).default([]),
    dayCount: z.coerce.number().int().min(1).max(14).default(3),
  })
  .refine((v) => v.source === "blank" || v.sourceBlockId, { message: "Pick a block to start from.", path: ["sourceBlockId"] });

/** Create a block for an athlete (or a new template): blank, from a template, or as a copy of another block. */
export async function createBlock(form: FormData): Promise<ActionResult<{ blockId: string }>> {
  await requireCoach();
  const raw = { ...Object.fromEntries(form), weekdays: form.getAll("weekdays") };
  const p = newBlockSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Check the form." };
  const v = p.data;

  if (v.athleteId) {
    const a = await db.query.athletes.findFirst({ where: eq(athletes.id, v.athleteId) });
    if (!a) return { ok: false, error: "Athlete not found." };
  }

  let blockId: string;
  try {
    blockId = await db.transaction(async (tx) => {
    const t = tx as unknown as Tx;
    let programId: string;
    if (v.programId !== "new") {
      const prog = await tx.query.programs.findFirst({ where: eq(programs.id, v.programId) });
      if (!prog || prog.athleteId !== v.athleteId) throw new Error("Program doesn't belong to this athlete.");
      programId = prog.id;
    } else {
      const [prog] = await tx
        .insert(programs)
        .values({ athleteId: v.athleteId, isTemplate: !v.athleteId, name: v.programName || v.name })
        .returning();
      programId = prog.id;
    }
    const startDate = v.athleteId ? v.startDate : null;
    if (v.source === "blank") {
      const days = v.weekdays.length
        ? [...new Set(v.weekdays)].sort().map((weekday, i) => ({ name: `Day ${i + 1}`, weekday }))
        : Array.from({ length: v.dayCount }, (_, i) => ({ name: `Day ${i + 1}`, weekday: null }));
      return createBlankBlock(t, { programId, name: v.name, kind: v.kind, startDate, weeks: v.weeks, days });
    }
    const src = await tx.query.blocks.findFirst({ where: eq(blocks.id, v.sourceBlockId!) });
    if (!src) throw new Error("Source block not found.");
    return copyBlock(t, src.id, { programId, name: v.name, kind: v.kind, startDate });
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create the block." };
  }
  revalidatePath("/coach", "layout");
  return { ok: true, blockId };
}

export async function renameProgram(programId: string, name: string): Promise<ActionResult> {
  await requireCoach();
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Name is required." };
  await db.update(programs).set({ name: clean }).where(eq(programs.id, programId));
  revalidatePath("/coach", "layout");
  return { ok: true };
}

/** Rename a template (its program and its single block together). */
export async function renameTemplate(blockId: string, name: string): Promise<ActionResult> {
  await requireCoach();
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Name is required." };
  const b = await db.query.blocks.findFirst({ where: eq(blocks.id, blockId) });
  if (!b) return { ok: false, error: "Template not found." };
  await db.transaction(async (tx) => {
    await tx.update(blocks).set({ name: clean }).where(eq(blocks.id, blockId));
    await tx.update(programs).set({ name: clean }).where(and(eq(programs.id, b.programId), eq(programs.isTemplate, true)));
  });
  revalidatePath("/coach", "layout");
  return { ok: true };
}
