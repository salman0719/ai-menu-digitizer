DROP INDEX "published_menu_slug_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "published_menu_restaurant_slug_unique" ON "published_menu" USING btree ("restaurant_id","slug");