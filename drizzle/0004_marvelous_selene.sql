CREATE TABLE "verification_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "verification_organizations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "verifications" ADD COLUMN "verification_organization_id" uuid;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verification_organization_id_verification_organizations_id_fk" FOREIGN KEY ("verification_organization_id") REFERENCES "public"."verification_organizations"("id") ON DELETE no action ON UPDATE no action;