CREATE TABLE "extraction_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"caller_hash" text,
	"request_id" text NOT NULL,
	"model" text NOT NULL,
	"pages" integer NOT NULL,
	"image_bytes" integer NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micros" bigint,
	"status" text NOT NULL,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extraction_usage" ADD CONSTRAINT "extraction_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraction_usage_user_created_idx" ON "extraction_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "extraction_usage_caller_created_idx" ON "extraction_usage" USING btree ("caller_hash","created_at");