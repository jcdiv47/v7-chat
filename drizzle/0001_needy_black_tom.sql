CREATE TABLE "search_terms" (
	"user_id" text NOT NULL,
	"thread_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" uuid NOT NULL,
	"term" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "search_terms_user_id_source_kind_source_id_term_pk" PRIMARY KEY("user_id","source_kind","source_id","term")
);
--> statement-breakpoint
ALTER TABLE "search_terms" ADD CONSTRAINT "search_terms_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_terms_user_term_idx" ON "search_terms" USING btree ("user_id","term");--> statement-breakpoint
CREATE INDEX "search_terms_source_idx" ON "search_terms" USING btree ("source_kind","source_id");