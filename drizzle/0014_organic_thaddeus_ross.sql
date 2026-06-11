CREATE INDEX "cm_created_at_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sn_created_at_idx" ON "system_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sn_user_id_idx" ON "system_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uns_notification_id_idx" ON "user_notification_statuses" USING btree ("notification_id");