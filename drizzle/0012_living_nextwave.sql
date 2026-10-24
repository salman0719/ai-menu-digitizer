CREATE TABLE "assistant_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"neurons" double precision,
	"cost_micros" bigint,
	"latency_ms" integer,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_usage" ADD CONSTRAINT "assistant_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_usage_user_created_idx" ON "assistant_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_usage_created_idx" ON "assistant_usage" USING btree ("created_at");