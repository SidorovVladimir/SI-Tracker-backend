ALTER TABLE "devices" ADD COLUMN "cached_control" varchar(50);--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "next_verification_date" date;--> statement-breakpoint
CREATE INDEX "idx_statuses_name" ON "statuses" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_devices_archived" ON "devices" USING btree ("archived");--> statement-breakpoint
CREATE INDEX "idx_devices_status_id" ON "devices" USING btree ("status_id");--> statement-breakpoint
CREATE INDEX "idx_devices_production_site_id" ON "devices" USING btree ("production_site_id");--> statement-breakpoint
CREATE INDEX "idx_devices_equipment_type_id" ON "devices" USING btree ("equipment_type_id");--> statement-breakpoint
CREATE INDEX "idx_devices_metrology_cache" ON "devices" USING btree ("cached_control","next_verification_date");--> statement-breakpoint
CREATE INDEX "idx_devices_updated_at" ON "devices" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_batches_planned_date" ON "verification_batches" USING btree ("planned_date");--> statement-breakpoint
CREATE INDEX "idx_batches_status_type" ON "verification_batches" USING btree ("status","type");--> statement-breakpoint
CREATE INDEX "verifications_perf_metrology_idx" ON "verifications" USING btree ("device_id","metrology_controle_type_id","date");--> statement-breakpoint
CREATE INDEX "idx_cities_name" ON "cities" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_companies_name" ON "companies" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_production_sites_name" ON "production_sites" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_production_sites_company_id" ON "production_sites" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "idx_production_sites_city_id" ON "production_sites" USING btree ("city_id");