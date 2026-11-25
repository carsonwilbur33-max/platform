CREATE TYPE "public"."attempt_result" AS ENUM('good', 'no_lift');--> statement-breakpoint
CREATE TYPE "public"."block_kind" AS ENUM('hypertrophy', 'strength', 'peak', 'pivot', 'taper', 'other');--> statement-breakpoint
CREATE TYPE "public"."exercise_category" AS ENUM('squat', 'bench', 'deadlift', 'upper', 'lower', 'core', 'other');--> statement-breakpoint
CREATE TYPE "public"."e1rm_formula" AS ENUM('epley', 'brzycki');--> statement-breakpoint
CREATE TYPE "public"."lift" AS ENUM('squat', 'bench', 'deadlift');--> statement-breakpoint
CREATE TYPE "public"."note_kind" AS ENUM('note', 'pain', 'missed_reps', 'other');--> statement-breakpoint
CREATE TYPE "public"."record_context" AS ENUM('gym', 'meet');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('coach', 'athlete');--> statement-breakpoint
CREATE TYPE "public"."unit" AS ENUM('kg', 'lb');--> statement-breakpoint
CREATE TABLE "athlete_exercise_settings" (
	"athlete_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"unit" "unit",
	"rounding" double precision,
	"tm_ratio" double precision,
	CONSTRAINT "athlete_exercise_settings_athlete_id_exercise_id_pk" PRIMARY KEY("athlete_id","exercise_id")
);
--> statement-breakpoint
CREATE TABLE "athlete_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"workout_id" uuid,
	"logged_set_id" uuid,
	"kind" "note_kind" DEFAULT 'note' NOT NULL,
	"body" text NOT NULL,
	"read_by_coach_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "athletes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"unit" "unit" DEFAULT 'kg' NOT NULL,
	"rounding_kg" double precision DEFAULT 2.5 NOT NULL,
	"rounding_lb" double precision DEFAULT 5 NOT NULL,
	"bodyweight_kg" double precision,
	"rpe_chart_id" uuid,
	"e1rm_formula" "e1rm_formula" DEFAULT 'epley' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "athletes_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "block_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"weekday" integer
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"program_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"kind" "block_kind" DEFAULT 'other' NOT NULL,
	"start_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category" "exercise_category" NOT NULL,
	"parent_id" uuid,
	"default_tm_ratio" double precision,
	"is_custom" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"athlete_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "logged_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"planned_exercise_id" uuid,
	"set_group_id" uuid,
	"exercise_id" uuid NOT NULL,
	"set_index" integer NOT NULL,
	"weight_kg" double precision NOT NULL,
	"weight_entered" double precision NOT NULL,
	"unit_entered" "unit" NOT NULL,
	"reps" integer NOT NULL,
	"rpe" double precision,
	"video_url" text,
	"notes" text DEFAULT '' NOT NULL,
	"prescription_snapshot" jsonb,
	"deviations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_unprescribed" boolean DEFAULT false NOT NULL,
	"performed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manual_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"weight_kg" double precision NOT NULL,
	"reps" integer DEFAULT 1 NOT NULL,
	"rpe" double precision,
	"date" date NOT NULL,
	"context" "record_context" DEFAULT 'gym' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meet_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"lift" "lift" NOT NULL,
	"attempt" integer NOT NULL,
	"planned_kg" double precision,
	"actual_kg" double precision,
	"result" "attempt_result"
);
--> statement-breakpoint
CREATE TABLE "meet_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meet_id" uuid NOT NULL,
	"athlete_id" uuid NOT NULL,
	"weight_class" text DEFAULT '' NOT NULL,
	"division" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"date" date NOT NULL,
	"federation" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planned_exercises" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workout_id" uuid NOT NULL,
	"slot_id" uuid,
	"exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"modifiers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rest_seconds" integer,
	"notes" text DEFAULT '' NOT NULL,
	"unit_override" "unit",
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid,
	"name" text NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"source_template_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rpe_charts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"data" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "set_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"planned_exercise_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"prescription" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_day_id" uuid NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "training_maxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"athlete_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"weight_kg" double precision NOT NULL,
	"effective_date" date NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"block_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week_id" uuid NOT NULL,
	"block_day_id" uuid NOT NULL,
	"planned_date" date,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"athlete_notes" text DEFAULT '' NOT NULL,
	"coach_notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "athlete_exercise_settings" ADD CONSTRAINT "athlete_exercise_settings_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_exercise_settings" ADD CONSTRAINT "athlete_exercise_settings_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_notes" ADD CONSTRAINT "athlete_notes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_notes" ADD CONSTRAINT "athlete_notes_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athlete_notes" ADD CONSTRAINT "athlete_notes_logged_set_id_logged_sets_id_fk" FOREIGN KEY ("logged_set_id") REFERENCES "public"."logged_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "athletes" ADD CONSTRAINT "athletes_rpe_chart_id_rpe_charts_id_fk" FOREIGN KEY ("rpe_chart_id") REFERENCES "public"."rpe_charts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "block_days" ADD CONSTRAINT "block_days_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_program_id_programs_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_parent_id_exercises_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_sets" ADD CONSTRAINT "logged_sets_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_sets" ADD CONSTRAINT "logged_sets_planned_exercise_id_planned_exercises_id_fk" FOREIGN KEY ("planned_exercise_id") REFERENCES "public"."planned_exercises"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_sets" ADD CONSTRAINT "logged_sets_set_group_id_set_groups_id_fk" FOREIGN KEY ("set_group_id") REFERENCES "public"."set_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "logged_sets" ADD CONSTRAINT "logged_sets_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_records" ADD CONSTRAINT "manual_records_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_records" ADD CONSTRAINT "manual_records_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_attempts" ADD CONSTRAINT "meet_attempts_entry_id_meet_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."meet_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_entries" ADD CONSTRAINT "meet_entries_meet_id_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "public"."meets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meet_entries" ADD CONSTRAINT "meet_entries_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_workout_id_workouts_id_fk" FOREIGN KEY ("workout_id") REFERENCES "public"."workouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_slot_id_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_exercises" ADD CONSTRAINT "planned_exercises_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "set_groups" ADD CONSTRAINT "set_groups_planned_exercise_id_planned_exercises_id_fk" FOREIGN KEY ("planned_exercise_id") REFERENCES "public"."planned_exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slots" ADD CONSTRAINT "slots_block_day_id_block_days_id_fk" FOREIGN KEY ("block_day_id") REFERENCES "public"."block_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_maxes" ADD CONSTRAINT "training_maxes_athlete_id_athletes_id_fk" FOREIGN KEY ("athlete_id") REFERENCES "public"."athletes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_maxes" ADD CONSTRAINT "training_maxes_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_block_id_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_week_id_weeks_id_fk" FOREIGN KEY ("week_id") REFERENCES "public"."weeks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workouts" ADD CONSTRAINT "workouts_block_day_id_block_days_id_fk" FOREIGN KEY ("block_day_id") REFERENCES "public"."block_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "athlete_notes_athlete_idx" ON "athlete_notes" USING btree ("athlete_id","created_at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "block_days_block_idx" ON "block_days" USING btree ("block_id","position");--> statement-breakpoint
CREATE INDEX "blocks_program_idx" ON "blocks" USING btree ("program_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "exercises_name_uq" ON "exercises" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "exercises_parent_idx" ON "exercises" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "logged_sets_workout_idx" ON "logged_sets" USING btree ("workout_id");--> statement-breakpoint
CREATE INDEX "logged_sets_set_group_idx" ON "logged_sets" USING btree ("set_group_id");--> statement-breakpoint
CREATE INDEX "logged_sets_exercise_idx" ON "logged_sets" USING btree ("exercise_id","performed_at");--> statement-breakpoint
CREATE INDEX "manual_records_athlete_idx" ON "manual_records" USING btree ("athlete_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "meet_attempts_uq" ON "meet_attempts" USING btree ("entry_id","lift","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "meet_entries_uq" ON "meet_entries" USING btree ("meet_id","athlete_id");--> statement-breakpoint
CREATE INDEX "planned_exercises_workout_idx" ON "planned_exercises" USING btree ("workout_id","position");--> statement-breakpoint
CREATE INDEX "planned_exercises_slot_idx" ON "planned_exercises" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "programs_athlete_idx" ON "programs" USING btree ("athlete_id");--> statement-breakpoint
CREATE INDEX "set_groups_pe_idx" ON "set_groups" USING btree ("planned_exercise_id","position");--> statement-breakpoint
CREATE INDEX "slots_day_idx" ON "slots" USING btree ("block_day_id","position");--> statement-breakpoint
CREATE INDEX "training_maxes_lookup_idx" ON "training_maxes" USING btree ("athlete_id","exercise_id","effective_date");--> statement-breakpoint
CREATE INDEX "weeks_block_idx" ON "weeks" USING btree ("block_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "workouts_week_day_uq" ON "workouts" USING btree ("week_id","block_day_id");--> statement-breakpoint
CREATE INDEX "workouts_date_idx" ON "workouts" USING btree ("planned_date");