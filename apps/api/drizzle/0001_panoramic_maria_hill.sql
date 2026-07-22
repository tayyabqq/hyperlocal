CREATE TYPE "public"."listing_status" AS ENUM('ACTIVE', 'EXPIRED', 'REMOVED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid NOT NULL,
	"author_role" "user_role" NOT NULL,
	"category" text NOT NULL,
	"pay_amount_aed" integer NOT NULL,
	"description" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"location" geography(Point,4326) NOT NULL,
	"location_label" text NOT NULL,
	"status" "listing_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listings" ADD CONSTRAINT "listings_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_status_expiry_idx" ON "listings" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_author_idx" ON "listings" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_location_gist_idx" ON "listings" USING gist ("location");