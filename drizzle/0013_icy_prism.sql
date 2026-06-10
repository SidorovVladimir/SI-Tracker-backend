CREATE TABLE "user_notification_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"is_read" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "sn_user_id_idx";--> statement-breakpoint
DROP INDEX "sn_user_read_idx";--> statement-breakpoint
ALTER TABLE "user_notification_statuses" ADD CONSTRAINT "user_notification_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_statuses" ADD CONSTRAINT "user_notification_statuses_notification_id_system_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."system_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uns_user_notif_idx" ON "user_notification_statuses" USING btree ("user_id","notification_id");--> statement-breakpoint
ALTER TABLE "system_notifications" DROP COLUMN "is_read";