CREATE TYPE "public"."payment_method" AS ENUM('CARD', 'CREDIT');--> statement-breakpoint
CREATE TYPE "public"."payment_order_status" AS ENUM('PENDING', 'PAID', 'FAILED');--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TYPE "public"."listing_status" RENAME TO "listing_status_old";--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'REMOVED');--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "status" TYPE "public"."listing_status" USING "status"::text::"public"."listing_status";--> statement-breakpoint
DROP TYPE "public"."listing_status_old";--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "status" SET DEFAULT 'PENDING_PAYMENT';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "listing_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"reason" text NOT NULL,
	"listing_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_fils" integer NOT NULL,
	"currency" text DEFAULT 'AED' NOT NULL,
	"status" "payment_order_status" DEFAULT 'PENDING' NOT NULL,
	"method" "payment_method" NOT NULL,
	"provider" text NOT NULL,
	"provider_cart_id" text NOT NULL,
	"provider_ref" text,
	"redirect_url" text,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ALTER COLUMN "expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "activated_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_credits" ADD CONSTRAINT "listing_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "listing_credits" ADD CONSTRAINT "listing_credits_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listing_credits_user_idx" ON "listing_credits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_cart_idx" ON "payment_orders" USING btree ("provider_cart_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_listing_idx" ON "payment_orders" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_orders_user_idx" ON "payment_orders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_orders_one_paid_per_listing_idx" ON "payment_orders" USING btree ("listing_id") WHERE status = 'PAID';--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webhook_events_identity_idx" ON "webhook_events" USING btree ("provider","provider_event_id");
