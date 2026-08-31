CREATE INDEX "idx_audit_logs_device_id" ON "device_audit_logs" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user_id" ON "device_audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action" ON "device_audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created_at_desc" ON "device_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_budget_items_device_id" ON "budget_plan_items" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "idx_budget_items_plan_id" ON "budget_plan_items" USING btree ("budget_plan_id");--> statement-breakpoint
CREATE INDEX "idx_budget_items_created_at" ON "budget_plan_items" USING btree ("created_at");