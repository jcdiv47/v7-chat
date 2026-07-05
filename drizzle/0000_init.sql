CREATE TABLE "artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"message_id" uuid,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"text" text NOT NULL,
	"parts" jsonb,
	"tool_lines" jsonb,
	"run_id" uuid,
	"status" text,
	"duration_ms" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_chunks" (
	"run_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "run_chunks_run_id_seq_pk" PRIMARY KEY("run_id","seq")
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"type" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"heartbeat_at" timestamp with time zone,
	"model_alias" text NOT NULL,
	"model_id" text,
	"skills_version" text NOT NULL,
	"active_skill_names" jsonb NOT NULL,
	"loaded_skill_names" jsonb NOT NULL,
	"user_message_id" uuid,
	"assistant_message_id" uuid,
	"retry_anchor_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"finish_reason" text,
	"step_count" integer,
	"tool_call_count" integer,
	"sql_count" integer,
	"usage" jsonb
);
--> statement-breakpoint
CREATE TABLE "threads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_chunks" ADD CONSTRAINT "run_chunks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "artifacts_run_created_idx" ON "artifacts" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "artifacts_thread_created_idx" ON "artifacts" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_thread_created_idx" ON "messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_run_created_idx" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_thread_started_idx" ON "runs" USING btree ("thread_id","started_at");--> statement-breakpoint
CREATE INDEX "runs_status_heartbeat_idx" ON "runs" USING btree ("status","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_live_run_per_thread" ON "runs" USING btree ("thread_id") WHERE "runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "threads_user_updated_idx" ON "threads" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "threads_user_pinned_updated_idx" ON "threads" USING btree ("user_id","pinned","updated_at");