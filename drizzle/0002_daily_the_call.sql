CREATE TABLE "primary_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "primary_standards_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "primary_standards_to_devices" (
	"primary_standarts_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "primary_standards_to_devices_primary_standarts_id_device_id_pk" PRIMARY KEY("primary_standarts_id","device_id")
);
--> statement-breakpoint
ALTER TABLE "primary_standards_to_devices" ADD CONSTRAINT "primary_standards_to_devices_primary_standarts_id_primary_standards_id_fk" FOREIGN KEY ("primary_standarts_id") REFERENCES "public"."primary_standards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_standards_to_devices" ADD CONSTRAINT "primary_standards_to_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;