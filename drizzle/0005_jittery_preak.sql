CREATE TABLE "restaurant_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"restaurant_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "restaurant_invitation" ADD CONSTRAINT "restaurant_invitation_restaurant_id_restaurant_id_fk" FOREIGN KEY ("restaurant_id") REFERENCES "public"."restaurant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restaurant_invitation" ADD CONSTRAINT "restaurant_invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "restaurant_invitation_token_unique" ON "restaurant_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "restaurant_invitation_restaurant_email_idx" ON "restaurant_invitation" USING btree ("restaurant_id","email");