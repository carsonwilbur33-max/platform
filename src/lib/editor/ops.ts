/**
 * Block editor operations. The client applies them to its local state
 * immediately (see reducer.ts) and sends them to the server, which applies
 * the same operations to the database in a transaction. Undo = send the
 * inverse operations. All ids are generated on the client (UUIDs) so both
 * sides agree on them without a round trip.
 */
import { z } from "zod";
import { modifiersSchema } from "@/lib/calc/prescription";

const id = z.string().uuid();
const unit = z.enum(["kg", "lb"]);

export const cellSchema = z.object({
  /** planned_exercises.id */
  id,
  exerciseId: id,
  /** Prescription shorthand; never empty (an empty cell is no cell). */
  text: z.string().min(1).max(2000),
  modifiers: modifiersSchema,
  restSeconds: z.number().int().min(0).max(3600).nullable(),
  notes: z.string().max(2000),
  unitOverride: unit.nullable(),
});
export type CellContent = z.infer<typeof cellSchema>;

export const slotSchema = z.object({ id, exerciseId: id.nullable() });
export type SlotContent = z.infer<typeof slotSchema>;

const idMap = z.record(z.string(), id);

export const opSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("setCell"), slotId: id, weekId: id, cell: cellSchema }),
  z.object({ t: z.literal("clearCell"), slotId: id, weekId: id }),
  z.object({ t: z.literal("addSlot"), dayId: id, index: z.number().int().min(0), slot: slotSchema }),
  z.object({ t: z.literal("removeSlot"), slotId: id }),
  z.object({ t: z.literal("moveSlot"), slotId: id, dayId: id, index: z.number().int().min(0) }),
  z.object({ t: z.literal("setSlotExercise"), slotId: id, exerciseId: id.nullable() }),
  z.object({
    t: z.literal("addDay"),
    index: z.number().int().min(0),
    day: z.object({ id, name: z.string().max(200), weekday: z.number().int().min(0).max(6).nullable() }),
    /** weekId → workout id for each existing week */
    workoutIds: idMap,
  }),
  z.object({ t: z.literal("removeDay"), dayId: id }),
  z.object({ t: z.literal("updateDay"), dayId: id, name: z.string().max(200), weekday: z.number().int().min(0).max(6).nullable() }),
  z.object({ t: z.literal("moveDay"), dayId: id, index: z.number().int().min(0) }),
  z.object({
    t: z.literal("addWeek"),
    index: z.number().int().min(0),
    week: z.object({ id }),
    /** dayId → workout id for each existing day */
    workoutIds: idMap,
  }),
  z.object({ t: z.literal("removeWeek"), weekId: id }),
]);
export type Op = z.infer<typeof opSchema>;
export const opsSchema = z.array(opSchema).min(1).max(2000);
