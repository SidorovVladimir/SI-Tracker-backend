ALTER TABLE "pricelist_items" ADD COLUMN "year" integer DEFAULT 2026 NOT NULL;--> statement-breakpoint
ALTER TABLE "pricelist_items" ADD COLUMN "match_history_sku" text;--> statement-breakpoint
CREATE INDEX "pi_match_history_sku_idx" ON "pricelist_items" USING btree ("match_history_sku");