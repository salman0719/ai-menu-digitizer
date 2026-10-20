CREATE TABLE "restaurant_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"actor_user_id" text,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"target_email" text,
	"target_name" text,
	"detail" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurant_audit_event" ADD CONSTRAINT "restaurant_audit_event_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_audit_event" ADD CONSTRAINT "restaurant_audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "restaurant_audit_restaurant_created_idx" ON "restaurant_audit_event" USING btree ("restaurant_id","created_at");