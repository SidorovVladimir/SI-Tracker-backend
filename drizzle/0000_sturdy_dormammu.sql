CREATE TYPE "public"."role" AS ENUM('admin', 'user', 'superadmin');--> statement-breakpoint
CREATE TABLE "device_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"description" text NOT NULL,
	"new_data" jsonb,
	"old_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "equipment_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "measurement_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "measurement_types_to_devices" (
	"measurement_types_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "measurement_types_to_devices_measurement_types_id_device_id_pk" PRIMARY KEY("measurement_types_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "metrology_controle_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "metrology_controle_types_name_unique" UNIQUE("name")
);
--> statement-breakpoint
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
CREATE TABLE "scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scopes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "scopes_to_devices" (
	"scope_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "scopes_to_devices_scope_id_device_id_pk" PRIMARY KEY("scope_id","device_id")
);
--> statement-breakpoint
CREATE TABLE "statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "statuses_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "verification_organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "verification_organizations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"text" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"model" varchar NOT NULL,
	"serial_number" varchar NOT NULL,
	"release_date" timestamp,
	"grsi_number" varchar(100),
	"measurement_range" varchar,
	"accuracy" varchar,
	"inventory_number" varchar(100),
	"receipt_date" timestamp,
	"manufacturer" varchar,
	"verification_interval" integer,
	"archived" boolean DEFAULT false NOT NULL,
	"nomenclature" varchar,
	"comment" text,
	"lead_time_days" integer,
	"created_at" timestamp DEFAULT now(),
	"status_id" uuid NOT NULL,
	"production_site_id" uuid NOT NULL,
	"equipment_type_id" uuid,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices_to_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"device_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"device_status" text DEFAULT 'selected' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(100) NOT NULL,
	"planned_date" timestamp NOT NULL,
	"verification_organization_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"comment" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" timestamp,
	"valid_until" timestamp,
	"result" text,
	"protocol_number" varchar(50),
	"organization" varchar(255),
	"comment" text,
	"document_url" text,
	"metrology_controle_type_id" uuid,
	"verification_organization_id" uuid,
	"batch_id" uuid,
	"device_id" uuid NOT NULL,
	"cost" numeric(10, 2) DEFAULT '0.00',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "cities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"address" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "companies_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "production_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"company_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"type" varchar(50) DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_notification_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"notification_id" uuid NOT NULL,
	"is_read" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" varchar(50) NOT NULL,
	"last_name" varchar(50) NOT NULL,
	"email" varchar(50) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" "role" NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "device_audit_logs" ADD CONSTRAINT "device_audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_types_to_devices" ADD CONSTRAINT "measurement_types_to_devices_measurement_types_id_measurement_types_id_fk" FOREIGN KEY ("measurement_types_id") REFERENCES "public"."measurement_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "measurement_types_to_devices" ADD CONSTRAINT "measurement_types_to_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_standards_to_devices" ADD CONSTRAINT "primary_standards_to_devices_primary_standarts_id_primary_standards_id_fk" FOREIGN KEY ("primary_standarts_id") REFERENCES "public"."primary_standards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "primary_standards_to_devices" ADD CONSTRAINT "primary_standards_to_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scopes_to_devices" ADD CONSTRAINT "scopes_to_devices_scope_id_scopes_id_fk" FOREIGN KEY ("scope_id") REFERENCES "public"."scopes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scopes_to_devices" ADD CONSTRAINT "scopes_to_devices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_status_id_statuses_id_fk" FOREIGN KEY ("status_id") REFERENCES "public"."statuses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_production_site_id_production_sites_id_fk" FOREIGN KEY ("production_site_id") REFERENCES "public"."production_sites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_equipment_type_id_equipment_types_id_fk" FOREIGN KEY ("equipment_type_id") REFERENCES "public"."equipment_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices_to_batches" ADD CONSTRAINT "devices_to_batches_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices_to_batches" ADD CONSTRAINT "devices_to_batches_batch_id_verification_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."verification_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_batches" ADD CONSTRAINT "verification_batches_verification_organization_id_verification_organizations_id_fk" FOREIGN KEY ("verification_organization_id") REFERENCES "public"."verification_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_metrology_controle_type_id_metrology_controle_types_id_fk" FOREIGN KEY ("metrology_controle_type_id") REFERENCES "public"."metrology_controle_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_verification_organization_id_verification_organizations_id_fk" FOREIGN KEY ("verification_organization_id") REFERENCES "public"."verification_organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_batch_id_verification_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."verification_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_sites" ADD CONSTRAINT "production_sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_sites" ADD CONSTRAINT "production_sites_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_notifications" ADD CONSTRAINT "system_notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_statuses" ADD CONSTRAINT "user_notification_statuses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_notification_statuses" ADD CONSTRAINT "user_notification_statuses_notification_id_system_notifications_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."system_notifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cm_sender_id_idx" ON "chat_messages" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "cm_recipient_id_idx" ON "chat_messages" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "cm_unread_recipient_idx" ON "chat_messages" USING btree ("recipient_id","is_read");--> statement-breakpoint
CREATE INDEX "cm_created_at_idx" ON "chat_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "dtb_device_id_idx" ON "devices_to_batches" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "dtb_batch_id_idx" ON "devices_to_batches" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "verifications_device_id_idx" ON "verifications" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX "verifications_batch_id_idx" ON "verifications" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "verifications_date_idx" ON "verifications" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_site_unique_constraint" ON "production_sites" USING btree ("name","company_id","city_id");--> statement-breakpoint
CREATE INDEX "sn_created_at_idx" ON "system_notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sn_user_id_idx" ON "system_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "uns_user_notif_idx" ON "user_notification_statuses" USING btree ("user_id","notification_id");--> statement-breakpoint
CREATE INDEX "uns_notification_id_idx" ON "user_notification_statuses" USING btree ("notification_id");