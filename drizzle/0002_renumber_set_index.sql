-- Logged sets are numbered within their set group (0, 1, 2…), which is how the
-- athlete logger matches them to set rows. Sets logged before this change were
-- numbered across the whole exercise; renumber them, keeping their order.
-- Sets outside any group (unprescribed) are numbered per exercise.
UPDATE "logged_sets" AS ls
SET "set_index" = sub.rn - 1
FROM (
  SELECT "id",
         row_number() OVER (
           PARTITION BY "workout_id", "set_group_id", CASE WHEN "set_group_id" IS NULL THEN "exercise_id" END
           ORDER BY "set_index", "performed_at", "id"
         ) AS rn
  FROM "logged_sets"
) AS sub
WHERE ls."id" = sub."id" AND ls."set_index" <> sub.rn - 1;
