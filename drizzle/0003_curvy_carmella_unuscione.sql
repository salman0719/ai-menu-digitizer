CREATE TABLE "order" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"menu_id" text,
	"menu_title" text NOT NULL,
	"table_label" text NOT NULL,
	"currency" text,
	"note" text,
	"status" text NOT NULL,
	"total_cents" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_line" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"menu_item_id" text NOT NULL,
	"name" text NOT NULL,
	"variant_name" text,
	"unit_price_cents" integer,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order" ADD CONSTRAINT "order_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menu"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_order_id_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_restaurant_created_idx" ON "order" USING btree ("restaurant_id","created_at");--> statement-breakpoint
CREATE INDEX "order_restaurant_status_idx" ON "order" USING btree ("restaurant_id","status");--> statement-breakpoint
CREATE INDEX "order_line_order_idx" ON "order_line" USING btree ("order_id");