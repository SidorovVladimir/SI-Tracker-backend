ALTER TABLE "budget_plan_items" DROP CONSTRAINT "budget_plan_items_device_id_devices_id_fk";
--> statement-breakpoint
ALTER TABLE "budget_plan_items" ADD CONSTRAINT "budget_plan_items_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;