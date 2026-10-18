CREATE TABLE "menu" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"title" text NOT NULL,
	"currency" text,
	"doc" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu" ADD CONSTRAINT "menu_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_restaurant_idx" ON "menu" USING btree ("restaurant_id");