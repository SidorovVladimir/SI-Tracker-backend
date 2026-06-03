CREATE INDEX "dtb_device_id_idx" ON "devices_to_batches" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "dtb_batch_id_idx" ON "devices_to_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "verifications_device_id_idx" ON "verifications" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "verifications_batch_id_idx" ON "verifications" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "verifications_date_idx" ON "verifications" USING btree ("date");