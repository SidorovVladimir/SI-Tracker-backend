CREATE TABLE "measurement_types_to_devices" (
	"measurement_types_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_types_to_devices_measurement_types_id_device_id_pk" PRIMARY KEY("measurement_types_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_measurement_type_id_measurement_types_id_fk";
--> statement-breakpoint
ALTER TABLE "measurement_types_to_devices" ADD CONSTRAINT "measurement_types_to_devices_measurement_types_id_measurement_types_id_fk" FOREIGN KEY ("measurement_types_id") REFERENCES "public"."measurement_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_types_to_devices" ADD CONSTRAINT "measurement_types_to_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "measurement_type_id";