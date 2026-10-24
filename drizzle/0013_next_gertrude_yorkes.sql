CREATE TABLE "order_email_log" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"order_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurant" ADD COLUMN "order_alerts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "restaurant" ADD COLUMN "order_alert_email" text;--> statement-breakpoint
ALTER TABLE "order_email_log" ADD CONSTRAINT "order_email_log_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_email_log_order_unique" ON "order_email_log" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_email_log_restaurant_sent_idx" ON "order_email_log" USING btree ("restaurant_id","created_at");