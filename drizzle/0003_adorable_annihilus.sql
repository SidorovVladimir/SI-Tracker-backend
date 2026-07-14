ALTER TABLE "budget_plan_items" ADD COLUMN "vat_rate" numeric(5, 4) DEFAULT '0.2200' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_plan_items" DROP COLUMN "vat_amount";