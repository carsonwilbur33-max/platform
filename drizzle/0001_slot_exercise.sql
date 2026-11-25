ALTER TABLE "slots" ADD COLUMN "exercise_id" uuid;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Backfill: each existing row takes the exercise most of its weeks use.
UPDATE "slots" AS s SET "exercise_id" = sub."exercise_id"
FROM (
  SELECT DISTINCT ON ("slot_id") "slot_id", "exercise_id"
  FROM "planned_exercises"
  WHERE "slot_id" IS NOT NULL
  GROUP BY "slot_id", "exercise_id"
  ORDER BY "slot_id", count(*) DESC, "exercise_id"
) AS sub
WHERE s."id" = sub."slot_id";
