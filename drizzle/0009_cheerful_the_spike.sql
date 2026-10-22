ALTER TABLE "order_line" ADD COLUMN "menu_id" text;--> statement-breakpoint
ALTER TABLE "order_line" ADD COLUMN "menu_title" text;--> statement-breakpoint
ALTER TABLE "order_line" ADD CONSTRAINT "order_line_menu_id_menu_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menu"("id") ON DELETE set null ON UPDATE no action;