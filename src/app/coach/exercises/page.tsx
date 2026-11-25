import { asc } from "drizzle-orm";
import { db } from "@/db";
import { exercises } from "@/db/schema";
import { ExerciseLibrary } from "./library";

export const metadata = { title: "Exercises" };

export default async function ExercisesPage() {
  const rows = await db.select().from(exercises).orderBy(asc(exercises.name));
  return (
    <ExerciseLibrary
      exercises={rows.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        parentId: e.parentId,
        defaultTmRatio: e.defaultTmRatio,
        isCustom: e.isCustom,
        archived: !!e.archivedAt,
      }))}
    />
  );
}
