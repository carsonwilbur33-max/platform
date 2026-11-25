"use server";

import { db, type Tx } from "@/db";
import { requireAthlete } from "@/server/auth";
import {
  addNote,
  deleteNote,
  deleteSet,
  LoggingError,
  recordSet,
  setSessionCompleted,
  setSessionNotes,
  type LoggedSetDTO,
  type NoteDTO,
} from "@/server/logging";
import type { ActionResult } from "./editor";

async function run<T>(fn: (tx: Tx, athleteId: string) => Promise<T>): Promise<ActionResult<{ value: T }>> {
  const { athlete } = await requireAthlete();
  try {
    const value = await db.transaction((tx) => fn(tx as unknown as Tx, athlete.id));
    return { ok: true, value };
  } catch (e) {
    if (e instanceof LoggingError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Couldn't save. Check your connection and try again." };
  }
}

export async function logSet(raw: unknown): Promise<ActionResult<{ value: LoggedSetDTO }>> {
  return run((tx, athleteId) => recordSet(tx, athleteId, raw));
}

export async function removeSet(setId: string): Promise<ActionResult<{ value: void }>> {
  return run((tx, athleteId) => deleteSet(tx, athleteId, setId));
}

export async function addSessionNote(raw: unknown): Promise<ActionResult<{ value: NoteDTO }>> {
  return run((tx, athleteId) => addNote(tx, athleteId, raw));
}

export async function removeSessionNote(noteId: string): Promise<ActionResult<{ value: void }>> {
  return run((tx, athleteId) => deleteNote(tx, athleteId, noteId));
}

export async function saveSessionNotes(workoutId: string, text: string): Promise<ActionResult<{ value: void }>> {
  return run((tx, athleteId) => setSessionNotes(tx, athleteId, workoutId, String(text)));
}

export async function completeSession(workoutId: string, completed: boolean): Promise<ActionResult<{ value: void }>> {
  return run((tx, athleteId) => setSessionCompleted(tx, athleteId, workoutId, completed));
}
