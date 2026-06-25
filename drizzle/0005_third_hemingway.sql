CREATE TABLE "budget_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_plan_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"device_name" varchar NOT NULL,
	"device_model" varchar NOT NULL,
	"matched_pricelist_item_id" uuid,
	"match_method" text NOT NULL,
	"base_price" numeric(10, 2) NOT NULL,
	"vat_amount" numeric(10, 2) DEFAULT '0.00' NOT NULL,
	"total_cost" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricelist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pricelist_id" uuid NOT NULL,
	"grsi_number" varchar(100),
	"csm_code" varchar(100),
	"name" text NOT NULL,
	"model_or_type" varchar(255),
	"price" numeric(10, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricelists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verification_organization_id" uuid NOT NULL,
	"title" varchar(255) NOT NULL,
	"year" integer NOT NULL,
	"is_regulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "csm_code" varchar(100);--> statement-breakpoint
ALTER TABLE "budget_plan_items" ADD CONSTRAINT "budget_plan_items_budget_plan_id_budget_plans_id_fk" FOREIGN KEY ("budget_plan_id") REFERENCES "public"."budget_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plan_items" ADD CONSTRAINT "budget_plan_items_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_plan_items" ADD CONSTRAINT "budget_plan_items_matched_pricelist_item_id_pricelist_items_id_fk" FOREIGN KEY ("matched_pricelist_item_id") REFERENCES "public"."pricelist_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricelist_items" ADD CONSTRAINT "pricelist_items_pricelist_id_pricelists_id_fk" FOREIGN KEY ("pricelist_id") REFERENCES "public"."pricelists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricelists" ADD CONSTRAINT "pricelists_verification_organization_id_verification_organizations_id_fk" FOREIGN KEY ("verification_organization_id") REFERENCES "public"."verification_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pi_grsi_idx" ON "pricelist_items" USING btree ("grsi_number");--> statement-breakpoint
CREATE INDEX "pi_csm_code_idx" ON "pricelist_items" USING btree ("csm_code");--> statement-breakpoint
CREATE INDEX "pi_pricelist_idx" ON "pricelist_items" USING btree ("pricelist_id");