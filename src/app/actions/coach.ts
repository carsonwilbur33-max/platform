"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { athleteExerciseSettings, athletes, trainingMaxes } from "@/db/schema";
import { toKg } from "@/lib/calc/units";
import { createInvite, requireCoach } from "@/server/auth";
import type { FormState } from "./auth";

const unit = z.enum(["kg", "lb"]);
const optNum = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().positive().nullable());

const athleteSchema = z.object({
  name: z.string().trim().min(1, "Name is required."),
  email: z.preprocess((v) => (v === "" ? null : v), z.string().trim().toLowerCase().email().nullable()),
  unit,
  roundingKg: z.coerce.number().positive().default(2.5),
  roundingLb: z.coerce.number().positive().default(5),
  bodyweight: optNum,
  e1rmFormula: z.enum(["epley", "brzycki"]).default("epley"),
  notes: z.string().default(""),
});

export async function createAthlete(_: FormState, form: FormData): Promise<FormState> {
  await requireCoach();
  const p = athleteSchema.safeParse({ ...Object.fromEntries(form), roundingKg: form.get("roundingKg") || 2.5, roundingLb: form.get("roundingLb") || 5 });
  if (!p.success) return { error: p.error.issues[0]?.message };
  const [a] = await db
    .insert(athletes)
    .values({
      name: p.data.name,
      email: p.data.email,
      unit: p.data.unit,
      roundingKg: p.data.roundingKg,
      roundingLb: p.data.roundingLb,
      bodyweightKg: p.data.bodyweight == null ? null : toKg(p.data.bodyweight, p.data.unit),
      notes: p.data.notes,
    })
    .returning();
  redirect(`/coach/athletes/${a.id}`);
}

export async function updateAthlete(athleteId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireCoach();
  const p = athleteSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  await db
    .update(athletes)
    .set({
      name: p.data.name,
      email: p.data.email,
      unit: p.data.unit,
      roundingKg: p.data.roundingKg,
      roundingLb: p.data.roundingLb,
      bodyweightKg: p.data.bodyweight == null ? null : toKg(p.data.bodyweight, p.data.unit),
      e1rmFormula: p.data.e1rmFormula,
      notes: p.data.notes,
    })
    .where(eq(athletes.id, athleteId));
  revalidatePath(`/coach/athletes/${athleteId}`);
  return {};
}

const tmSchema = z.object({
  exerciseId: z.string().uuid("Pick an exercise."),
  weight: z.coerce.number().positive("Enter a weight."),
  unit,
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  note: z.string().default(""),
});

export async function addTrainingMax(athleteId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireCoach();
  const p = tmSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  await db.insert(trainingMaxes).values({
    athleteId,
    exerciseId: p.data.exerciseId,
    weightKg: toKg(p.data.weight, p.data.unit),
    effectiveDate: p.data.effectiveDate,
    note: p.data.note,
  });
  revalidatePath(`/coach/athletes/${athleteId}`);
  return {};
}

export async function deleteTrainingMax(athleteId: string, tmId: string): Promise<void> {
  await requireCoach();
  await db.delete(trainingMaxes).where(and(eq(trainingMaxes.id, tmId), eq(trainingMaxes.athleteId, athleteId)));
  revalidatePath(`/coach/athletes/${athleteId}`);
}

const overrideSchema = z.object({
  exerciseId: z.string().uuid("Pick an exercise."),
  unit: z.preprocess((v) => (v === "" ? null : v), unit.nullable()),
  rounding: optNum,
  tmRatio: z.preprocess((v) => (v === "" || v == null ? null : Number(v) / 100), z.number().positive().max(2).nullable()),
});

export async function upsertExerciseOverride(athleteId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireCoach();
  const p = overrideSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0]?.message };
  const { exerciseId, ...values } = p.data;
  await db
    .insert(athleteExerciseSettings)
    .values({ athleteId, exerciseId, ...values })
    .onConflictDoUpdate({ target: [athleteExerciseSettings.athleteId, athleteExerciseSettings.exerciseId], set: values });
  revalidatePath(`/coach/athletes/${athleteId}`);
  return {};
}

export async function deleteExerciseOverride(athleteId: string, exerciseId: string): Promise<void> {
  await requireCoach();
  await db
    .delete(athleteExerciseSettings)
    .where(and(eq(athleteExerciseSettings.athleteId, athleteId), eq(athleteExerciseSettings.exerciseId, exerciseId)));
  revalidatePath(`/coach/athletes/${athleteId}`);
}

/** Returns the full invite URL. Generating a new link revokes older unused ones. */
export async function generateInviteLink(athleteId: string): Promise<{ url: string }> {
  await requireCoach();
  const token = await createInvite(athleteId);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return { url: `${proto}://${host}/invite/${token}` };
}
