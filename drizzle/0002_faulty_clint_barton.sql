CREATE TABLE "menu_revision" (
	"id" text PRIMARY KEY NOT NULL,
	"menu_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"doc" jsonb NOT NULL,
	"theme" text NOT NULL,
	"layout" text NOT NULL,
	"source_updated_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_menu" (
	"id" text PRIMARY KEY NOT NULL,
	"menu_id" text NOT NULL,
	"restaurant_id" text NOT NULL,
	"slug" text NOT NULL,
	"live_revision_id" text,
	"published_at" timestamp,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menu_revision" ADD CONSTRAINT "menu_revision_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_revision" ADD CONSTRAINT "menu_revision_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_menu" ADD CONSTRAINT "published_menu_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menu"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_menu" ADD CONSTRAINT "published_menu_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_menu" ADD CONSTRAINT "published_menu_live_revision_id_menu_revision_id_fk" FOREIGN KEY ("live_revision_id") REFERENCES "public"."menu_revision"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_revision_menu_idx" ON "menu_revision" USING btree ("menu_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "published_menu_menu_unique" ON "published_menu" USING btree ("menu_id");--> statement-breakpoint
CREATE UNIQUE INDEX "published_menu_slug_unique" ON "published_menu" USING btree ("slug");