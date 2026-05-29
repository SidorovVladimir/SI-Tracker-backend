CREATE TABLE "devices_to_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"device_status" text DEFAULT 'selected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(100) NOT NULL,
	"planned_date" timestamp NOT NULL,
	"verification_organization_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "lead_time_days" integer;--> statement-breakpoint
ALTER TABLE "devices_to_batches" ADD CONSTRAINT "devices_to_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices_to_batches" ADD CONSTRAINT "devices_to_batches_batch_id_verification_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."verification_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_batches" ADD CONSTRAINT "verification_batches_verification_organization_id_verification_organizations_id_fk" FOREIGN KEY ("verification_organization_id") REFERENCES "public"."verification_organizations"("id") ON DELETE no action ON UPDATE no action;